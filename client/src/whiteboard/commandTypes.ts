// Command type definitions for the AI Whiteboard MVP.
// All commands are JSON-driven and executed sequentially by ScriptRunner.

export interface SetCanvasCommand {
  type: "set_canvas";
  width: number;
  height: number;
  background?: string;
}

export interface WriteTextCommand {
  type: "write_text";
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color?: string;
  duration: number;
  narration?: string;
}

export interface DrawLineCommand {
  type: "draw_line";
  id: string;
  from: [number, number];
  to: [number, number];
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface DrawArrowCommand {
  type: "draw_arrow";
  id: string;
  from: [number, number];
  to: [number, number];
  color?: string;
  width?: number;
  headSize?: number;
  headAngle?: number;
  duration: number;
  narration?: string;
}

export interface DrawPathCommand {
  type: "draw_path";
  id: string;
  points: [number, number][];
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface EraseObjectCommand {
  type: "erase_object";
  targetId?: string;
  targetIds?: string[];
  duration?: number;
  narration?: string;
}

export interface EraseAreaCommand {
  type: "erase_area";
  id: string;
  shape?: "rect" | "circle";
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  duration?: number;
  narration?: string;
}

export interface ClearCanvasCommand {
  type: "clear_canvas";
  background?: string;
  duration?: number;
  narration?: string;
}

export interface WaitCommand {
  type: "wait";
  id?: string;
  message?: string;
  narration?: string;
}

// --- Annotation layer commands ---

export interface AnnotateUnderlineCommand {
  type: "annotate_underline";
  id: string;
  /** Start point x */
  x1: number;
  /** Start point y */
  y1: number;
  /** End point x */
  x2: number;
  /** End point y */
  y2: number;
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface AnnotateCircleCommand {
  type: "annotate_circle";
  id: string;
  /** Ellipse center x */
  cx: number;
  /** Ellipse center y */
  cy: number;
  /** Horizontal radius */
  rx: number;
  /** Vertical radius */
  ry: number;
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface ClearAnnotationsCommand {
  type: "clear_annotations";
  duration?: number;
  narration?: string;
}

export type WhiteboardCommand =
  | SetCanvasCommand
  | WriteTextCommand
  | DrawLineCommand
  | DrawArrowCommand
  | DrawPathCommand
  | EraseObjectCommand
  | EraseAreaCommand
  | ClearCanvasCommand
  | WaitCommand
  | AnnotateUnderlineCommand
  | AnnotateCircleCommand
  | ClearAnnotationsCommand;

export interface CanvasConfig {
  width: number;
  height: number;
  background: string;
}

export interface WhiteboardScript {
  canvas: CanvasConfig;
  commands: WhiteboardCommand[];
}

// Rendered element state (snapshot kept on the canvas)
export type RenderedElement =
  | {
      kind: "text";
      id: string;
      text: string; // current visible text (may be partial during animation)
      x: number;
      y: number;
      fontSize: number;
      color: string;
    }
  | {
      kind: "line";
      id: string;
      from: [number, number];
      to: [number, number];
      // current drawn endpoint (interpolated during animation); equals `to` when finished
      currentEnd: [number, number];
      color: string;
      width: number;
    }
  | {
      kind: "arrow";
      id: string;
      from: [number, number];
      to: [number, number];
      currentEnd: [number, number];
      color: string;
      width: number;
      headSize: number;
      headAngle: number;
    }
  | {
      kind: "path";
      id: string;
      points: [number, number][];
      currentPoints: [number, number][];
      color: string;
      width: number;
    }
  | {
      kind: "eraser";
      id: string;
      shape: "rect" | "circle";
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
      color: string;
    };

/** A single element on the annotation overlay layer. */
export interface AnnotationElement {
  kind: "annotation";
  id: string;
  /** Full generated annotation points */
  points: [number, number][];
  /** Incrementally revealed points during animation */
  currentPoints: [number, number][];
  /** Optional smooth SVG path for high-quality closed annotations. */
  pathD?: string;
  strokeDasharray?: number;
  strokeDashoffset?: number;
  color: string;
  width: number;
}

// Result of script validation
export interface ValidationResult {
  ok: boolean;
  error?: string;
}

// Validate a parsed script and return a typed result.
export function validateScript(raw: unknown): {
  ok: true;
  script: WhiteboardScript;
} | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "脚本必须是一个 JSON 对象。" };
  }
  const obj = raw as Record<string, unknown>;

