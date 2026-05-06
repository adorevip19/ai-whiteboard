// SVG-based whiteboard canvas. SVG is preferred over Canvas2D here because
// shape elements (text/lines) keep their identity, can be cleanly animated,
// and re-render declaratively from React state.
import { useEffect, useRef, useState } from "react";
import type {
  AnnotationElement,
  CanvasConfig,
  LayoutPageTheme,
  RenderedElement,
} from "./commandTypes";
import {
  WHITEBOARD_MONO_FONT_FAMILY,
  WHITEBOARD_TEXT_FONT_FAMILY,
} from "./fonts";
import { MathRenderer } from "./MathRenderer";
import { cn } from "@/lib/utils";

interface Props {
  canvas: CanvasConfig;
  elements: RenderedElement[];
  annotations: AnnotationElement[];
  allowUpscale?: boolean;
  fullBleed?: boolean;
}

function takeVisibleLines(lines: string[], visibleChars: number) {
  let remaining = visibleChars;
  return lines.map((line) => {
    const chars = Array.from(line);
    const count = Math.max(0, Math.min(chars.length, remaining));
    remaining -= count;
    return chars.slice(0, count).join("");
  });
}

function layoutTheme(theme: LayoutPageTheme) {
  if (theme === "warm") {
    return { accent: "#d97706", fill: "#fffbeb", stroke: "#f3d08a", title: "#7c2d12" };
  }
  if (theme === "cool") {
    return { accent: "#2563eb", fill: "#eff6ff", stroke: "#bfdbfe", title: "#1e3a8a" };
  }
  if (theme === "green") {
    return { accent: "#16a34a", fill: "#f0fdf4", stroke: "#bbf7d0", title: "#14532d" };
  }
  return { accent: "#334155", fill: "#f8fafc", stroke: "#d8e0ea", title: "#111827" };
}

