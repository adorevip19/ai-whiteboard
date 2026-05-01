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

  constructor(script: WhiteboardScript, cb: RunnerCallbacks, options: RunnerOptions = {}) {
    this.script = script;
    this.cb = cb;
    this.canvas = script.canvas;
    this.playbackSpeed = this.normalizePlaybackSpeed(options.playbackSpeed);
  }

  cancel() {
    this.cancelled = true;
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

  async run() {
    try {
      // Reset
      this.elements = [];
      this.annotations = [];
      this.canvas = this.script.canvas;
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
          cmd.type === "erase_object" ||
          cmd.type === "erase_area" ||
          cmd.type === "clear_canvas" ||
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
    this.cb.onElementsChange([...this.elements]);
  }

  private commitAnnotations() {
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
      window.setTimeout(resolve, this.durationFor(duration));
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
    for (const segment of el.segments) {
      const width = this.estimateTextWidth(segment.text, segment.fontSize);
      segment.x = cursorX;
      segment.y = el.y;
      segment.bbox = {
        x: cursorX,
        y: el.y - segment.fontSize,
        width,
        height: segment.fontSize * 1.25,
      };
      cursorX += width;
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
    if ("bbox" in el) return el.bbox;
    return { x: 0, y: 0, width: 0, height: 0 };
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
      const q = h / 4;
      const d = Math.max(depth, 1);
      return [
        `M ${x} ${topY}`,
        `C ${x + sign * d} ${topY} ${x + sign * d} ${topY + q * 0.45} ${x + sign * d * 0.45} ${topY + q}`,
        `C ${x + sign * d * 0.12} ${topY + q * 1.45} ${x + sign * d * 0.12} ${midY - q * 0.35} ${x} ${midY}`,
        `C ${x + sign * d * 0.12} ${midY + q * 0.35} ${x + sign * d * 0.12} ${bottomY - q * 1.45} ${x + sign * d * 0.45} ${bottomY - q}`,
        `C ${x + sign * d} ${bottomY - q * 0.45} ${x + sign * d} ${bottomY} ${x} ${bottomY}`,
      ].join(" ");
    }

    const sign = orientation === "down" ? 1 : -1;
    const leftX = Math.min(x1, x2);
    const rightX = Math.max(x1, x2);
    const y = (y1 + y2) / 2;
    const w = Math.max(rightX - leftX, 1);
    const midX = leftX + w / 2;
    const q = w / 4;
    const d = Math.max(depth, 1);
    return [
      `M ${leftX} ${y}`,
      `C ${leftX} ${y + sign * d} ${leftX + q * 0.45} ${y + sign * d} ${leftX + q} ${y + sign * d * 0.45}`,
      `C ${leftX + q * 1.45} ${y + sign * d * 0.12} ${midX - q * 0.35} ${y + sign * d * 0.12} ${midX} ${y}`,
      `C ${midX + q * 0.35} ${y + sign * d * 0.12} ${rightX - q * 1.45} ${y + sign * d * 0.12} ${rightX - q} ${y + sign * d * 0.45}`,
      `C ${rightX - q * 0.45} ${y + sign * d} ${rightX} ${y + sign * d} ${rightX} ${y}`,
    ].join(" ");
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
    if (cmd.type === "erase_object") {
      return this.eraseObject(cmd);
    }
    if (cmd.type === "erase_area") {
      return this.eraseArea(cmd);
    }
    if (cmd.type === "clear_canvas") {
      return this.clearCanvas(cmd);
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
      const start = performance.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / duration, 1);
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
      const start = performance.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / duration, 1);
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
      const start = performance.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / duration, 1);
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
      const start = performance.now();
      const total = cmd.steps.length;
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / duration, 1);
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
      const start = performance.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / duration, 1);
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

  private animateLine(cmd: Extract<WhiteboardCommand, { type: "draw_line" }>) {
    return new Promise<void>((resolve) => {
      const elIndex = this.elements.length;
      this.elements.push({
        kind: "line",
        id: cmd.id,
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
      const start = performance.now();
      const [x1, y1] = cmd.from;
      const [x2, y2] = cmd.to;

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / duration, 1);
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
      const start = performance.now();
      const [x1, y1] = cmd.from;
      const [x2, y2] = cmd.to;

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / duration, 1);
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
      const start = performance.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }

        const t = Math.min((now - start) / duration, 1);
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
      const start = performance.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / duration, 1);
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
    const width = cmd.width ?? 3;
    const depth =
      cmd.depth ??
      Math.max(
        18,
        Math.min(Math.hypot(cmd.to[0] - cmd.from[0], cmd.to[1] - cmd.from[1]) * 0.16, 48),
      );
    const pathD = this.bracePath(cmd.from, cmd.to, cmd.orientation, depth);
    const bbox =
      cmd.orientation === "left" || cmd.orientation === "right"
        ? this.pathBBox([cmd.from, cmd.to], depth + width)
        : this.pathBBox([cmd.from, cmd.to], depth + width);
    return this.animateShape(
      {
        kind: "shape",
        id: cmd.id,
        shapeType: "brace",
        pathD,
        color: cmd.color ?? "#111111",
        width,
        progress: 0,
        bbox,
      },
      cmd.duration,
    );
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
      const start = performance.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / dur, 1);
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
      const start = performance.now();

      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / dur, 1);
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
      const start = performance.now();
      const tick = (now: number) => {
        if (this.cancelled) {
          resolve();
          return;
        }
        const t = Math.min((now - start) / runDuration, 1);
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
