import { useEffect, useState } from "react";

const KATEX_CSS_ID = "whiteboard-katex-css";
const KATEX_SCRIPT_ID = "whiteboard-katex-script";
const KATEX_VERSION = "0.16.11";
const KATEX_CSS_URL = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;
const KATEX_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js`;

declare global {
  interface Window {
    katex?: {
      renderToString: (
        latex: string,
        options: {
          throwOnError: boolean;
          displayMode: boolean;
          strict: "warn";
          trust: false;
          output: "html";
        },
      ) => string;
    };
  }
}

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
  const katexReady = useKatexRuntime();
  let html: string;
  let failed = false;

  try {
    html = katexReady && window.katex
      ? window.katex.renderToString(latex, {
          throwOnError: false,
          displayMode,
          strict: "warn",
          trust: false,
          output: "html",
        })
      : escapeHtml(latex);
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

function useKatexRuntime() {
  const [ready, setReady] = useState(() => Boolean(window.katex));

  useEffect(() => {
    if (window.katex) {
      setReady(true);
      return;
    }

    if (!document.getElementById(KATEX_CSS_ID)) {
      const link = document.createElement("link");
      link.id = KATEX_CSS_ID;
      link.rel = "stylesheet";
      link.href = KATEX_CSS_URL;
      document.head.appendChild(link);
    }

    let script = document.getElementById(KATEX_SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = KATEX_SCRIPT_ID;
      script.src = KATEX_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }

    const handleLoad = () => setReady(Boolean(window.katex));
    script.addEventListener("load", handleLoad);
    return () => script?.removeEventListener("load", handleLoad);
  }, []);

  return ready;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
