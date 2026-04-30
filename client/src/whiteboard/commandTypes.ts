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
}

export interface DrawLineCommand {
  type: "draw_line";
  id: string;
  from: [number, number];
  to: [number, number];
  color?: string;
  width?: number;
  duration: number;
}

export type WhiteboardCommand =
  | SetCanvasCommand
  | WriteTextCommand
  | DrawLineCommand;

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
    };

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
  if (cmd.type === "set_canvas") {
    return `设置画布 ${cmd.width}×${cmd.height}`;
  }
  return "未知命令";
}
