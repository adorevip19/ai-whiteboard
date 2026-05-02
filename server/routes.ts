import express, { type Express, type Request, type Response } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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
} from "./aiScript";
import { renderScriptToWebmInHeadlessBrowser } from "./videoRender";

const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const MAX_IMAGE_DATA_URL_LENGTH = 14 * 1024 * 1024;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;
const MAX_VIDEO_UPLOAD_BYTES = 500 * 1024 * 1024;

const videoRenderJobs = new Map<
  string,
  {
    resolve: (buffer: Buffer) => void;
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

async function convertWebmBufferToMp4(webm: Buffer) {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-whiteboard-video-"));
  const inputPath = path.join(workDir, "input.webm");
  const outputPath = path.join(workDir, "whiteboard-lecture.mp4");
  try {
    await fs.writeFile(inputPath, webm);
    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
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
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function createVideoRenderJob() {
  const id = randomUUID();
  const promise = new Promise<Buffer>((resolve, reject) => {
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
  job.resolve(buffer);
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
  return `${req.protocol}://${req.get("host")}`;
}

function stringifyScriptInput(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return JSON.stringify(value, null, 2);
  return "";
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
      ? "讲解模式：简洁讲解。只点破关键卡点，但仍配合白板动作展示关键关系。"
      : "讲解模式：详细讲解。必须先读题，再分析题干，然后完整讲解。",
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

  app.post("/api/video/render", async (req, res, next) => {
    const controller = createRequestAbortController(req, res);
    const job = createVideoRenderJob();
    try {
      const mode = parseExplanationMode(req.body?.mode);
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
        const generated = await generateAiScript(prompt, mode, controller.signal);
        scriptText = generated.scriptText;
      }

      const baseUrl = getBaseUrl(req);
      await renderScriptToWebmInHeadlessBrowser({
        baseUrl,
        scriptText,
        uploadUrl: `${baseUrl}/api/video/render-jobs/${job.id}/webm`,
        ttsEnabled,
        playbackSpeed,
      });
      const webm = await job.promise;
      const mp4 = await convertWebmBufferToMp4(webm);
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
      return res.json(await generateAiScript(prompt, mode, controller.signal));
    } catch (error) {
      if (controller.signal.aborted && !res.headersSent) {
        return res.status(499).json({ message: "生成讲解已取消。" });
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
