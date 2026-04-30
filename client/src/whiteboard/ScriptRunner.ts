// ScriptRunner: executes a validated WhiteboardScript step-by-step,
// animating each command using requestAnimationFrame. Calls listener
// callbacks so React state stays in sync.
import type {
  CanvasConfig,
  RenderedElement,
  WhiteboardCommand,
  WhiteboardScript,
} from "./commandTypes";

export interface RunnerCallbacks {
  onCanvasChange: (canvas: CanvasConfig) => void;
  onElementsChange: (elements: RenderedElement[]) => void;
  onStepChange: (currentIndex: number, total: number) => void;
  // Push the full narration string for the upcoming command. The UI is
  // responsible for animating its appearance (typewriter). null clears it.
  onNarrationChange: (narration: string | null) => void;
  onComplete: () => void;
  onError: (message: string) => void;
}

export class ScriptRunner {
  private script: WhiteboardScript;
  private cb: RunnerCallbacks;
  private cancelled = false;
  private currentRaf: number | null = null;
  private elements: RenderedElement[] = [];

  constructor(script: WhiteboardScript, cb: RunnerCallbacks) {
    this.script = script;
    this.cb = cb;
  }

  cancel() {
    this.cancelled = true;
    if (this.currentRaf !== null) {
      cancelAnimationFrame(this.currentRaf);
      this.currentRaf = null;
    }
  }

  async run() {
    try {
      // Reset
      this.elements = [];
      this.cb.onCanvasChange(this.script.canvas);
      this.cb.onElementsChange([]);

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
          cmd.type === "draw_path"
            ? (cmd.narration ?? null)
            : null;
        // Always push (even null) so the bar updates between steps.
        this.cb.onNarrationChange(narration);
        await this.runCommand(cmd);
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

  private runCommand(cmd: WhiteboardCommand): Promise<void> {
    if (cmd.type === "set_canvas") {
      this.cb.onCanvasChange({
        width: cmd.width,
        height: cmd.height,
        background: cmd.background ?? "#ffffff",
      });
      return Promise.resolve();
    }
    if (cmd.type === "write_text") {
      return this.animateText(cmd);
    }
    if (cmd.type === "draw_line") {
      return this.animateLine(cmd);
    }
    if (cmd.type === "draw_path") {
      return this.animatePath(cmd);
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
      const duration = Math.max(cmd.duration, 1);
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

      const duration = Math.max(cmd.duration, 1);
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

      const duration = Math.max(cmd.duration, 1);
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
}
