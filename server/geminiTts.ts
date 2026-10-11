import { createHash } from "node:crypto";

export const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";
export const DEFAULT_TEACHER_VOICE = "Sulafat";
export const TEACHER_STYLE_VERSION = "teacher-v1";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const voices = new Set("Zephyr Puck Charon Kore Fenrir Leda Orus Aoede Callirrhoe Autonoe Enceladus Iapetus Umbriel Algieba Despina Erinome Algenib Rasalgethi Laomedeia Achernar Alnilam Schedar Gacrux Pulcherrima Achird Zubenelgenubi Vindemiatrix Sadachbia Sadaltager Sulafat".split(" "));

export class TtsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function buildTeacherStyle(text: string, rate = 1) {
  const directions = [
    "You are a warm, engaging bilingual teacher speaking directly to one learner. Keep the same natural voice identity across all lesson segments.",
    "Use native standard Mandarin and clear natural English, switching languages smoothly without changing speaker or using a caricatured accent.",
    "Teach the meaning with varied, conversational intonation and short meaningful pauses. Let curiosity, explanation, emphasis and encouragement follow the meaning of each sentence, even within the same passage.",
    "Use a curious inviting tone for questions (natural English question intonation); give the learner a short thinking pause. Reveal an answer with gentle brightness, not shouting.",
    "Slow slightly and give selective vocal stress to the important concept or contrast. Connect reasoning calmly; land conclusions clearly. Do not emphasize every word, end every sentence with a rise, or use a flat announcer cadence.",
    "Pronounce English examples and vocabulary clearly with correct lexical stress, slightly slower than surrounding explanation. Preserve phonics sounds rather than substituting letter names when a sound is written.",
    "Be friendly and expressive without baby talk, theatrical acting, forced laughter, or excessive breathiness. Do not add words, greetings, explanations, sound effects or music. Speak only the supplied transcript; never read these delivery instructions aloud.",
  ];
  if (/注意|关键|重点|记住|不是.+而是|区别|长音|重音|important|remember/i.test(text)) {
    directions.push("This passage contains a teaching focus: place a brief anticipatory pause before the key idea, then emphasize it through clarity and a small pitch contrast rather than loudness.");
  }
  if (/跟读|跟我读|轮到你|试一试|你来|做得好|很好|your turn|repeat after|well done/i.test(text)) {
    directions.push("Give practice invitations and praise a warm encouraging finish, leaving a brief natural pause for a response. Do not invent a student's reply.");
  }
  if (/^[a-zA-Z\s.,!?'-]+$/.test(text)) {
    directions.push("This is an English-only demonstration within a bilingual lesson. Read it as clear natural English, with no added Chinese translation or introduction.");
  }
  if (rate !== 1) directions.push(`Requested speaking pace is approximately ${rate.toFixed(2)} times normal; preserve intelligibility and meaningful pauses. This is a delivery target, not an exact duration.`);
  return directions.join("\n");
}

export function prepareTts(input: { text?: unknown; voice?: unknown; rate?: unknown }, configuredVoice?: string) {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new TtsError(400, "text 不能为空。");
  if (text.length > 1200) throw new TtsError(400, "text 不能超过 1200 个字符，请按完整讲解段落拆分。");
  const voice = typeof input.voice === "string" && input.voice.trim()
    ? input.voice.trim() : configuredVoice?.trim() || DEFAULT_TEACHER_VOICE;
  if (!voices.has(voice)) throw new TtsError(400, "请使用有效的 Gemini 预设音色，默认音色为 Sulafat。");
  const rate = typeof input.rate === "number" && Number.isFinite(input.rate)
    ? Math.max(0.5, Math.min(input.rate, 2)) : 1;
  const style = buildTeacherStyle(text, rate);
  const request = {
    model: GEMINI_TTS_MODEL,
    input: [{ type: "user_input", content: [{ type: "text", text,
      annotations: [{ type: "speech_metadata", style }],
    }] }],
    response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24000 },
    generation_config: { speech_config: [{ voice }] },
  };
  return { request, voice };
}

export function extractWav(result: unknown): Buffer {
  const steps = (result as { steps?: Array<{ type?: string; content?: Array<{ type?: string; data?: string }> }> })?.steps;
  const blocks = Array.isArray(steps) ? steps.filter(s => s.type === "model_output")
    .flatMap(s => Array.isArray(s.content) ? s.content : []).filter(c => c.type === "audio" && typeof c.data === "string") : [];
  const data = blocks.at(-1)?.data;
  if (!data) throw new TtsError(502, "Gemini 没有返回配音，请重试或调整旁白内容。");
  const wav = Buffer.from(data, "base64");
  if (wav.length <= 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new TtsError(502, "Gemini 返回的音频格式无效，未缓存此结果。");
  }
  return wav;
}

// A bounded process-local cache covers editor, share players and video export.
// Include model, voice, full delivery instructions and credential identity in the key.
export function createGeminiTts(fetchImpl: typeof fetch = fetch, timeoutMs = 120000) {
  const cache = new Map<string, Buffer>();
  let cacheBytes = 0;
  return async (input: { text?: unknown; voice?: unknown; rate?: unknown }, options: {
    apiKey?: string; voice?: string; signal?: AbortSignal;
  }) => {
    const { request, voice } = prepareTts(input, options.voice);
    if (!options.apiKey?.trim()) throw new TtsError(501, "Gemini TTS 未配置，请在服务端设置 GEMINI_API_KEY。");
    options.signal?.throwIfAborted();
    const cacheKey = createHash("sha256").update(options.apiKey).update(TEACHER_STYLE_VERSION).update(JSON.stringify(request)).digest("hex");
    const hit = cache.get(cacheKey);
    if (hit) {
      cache.delete(cacheKey); cache.set(cacheKey, hit);
      return { audio: hit, voice, cached: true };
    }
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST", signal,
        headers: { "x-goog-api-key": options.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        // Do not expose upstream bodies, credentials, or request transcripts in logs.
        await response.body?.cancel();
        if (response.status === 429) throw new TtsError(429, "Gemini 配音额度或速率受限，请稍后重试；持续出现时请检查 AI Studio 配额与计费。");
        if ([401, 403].includes(response.status)) throw new TtsError(403, "Gemini 拒绝访问，请检查服务端密钥、项目权限和支持地区。");
        if (response.status === 404) throw new TtsError(400, "当前项目无法访问 Gemini 3.8 Flash TTS，请检查模型可用性。");
        if (response.status === 400) throw new TtsError(400, "Gemini 无法处理此配音请求，请检查旁白内容与音色。");
        throw new TtsError(502, `Gemini 配音服务暂时不可用（HTTP ${response.status}）。`);
      }
      const audio = extractWav(await response.json());
      if (audio.length <= MAX_CACHE_BYTES) {
        while (cacheBytes + audio.length > MAX_CACHE_BYTES && cache.size) {
          const oldest = cache.keys().next().value!;
          cacheBytes -= cache.get(oldest)!.length; cache.delete(oldest);
        }
        // Concurrent identical requests can finish independently.
        cacheBytes -= cache.get(cacheKey)?.length ?? 0;
        cache.set(cacheKey, audio); cacheBytes += audio.length;
      }
      return { audio, voice, cached: false };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (deadline.aborted) throw new TtsError(504, "Gemini 配音生成超时，请稍后重试或缩短单段旁白。");
      if (error instanceof TtsError) throw error;
      throw new TtsError(502, "无法连接 Gemini 配音服务，请检查网络后重试。");
    }
  };
}

export const synthesizeTeacherNarration = createGeminiTts();
