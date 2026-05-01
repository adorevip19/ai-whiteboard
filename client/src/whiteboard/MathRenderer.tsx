import katex from "katex";

interface MathRendererProps {
  latex: string;
  fontSize?: number;
  color?: string;
  displayMode?: boolean;
}

export function MathRenderer({
  latex,
  fontSize = 32,
  color = "#111111",
  displayMode = false,
}: MathRendererProps) {
  let html: string;
  let failed = false;

  try {
    html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
      strict: "warn",
      trust: false,
      output: "html",
    });
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : "LaTeX 解析失败";
    html = `LaTeX 解析失败：${escapeHtml(message)}`;
  }

  return (
    <div
      className={failed ? "whiteboard-math-error" : "whiteboard-math"}
      style={{
        color: failed ? "#b91c1c" : color,
        fontSize,
        lineHeight: 1.2,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
