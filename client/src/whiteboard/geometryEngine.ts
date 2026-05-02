import type { WhiteboardCommand } from "./commandTypes";

export type GeometryPointSpec = {
  id: string;
  x: number;
  y: number;
  label?: string;
  labelPosition?: "top" | "right" | "bottom" | "left";
};

export type GeometryConstructionSpec =
  | {
      kind: "segment";
      id?: string;
      from: string;
      to: string;
      dashed?: boolean;
      color?: string;
      width?: number;
    }
  | {
      kind: "circumcircle";
      id: string;
      through: [string, string, string];
      color?: string;
      width?: number;
    }
  | {
      kind: "perpendicular_projection";
      id: string;
      point: string;
      line: [string, string];
      footId: string;
      footLabel?: string;
      footLabelPosition?: "top" | "right" | "bottom" | "left";
      drawSegment?: boolean;
      markRightAngle?: boolean;
      color?: string;
      width?: number;
    }
  | {
      kind: "intersection";
      id: string;
      lines: [[string, string], [string, string]];
      label?: string;
      labelPosition?: "top" | "right" | "bottom" | "left";
      color?: string;
    }
  | {
      kind: "highlight_polygon";
      id: string;
      points: string[];
      color?: string;
      fill?: string;
      fillOpacity?: number;
    };

type Point = [number, number];

export const GEOMETRY_ENGINE_NAME = "JSXGraph-assisted geometry";

let jsxGraphReady: Promise<unknown> | null = null;

export function warmupJsxGraphGeometryEngine() {
  if (typeof window === "undefined") return Promise.resolve(null);
  jsxGraphReady ??= import("jsxgraph").catch(() => null);
  return jsxGraphReady;
}

function getPoint(points: Map<string, Point>, id: string): Point {
  const point = points.get(id);
  if (!point) throw new Error(`construct_geometry 找不到点 "${id}"。`);
  return point;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function lineIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point {
  const x1 = a1[0];
  const y1 = a1[1];
  const x2 = a2[0];
  const y2 = a2[1];
  const x3 = b1[0];
  const y3 = b1[1];
  const x4 = b2[0];
  const y4 = b2[1];
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-8) {
    throw new Error("construct_geometry 两条直线平行或重合，无法求交点。");
  }
  return [
    ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / den,
    ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / den,
  ];
}

function perpendicularProjection(point: Point, lineA: Point, lineB: Point): Point {
  const vx = lineB[0] - lineA[0];
  const vy = lineB[1] - lineA[1];
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-8) throw new Error("construct_geometry 垂足所在直线退化为一个点。");
  const t = ((point[0] - lineA[0]) * vx + (point[1] - lineA[1]) * vy) / len2;
  return [lineA[0] + vx * t, lineA[1] + vy * t];
}

function circumcircle(a: Point, b: Point, c: Point) {
  const d =
    2 *
    (a[0] * (b[1] - c[1]) +
      b[0] * (c[1] - a[1]) +
      c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-8) {
    throw new Error("construct_geometry 三点近似共线，无法确定外接圆。");
  }
  const ux =
    ((a[0] * a[0] + a[1] * a[1]) * (b[1] - c[1]) +
      (b[0] * b[0] + b[1] * b[1]) * (c[1] - a[1]) +
      (c[0] * c[0] + c[1] * c[1]) * (a[1] - b[1])) /
    d;
  const uy =
    ((a[0] * a[0] + a[1] * a[1]) * (c[0] - b[0]) +
      (b[0] * b[0] + b[1] * b[1]) * (a[0] - c[0]) +
      (c[0] * c[0] + c[1] * c[1]) * (b[0] - a[0])) /
    d;
  const center: Point = [ux, uy];
  return { center, radius: distance(center, a) };
}

function dashedSegments(
  id: string,
  from: Point,
  to: Point,
  color: string,
  width: number,
  duration: number,
) {
  const parts = Math.max(6, Math.round(distance(from, to) / 42));
  const commands: WhiteboardCommand[] = [];
  for (let i = 0; i < parts; i++) {
    if (i % 2 === 1) continue;
    const t1 = i / parts;
    const t2 = Math.min((i + 0.72) / parts, 1);
    commands.push({
      type: "draw_segment",
      id: `${id}_${i}`,
      from: [from[0] + (to[0] - from[0]) * t1, from[1] + (to[1] - from[1]) * t1],
      to: [from[0] + (to[0] - from[0]) * t2, from[1] + (to[1] - from[1]) * t2],
      color,
      width,
      duration,
    });
  }
  return commands;
}

