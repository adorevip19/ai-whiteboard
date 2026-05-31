import express, { type Express, type Request, type Response } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { storage } from "./storage";
import {
  type AiExplanationMode,
  generateAiScript,
  preflightScriptText,
  recognizeProblemFromImage,
  repairAiScript,
  summarizeScriptKnowledge,
} from "./aiScript";
import { renderScriptToWebmInHeadlessBrowser } from "./videoRender";
import {
  enhanceScriptWithIllustrations,
  suggestIllustrationSlots,
} from "./illustratedScript";
import type {
  WhiteboardCommand,
  WhiteboardScript,
} from "../client/src/whiteboard/commandTypes";
import {
  applyBoardTheme,
  normalizeBoardTheme,
} from "../client/src/whiteboard/theme";
import {
  applyCanvasAspect,
  normalizeCanvasAspect,
} from "../client/src/whiteboard/canvasAspect";

const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const MAX_IMAGE_DATA_URL_LENGTH = 14 * 1024 * 1024;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;
const MAX_VIDEO_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_SHARE_SCRIPT_TEXT_LENGTH = 2 * 1024 * 1024;
const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{10,48}$/;
const LECTURE_ID_PATTERN = /^[A-Za-z0-9_-]{10,48}$/;
const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{10,48}$/;
const GROUP_SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{10,48}$/;

type VideoRenderPayload =
  | { kind: "webm"; buffer: Buffer }
  | { kind: "webmSegments"; buffers: Buffer[] };

const videoRenderJobs = new Map<
  string,
  {
    resolve: (payload: VideoRenderPayload) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }
>();

function escapeSsml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clampRate(rate: unknown) {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return 1;
  return Math.max(0.5, Math.min(rate, 2));
}

function createRequestAbortController(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.on("aborted", abort);
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller;
}

function parseExplanationMode(value: unknown): AiExplanationMode {
  return value === "concise" ? "concise" : "detailed";
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 转码失败（code ${code}）：${stderr || "无错误输出"}`));
    });
  });
}

function hasAudioStream(inputPath: string) {
  return new Promise<boolean>((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", inputPath],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim().length > 0);
      else reject(new Error(`ffprobe 检查音频流失败（code ${code}）：${stderr || "无错误输出"}`));
    });
  });
}

async function convertWebmBufferToMp4(webm: Buffer) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-whiteboard-video-"));
  const inputPath = path.join(workDir, "input.webm");
  const outputPath = path.join(workDir, "whiteboard-lecture.mp4");
  try {
    await fs.writeFile(inputPath, webm);
    if (await hasAudioStream(inputPath)) {
      await runFfmpeg([
        "-y",
        "-i",
        inputPath,
        "-filter_complex",
        "[0:v]fps=15,format=yuv420p,tpad=stop_mode=clone:stop_duration=1800[v];[0:a]aresample=async=1:first_pts=0[a]",
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        outputPath,
      ]);
    } else {
      await runFfmpeg([
        "-y",
        "-i",
        inputPath,
        "-vf",
        "fps=15,format=yuv420p",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outputPath,
      ]);
    }
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function convertWebmSegmentsToMp4(segments: Buffer[]) {
  if (segments.length === 1) return convertWebmBufferToMp4(segments[0]);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-whiteboard-video-segments-"));
  const listPath = path.join(workDir, "segments.txt");
  const outputPath = path.join(workDir, "whiteboard-lecture.mp4");
  try {
    const mp4SegmentPaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const inputPath = path.join(workDir, `segment-${String(i).padStart(3, "0")}.webm`);
      const mp4SegmentPath = path.join(workDir, `segment-${String(i).padStart(3, "0")}.mp4`);
      await fs.writeFile(inputPath, segments[i]);
      await runFfmpeg([
        "-y",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        mp4SegmentPath,
      ]);
      mp4SegmentPaths.push(mp4SegmentPath);
    }
    await fs.writeFile(
      listPath,
      mp4SegmentPaths.map((inputPath) => `file '${inputPath}'`).join("\n"),
    );
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-vf",
      "fps=15,format=yuv420p",
      "-af",
      "aresample=async=1:first_pts=0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function createVideoRenderJob() {
  const id = randomUUID();
  const promise = new Promise<VideoRenderPayload>((resolve, reject) => {
    const timeout = setTimeout(() => {
      videoRenderJobs.delete(id);
      reject(new Error("服务端视频录制超时。"));
    }, 20 * 60 * 1000);
    videoRenderJobs.set(id, { resolve, reject, timeout });
  });
  void promise.catch(() => undefined);
  return { id, promise };
}

function completeVideoRenderJob(id: string, buffer: Buffer) {
  const job = videoRenderJobs.get(id);
  if (!job) return false;
  clearTimeout(job.timeout);
  videoRenderJobs.delete(id);
  job.resolve({ kind: "webm", buffer });
  return true;
}

function completeVideoRenderJobSegments(id: string, buffers: Buffer[]) {
  const job = videoRenderJobs.get(id);
  if (!job) return false;
  clearTimeout(job.timeout);
  videoRenderJobs.delete(id);
  job.resolve({ kind: "webmSegments", buffers });
  return true;
}

function failVideoRenderJob(id: string, error: Error) {
  const job = videoRenderJobs.get(id);
  if (!job) return;
  clearTimeout(job.timeout);
  videoRenderJobs.delete(id);
  job.reject(error);
}

function getBaseUrl(req: Request) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const proto = forwardedProto || req.protocol;
  const host = forwardedHost || req.get("host");
  return `${proto}://${host}`;
}

