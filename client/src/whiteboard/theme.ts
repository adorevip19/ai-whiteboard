import type { CanvasConfig, WhiteboardCommand, WhiteboardScript } from "./commandTypes";

export type BoardTheme = "light" | "dark";

const DARK_BACKGROUND = "#050505";
const LIGHT_BACKGROUND = "#ffffff";
const DARK_INK = "#f8fafc";
const LIGHT_INK = "#111111";
const DARK_MUTED_INK = "#cbd5e1";
const LIGHT_MUTED_INK = "#334155";
const DARK_GRID = "#475569";
const LIGHT_GRID = "#cbd5e1";
const DARK_ERASER_PULSE = "#111111";
const LIGHT_ERASER_PULSE = "#f2f2f2";

const COLOR_KEYS = new Set([
  "background",
  "color",
  "axisColor",
  "gridColor",
  "labelColor",
  "pointColor",
  "lineColor",
  "fill",
]);

export function normalizeBoardTheme(value: unknown): BoardTheme {
  return value === "dark" || value === "black" ? "dark" : "light";
}

export function parseHexColor(color: string) {
  const normalized = color.trim();
  const short = normalized.match(/^#([0-9a-f]{3})$/i)?.[1];
  if (short) {
    return {
      r: Number.parseInt(short[0] + short[0], 16),
      g: Number.parseInt(short[1] + short[1], 16),
      b: Number.parseInt(short[2] + short[2], 16),
    };
  }
  const long = normalized.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!long) return null;
  return {
    r: Number.parseInt(long.slice(0, 2), 16),
    g: Number.parseInt(long.slice(2, 4), 16),
    b: Number.parseInt(long.slice(4, 6), 16),
  };
}

export function relativeLuminance(color: string) {
  const rgb = parseHexColor(color);
  if (!rgb) return 1;
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function isDarkCanvas(canvas: Pick<CanvasConfig, "background"> & { theme?: BoardTheme }) {
  if (canvas.theme === "dark") return true;
  if (canvas.theme === "light") return false;
  return relativeLuminance(canvas.background) < 0.35;
}

export function defaultCanvasBackground(theme: BoardTheme) {
  return theme === "dark" ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

export function boardInkColor(canvas: Pick<CanvasConfig, "background"> & { theme?: BoardTheme }) {
  return isDarkCanvas(canvas) ? DARK_INK : LIGHT_INK;
}

export function boardMutedInkColor(canvas: Pick<CanvasConfig, "background"> & { theme?: BoardTheme }) {
  return isDarkCanvas(canvas) ? DARK_MUTED_INK : LIGHT_MUTED_INK;
}

export function boardGridColor(canvas: Pick<CanvasConfig, "background"> & { theme?: BoardTheme }) {
  return isDarkCanvas(canvas) ? DARK_GRID : LIGHT_GRID;
}

export function boardFramePulseColor(canvas: Pick<CanvasConfig, "background"> & { theme?: BoardTheme }) {
  return isDarkCanvas(canvas) ? DARK_ERASER_PULSE : LIGHT_ERASER_PULSE;
}

export function invertHexColor(color: string) {
  const rgb = parseHexColor(color);
  if (!rgb) return color;
  const toHex = (value: number) => (255 - value).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export function readableBoardColor(
  color: string | undefined,
  canvas: Pick<CanvasConfig, "background"> & { theme?: BoardTheme },
  fallback?: string,
) {
  const dark = isDarkCanvas(canvas);
  const base = color ?? fallback ?? boardInkColor(canvas);
  const luminance = relativeLuminance(base);
  if (dark && luminance < 0.18) return invertHexColor(base);
  if (!dark && luminance > 0.82) return fallback ?? boardInkColor(canvas);
  return base;
}

function transformThemeValue(key: string, value: unknown, theme: BoardTheme) {
  if (typeof value !== "string" || !COLOR_KEYS.has(key)) return value;
  if (key === "background") return theme === "dark" ? DARK_BACKGROUND : LIGHT_BACKGROUND;
  return theme === "dark" ? invertHexColor(value) : value;
}

function transformThemeObject(value: unknown, theme: BoardTheme): unknown {
  if (Array.isArray(value)) return value.map((item) => transformThemeObject(item, theme));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = transformThemeObject(transformThemeValue(key, child, theme), theme);
  }
  return out;
}

export function applyBoardTheme(script: WhiteboardScript, theme: BoardTheme): WhiteboardScript {
  if (theme === "light") {
    return {
      ...script,
      canvas: {
        ...script.canvas,
        theme: "light",
        background: script.canvas.background || LIGHT_BACKGROUND,
      },
    };
  }
  const transformed = transformThemeObject(script, theme) as WhiteboardScript;
  return {
    ...transformed,
    canvas: {
      ...transformed.canvas,
      theme: "dark",
      background: DARK_BACKGROUND,
    },
    commands: transformed.commands.map((command) => {
      if (command.type === "set_canvas") {
        return { ...command, background: DARK_BACKGROUND } as WhiteboardCommand;
      }
      if (command.type === "clear_canvas") {
        return command.background ? { ...command, background: DARK_BACKGROUND } : command;
      }
      return command;
    }),
  };
}
