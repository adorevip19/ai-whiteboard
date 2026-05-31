import type { WhiteboardCommand, WhiteboardScript } from "./commandTypes";

export type CanvasAspect = "landscape" | "portrait";

export const LANDSCAPE_CANVAS = { width: 1200, height: 800 };
export const PORTRAIT_CANVAS = { width: 720, height: 1280 };

export function normalizeCanvasAspect(value: unknown): CanvasAspect {
  return value === "portrait" || value === "9:16" || value === "vertical"
    ? "portrait"
    : "landscape";
}

export function canvasSizeForAspect(aspect: CanvasAspect) {
  return aspect === "portrait" ? PORTRAIT_CANVAS : LANDSCAPE_CANVAS;
}

function scaleNumber(value: unknown, scale: number) {
  return typeof value === "number" && Number.isFinite(value) ? value * scale : value;
}

function scalePoint(value: unknown, scaleX: number, scaleY: number) {
  return Array.isArray(value) && value.length === 2
    ? [scaleNumber(value[0], scaleX), scaleNumber(value[1], scaleY)]
    : value;
}

function scaleRectObject(value: unknown, scaleX: number, scaleY: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const rect = { ...(value as Record<string, unknown>) };
  rect.x = scaleNumber(rect.x, scaleX);
  rect.y = scaleNumber(rect.y, scaleY);
  rect.width = scaleNumber(rect.width, scaleX);
  rect.height = scaleNumber(rect.height, scaleY);
  return rect;
}

function scaleStroke(value: unknown, scale: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, value * scale) : value;
}

function scaleCommand(command: WhiteboardCommand, scaleX: number, scaleY: number): WhiteboardCommand {
  const scaleFont = Math.max(0.55, Math.min(scaleX, scaleY));
  const scaleStrokeSize = Math.max(0.65, Math.min(scaleX, scaleY));
  const copy = { ...(command as unknown as Record<string, unknown>) };

  copy.x = scaleNumber(copy.x, scaleX);
  copy.y = scaleNumber(copy.y, scaleY);
  copy.cx = scaleNumber(copy.cx, scaleX);
  copy.cy = scaleNumber(copy.cy, scaleY);
  copy.fontSize = scaleNumber(copy.fontSize, scaleFont);
  copy.radius = scaleNumber(copy.radius, scaleStrokeSize);
  copy.rx = scaleNumber(copy.rx, scaleX);
  copy.ry = scaleNumber(copy.ry, scaleY);
  copy.from = scalePoint(copy.from, scaleX, scaleY);
  copy.to = scalePoint(copy.to, scaleX, scaleY);
  copy.vertex = scalePoint(copy.vertex, scaleX, scaleY);
  copy.point1 = scalePoint(copy.point1, scaleX, scaleY);
  copy.point2 = scalePoint(copy.point2, scaleX, scaleY);
  copy.through = scalePoint(copy.through, scaleX, scaleY);
  copy.points = Array.isArray(copy.points)
    ? copy.points.map((point) => scalePoint(point, scaleX, scaleY))
    : copy.points;
  copy.bbox = scaleRectObject(copy.bbox, scaleX, scaleY);

  if (copy.to && typeof copy.to === "object" && !Array.isArray(copy.to)) {
    copy.to = scaleRectObject(copy.to, scaleX, scaleY);
  }
  if (copy.by && typeof copy.by === "object" && !Array.isArray(copy.by)) {
    const by = { ...(copy.by as Record<string, unknown>) };
    by.dx = scaleNumber(by.dx, scaleX);
    by.dy = scaleNumber(by.dy, scaleY);
    copy.by = by;
  }

  switch (command.type) {
    case "set_canvas":
      return command as WhiteboardCommand;
    case "draw_image":
    case "draw_rectangle":
    case "draw_coordinate_system":
    case "write_paragraph":
    case "revision_compare":
      copy.width = scaleNumber(copy.width, scaleX);
      copy.height = scaleNumber(copy.height, scaleY);
      break;
    case "draw_line":
    case "draw_arrow":
    case "draw_path":
    case "draw_arc_arrow":
    case "draw_brace":
    case "draw_segment":
    case "draw_ray":
    case "draw_angle":
    case "mark_equal_segments":
    case "mark_parallel":
    case "mark_perpendicular":
    case "annotate_underline":
    case "annotate_circle":
    case "annotate_object":
    case "annotate_math_bbox":
    case "emphasize_text":
      copy.width = scaleStroke(copy.width, scaleStrokeSize);
      break;
  }

  return copy as unknown as WhiteboardCommand;
}

export function applyCanvasAspect(script: WhiteboardScript, aspect: CanvasAspect): WhiteboardScript {
  const target = canvasSizeForAspect(aspect);
  const sourceWidth = script.canvas.width || target.width;
  const sourceHeight = script.canvas.height || target.height;
  if (sourceWidth === target.width && sourceHeight === target.height) {
    return script;
  }
  const scaleX = target.width / sourceWidth;
  const scaleY = target.height / sourceHeight;
  return {
    ...script,
    canvas: {
      ...script.canvas,
      width: target.width,
      height: target.height,
    },
    commands: script.commands.map((command) => scaleCommand(command, scaleX, scaleY)),
  };
}