function stringifyScriptInput(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return "";
}

function createShareId() {
  return randomBytes(12).toString("base64url");
}

function createLectureId() {
  return randomBytes(12).toString("base64url");
}

function createGroupId() {
  return randomBytes(12).toString("base64url");
}

function createGroupShareId() {
  return randomBytes(12).toString("base64url");
}

function inferLectureTitle(script: WhiteboardScript) {
  const firstText = script.commands.find(
    (command) => "text" in command && typeof command.text === "string" && command.text.trim(),
  ) as { text?: string } | undefined;
  return firstText?.text?.trim().slice(0, 48) || "未命名讲解";
}

function getDescendantGroupIds(
  groups: Array<{ id: string; parentId: string | null }>,
  rootId: string,
) {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (group.parentId && ids.has(group.parentId) && !ids.has(group.id)) {
        ids.add(group.id);
        changed = true;
      }
    }
  }
  return ids;
}

function getCommandNarration(command: WhiteboardCommand) {
  return "narration" in command && typeof command.narration === "string"
    ? command.narration.trim()
    : "";
}

function estimateTtsDurationMs(text: string) {
  const chars = Array.from(text.trim());
  if (chars.length === 0) return 0;

  let cjk = 0;
  let latin = 0;
  let punctuation = 0;
  for (const char of chars) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (
      (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff)
    ) {
      cjk += 1;
    }
    else if (/[A-Za-z0-9]/.test(char)) latin += 1;
    else if (!/\s/.test(char)) punctuation += 1;
  }

  const baseMs = cjk * 260 + latin * 85 + punctuation * 180;
  return Math.max(1200, Math.round(baseMs + 600));
}

function findTtsDurationMismatches(script: WhiteboardScript) {
  return script.commands.flatMap((command, index) => {
    const narration = getCommandNarration(command);
    if (!narration || !("duration" in command) || typeof command.duration !== "number") {
      return [];
    }

    const estimatedMs = estimateTtsDurationMs(narration);
    if (estimatedMs <= 0) return [];

    const scriptMs = command.duration;
    const ratio = scriptMs / estimatedMs;
    const absoluteDelta = Math.abs(scriptMs - estimatedMs);
    const isClearlyTooLong = scriptMs > 6000 && ratio >= 4 && absoluteDelta >= 6000;
    const isClearlyTooShort = estimatedMs > 6000 && ratio <= 0.25 && absoluteDelta >= 6000;
    if (!isClearlyTooLong && !isClearlyTooShort) return [];

    return [
      {
        commandIndex: index,
        commandId: "id" in command && typeof command.id === "string" ? command.id : undefined,
        commandType: command.type,
        durationMs: Math.round(scriptMs),
        estimatedTtsMs: estimatedMs,
        narrationPreview:
          narration.length > 40 ? `${narration.slice(0, 40)}...` : narration,
        message: `第 ${index + 1} 条命令 (${command.type}) 的 duration=${Math.round(
          scriptMs,
        )}ms，与旁白估算时长约 ${estimatedMs}ms 差距过大。`,
      },
    ];
  });
}

