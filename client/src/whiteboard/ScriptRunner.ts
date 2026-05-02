// ScriptRunner: executes a validated WhiteboardScript step-by-step,
// animating each command using requestAnimationFrame. Calls listener
// callbacks so React state stays in sync.
import type {
  AnnotationElement,
  CanvasConfig,
  ElementBBox,
  RenderedElement,
  WhiteboardCommand,
  WhiteboardScript,
} from "./commandTypes";
import {
  expandConstructGeometryCommand,
  warmupJsxGraphGeometryEngine,
} from "./geometryEngine";

export interface RunnerCallbacks {
  onCanvasChange: (canvas: CanvasConfig) => void;
  onElementsChange: (elements: RenderedElement[]) => void;
  onAnnotationsChange: (annotations: AnnotationElement[]) => void;
  onStepChange: (currentIndex: number, total: number) => void;
  // Push the full narration string for the upcoming command. The UI is
  // responsible for animating its appearance (typewriter). null clears it.
  onNarrationChange: (narration: string | null, targetDurationMs?: number) => void | Promise<void>;
  onWaitChange: (wait: WaitState | null) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export interface RunnerOptions {
  playbackSpeed?: number;
}

export interface WaitState {
  message: string;
}

type PageRuntimeState = {
  elements: RenderedElement[];
  annotations: AnnotationElement[];
  canvas: CanvasConfig;
};

export class ScriptRunner {
  private script: WhiteboardScript;
  private cb: RunnerCallbacks;
  private cancelled = false;
  private currentRaf: number | null = null;
  private elements: RenderedElement[] = [];
  private annotations: AnnotationElement[] = [];
  private canvas: CanvasConfig;
  private playbackSpeed: number;
  private waitResolver: (() => void) | null = null;
  private paused = false;
  private pausedAt: number | null = null;
  private totalPausedMs = 0;
  private currentPageId = "default";
  private pageStates = new Map<string, PageRuntimeState>();

  constructor(script: WhiteboardScript, cb: RunnerCallbacks, options: RunnerOptions = {}) {
    this.script = script;
    this.cb = cb;
    this.canvas = script.canvas;
    this.playbackSpeed = this.normalizePlaybackSpeed(options.playbackSpeed);
  }

  cancel() {
    this.cancelled = true;
    this.paused = false;
    this.pausedAt = null;
    if (this.waitResolver) {
      this.waitResolver();
      this.waitResolver = null;
      this.cb.onWaitChange(null);
    }
    if (this.currentRaf !== null) {
      cancelAnimationFrame(this.currentRaf);
      this.currentRaf = null;
    }
  }

  continueFromWait() {
    if (!this.waitResolver) return;
    this.waitResolver();
    this.waitResolver = null;
    this.cb.onWaitChange(null);
  }

  setPlaybackSpeed(speed: number) {
    this.playbackSpeed = this.normalizePlaybackSpeed(speed);
  }

  pause() {
    if (this.cancelled || this.paused) return;
    this.paused = true;
    this.pausedAt = performance.now();
  }

  resume() {
    if (!this.paused) return;
    if (this.pausedAt !== null) {
      this.totalPausedMs += performance.now() - this.pausedAt;
    }
    this.paused = false;
    this.pausedAt = null;
  }

  setPaused(paused: boolean) {
    if (paused) this.pause();
    else this.resume();
  }

  async run() {
    try {
      // Reset
      this.elements = [];
      this.annotations = [];
      this.canvas = this.script.canvas;
      this.currentPageId = this.script.pages?.[0]?.id ?? "default";
      this.pageStates = new Map();
      this.saveCurrentPage();
      this.paused = false;
      this.pausedAt = null;
      this.totalPausedMs = 0;
      this.cb.onCanvasChange(this.canvas);
      this.cb.onElementsChange([]);
      this.cb.onAnnotationsChange([]);

      this.cb.onWaitChange(null);
      this.cb.onNarrationChange(null);
      const total = this.script.commands.length;
      for (let i = 0; i < total; i++) {
        if (this.cancelled) return;
        this.cb.onStepChange(i, total);
        // Surface narration BEFORE drawing so the subtitle leads the strokes.
        const cmd = this.script.commands[i];
        const narration =
          cmd.type === "write_text" ||
          cmd.type === "switch_page" ||
          cmd.type === "write_text_segments" ||
          cmd.type === "write_math" ||
          cmd.type === "write_math_steps" ||
          cmd.type === "write_division_layout" ||
          cmd.type === "draw_line" ||
          cmd.type === "draw_arrow" ||
          cmd.type === "draw_path" ||
          cmd.type === "draw_rectangle" ||
          cmd.type === "draw_triangle" ||
          cmd.type === "draw_circle" ||
          cmd.type === "draw_arc_arrow" ||
          cmd.type === "draw_brace" ||
          cmd.type === "move_object" ||
          cmd.type === "draw_coordinate_system" ||
          cmd.type === "draw_function" ||
          cmd.type === "plot_point" ||
          cmd.type === "draw_coordinate_segment" ||
          cmd.type === "draw_point" ||
          cmd.type === "draw_segment" ||
          cmd.type === "draw_ray" ||
          cmd.type === "draw_angle" ||
          cmd.type === "mark_equal_segments" ||
          cmd.type === "mark_parallel" ||
          cmd.type === "mark_perpendicular" ||
          cmd.type === "highlight_polygon" ||
          cmd.type === "construct_geometry" ||
          cmd.type === "erase_object" ||
          cmd.type === "erase_area" ||
          cmd.type === "clear_canvas" ||
          cmd.type === "laser_pointer" ||
          cmd.type === "wait" ||
          cmd.type === "annotate_underline" ||
          cmd.type === "annotate_circle" ||
          cmd.type === "annotate_object" ||
          cmd.type === "annotate_math_bbox" ||
          cmd.type === "emphasize_text" ||
          cmd.type === "clear_annotations"
            ? (cmd.narration ?? null)
            : null;
        // Always push (even null) so the bar updates between steps. Narration
        // and whiteboard movement start together; the next step waits for both.
        const narrationDone = Promise.resolve(
          this.cb.onNarrationChange(narration, this.estimateCommandDuration(cmd)),
        );
        await Promise.all([this.runCommand(cmd), narrationDone]);
      }
      if (this.cancelled) return;
      this.cb.onStepChange(total, total);
      this.cb.onComplete();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.cb.onError(msg);
    }
  }

  private commit() {
    // Push a shallow copy so React detects the change.
    this.saveCurrentPage();
    this.cb.onElementsChange([...this.elements]);
  }

  private commitAnnotations() {
    this.saveCurrentPage();
    this.cb.onAnnotationsChange([...this.annotations]);
  }

  private saveCurrentPage() {
    this.pageStates.set(this.currentPageId, {
      elements: [...this.elements],
      annotations: [...this.annotations],
      canvas: this.canvas,
    });
  }

  private loadPage(pageId: string) {
    const state = this.pageStates.get(pageId);
    this.currentPageId = pageId;
    if (state) {
      this.elements = [...state.elements];
      this.annotations = [...state.annotations];
      this.canvas = state.canvas;
    } else {
      this.elements = [];
      this.annotations = [];
      this.canvas = this.script.canvas;
      this.saveCurrentPage();
    }
    this.cb.onCanvasChange(this.canvas);
    this.cb.onElementsChange([...this.elements]);
    this.cb.onAnnotationsChange([...this.annotations]);
  }

  private normalizePlaybackSpeed(speed: unknown) {
    return typeof speed === "number" && Number.isFinite(speed)
      ? Math.max(0.25, Math.min(speed, 2))
      : 1;
  }

  private durationFor(duration: number) {
    return Math.max(duration / this.playbackSpeed, 1);
  }

  private now() {
    const current = this.paused && this.pausedAt !== null ? this.pausedAt : performance.now();
    return current - this.totalPausedMs;
  }

  private estimateCommandDuration(cmd: WhiteboardCommand) {
    if ("duration" in cmd && typeof cmd.duration === "number") {
      return this.durationFor(cmd.duration);
    }
    return undefined;
  }

