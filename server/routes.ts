import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { storage } from "./storage";

const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
const DEFAULT_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

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

  return httpServer;
}
