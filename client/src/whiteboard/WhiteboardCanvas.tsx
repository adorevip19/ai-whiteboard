// SVG-based whiteboard canvas. SVG is preferred over Canvas2D here because
// shape elements (text/lines) keep their identity, can be cleanly animated,
// and re-render declaratively from React state.
import { useEffect, useRef, useState } from "react";
import type {
  AnnotationElement,
  CanvasConfig,
  RenderedElement,
} from "./commandTypes";
import { MathRenderer } from "./MathRenderer";

interface Props {
  canvas: CanvasConfig;
  elements: RenderedElement[];
  annotations: AnnotationElement[];
}

export function WhiteboardCanvas({
  canvas,
  elements,
  annotations,
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
      // Leave a little breathing room so the border doesn't get clipped.
      const availW = Math.max(rect.width - 8, 100);
      const availH = Math.max(rect.height - 8, 100);
      const s = Math.min(availW / canvas.width, availH / canvas.height, 1);
      setScale(s);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvas.width, canvas.height]);

  const displayW = canvas.width * scale;
  const displayH = canvas.height * scale;

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center overflow-hidden bg-muted/30 p-2"
      data-testid="whiteboard-container"
    >
      <svg
        width={displayW}
        height={displayH}
        viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        className="rounded-md border shadow-sm"
        style={{ background: canvas.background }}
        data-testid="whiteboard-svg"
      >
        {elements.map((el) => {
          if (el.kind === "math") {
            return (
              <foreignObject
                key={el.id}
                x={el.x}
                y={el.y}
                width={el.bbox.width}
                height={el.bbox.height}
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
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              dominantBaseline: "alphabetic",
            } as const;

            return (
              <g key={el.id} data-testid={`division-${el.id}`}>
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
              <g key={el.id} data-testid={`text-segments-${el.id}`}>
                {el.segments.map((segment, index) => (
                  <text
                    key={segment.id ?? `${el.id}-${index}`}
                    x={segment.x}
                    y={segment.y}
                    fontSize={segment.fontSize}
                    fill={segment.color}
                    fontWeight={segment.fontWeight}
                    fontFamily="'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
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
              <g key={el.id} data-testid={`arrow-${el.id}`}>
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
              <g key={el.id} data-testid={`shape-${el.id}`}>
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
          if (el.kind === "eraser") {
            if (el.shape === "circle") {
              return (
                <circle
                  key={el.id}
                  cx={el.x}
                  cy={el.y}
                  r={el.radius}
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
              fontWeight={el.fontWeight}
              fontFamily="'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif"
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
            ann.kind === "emphasis_dots" ? (
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