function composePromptFromRecognizedImage(params: {
  text: string;
  problemText: string;
  diagramDescription: string;
  subject?: string;
  notes?: string;
  confidence: "high" | "medium" | "low";
  mode: AiExplanationMode;
}) {
  return [
    params.text ? `用户补充要求：\n${params.text}` : "",
    params.mode === "concise"
      ? "讲解模式：简洁讲解。开场第一段有效旁白仍必须先朗读原题或复述问题，然后只点破关键卡点，并配合白板动作展示关键关系。"
      : "讲解模式：详细讲解。开场第一段有效旁白必须先朗读原题或复述问题，再分析题干，然后完整讲解。",
    params.subject ? `学科/类型：${params.subject}` : "",
    `题目内容：\n${params.problemText}`,
    params.diagramDescription ? `图片/图示内容：\n${params.diagramDescription}` : "",
    params.notes ? `识别备注：${params.notes}` : "",
    params.confidence === "low" ? "注意：图片识别置信度较低，请先提示学生核对看不清的地方。" : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // prefix all routes with /api
  // use storage to perform CRUD operations on the storage interface
  // e.g. app.get("/api/items", async (_req, res) => { ... })
  app.get("/api/lectures", async (_req, res, next) => {
    try {
      const lectures = await storage.listWhiteboardLectures();
      const groups = await storage.listWhiteboardGroups();
      return res.json({
        groups,
        lectures: lectures.map((lecture) => ({
          id: lecture.id,
          groupId: lecture.groupId,
          title: lecture.title,
          ttsEnabled: lecture.ttsEnabled,
          playbackSpeed: lecture.playbackSpeed,
          shareId: lecture.shareId,
          shareActive: lecture.shareActive,
          createdAt: lecture.createdAt,
          updatedAt: lecture.updatedAt,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/lecture-groups", async (req, res, next) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name) return res.status(400).json({ message: "分组名称不能为空。" });
      const parentId =
        typeof req.body?.parentId === "string" && req.body.parentId
          ? req.body.parentId
          : null;
      if (parentId && !GROUP_ID_PATTERN.test(parentId)) {
        return res.status(400).json({ message: "父分组无效。" });
      }
      if (parentId) {
        const groups = await storage.listWhiteboardGroups();
        if (!groups.some((group) => group.id === parentId)) {
          return res.status(404).json({ message: "父分组不存在。" });
        }
      }
      const id = createGroupId();
      await storage.createWhiteboardGroup({
        id,
        parentId,
        name: name.slice(0, 80),
      });
      return res.status(201).json({ id, parentId, name: name.slice(0, 80) });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/lecture-groups/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!GROUP_ID_PATTERN.test(id)) {
        return res.status(404).json({ message: "分组不存在。" });
      }
      const deleted = await storage.deleteWhiteboardGroup(id);
      if (!deleted) return res.status(404).json({ message: "分组不存在。" });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/lecture-groups/:id/share", async (req, res, next) => {
    try {
      const groupId = req.params.id;
      if (!GROUP_ID_PATTERN.test(groupId)) {
        return res.status(404).json({ message: "分组不存在。" });
      }
      const groups = await storage.listWhiteboardGroups();
      const group = groups.find((item) => item.id === groupId);
      if (!group) return res.status(404).json({ message: "分组不存在。" });
      if (group.shareId && group.shareActive) {
        return res.json({ id: group.shareId });
      }
      const shareId = createGroupShareId();
      await storage.createWhiteboardGroupShare({ id: shareId, groupId });
      await storage.setWhiteboardGroupShare({ groupId, shareId, active: true });
      return res.status(201).json({ id: shareId });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/lecture-groups/:id/share", async (req, res, next) => {
    try {
      const groupId = req.params.id;
      if (!GROUP_ID_PATTERN.test(groupId)) {
        return res.status(404).json({ message: "分组不存在。" });
      }
      const groups = await storage.listWhiteboardGroups();
      const group = groups.find((item) => item.id === groupId);
      if (!group) return res.status(404).json({ message: "分组不存在。" });
      if (!group.shareId) return res.json({ ok: true });
      await storage.stopWhiteboardGroupShare(group.shareId);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/group-shares/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!GROUP_SHARE_ID_PATTERN.test(id)) {
        return res.status(404).json({ message: "分组分享不存在。" });
      }
      const share = await storage.getWhiteboardGroupShare(id);
      if (!share || !share.active) {
        return res.status(404).json({ message: "分组分享不存在。" });
      }
      const groups = await storage.listWhiteboardGroups();
      const rootGroup = groups.find((group) => group.id === share.groupId);
      if (!rootGroup) return res.status(404).json({ message: "分组不存在。" });
      const groupIds = getDescendantGroupIds(groups, share.groupId);
      const lectures = (await storage.listWhiteboardLectures()).filter(
        (lecture) => lecture.groupId && groupIds.has(lecture.groupId),
      );
      return res.json({
        id,
        rootGroup,
        groups: groups.filter((group) => groupIds.has(group.id)),
        lectures: lectures.map((lecture) => ({
          id: lecture.id,
          groupId: lecture.groupId,
          title: lecture.title,
          scriptText: lecture.scriptText,
          ttsEnabled: lecture.ttsEnabled,
          playbackSpeed: lecture.playbackSpeed,
          updatedAt: lecture.updatedAt,
        })),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/lectures", async (req, res, next) => {
    try {
      const scriptText = stringifyScriptInput(req.body?.scriptText ?? req.body?.script);
      if (!scriptText.trim()) {
        return res.status(400).json({ message: "请提供要保存的脚本。" });
      }
      if (scriptText.length > MAX_SHARE_SCRIPT_TEXT_LENGTH) {
        return res.status(413).json({ message: "脚本太大，暂时无法保存。" });
      }
      const preflight = preflightScriptText(scriptText);
      if (!preflight.report.ok || !preflight.script) {
        return res.status(400).json({
          message: "脚本预检未通过，暂时无法保存。",
          report: preflight.report,
        });
      }
      const title =
        typeof req.body?.title === "string" && req.body.title.trim()
          ? req.body.title.trim().slice(0, 80)
          : inferLectureTitle(preflight.script);
      const id = createLectureId();
      const groupId =
        typeof req.body?.groupId === "string" && req.body.groupId
          ? req.body.groupId
          : null;
      if (groupId && !GROUP_ID_PATTERN.test(groupId)) {
        return res.status(400).json({ message: "分组无效。" });
      }
      const ttsEnabled =
        typeof req.body?.ttsEnabled === "boolean" ? req.body.ttsEnabled : true;
      const playbackSpeed = clampRate(req.body?.playbackSpeed);
      await storage.createWhiteboardLecture({
        id,
        groupId,
        title,
        scriptText: JSON.stringify(preflight.script),
        ttsEnabled,
        playbackSpeed,
      });
      return res.status(201).json({ id, title });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/lectures/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!LECTURE_ID_PATTERN.test(id)) {
        return res.status(404).json({ message: "讲解不存在。" });
      }
      const lecture = await storage.getWhiteboardLecture(id);
      if (!lecture) return res.status(404).json({ message: "讲解不存在。" });
      return res.json(lecture);
    } catch (error) {
      return next(error);
    }
  });

  app.patch("/api/lectures/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!LECTURE_ID_PATTERN.test(id)) {
        return res.status(404).json({ message: "讲解不存在。" });
      }
      const groupId =
        typeof req.body?.groupId === "string" && req.body.groupId
          ? req.body.groupId
          : null;
      if (groupId && !GROUP_ID_PATTERN.test(groupId)) {
        return res.status(400).json({ message: "分组无效。" });
      }
      const moved = await storage.moveWhiteboardLecture({ id, groupId });
      if (!moved) return res.status(404).json({ message: "讲解不存在。" });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/lectures/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!LECTURE_ID_PATTERN.test(id)) {
        return res.status(404).json({ message: "讲解不存在。" });
      }
      const deleted = await storage.deleteWhiteboardLecture(id);
      if (!deleted) return res.status(404).json({ message: "讲解不存在。" });
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/lectures/:id/share", async (req, res, next) => {
    try {
      const lectureId = req.params.id;
      if (!LECTURE_ID_PATTERN.test(lectureId)) {
        return res.status(404).json({ message: "讲解不存在。" });
      }
      const lecture = await storage.getWhiteboardLecture(lectureId);
      if (!lecture) return res.status(404).json({ message: "讲解不存在。" });
      if (lecture.shareId && lecture.shareActive) {
        return res.json({ id: lecture.shareId });
      }
      const shareId = createShareId();
      await storage.createWhiteboardShare({
        id: shareId,
        scriptText: lecture.scriptText,
        ttsEnabled: lecture.ttsEnabled,
        playbackSpeed: lecture.playbackSpeed,
        lectureId,
      });
      await storage.setWhiteboardLectureShare({
        lectureId,
        shareId,
        active: true,
      });
      return res.status(201).json({ id: shareId });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/lectures/:id/share", async (req, res, next) => {
    try {
      const lectureId = req.params.id;
      if (!LECTURE_ID_PATTERN.test(lectureId)) {
        return res.status(404).json({ message: "讲解不存在。" });
      }
      const lecture = await storage.getWhiteboardLecture(lectureId);
      if (!lecture) return res.status(404).json({ message: "讲解不存在。" });
      if (!lecture.shareId) return res.json({ ok: true });
      await storage.stopWhiteboardShare(lecture.shareId);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/shares", async (req, res, next) => {
    try {
      const scriptText = stringifyScriptInput(req.body?.scriptText ?? req.body?.script);
      if (!scriptText.trim()) {
        return res.status(400).json({ message: "请提供要分享的脚本。" });
      }
      if (scriptText.length > MAX_SHARE_SCRIPT_TEXT_LENGTH) {
        return res.status(413).json({ message: "脚本太大，暂时无法分享。" });
      }

      const preflight = preflightScriptText(scriptText);
      if (!preflight.report.ok || !preflight.script) {
        return res.status(400).json({
          message: "脚本预检未通过，暂时无法分享。",
          report: preflight.report,
        });
      }

      const id = createShareId();
      const ttsEnabled =
        typeof req.body?.ttsEnabled === "boolean" ? req.body.ttsEnabled : true;
      const playbackSpeed = clampRate(req.body?.playbackSpeed);
      await storage.createWhiteboardShare({
        id,
        scriptText: JSON.stringify(preflight.script),
        ttsEnabled,
        playbackSpeed,
      });
      return res.status(201).json({ id });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/shares/:id", async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!SHARE_ID_PATTERN.test(id)) {
        return res.status(404).json({ message: "分享不存在。" });
      }
      const share = await storage.getWhiteboardShare(id);
      if (!share || !share.active) {
        return res.status(404).json({ message: "分享不存在。" });
      }
      return res.json(share);
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/tts", async (req, res, next) => {
    try {
      const key = process.env.AZURE_SPEECH_KEY;
      const region = process.env.AZURE_SPEECH_REGION;

      if (!key || !region) {
        return res.status(501).json({
          message:
            "Azure TTS 未配置。请设置 AZURE_SPEECH_KEY 和 AZURE_SPEECH_REGION。",
        });
      }

      const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
      if (!text) {
        return res.status(400).json({ message: "text 不能为空。" });
      }
      if (text.length > 1200) {
        return res.status(400).json({ message: "text 不能超过 1200 个字符。" });
      }

      const voice =
        typeof req.body?.voice === "string" && req.body.voice.trim()
          ? req.body.voice.trim()
          : process.env.AZURE_SPEECH_VOICE || DEFAULT_VOICE;
      const rate = clampRate(req.body?.rate);
      const ratePercent = Math.round((rate - 1) * 100);
      const rateValue = ratePercent === 0 ? "default" : `${ratePercent}%`;
      const ssml = `<?xml version="1.0" encoding="utf-8"?>
<speak version="1.0" xml:lang="zh-CN" xmlns="http://www.w3.org/2001/10/synthesis">
  <voice name="${escapeSsml(voice)}">
    <prosody rate="${rateValue}">${escapeSsml(text)}</prosody>
  </voice>
</speak>`;

      const azureResponse = await fetch(
        `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": DEFAULT_OUTPUT_FORMAT,
            "User-Agent": "ai-whiteboard",
          },
          body: ssml,
        },
      );

      if (!azureResponse.ok) {
        const body = await azureResponse.text();
        return res.status(azureResponse.status).json({
          message: `Azure TTS 调用失败：${body || azureResponse.statusText}`,
        });
      }

      const audio = Buffer.from(await azureResponse.arrayBuffer());
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Azure-Voice", voice);
      return res.send(audio);
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    "/api/video/convert-mp4",
    express.raw({
      type: ["video/webm", "application/octet-stream"],
      limit: `${MAX_VIDEO_UPLOAD_BYTES}b`,
    }),
    async (req, res, next) => {
      try {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          return res.status(400).json({ message: "视频数据不能为空。" });
        }
        const mp4 = await convertWebmBufferToMp4(req.body);
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", 'attachment; filename="whiteboard-lecture.mp4"');
        res.setHeader("Cache-Control", "no-store");
        return res.send(mp4);
      } catch (error) {
        return next(error);
      }
    },
  );

  app.post(
    "/api/video/render-jobs/:id/webm",
    express.raw({
      type: ["video/webm", "application/octet-stream"],
      limit: `${MAX_VIDEO_UPLOAD_BYTES}b`,
    }),
    (req, res) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        failVideoRenderJob(req.params.id, new Error("浏览器录制结果为空。"));
        return res.status(400).json({ message: "视频数据不能为空。" });
      }
      if (!completeVideoRenderJob(req.params.id, req.body)) {
        return res.status(404).json({ message: "视频录制任务不存在或已过期。" });
      }
      return res.json({ ok: true, size: req.body.length });
    },
  );

  app.post("/api/video/render-jobs/:id/webm-segments", (req, res) => {
    const rawSegments = Array.isArray(req.body?.segments) ? req.body.segments : null;
    if (!rawSegments || rawSegments.length === 0) {
      failVideoRenderJob(req.params.id, new Error("浏览器录制分段结果为空。"));
      return res.status(400).json({ message: "视频分段数据不能为空。" });
    }

    let totalBytes = 0;
    const buffers: Buffer[] = [];
    for (const rawSegment of rawSegments) {
      if (typeof rawSegment !== "string" || rawSegment.length === 0) {
        failVideoRenderJob(req.params.id, new Error("浏览器录制分段格式无效。"));
        return res.status(400).json({ message: "视频分段格式无效。" });
      }
      const buffer = Buffer.from(rawSegment, "base64");
      totalBytes += buffer.length;
      if (totalBytes > MAX_VIDEO_UPLOAD_BYTES) {
        failVideoRenderJob(req.params.id, new Error("浏览器录制分段过大。"));
        return res.status(413).json({ message: "视频分段数据过大。" });
      }
      buffers.push(buffer);
    }

    if (!completeVideoRenderJobSegments(req.params.id, buffers)) {
      return res.status(404).json({ message: "视频录制任务不存在或已过期。" });
    }
    return res.json({ ok: true, segments: buffers.length, size: totalBytes });
  });

  app.post("/api/video/render", async (req, res, next) => {
    const controller = createRequestAbortController(req, res);
    const job = createVideoRenderJob();
    try {
      const mode = parseExplanationMode(req.body?.mode);
      const boardTheme = normalizeBoardTheme(req.body?.boardTheme);
      const canvasAspect = normalizeCanvasAspect(req.body?.canvasAspect);
      const ttsEnabled = req.body?.ttsEnabled !== false;
      const playbackSpeed =
        typeof req.body?.playbackSpeed === "number" && Number.isFinite(req.body.playbackSpeed)
          ? Math.max(0.5, Math.min(req.body.playbackSpeed, 2))
          : 1;

      let scriptText = stringifyScriptInput(req.body?.scriptText ?? req.body?.script);
      if (!scriptText) {
        const text =
          typeof req.body?.text === "string"
            ? req.body.text.trim()
            : typeof req.body?.prompt === "string"
              ? req.body.prompt.trim()
              : "";
        const imageDataUrl =
          typeof req.body?.imageDataUrl === "string" ? req.body.imageDataUrl.trim() : "";
        if (!text && !imageDataUrl) {
          return res.status(400).json({
            message: "请提供 scriptText/script，或提供 text/prompt 与可选 imageDataUrl。",
          });
        }
        let prompt = text;
        if (imageDataUrl) {
          if (imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
            return res.status(413).json({ message: "图片太大，请上传 10MB 以内的图片。" });
          }
          if (!IMAGE_DATA_URL_PATTERN.test(imageDataUrl)) {
            return res.status(400).json({ message: "只支持 PNG、JPEG、WEBP 或 GIF 图片。" });
          }
          const recognized = await recognizeProblemFromImage(imageDataUrl, text, controller.signal);
          prompt = composePromptFromRecognizedImage({
            text,
            problemText: recognized.problemText,
            diagramDescription: recognized.diagramDescription,
            subject: recognized.subject,
            notes: recognized.notes,
            confidence: recognized.confidence,
            mode,
          });
        }
        const generated = await generateAiScript(prompt, mode, controller.signal, {
          boardTheme,
          canvasAspect,
        });
        scriptText = generated.scriptText;
      }

      const renderPreflight = preflightScriptText(scriptText);
      if (!renderPreflight.report.ok || !renderPreflight.script) {
        return res.status(400).json({
          message: "脚本预检未通过，请先修正脚本后再生成视频。",
          report: renderPreflight.report,
        });
      }
      if (ttsEnabled) {
        const durationMismatches = findTtsDurationMismatches(renderPreflight.script);
        if (durationMismatches.length > 0) {
          return res.status(400).json({
            message:
              "脚本中部分命令的 duration 与旁白预计时长差距过大。请修改脚本 duration 或拆分旁白后重试。",
            issues: durationMismatches,
          });
        }
      }
      const renderScript = applyCanvasAspect(
        applyBoardTheme(renderPreflight.script, boardTheme),
        canvasAspect,
      );
      const finalPreflight = preflightScriptText(JSON.stringify(renderScript));
      if (!finalPreflight.report.ok || !finalPreflight.script) {
        return res.status(400).json({
          message: "画面比例转换后的脚本预检未通过，请修正布局后再生成视频。",
          report: finalPreflight.report,
        });
      }
      scriptText = JSON.stringify(finalPreflight.script);

      const baseUrl = getBaseUrl(req);
      await renderScriptToWebmInHeadlessBrowser({
        baseUrl,
        scriptText,
        uploadUrl: `${baseUrl}/api/video/render-jobs/${job.id}/webm`,
        ttsEnabled,
        playbackSpeed,
      });
      const rendered = await job.promise;
      const mp4 =
        rendered.kind === "webm"
          ? await convertWebmBufferToMp4(rendered.buffer)
          : await convertWebmSegmentsToMp4(rendered.buffers);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", 'attachment; filename="whiteboard-lecture.mp4"');
      res.setHeader("Cache-Control", "no-store");
      return res.send(mp4);
    } catch (error) {
      failVideoRenderJob(job.id, error instanceof Error ? error : new Error(String(error)));
      if (controller.signal.aborted && !res.headersSent) {
        return res.status(499).json({ message: "视频生成已取消。" });
      }
      return next(error);
    }
  });

  app.post("/api/ai-script/preflight", async (req, res, next) => {
    try {
      const scriptText =
        typeof req.body?.scriptText === "string" ? req.body.scriptText : "";
      if (!scriptText.trim()) {
        return res.status(400).json({ message: "scriptText 不能为空。" });
      }
      return res.json(preflightScriptText(scriptText));
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/ai-script/illustration-slots", async (req, res, next) => {
    try {
      const scriptText = stringifyScriptInput(req.body?.scriptText ?? req.body?.script);
      if (!scriptText.trim()) {
        return res.status(400).json({ message: "scriptText 不能为空。" });
      }
      const preflight = preflightScriptText(scriptText);
      if (!preflight.report.ok || !preflight.script) {
        return res.status(400).json({
          message: "脚本预检未通过，暂时无法分析插图位置。",
          report: preflight.report,
        });
      }
      const maxSlots =
        typeof req.body?.maxSlots === "number" && Number.isFinite(req.body.maxSlots)
          ? Math.max(0, Math.min(8, Math.round(req.body.maxSlots)))
          : 6;
      return res.json({
        suggestions: suggestIllustrationSlots(preflight.script, maxSlots),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/ai-script/apply-illustrations", async (req, res, next) => {
    try {
      const scriptText = stringifyScriptInput(req.body?.scriptText ?? req.body?.script);
      if (!scriptText.trim()) {
        return res.status(400).json({ message: "scriptText 不能为空。" });
      }
      const preflight = preflightScriptText(scriptText);
      if (!preflight.report.ok || !preflight.script) {
        return res.status(400).json({
          message: "脚本预检未通过，暂时无法插入插图。",
          report: preflight.report,
        });
      }
      const enhanced = enhanceScriptWithIllustrations(
        preflight.script,
        Array.isArray(req.body?.illustrations) ? req.body.illustrations : [],
      );
      const enhancedPreflight = preflightScriptText(enhanced.scriptText);
      if (!enhancedPreflight.report.ok || !enhancedPreflight.script) {
        return res.status(400).json({
          message: "插图增强后的脚本预检未通过。",
          report: enhancedPreflight.report,
          inserted: enhanced.inserted,
          skipped: enhanced.skipped,
        });
      }
      return res.json({
        script: enhancedPreflight.script,
        scriptText: JSON.stringify(enhancedPreflight.script),
        report: enhancedPreflight.report,
        suggestions: enhanced.suggestions,
        inserted: enhanced.inserted,
        skipped: enhanced.skipped,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/ai-script/generate", async (req, res, next) => {
    const controller = createRequestAbortController(req, res);
    try {
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
      const mode = parseExplanationMode(req.body?.mode);
      if (!prompt) {
        return res.status(400).json({ message: "prompt 不能为空。" });
      }
      if (prompt.length > 8000) {
        return res.status(400).json({ message: "prompt 不能超过 8000 个字符。" });
      }
      const sourceImageDataUrl =
        typeof req.body?.sourceImageDataUrl === "string" ? req.body.sourceImageDataUrl.trim() : "";
      if (sourceImageDataUrl) {
        if (sourceImageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
          return res.status(413).json({ message: "图片太大，请上传 10MB 以内的图片。" });
        }
        if (!IMAGE_DATA_URL_PATTERN.test(sourceImageDataUrl)) {
          return res.status(400).json({
            message: "原题图片只支持 PNG、JPEG、WEBP 或 GIF 格式。",
          });
        }
      }
      const imageAnchors = Array.isArray(req.body?.imageAnchors) ? req.body.imageAnchors : undefined;
      const boardTheme = normalizeBoardTheme(req.body?.boardTheme);
      const canvasAspect = normalizeCanvasAspect(req.body?.canvasAspect);
      const sourceImageSizeRaw =
        req.body?.sourceImageSize && typeof req.body.sourceImageSize === "object"
          ? (req.body.sourceImageSize as Record<string, unknown>)
          : undefined;
      const sourceImageSize =
        typeof sourceImageSizeRaw?.width === "number" && typeof sourceImageSizeRaw?.height === "number"
          ? { width: sourceImageSizeRaw.width, height: sourceImageSizeRaw.height }
          : undefined;
      return res.json(
        await generateAiScript(prompt, mode, controller.signal, {
          sourceImageDataUrl: sourceImageDataUrl || undefined,
          imageAnchors,
          sourceImageSize,
          boardTheme,
          canvasAspect,
        }),
      );
    } catch (error) {
      if (controller.signal.aborted && !res.headersSent) {
        return res.status(499).json({ message: "生成讲解已取消。" });
      }
      return next(error);
    }
  });

  app.post("/api/ai-script/knowledge-summary", async (req, res, next) => {
    const controller = createRequestAbortController(req, res);
    try {
      const scriptText =
        typeof req.body?.scriptText === "string" ? req.body.scriptText : "";
      const originalPrompt =
        typeof req.body?.originalPrompt === "string" ? req.body.originalPrompt : "";
      const mode = parseExplanationMode(req.body?.mode);
      if (!scriptText.trim()) {
        return res.status(400).json({ message: "scriptText 不能为空。" });
      }
      if (originalPrompt.length > 8000) {
        return res.status(400).json({ message: "originalPrompt 不能超过 8000 个字符。" });
      }
      return res.json(
        await summarizeScriptKnowledge(scriptText, originalPrompt, mode, controller.signal),
      );
    } catch (error) {
      if (controller.signal.aborted && !res.headersSent) {
        return res.status(499).json({ message: "知识点整理已取消。" });
      }
      return next(error);
    }
  });

  app.post("/api/ai-script/recognize-image", async (req, res, next) => {
    const controller = createRequestAbortController(req, res);
    try {
      const imageDataUrl =
        typeof req.body?.imageDataUrl === "string" ? req.body.imageDataUrl.trim() : "";
      const hint = typeof req.body?.hint === "string" ? req.body.hint : "";
      if (!imageDataUrl) {
        return res.status(400).json({ message: "imageDataUrl 不能为空。" });
      }
      if (imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        return res.status(413).json({ message: "图片太大，请上传 10MB 以内的图片。" });
      }
      if (!IMAGE_DATA_URL_PATTERN.test(imageDataUrl)) {
        return res.status(400).json({
          message: "只支持 PNG、JPEG、WEBP 或 GIF 图片。",
        });
      }
      if (hint.length > 1000) {
        return res.status(400).json({ message: "补充说明不能超过 1000 个字符。" });
      }
      return res.json(await recognizeProblemFromImage(imageDataUrl, hint, controller.signal));
    } catch (error) {
      if (controller.signal.aborted && !res.headersSent) {
        return res.status(499).json({ message: "图片识别已取消。" });
      }
      return next(error);
    }
  });

  app.post("/api/ai-script/repair", async (req, res, next) => {
    const controller = createRequestAbortController(req, res);
    try {
      const scriptText =
        typeof req.body?.scriptText === "string" ? req.body.scriptText : "";
      const instruction =
        typeof req.body?.instruction === "string" ? req.body.instruction : "";
      if (!scriptText.trim()) {
        return res.status(400).json({ message: "scriptText 不能为空。" });
      }
      if (instruction.length > 2000) {
        return res.status(400).json({ message: "instruction 不能超过 2000 个字符。" });
      }
      return res.json(await repairAiScript(scriptText, instruction, controller.signal));
    } catch (error) {
      if (controller.signal.aborted && !res.headersSent) {
        return res.status(499).json({ message: "修复讲解已取消。" });
      }
      return next(error);
    }
  });

  return httpServer;
}
