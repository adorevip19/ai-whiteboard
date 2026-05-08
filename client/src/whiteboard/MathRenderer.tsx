import { useEffect, useState } from "react";

const KATEX_CSS_ID = "whiteboard-katex-css";
const KATEX_SCRIPT_ID = "whiteboard-katex-script";
const KATEX_VERSION = "0.16.11";
export const KATEX_CSS_URL = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;
const KATEX_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.js`;

let katexRuntimePromise: Promise<void> | null = null;

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
      : escapeHtml(formatLatexFallback(latex));
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : "LaTeX 解析失败";
    html = `LaTeX 解析失败：${escapeHtml(message)}`;
  }

  return (
    <div
      className={failed ? "whiteboard-math-error" : "whiteboard-math"}
      data-latex={latex}
      data-display-mode={displayMode ? "true" : "false"}
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
    let cancelled = false;
    ensureKatexRuntimeLoaded()
      .then(() => {
        if (!cancelled) setReady(Boolean(window.katex));
      })
      .catch(() => {
        if (!cancelled) setReady(Boolean(window.katex));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}

export function ensureKatexRuntimeLoaded() {
  if (window.katex && isKatexCssReady()) return Promise.resolve();
  if (katexRuntimePromise) return katexRuntimePromise;

  katexRuntimePromise = Promise.all([loadKatexCss(), loadKatexScript()]).then(() => undefined);
  return katexRuntimePromise;
}

function isKatexCssReady() {
  const link = document.getElementById(KATEX_CSS_ID) as HTMLLinkElement | null;
  return Boolean(link?.dataset.loaded === "true" || link?.sheet);
}

function loadKatexCss() {
  let link = document.getElementById(KATEX_CSS_ID) as HTMLLinkElement | null;
  if (link?.dataset.loaded === "true") return Promise.resolve();
  if (link?.sheet) {
    link.dataset.loaded = "true";
    return Promise.resolve();
  }
  if (!link) {
    link = document.createElement("link");
    link.id = KATEX_CSS_ID;
    link.rel = "stylesheet";
    link.href = KATEX_CSS_URL;
    document.head.appendChild(link);
  }
  return new Promise<void>((resolve) => {
    const done = () => {
      link.dataset.loaded = "true";
      resolve();
    };
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
  });
}

function loadKatexScript() {
  if (window.katex) return Promise.resolve();
  let script = document.getElementById(KATEX_SCRIPT_ID) as HTMLScriptElement | null;
  if (script && window.katex) return Promise.resolve();
  if (!script) {
    script = document.createElement("script");
    script.id = KATEX_SCRIPT_ID;
    script.src = KATEX_SCRIPT_URL;
    script.async = true;
    document.head.appendChild(script);
  }
  return new Promise<void>((resolve) => {
    const done = () => resolve();
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", done, { once: true });
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatLatexFallback(value: string) {
  return value
    .replace(/\\sum/g, "Σ")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\cdot/g, "·")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\approx/g, "≈")
    .replace(/\\mu/g, "μ")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/\{([^{}]+)\}/g, "$1")
    .replace(/_([A-Za-z0-9]+)/g, "₍$1₎")
    .replace(/\^([A-Za-z0-9]+)/g, "^$1")
    .replace(/\s+/g, " ")
    .trim();
}
