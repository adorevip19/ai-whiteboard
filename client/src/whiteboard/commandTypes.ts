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
  bold?: boolean;
  duration: number;
  narration?: string;
}

export interface WriteTextSegment {
  id?: string;
  text: string;
  color?: string;
  fontSize?: number;
  bold?: boolean;
}

export interface WriteTextSegmentsCommand {
  type: "write_text_segments";
  id: string;
  segments: WriteTextSegment[];
  x: number;
  y: number;
  fontSize: number;
  color?: string;
  duration: number;
  narration?: string;
}

export interface WriteMathCommand {
  type: "write_math";
  id: string;
  latex: string;
  x: number;
  y: number;
  fontSize: number;
  color?: string;
  displayMode?: boolean;
  duration: number;
  narration?: string;
}

export interface WriteMathStepsCommand {
  type: "write_math_steps";
  id: string;
  steps: string[];
  x: number;
  y: number;
  fontSize: number;
  lineGap?: number;
  color?: string;
  displayMode?: boolean;
  duration: number;
  narration?: string;
}

export interface WriteDivisionLayoutCommand {
  type: "write_division_layout";
  id: string;
  dividend: number | string;
  divisor: number | string;
  quotient: number | string;
  remainder: number | string;
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

export interface DrawRectangleCommand {
  type: "draw_rectangle";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
  fillOpacity?: number;
  duration: number;
  narration?: string;
}

export interface DrawTriangleCommand {
  type: "draw_triangle";
  id: string;
  points: [[number, number], [number, number], [number, number]];
  color?: string;
  strokeWidth?: number;
  fill?: string;
  fillOpacity?: number;
  duration: number;
  narration?: string;
}

export interface DrawCircleCommand {
  type: "draw_circle";
  id: string;
  cx: number;
  cy: number;
  radius: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
  fillOpacity?: number;
  duration: number;
  narration?: string;
}

export interface DrawArcArrowCommand {
  type: "draw_arc_arrow";
  id: string;
  cx: number;
  cy: number;
  radius: number;
  startAngle: number;
  endAngle: number;
  clockwise?: boolean;
  color?: string;
  width?: number;
  headSize?: number;
  headAngle?: number;
  duration: number;
  narration?: string;
}

export interface DrawBraceCommand {
  type: "draw_brace";
  id: string;
  from: [number, number];
  to: [number, number];
  orientation: "left" | "right" | "up" | "down";
  depth?: number;
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

export interface AnnotateObjectCommand {
  type: "annotate_object";
  id: string;
  targetId: string;
  style?: "circle" | "underline";
  padding?: number;
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface AnnotateMathBboxCommand {
  type: "annotate_math_bbox";
  id: string;
  targetId: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  style?: "circle" | "underline";
  padding?: number;
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface EmphasizeTextCommand {
  type: "emphasize_text";
  id: string;
  targetId: string;
  segmentId?: string;
  style: "bold" | "color" | "font_size" | "underline" | "dot";
  color?: string;
  fontSize?: number;
  width?: number;
  padding?: number;
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
  | WriteTextSegmentsCommand
  | WriteMathCommand
  | WriteMathStepsCommand
  | WriteDivisionLayoutCommand
  | DrawLineCommand
  | DrawArrowCommand
  | DrawPathCommand
  | DrawRectangleCommand
  | DrawTriangleCommand
  | DrawCircleCommand
  | DrawArcArrowCommand
  | DrawBraceCommand
  | EraseObjectCommand
  | EraseAreaCommand
  | ClearCanvasCommand
  | WaitCommand
  | AnnotateUnderlineCommand
  | AnnotateCircleCommand
  | AnnotateObjectCommand
  | AnnotateMathBboxCommand
  | EmphasizeTextCommand
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

export interface ElementBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderedTextSegment {
  id?: string;
  text: string;
  visibleText: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontWeight?: number;
  bbox: ElementBBox;
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
      fontWeight?: number;
      bbox: ElementBBox;
      opacity?: number;
    }
  | {
      kind: "text_segments";
      id: string;
      x: number;
      y: number;
      fontSize: number;
      color: string;
      segments: RenderedTextSegment[];
      bbox: ElementBBox;
    }
  | {
      kind: "math";
      id: string;
      latex: string;
      x: number;
      y: number;
      fontSize: number;
      color: string;
      displayMode: boolean;
      bbox: ElementBBox;
      opacity: number;
    }
  | {
      kind: "math_steps";
      id: string;
      steps: string[];
      visibleCount: number;
      x: number;
      y: number;
      fontSize: number;
      lineGap: number;
      color: string;
      displayMode: boolean;
      bbox: ElementBBox;
    }
  | {
      kind: "division_layout";
      id: string;
      dividend: string;
      divisor: string;
      quotient: string;
      product: string;
      remainder: string;
      x: number;
      y: number;
      fontSize: number;
      color: string;
      stage: number;
      bbox: ElementBBox;
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
      bbox: ElementBBox;
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
      bbox: ElementBBox;
    }
  | {
      kind: "path";
      id: string;
      points: [number, number][];
      currentPoints: [number, number][];
      color: string;
      width: number;
      bbox: ElementBBox;
    }
  | {
      kind: "shape";
      id: string;
      shapeType: "rectangle" | "triangle" | "circle" | "arc_arrow" | "brace";
      pathD: string;
      color: string;
      width: number;
      fill?: string;
      fillOpacity?: number;
      progress: number;
      bbox: ElementBBox;
      arrowHead?: {
        tip: [number, number];
        angle: number;
        size: number;
        headAngle: number;
        visible: boolean;
      };
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
      bbox: ElementBBox;
    };

/** A single element on the annotation overlay layer. */
export type AnnotationElement =
  | {
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
  | {
      kind: "emphasis_dots";
      id: string;
      dots: Array<{ cx: number; cy: number; r: number }>;
      visibleCount: number;
      color: string;
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

  const canvas = { width: c.width, height: c.height, background };

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

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const where = `第 ${i + 1} 个命令`;
    if (cmd.type === "annotate_circle") {
      const maxOvershoot = Math.max(canvas.width, canvas.height) * 0.25;
      if (
        cmd.cx + cmd.rx < -maxOvershoot ||
        cmd.cy + cmd.ry < -maxOvershoot ||
        cmd.cx - cmd.rx > canvas.width + maxOvershoot ||
        cmd.cy - cmd.ry > canvas.height + maxOvershoot
      ) {
        return {
          ok: false,
          error: `${where} (annotate_circle) 明显超出 canvas 范围。`,
        };
      }
    }
  }

  return {
    ok: true,
    script: {
      canvas,
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
        bold: typeof o.bold === "boolean" ? o.bold : undefined,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "write_text_segments") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (write_text_segments) 缺少 id。` };
    if (!Array.isArray(o.segments) || o.segments.length === 0) {
      return {
        ok: false,
        error: `${where} (write_text_segments) segments 必须是非空数组。`,
      };
    }
    const segments: WriteTextSegment[] = [];
    for (let j = 0; j < o.segments.length; j++) {
      const seg = o.segments[j];
      if (!seg || typeof seg !== "object") {
        return {
          ok: false,
          error: `${where} (write_text_segments) segments[${j}] 必须是对象。`,
        };
      }
      const s = seg as Record<string, unknown>;
      if (s.id !== undefined && typeof s.id !== "string") {
        return {
          ok: false,
          error: `${where} (write_text_segments) segments[${j}].id 必须是字符串。`,
        };
      }
      if (typeof s.text !== "string") {
        return {
          ok: false,
          error: `${where} (write_text_segments) segments[${j}].text 必须是字符串。`,
        };
      }
      if (s.color !== undefined && typeof s.color !== "string") {
        return {
          ok: false,
          error: `${where} (write_text_segments) segments[${j}].color 必须是字符串。`,
        };
      }
      if (s.fontSize !== undefined && typeof s.fontSize !== "number") {
        return {
          ok: false,
          error: `${where} (write_text_segments) segments[${j}].fontSize 必须是数字。`,
        };
      }
      if (s.bold !== undefined && typeof s.bold !== "boolean") {
        return {
          ok: false,
          error: `${where} (write_text_segments) segments[${j}].bold 必须是布尔值。`,
        };
      }
      segments.push({
        id: typeof s.id === "string" ? s.id : undefined,
        text: s.text,
        color: typeof s.color === "string" ? s.color : undefined,
        fontSize: typeof s.fontSize === "number" ? s.fontSize : undefined,
        bold: typeof s.bold === "boolean" ? s.bold : undefined,
      });
    }
    if (typeof o.x !== "number" || typeof o.y !== "number")
      return {
        ok: false,
        error: `${where} (write_text_segments) x / y 必须是数字。`,
      };
    if (typeof o.fontSize !== "number")
      return { ok: false, error: `${where} (write_text_segments) 缺少 fontSize。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (write_text_segments) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "write_text_segments",
        id: o.id,
        segments,
        x: o.x,
        y: o.y,
        fontSize: o.fontSize,
        color: typeof o.color === "string" ? o.color : "#111111",
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "write_math") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (write_math) 缺少 id。` };
    if (typeof o.latex !== "string")
      return { ok: false, error: `${where} (write_math) 缺少 latex。` };
    if (typeof o.x !== "number" || typeof o.y !== "number")
      return { ok: false, error: `${where} (write_math) x / y 必须是数字。` };
    if (typeof o.fontSize !== "number")
      return { ok: false, error: `${where} (write_math) 缺少 fontSize。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (write_math) 缺少 duration。` };
    if (o.displayMode !== undefined && typeof o.displayMode !== "boolean")
      return { ok: false, error: `${where} (write_math) displayMode 必须是布尔值。` };
    return {
      ok: true,
      command: {
        type: "write_math",
        id: o.id,
        latex: o.latex,
        x: o.x,
        y: o.y,
        fontSize: o.fontSize,
        color: typeof o.color === "string" ? o.color : "#111111",
        displayMode: typeof o.displayMode === "boolean" ? o.displayMode : false,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "write_math_steps") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (write_math_steps) 缺少 id。` };
    if (!Array.isArray(o.steps) || o.steps.length === 0)
      return { ok: false, error: `${where} (write_math_steps) steps 必须是非空字符串数组。` };
    const steps: string[] = [];
    for (let j = 0; j < o.steps.length; j++) {
      if (typeof o.steps[j] !== "string") {
        return {
          ok: false,
          error: `${where} (write_math_steps) steps[${j}] 必须是字符串。`,
        };
      }
      steps.push(o.steps[j]);
    }
    if (typeof o.x !== "number" || typeof o.y !== "number")
      return { ok: false, error: `${where} (write_math_steps) x / y 必须是数字。` };
    if (typeof o.fontSize !== "number")
      return { ok: false, error: `${where} (write_math_steps) 缺少 fontSize。` };
    if (o.lineGap !== undefined && typeof o.lineGap !== "number")
      return { ok: false, error: `${where} (write_math_steps) lineGap 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (write_math_steps) 缺少 duration。` };
    if (o.displayMode !== undefined && typeof o.displayMode !== "boolean")
      return { ok: false, error: `${where} (write_math_steps) displayMode 必须是布尔值。` };
    return {
      ok: true,
      command: {
        type: "write_math_steps",
        id: o.id,
        steps,
        x: o.x,
        y: o.y,
        fontSize: o.fontSize,
        lineGap: typeof o.lineGap === "number" ? o.lineGap : undefined,
        color: typeof o.color === "string" ? o.color : "#111111",
        displayMode: typeof o.displayMode === "boolean" ? o.displayMode : false,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "write_division_layout") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (write_division_layout) 缺少 id。` };
    const required = ["dividend", "divisor", "quotient", "remainder"] as const;
    for (const key of required) {
      if (typeof o[key] !== "number" && typeof o[key] !== "string") {
        return {
          ok: false,
          error: `${where} (write_division_layout) ${key} 必须是数字或字符串。`,
        };
      }
    }
    if (typeof o.x !== "number" || typeof o.y !== "number")
      return { ok: false, error: `${where} (write_division_layout) x / y 必须是数字。` };
    if (typeof o.fontSize !== "number")
      return { ok: false, error: `${where} (write_division_layout) 缺少 fontSize。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (write_division_layout) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "write_division_layout",
        id: o.id,
        dividend: o.dividend as number | string,
        divisor: o.divisor as number | string,
        quotient: o.quotient as number | string,
        remainder: o.remainder as number | string,
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

  if (type === "draw_rectangle") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_rectangle) 缺少 id。` };
    if (
      typeof o.x !== "number" ||
      typeof o.y !== "number" ||
      typeof o.width !== "number" ||
      typeof o.height !== "number"
    )
      return {
        ok: false,
        error: `${where} (draw_rectangle) x/y/width/height 必须是数字。`,
      };
    if (o.width <= 0 || o.height <= 0)
      return { ok: false, error: `${where} (draw_rectangle) width/height 必须大于 0。` };
    if (o.radius !== undefined && typeof o.radius !== "number")
      return { ok: false, error: `${where} (draw_rectangle) radius 必须是数字。` };
    if (o.strokeWidth !== undefined && typeof o.strokeWidth !== "number")
      return { ok: false, error: `${where} (draw_rectangle) strokeWidth 必须是数字。` };
    if (o.fill !== undefined && typeof o.fill !== "string")
      return { ok: false, error: `${where} (draw_rectangle) fill 必须是字符串。` };
    if (o.fillOpacity !== undefined && typeof o.fillOpacity !== "number")
      return { ok: false, error: `${where} (draw_rectangle) fillOpacity 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_rectangle) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_rectangle",
        id: o.id,
        x: o.x,
        y: o.y,
        width: o.width,
        height: o.height,
        radius: typeof o.radius === "number" ? o.radius : undefined,
        color: typeof o.color === "string" ? o.color : "#111111",
        strokeWidth: typeof o.strokeWidth === "number" ? o.strokeWidth : 2,
        fill: typeof o.fill === "string" ? o.fill : undefined,
        fillOpacity: typeof o.fillOpacity === "number" ? o.fillOpacity : undefined,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_triangle") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_triangle) 缺少 id。` };
    if (!Array.isArray(o.points) || o.points.length !== 3)
      return {
        ok: false,
        error: `${where} (draw_triangle) points 必须是 3 个 [x, y] 坐标。`,
      };
    const points: [[number, number], [number, number], [number, number]] = [
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    for (let j = 0; j < 3; j++) {
      const p = o.points[j];
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        typeof p[0] !== "number" ||
        typeof p[1] !== "number"
      ) {
        return {
          ok: false,
          error: `${where} (draw_triangle) points[${j}] 必须是 [x, y] 数字数组。`,
        };
      }
      points[j] = [p[0], p[1]];
    }
    if (o.strokeWidth !== undefined && typeof o.strokeWidth !== "number")
      return { ok: false, error: `${where} (draw_triangle) strokeWidth 必须是数字。` };
    if (o.fill !== undefined && typeof o.fill !== "string")
      return { ok: false, error: `${where} (draw_triangle) fill 必须是字符串。` };
    if (o.fillOpacity !== undefined && typeof o.fillOpacity !== "number")
      return { ok: false, error: `${where} (draw_triangle) fillOpacity 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_triangle) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_triangle",
        id: o.id,
        points,
        color: typeof o.color === "string" ? o.color : "#111111",
        strokeWidth: typeof o.strokeWidth === "number" ? o.strokeWidth : 2,
        fill: typeof o.fill === "string" ? o.fill : undefined,
        fillOpacity: typeof o.fillOpacity === "number" ? o.fillOpacity : undefined,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_circle") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_circle) 缺少 id。` };
    if (
      typeof o.cx !== "number" ||
      typeof o.cy !== "number" ||
      typeof o.radius !== "number"
    )
      return {
        ok: false,
        error: `${where} (draw_circle) cx/cy/radius 必须是数字。`,
      };
    if (o.radius <= 0)
      return { ok: false, error: `${where} (draw_circle) radius 必须大于 0。` };
    if (o.strokeWidth !== undefined && typeof o.strokeWidth !== "number")
      return { ok: false, error: `${where} (draw_circle) strokeWidth 必须是数字。` };
    if (o.fill !== undefined && typeof o.fill !== "string")
      return { ok: false, error: `${where} (draw_circle) fill 必须是字符串。` };
    if (o.fillOpacity !== undefined && typeof o.fillOpacity !== "number")
      return { ok: false, error: `${where} (draw_circle) fillOpacity 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_circle) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_circle",
        id: o.id,
        cx: o.cx,
        cy: o.cy,
        radius: o.radius,
        color: typeof o.color === "string" ? o.color : "#111111",
        strokeWidth: typeof o.strokeWidth === "number" ? o.strokeWidth : 2,
        fill: typeof o.fill === "string" ? o.fill : undefined,
        fillOpacity: typeof o.fillOpacity === "number" ? o.fillOpacity : undefined,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_arc_arrow") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_arc_arrow) 缺少 id。` };
    if (
      typeof o.cx !== "number" ||
      typeof o.cy !== "number" ||
      typeof o.radius !== "number" ||
      typeof o.startAngle !== "number" ||
      typeof o.endAngle !== "number"
    )
      return {
        ok: false,
        error: `${where} (draw_arc_arrow) cx/cy/radius/startAngle/endAngle 必须是数字。`,
      };
    if (o.radius <= 0)
      return { ok: false, error: `${where} (draw_arc_arrow) radius 必须大于 0。` };
    if (o.clockwise !== undefined && typeof o.clockwise !== "boolean")
      return { ok: false, error: `${where} (draw_arc_arrow) clockwise 必须是布尔值。` };
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (draw_arc_arrow) width 必须是数字。` };
    if (o.headSize !== undefined && typeof o.headSize !== "number")
      return { ok: false, error: `${where} (draw_arc_arrow) headSize 必须是数字。` };
    if (o.headAngle !== undefined && typeof o.headAngle !== "number")
      return { ok: false, error: `${where} (draw_arc_arrow) headAngle 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_arc_arrow) 缺少 duration。` };
    const width = typeof o.width === "number" ? o.width : 3;
    return {
      ok: true,
      command: {
        type: "draw_arc_arrow",
        id: o.id,
        cx: o.cx,
        cy: o.cy,
        radius: o.radius,
        startAngle: o.startAngle,
        endAngle: o.endAngle,
        clockwise: typeof o.clockwise === "boolean" ? o.clockwise : true,
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

  if (type === "draw_brace") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_brace) 缺少 id。` };
    if (
      !Array.isArray(o.from) ||
      o.from.length !== 2 ||
      typeof o.from[0] !== "number" ||
      typeof o.from[1] !== "number"
    )
      return {
        ok: false,
        error: `${where} (draw_brace) from 必须是 [x, y] 数字数组。`,
      };
    if (
      !Array.isArray(o.to) ||
      o.to.length !== 2 ||
      typeof o.to[0] !== "number" ||
      typeof o.to[1] !== "number"
    )
      return {
        ok: false,
        error: `${where} (draw_brace) to 必须是 [x, y] 数字数组。`,
      };
    if (
      o.orientation !== "left" &&
      o.orientation !== "right" &&
      o.orientation !== "up" &&
      o.orientation !== "down"
    )
      return {
        ok: false,
        error: `${where} (draw_brace) orientation 必须是 left/right/up/down。`,
      };
    if (o.depth !== undefined && typeof o.depth !== "number")
      return { ok: false, error: `${where} (draw_brace) depth 必须是数字。` };
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (draw_brace) width 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_brace) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_brace",
        id: o.id,
        from: [o.from[0], o.from[1]],
        to: [o.to[0], o.to[1]],
        orientation: o.orientation,
        depth: typeof o.depth === "number" ? o.depth : undefined,
        color: typeof o.color === "string" ? o.color : "#111111",
        width: typeof o.width === "number" ? o.width : 3,
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

