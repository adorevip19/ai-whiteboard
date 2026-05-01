// SVG-based whiteboard canvas. SVG is preferred over Canvas2D here because
// shape elements (text/lines) keep their identity, can be cleanly animated,
// and re-render declaratively from React state.
import { useEffect, useRef, useState } from "react";
import type { AnnotationElement, CanvasConfig, RenderedElement } from "./commandTypes";

interface Props {
  canvas: CanvasConfig;
  elements: RenderedElement[];
  annotations: AnnotationElement[];
}

export function WhiteboardCanvas({ canvas, elements, annotations }: Props) {
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
            ann.pathD ? (
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