  private wait(duration = 0) {
    return new Promise<void>((resolve) => {
      if (duration <= 0 || this.cancelled) {
        resolve();
        return;
      }
      const runDuration = this.durationFor(duration);
      const start = this.now();
      const tick = () => {
        if (this.cancelled) {
          resolve();
          return;
        }
        if (this.now() - start >= runDuration) {
          resolve();
          return;
        }
        this.currentRaf = requestAnimationFrame(tick);
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private estimateTextWidth(text: string, fontSize: number) {
    let width = 0;
    for (const char of Array.from(text)) {
      width += /[一-鿿]/.test(char) ? fontSize : fontSize * 0.58;
    }
    return Math.max(width, fontSize);
  }

  private reflowTextSegments(el: Extract<RenderedElement, { kind: "text_segments" }>) {
    let cursorX = el.x;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let previousFontSize = el.fontSize;
    for (const segment of el.segments) {
      const width = this.estimateTextWidth(segment.text, segment.fontSize);
      const fontSizeDelta = Math.max(0, segment.fontSize - previousFontSize);
      if (fontSizeDelta > 0 && cursorX > el.x) {
        cursorX += fontSizeDelta * 0.65 + 4;
      }
      segment.x = cursorX;
      segment.y = el.y;
      segment.bbox = {
        x: cursorX,
        y: el.y - segment.fontSize,
        width,
        height: segment.fontSize * 1.25,
      };
      cursorX += width;
      previousFontSize = segment.fontSize;
      minY = Math.min(minY, segment.bbox.y);
      maxY = Math.max(maxY, segment.bbox.y + segment.bbox.height);
    }
    el.bbox = {
      x: el.x,
      y: Number.isFinite(minY) ? minY : el.y - el.fontSize,
      width: Math.max(cursorX - el.x, el.fontSize),
      height: Number.isFinite(maxY - minY) ? maxY - minY : el.fontSize * 1.25,
    };
  }

  private estimateLatexWidth(latex: string, fontSize: number, displayMode = false) {
    const compact = latex
      .replace(/\\(frac|sqrt|text|begin|end|left|right|cdots|div|times|cdot|quad|qquad)/g, "MM")
      .replace(/[{}\\_^]/g, "");
    return Math.max(
      fontSize * (displayMode ? 2.4 : 1.6),
      Math.min(this.canvas.width, compact.length * fontSize * 0.58 + fontSize * 1.5),
    );
  }

  private getElementBBox(el: RenderedElement): ElementBBox {
    if ("bbox" in el) {
      const tx = el.transform?.translateX ?? 0;
      const ty = el.transform?.translateY ?? 0;
      return {
        x: el.bbox.x + tx,
        y: el.bbox.y + ty,
        width: el.bbox.width,
        height: el.bbox.height,
      };
    }
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  private getBaseElementBBox(el: RenderedElement): ElementBBox {
    if ("bbox" in el) return el.bbox;
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  private easeProgress(t: number, easing: "linear" | "easeInOut" | "easeOut" = "easeInOut") {
    if (easing === "linear") return t;
    if (easing === "easeOut") return 1 - (1 - t) * (1 - t);
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  private interpolateCatmullRomOpen(points: [number, number][], t: number): [number, number] {
    if (points.length === 0) return [0, 0];
    if (points.length === 1) return points[0];
    const clampedT = Math.max(0, Math.min(t, 1));
    const scaled = clampedT * (points.length - 1);
    const index = Math.min(Math.floor(scaled), points.length - 2);
    const localT = scaled - index;
    const p0 = points[Math.max(index - 1, 0)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(index + 2, points.length - 1)];
    const tt = localT * localT;
    const ttt = tt * localT;
    const interpolate = (axis: 0 | 1) =>
      0.5 *
      (2 * p1[axis] +
        (-p0[axis] + p2[axis]) * localT +
        (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * tt +
        (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * ttt);
    return [interpolate(0), interpolate(1)];
  }

  private buildLaserRoute(cmd: Extract<WhiteboardCommand, { type: "laser_pointer" }>) {
    if (cmd.path && cmd.path.length >= 2) return cmd.path;
    if (cmd.to) return [[cmd.x, cmd.y], [cmd.to.x, cmd.to.y]] as [number, number][];
    return [[cmd.x, cmd.y]] as [number, number][];
  }

  private expandBBox(bbox: ElementBBox, padding: number): ElementBBox {
    return {
      x: bbox.x - padding,
      y: bbox.y - padding,
      width: bbox.width + padding * 2,
      height: bbox.height + padding * 2,
    };
  }

  private pathBBox(points: [number, number][], padding = 0): ElementBBox {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return {
      x: Math.min(...xs) - padding,
      y: Math.min(...ys) - padding,
      width: Math.max(...xs) - Math.min(...xs) + padding * 2,
      height: Math.max(...ys) - Math.min(...ys) + padding * 2,
    };
  }

  private angleToPoint(cx: number, cy: number, radius: number, angle: number): [number, number] {
    const radians = (angle * Math.PI) / 180;
    return [cx + Math.cos(radians) * radius, cy + Math.sin(radians) * radius];
  }

  private arcSweep(startAngle: number, endAngle: number, clockwise: boolean) {
    let sweep = endAngle - startAngle;
    if (clockwise) {
      while (sweep <= 0) sweep += 360;
      return Math.min(sweep, 359.9);
    }
    while (sweep >= 0) sweep -= 360;
    return Math.max(sweep, -359.9);
  }

  private arcPath(cx: number, cy: number, radius: number, startAngle: number, sweep: number) {
    const start = this.angleToPoint(cx, cy, radius, startAngle);
    const end = this.angleToPoint(cx, cy, radius, startAngle + sweep);
    const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
    const sweepFlag = sweep > 0 ? 1 : 0;
    return `M ${start[0]} ${start[1]} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${end[0]} ${end[1]}`;
  }

  private angleOf(from: [number, number], to: [number, number]) {
    return Math.atan2(to[1] - from[1], to[0] - from[0]);
  }

  private unitVector(from: [number, number], to: [number, number]): [number, number] {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    return len > 0 ? [dx / len, dy / len] : [1, 0];
  }

  private normalVector(from: [number, number], to: [number, number]): [number, number] {
    const [ux, uy] = this.unitVector(from, to);
    return [-uy, ux];
  }

  private anglePath(
    vertex: [number, number],
    from: [number, number],
    to: [number, number],
    radius: number,
  ) {
    let start = (this.angleOf(vertex, from) * 180) / Math.PI;
    let end = (this.angleOf(vertex, to) * 180) / Math.PI;
    let sweep = end - start;
    while (sweep <= -180) sweep += 360;
    while (sweep > 180) sweep -= 360;
    if (Math.abs(sweep) < 0.1) sweep = 359.9;
    if (sweep < 0) {
      [start, end] = [end, start];
      sweep = -sweep;
    }
    return {
      pathD: this.arcPath(vertex[0], vertex[1], radius, start, sweep),
      midAngle: ((start + sweep / 2) * Math.PI) / 180,
    };
  }

  private segmentLabelPoint(from: [number, number], to: [number, number], offset = 18) {
    const mid: [number, number] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    const [nx, ny] = this.normalVector(from, to);
    return [mid[0] + nx * offset, mid[1] + ny * offset] as [number, number];
  }

  private geometryMarkBBox(points: [number, number][], padding = 8) {
    return this.pathBBox(points, padding);
  }

  private rectanglePath(x: number, y: number, width: number, height: number, radius = 0) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    if (r === 0) {
      return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
    }
    return [
      `M ${x + r} ${y}`,
      `H ${x + width - r}`,
      `Q ${x + width} ${y} ${x + width} ${y + r}`,
      `V ${y + height - r}`,
      `Q ${x + width} ${y + height} ${x + width - r} ${y + height}`,
      `H ${x + r}`,
      `Q ${x} ${y + height} ${x} ${y + height - r}`,
      `V ${y + r}`,
      `Q ${x} ${y} ${x + r} ${y}`,
      "Z",
    ].join(" ");
  }

  private circlePath(cx: number, cy: number, radius: number) {
    return [
      `M ${cx + radius} ${cy}`,
      `A ${radius} ${radius} 0 1 1 ${cx - radius} ${cy}`,
      `A ${radius} ${radius} 0 1 1 ${cx + radius} ${cy}`,
      "Z",
    ].join(" ");
  }

  private bracePath(
    from: [number, number],
    to: [number, number],
    orientation: "left" | "right" | "up" | "down",
    depth: number,
  ) {
    const [x1, y1] = from;
    const [x2, y2] = to;
    if (orientation === "left" || orientation === "right") {
      const sign = orientation === "right" ? 1 : -1;
      const topY = Math.min(y1, y2);
      const bottomY = Math.max(y1, y2);
      const x = (x1 + x2) / 2;
      const h = Math.max(bottomY - topY, 1);
      const midY = topY + h / 2;
      const d = Math.max(depth, 1);
      const openX = x + sign * d * 0.68;
      const innerX = x + sign * d * 0.18;
      const outerX = x - sign * d * 0.62;
      return [
        `M ${openX} ${topY}`,
        `C ${innerX} ${topY} ${outerX} ${topY + h * 0.08} ${outerX} ${topY + h * 0.27}`,
        `C ${outerX} ${topY + h * 0.39} ${innerX} ${midY - h * 0.1} ${openX} ${midY}`,
        `C ${innerX} ${midY + h * 0.1} ${outerX} ${bottomY - h * 0.39} ${outerX} ${bottomY - h * 0.27}`,
        `C ${outerX} ${bottomY - h * 0.08} ${innerX} ${bottomY} ${openX} ${bottomY}`,
      ].join(" ");
    }

    const sign = orientation === "down" ? 1 : -1;
    const leftX = Math.min(x1, x2);
    const rightX = Math.max(x1, x2);
    const y = (y1 + y2) / 2;
    const w = Math.max(rightX - leftX, 1);
    const midX = leftX + w / 2;
    const d = Math.max(depth, 1);
    const openY = y + sign * d * 0.68;
    const innerY = y + sign * d * 0.18;
    const outerY = y - sign * d * 0.62;
    return [
      `M ${leftX} ${openY}`,
      `C ${leftX} ${innerY} ${leftX + w * 0.08} ${outerY} ${leftX + w * 0.27} ${outerY}`,
      `C ${leftX + w * 0.39} ${outerY} ${midX - w * 0.1} ${innerY} ${midX} ${openY}`,
      `C ${midX + w * 0.1} ${innerY} ${rightX - w * 0.39} ${outerY} ${rightX - w * 0.27} ${outerY}`,
      `C ${rightX - w * 0.08} ${outerY} ${rightX} ${innerY} ${rightX} ${openY}`,
    ].join(" ");
  }

  private niceTickStep(range: number) {
    const rough = Math.abs(range) / 8;
    if (!Number.isFinite(rough) || rough <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const scaled = rough / pow;
    const factor = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
    return factor * pow;
  }

  private buildTicks(min: number, max: number, step?: number) {
    const tickStep = step ?? this.niceTickStep(max - min);
    const start = Math.ceil(min / tickStep) * tickStep;
    const ticks: number[] = [];
    for (let value = start; value <= max + tickStep * 0.001; value += tickStep) {
      const rounded = Number(value.toFixed(10));
      if (rounded >= min - tickStep * 0.001 && rounded <= max + tickStep * 0.001) {
        ticks.push(rounded);
      }
      if (ticks.length > 80) break;
    }
    return ticks;
  }

  private mathToCanvas(
    cs: Extract<RenderedElement, { kind: "coordinate_system" }>,
    x: number,
    y: number,
  ): [number, number] {
    const px = cs.x + ((x - cs.xMin) / (cs.xMax - cs.xMin)) * cs.width;
    const py = cs.y + cs.height - ((y - cs.yMin) / (cs.yMax - cs.yMin)) * cs.height;
    return [px, py];
  }

  private findCoordinateSystem(id: string) {
    const system = this.elements.find(
      (el): el is Extract<RenderedElement, { kind: "coordinate_system" }> =>
        el.kind === "coordinate_system" && el.id === id,
    );
    return system ?? null;
  }

  private evaluateMathExpression(expression: string, xValue: number) {
    type Token =
      | { type: "number"; value: number }
      | { type: "identifier"; value: string }
      | { type: "operator"; value: string }
      | { type: "paren"; value: "(" | ")" };

    const tokens: Token[] = [];
    let i = 0;
    while (i < expression.length) {
      const char = expression[i];
      if (/\s/.test(char)) {
        i++;
        continue;
      }
      if (/[0-9.]/.test(char)) {
        const match = expression.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
        if (!match) throw new Error(`函数表达式数字格式错误: ${expression}`);
        tokens.push({ type: "number", value: Number(match[0]) });
        i += match[0].length;
        continue;
      }
      if (/[a-zA-Z]/.test(char)) {
        const match = expression.slice(i).match(/^[a-zA-Z]+/);
        if (!match) throw new Error(`函数表达式标识符错误: ${expression}`);
        tokens.push({ type: "identifier", value: match[0].toLowerCase() });
        i += match[0].length;
        continue;
      }
      if ("+-*/^".includes(char)) {
        tokens.push({ type: "operator", value: char });
        i++;
        continue;
      }
      if (char === "(" || char === ")") {
        tokens.push({ type: "paren", value: char });
        i++;
        continue;
      }
      throw new Error(`函数表达式包含不支持的字符: ${char}`);
    }

    let pos = 0;
    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];
    const matchOperator = (operator: string) => {
      const token = peek();
      if (token?.type === "operator" && token.value === operator) {
        pos++;
        return true;
      }
      return false;
    };

    const parseExpression = (): number => {
      let value = parseTerm();
      while (true) {
        if (matchOperator("+")) value += parseTerm();
        else if (matchOperator("-")) value -= parseTerm();
        else break;
      }
      return value;
    };

    const parseTerm = (): number => {
      let value = parsePower();
      while (true) {
        if (matchOperator("*")) value *= parsePower();
        else if (matchOperator("/")) value /= parsePower();
        else break;
      }
      return value;
    };

    const parsePower = (): number => {
      let value = parseUnary();
      if (matchOperator("^")) {
        value = Math.pow(value, parsePower());
      }
      return value;
    };

    const parseUnary = (): number => {
      if (matchOperator("+")) return parseUnary();
      if (matchOperator("-")) return -parseUnary();
      return parsePrimary();
    };

    const parsePrimary = (): number => {
      const token = consume();
      if (!token) throw new Error(`函数表达式不完整: ${expression}`);
      if (token.type === "number") return token.value;
      if (token.type === "identifier") {
        if (token.value === "x") return xValue;
        if (token.value === "pi") return Math.PI;
        if (token.value === "e") return Math.E;
        const next = consume();
        if (next?.type !== "paren" || next.value !== "(") {
          throw new Error(`函数 ${token.value} 需要括号参数。`);
        }
        const arg = parseExpression();
        const close = consume();
        if (close?.type !== "paren" || close.value !== ")") {
          throw new Error(`函数 ${token.value} 缺少右括号。`);
        }
        const fns: Record<string, (value: number) => number> = {
          abs: Math.abs,
          ceil: Math.ceil,
          cos: Math.cos,
          exp: Math.exp,
          floor: Math.floor,
          ln: Math.log,
          log: Math.log10,
          round: Math.round,
          sin: Math.sin,
          sqrt: Math.sqrt,
          tan: Math.tan,
        };
        const fn = fns[token.value];
        if (!fn) throw new Error(`不支持的函数: ${token.value}`);
        return fn(arg);
      }
      if (token.type === "paren" && token.value === "(") {
        const value = parseExpression();
        const close = consume();
        if (close?.type !== "paren" || close.value !== ")") {
          throw new Error(`函数表达式缺少右括号: ${expression}`);
        }
        return value;
      }
      throw new Error(`函数表达式解析失败: ${expression}`);
    };

    const result = parseExpression();
    if (pos < tokens.length) {
      throw new Error(`函数表达式有多余内容: ${expression}`);
    }
    return result;
  }

  private resolveTextTarget(targetId: string, segmentId?: string) {
    const el = this.elements.find((item) => item.id === targetId);
    if (!el) return null;
    if (el.kind === "text_segments") {
      if (!segmentId) {
        return { element: el, segment: undefined, bbox: el.bbox, text: el.segments.map((s) => s.text).join("") };
      }
      const segment = el.segments.find((item) => item.id === segmentId);
      if (!segment) return null;
      return { element: el, segment, bbox: segment.bbox, text: segment.text };
    }
    if (segmentId) return null;
    if (el.kind === "text") {
      return { element: el, segment: undefined, bbox: el.bbox, text: el.text };
    }
    return null;
  }

  private runCommand(cmd: WhiteboardCommand): Promise<void> {
    if (cmd.type === "set_canvas") {
      this.canvas = {
        width: cmd.width,
        height: cmd.height,
        background: cmd.background ?? "#ffffff",
      };
      this.cb.onCanvasChange(this.canvas);
      return Promise.resolve();
    }
    if (cmd.type === "switch_page") {
      return this.switchPage(cmd);
    }
    if (cmd.type === "write_text") {
      return this.animateText(cmd);
    }
    if (cmd.type === "write_text_segments") {
      return this.animateTextSegments(cmd);
    }
    if (cmd.type === "write_math") {
      return this.animateMath(cmd);
    }
    if (cmd.type === "write_math_steps") {
      return this.animateMathSteps(cmd);
    }
    if (cmd.type === "write_division_layout") {
      return this.animateDivisionLayout(cmd);
    }
    if (cmd.type === "draw_line") {
      return this.animateLine(cmd);
    }
    if (cmd.type === "draw_arrow") {
      return this.animateArrow(cmd);
    }
    if (cmd.type === "draw_path") {
      return this.animatePath(cmd);
    }
    if (cmd.type === "draw_rectangle") {
      return this.animateRectangle(cmd);
    }
    if (cmd.type === "draw_triangle") {
      return this.animateTriangle(cmd);
    }
    if (cmd.type === "draw_circle") {
      return this.animateCircle(cmd);
    }
    if (cmd.type === "draw_arc_arrow") {
      return this.animateArcArrow(cmd);
    }
    if (cmd.type === "draw_brace") {
      return this.animateBrace(cmd);
    }
    if (cmd.type === "move_object") {
      return this.moveObject(cmd);
    }
    if (cmd.type === "draw_coordinate_system") {
      return this.animateCoordinateSystem(cmd);
    }
    if (cmd.type === "draw_function") {
      return this.animateFunction(cmd);
    }
    if (cmd.type === "plot_point") {
      return this.animatePlotPoint(cmd);
    }
    if (cmd.type === "draw_coordinate_segment") {
      return this.animateCoordinateSegment(cmd);
    }
    if (cmd.type === "draw_point") {
      return this.animateGeometryPoint(cmd);
    }
    if (cmd.type === "draw_segment") {
      return this.animateGeometrySegment(cmd);
    }
    if (cmd.type === "draw_ray") {
      return this.animateGeometryRay(cmd);
    }
    if (cmd.type === "draw_angle") {
      return this.animateGeometryAngle(cmd);
    }
    if (cmd.type === "mark_equal_segments") {
      return this.animateEqualSegmentMarks(cmd);
    }
    if (cmd.type === "mark_parallel") {
      return this.animateParallelMarks(cmd);
    }
    if (cmd.type === "mark_perpendicular") {
      return this.animatePerpendicularMark(cmd);
    }
    if (cmd.type === "highlight_polygon") {
      return this.animateHighlightPolygon(cmd);
    }
    if (cmd.type === "construct_geometry") {
      return this.constructGeometry(cmd);
    }
    if (cmd.type === "erase_object") {
      return this.eraseObject(cmd);
    }
    if (cmd.type === "erase_area") {
      return this.eraseArea(cmd);
    }
    if (cmd.type === "clear_canvas") {
      return this.clearCanvas(cmd);
    }
    if (cmd.type === "laser_pointer") {
      return this.animateLaserPointer(cmd);
    }
    if (cmd.type === "wait") {
      return this.waitForUser(cmd);
    }
    if (cmd.type === "annotate_underline") {
      return this.animateAnnotateUnderline(cmd);
    }
    if (cmd.type === "annotate_circle") {
      return this.animateAnnotateCircle(cmd);
    }
    if (cmd.type === "annotate_object") {
      return this.animateAnnotateObject(cmd);
    }
    if (cmd.type === "annotate_math_bbox") {
      return this.animateAnnotateMathBbox(cmd);
    }
    if (cmd.type === "emphasize_text") {
      return this.emphasizeText(cmd);
    }
    if (cmd.type === "clear_annotations") {
      return this.clearAnnotations(cmd);
    }
    return Promise.reject(
      // Should never reach here because validation rejected unsupported types,
      // but keep a defensive branch.
      new Error(`不支持的命令类型: ${(cmd as { type: string }).type}`),
    );
  }

  private async switchPage(cmd: Extract<WhiteboardCommand, { type: "switch_page" }>) {
    this.saveCurrentPage();
    this.loadPage(cmd.pageId);
    await this.wait(cmd.duration ?? 400);
  }

  private animateText(cmd: Extract<WhiteboardCommand, { type: "write_text" }>) {
    return new Promise<void>((resolve) => {
      // Push a placeholder element with empty text we mutate over time.
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "text",
        id: cmd.id,
        text: "",
        x: cmd.x,
        y: cmd.y,
        fontSize: cmd.fontSize,
        color: cmd.color ?? "#111111",
        fontWeight: cmd.bold ? 700 : undefined,
        bbox: {
          x: cmd.x,
          y: cmd.y - cmd.fontSize,
          width: this.estimateTextWidth(cmd.text, cmd.fontSize),
          height: cmd.fontSize * 1.25,
        },
      });
      this.commit();

      // Use Array.from to handle multi-byte characters (e.g. emoji, surrogate pairs).
      const chars = Array.from(cmd.text);
      const total = chars.length;
      if (total === 0) {
        resolve();
        return;
      }
      const duration = this.durationFor(cmd.duration);
      const start = this.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const visibleCount = Math.max(1, Math.ceil(t * total));
        const visibleText = chars.slice(0, visibleCount).join("");
        const target = this.elements[elIndex];
        if (target && target.kind === "text") {
          target.text = visibleText;
          this.commit();
        }
        if (t >= 1) {
          // Ensure final state is exact.
          if (target && target.kind === "text") {
            target.text = cmd.text;
            this.commit();
          }
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateTextSegments(
    cmd: Extract<WhiteboardCommand, { type: "write_text_segments" }>,
  ) {
    return new Promise<void>((resolve) => {
      const elIndex = this.elements.length;
      const element: Extract<RenderedElement, { kind: "text_segments" }> = {
        kind: "text_segments",
        id: cmd.id,
        x: cmd.x,
        y: cmd.y,
        fontSize: cmd.fontSize,
        color: cmd.color ?? "#111111",
        segments: cmd.segments.map((segment) => ({
          id: segment.id,
          text: segment.text,
          visibleText: "",
          x: cmd.x,
          y: cmd.y,
          fontSize: segment.fontSize ?? cmd.fontSize,
          color: segment.color ?? cmd.color ?? "#111111",
          fontWeight: segment.bold ? 700 : undefined,
          bbox: {
            x: cmd.x,
            y: cmd.y - (segment.fontSize ?? cmd.fontSize),
            width: this.estimateTextWidth(segment.text, segment.fontSize ?? cmd.fontSize),
            height: (segment.fontSize ?? cmd.fontSize) * 1.25,
          },
        })),
        bbox: {
          x: cmd.x,
          y: cmd.y - cmd.fontSize,
          width: cmd.fontSize,
          height: cmd.fontSize * 1.25,
        },
      };
      this.reflowTextSegments(element);
      this.elements.push(element);
      this.commit();

      const segmentChars = element.segments.map((segment) => Array.from(segment.text));
      const total = segmentChars.reduce((sum, chars) => sum + chars.length, 0);
      if (total === 0) {
        resolve();
        return;
      }
      const duration = this.durationFor(cmd.duration);
      const start = this.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        let remaining = Math.max(1, Math.ceil(t * total));
        const target = this.elements[elIndex];
        if (target && target.kind === "text_segments") {
          target.segments.forEach((segment, index) => {
            const chars = segmentChars[index] ?? [];
            const count = Math.min(chars.length, remaining);
            segment.visibleText = chars.slice(0, count).join("");
            remaining -= count;
          });
          this.commit();
        }
        if (t >= 1) {
          if (target && target.kind === "text_segments") {
            target.segments.forEach((segment) => {
              segment.visibleText = segment.text;
            });
            this.commit();
          }
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateMath(cmd: Extract<WhiteboardCommand, { type: "write_math" }>) {
    return new Promise<void>((resolve) => {
      const elIndex = this.elements.length;
      const bbox: ElementBBox = {
        x: cmd.x,
        y: cmd.y,
        width: this.estimateLatexWidth(cmd.latex, cmd.fontSize, cmd.displayMode ?? false),
        height: cmd.fontSize * (cmd.displayMode ? 1.9 : 1.45),
      };
      this.elements.push({
        kind: "math",
        id: cmd.id,
        latex: cmd.latex,
        x: cmd.x,
        y: cmd.y,
        fontSize: cmd.fontSize,
        color: cmd.color ?? "#111111",
        displayMode: cmd.displayMode ?? false,
        bbox,
        opacity: 0,
      });
      this.commit();

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const target = this.elements[elIndex];
        if (target && target.kind === "math") {
          target.opacity = t;
          this.commit();
        }
        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateMathSteps(
    cmd: Extract<WhiteboardCommand, { type: "write_math_steps" }>,
  ) {
    return new Promise<void>((resolve) => {
      const lineGap = cmd.lineGap ?? Math.round(cmd.fontSize * 1.65);
      const maxWidth = Math.max(
        ...cmd.steps.map((step) =>
          this.estimateLatexWidth(step, cmd.fontSize, cmd.displayMode ?? false),
        ),
      );
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "math_steps",
        id: cmd.id,
        steps: cmd.steps,
        visibleCount: 0,
        x: cmd.x,
        y: cmd.y,
        fontSize: cmd.fontSize,
        lineGap,
        color: cmd.color ?? "#111111",
        displayMode: cmd.displayMode ?? false,
        bbox: {
          x: cmd.x,
          y: cmd.y,
          width: maxWidth,
          height: lineGap * cmd.steps.length,
        },
      });
      this.commit();

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const total = cmd.steps.length;
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const target = this.elements[elIndex];
        if (target && target.kind === "math_steps") {
          target.visibleCount = Math.min(total, Math.max(1, Math.ceil(t * total)));
          this.commit();
        }
        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateDivisionLayout(
    cmd: Extract<WhiteboardCommand, { type: "write_division_layout" }>,
  ) {
    return new Promise<void>((resolve) => {
      const divisor = String(cmd.divisor);
      const dividend = String(cmd.dividend);
      const quotient = String(cmd.quotient);
      const remainder = String(cmd.remainder);
      const product = String(Number(cmd.divisor) * Number(cmd.quotient));
      const digitW = cmd.fontSize * 0.64;
      const bodyDigits = Math.max(dividend.length, product.length, remainder.length, quotient.length);
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "division_layout",
        id: cmd.id,
        dividend,
        divisor,
        quotient,
        product: Number.isFinite(Number(product)) ? product : "",
        remainder,
        x: cmd.x,
        y: cmd.y,
        fontSize: cmd.fontSize,
        color: cmd.color ?? "#111111",
        stage: 0,
        bbox: {
          x: cmd.x,
          y: cmd.y,
          width: digitW * (bodyDigits + divisor.length + 2.8),
          height: cmd.fontSize * 4.9,
        },
      });
      this.commit();

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const target = this.elements[elIndex];
        if (target && target.kind === "division_layout") {
          target.stage = Math.min(4, Math.max(1, Math.ceil(t * 4)));
          this.commit();
        }
        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateLine(
    cmd: Extract<WhiteboardCommand, { type: "draw_line" }> & {
      coordinateSystemId?: string;
    },
  ) {
    return new Promise<void>((resolve) => {
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "line",
        id: cmd.id,
        coordinateSystemId: cmd.coordinateSystemId,
        from: [cmd.from[0], cmd.from[1]],
        to: [cmd.to[0], cmd.to[1]],
        currentEnd: [cmd.from[0], cmd.from[1]], // start collapsed at origin
        color: cmd.color ?? "#111111",
        width: cmd.width ?? 2,
        bbox: {
          x: Math.min(cmd.from[0], cmd.to[0]),
          y: Math.min(cmd.from[1], cmd.to[1]),
          width: Math.abs(cmd.to[0] - cmd.from[0]),
          height: Math.abs(cmd.to[1] - cmd.from[1]),
        },
      });
      this.commit();

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const [x1, y1] = cmd.from;
      const [x2, y2] = cmd.to;

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        // Linear interpolation gives a smooth "hand drawing" feel.
        const cx = x1 + (x2 - x1) * t;
        const cy = y1 + (y2 - y1) * t;
        const target = this.elements[elIndex];
        if (target && target.kind === "line") {
          target.currentEnd = [cx, cy];
          this.commit();
        }
        if (t >= 1) {
          if (target && target.kind === "line") {
            target.currentEnd = [x2, y2];
            this.commit();
          }
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateArrow(
    cmd: Extract<WhiteboardCommand, { type: "draw_arrow" }>,
  ) {
    return new Promise<void>((resolve) => {
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "arrow",
        id: cmd.id,
        from: [cmd.from[0], cmd.from[1]],
        to: [cmd.to[0], cmd.to[1]],
        currentEnd: [cmd.from[0], cmd.from[1]],
        color: cmd.color ?? "#111111",
        width: cmd.width ?? 2,
        headSize: cmd.headSize ?? Math.max((cmd.width ?? 2) * 4, 12),
        headAngle: cmd.headAngle ?? 28,
        bbox: {
          x: Math.min(cmd.from[0], cmd.to[0]) - (cmd.headSize ?? 12),
          y: Math.min(cmd.from[1], cmd.to[1]) - (cmd.headSize ?? 12),
          width: Math.abs(cmd.to[0] - cmd.from[0]) + (cmd.headSize ?? 12) * 2,
          height: Math.abs(cmd.to[1] - cmd.from[1]) + (cmd.headSize ?? 12) * 2,
        },
      });
      this.commit();

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const [x1, y1] = cmd.from;
      const [x2, y2] = cmd.to;

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const cx = x1 + (x2 - x1) * t;
        const cy = y1 + (y2 - y1) * t;
        const target = this.elements[elIndex];
        if (target && target.kind === "arrow") {
          target.currentEnd = [cx, cy];
          this.commit();
        }
        if (t >= 1) {
          if (target && target.kind === "arrow") {
            target.currentEnd = [x2, y2];
            this.commit();
          }
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animatePath(cmd: Extract<WhiteboardCommand, { type: "draw_path" }>) {
    return new Promise<void>((resolve) => {
      const elIndex = this.elements.length;
      const points = cmd.points.map(([x, y]) => [x, y] as [number, number]);
      this.elements.push({
        kind: "path",
        id: cmd.id,
        points,
        currentPoints: [points[0]],
        color: cmd.color ?? "#111111",
        width: cmd.width ?? 2,
        bbox: {
          x: Math.min(...points.map(([x]) => x)),
          y: Math.min(...points.map(([, y]) => y)),
          width:
            Math.max(...points.map(([x]) => x)) - Math.min(...points.map(([x]) => x)),
          height:
            Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y)),
        },
      });
      this.commit();

      const segmentLengths: number[] = [];
      let totalLength = 0;
      for (let i = 1; i < points.length; i++) {
        const [x1, y1] = points[i - 1];
        const [x2, y2] = points[i];
        const length = Math.hypot(x2 - x1, y2 - y1);
        segmentLengths.push(length);
        totalLength += length;
      }

      if (totalLength === 0) {
        resolve();
        return;
      }

      const duration = this.durationFor(cmd.duration);
      const start = this.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }

        const t = Math.min((this.now() - start) / duration, 1);
        const targetLength = totalLength * t;
        let walked = 0;
        const visiblePoints: [number, number][] = [points[0]];

        for (let i = 1; i < points.length; i++) {
          const segmentLength = segmentLengths[i - 1];
          const nextWalked = walked + segmentLength;

          if (nextWalked <= targetLength) {
            visiblePoints.push(points[i]);
            walked = nextWalked;
            continue;
          }

          if (segmentLength > 0) {
            const localT = Math.max(
              0,
              Math.min((targetLength - walked) / segmentLength, 1),
            );
            const [x1, y1] = points[i - 1];
            const [x2, y2] = points[i];
            visiblePoints.push([
              x1 + (x2 - x1) * localT,
              y1 + (y2 - y1) * localT,
            ]);
          }
          break;
        }

        const target = this.elements[elIndex];
        if (target && target.kind === "path") {
          target.currentPoints = t >= 1 ? points : visiblePoints;
          this.commit();
        }

        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };

      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateShape(
    element: Extract<RenderedElement, { kind: "shape" }>,
    durationMs: number,
    update?: (progress: number) => void,
  ) {
    return new Promise<void>((resolve) => {
      const elIndex = this.elements.length;
      this.elements.push(element);
      this.commit();

      const duration = this.durationFor(durationMs);
      const start = this.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const target = this.elements[elIndex];
        if (target && target.kind === "shape") {
          target.progress = t;
          update?.(t);
          this.commit();
        }
        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };

      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateRectangle(
    cmd: Extract<WhiteboardCommand, { type: "draw_rectangle" }>,
  ) {
    const strokeWidth = cmd.strokeWidth ?? 2;
    return this.animateShape(
      {
        kind: "shape",
        id: cmd.id,
        shapeType: "rectangle",
        pathD: this.rectanglePath(cmd.x, cmd.y, cmd.width, cmd.height, cmd.radius ?? 0),
        color: cmd.color ?? "#111111",
        width: strokeWidth,
        fill: cmd.fill,
        fillOpacity: cmd.fillOpacity ?? 0.12,
        progress: 0,
        bbox: {
          x: cmd.x - strokeWidth / 2,
          y: cmd.y - strokeWidth / 2,
          width: cmd.width + strokeWidth,
          height: cmd.height + strokeWidth,
        },
      },
      cmd.duration,
    );
  }

  private animateTriangle(
    cmd: Extract<WhiteboardCommand, { type: "draw_triangle" }>,
  ) {
    const points = cmd.points;
    const strokeWidth = cmd.strokeWidth ?? 2;
    const pathD = `M ${points[0][0]} ${points[0][1]} L ${points[1][0]} ${points[1][1]} L ${points[2][0]} ${points[2][1]} Z`;
    return this.animateShape(
      {
        kind: "shape",
        id: cmd.id,
        shapeType: "triangle",
        pathD,
        color: cmd.color ?? "#111111",
        width: strokeWidth,
        fill: cmd.fill,
        fillOpacity: cmd.fillOpacity ?? 0.12,
        progress: 0,
        bbox: this.pathBBox(points, strokeWidth / 2),
      },
      cmd.duration,
    );
  }

  private animateCircle(cmd: Extract<WhiteboardCommand, { type: "draw_circle" }>) {
    const strokeWidth = cmd.strokeWidth ?? 2;
    return this.animateShape(
      {
        kind: "shape",
        id: cmd.id,
        shapeType: "circle",
        pathD: this.circlePath(cmd.cx, cmd.cy, cmd.radius),
        color: cmd.color ?? "#111111",
        width: strokeWidth,
        fill: cmd.fill,
        fillOpacity: cmd.fillOpacity ?? 0.12,
        progress: 0,
        bbox: {
          x: cmd.cx - cmd.radius - strokeWidth / 2,
          y: cmd.cy - cmd.radius - strokeWidth / 2,
          width: cmd.radius * 2 + strokeWidth,
          height: cmd.radius * 2 + strokeWidth,
        },
      },
      cmd.duration,
    );
  }

  private animateArcArrow(
    cmd: Extract<WhiteboardCommand, { type: "draw_arc_arrow" }>,
  ) {
    const clockwise = cmd.clockwise ?? true;
    const sweep = this.arcSweep(cmd.startAngle, cmd.endAngle, clockwise);
    const width = cmd.width ?? 3;
    const headSize = cmd.headSize ?? Math.max(width * 4, 12);
    const headAngle = cmd.headAngle ?? 28;
    const element: Extract<RenderedElement, { kind: "shape" }> = {
      kind: "shape",
      id: cmd.id,
      shapeType: "arc_arrow",
      pathD: this.arcPath(cmd.cx, cmd.cy, cmd.radius, cmd.startAngle, sweep),
      color: cmd.color ?? "#111111",
      width,
      progress: 0,
      bbox: {
        x: cmd.cx - cmd.radius - headSize,
        y: cmd.cy - cmd.radius - headSize,
        width: cmd.radius * 2 + headSize * 2,
        height: cmd.radius * 2 + headSize * 2,
      },
      arrowHead: {
        tip: this.angleToPoint(cmd.cx, cmd.cy, cmd.radius, cmd.startAngle),
        angle: 0,
        size: headSize,
        headAngle,
        visible: false,
      },
    };

    return this.animateShape(element, cmd.duration, (progress) => {
      const currentAngle = cmd.startAngle + sweep * progress;
      if (!element.arrowHead) return;
      element.arrowHead.tip = this.angleToPoint(cmd.cx, cmd.cy, cmd.radius, currentAngle);
      element.arrowHead.angle =
        ((currentAngle + (clockwise ? 90 : -90)) * Math.PI) / 180;
      element.arrowHead.visible = progress > 0.04;
    });
  }

  private animateBrace(cmd: Extract<WhiteboardCommand, { type: "draw_brace" }>) {
    return new Promise<void>((resolve) => {
      const vertical = cmd.orientation === "left" || cmd.orientation === "right";
      const minX = Math.min(cmd.from[0], cmd.to[0]);
      const maxX = Math.max(cmd.from[0], cmd.to[0]);
      const minY = Math.min(cmd.from[1], cmd.to[1]);
      const maxY = Math.max(cmd.from[1], cmd.to[1]);
      const span = Math.max(
        vertical ? maxY - minY : maxX - minX,
        24,
      );
      const depth = cmd.depth ?? Math.max(18, Math.min(span * 0.18, 54));
      const x = vertical
        ? (cmd.from[0] + cmd.to[0]) / 2
        : minX + (maxX - minX) / 2;
      const y = vertical
        ? minY + (maxY - minY) / 2
        : (cmd.from[1] + cmd.to[1]) / 2;
      const glyph: "{" | "}" =
        cmd.orientation === "right" || cmd.orientation === "down" ? "{" : "}";
      const rotation =
        cmd.orientation === "down" ? 90 : cmd.orientation === "up" ? -90 : 0;
      const fontSize = span * 1.08;
      const bbox = vertical
        ? {
            x: x - depth,
            y: minY,
            width: depth * 2,
            height: span,
          }
        : {
            x: minX,
            y: y - depth,
            width: span,
            height: depth * 2,
          };
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "brace_glyph",
        id: cmd.id,
        glyph,
        x,
        y,
        fontSize,
        color: cmd.color ?? "#111111",
        rotation,
        progress: 0,
        bbox,
      });
      this.commit();

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const target = this.elements[elIndex];
        if (target && target.kind === "brace_glyph") {
          target.progress = this.easeProgress(t, "easeOut");
          this.commit();
        }
        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private moveObject(cmd: Extract<WhiteboardCommand, { type: "move_object" }>) {
    return new Promise<void>((resolve, reject) => {
      const target = this.elements.find((el) => el.id === cmd.targetId);
      if (!target) {
        reject(new Error(`move_object 找不到目标对象: ${cmd.targetId}`));
        return;
      }

      const linkedTargets =
        target.kind === "coordinate_system"
          ? this.elements.filter(
              (el) =>
                ("coordinateSystemId" in el && el.coordinateSystemId === target.id) ||
                el.id === target.id,
            )
          : [target];
      const starts = linkedTargets.map((el) => ({
        el,
        x: el.transform?.translateX ?? 0,
        y: el.transform?.translateY ?? 0,
      }));
      const startX = target.transform?.translateX ?? 0;
      const startY = target.transform?.translateY ?? 0;
      let endX = startX;
      let endY = startY;

      if (cmd.by) {
        endX += cmd.by.dx;
        endY += cmd.by.dy;
      } else if (cmd.to) {
        const bbox = this.getBaseElementBBox(target);
        const anchorX = cmd.anchor === "center" ? bbox.x + bbox.width / 2 : bbox.x;
        const anchorY = cmd.anchor === "center" ? bbox.y + bbox.height / 2 : bbox.y;
        endX = cmd.to.x - anchorX;
        endY = cmd.to.y - anchorY;
      }

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const easing = cmd.easing ?? "easeInOut";

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const raw = Math.min((this.now() - start) / duration, 1);
        const t = this.easeProgress(raw, easing);
        for (const item of starts) {
          item.el.transform = {
            translateX: item.x + (endX - startX) * t,
            translateY: item.y + (endY - startY) * t,
          };
        }
        this.commit();
        if (raw >= 1) {
          for (const item of starts) {
            item.el.transform = {
              translateX: item.x + (endX - startX),
              translateY: item.y + (endY - startY),
            };
          }
          this.commit();
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };

      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateCoordinateSystem(
    cmd: Extract<WhiteboardCommand, { type: "draw_coordinate_system" }>,
  ) {
    return new Promise<void>((resolve) => {
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "coordinate_system",
        id: cmd.id,
        x: cmd.x,
        y: cmd.y,
        width: cmd.width,
        height: cmd.height,
        xMin: cmd.xMin,
        xMax: cmd.xMax,
        yMin: cmd.yMin,
        yMax: cmd.yMax,
        xTicks: this.buildTicks(cmd.xMin, cmd.xMax, cmd.xTickStep),
        yTicks: this.buildTicks(cmd.yMin, cmd.yMax, cmd.yTickStep),
        grid: cmd.grid ?? true,
        showLabels: cmd.showLabels ?? true,
        axisColor: cmd.axisColor ?? "#111111",
        gridColor: cmd.gridColor ?? "#e5e7eb",
        labelColor: cmd.labelColor ?? "#475569",
        fontSize: cmd.fontSize ?? 14,
        progress: 0,
        bbox: {
          x: cmd.x - 40,
          y: cmd.y - 20,
          width: cmd.width + 70,
          height: cmd.height + 50,
        },
      });
      this.commit();

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const target = this.elements[elIndex];
        if (target && target.kind === "coordinate_system") {
          target.progress = t;
          this.commit();
        }
        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateFunction(cmd: Extract<WhiteboardCommand, { type: "draw_function" }>) {
    const cs = this.findCoordinateSystem(cmd.coordinateSystemId);
    if (!cs) {
      return Promise.reject(
        new Error(`draw_function 找不到坐标系: ${cmd.coordinateSystemId}`),
      );
    }

    const xMin = cmd.xMin ?? cs.xMin;
    const xMax = cmd.xMax ?? cs.xMax;
    const samples = Math.max(8, Math.min(Math.round(cmd.samples ?? 180), 800));
    let pathD = "";
    let drawing = false;
    let hasPoint = false;

    for (let i = 0; i <= samples; i++) {
      const x = xMin + ((xMax - xMin) * i) / samples;
      const y = this.evaluateMathExpression(cmd.expression, x);
      const visible =
        Number.isFinite(y) &&
        y >= cs.yMin - (cs.yMax - cs.yMin) * 0.08 &&
        y <= cs.yMax + (cs.yMax - cs.yMin) * 0.08;
      if (!visible) {
        drawing = false;
        continue;
      }
      const [px, py] = this.mathToCanvas(cs, x, y);
      pathD += drawing ? ` L ${px} ${py}` : ` M ${px} ${py}`;
      drawing = true;
      hasPoint = true;
    }

    if (!hasPoint) {
      return Promise.reject(
        new Error(`draw_function 表达式在当前坐标范围内没有可见点: ${cmd.expression}`),
      );
    }

    return new Promise<void>((resolve) => {
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "function_graph",
        id: cmd.id,
        coordinateSystemId: cmd.coordinateSystemId,
        pathD,
        color: cmd.color ?? "#2563eb",
        width: cmd.width ?? 3,
        progress: 0,
        clip: { x: cs.x, y: cs.y, width: cs.width, height: cs.height },
        bbox: { x: cs.x, y: cs.y, width: cs.width, height: cs.height },
      });
      this.commit();

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const target = this.elements[elIndex];
        if (target && target.kind === "function_graph") {
          target.progress = t;
          this.commit();
        }
        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animatePlotPoint(cmd: Extract<WhiteboardCommand, { type: "plot_point" }>) {
    const cs = this.findCoordinateSystem(cmd.coordinateSystemId);
    if (!cs) {
      return Promise.reject(new Error(`plot_point 找不到坐标系: ${cmd.coordinateSystemId}`));
    }
    const [canvasX, canvasY] = this.mathToCanvas(cs, cmd.x, cmd.y);
    const radius = cmd.radius ?? 5;
    const fontSize = cmd.fontSize ?? 16;
    return new Promise<void>((resolve) => {
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "coordinate_point",
        id: cmd.id,
        coordinateSystemId: cmd.coordinateSystemId,
        x: cmd.x,
        y: cmd.y,
        canvasX,
        canvasY,
        label: cmd.label,
        color: cmd.color ?? "#ef4444",
        radius,
        fontSize,
        progress: 0,
        bbox: {
          x: canvasX - radius - 4,
          y: canvasY - radius - fontSize - 8,
          width: Math.max(radius * 2 + 8, (cmd.label?.length ?? 0) * fontSize * 0.55),
          height: radius * 2 + fontSize + 12,
        },
      });
      this.commit();

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const target = this.elements[elIndex];
        if (target && target.kind === "coordinate_point") {
          target.progress = t;
          this.commit();
        }
        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateCoordinateSegment(
    cmd: Extract<WhiteboardCommand, { type: "draw_coordinate_segment" }>,
  ) {
    const cs = this.findCoordinateSystem(cmd.coordinateSystemId);
    if (!cs) {
      return Promise.reject(
        new Error(`draw_coordinate_segment 找不到坐标系: ${cmd.coordinateSystemId}`),
      );
    }
    return this.animateLine({
      type: "draw_line",
      id: cmd.id,
      coordinateSystemId: cmd.coordinateSystemId,
      from: this.mathToCanvas(cs, cmd.from[0], cmd.from[1]),
      to: this.mathToCanvas(cs, cmd.to[0], cmd.to[1]),
      color: cmd.color ?? "#64748b",
      width: cmd.width ?? 2,
      duration: cmd.duration,
      narration: cmd.narration,
    });
  }

  private animateGeometryPoint(cmd: Extract<WhiteboardCommand, { type: "draw_point" }>) {
    return new Promise<void>((resolve) => {
      const radius = cmd.radius ?? 4;
      const fontSize = cmd.fontSize ?? 18;
      const labelPosition = cmd.labelPosition ?? "top";
      const labelWidth = this.estimateTextWidth(cmd.label ?? "", fontSize);
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "geometry_point",
        id: cmd.id,
        x: cmd.x,
        y: cmd.y,
        label: cmd.label,
        labelPosition,
        color: cmd.color ?? "#111111",
        radius,
        fontSize,
        progress: 0,
        bbox: {
          x: cmd.x - Math.max(radius + 8, labelWidth / 2),
          y: cmd.y - radius - fontSize - 14,
          width: Math.max(radius * 2 + 16, labelWidth + 16),
          height: radius * 2 + fontSize + 24,
        },
      });
      this.commit();

      const duration = this.durationFor(cmd.duration);
      const start = this.now();
      const tick = () => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / duration, 1);
        const target = this.elements[elIndex];
        if (target && target.kind === "geometry_point") {
          target.progress = this.easeProgress(t, "easeOut");
          this.commit();
        }
        if (t >= 1) resolve();
        else this.currentRaf = requestAnimationFrame(tick);
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private async animateGeometrySegment(cmd: Extract<WhiteboardCommand, { type: "draw_segment" }>) {
    await this.animateLine({
      type: "draw_line",
      id: cmd.id,
      from: cmd.from,
      to: cmd.to,
      color: cmd.color ?? "#111111",
      width: cmd.width ?? 2,
      duration: cmd.duration,
      narration: cmd.narration,
    });
    if (cmd.label) {
      const [x, y] = this.segmentLabelPoint(cmd.from, cmd.to, 18);
      await this.animateText({
        type: "write_text",
        id: `${cmd.id}_label`,
        text: cmd.label,
        x,
        y,
        fontSize: 16,
        color: cmd.color ?? "#111111",
        duration: 180,
      });
    }
  }

  private animateGeometryRay(cmd: Extract<WhiteboardCommand, { type: "draw_ray" }>) {
    const [ux, uy] = this.unitVector(cmd.from, cmd.through);
    const explicitLength = cmd.length ?? Math.hypot(cmd.through[0] - cmd.from[0], cmd.through[1] - cmd.from[1]) + 120;
    const length = Math.max(explicitLength, 20);
    const to: [number, number] = [cmd.from[0] + ux * length, cmd.from[1] + uy * length];
    return this.animateArrow({
      type: "draw_arrow",
      id: cmd.id,
      from: cmd.from,
      to,
      color: cmd.color ?? "#111111",
      width: cmd.width ?? 2,
      headSize: Math.max((cmd.width ?? 2) * 4, 10),
      headAngle: 26,
      duration: cmd.duration,
      narration: cmd.narration,
    });
  }

  private async animateGeometryAngle(cmd: Extract<WhiteboardCommand, { type: "draw_angle" }>) {
    const radius = cmd.radius ?? 34;
    const { pathD, midAngle } = this.anglePath(cmd.vertex, cmd.from, cmd.to, radius);
    await this.animateShape(
      {
        kind: "shape",
        id: cmd.id,
        shapeType: "angle",
        pathD,
        color: cmd.color ?? "#2563eb",
        width: cmd.width ?? 3,
        progress: 0,
        bbox: {
          x: cmd.vertex[0] - radius - 8,
          y: cmd.vertex[1] - radius - 8,
          width: radius * 2 + 16,
          height: radius * 2 + 16,
        },
      },
      cmd.duration,
    );
    if (cmd.label) {
      const labelRadius = radius + (cmd.fontSize ?? 18) * 0.9;
      await this.animateText({
        type: "write_text",
        id: `${cmd.id}_label`,
        text: cmd.label,
        x: cmd.vertex[0] + Math.cos(midAngle) * labelRadius,
        y: cmd.vertex[1] + Math.sin(midAngle) * labelRadius,
        fontSize: cmd.fontSize ?? 18,
        color: cmd.color ?? "#2563eb",
        duration: 160,
      });
    }
  }

  private equalSegmentPath(
    segments: Array<{ from: [number, number]; to: [number, number] }>,
    tickCount: number,
    size: number,
  ) {
    const commands: string[] = [];
    const allPoints: [number, number][] = [];
    for (const segment of segments) {
      const [nx, ny] = this.normalVector(segment.from, segment.to);
      const mid: [number, number] = [
        (segment.from[0] + segment.to[0]) / 2,
        (segment.from[1] + segment.to[1]) / 2,
      ];
      const [ux, uy] = this.unitVector(segment.from, segment.to);
      const spacing = size * 0.55;
      for (let i = 0; i < tickCount; i++) {
        const offset = (i - (tickCount - 1) / 2) * spacing;
        const cx = mid[0] + ux * offset;
        const cy = mid[1] + uy * offset;
        const p1: [number, number] = [cx - nx * size * 0.5, cy - ny * size * 0.5];
        const p2: [number, number] = [cx + nx * size * 0.5, cy + ny * size * 0.5];
        commands.push(`M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]}`);
        allPoints.push(p1, p2);
      }
    }
    return { pathD: commands.join(" "), bbox: this.geometryMarkBBox(allPoints, size) };
  }

  private parallelMarkPath(
    segments: Array<{ from: [number, number]; to: [number, number] }>,
    markCount: number,
    size: number,
  ) {
    const commands: string[] = [];
    const allPoints: [number, number][] = [];
    for (const segment of segments) {
      const [ux, uy] = this.unitVector(segment.from, segment.to);
      const [nx, ny] = this.normalVector(segment.from, segment.to);
      const mid: [number, number] = [
        (segment.from[0] + segment.to[0]) / 2,
        (segment.from[1] + segment.to[1]) / 2,
      ];
      const spacing = size * 0.55;
      for (let i = 0; i < markCount; i++) {
        const offset = (i - (markCount - 1) / 2) * spacing;
        const cx = mid[0] + ux * offset;
        const cy = mid[1] + uy * offset;
        const p1: [number, number] = [
          cx - ux * size * 0.38 - nx * size * 0.45,
          cy - uy * size * 0.38 - ny * size * 0.45,
        ];
        const p2: [number, number] = [
          cx + ux * size * 0.38 + nx * size * 0.45,
          cy + uy * size * 0.38 + ny * size * 0.45,
        ];
        commands.push(`M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]}`);
        allPoints.push(p1, p2);
      }
    }
    return { pathD: commands.join(" "), bbox: this.geometryMarkBBox(allPoints, size) };
  }

  private animateEqualSegmentMarks(
    cmd: Extract<WhiteboardCommand, { type: "mark_equal_segments" }>,
  ) {
    const { pathD, bbox } = this.equalSegmentPath(
      cmd.segments,
      Math.max(1, Math.round(cmd.tickCount ?? 1)),
      cmd.size ?? 12,
    );
    return this.animateShape(
      {
        kind: "shape",
        id: cmd.id,
        shapeType: "geometry_mark",
        pathD,
        color: cmd.color ?? "#ef4444",
        width: cmd.width ?? 2,
        progress: 0,
        bbox,
      },
      cmd.duration,
    );
  }

  private animateParallelMarks(cmd: Extract<WhiteboardCommand, { type: "mark_parallel" }>) {
    const { pathD, bbox } = this.parallelMarkPath(
      cmd.segments,
      Math.max(1, Math.round(cmd.markCount ?? 1)),
      cmd.size ?? 14,
    );
    return this.animateShape(
      {
        kind: "shape",
        id: cmd.id,
        shapeType: "geometry_mark",
        pathD,
        color: cmd.color ?? "#7c3aed",
        width: cmd.width ?? 2,
        progress: 0,
        bbox,
      },
      cmd.duration,
    );
  }

  private animatePerpendicularMark(
    cmd: Extract<WhiteboardCommand, { type: "mark_perpendicular" }>,
  ) {
    const size = cmd.size ?? 20;
    const [u1x, u1y] = this.unitVector(cmd.vertex, cmd.point1);
    const [u2x, u2y] = this.unitVector(cmd.vertex, cmd.point2);
    const p1: [number, number] = [cmd.vertex[0] + u1x * size, cmd.vertex[1] + u1y * size];
    const corner: [number, number] = [p1[0] + u2x * size, p1[1] + u2y * size];
    const p2: [number, number] = [cmd.vertex[0] + u2x * size, cmd.vertex[1] + u2y * size];
    return this.animateShape(
      {
        kind: "shape",
        id: cmd.id,
        shapeType: "geometry_mark",
        pathD: `M ${p1[0]} ${p1[1]} L ${corner[0]} ${corner[1]} L ${p2[0]} ${p2[1]}`,
        color: cmd.color ?? "#2563eb",
        width: cmd.width ?? 2,
        progress: 0,
        bbox: this.geometryMarkBBox([cmd.vertex, p1, corner, p2], size * 0.2),
      },
      cmd.duration,
    );
  }

  private animateHighlightPolygon(
    cmd: Extract<WhiteboardCommand, { type: "highlight_polygon" }>,
  ) {
    const pathD = [
      `M ${cmd.points[0][0]} ${cmd.points[0][1]}`,
      ...cmd.points.slice(1).map(([x, y]) => `L ${x} ${y}`),
      "Z",
    ].join(" ");
    const strokeWidth = cmd.strokeWidth ?? 2;
    return this.animateShape(
      {
        kind: "shape",
        id: cmd.id,
        shapeType: "highlight_polygon",
        pathD,
        color: cmd.color ?? "#16a34a",
        width: strokeWidth,
        fill: cmd.fill ?? "#bbf7d0",
        fillOpacity: cmd.fillOpacity ?? 0.24,
        progress: 0,
        bbox: this.pathBBox(cmd.points, strokeWidth / 2),
      },
      cmd.duration,
    );
  }

  private async constructGeometry(
    cmd: Extract<WhiteboardCommand, { type: "construct_geometry" }>,
  ) {
    void warmupJsxGraphGeometryEngine();
    const commands = expandConstructGeometryCommand(cmd);
    for (const command of commands) {
      if (this.cancelled) return;
      await this.runCommand(command);
    }
  }

  private async eraseObject(
    cmd: Extract<WhiteboardCommand, { type: "erase_object" }>,
  ) {
    const targetIds = new Set(cmd.targetIds ?? []);
    this.elements = this.elements.filter((el) => !targetIds.has(el.id));
    this.commit();
    await this.wait(cmd.duration ?? 300);
  }

  private async eraseArea(
    cmd: Extract<WhiteboardCommand, { type: "erase_area" }>,
  ) {
    const shape = cmd.shape ?? "rect";
    this.elements.push({
      kind: "eraser",
      id: cmd.id,
      shape,
      x: cmd.x,
      y: cmd.y,
      width: cmd.width ?? 0,
      height: cmd.height ?? 0,
      radius: cmd.radius ?? 0,
      color: this.canvas.background,
      bbox:
        shape === "circle"
          ? {
              x: cmd.x - (cmd.radius ?? 0),
              y: cmd.y - (cmd.radius ?? 0),
              width: (cmd.radius ?? 0) * 2,
              height: (cmd.radius ?? 0) * 2,
            }
          : {
              x: cmd.x,
              y: cmd.y,
              width: cmd.width ?? 0,
              height: cmd.height ?? 0,
            },
    });
    this.commit();
    await this.wait(cmd.duration ?? 300);
  }

  private async clearCanvas(
    cmd: Extract<WhiteboardCommand, { type: "clear_canvas" }>,
  ) {
    this.elements = [];
    this.annotations = [];
    if (cmd.background) {
      this.canvas = { ...this.canvas, background: cmd.background };
      this.cb.onCanvasChange(this.canvas);
    }
    this.commit();
    this.commitAnnotations();
    await this.wait(cmd.duration ?? 300);
  }

  private waitForUser(cmd: Extract<WhiteboardCommand, { type: "wait" }>) {
    return new Promise<void>((resolve) => {
      if (this.cancelled) {
        resolve();
        return;
      }
      this.cb.onWaitChange({
        message: cmd.message ?? "点击“下一步”继续讲解。",
      });
      this.waitResolver = resolve;
    });
  }

  // ── Annotation layer ────────────────────────────────────────────────────────

  private seededRandom(seed: string): () => number {
    let state = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      state ^= seed.charCodeAt(i);
      state = Math.imul(state, 16777619);
    }
    state >>>= 0;
    return () => {
      state = Math.imul(state + 0x6d2b79f5, 1);
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Generate a hand-drawn underline path: straight line from (x1,y1) to (x2,y2)
   * with small perpendicular wobble, giving a natural pen-on-paper feel.
   */
  private generateHandDrawnLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    seed: string,
  ): [number, number][] {
    const rng = this.seededRandom(seed);
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) return [[x1, y1]];

    // One control point roughly every 20px; at least 6 for smooth feel
    const numSegments = Math.max(6, Math.round(len / 20));
    const dx = x2 - x1;
    const dy = y2 - y1;
    const invLen = 1 / len;
    // Perpendicular unit vector (rotated 90°)
    const nx = -dy * invLen;
    const ny = dx * invLen;

    const points: [number, number][] = [];
    for (let i = 0; i <= numSegments; i++) {
      const t = i / numSegments;
      const baseX = x1 + dx * t;
      const baseY = y1 + dy * t;
      // Perpendicular wobble: ±2 px, tapers to near-zero at endpoints
      const taper = Math.sin(t * Math.PI); // 0 at ends, 1 in the middle
      const wobble = (rng() - 0.5) * 4 * taper;
      points.push([baseX + nx * wobble, baseY + ny * wobble]);
    }
    return points;
  }

  private generateSmoothCirclePoints({
    cx,
    cy,
    rx,
    ry,
    seed,
    pointCount = 16,
    distortion = 0.025,
  }: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    seed: string;
    pointCount?: number;
    distortion?: number;
  }): [number, number][] {
    const rng = this.seededRandom(seed);
    const count = Math.max(12, Math.min(Math.round(pointCount), 18));
    const amount = Math.max(0.015, Math.min(distortion, 0.04));
    const phase = rng() * Math.PI * 2;
    const harmonicA = 2 + Math.floor(rng() * 3);
    const harmonicB = harmonicA + 1;

    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      const smoothNoise =
        Math.sin(angle * harmonicA + phase) * 0.55 +
        Math.cos(angle * harmonicB - phase * 0.7) * 0.45;
      const radial = 1 + smoothNoise * amount;
      return [
        cx + rx * radial * Math.cos(angle),
        cy + ry * radial * Math.sin(angle),
      ];
    });
  }

  private catmullRomClosedPath(points: [number, number][]) {
    if (points.length === 0) return "";
    if (points.length === 1) return `M ${points[0][0]} ${points[0][1]} Z`;

    const commands = [`M ${points[0][0]} ${points[0][1]}`];
    const count = points.length;
    for (let i = 0; i < count; i++) {
      const p0 = points[(i - 1 + count) % count];
      const p1 = points[i];
      const p2 = points[(i + 1) % count];
      const p3 = points[(i + 2) % count];
      const c1: [number, number] = [
        p1[0] + (p2[0] - p0[0]) / 6,
        p1[1] + (p2[1] - p0[1]) / 6,
      ];
      const c2: [number, number] = [
        p2[0] - (p3[0] - p1[0]) / 6,
        p2[1] - (p3[1] - p1[1]) / 6,
      ];
      commands.push(`C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`);
    }
    commands.push("Z");
    return commands.join(" ");
  }

  private estimateClosedPathLength(points: [number, number][]) {
    if (points.length < 2) return 0;
    let length = 0;
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      length += Math.hypot(x2 - x1, y2 - y1);
    }
    return length;
  }

  /**
   * Shared path-based animation for annotation elements.
   * Identical walk algorithm to animatePath so the reveal feels consistent.
   */
  private animateAnnotationPath(
    id: string,
    points: [number, number][],
    color: string,
    width: number,
    duration: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const annIndex = this.annotations.length;
      this.annotations.push({
        kind: "annotation",
        id,
        points,
        currentPoints: [points[0]],
        color,
        width,
      });
      this.commitAnnotations();

      const segmentLengths: number[] = [];
      let totalLength = 0;
      for (let i = 1; i < points.length; i++) {
        const [x1, y1] = points[i - 1];
        const [x2, y2] = points[i];
        const l = Math.hypot(x2 - x1, y2 - y1);
        segmentLengths.push(l);
        totalLength += l;
      }

      if (totalLength === 0) {
        resolve();
        return;
      }

      const dur = this.durationFor(duration);
      const start = this.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / dur, 1);
        const targetLen = totalLength * t;
        let walked = 0;
        const visible: [number, number][] = [points[0]];

        for (let i = 1; i < points.length; i++) {
          const seg = segmentLengths[i - 1];
          const next = walked + seg;
          if (next <= targetLen) {
            visible.push(points[i]);
            walked = next;
            continue;
          }
          if (seg > 0) {
            const localT = Math.max(0, Math.min((targetLen - walked) / seg, 1));
            const [x1, y1] = points[i - 1];
            const [x2, y2] = points[i];
            visible.push([x1 + (x2 - x1) * localT, y1 + (y2 - y1) * localT]);
          }
          break;
        }

        const target = this.annotations[annIndex];
        if (target && target.kind === "annotation") {
          target.currentPoints = t >= 1 ? points : visible;
          this.commitAnnotations();
        }

        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };

      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateClosedAnnotationPath(
    id: string,
    points: [number, number][],
    color: string,
    width: number,
    duration: number,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const annIndex = this.annotations.length;
      const pathD = this.catmullRomClosedPath(points);
      const pathLength = Math.max(this.estimateClosedPathLength(points) * 1.15, 1);
      this.annotations.push({
        kind: "annotation",
        id,
        points,
        currentPoints: points,
        pathD,
        strokeDasharray: pathLength,
        strokeDashoffset: pathLength,
        color,
        width,
      });
      this.commitAnnotations();

      const dur = this.durationFor(duration);
      const start = this.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / dur, 1);
        const target = this.annotations[annIndex];
        if (target && target.kind === "annotation") {
          target.strokeDashoffset = pathLength * (1 - t);
          this.commitAnnotations();
        }

        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };

      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateAnnotateUnderline(
    cmd: Extract<WhiteboardCommand, { type: "annotate_underline" }>,
  ) {
    const points = this.generateHandDrawnLine(
      cmd.x1,
      cmd.y1,
      cmd.x2,
      cmd.y2,
      cmd.id,
    );
    return this.animateAnnotationPath(
      cmd.id,
      points,
      cmd.color ?? "#f59e0b",
      cmd.width ?? 4,
      cmd.duration,
    );
  }

  private animateAnnotateCircle(
    cmd: Extract<WhiteboardCommand, { type: "annotate_circle" }>,
  ) {
    const points = this.generateSmoothCirclePoints({
      cx: cmd.cx,
      cy: cmd.cy,
      rx: cmd.rx,
      ry: cmd.ry,
      seed: cmd.id,
      pointCount: 16,
      distortion: 0.025,
    });
    return this.animateClosedAnnotationPath(
      cmd.id,
      points,
      cmd.color ?? "#ef4444",
      cmd.width ?? 3,
      cmd.duration,
    );
  }

  private annotateBBox({
    id,
    bbox,
    style,
    padding,
    color,
    width,
    duration,
  }: {
    id: string;
    bbox: ElementBBox;
    style?: "circle" | "underline";
    padding: number;
    color: string;
    width: number;
    duration: number;
  }) {
    const expanded = this.expandBBox(bbox, padding);
    if (style === "underline") {
      const y = expanded.y + expanded.height + Math.max(width * 2, 4);
      const points = this.generateHandDrawnLine(
        expanded.x,
        y,
        expanded.x + expanded.width,
        y,
        id,
      );
      return this.animateAnnotationPath(id, points, color, width, duration);
    }

    const points = this.generateSmoothCirclePoints({
      cx: expanded.x + expanded.width / 2,
      cy: expanded.y + expanded.height / 2,
      rx: Math.max(expanded.width / 2, 8),
      ry: Math.max(expanded.height / 2, 8),
      seed: id,
      pointCount: 16,
      distortion: 0.022,
    });
    return this.animateClosedAnnotationPath(id, points, color, width, duration);
  }

  private animateAnnotateObject(
    cmd: Extract<WhiteboardCommand, { type: "annotate_object" }>,
  ) {
    const target = this.elements.find((el) => el.id === cmd.targetId);
    if (!target) {
      return Promise.reject(new Error(`annotate_object 找不到目标对象: ${cmd.targetId}`));
    }
    return this.annotateBBox({
      id: cmd.id,
      bbox: this.getElementBBox(target),
      style: cmd.style ?? "circle",
      padding: cmd.padding ?? 8,
      color: cmd.color ?? "#ef4444",
      width: cmd.width ?? 3,
      duration: cmd.duration,
    });
  }

  private animateAnnotateMathBbox(
    cmd: Extract<WhiteboardCommand, { type: "annotate_math_bbox" }>,
  ) {
    const target = this.elements.find((el) => el.id === cmd.targetId);
    if (!target) {
      return Promise.reject(new Error(`annotate_math_bbox 找不到目标对象: ${cmd.targetId}`));
    }
    return this.annotateBBox({
      id: cmd.id,
      bbox: cmd.bbox,
      style: cmd.style ?? "circle",
      padding: cmd.padding ?? 6,
      color: cmd.color ?? "#ef4444",
      width: cmd.width ?? 3,
      duration: cmd.duration,
    });
  }

  private animateEmphasisDots(
    id: string,
    bbox: ElementBBox,
    text: string,
    color: string,
    width: number,
    duration: number,
  ) {
    return new Promise<void>((resolve) => {
      const chars = Math.max(1, Array.from(text).filter((char) => char.trim()).length);
      const layoutCount = Math.max(1, Math.floor(bbox.width / Math.max(bbox.height * 0.45, 10)));
      const count = chars <= 8 ? chars : Math.min(chars, layoutCount);
      const radius = Math.max(1.4, Math.min(width, bbox.height * 0.08));
      const y = bbox.y + bbox.height + radius * 2.4;
      const dots = Array.from({ length: count }, (_, index) => ({
        cx: bbox.x + (bbox.width * (index + 0.5)) / count,
        cy: y,
        r: radius,
      }));
      const annIndex = this.annotations.length;
      this.annotations.push({
        kind: "emphasis_dots",
        id,
        dots,
        visibleCount: 0,
        color,
      });
      this.commitAnnotations();

      const runDuration = this.durationFor(duration);
      const start = this.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / runDuration, 1);
        const target = this.annotations[annIndex];
        if (target && target.kind === "emphasis_dots") {
          target.visibleCount = Math.ceil(t * dots.length);
          this.commitAnnotations();
        }
        if (t >= 1) {
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private animateLaserPointer(
    cmd: Extract<WhiteboardCommand, { type: "laser_pointer" }>,
  ) {
    return new Promise<void>((resolve) => {
      const route = this.buildLaserRoute(cmd);
      const [startX, startY] = route[0];
      const annIndex = this.annotations.length;
      this.annotations.push({
        kind: "laser_pointer",
        id: cmd.id,
        x: startX,
        y: startY,
        style: cmd.style ?? "pulse",
        color: cmd.color ?? "#ef4444",
        radius: cmd.radius ?? 10,
        progress: 0,
        opacity: 0,
        trail: [],
      });
      this.commitAnnotations();

      const runDuration = this.durationFor(cmd.duration);
      const start = this.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((this.now() - start) / runDuration, 1);
        const target = this.annotations[annIndex];
        if (target && target.kind === "laser_pointer") {
          const moveT = route.length > 1 ? this.easeProgress(t, "easeInOut") : 0;
          const [x, y] = this.interpolateCatmullRomOpen(route, moveT);
          target.progress = t;
          target.x = x;
          target.y = y;
          target.opacity = route.length > 1 ? Math.min(1, Math.sin(Math.PI * t) * 1.15) : Math.sin(Math.PI * t);
          if (cmd.trail !== false && route.length > 1) {
            const history = [...target.trail, { x, y }];
            target.trail = history.slice(-8).map((point, index, arr) => ({
              x: point.x,
              y: point.y,
              opacity: ((index + 1) / arr.length) * 0.34,
              radius: target.radius * (0.28 + (index + 1) / arr.length * 0.42),
            }));
          }
          this.commitAnnotations();
        }
        if (t >= 1) {
          const targetNow = this.annotations[annIndex];
          if (targetNow?.kind === "laser_pointer" && targetNow.id === cmd.id) {
            this.annotations.splice(annIndex, 1);
          } else {
            this.annotations = this.annotations.filter(
              (ann) => !(ann.kind === "laser_pointer" && ann.id === cmd.id),
            );
          }
          this.commitAnnotations();
          resolve();
        } else {
          this.currentRaf = requestAnimationFrame(tick);
        }
      };
      this.currentRaf = requestAnimationFrame(tick);
    });
  }

  private async emphasizeText(
    cmd: Extract<WhiteboardCommand, { type: "emphasize_text" }>,
  ) {
    const target = this.resolveTextTarget(cmd.targetId, cmd.segmentId);
    if (!target) {
      return Promise.reject(
        new Error(
          `emphasize_text 找不到目标文字: ${cmd.targetId}${cmd.segmentId ? `.${cmd.segmentId}` : ""}`,
        ),
      );
    }

    if (cmd.style === "underline") {
      return this.annotateBBox({
        id: cmd.id,
        bbox: target.bbox,
        style: "underline",
        padding: cmd.padding ?? 2,
        color: cmd.color ?? "#2563eb",
        width: cmd.width ?? (target.bbox.height < 32 ? 2 : 3),
        duration: cmd.duration,
      });
    }

    if (cmd.style === "dot") {
      return this.animateEmphasisDots(
        cmd.id,
        this.expandBBox(target.bbox, cmd.padding ?? 0),
        target.text,
        cmd.color ?? "#2563eb",
        cmd.width ?? (target.bbox.height < 32 ? 2 : 3),
        cmd.duration,
      );
    }

    if (target.element.kind === "text_segments" && target.segment) {
      if (cmd.style === "bold") target.segment.fontWeight = 700;
      if (cmd.style === "color") target.segment.color = cmd.color ?? "#2563eb";
      if (cmd.style === "font_size" && cmd.fontSize) {
        target.segment.fontSize = cmd.fontSize;
        this.reflowTextSegments(target.element);
      }
      this.commit();
      await this.wait(cmd.duration);
      return;
    }

    if (target.element.kind === "text") {
      if (cmd.style === "bold") target.element.fontWeight = 700;
      if (cmd.style === "color") target.element.color = cmd.color ?? "#2563eb";
      if (cmd.style === "font_size" && cmd.fontSize) {
        target.element.fontSize = cmd.fontSize;
        target.element.bbox = {
          x: target.element.x,
          y: target.element.y - cmd.fontSize,
          width: this.estimateTextWidth(target.element.text, cmd.fontSize),
          height: cmd.fontSize * 1.25,
        };
      }
      this.commit();
      await this.wait(cmd.duration);
      return;
    }

    await this.wait(cmd.duration);
  }

  private async clearAnnotations(
    cmd: Extract<WhiteboardCommand, { type: "clear_annotations" }>,
  ) {
    this.annotations = [];
    this.commitAnnotations();
    await this.wait(cmd.duration ?? 300);
  }
}