  if (type === "annotate_object") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (annotate_object) 缺少 id。` };
    if (typeof o.targetId !== "string")
      return { ok: false, error: `${where} (annotate_object) 缺少 targetId。` };
    if (o.style !== undefined && o.style !== "circle" && o.style !== "underline") {
      return {
        ok: false,
        error: `${where} (annotate_object) style 必须是 circle 或 underline。`,
      };
    }
    if (o.padding !== undefined && typeof o.padding !== "number")
      return { ok: false, error: `${where} (annotate_object) padding 必须是数字。` };
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (annotate_object) width 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (annotate_object) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "annotate_object",
        id: o.id,
        targetId: o.targetId,
        style: o.style === "underline" ? "underline" : "circle",
        padding: typeof o.padding === "number" ? o.padding : 8,
        color: typeof o.color === "string" ? o.color : "#ef4444",
        width: typeof o.width === "number" ? o.width : 3,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "annotate_math_bbox") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (annotate_math_bbox) 缺少 id。` };
    if (typeof o.targetId !== "string")
      return { ok: false, error: `${where} (annotate_math_bbox) 缺少 targetId。` };
    if (!o.bbox || typeof o.bbox !== "object") {
      return { ok: false, error: `${where} (annotate_math_bbox) 缺少 bbox。` };
    }
    const bbox = o.bbox as Record<string, unknown>;
    if (
      typeof bbox.x !== "number" ||
      typeof bbox.y !== "number" ||
      typeof bbox.width !== "number" ||
      typeof bbox.height !== "number"
    ) {
      return {
        ok: false,
        error: `${where} (annotate_math_bbox) bbox.x/y/width/height 必须是数字。`,
      };
    }
    if (o.style !== undefined && o.style !== "circle" && o.style !== "underline") {
      return {
        ok: false,
        error: `${where} (annotate_math_bbox) style 必须是 circle 或 underline。`,
      };
    }
    if (o.padding !== undefined && typeof o.padding !== "number")
      return { ok: false, error: `${where} (annotate_math_bbox) padding 必须是数字。` };
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (annotate_math_bbox) width 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (annotate_math_bbox) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "annotate_math_bbox",
        id: o.id,
        targetId: o.targetId,
        bbox: {
          x: bbox.x,
          y: bbox.y,
          width: bbox.width,
          height: bbox.height,
        },
        style: o.style === "underline" ? "underline" : "circle",
        padding: typeof o.padding === "number" ? o.padding : 6,
        color: typeof o.color === "string" ? o.color : "#ef4444",
        width: typeof o.width === "number" ? o.width : 3,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "emphasize_text") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (emphasize_text) 缺少 id。` };
    if (typeof o.targetId !== "string")
      return { ok: false, error: `${where} (emphasize_text) 缺少 targetId。` };
    if (o.segmentId !== undefined && typeof o.segmentId !== "string")
      return { ok: false, error: `${where} (emphasize_text) segmentId 必须是字符串。` };
    if (
      o.style !== "bold" &&
      o.style !== "color" &&
      o.style !== "font_size" &&
      o.style !== "underline" &&
      o.style !== "dot"
    ) {
      return {
        ok: false,
        error: `${where} (emphasize_text) style 必须是 bold/color/font_size/underline/dot。`,
      };
    }
    if ((o.style === "color" || o.style === "underline" || o.style === "dot") && o.color !== undefined && typeof o.color !== "string")
      return { ok: false, error: `${where} (emphasize_text) color 必须是字符串。` };
    if (o.style === "font_size" && typeof o.fontSize !== "number")
      return { ok: false, error: `${where} (emphasize_text) fontSize 必须是数字。` };
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (emphasize_text) width 必须是数字。` };
    if (o.padding !== undefined && typeof o.padding !== "number")
      return { ok: false, error: `${where} (emphasize_text) padding 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (emphasize_text) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "emphasize_text",
        id: o.id,
        targetId: o.targetId,
        segmentId: typeof o.segmentId === "string" ? o.segmentId : undefined,
        style: o.style,
        color: typeof o.color === "string" ? o.color : undefined,
        fontSize: typeof o.fontSize === "number" ? o.fontSize : undefined,
        width: typeof o.width === "number" ? o.width : undefined,
        padding: typeof o.padding === "number" ? o.padding : undefined,
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
    return `写字 "${preview}"`;
  }
  if (cmd.type === "write_text_segments") {
    return `写分段文字 ${cmd.segments.length} 段`;
  }
  if (cmd.type === "write_math") {
    const preview =
      cmd.latex.length > 18 ? cmd.latex.slice(0, 18) + "…" : cmd.latex;
    return `写公式 ${preview}`;
  }
  if (cmd.type === "write_math_steps") {
    return `写公式推导 ${cmd.steps.length} 行`;
  }
  if (cmd.type === "write_division_layout") {
    return `写除法竖式 ${cmd.dividend} ÷ ${cmd.divisor}`;
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
  if (cmd.type === "draw_rectangle") {
    return `画矩形 ${cmd.width}×${cmd.height}`;
  }
  if (cmd.type === "draw_triangle") {
    return "画三角形";
  }
  if (cmd.type === "draw_circle") {
    return `画圆 圆心(${cmd.cx},${cmd.cy}) r=${cmd.radius}`;
  }
  if (cmd.type === "draw_arc_arrow") {
    return `画弧形箭头 ${cmd.startAngle}° → ${cmd.endAngle}°`;
  }
  if (cmd.type === "draw_brace") {
    return `画大括号 ${cmd.orientation}`;
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
  if (cmd.type === "annotate_object") {
    return `批注对象 ${cmd.targetId}`;
  }
  if (cmd.type === "annotate_math_bbox") {
    return `批注公式局部 ${cmd.targetId}`;
  }
  if (cmd.type === "emphasize_text") {
    return `强调文字 ${cmd.segmentId ?? cmd.targetId}`;
  }
  if (cmd.type === "clear_annotations") {
    return "清除批注图层";
  }
  return "未知命令";
}
