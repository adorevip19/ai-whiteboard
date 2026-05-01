// ScriptRunner: executes a validated WhiteboardScript step-by-step,
// animating each command using requestAnimationFrame. Calls listener
// callbacks so React state stays in sync.
import type {
  AnnotationElement,
  CanvasConfig,
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
          cmd.type === "draw_line" ||
          cmd.type === "draw_arrow" ||
          cmd.type === "draw_path" ||
          cmd.type === "erase_object" ||
          cmd.type === "erase_area" ||
          cmd.type === "clear_canvas" ||
          cmd.type === "wait" ||
          cmd.type === "annotate_underline" ||
          cmd.type === "annotate_circle" ||
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
    if (cmd.type === "draw_line") {
      return this.animateLine(cmd);
    }
    if (cmd.type === "draw_arrow") {
      return this.animateArrow(cmd);
    }
    if (cmd.type === "draw_path") {
      return this.animatePath(cmd);
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

  private async clearAnnotations(
    cmd: Extract<WhiteboardCommand, { type: "clear_annotations" }>,
  ) {
    this.annotations = [];
    this.commitAnnotations();
    await this.wait(cmd.duration ?? 300);
  }
}