export function WhiteboardCanvas({
  canvas,
  elements,
  annotations,
  allowUpscale = false,
  fullBleed = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  // Compute scale so the canvas fits its container while keeping
  // internal coordinates at the original (canvas.width × canvas.height).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const compute = () => {
      const rect = el.getBoundingClientRect();
      const inset = fullBleed ? 0 : 8;
      const availW = Math.max(rect.width - inset, 100);
      const availH = Math.max(rect.height - inset, 100);
      const maxScale = allowUpscale ? Number.POSITIVE_INFINITY : 1;
      const s = Math.min(availW / canvas.width, availH / canvas.height, maxScale);
      setScale(s);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [allowUpscale, canvas.width, canvas.height, fullBleed]);

  const displayW = canvas.width * scale;
  const displayH = canvas.height * scale;
  const elementTransform = (el: RenderedElement) =>
    el.transform
      ? `translate(${el.transform.translateX} ${el.transform.translateY})`
      : undefined;

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full w-full items-center justify-center overflow-hidden",
        fullBleed ? "bg-background p-0" : "bg-transparent p-0",
      )}
      data-testid="whiteboard-container"
    >
      <svg
        width={displayW}
        height={displayH}
        viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        className={cn(fullBleed ? "" : "rounded-lg border border-border/70 shadow-xl")}
        style={{ background: canvas.background }}
        data-testid="whiteboard-svg"
      >
        {elements.map((el) => {
          const transform = elementTransform(el);
          if (el.kind === "layout") {
            const theme = layoutTheme(el.theme);
            return (
              <g key={el.id} transform={transform} opacity={el.progress} data-testid={`layout-${el.id}`}>
                <rect x={0} y={0} width={canvas.width} height={canvas.height} fill="#ffffff" />
                <rect x={42} y={38} width={8} height={52} rx={4} fill={theme.accent} />
                {el.title ? (
                  <text
                    x={70}
                    y={72}
                    fill={theme.title}
                    fontSize={38}
                    fontWeight={700}
                    fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}
                  >
                    {el.title}
                  </text>
                ) : null}
                {el.subtitle ? (
                  <text
                    x={72}
                    y={108}
                    fill="#64748b"
                    fontSize={20}
                    fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}
                  >
                    {el.subtitle}
                  </text>
                ) : null}
                {el.slots.map((slot) => (
                  <g key={`${el.id}-${slot.id}`}>
                    <rect
                      x={slot.x}
                      y={slot.y}
                      width={slot.width}
                      height={slot.height}
                      rx={8}
                      fill={theme.fill}
                      stroke={theme.stroke}
                      strokeWidth={1.5}
                    />
                  </g>
                ))}
              </g>
            );
          }
          if (el.kind === "paragraph") {
            const clipId = `clip-paragraph-${el.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
            const visibleLines = takeVisibleLines(el.lines, el.visibleChars);
            const maxLines = Math.max(1, Math.floor((el.height - el.padding * 2) / el.lineGap));
            return (
              <g key={el.id} transform={transform} data-testid={`paragraph-${el.id}`}>
                <defs>
                  <clipPath id={clipId}>
                    <rect x={el.x} y={el.y} width={el.width} height={el.height} rx={8} />
                  </clipPath>
                </defs>
                <g clipPath={`url(#${clipId})`}>
                  {visibleLines.slice(0, maxLines).map((line, index) => (
                    <text
                      key={`${el.id}-${index}`}
                      x={el.x + el.padding}
                      y={el.y + el.padding + el.fontSize + index * el.lineGap}
                      fill={el.color}
                      fontSize={el.fontSize}
                      fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}
                      dominantBaseline="alphabetic"
                    >
                      {line}
                    </text>
                  ))}
                </g>
              </g>
            );
          }
          if (el.kind === "revision_compare") {
            const visibleBefore = takeVisibleLines(el.beforeLines, el.visibleBeforeChars);
            const visibleAfter = takeVisibleLines(el.afterLines, el.visibleAfterChars);
            const visibleNote = takeVisibleLines(el.noteLines, el.visibleNoteChars);
            const gap = 26;
            const noteH = el.note ? Math.min(92, el.height * 0.24) : 0;
            const bodyH = el.height - noteH - (el.note ? 18 : 0);
            const cardW = (el.width - gap) / 2;
            const leftX = el.x;
            const rightX = el.x + cardW + gap;
            const noteY = el.y + bodyH + 18;
            const arrowY = el.y + bodyH / 2;
            const lineGap = el.fontSize * 1.55;
            const maxCardLines = Math.max(1, Math.floor((bodyH - 72) / lineGap));
            return (
              <g key={el.id} transform={transform} opacity={el.progress} data-testid={`revision-compare-${el.id}`}>
                <rect x={leftX} y={el.y} width={cardW} height={bodyH} rx={8} fill="#fff7ed" stroke="#fed7aa" strokeWidth={1.5} />
                <rect x={rightX} y={el.y} width={cardW} height={bodyH} rx={8} fill="#f0fdf4" stroke="#bbf7d0" strokeWidth={1.5} />
                <text x={leftX + 18} y={el.y + 34} fill="#c2410c" fontSize={17} fontWeight={700} fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}>{el.beforeTitle}</text>
                <text x={rightX + 18} y={el.y + 34} fill="#15803d" fontSize={17} fontWeight={700} fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}>{el.afterTitle}</text>
                <line x1={leftX + cardW + 8} y1={arrowY} x2={rightX - 8} y2={arrowY} stroke="#64748b" strokeWidth={2.5} strokeLinecap="round" />
                <polyline points={`${rightX - 18},${arrowY - 8} ${rightX - 8},${arrowY} ${rightX - 18},${arrowY + 8}`} fill="none" stroke="#64748b" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                {visibleBefore.slice(0, maxCardLines).map((line, index) => (
                  <text key={`${el.id}-before-${index}`} x={leftX + 22} y={el.y + 78 + index * lineGap} fill="#111827" fontSize={el.fontSize} fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}>{line}</text>
                ))}
                {visibleAfter.slice(0, maxCardLines).map((line, index) => (
                  <text key={`${el.id}-after-${index}`} x={rightX + 22} y={el.y + 78 + index * lineGap} fill="#111827" fontSize={el.fontSize} fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}>{line}</text>
                ))}
                {el.note ? (
                  <g>
                    <rect x={el.x} y={noteY} width={el.width} height={noteH} rx={8} fill="#f8fafc" stroke="#d8e0ea" strokeWidth={1.5} />
                    <text x={el.x + 18} y={noteY + 28} fill="#334155" fontSize={16} fontWeight={700} fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}>点评</text>
                    {visibleNote.slice(0, 2).map((line, index) => (
                      <text key={`${el.id}-note-${index}`} x={el.x + 72} y={noteY + 30 + index * 26} fill="#334155" fontSize={Math.max(20, el.fontSize - 4)} fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}>{line}</text>
                    ))}
                  </g>
                ) : null}
              </g>
            );
          }
          if (el.kind === "math") {
            return (
              <foreignObject
                key={el.id}
                x={el.x}
                y={el.y}
                width={el.bbox.width}
                height={el.bbox.height}
                transform={transform}
                opacity={el.opacity}
                data-testid={`math-${el.id}`}
              >
                <div>
                  <MathRenderer
                    latex={el.latex}
                    fontSize={el.fontSize}
                    color={el.color}
                    displayMode={el.displayMode}
                  />
                </div>
              </foreignObject>
            );
          }
          if (el.kind === "math_steps") {
            return (
              <foreignObject
                key={el.id}
                x={el.x}
                y={el.y}
                width={el.bbox.width}
                height={el.bbox.height}
                transform={transform}
                data-testid={`math-steps-${el.id}`}
              >
                <div>
                  {el.steps.map((step, index) => (
                    <div
                      key={`${el.id}-${index}`}
                      style={{
                        height: el.lineGap,
                        opacity: index < el.visibleCount ? 1 : 0,
                        transition: "opacity 120ms linear",
                      }}
                    >
                      <MathRenderer
                        latex={step}
                        fontSize={el.fontSize}
                        color={el.color}
                        displayMode={el.displayMode}
                      />
                    </div>
                  ))}
                </div>
              </foreignObject>
            );
          }
          if (el.kind === "division_layout") {
            const digitW = el.fontSize * 0.64;
            const left = el.x;
            const top = el.y;
            const bracketX = left + digitW * 1.6;
            const dividendX = bracketX + digitW * 0.8;
            const quotientY = top + el.fontSize;
            const lineY = top + el.fontSize * 1.35;
            const dividendY = top + el.fontSize * 2.25;
            const productY = top + el.fontSize * 3.2;
            const subtractY = top + el.fontSize * 3.55;
            const remainderY = top + el.fontSize * 4.45;
            const bodyW = Math.max(el.dividend.length, el.product.length, el.remainder.length, el.quotient.length) * digitW;
            const textProps = {
              fill: el.color,
              fontSize: el.fontSize,
              fontFamily: WHITEBOARD_MONO_FONT_FAMILY,
              dominantBaseline: "alphabetic",
            } as const;

            return (
              <g key={el.id} transform={transform} data-testid={`division-${el.id}`}>
                <text x={dividendX + bodyW - el.quotient.length * digitW} y={quotientY} {...textProps} opacity={el.stage >= 1 ? 1 : 0}>
                  {el.quotient}
                </text>
                <line x1={bracketX + digitW * 0.5} y1={lineY} x2={dividendX + bodyW + digitW * 0.25} y2={lineY} stroke={el.color} strokeWidth={2} opacity={el.stage >= 1 ? 1 : 0} />
                <path d={`M ${bracketX + digitW * 0.5} ${lineY} Q ${bracketX} ${lineY + el.fontSize * 0.45} ${bracketX + digitW * 0.5} ${dividendY + el.fontSize * 0.2}`} fill="none" stroke={el.color} strokeWidth={2} opacity={el.stage >= 1 ? 1 : 0} />
                <text x={left} y={dividendY} {...textProps} opacity={el.stage >= 1 ? 1 : 0}>
                  {el.divisor}
                </text>
                <text x={dividendX} y={dividendY} {...textProps} opacity={el.stage >= 1 ? 1 : 0}>
                  {el.dividend}
                </text>
                <text x={dividendX + bodyW - el.product.length * digitW} y={productY} {...textProps} opacity={el.stage >= 2 ? 1 : 0}>
                  {el.product}
                </text>
                <line x1={dividendX - digitW * 0.1} y1={subtractY} x2={dividendX + bodyW + digitW * 0.2} y2={subtractY} stroke={el.color} strokeWidth={2} opacity={el.stage >= 3 ? 1 : 0} />
                <text x={dividendX + bodyW - el.remainder.length * digitW} y={remainderY} {...textProps} opacity={el.stage >= 4 ? 1 : 0}>
                  {el.remainder}
                </text>
              </g>
            );
          }
          if (el.kind === "text_segments") {
            return (
              <g key={el.id} transform={transform} data-testid={`text-segments-${el.id}`}>
                {el.segments.map((segment, index) => (
                  <text
                    key={segment.id ?? `${el.id}-${index}`}
                    x={segment.x}
                    y={segment.y}
                    fontSize={segment.fontSize}
                    fill={segment.color}
                    fontWeight={segment.fontWeight}
                    fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}
                    dominantBaseline="alphabetic"
                    data-testid={
                      segment.id
                        ? `text-segment-${el.id}-${segment.id}`
                        : `text-segment-${el.id}-${index}`
                    }
                  >
                    {segment.visibleText}
                  </text>
                ))}
              </g>
            );
          }
          if (el.kind === "line") {
            return (
              <line
                key={el.id}
                x1={el.from[0]}
                y1={el.from[1]}
                x2={el.currentEnd[0]}
                y2={el.currentEnd[1]}
                transform={transform}
                stroke={el.color}
                strokeWidth={el.width}
                strokeLinecap="round"
                data-testid={`line-${el.id}`}
              />
            );
          }
          if (el.kind === "arrow") {
            const [x1, y1] = el.from;
            const [x2, y2] = el.currentEnd;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const length = Math.hypot(dx, dy);
            const angle = (el.headAngle * Math.PI) / 180;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const ux = length > 0 ? dx / length : 0;
            const uy = length > 0 ? dy / length : 0;
            const left: [number, number] = [
              x2 - el.headSize * (ux * cos - uy * sin),
              y2 - el.headSize * (uy * cos + ux * sin),
            ];
            const right: [number, number] = [
              x2 - el.headSize * (ux * cos + uy * sin),
              y2 - el.headSize * (uy * cos - ux * sin),
            ];

            return (
              <g key={el.id} transform={transform} data-testid={`arrow-${el.id}`}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={el.color}
                  strokeWidth={el.width}
                  strokeLinecap="round"
                />
                {length > 0 ? (
                  <polyline
                    points={`${left[0]},${left[1]} ${x2},${y2} ${right[0]},${right[1]}`}
                    fill="none"
                    stroke={el.color}
                    strokeWidth={el.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
              </g>
            );
          }
          if (el.kind === "path") {
            return (
              <polyline
                key={el.id}
                points={el.currentPoints.map(([x, y]) => `${x},${y}`).join(" ")}
                transform={transform}
                fill="none"
                stroke={el.color}
                strokeWidth={el.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                data-testid={`path-${el.id}`}
              />
            );
          }
          if (el.kind === "shape") {
            const arrow = el.arrowHead;
            let arrowPoints = "";
            if (arrow?.visible) {
              const angle = (arrow.headAngle * Math.PI) / 180;
              const ux = Math.cos(arrow.angle);
              const uy = Math.sin(arrow.angle);
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              const [x, y] = arrow.tip;
              const left: [number, number] = [
                x - arrow.size * (ux * cos - uy * sin),
                y - arrow.size * (uy * cos + ux * sin),
              ];
              const right: [number, number] = [
                x - arrow.size * (ux * cos + uy * sin),
                y - arrow.size * (uy * cos - ux * sin),
              ];
              arrowPoints = `${left[0]},${left[1]} ${x},${y} ${right[0]},${right[1]}`;
            }

            return (
              <g key={el.id} transform={transform} data-testid={`shape-${el.id}`}>
                <path
                  d={el.pathD}
                  fill={el.fill ?? "none"}
                  fillOpacity={el.fill ? (el.progress >= 1 ? el.fillOpacity ?? 0.12 : 0) : 0}
                  stroke={el.color}
                  strokeWidth={el.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - el.progress}
                />
                {arrow?.visible ? (
                  <polyline
                    points={arrowPoints}
                    fill="none"
                    stroke={el.color}
                    strokeWidth={el.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
              </g>
            );
          }
          if (el.kind === "brace_glyph") {
            const rotationTransform =
              el.rotation === 0
                ? undefined
                : `rotate(${el.rotation} ${el.x} ${el.y})`;
            const transform =
              [elementTransform(el), rotationTransform].filter(Boolean).join(" ") ||
              undefined;
            return (
              <text
                key={el.id}
                x={el.x}
                y={el.y}
                transform={transform}
                opacity={el.progress}
                fill={el.color}
                fontSize={el.fontSize}
                fontFamily="Georgia, 'Times New Roman', ui-serif, serif"
                fontWeight={400}
                textAnchor="middle"
                dominantBaseline="central"
                data-testid={`brace-${el.id}`}
              >
                {el.glyph}
              </text>
            );
          }
          if (el.kind === "coordinate_system") {
            const xAxisY =
              el.yMin <= 0 && el.yMax >= 0
                ? el.y + el.height - ((0 - el.yMin) / (el.yMax - el.yMin)) * el.height
                : el.y + el.height;
            const yAxisX =
              el.xMin <= 0 && el.xMax >= 0
                ? el.x + ((0 - el.xMin) / (el.xMax - el.xMin)) * el.width
                : el.x;
            const toCanvasX = (value: number) =>
              el.x + ((value - el.xMin) / (el.xMax - el.xMin)) * el.width;
            const toCanvasY = (value: number) =>
              el.y + el.height - ((value - el.yMin) / (el.yMax - el.yMin)) * el.height;

            return (
              <g
                key={el.id}
                transform={transform}
                opacity={el.progress}
                data-testid={`coordinate-system-${el.id}`}
              >
                <rect
                  x={el.x}
                  y={el.y}
                  width={el.width}
                  height={el.height}
                  fill="none"
                  stroke={el.gridColor}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                {el.grid
                  ? el.xTicks.map((tick) => (
                      <line
                        key={`${el.id}-xgrid-${tick}`}
                        x1={toCanvasX(tick)}
                        y1={el.y}
                        x2={toCanvasX(tick)}
                        y2={el.y + el.height}
                        stroke={el.gridColor}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))
                  : null}
                {el.grid
                  ? el.yTicks.map((tick) => (
                      <line
                        key={`${el.id}-ygrid-${tick}`}
                        x1={el.x}
                        y1={toCanvasY(tick)}
                        x2={el.x + el.width}
                        y2={toCanvasY(tick)}
                        stroke={el.gridColor}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))
                  : null}
                <line
                  x1={el.x}
                  y1={xAxisY}
                  x2={el.x + el.width}
                  y2={xAxisY}
                  stroke={el.axisColor}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={yAxisX}
                  y1={el.y}
                  x2={yAxisX}
                  y2={el.y + el.height}
                  stroke={el.axisColor}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                {el.showLabels
                  ? el.xTicks.map((tick) => (
                      <text
                        key={`${el.id}-xlabel-${tick}`}
                        x={toCanvasX(tick)}
                        y={Math.min(el.y + el.height + el.fontSize + 5, canvas.height - 4)}
                        textAnchor="middle"
                        fontSize={el.fontSize}
                        fill={el.labelColor}
                        fontFamily={WHITEBOARD_MONO_FONT_FAMILY}
                      >
                        {tick}
                      </text>
                    ))
                  : null}
                {el.showLabels
                  ? el.yTicks
                      .filter((tick) => Math.abs(tick) > 1e-9)
                      .map((tick) => (
                        <text
                          key={`${el.id}-ylabel-${tick}`}
                          x={Math.max(el.x - 8, 4)}
                          y={toCanvasY(tick) + el.fontSize * 0.35}
                          textAnchor="end"
                          fontSize={el.fontSize}
                          fill={el.labelColor}
                          fontFamily={WHITEBOARD_MONO_FONT_FAMILY}
                        >
                          {tick}
                        </text>
                      ))
                  : null}
              </g>
            );
          }
          if (el.kind === "function_graph") {
            const clipId = `clip-${el.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
            return (
              <g key={el.id} transform={transform} data-testid={`function-${el.id}`}>
                <defs>
                  <clipPath id={clipId}>
                    <rect
                      x={el.clip.x}
                      y={el.clip.y}
                      width={el.clip.width}
                      height={el.clip.height}
                    />
                  </clipPath>
                </defs>
                <path
                  d={el.pathD}
                  fill="none"
                  stroke={el.color}
                  strokeWidth={el.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - el.progress}
                  clipPath={`url(#${clipId})`}
                />
              </g>
            );
          }
          if (el.kind === "coordinate_point") {
            return (
              <g
                key={el.id}
                transform={transform}
                opacity={el.progress}
                data-testid={`coordinate-point-${el.id}`}
              >
                <circle
                  cx={el.canvasX}
                  cy={el.canvasY}
                  r={el.radius * Math.max(el.progress, 0.2)}
                  fill={el.color}
                  vectorEffect="non-scaling-stroke"
                />
                {el.label ? (
                  <text
                    x={el.canvasX + el.radius + 6}
                    y={el.canvasY - el.radius - 6}
                    fontSize={el.fontSize}
                    fill={el.color}
                    fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}
                  >
                    {el.label}
                  </text>
                ) : null}
              </g>
            );
          }
          if (el.kind === "geometry_point") {
            const gap = el.radius + 8;
            const label =
              el.labelPosition === "right"
                ? { x: el.x + gap, y: el.y, anchor: "start" as const, baseline: "central" as const }
                : el.labelPosition === "bottom"
                  ? { x: el.x, y: el.y + gap, anchor: "middle" as const, baseline: "hanging" as const }
                  : el.labelPosition === "left"
                    ? { x: el.x - gap, y: el.y, anchor: "end" as const, baseline: "central" as const }
                    : { x: el.x, y: el.y - gap, anchor: "middle" as const, baseline: "auto" as const };
            return (
              <g
                key={el.id}
                transform={transform}
                opacity={el.progress}
                data-testid={`geometry-point-${el.id}`}
              >
                <circle
                  cx={el.x}
                  cy={el.y}
                  r={el.radius * Math.max(0.4, el.progress)}
                  fill={el.color}
                  vectorEffect="non-scaling-stroke"
                />
                {el.label ? (
                  <text
                    x={label.x}
                    y={label.y}
                    textAnchor={label.anchor}
                    dominantBaseline={label.baseline}
                    fontSize={el.fontSize}
                    fill={el.color}
                    fontWeight={700}
                    fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}
                  >
                    {el.label}
                  </text>
                ) : null}
              </g>
            );
          }
          if (el.kind === "eraser") {
            if (el.shape === "circle") {
              return (
                <circle
                  key={el.id}
                  cx={el.x}
                  cy={el.y}
                  r={el.radius}
                  transform={transform}
                  fill={el.color}
                  data-testid={`eraser-${el.id}`}
                />
              );
            }
            return (
              <rect
                key={el.id}
                x={el.x}
                y={el.y}
                width={el.width}
                height={el.height}
                transform={transform}
                fill={el.color}
                data-testid={`eraser-${el.id}`}
              />
            );
          }
          // text
          return (
            <text
              key={el.id}
              x={el.x}
              y={el.y}
              fontSize={el.fontSize}
              fill={el.color}
              transform={transform}
              fontWeight={el.fontWeight}
              fontFamily={WHITEBOARD_TEXT_FONT_FAMILY}
              dominantBaseline="alphabetic"
              data-testid={`text-${el.id}`}
            >
              {el.text}
            </text>
          );
        })}

        {/* Annotation overlay — rendered on top of all main content */}
        <g data-testid="annotation-layer">
          {annotations.map((ann) =>
            ann.kind === "laser_pointer" ? (
              <g
                key={ann.id}
                opacity={ann.opacity}
                style={{ pointerEvents: "none" }}
                data-testid={`laser-pointer-${ann.id}`}
              >
                {ann.trail.length > 1 ? (
                  <polyline
                    points={ann.trail.map((point) => `${point.x},${point.y}`).join(" ")}
                    fill="none"
                    stroke={ann.color}
                    strokeWidth={Math.max(2, ann.radius * 0.42)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.18}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null}
                {ann.trail.map((point, index) => (
                  <circle
                    key={`${ann.id}-trail-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r={point.radius}
                    fill={ann.color}
                    opacity={point.opacity}
                  />
                ))}
                {ann.style === "spotlight" ? (
                  <circle
                    cx={ann.x}
                    cy={ann.y}
                    r={ann.radius * (3.8 + ann.progress * 0.7)}
                    fill={ann.color}
                    opacity={0.12}
                  />
                ) : null}
                {ann.style === "pulse" || ann.style === "ring" || ann.style === "spotlight" ? (
                  <>
                    <circle
                      cx={ann.x}
                      cy={ann.y}
                      r={ann.radius * (1.4 + ann.progress * 2.2)}
                      fill="none"
                      stroke={ann.color}
                      strokeWidth={Math.max(2, ann.radius * 0.22)}
                      opacity={ann.style === "ring" ? 0.75 : 0.6 * (1 - ann.progress)}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={ann.x}
                      cy={ann.y}
                      r={ann.radius * (2.2 + ((ann.progress * 1.7) % 1) * 1.7)}
                      fill="none"
                      stroke={ann.color}
                      strokeWidth={Math.max(1.5, ann.radius * 0.16)}
                      opacity={ann.style === "pulse" ? 0.42 * (1 - ((ann.progress * 1.7) % 1)) : 0}
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                ) : null}
                <circle
                  cx={ann.x}
                  cy={ann.y}
                  r={ann.radius}
                  fill={ann.color}
                  opacity={0.95}
                />
                <circle
                  cx={ann.x - ann.radius * 0.25}
                  cy={ann.y - ann.radius * 0.25}
                  r={Math.max(1.5, ann.radius * 0.28)}
                  fill="#ffffff"
                  opacity={0.9}
                />
              </g>
            ) : ann.kind === "emphasis_dots" ? (
              <g key={ann.id} data-testid={`annotation-${ann.id}`}>
                {ann.dots.slice(0, ann.visibleCount).map((dot, index) => (
                  <circle
                    key={`${ann.id}-${index}`}
                    cx={dot.cx}
                    cy={dot.cy}
                    r={dot.r}
                    fill={ann.color}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            ) : ann.pathD ? (
              <path
                key={ann.id}
                d={ann.pathD}
                fill="none"
                stroke={ann.color}
                strokeWidth={ann.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                strokeDasharray={ann.strokeDasharray}
                strokeDashoffset={ann.strokeDashoffset}
                data-testid={`annotation-${ann.id}`}
              />
            ) : (
              <polyline
                key={ann.id}
                points={ann.currentPoints.map(([x, y]) => `${x},${y}`).join(" ")}
                fill="none"
                stroke={ann.color}
                strokeWidth={ann.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                data-testid={`annotation-${ann.id}`}
              />
            ),
          )}
        </g>
      </svg>
    </div>
  );
}
