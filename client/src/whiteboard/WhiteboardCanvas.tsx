// SVG-based whiteboard canvas. SVG is preferred over Canvas2D here because
// shape elements (text/lines) keep their identity, can be cleanly animated,
// and re-render declaratively from React state.
import { useEffect, useRef, useState } from "react";
import type { CanvasConfig, RenderedElement } from "./commandTypes";

interface Props {
  canvas: CanvasConfig;
  elements: RenderedElement[];
}

export function WhiteboardCanvas({ canvas, elements }: Props) {
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
      </svg>
    </div>
  );
}
