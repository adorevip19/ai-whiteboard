// Command type definitions for the AI Whiteboard MVP.
// All commands are JSON-driven and executed sequentially by ScriptRunner.
import type {
  GeometryConstructionSpec,
  GeometryPointSpec,
} from "./geometryEngine";

export interface SetCanvasCommand {
  type: "set_canvas";
  width: number;
  height: number;
  background?: string;
}

export interface PageConfig {
  id: string;
  title?: string;
}

export interface SwitchPageCommand {
  type: "switch_page";
  id?: string;
  pageId: string;
  title?: string;
  duration?: number;
  narration?: string;
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

export interface MoveObjectCommand {
  type: "move_object";
  id: string;
  targetId: string;
  to?: {
    x: number;
    y: number;
  };
  by?: {
    dx: number;
    dy: number;
  };
  anchor?: "top_left" | "center";
  easing?: "linear" | "easeInOut" | "easeOut";
  duration: number;
  narration?: string;
}

export interface DrawCoordinateSystemCommand {
  type: "draw_coordinate_system";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  grid?: boolean;
  xTickStep?: number;
  yTickStep?: number;
  showLabels?: boolean;
  axisColor?: string;
  gridColor?: string;
  labelColor?: string;
  fontSize?: number;
  duration: number;
  narration?: string;
}

export interface DrawFunctionCommand {
  type: "draw_function";
  id: string;
  coordinateSystemId: string;
  expression: string;
  xMin?: number;
  xMax?: number;
  samples?: number;
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface PlotPointCommand {
  type: "plot_point";
  id: string;
  coordinateSystemId: string;
  x: number;
  y: number;
  label?: string;
  color?: string;
  radius?: number;
  fontSize?: number;
  duration: number;
  narration?: string;
}

export interface DrawCoordinateSegmentCommand {
  type: "draw_coordinate_segment";
  id: string;
  coordinateSystemId: string;
  from: [number, number];
  to: [number, number];
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface DrawPointCommand {
  type: "draw_point";
  id: string;
  x: number;
  y: number;
  label?: string;
  labelPosition?: "top" | "right" | "bottom" | "left";
  color?: string;
  radius?: number;
  fontSize?: number;
  duration: number;
  narration?: string;
}

export interface DrawSegmentCommand {
  type: "draw_segment";
  id: string;
  from: [number, number];
  to: [number, number];
  label?: string;
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface DrawRayCommand {
  type: "draw_ray";
  id: string;
  from: [number, number];
  through: [number, number];
  length?: number;
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface DrawAngleCommand {
  type: "draw_angle";
  id: string;
  vertex: [number, number];
  from: [number, number];
  to: [number, number];
  radius?: number;
  label?: string;
  color?: string;
  width?: number;
  fontSize?: number;
  duration: number;
  narration?: string;
}

export interface MarkEqualSegmentsCommand {
  type: "mark_equal_segments";
  id: string;
  segments: Array<{
    from: [number, number];
    to: [number, number];
  }>;
  tickCount?: number;
  color?: string;
  width?: number;
  size?: number;
  duration: number;
  narration?: string;
}

export interface MarkParallelCommand {
  type: "mark_parallel";
  id: string;
  segments: Array<{
    from: [number, number];
    to: [number, number];
  }>;
  markCount?: number;
  color?: string;
  width?: number;
  size?: number;
  duration: number;
  narration?: string;
}

export interface MarkPerpendicularCommand {
  type: "mark_perpendicular";
  id: string;
  vertex: [number, number];
  point1: [number, number];
  point2: [number, number];
  size?: number;
  color?: string;
  width?: number;
  duration: number;
  narration?: string;
}

export interface HighlightPolygonCommand {
  type: "highlight_polygon";
  id: string;
  points: [number, number][];
  color?: string;
  strokeWidth?: number;
  fill?: string;
  fillOpacity?: number;
  duration: number;
  narration?: string;
}

export interface ConstructGeometryCommand {
  type: "construct_geometry";
  id: string;
  points: GeometryPointSpec[];
  constructions: GeometryConstructionSpec[];
  drawPoints?: boolean;
  pointColor?: string;
  lineColor?: string;
  duration?: number;
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

export interface LaserPointerCommand {
  type: "laser_pointer";
  id: string;
  /** Start point, or fixed point when no `to` / `path` is provided. */
  x: number;
  y: number;
  /** Optional end point for a smooth pointer move. */
  to?: {
    x: number;
    y: number;
  };
  /** Optional multi-point route. First point overrides x/y as the start. */
  path?: [number, number][];
  style?: "dot" | "pulse" | "ring" | "spotlight";
  color?: string;
  radius?: number;
  trail?: boolean;
  duration: number;
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
  | SwitchPageCommand
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
  | MoveObjectCommand
  | DrawCoordinateSystemCommand
  | DrawFunctionCommand
  | PlotPointCommand
  | DrawCoordinateSegmentCommand
  | DrawPointCommand
  | DrawSegmentCommand
  | DrawRayCommand
  | DrawAngleCommand
  | MarkEqualSegmentsCommand
  | MarkParallelCommand
  | MarkPerpendicularCommand
  | HighlightPolygonCommand
  | ConstructGeometryCommand
  | EraseObjectCommand
  | EraseAreaCommand
  | ClearCanvasCommand
  | LaserPointerCommand
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
  pages?: PageConfig[];
  commands: WhiteboardCommand[];
}

export interface ElementBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementTransform {
  translateX: number;
  translateY: number;
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
export type RenderedElement = (
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
      coordinateSystemId?: string;
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
      shapeType:
        | "rectangle"
        | "triangle"
        | "circle"
        | "arc_arrow"
        | "brace"
        | "angle"
        | "geometry_mark"
        | "highlight_polygon";
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
      kind: "brace_glyph";
      id: string;
      glyph: "{" | "}";
      x: number;
      y: number;
      fontSize: number;
      color: string;
      rotation: number;
      progress: number;
      bbox: ElementBBox;
    }
  | {
      kind: "geometry_point";
      id: string;
      x: number;
      y: number;
      label?: string;
      labelPosition: "top" | "right" | "bottom" | "left";
      color: string;
      radius: number;
      fontSize: number;
      progress: number;
      bbox: ElementBBox;
    }
  | {
      kind: "coordinate_system";
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      xMin: number;
      xMax: number;
      yMin: number;
      yMax: number;
      xTicks: number[];
      yTicks: number[];
      grid: boolean;
      showLabels: boolean;
      axisColor: string;
      gridColor: string;
      labelColor: string;
      fontSize: number;
      progress: number;
      bbox: ElementBBox;
    }
  | {
      kind: "function_graph";
      id: string;
      coordinateSystemId: string;
      pathD: string;
      color: string;
      width: number;
      progress: number;
      clip: ElementBBox;
      bbox: ElementBBox;
    }
  | {
      kind: "coordinate_point";
      id: string;
      coordinateSystemId: string;
      x: number;
      y: number;
      canvasX: number;
      canvasY: number;
      label?: string;
      color: string;
      radius: number;
      fontSize: number;
      progress: number;
      bbox: ElementBBox;
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
    }
) & { transform?: ElementTransform };

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
    }
  | {
      kind: "laser_pointer";
      id: string;
      x: number;
      y: number;
      style: "dot" | "pulse" | "ring" | "spotlight";
      color: string;
      radius: number;
      progress: number;
      opacity: number;
      trail: Array<{ x: number; y: number; opacity: number; radius: number }>;
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

  let pages: PageConfig[] | undefined;
  if (obj.pages !== undefined) {
    if (!Array.isArray(obj.pages)) {
      return { ok: false, error: "pages 必须是数组。" };
    }
    pages = [];
    const pageIds = new Set<string>();
    for (let i = 0; i < obj.pages.length; i++) {
      const rawPage = obj.pages[i];
      if (!rawPage || typeof rawPage !== "object") {
        return { ok: false, error: `pages[${i}] 必须是对象。` };
      }
      const page = rawPage as Record<string, unknown>;
      if (typeof page.id !== "string" || !page.id.trim()) {
        return { ok: false, error: `pages[${i}].id 必须是非空字符串。` };
      }
      if (pageIds.has(page.id)) {
        return { ok: false, error: `pages id "${page.id}" 重复。` };
      }
      pageIds.add(page.id);
      if (page.title !== undefined && typeof page.title !== "string") {
        return { ok: false, error: `pages[${i}].title 必须是字符串。` };
      }
      pages.push({
        id: page.id,
        title: typeof page.title === "string" ? page.title : undefined,
      });
    }
  }

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
    if (cmd.type === "laser_pointer") {
      const points = [
        [cmd.x, cmd.y],
        ...(cmd.to ? [[cmd.to.x, cmd.to.y] as [number, number]] : []),
        ...(cmd.path ?? []),
      ] as [number, number][];
      if (points.some(([x, y]) => x < 0 || x > canvas.width || y < 0 || y > canvas.height)) {
        return {
          ok: false,
          error: `${where} (laser_pointer) 坐标超出 canvas 范围。`,
        };
      }
    }
    if (cmd.type === "switch_page" && pages && !pages.some((page) => page.id === cmd.pageId)) {
      return {
        ok: false,
        error: `${where} (switch_page) 引用了不存在的 pageId "${cmd.pageId}"。`,
      };
    }
  }

  return {
    ok: true,
    script: {
      canvas,
      pages,
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

  const readPoint = (
    value: unknown,
    field: string,
  ): [number, number] | { error: string } => {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== "number" ||
      typeof value[1] !== "number"
    ) {
      return { error: `${where} (${type}) ${field} 必须是 [x, y] 数字数组。` };
    }
    return [value[0], value[1]];
  };

  if (type === "switch_page") {
    if (o.id !== undefined && typeof o.id !== "string")
      return { ok: false, error: `${where} (switch_page) id 必须是字符串。` };
    if (typeof o.pageId !== "string" || !o.pageId.trim())
      return { ok: false, error: `${where} (switch_page) 缺少 pageId。` };
    if (o.title !== undefined && typeof o.title !== "string")
      return { ok: false, error: `${where} (switch_page) title 必须是字符串。` };
    if (o.duration !== undefined && typeof o.duration !== "number")
      return { ok: false, error: `${where} (switch_page) duration 必须是数字。` };
    return {
      ok: true,
      command: {
        type: "switch_page",
        id: typeof o.id === "string" ? o.id : undefined,
        pageId: o.pageId,
        title: typeof o.title === "string" ? o.title : undefined,
        duration: typeof o.duration === "number" ? o.duration : 400,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
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

  if (type === "move_object") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (move_object) 缺少 id。` };
    if (typeof o.targetId !== "string")
      return { ok: false, error: `${where} (move_object) 缺少 targetId。` };
    const hasTo = o.to !== undefined;
    const hasBy = o.by !== undefined;
    if (!hasTo && !hasBy) {
      return {
        ok: false,
        error: `${where} (move_object) 必须提供 to 或 by。`,
      };
    }
    if (hasTo && (!o.to || typeof o.to !== "object")) {
      return { ok: false, error: `${where} (move_object) to 必须是对象。` };
    }
    if (hasBy && (!o.by || typeof o.by !== "object")) {
      return { ok: false, error: `${where} (move_object) by 必须是对象。` };
    }
    const to = o.to as Record<string, unknown> | undefined;
    const by = o.by as Record<string, unknown> | undefined;
    if (to && (typeof to.x !== "number" || typeof to.y !== "number")) {
      return {
        ok: false,
        error: `${where} (move_object) to.x / to.y 必须是数字。`,
      };
    }
    if (by && (typeof by.dx !== "number" || typeof by.dy !== "number")) {
      return {
        ok: false,
        error: `${where} (move_object) by.dx / by.dy 必须是数字。`,
      };
    }
    if (o.anchor !== undefined && o.anchor !== "top_left" && o.anchor !== "center") {
      return {
        ok: false,
        error: `${where} (move_object) anchor 必须是 top_left 或 center。`,
      };
    }
    if (
      o.easing !== undefined &&
      o.easing !== "linear" &&
      o.easing !== "easeInOut" &&
      o.easing !== "easeOut"
    ) {
      return {
        ok: false,
        error: `${where} (move_object) easing 必须是 linear/easeInOut/easeOut。`,
      };
    }
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (move_object) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "move_object",
        id: o.id,
        targetId: o.targetId,
        to: to ? { x: to.x as number, y: to.y as number } : undefined,
        by: by ? { dx: by.dx as number, dy: by.dy as number } : undefined,
        anchor: o.anchor === "center" ? "center" : "top_left",
        easing:
          o.easing === "linear" || o.easing === "easeOut" || o.easing === "easeInOut"
            ? o.easing
            : "easeInOut",
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_coordinate_system") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_coordinate_system) 缺少 id。` };
    for (const key of ["x", "y", "width", "height", "xMin", "xMax", "yMin", "yMax"] as const) {
      if (typeof o[key] !== "number") {
        return {
          ok: false,
          error: `${where} (draw_coordinate_system) ${key} 必须是数字。`,
        };
      }
    }
    const x = o.x as number;
    const y = o.y as number;
    const width = o.width as number;
    const height = o.height as number;
    const xMin = o.xMin as number;
    const xMax = o.xMax as number;
    const yMin = o.yMin as number;
    const yMax = o.yMax as number;
    if (width <= 0 || height <= 0)
      return {
        ok: false,
        error: `${where} (draw_coordinate_system) width/height 必须大于 0。`,
      };
    if (xMax <= xMin || yMax <= yMin)
      return {
        ok: false,
        error: `${where} (draw_coordinate_system) xMax/yMax 必须大于 xMin/yMin。`,
      };
    if (o.grid !== undefined && typeof o.grid !== "boolean")
      return { ok: false, error: `${where} (draw_coordinate_system) grid 必须是布尔值。` };
    if (o.showLabels !== undefined && typeof o.showLabels !== "boolean")
      return { ok: false, error: `${where} (draw_coordinate_system) showLabels 必须是布尔值。` };
    if (o.xTickStep !== undefined && (typeof o.xTickStep !== "number" || o.xTickStep <= 0))
      return { ok: false, error: `${where} (draw_coordinate_system) xTickStep 必须是正数。` };
    if (o.yTickStep !== undefined && (typeof o.yTickStep !== "number" || o.yTickStep <= 0))
      return { ok: false, error: `${where} (draw_coordinate_system) yTickStep 必须是正数。` };
    if (o.fontSize !== undefined && typeof o.fontSize !== "number")
      return { ok: false, error: `${where} (draw_coordinate_system) fontSize 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_coordinate_system) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_coordinate_system",
        id: o.id,
        x,
        y,
        width,
        height,
        xMin,
        xMax,
        yMin,
        yMax,
        grid: typeof o.grid === "boolean" ? o.grid : true,
        xTickStep: typeof o.xTickStep === "number" ? o.xTickStep : undefined,
        yTickStep: typeof o.yTickStep === "number" ? o.yTickStep : undefined,
        showLabels: typeof o.showLabels === "boolean" ? o.showLabels : true,
        axisColor: typeof o.axisColor === "string" ? o.axisColor : "#111111",
        gridColor: typeof o.gridColor === "string" ? o.gridColor : "#e5e7eb",
        labelColor: typeof o.labelColor === "string" ? o.labelColor : "#475569",
        fontSize: typeof o.fontSize === "number" ? o.fontSize : 14,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_function") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_function) 缺少 id。` };
    if (typeof o.coordinateSystemId !== "string")
      return { ok: false, error: `${where} (draw_function) 缺少 coordinateSystemId。` };
    if (typeof o.expression !== "string")
      return { ok: false, error: `${where} (draw_function) 缺少 expression。` };
    if (o.xMin !== undefined && typeof o.xMin !== "number")
      return { ok: false, error: `${where} (draw_function) xMin 必须是数字。` };
    if (o.xMax !== undefined && typeof o.xMax !== "number")
      return { ok: false, error: `${where} (draw_function) xMax 必须是数字。` };
    if (o.samples !== undefined && (typeof o.samples !== "number" || o.samples < 8))
      return { ok: false, error: `${where} (draw_function) samples 必须是不小于 8 的数字。` };
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (draw_function) width 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_function) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_function",
        id: o.id,
        coordinateSystemId: o.coordinateSystemId,
        expression: o.expression,
        xMin: typeof o.xMin === "number" ? o.xMin : undefined,
        xMax: typeof o.xMax === "number" ? o.xMax : undefined,
        samples: typeof o.samples === "number" ? o.samples : undefined,
        color: typeof o.color === "string" ? o.color : "#2563eb",
        width: typeof o.width === "number" ? o.width : 3,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "plot_point") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (plot_point) 缺少 id。` };
    if (typeof o.coordinateSystemId !== "string")
      return { ok: false, error: `${where} (plot_point) 缺少 coordinateSystemId。` };
    if (typeof o.x !== "number" || typeof o.y !== "number")
      return { ok: false, error: `${where} (plot_point) x / y 必须是数字。` };
    if (o.label !== undefined && typeof o.label !== "string")
      return { ok: false, error: `${where} (plot_point) label 必须是字符串。` };
    if (o.radius !== undefined && typeof o.radius !== "number")
      return { ok: false, error: `${where} (plot_point) radius 必须是数字。` };
    if (o.fontSize !== undefined && typeof o.fontSize !== "number")
      return { ok: false, error: `${where} (plot_point) fontSize 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (plot_point) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "plot_point",
        id: o.id,
        coordinateSystemId: o.coordinateSystemId,
        x: o.x,
        y: o.y,
        label: typeof o.label === "string" ? o.label : undefined,
        color: typeof o.color === "string" ? o.color : "#ef4444",
        radius: typeof o.radius === "number" ? o.radius : 5,
        fontSize: typeof o.fontSize === "number" ? o.fontSize : 16,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_coordinate_segment") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_coordinate_segment) 缺少 id。` };
    if (typeof o.coordinateSystemId !== "string")
      return {
        ok: false,
        error: `${where} (draw_coordinate_segment) 缺少 coordinateSystemId。`,
      };
    if (
      !Array.isArray(o.from) ||
      o.from.length !== 2 ||
      typeof o.from[0] !== "number" ||
      typeof o.from[1] !== "number" ||
      !Array.isArray(o.to) ||
      o.to.length !== 2 ||
      typeof o.to[0] !== "number" ||
      typeof o.to[1] !== "number"
    ) {
      return {
        ok: false,
        error: `${where} (draw_coordinate_segment) from/to 必须是 [x, y] 数字数组。`,
      };
    }
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (draw_coordinate_segment) width 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_coordinate_segment) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_coordinate_segment",
        id: o.id,
        coordinateSystemId: o.coordinateSystemId,
        from: [o.from[0], o.from[1]],
        to: [o.to[0], o.to[1]],
        color: typeof o.color === "string" ? o.color : "#64748b",
        width: typeof o.width === "number" ? o.width : 2,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_point") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_point) 缺少 id。` };
    if (typeof o.x !== "number" || typeof o.y !== "number")
      return { ok: false, error: `${where} (draw_point) x / y 必须是数字。` };
    if (o.label !== undefined && typeof o.label !== "string")
      return { ok: false, error: `${where} (draw_point) label 必须是字符串。` };
    if (
      o.labelPosition !== undefined &&
      o.labelPosition !== "top" &&
      o.labelPosition !== "right" &&
      o.labelPosition !== "bottom" &&
      o.labelPosition !== "left"
    ) {
      return {
        ok: false,
        error: `${where} (draw_point) labelPosition 必须是 top/right/bottom/left。`,
      };
    }
    if (o.radius !== undefined && typeof o.radius !== "number")
      return { ok: false, error: `${where} (draw_point) radius 必须是数字。` };
    if (o.fontSize !== undefined && typeof o.fontSize !== "number")
      return { ok: false, error: `${where} (draw_point) fontSize 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_point) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_point",
        id: o.id,
        x: o.x,
        y: o.y,
        label: typeof o.label === "string" ? o.label : undefined,
        labelPosition:
          o.labelPosition === "right" ||
          o.labelPosition === "bottom" ||
          o.labelPosition === "left" ||
          o.labelPosition === "top"
            ? o.labelPosition
            : "top",
        color: typeof o.color === "string" ? o.color : "#111111",
        radius: typeof o.radius === "number" ? o.radius : 4,
        fontSize: typeof o.fontSize === "number" ? o.fontSize : 18,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_segment") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_segment) 缺少 id。` };
    const from = readPoint(o.from, "from");
    if ("error" in from) return { ok: false, error: from.error };
    const to = readPoint(o.to, "to");
    if ("error" in to) return { ok: false, error: to.error };
    if (o.label !== undefined && typeof o.label !== "string")
      return { ok: false, error: `${where} (draw_segment) label 必须是字符串。` };
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (draw_segment) width 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_segment) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_segment",
        id: o.id,
        from,
        to,
        label: typeof o.label === "string" ? o.label : undefined,
        color: typeof o.color === "string" ? o.color : "#111111",
        width: typeof o.width === "number" ? o.width : 2,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_ray") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_ray) 缺少 id。` };
    const from = readPoint(o.from, "from");
    if ("error" in from) return { ok: false, error: from.error };
    const through = readPoint(o.through, "through");
    if ("error" in through) return { ok: false, error: through.error };
    if (o.length !== undefined && typeof o.length !== "number")
      return { ok: false, error: `${where} (draw_ray) length 必须是数字。` };
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (draw_ray) width 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_ray) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_ray",
        id: o.id,
        from,
        through,
        length: typeof o.length === "number" ? o.length : undefined,
        color: typeof o.color === "string" ? o.color : "#111111",
        width: typeof o.width === "number" ? o.width : 2,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "draw_angle") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (draw_angle) 缺少 id。` };
    const vertex = readPoint(o.vertex, "vertex");
    if ("error" in vertex) return { ok: false, error: vertex.error };
    const from = readPoint(o.from, "from");
    if ("error" in from) return { ok: false, error: from.error };
    const to = readPoint(o.to, "to");
    if ("error" in to) return { ok: false, error: to.error };
    if (o.radius !== undefined && typeof o.radius !== "number")
      return { ok: false, error: `${where} (draw_angle) radius 必须是数字。` };
    if (o.label !== undefined && typeof o.label !== "string")
      return { ok: false, error: `${where} (draw_angle) label 必须是字符串。` };
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (draw_angle) width 必须是数字。` };
    if (o.fontSize !== undefined && typeof o.fontSize !== "number")
      return { ok: false, error: `${where} (draw_angle) fontSize 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (draw_angle) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "draw_angle",
        id: o.id,
        vertex,
        from,
        to,
        radius: typeof o.radius === "number" ? o.radius : 34,
        label: typeof o.label === "string" ? o.label : undefined,
        color: typeof o.color === "string" ? o.color : "#2563eb",
        width: typeof o.width === "number" ? o.width : 3,
        fontSize: typeof o.fontSize === "number" ? o.fontSize : 18,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "mark_equal_segments" || type === "mark_parallel") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (${type}) 缺少 id。` };
    if (!Array.isArray(o.segments) || o.segments.length === 0) {
      return { ok: false, error: `${where} (${type}) segments 必须是非空数组。` };
    }
    const segments: Array<{ from: [number, number]; to: [number, number] }> = [];
    for (let j = 0; j < o.segments.length; j++) {
      const rawSegment = o.segments[j];
      if (!rawSegment || typeof rawSegment !== "object") {
        return { ok: false, error: `${where} (${type}) segments[${j}] 必须是对象。` };
      }
      const segment = rawSegment as Record<string, unknown>;
      const from = readPoint(segment.from, `segments[${j}].from`);
      if ("error" in from) return { ok: false, error: from.error };
      const to = readPoint(segment.to, `segments[${j}].to`);
      if ("error" in to) return { ok: false, error: to.error };
      segments.push({ from, to });
    }
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (${type}) width 必须是数字。` };
    if (o.size !== undefined && typeof o.size !== "number")
      return { ok: false, error: `${where} (${type}) size 必须是数字。` };
    if (type === "mark_equal_segments") {
      if (o.tickCount !== undefined && typeof o.tickCount !== "number")
        return { ok: false, error: `${where} (mark_equal_segments) tickCount 必须是数字。` };
    }
    if (type === "mark_parallel") {
      if (o.markCount !== undefined && typeof o.markCount !== "number")
        return { ok: false, error: `${where} (mark_parallel) markCount 必须是数字。` };
    }
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (${type}) 缺少 duration。` };
    if (type === "mark_equal_segments") {
      return {
        ok: true,
        command: {
          type: "mark_equal_segments",
          id: o.id,
          segments,
          tickCount: typeof o.tickCount === "number" ? o.tickCount : 1,
          color: typeof o.color === "string" ? o.color : "#ef4444",
          width: typeof o.width === "number" ? o.width : 2,
          size: typeof o.size === "number" ? o.size : 12,
          duration: o.duration,
          narration: typeof o.narration === "string" ? o.narration : undefined,
        },
      };
    }
    return {
      ok: true,
      command: {
        type: "mark_parallel",
        id: o.id,
        segments,
        markCount: typeof o.markCount === "number" ? o.markCount : 1,
        color: typeof o.color === "string" ? o.color : "#7c3aed",
        width: typeof o.width === "number" ? o.width : 2,
        size: typeof o.size === "number" ? o.size : 14,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "mark_perpendicular") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (mark_perpendicular) 缺少 id。` };
    const vertex = readPoint(o.vertex, "vertex");
    if ("error" in vertex) return { ok: false, error: vertex.error };
    const point1 = readPoint(o.point1, "point1");
    if ("error" in point1) return { ok: false, error: point1.error };
    const point2 = readPoint(o.point2, "point2");
    if ("error" in point2) return { ok: false, error: point2.error };
    if (o.size !== undefined && typeof o.size !== "number")
      return { ok: false, error: `${where} (mark_perpendicular) size 必须是数字。` };
    if (o.width !== undefined && typeof o.width !== "number")
      return { ok: false, error: `${where} (mark_perpendicular) width 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (mark_perpendicular) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "mark_perpendicular",
        id: o.id,
        vertex,
        point1,
        point2,
        size: typeof o.size === "number" ? o.size : 20,
        color: typeof o.color === "string" ? o.color : "#2563eb",
        width: typeof o.width === "number" ? o.width : 2,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "highlight_polygon") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (highlight_polygon) 缺少 id。` };
    if (!Array.isArray(o.points) || o.points.length < 3) {
      return { ok: false, error: `${where} (highlight_polygon) points 至少需要 3 个点。` };
    }
    const points: [number, number][] = [];
    for (let j = 0; j < o.points.length; j++) {
      const point = readPoint(o.points[j], `points[${j}]`);
      if ("error" in point) return { ok: false, error: point.error };
      points.push(point);
    }
    if (o.strokeWidth !== undefined && typeof o.strokeWidth !== "number")
      return { ok: false, error: `${where} (highlight_polygon) strokeWidth 必须是数字。` };
    if (o.fill !== undefined && typeof o.fill !== "string")
      return { ok: false, error: `${where} (highlight_polygon) fill 必须是字符串。` };
    if (o.fillOpacity !== undefined && typeof o.fillOpacity !== "number")
      return { ok: false, error: `${where} (highlight_polygon) fillOpacity 必须是数字。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (highlight_polygon) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "highlight_polygon",
        id: o.id,
        points,
        color: typeof o.color === "string" ? o.color : "#16a34a",
        strokeWidth: typeof o.strokeWidth === "number" ? o.strokeWidth : 2,
        fill: typeof o.fill === "string" ? o.fill : "#bbf7d0",
        fillOpacity: typeof o.fillOpacity === "number" ? o.fillOpacity : 0.24,
        duration: o.duration,
        narration: typeof o.narration === "string" ? o.narration : undefined,
      },
    };
  }

  if (type === "construct_geometry") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (construct_geometry) 缺少 id。` };
    if (!Array.isArray(o.points) || o.points.length === 0) {
      return { ok: false, error: `${where} (construct_geometry) points 必须是非空数组。` };
    }
    const points: GeometryPointSpec[] = [];
    const pointIds = new Set<string>();
    for (let j = 0; j < o.points.length; j++) {
      const rawPoint = o.points[j];
      if (!rawPoint || typeof rawPoint !== "object") {
        return { ok: false, error: `${where} (construct_geometry) points[${j}] 必须是对象。` };
      }
      const point = rawPoint as Record<string, unknown>;
      if (typeof point.id !== "string" || !point.id.trim()) {
        return { ok: false, error: `${where} (construct_geometry) points[${j}].id 必须是非空字符串。` };
      }
      if (pointIds.has(point.id)) {
        return { ok: false, error: `${where} (construct_geometry) 点 id "${point.id}" 重复。` };
      }
      pointIds.add(point.id);
      if (typeof point.x !== "number" || typeof point.y !== "number") {
        return { ok: false, error: `${where} (construct_geometry) points[${j}].x/y 必须是数字。` };
      }
      if (point.label !== undefined && typeof point.label !== "string") {
        return { ok: false, error: `${where} (construct_geometry) points[${j}].label 必须是字符串。` };
      }
      if (
        point.labelPosition !== undefined &&
        point.labelPosition !== "top" &&
        point.labelPosition !== "right" &&
        point.labelPosition !== "bottom" &&
        point.labelPosition !== "left"
      ) {
        return {
          ok: false,
          error: `${where} (construct_geometry) points[${j}].labelPosition 必须是 top/right/bottom/left。`,
        };
      }
      points.push({
        id: point.id,
        x: point.x,
        y: point.y,
        label: typeof point.label === "string" ? point.label : undefined,
        labelPosition:
          point.labelPosition === "top" ||
          point.labelPosition === "right" ||
          point.labelPosition === "bottom" ||
          point.labelPosition === "left"
            ? point.labelPosition
            : undefined,
      });
    }

    if (!Array.isArray(o.constructions)) {
      return {
        ok: false,
        error: `${where} (construct_geometry) constructions 必须是数组。`,
      };
    }
    const constructions: GeometryConstructionSpec[] = [];
    for (let j = 0; j < o.constructions.length; j++) {
      const rawConstruction = o.constructions[j];
      if (!rawConstruction || typeof rawConstruction !== "object") {
        return {
          ok: false,
          error: `${where} (construct_geometry) constructions[${j}] 必须是对象。`,
        };
      }
      const construction = rawConstruction as Record<string, unknown>;
      if (construction.kind === "segment") {
        if (construction.id !== undefined && typeof construction.id !== "string")
          return { ok: false, error: `${where} (construct_geometry) segment.id 必须是字符串。` };
        if (typeof construction.from !== "string" || typeof construction.to !== "string")
          return { ok: false, error: `${where} (construct_geometry) segment.from/to 必须是点 id 字符串。` };
        if (construction.dashed !== undefined && typeof construction.dashed !== "boolean")
          return { ok: false, error: `${where} (construct_geometry) segment.dashed 必须是布尔值。` };
        if (construction.width !== undefined && typeof construction.width !== "number")
          return { ok: false, error: `${where} (construct_geometry) segment.width 必须是数字。` };
        constructions.push({
          kind: "segment",
          id: typeof construction.id === "string" ? construction.id : undefined,
          from: construction.from,
          to: construction.to,
          dashed: typeof construction.dashed === "boolean" ? construction.dashed : undefined,
          color: typeof construction.color === "string" ? construction.color : undefined,
          width: typeof construction.width === "number" ? construction.width : undefined,
        });
        continue;
      }
      if (construction.kind === "circumcircle") {
        if (typeof construction.id !== "string")
          return { ok: false, error: `${where} (construct_geometry) circumcircle 缺少 id。` };
        if (
          !Array.isArray(construction.through) ||
          construction.through.length !== 3 ||
          construction.through.some((item) => typeof item !== "string")
        ) {
          return {
            ok: false,
            error: `${where} (construct_geometry) circumcircle.through 必须是 3 个点 id。`,
          };
        }
        if (construction.width !== undefined && typeof construction.width !== "number")
          return { ok: false, error: `${where} (construct_geometry) circumcircle.width 必须是数字。` };
        constructions.push({
          kind: "circumcircle",
          id: construction.id,
          through: construction.through as [string, string, string],
          color: typeof construction.color === "string" ? construction.color : undefined,
          width: typeof construction.width === "number" ? construction.width : undefined,
        });
        continue;
      }
      if (construction.kind === "perpendicular_projection") {
        if (typeof construction.id !== "string")
          return { ok: false, error: `${where} (construct_geometry) perpendicular_projection 缺少 id。` };
        if (typeof construction.point !== "string" || typeof construction.footId !== "string")
          return {
            ok: false,
            error: `${where} (construct_geometry) perpendicular_projection.point/footId 必须是字符串。`,
          };
        if (
          !Array.isArray(construction.line) ||
          construction.line.length !== 2 ||
          construction.line.some((item) => typeof item !== "string")
        ) {
          return {
            ok: false,
            error: `${where} (construct_geometry) perpendicular_projection.line 必须是 2 个点 id。`,
          };
        }
        if (
          construction.footLabelPosition !== undefined &&
          construction.footLabelPosition !== "top" &&
          construction.footLabelPosition !== "right" &&
          construction.footLabelPosition !== "bottom" &&
          construction.footLabelPosition !== "left"
        ) {
          return {
            ok: false,
            error: `${where} (construct_geometry) perpendicular_projection.footLabelPosition 必须是 top/right/bottom/left。`,
          };
        }
        constructions.push({
          kind: "perpendicular_projection",
          id: construction.id,
          point: construction.point,
          line: construction.line as [string, string],
          footId: construction.footId,
          footLabel: typeof construction.footLabel === "string" ? construction.footLabel : undefined,
          footLabelPosition:
            construction.footLabelPosition === "top" ||
            construction.footLabelPosition === "right" ||
            construction.footLabelPosition === "bottom" ||
            construction.footLabelPosition === "left"
              ? construction.footLabelPosition
              : undefined,
          drawSegment:
            typeof construction.drawSegment === "boolean" ? construction.drawSegment : undefined,
          markRightAngle:
            typeof construction.markRightAngle === "boolean"
              ? construction.markRightAngle
              : undefined,
          color: typeof construction.color === "string" ? construction.color : undefined,
          width: typeof construction.width === "number" ? construction.width : undefined,
        });
        continue;
      }
      if (construction.kind === "intersection") {
        if (typeof construction.id !== "string")
          return { ok: false, error: `${where} (construct_geometry) intersection 缺少 id。` };
        if (
          !Array.isArray(construction.lines) ||
          construction.lines.length !== 2 ||
          construction.lines.some(
            (line) =>
              !Array.isArray(line) ||
              line.length !== 2 ||
              line.some((item) => typeof item !== "string"),
          )
        ) {
          return {
            ok: false,
            error: `${where} (construct_geometry) intersection.lines 必须是两条点 id 直线。`,
          };
        }
        constructions.push({
          kind: "intersection",
          id: construction.id,
          lines: construction.lines as [[string, string], [string, string]],
          label: typeof construction.label === "string" ? construction.label : undefined,
          labelPosition:
            construction.labelPosition === "top" ||
            construction.labelPosition === "right" ||
            construction.labelPosition === "bottom" ||
            construction.labelPosition === "left"
              ? construction.labelPosition
              : undefined,
          color: typeof construction.color === "string" ? construction.color : undefined,
        });
        continue;
      }
      if (construction.kind === "highlight_polygon") {
        if (typeof construction.id !== "string")
          return { ok: false, error: `${where} (construct_geometry) highlight_polygon 缺少 id。` };
        if (!Array.isArray(construction.points) || construction.points.length < 3) {
          return {
            ok: false,
            error: `${where} (construct_geometry) highlight_polygon.points 至少需要 3 个点 id。`,
          };
        }
        if (construction.points.some((item) => typeof item !== "string")) {
          return {
            ok: false,
            error: `${where} (construct_geometry) highlight_polygon.points 必须都是点 id。`,
          };
        }
        constructions.push({
          kind: "highlight_polygon",
          id: construction.id,
          points: construction.points as string[],
          color: typeof construction.color === "string" ? construction.color : undefined,
          fill: typeof construction.fill === "string" ? construction.fill : undefined,
          fillOpacity:
            typeof construction.fillOpacity === "number" ? construction.fillOpacity : undefined,
        });
        continue;
      }
      return {
        ok: false,
        error: `${where} (construct_geometry) 不支持的 construction.kind。`,
      };
    }
    if (o.drawPoints !== undefined && typeof o.drawPoints !== "boolean")
      return { ok: false, error: `${where} (construct_geometry) drawPoints 必须是布尔值。` };
    if (o.duration !== undefined && typeof o.duration !== "number")
      return { ok: false, error: `${where} (construct_geometry) duration 必须是数字。` };
    return {
      ok: true,
      command: {
        type: "construct_geometry",
        id: o.id,
        points,
        constructions,
        drawPoints: typeof o.drawPoints === "boolean" ? o.drawPoints : undefined,
        pointColor: typeof o.pointColor === "string" ? o.pointColor : undefined,
        lineColor: typeof o.lineColor === "string" ? o.lineColor : undefined,
        duration: typeof o.duration === "number" ? o.duration : 360,
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

  if (type === "laser_pointer") {
    if (typeof o.id !== "string")
      return { ok: false, error: `${where} (laser_pointer) 缺少 id。` };
    if (typeof o.x !== "number" || typeof o.y !== "number")
      return { ok: false, error: `${where} (laser_pointer) x / y 必须是数字。` };
    let to: LaserPointerCommand["to"];
    if (o.to !== undefined) {
      if (!o.to || typeof o.to !== "object") {
        return { ok: false, error: `${where} (laser_pointer) to 必须是对象。` };
      }
      const target = o.to as Record<string, unknown>;
      if (typeof target.x !== "number" || typeof target.y !== "number") {
        return { ok: false, error: `${where} (laser_pointer) to.x / to.y 必须是数字。` };
      }
      to = { x: target.x, y: target.y };
    }
    let path: [number, number][] | undefined;
    if (o.path !== undefined) {
      if (!Array.isArray(o.path) || o.path.length < 2) {
        return {
          ok: false,
          error: `${where} (laser_pointer) path 必须是至少 2 个点的数组。`,
        };
      }
      path = [];
      for (let j = 0; j < o.path.length; j++) {
        const point = o.path[j];
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          typeof point[0] !== "number" ||
          typeof point[1] !== "number"
        ) {
          return {
            ok: false,
            error: `${where} (laser_pointer) path[${j}] 必须是 [number, number]。`,
          };
        }
        path.push([point[0], point[1]]);
      }
    }
    if (
      o.style !== undefined &&
      o.style !== "dot" &&
      o.style !== "pulse" &&
      o.style !== "ring" &&
      o.style !== "spotlight"
    ) {
      return {
        ok: false,
        error: `${where} (laser_pointer) style 必须是 dot/pulse/ring/spotlight。`,
      };
    }
    if (o.color !== undefined && typeof o.color !== "string")
      return { ok: false, error: `${where} (laser_pointer) color 必须是字符串。` };
    if (o.radius !== undefined && typeof o.radius !== "number")
      return { ok: false, error: `${where} (laser_pointer) radius 必须是数字。` };
    if (o.trail !== undefined && typeof o.trail !== "boolean")
      return { ok: false, error: `${where} (laser_pointer) trail 必须是布尔值。` };
    if (typeof o.duration !== "number")
      return { ok: false, error: `${where} (laser_pointer) 缺少 duration。` };
    return {
      ok: true,
      command: {
        type: "laser_pointer",
        id: o.id,
        x: o.x,
        y: o.y,
        to,
        path,
        style:
          o.style === "dot" ||
          o.style === "ring" ||
          o.style === "spotlight" ||
          o.style === "pulse"
            ? o.style
            : "pulse",
        color: typeof o.color === "string" ? o.color : "#ef4444",
        radius: typeof o.radius === "number" ? o.radius : 10,
        trail: typeof o.trail === "boolean" ? o.trail : undefined,
        duration: o.duration,
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
  if (cmd.type === "switch_page") {
    return `切换白板页 ${cmd.title ?? cmd.pageId}`;
  }
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
  if (cmd.type === "move_object") {
    return `移动对象 ${cmd.targetId}`;
  }
  if (cmd.type === "draw_coordinate_system") {
    return `画坐标系 ${cmd.xMin}..${cmd.xMax}, ${cmd.yMin}..${cmd.yMax}`;
  }
  if (cmd.type === "draw_function") {
    return `画函数 y=${cmd.expression}`;
  }
  if (cmd.type === "plot_point") {
    return `标点 (${cmd.x}, ${cmd.y})`;
  }
  if (cmd.type === "draw_coordinate_segment") {
    return `画坐标线段 (${cmd.from[0]},${cmd.from[1]}) → (${cmd.to[0]},${cmd.to[1]})`;
  }
  if (cmd.type === "draw_point") {
    return `画几何点 ${cmd.label ?? cmd.id}`;
  }
  if (cmd.type === "draw_segment") {
    return `画几何线段 (${cmd.from[0]},${cmd.from[1]}) → (${cmd.to[0]},${cmd.to[1]})`;
  }
  if (cmd.type === "draw_ray") {
    return `画射线 (${cmd.from[0]},${cmd.from[1]}) → (${cmd.through[0]},${cmd.through[1]})`;
  }
  if (cmd.type === "draw_angle") {
    return `标角 ${cmd.label ?? cmd.id}`;
  }
  if (cmd.type === "mark_equal_segments") {
    return `标等长线段 ${cmd.segments.length} 条`;
  }
  if (cmd.type === "mark_parallel") {
    return `标平行线段 ${cmd.segments.length} 条`;
  }
  if (cmd.type === "mark_perpendicular") {
    return "标垂直直角";
  }
  if (cmd.type === "highlight_polygon") {
    return `高亮几何区域 ${cmd.points.length} 个点`;
  }
  if (cmd.type === "construct_geometry") {
    return `几何构造 ${cmd.constructions.length} 步`;
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
  if (cmd.type === "laser_pointer") {
    return `激光笔指示 (${cmd.x}, ${cmd.y})`;
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