  // Canvas
  const canvasRaw = obj.canvas;
  if (!canvasRaw || typeof canvasRaw !== "object") {
    return { ok: false, error: "缺少 canvas 配置。" };
  }
  const c = canvasRaw as Record<string, unknown>;
  if (typeof c.width !== "number" || typeof c.height !== "number") {
    return { ok: false, error: "canvas.width 和 canvas.height 必须是数字。" };
  }
  const background =
    typeof c.background === "string" ? c.background : "#ffffff";

  // Commands
  if (!Array.isArray(obj.commands)) {
    return { ok: false, error: "commands 必须是数组。" };
  }

  const commands: WhiteboardCommand[] = [];
  for (let i = 0; i < obj.commands.length; i++) {
    const cmdRaw = obj.commands[i];
    const v = validateCommand(cmdRaw, i);
    if (!v.ok) return { ok: false, error: v.error };
    commands.push(v.command);
  }

  return {
    ok: true,
    script: {
      canvas: { width: c.width, height: c.height, background },
      commands,
    },
  };
}

function validateCommand(
  raw: unknown,
  index: number,
):
  | { ok: true; command: WhiteboardCommand }
  | { ok: false; error: string } {
  const where = `第 ${index + 1} 个命令`;
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: `${where} 不是一个对象。` };
  }
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== "string") {
    return { ok: false, error: `${where} 缺少 type 字段。` };
  }

  if (type === "write_text") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (write_text) 缺少 id。` };
    if (typeof o.text !== "string")
      return { ok: false, error: `${where} (write_text) 缺少 text。` };
    if (typeof o.x !== "number" || typeof o.y !== "number")
      return { ok: false, error: `${where} (write_text) x / y 必须是数字。` };
    if (typeof o.fontSize !== "number")
      return { ok: false, error: `${where} (write_text) 缺少 fontSize。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (write_text) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "write_text",
        id: o.id,
        text: o.text,
        x: o.x,
        y: o.y,
        fontSize: o.fontSize,
        color: typeof o.color === "string" ? o.color : "#111111",
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_line") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_line) 缺少 id。` };
    if (
      !Array.isArray(o.from) ||
      o.from.length !== 2 ||
      typeof o.from[0] !== "number" ||
      typeof o.from[1] !== "number"
    )
      return {
        ok: false,
        error: `${where} (draw_line) from 必须是 [x, y] 数字数组。`,
      };
    if (
      !Array.isArray(o.to) ||
      o.to.length !== 2 ||
      typeof o.to[0] !== "number" ||
      typeof o.to[1] !== "number"
    )
      return {
        ok: false,
        error: `${where} (draw_line) to 必须是 [x, y] 数字数组。`,
      };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_line) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_line",
        id: o.id,
        from: [o.from[0], o.from[1]],
        to: [o.to[0], o.to[1]],
        color: typeof o.color === "string" ? o.color : "#111111",
        width: typeof o.width === "number" ? o.width : 2,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_arrow") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_arrow) 缺少 id。` };
    if (
      !Array.isArray(o.from) ||
      o.from.length !== 2 ||
      typeof o.from[0] !== "number" ||
      typeof o.from[1] !== "number"
    )
      return {
        ok: false,
        error: `${where} (draw_arrow) from 必须是 [x, y] 数字数组。`,
      };
    if (
      !Array.isArray(o.to) ||
      o.to.length !== 2 ||
      typeof o.to[0] !== "number" ||
      typeof o.to[1] !== "number"
    )
      return {
        ok: false,
        error: `${where} (draw_arrow) to 必须是 [x, y] 数字数组。`,
      };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_arrow) 缺少 duration。` };
    if (o.headSize !== undefined && typeof o.headSize !== "number")
      return { ok: false, error: `${where} (draw_arrow) headSize 必须是数字。` };
    if (o.headAngle !== undefined && typeof o.headAngle !== "number")
      return { ok: false, error: `${where} (draw_arrow) headAngle 必须是数字。` };
    const width = typeof o.width === "number" ? o.width : 2;
    return {
      ok: true,
      command: {
        type: "draw_arrow",
        id: o.id,
        from: [o.from[0], o.from[1]],
        to: [o.to[0], o.to[1]],
        color: typeof o.color === "string" ? o.color : "#111111",
        width,
        headSize:
          typeof o.headSize === "number" ? o.headSize : Math.max(width * 4, 12),
        headAngle: typeof o.headAngle === "number" ? o.headAngle : 28,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_path") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_path) 缺少 id。` };
    if (!Array.isArray(o.points) || o.points.length < 2) {
      return {
        ok: false,
        error: `${where} (draw_path) points 必须至少包含两个 [x, y] 坐标。`,
      };
    }

    const points: [number, number][] = [];
    for (let j = 0; j < o.points.length; j++) {
      const p = o.points[j];
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        typeof p[0] !== "number" ||
        typeof p[1] !== "number"
      ) {
        return {
          ok: false,
          error: `${where} (draw_path) points[${j}] 必须是 [x, y] 数字数组。`,
        };
      }
      points.push([p[0], p[1]]);
    }

    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_path) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_path",
        id: o.id,
        points,
        color: typeof o.color === "string" ? o.color : "#111111",
        width: typeof o.width === "number" ? o.width : 2,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "erase_object") {
    const targetIds: string[] = [];
    if (typeof o.targetId === "string") targetIds.push(o.targetId);
    if (Array.isArray(o.targetIds)) {
      for (let j = 0; j < o.targetIds.length; j++) {
        if (typeof o.targetIds[j] !== "string") {
          return {
            ok: false,
            error: `${where} (erase_object) targetIds[${j}] 必须是字符串。`,
          };
        }
        targetIds.push(o.targetIds[j]);
      }
    }
    if (targetIds.length === 0) {
      return {
        ok: false,
        error: `${where} (erase_object) 必须提供 targetId 或 targetIds。`,
      };
    }
    if (o.duration !== undefined && typeof o.duration !== "number")
      return { ok: false, error: `${where} (erase_object) duration 必须是数字。` };
    return {
      ok: true,
      command: {
        type: "erase_object",
        targetIds: Array.from(new Set(targetIds)),
        duration: typeof o.duration === "number" ? o.duration : 300,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "erase_area") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (erase_area) 缺少 id。` };
    const shape =
      o.shape === undefined || o.shape === "rect" || o.shape === "circle"
        ? (o.shape ?? "rect")
        : null;
    if (!shape)
      return { ok: false, error: `${where} (erase_area) shape 必须是 rect 或 circle。` };
    if (typeof o.x !== "number" || typeof o.y !== "number")
      return { ok: false, error: `${where} (erase_area) x / y 必须是数字。` };
    if (shape === "rect") {
      if (typeof o.width !== "number" || typeof o.height !== "number") {
        return {
          ok: false,
          error: `${where} (erase_area) rect 需要 width 和 height。`,
        };
      }
    }
    if (shape === "circle" && typeof o.radius !== "number") {
      return {
        ok: false,
        error: `${where} (erase_area) circle 需要 radius。`,
      };
    }
    if (o.duration !== undefined && typeof o.duration !== "number")
      return { ok: false, error: `${where} (erase_area) duration 必须是数字。` };
    return {
      ok: true,
      command: {
        type: "erase_area",
        id: o.id,
        shape,
        x: o.x,
        y: o.y,
        width: typeof o.width === "number" ? o.width : undefined,
        height: typeof o.height === "number" ? o.height : undefined,
        radius: typeof o.radius === "number" ? o.radius : undefined,
        duration: typeof o.duration === "number" ? o.duration : 300,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "clear_canvas") {
    if (o.duration !== undefined && typeof o.duration !== "number")
      return { ok: false, error: `${where} (clear_canvas) duration 必须是数字。` };
    if (o.background !== undefined && typeof o.background !== "string")
      return { ok: false, error: `${where} (clear_canvas) background 必须是字符串。` };
    return {
      ok: true,
      command: {
        type: "clear_canvas",
        background: typeof o.background === "string" ? o.background : undefined,
        duration: typeof o.duration === "number" ? o.duration : 300,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "wait") {
    if (o.id !== undefined && typeof o.id !== "string")
      return { ok: false, error: `${where} (wait) id 必须是字符串。` };
    if (o.message !== undefined && typeof o.message !== "string")
      return { ok: false, error: `${where} (wait) message 必须是字符串。` };
    return {
      ok: true,
      command: {
        type: "wait",
        id: typeof o.id === "string" ? o.id : undefined,
        message:
          typeof o.message === "string" ? o.message : "点击“下一步”继续讲解。",
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "set_canvas") {
    if (typeof o.width !== "number" || typeof o.height !== "number")
      return { ok: false, error: `${where} (set_canvas) 缺少 width/height。` };
    return {
      ok: true,
      command: {
        type: "set_canvas",
        width: o.width,
        height: o.height,
        background: typeof o.background === "string" ? o.background : "#ffffff",
      },
    };
  }

  if (type === "annotate_underline") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (annotate_underline) 缺少 id。` };
    if (
      typeof o.x1 !== "number" ||
      typeof o.y1 !== "number" ||
      typeof o.x2 !== "number" ||
      typeof o.y2 !== "number"
    )
      return {
        ok: false,
        error: `${where} (annotate_underline) x1/y1/x2/y2 必须是数字。`,
      };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (annotate_underline) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "annotate_underline",
        id: o.id,
        x1: o.x1,
        y1: o.y1,
        x2: o.x2,
        y2: o.y2,
        color: typeof o.color === "string" ? o.color : "#f59e0b",
        width: typeof o.width === "number" ? o.width : 4,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "annotate_circle") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (annotate_circle) 缺少 id。` };
    if (
      typeof o.cx !== "number" ||
      typeof o.cy !== "number" ||
      typeof o.rx !== "number" ||
      typeof o.ry !== "number"
    )
      return {
        ok: false,
        error: `${where} (annotate_circle) cx/cy/rx/ry 必须是数字。`,
      };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (annotate_circle) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "annotate_circle",
        id: o.id,
        cx: o.cx,
        cy: o.cy,
        rx: o.rx,
        ry: o.ry,
        color: typeof o.color === "string" ? o.color : "#ef4444",
        width: typeof o.width === "number" ? o.width : 3,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "clear_annotations") {
    if (o.duration !== undefined && typeof o.duration !== "number")
      return {
        ok: false,
        error: `${where} (clear_annotations) duration 必须是数字。`,
      };
    return {
      ok: true,
      command: {
        type: "clear_annotations",
        duration: typeof o.duration === "number" ? o.duration : 300,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  return { ok: false, error: `${where} 不支持的命令类型: "${type}"。` };
}

export function describeCommand(cmd: WhiteboardCommand): string {
  if (cmd.type === "write_text") {
    const preview =
      cmd.text.length > 16 ? cmd.text.slice(0, 16) + "…" : cmd.text;
    return `写字 “${preview}”`;
  }
  if (cmd.type === "draw_line") {
    return `画线 (${cmd.from[0]},${cmd.from[1]}) → (${cmd.to[0]},${cmd.to[1]})`;
  }
  if (cmd.type === "draw_arrow") {
    return `画箭头 (${cmd.from[0]},${cmd.from[1]}) → (${cmd.to[0]},${cmd.to[1]})`;
  }
  if (cmd.type === "draw_path") {
    return `涂鸦路径 ${cmd.points.length} 个点`;
  }
  if (cmd.type === "erase_object") {
    return `删除对象 ${(cmd.targetIds ?? []).join(", ")}`;
  }
  if (cmd.type === "erase_area") {
    return `局部擦除 ${cmd.shape ?? "rect"}`;
  }
  if (cmd.type === "clear_canvas") {
    return "清空画布";
  }
  if (cmd.type === "wait") {
    return cmd.message ?? "等待用户点击下一步";
  }
  if (cmd.type === "set_canvas") {
    return `设置画布 ${cmd.width}×${cmd.height}`;
  }
  if (cmd.type === "annotate_underline") {
    return `批注下划线 (${cmd.x1},${cmd.y1}) → (${cmd.x2},${cmd.y2})`;
  }
  if (cmd.type === "annotate_circle") {
    return `批注圈画 圆心(${cmd.cx},${cmd.cy}) rx=${cmd.rx} ry=${cmd.ry}`;
  }
  if (cmd.type === "clear_annotations") {
    return "清除批注图层";
  }
  return "未知命令";
}
