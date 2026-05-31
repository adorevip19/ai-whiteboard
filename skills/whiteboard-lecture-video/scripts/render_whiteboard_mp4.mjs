#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const scriptPath = args.script;
const outPath = args.out;
const baseUrl = args["base-url"] ?? "http://127.0.0.1:5001";
const ttsEnabled = args.tts !== "false";
const STANDARD_PLAYBACK_SPEED = 1;
const FAST_PLAYBACK_SPEED = 1.25;
const pace = args.pace === "fast" || args.pace === "short" || args.pace === "short-video" ? "fast" : "standard";
const playbackSpeed = Number(args.speed ?? (pace === "fast" ? FAST_PLAYBACK_SPEED : STANDARD_PLAYBACK_SPEED));
const boardTheme = args["board-theme"] === "dark" || args["board-theme"] === "black" ? "dark" : "light";
const canvasAspect =
  args.aspect === "portrait" ||
  args.aspect === "9:16" ||
  args["canvas-aspect"] === "portrait" ||
  args["canvas-aspect"] === "9:16"
    ? "portrait"
    : "landscape";

if (!scriptPath || !outPath) {
  console.error(
    "Usage: render_whiteboard_mp4.mjs --script script.json --out lesson.mp4 [--base-url http://127.0.0.1:5001] [--tts true|false] [--speed 1|--pace fast] [--board-theme light|dark] [--aspect landscape|portrait|9:16]",
  );
  process.exit(2);
}

const scriptText = await fs.readFile(scriptPath, "utf8");
const startedAt = performance.now();
const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/video/render`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    scriptText,
    ttsEnabled,
    playbackSpeed: Number.isFinite(playbackSpeed) ? playbackSpeed : 1,
    boardTheme,
    canvasAspect,
  }),
});
const buffer = Buffer.from(await response.arrayBuffer());
const seconds = (performance.now() - startedAt) / 1000;

if (!response.ok) {
  const body = buffer.toString("utf8");
  console.error(
    JSON.stringify(
      {
        ok: false,
        status: response.status,
        seconds: Number(seconds.toFixed(3)),
        message: body,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, buffer);
console.log(
  JSON.stringify(
    {
      ok: true,
      seconds: Number(seconds.toFixed(3)),
      bytes: buffer.length,
      outPath,
      playbackSpeed: Number.isFinite(playbackSpeed) ? playbackSpeed : STANDARD_PLAYBACK_SPEED,
      canvasAspect,
    },
    null,
    2,
  ),
);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    parsed[key] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) i++;
  }
  return parsed;
}