export function expandConstructGeometryCommand(command: {
  id: string;
  points: GeometryPointSpec[];
  constructions: GeometryConstructionSpec[];
  drawPoints?: boolean;
  pointColor?: string;
  lineColor?: string;
  duration?: number;
}): WhiteboardCommand[] {
  const points = new Map<string, Point>();
  const commands: WhiteboardCommand[] = [];
  const duration = command.duration ?? 360;
  const lineColor = command.lineColor ?? "#111111";

  for (const point of command.points) {
    points.set(point.id, [point.x, point.y]);
  }

  for (const construction of command.constructions) {
    if (construction.kind === "circumcircle") {
      const circle = circumcircle(
        getPoint(points, construction.through[0]),
        getPoint(points, construction.through[1]),
        getPoint(points, construction.through[2]),
      );
      commands.push({
        type: "draw_circle",
        id: construction.id,
        cx: circle.center[0],
        cy: circle.center[1],
        radius: circle.radius,
        color: construction.color ?? "#334155",
        strokeWidth: construction.width ?? 4,
        duration: Math.max(duration * 1.5, 500),
      });
      continue;
    }

    if (construction.kind === "segment") {
      const from = getPoint(points, construction.from);
      const to = getPoint(points, construction.to);
      if (construction.dashed) {
        commands.push(
          ...dashedSegments(
            construction.id ?? `${command.id}_${construction.from}_${construction.to}`,
            from,
            to,
            construction.color ?? lineColor,
            construction.width ?? 2,
            Math.max(duration * 0.25, 70),
          ),
        );
      } else {
        commands.push({
          type: "draw_segment",
          id: construction.id ?? `${command.id}_${construction.from}_${construction.to}`,
          from,
          to,
          color: construction.color ?? lineColor,
          width: construction.width ?? 3,
          duration,
        });
      }
      continue;
    }

    if (construction.kind === "perpendicular_projection") {
      const source = getPoint(points, construction.point);
      const lineA = getPoint(points, construction.line[0]);
      const lineB = getPoint(points, construction.line[1]);
      const foot = perpendicularProjection(source, lineA, lineB);
      points.set(construction.footId, foot);
      if (construction.drawSegment ?? true) {
        commands.push({
          type: "draw_segment",
          id: construction.id,
          from: source,
          to: foot,
          color: construction.color ?? lineColor,
          width: construction.width ?? 3,
          duration,
        });
      }
      if (construction.markRightAngle ?? true) {
        commands.push({
          type: "mark_perpendicular",
          id: `${construction.id}_right`,
          vertex: foot,
          point1: source,
          point2: lineB,
          color: "#2563eb",
          width: 2,
          size: 20,
          duration: Math.max(duration * 0.6, 180),
        });
      }
      if (construction.footLabel) {
        commands.push({
          type: "draw_point",
          id: `pt_${construction.footId}`,
          x: foot[0],
          y: foot[1],
          label: construction.footLabel,
          labelPosition: construction.footLabelPosition ?? "bottom",
          color: command.pointColor ?? "#111111",
          duration: Math.max(duration * 0.5, 160),
        });
      }
      continue;
    }

    if (construction.kind === "intersection") {
      const p = lineIntersection(
        getPoint(points, construction.lines[0][0]),
        getPoint(points, construction.lines[0][1]),
        getPoint(points, construction.lines[1][0]),
        getPoint(points, construction.lines[1][1]),
      );
      points.set(construction.id, p);
      commands.push({
        type: "draw_point",
        id: `pt_${construction.id}`,
        x: p[0],
        y: p[1],
        label: construction.label ?? construction.id,
        labelPosition: construction.labelPosition ?? "top",
        color: construction.color ?? command.pointColor ?? "#111111",
        duration: Math.max(duration * 0.5, 160),
      });
      continue;
    }

    if (construction.kind === "highlight_polygon") {
      commands.push({
        type: "highlight_polygon",
        id: construction.id,
        points: construction.points.map((id) => getPoint(points, id)),
        color: construction.color ?? "#2563eb",
        fill: construction.fill ?? "#bfdbfe",
        fillOpacity: construction.fillOpacity ?? 0.22,
        duration,
      });
    }
  }

  if (command.drawPoints ?? true) {
    for (const point of command.points) {
      const [x, y] = getPoint(points, point.id);
      commands.push({
        type: "draw_point",
        id: `pt_${point.id}`,
        x,
        y,
        label: point.label ?? point.id,
        labelPosition: point.labelPosition ?? "top",
        color: command.pointColor ?? "#111111",
        duration: Math.max(duration * 0.45, 140),
      });
    }
  }

  return commands;
}
