import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Download,
  FileText,
  Gauge,
  ImagePlus,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Send,
  SkipBack,
  SkipForward,
  StepForward,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import { WhiteboardCanvas } from "@/whiteboard/WhiteboardCanvas";
import { NarrationBar } from "@/whiteboard/NarrationBar";
import { ScriptRunner, type WaitState } from "@/whiteboard/ScriptRunner";
import {
  validateScript,
  describeCommand,
  type AnnotationElement,
  type CanvasConfig,
  type RenderedElement,
  type WhiteboardCommand,
} from "@/whiteboard/commandTypes";
import { sampleScriptString, sampleScript } from "@/whiteboard/sampleScript";

type RunStatus = "idle" | "preparing" | "running" | "done" | "error";
type AiStatus = "idle" | "checking" | "recognizing" | "generating" | "repairing" | "error";
type ExplanationMode = "detailed" | "concise";
type VideoRenderStatus = "idle" | "rendering" | "ready" | "error";

type CachedTtsAudio = {
  url: string;
  blob: Blob;
};

type ScriptPreflightIssue = {
  severity: "error" | "warning" | "suggestion";
  commandIndex?: number;
  commandId?: string;
  commandType?: string;
  message: string;
  suggestion?: string;
};

type ScriptPreflightReport = {
  ok: boolean;
  summary: string;
  errors: number;
  warnings: number;
  suggestions: number;
  issues: ScriptPreflightIssue[];
};

type AiScriptResponse = {
  scriptText: string;
  explanation: string;
  report: ScriptPreflightReport;
  rounds?: Array<{
    round: number;
    action: "generate" | "repair";
    model?: string;
    durationMs?: number;
    report: ScriptPreflightReport;
  }>;
};

type ImageRecognitionResponse = {
  problemText: string;
  diagramDescription: string;
  subject?: string;
  confidence: "high" | "medium" | "low";
  notes?: string;
};

const MAX_UPLOAD_IMAGE_SIZE = 10 * 1024 * 1024;
const TTS_RETRY_DELAYS_MS = [1200, 2500, 5000, 8000, 12000];

declare global {
  interface Window {
    aiWhiteboardRecordScript?: (params: {
      scriptText: string;
      uploadUrl: string;
      ttsEnabled?: boolean;
      playbackSpeed?: number;
    }) => Promise<{ ok: true; size: number }>;
  }
}

function getNarrationFromCommand(cmd: WhiteboardCommand) {
  return "narration" in cmd && typeof cmd.narration === "string"
    ? cmd.narration.trim() || null
    : null;
}

function getTtsCacheKey(text: string) {
  return text;
}

function clampVoiceSpeed(speed: number) {
  return Math.max(0.5, Math.min(speed, 2));
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

class TtsSynthesisError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "TtsSynthesisError";
    this.status = status;
  }
}

export default function WhiteboardPage() {
  const [scriptText, setScriptText] = useState<string>(sampleScriptString);
  const [canvas, setCanvas] = useState<CanvasConfig>(sampleScript.canvas);
  const [elements, setElements] = useState<RenderedElement[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationElement[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepTotal, setStepTotal] = useState(0);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [activeCommands, setActiveCommands] = useState<WhiteboardCommand[]>([]);
  const [narration, setNarration] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(0.9);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsStatus, setTtsStatus] = useState<string>("TTS 待生成");
  const [waitState, setWaitState] = useState<WaitState | null>(null);
  const [aiPrompt, setAiPrompt] = useState(
    "请讲解一道初中数学一次函数题：已知 y = 2x + 1，观察图像并求 x = 3 时的 y 值。要求有坐标系、函数图像、移动激光笔和最终答案。",
  );
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [aiMessage, setAiMessage] = useState("");
  const [aiExplanation, setAiExplanation] = useState("");
  const [preflightReport, setPreflightReport] = useState<ScriptPreflightReport | null>(null);
  const [scriptPanelOpen, setScriptPanelOpen] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [explanationMode, setExplanationMode] = useState<ExplanationMode>("detailed");
  const [videoExportMessage, setVideoExportMessage] = useState("");
  const [videoDownloadUrl, setVideoDownloadUrl] = useState("");
  const [videoRenderStatus, setVideoRenderStatus] = useState<VideoRenderStatus>("idle");
  const [videoRenderProgress, setVideoRenderProgress] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const runnerRef = useRef<ScriptRunner | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSpeedRef = useRef(playbackSpeed);
  const ttsEnabledRef = useRef(ttsEnabled);
  const ttsRequestIdRef = useRef(0);
  const ttsCacheRef = useRef<Map<string, CachedTtsAudio>>(new Map());
  const ttsPrefetchControllerRef = useRef<AbortController | null>(null);
  const aiGenerationControllerRef = useRef<AbortController | null>(null);
  const aiGenerationIdRef = useRef(0);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoRenderControllerRef = useRef<AbortController | null>(null);
  const videoRenderIdRef = useRef(0);
  const preparedVideoBlobRef = useRef<Blob | null>(null);
  const preparedVideoKeyRef = useRef("");
  const videoDownloadUrlRef = useRef("");
  const audioResolveRef = useRef<(() => void) | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const resolveActiveAudio = () => {
    const resolve = audioResolveRef.current;
    audioResolveRef.current = null;
    resolve?.();
  };

  const revokeManualDownloadUrl = () => {
    if (!videoDownloadUrlRef.current) return;
    URL.revokeObjectURL(videoDownloadUrlRef.current);
    videoDownloadUrlRef.current = "";
    setVideoDownloadUrl("");
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      runnerRef.current?.cancel();
      audioRef.current?.pause();
      resolveActiveAudio();
      ttsPrefetchControllerRef.current?.abort();
      aiGenerationControllerRef.current?.abort();
      videoRenderControllerRef.current?.abort();
      if (videoDownloadUrlRef.current) {
        URL.revokeObjectURL(videoDownloadUrlRef.current);
      }
      Array.from(ttsCacheRef.current.values()).forEach((cached) => {
        URL.revokeObjectURL(cached.url);
      });
      ttsCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
    runnerRef.current?.setPlaybackSpeed(playbackSpeed);
  }, [playbackSpeed]);

  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
    if (!ttsEnabled) setTtsStatus("TTS 未开启");
    else setTtsStatus((current) => (current === "TTS 未开启" ? "TTS 待生成" : current));
  }, [ttsEnabled]);

  const pausePlayback = () => {
    runnerRef.current?.pause();
    audioRef.current?.pause();
    setIsPaused(true);
  };

  const resumePlayback = () => {
    runnerRef.current?.resume();
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = clampVoiceSpeed(playbackSpeedRef.current);
      void audio.play().catch(() => {
        setTtsStatus("浏览器阻止了自动播放，请再次点击继续或关闭 TTS");
      });
    }
    setIsPaused(false);
  };

  const togglePausePlayback = () => {
    if (status !== "running" && status !== "preparing") return;
    if (isPaused) resumePlayback();
    else pausePlayback();
  };

  const waitWithAbort = (delayMs: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const timeout = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });

  const isTransientTtsError = (error: unknown) => {
    if (isAbortError(error)) return false;
    if (error instanceof TtsSynthesisError) {
      if (!error.status) return true;
      return [408, 409, 425, 429, 500, 502, 503, 504].includes(error.status);
    }
    if (error instanceof TypeError) return true;
    const message = error instanceof Error ? error.message : String(error);
    return /throttl|timeout|network|fetch|temporar|稍后|限流|超时|中断/i.test(message);
  };

  const enterFullscreen = () => {
    setIsFullscreen(true);
    void rootRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const exitFullscreen = () => {
    setIsFullscreen(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  };

  const toggleFullscreen = () => {
    if (isFullscreen) exitFullscreen();
    else enterFullscreen();
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const playCachedNarration = (text: string | null) => {
    setNarration(text);

    resolveActiveAudio();
    const requestId = ++ttsRequestIdRef.current;
    audioRef.current?.pause();
    audioRef.current = null;

    if (!ttsEnabledRef.current) {
      setTtsStatus("TTS 未开启");
      return Promise.resolve();
    }
    if (!text) {
      setTtsStatus("等待旁白");
      return Promise.resolve();
    }

    const cached = ttsCacheRef.current.get(getTtsCacheKey(text));
    if (!cached) {
      setTtsStatus("语音缓存未命中，请重新运行脚本");
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const audio = new Audio(cached.url);
      audioRef.current = audio;

      const finish = () => {
        if (audioResolveRef.current === finish) {
          audioResolveRef.current = null;
        }
        if (requestId === ttsRequestIdRef.current) setTtsStatus("语音完成");
        resolve();
      };
      audioResolveRef.current = finish;

      const playAudio = () => {
        if (requestId !== ttsRequestIdRef.current) {
          finish();
          return;
        }
        audio.playbackRate = clampVoiceSpeed(playbackSpeedRef.current);
        void audio.play().then(
          () => setTtsStatus("语音播放中"),
          () => {
            setTtsStatus("浏览器阻止了自动播放，请再次点击运行或关闭 TTS");
            finish();
          },
        );
      };

      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        playAudio();
      } else {
        audio.onloadedmetadata = playAudio;
      }
      audio.onended = finish;
      audio.onerror = finish;
    });
  };

  const synthesizeNarration = async (
    text: string,
    signal: AbortSignal,
    options: {
      maxAttempts?: number;
      onRetry?: (params: {
        nextAttempt: number;
        maxAttempts: number;
        delayMs: number;
        error: unknown;
      }) => void;
    } = {},
  ) => {
    const cacheKey = getTtsCacheKey(text);
    const cached = ttsCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const maxAttempts = options.maxAttempts ?? TTS_RETRY_DELAYS_MS.length + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, rate: 1 }),
          signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new TtsSynthesisError(
            body?.message ?? `TTS 请求失败：${response.status}`,
            response.status,
          );
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = {
          blob,
          url,
        };
        ttsCacheRef.current.set(cacheKey, audio);
        return audio;
      } catch (error) {
        lastError = error;
        if (signal.aborted || isAbortError(error) || !isTransientTtsError(error) || attempt >= maxAttempts) {
          throw error;
        }
        const delayMs = TTS_RETRY_DELAYS_MS[Math.min(attempt - 1, TTS_RETRY_DELAYS_MS.length - 1)];
        options.onRetry?.({
          nextAttempt: attempt + 1,
          maxAttempts,
          delayMs,
          error,
        });
        await waitWithAbort(delayMs, signal);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };

  const prefetchNarrations = async (commands: WhiteboardCommand[]) => {
    if (!ttsEnabledRef.current) {
      setTtsStatus("TTS 未开启");
      return true;
    }

    ttsPrefetchControllerRef.current?.abort();
    const controller = new AbortController();
    ttsPrefetchControllerRef.current = controller;

    const narrations = Array.from(
      new Set(commands.map(getNarrationFromCommand).filter(Boolean) as string[]),
    );
    if (narrations.length === 0) {
      setTtsStatus("脚本没有旁白");
      return true;
    }

    try {
      for (let i = 0; i < narrations.length; i++) {
        const text = narrations[i];
        setTtsStatus(`正在预生成语音 ${i + 1}/${narrations.length}`);
        setAiMessage(`正在生成语音 ${i + 1}/${narrations.length}`);
        setAiProgress(Math.min(98, 78 + Math.round(((i + 1) / narrations.length) * 20)));
        await synthesizeNarration(text, controller.signal, {
          onRetry: ({ nextAttempt, maxAttempts, delayMs, error }) => {
            const message = error instanceof Error ? error.message : String(error);
            const seconds = Math.ceil(delayMs / 1000);
            const retryText = `语音 ${i + 1}/${narrations.length} 生成中断，${seconds} 秒后自动重试 ${nextAttempt}/${maxAttempts}`;
            setTtsStatus(retryText);
            setAiMessage(`${retryText}：${message}`);
            setVideoExportMessage(retryText);
          },
        });
      }
      setTtsStatus(`语音已缓存 ${narrations.length} 条`);
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      const message = error instanceof Error ? error.message : String(error);
      setTtsStatus(message);
      setErrorMsg(message);
      setStatus("error");
      return false;
    } finally {
      if (ttsPrefetchControllerRef.current === controller) {
        ttsPrefetchControllerRef.current = null;
      }
    }
  };

  const runScriptText = async (text: string) => {
    // Cancel any in-flight run.
    runnerRef.current?.cancel();
    runnerRef.current = null;
    ttsPrefetchControllerRef.current?.abort();

    setErrorMsg("");
    setIsPaused(false);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setStatus("error");
      setErrorMsg(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const result = validateScript(parsed);
    if (!result.ok) {
      setStatus("error");
      setErrorMsg(result.error);
      return;
    }

    setStatus(ttsEnabled ? "preparing" : "running");
    const ttsReady = await prefetchNarrations(result.script.commands);
    if (!ttsReady) {
      return;
    }

    // Reset state for a fresh run.
    setActiveCommands(result.script.commands);
    setCanvas(result.script.canvas);
    setElements([]);
    setAnnotations([]);
    setNarration(null);
    setStepIndex(0);
    setStepTotal(result.script.commands.length);
    setStatus("running");
    setWaitState(null);

    const runner = new ScriptRunner(result.script, {
      onCanvasChange: (c) => setCanvas(c),
      onElementsChange: (els) => setElements(els),
      onAnnotationsChange: (anns) => setAnnotations(anns),
      onStepChange: (i, total) => {
        setStepIndex(i);
        setStepTotal(total);
      },
      onNarrationChange: (n) => playCachedNarration(n),
      onWaitChange: (wait) => setWaitState(wait),
      onComplete: () => {
        setWaitState(null);
        setIsPaused(false);
        setStatus("done");
      },
      onError: (msg) => {
        setErrorMsg(msg);
        setIsPaused(false);
        setStatus("error");
      },
    }, { playbackSpeed });
    runnerRef.current = runner;
    void runner.run();
  };

  const handleRun = async () => {
    await runScriptText(scriptText);
  };

  const callAiEndpoint = async <T,>(
    url: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.message ?? `请求失败：${response.status}`);
    }
    return data as T;
  };

  const isAbortError = (error: unknown) =>
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError";

  const readImageAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("图片读取失败，请换一张图片重试。"));
      };
      reader.onerror = () => reject(new Error("图片读取失败，请换一张图片重试。"));
      reader.readAsDataURL(file);
    });

  const handleRecognizeImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setAiStatus("error");
      setAiMessage("请选择 PNG、JPEG、WEBP 或 GIF 图片。");
      return;
    }
    if (file.size > MAX_UPLOAD_IMAGE_SIZE) {
      setAiStatus("error");
      setAiMessage("图片太大，请上传 10MB 以内的图片。");
      return;
    }

    aiGenerationControllerRef.current?.abort();
    const controller = new AbortController();
    const generationId = aiGenerationIdRef.current + 1;
    aiGenerationIdRef.current = generationId;
    aiGenerationControllerRef.current = controller;

    setAiStatus("recognizing");
    setAiProgress(18);
    setAiMessage("正在读取图片...");
    setAiExplanation("");
    setPreflightReport(null);
    let progressTimer: number | undefined;
    try {
      const imageDataUrl = await readImageAsDataUrl(file);
      if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;
      setAiMessage("正在识别题目图片...");
      progressTimer = window.setInterval(() => {
        setAiProgress((value) => (value < 88 ? value + 3 : value));
      }, 800);
      const result = await callAiEndpoint<ImageRecognitionResponse>(
        "/api/ai-script/recognize-image",
        {
          imageDataUrl,
          hint: aiPrompt.trim(),
        },
        controller.signal,
      );
      if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;
      const nextPrompt = [
        "请根据下面从题目图片中识别出的内容，生成一份适合课堂讲解的白板脚本。",
        explanationMode === "concise"
          ? "讲解模式：简洁讲解。用户可能已经读过题并思考过，只需要用一两句话点破最关键、最容易卡住的思路；仍然要配合白板动作展示关键关系。"
          : "讲解模式：详细讲解。讲解开始必须先读题；读题之后必须帮学生分析题干，拆出已知条件、图示信息和要解决的问题。",
        "如果识别内容包含图示/图片/实验装置/函数图/几何图/统计图，必须在白板上重构关键图示。不要只讲文字。即使图示不复杂，也要用线段、矩形、箭头、坐标系、几何命令或标签把图中关键结构画出来。",
        result.subject ? `学科/类型：${result.subject}` : "",
        `题目内容：\n${result.problemText}`,
        result.diagramDescription ? `图片/图示内容：\n${result.diagramDescription}` : "",
        result.notes ? `识别备注：${result.notes}` : "",
        result.confidence === "low"
          ? "注意：图片识别置信度较低，讲解前请先核对题干中可能看不清的地方。"
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      setAiPrompt(nextPrompt);
      setAiMessage(
        `图片识别完成，已填入输入框。识别置信度：${
          result.confidence === "high" ? "高" : result.confidence === "medium" ? "中" : "低"
        }。`,
      );
      setAiExplanation(result.notes ?? "");
      setAiProgress(100);
      setAiStatus("idle");
      window.setTimeout(() => setAiProgress(0), 450);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        setAiMessage("已取消图片识别。");
        setAiStatus("idle");
        setAiProgress(0);
        return;
      }
      setAiProgress(0);
      setAiMessage(error instanceof Error ? error.message : String(error));
      setAiStatus("error");
    } finally {
      if (progressTimer !== undefined) window.clearInterval(progressTimer);
      if (aiGenerationControllerRef.current === controller) {
        aiGenerationControllerRef.current = null;
      }
    }
  };

  const handleImageInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || aiBusy) return;
    void handleRecognizeImage(file);
  };

  const applyAiResult = (result: AiScriptResponse) => {
    setScriptText(result.scriptText);
    setAiExplanation(result.explanation);
    setPreflightReport(result.report);
    setAiMessage(result.report.summary);
    setErrorMsg("");
    try {
      const parsed = JSON.parse(result.scriptText);
      const validated = validateScript(parsed);
      if (validated.ok) {
        setCanvas(validated.script.canvas);
      }
    } catch {
      // The visible preflight report already carries the actionable failure.
    }
  };

  const handleGenerateWithAi = async (playAfterGenerate: boolean) => {
    aiGenerationControllerRef.current?.abort();
    const controller = new AbortController();
    const generationId = aiGenerationIdRef.current + 1;
    aiGenerationIdRef.current = generationId;
    aiGenerationControllerRef.current = controller;

    setTtsEnabled(true);
    ttsEnabledRef.current = true;
    setAiStatus("generating");
    setAiProgress(12);
    setAiMessage("正在准备讲解...");
    setPreflightReport(null);
    let progressTimer: number | undefined;
    try {
      progressTimer = window.setInterval(() => {
        setAiProgress((value) => {
          if (value < 72) return value + 4;
          if (value < 88) return value + 1;
          return value;
        });
      }, 900);
      const result = await callAiEndpoint<AiScriptResponse>(
        "/api/ai-script/generate",
        { prompt: aiPrompt, mode: explanationMode },
        controller.signal,
      );
      if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;
      setAiProgress(76);
      applyAiResult(result);
      if (result.report.ok) {
        startVideoPreRender(result.scriptText);
      } else {
        resetPreparedVideo("");
      }
      if (playAfterGenerate && result.report.ok) {
        await runScriptText(result.scriptText);
      }
      if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;
      setAiStatus("idle");
      setAiProgress(100);
      window.setTimeout(() => setAiProgress(0), 450);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        setAiMessage("已取消生成讲解。");
        setAiStatus("idle");
        setAiProgress(0);
        return;
      }
      setAiProgress(0);
      const message = error instanceof Error ? error.message : String(error);
      setAiMessage(message);
      setAiStatus("error");
    } finally {
      if (progressTimer !== undefined) window.clearInterval(progressTimer);
      if (aiGenerationControllerRef.current === controller) {
        aiGenerationControllerRef.current = null;
      }
    }
  };

  const handleCancelAiGeneration = () => {
    aiGenerationIdRef.current += 1;
    aiGenerationControllerRef.current?.abort();
    aiGenerationControllerRef.current = null;
    ttsPrefetchControllerRef.current?.abort();
    setAiStatus("idle");
    setAiProgress(0);
    setAiMessage(aiStatus === "recognizing" ? "已取消图片识别。" : "已取消生成讲解。");
  };

  const handleStop = () => {
    runnerRef.current?.cancel();
    runnerRef.current = null;
    ttsPrefetchControllerRef.current?.abort();
    ttsRequestIdRef.current += 1;
    audioRef.current?.pause();
    resolveActiveAudio();
    setIsPaused(false);
    setStatus("idle");
    setWaitState(null);
  };

  const handleClear = () => {
    runnerRef.current?.cancel();
    runnerRef.current = null;
    ttsPrefetchControllerRef.current?.abort();
    ttsRequestIdRef.current += 1;
    audioRef.current?.pause();
    resolveActiveAudio();
    setIsPaused(false);
    setElements([]);
    setAnnotations([]);
    setStepIndex(0);
    setStepTotal(0);
    setStatus("idle");
    setErrorMsg("");
    setActiveCommands([]);
    setNarration(null);
    setWaitState(null);
  };

  const handleLoadSample = () => {
    setScriptText(sampleScriptString);
    setErrorMsg("");
    setPreflightReport(null);
    setAiExplanation("");
    setAiMessage("");
  };

  const handleContinue = () => {
    runnerRef.current?.continueFromWait();
  };

  const createFastPreviewScript = (commands: WhiteboardCommand[], canvasConfig: CanvasConfig) => {
    const previewCommands = commands
      .filter((command) => command.type !== "wait" && command.type !== "laser_pointer")
      .map((command) => {
        const copy = JSON.parse(JSON.stringify(command)) as Record<string, unknown>;
        delete copy.narration;
        if (typeof copy.duration === "number") copy.duration = 1;
        return copy as unknown as WhiteboardCommand;
      });
    return { canvas: canvasConfig, commands: previewCommands };
  };

  const renderThroughStep = async (completedSteps: number) => {
    runnerRef.current?.cancel();
    runnerRef.current = null;
    audioRef.current?.pause();
    resolveActiveAudio();
    setIsPaused(false);
    setStatus("idle");
    setErrorMsg("");
    setNarration(null);
    setWaitState(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(scriptText);
    } catch (e) {
      setStatus("error");
      setErrorMsg(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const result = validateScript(parsed);
    if (!result.ok) {
      setStatus("error");
      setErrorMsg(result.error);
      return;
    }

    const target = Math.max(0, Math.min(completedSteps, result.script.commands.length));
    const previewScript = createFastPreviewScript(
      result.script.commands.slice(0, target),
      result.script.canvas,
    );
    const runner = new ScriptRunner(
      previewScript,
      {
        onCanvasChange: (c) => setCanvas(c),
        onElementsChange: (els) => setElements(els),
        onAnnotationsChange: (anns) => setAnnotations(anns),
        onStepChange: () => {},
        onNarrationChange: () => undefined,
        onWaitChange: () => undefined,
        onComplete: () => {
          setActiveCommands(result.script.commands);
          setStepIndex(target);
          setStepTotal(result.script.commands.length);
          setStatus("idle");
        },
        onError: (msg) => {
          setErrorMsg(msg);
          setStatus("error");
        },
      },
      { playbackSpeed: 2 },
    );
    runnerRef.current = runner;
    await runner.run();
    runnerRef.current = null;
  };

  const handleStepBackward = () => {
    void renderThroughStep(Math.max(0, stepIndex - 1));
  };

  const handleStepForward = () => {
    if (waitState) {
      handleContinue();
      return;
    }
    void renderThroughStep(Math.min(stepTotal || activeCommands.length, stepIndex + 1));
  };

  const handleAiSend = async () => {
    if (!aiPrompt.trim() || aiBusy) return;
    await handleGenerateWithAi(true);
  };

  const drawSvgToCanvas = async (
    svg: SVGSVGElement,
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ) => {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    clone.style.background = canvas.background;
    const serialized = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      image.decoding = "async";
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("白板帧渲染失败。"));
        image.src = url;
      });
      context.fillStyle = canvas.background;
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const playNarrationForExport = async (
    text: string | null,
    audioContext: AudioContext | null,
    destination: MediaStreamAudioDestinationNode | null,
  ) => {
    setNarration(text);
    if (!text || !audioContext || !destination || !ttsEnabledRef.current) return;
    const cached = ttsCacheRef.current.get(getTtsCacheKey(text));
    if (!cached) return;
    const buffer = await cached.blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
    await new Promise<void>((resolve) => {
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = clampVoiceSpeed(playbackSpeedRef.current);
      source.connect(destination);
      source.onended = () => resolve();
      source.start();
    });
  };

  const convertWebmToMp4 = async (webmBlob: Blob) => {
    const response = await fetch("/api/video/convert-mp4", {
      method: "POST",
      headers: { "Content-Type": "video/webm" },
      body: webmBlob,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message ?? `MP4 转码失败：${response.status}`);
    }
    return response.blob();
  };

  const getVideoRenderKey = (
    text: string,
    tts = ttsEnabledRef.current,
    speed = playbackSpeedRef.current,
  ) => JSON.stringify({ text, tts, speed: Number(speed.toFixed(2)) });

  const resetPreparedVideo = (message = "") => {
    videoRenderControllerRef.current?.abort();
    videoRenderControllerRef.current = null;
    videoRenderIdRef.current += 1;
    preparedVideoBlobRef.current = null;
    preparedVideoKeyRef.current = "";
    revokeManualDownloadUrl();
    setVideoRenderStatus("idle");
    setVideoRenderProgress(0);
    if (message) setVideoExportMessage(message);
  };

  const renderScriptToMp4 = async (text: string, signal?: AbortSignal) => {
    const response = await fetch("/api/video/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scriptText: text,
        ttsEnabled: ttsEnabledRef.current,
        playbackSpeed: playbackSpeedRef.current,
      }),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message ?? `MP4 导出失败：${response.status}`);
    }
    return response.blob();
  };

  const startVideoPreRender = (text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      resetPreparedVideo("");
      return;
    }
    const result = validateScript(parsed);
    if (!result.ok) {
      resetPreparedVideo("");
      return;
    }

    const renderKey = getVideoRenderKey(text);
    if (videoRenderStatus === "ready" && preparedVideoKeyRef.current === renderKey) return;

    videoRenderControllerRef.current?.abort();
    const controller = new AbortController();
    const renderId = videoRenderIdRef.current + 1;
    videoRenderIdRef.current = renderId;
    videoRenderControllerRef.current = controller;
    preparedVideoBlobRef.current = null;
    preparedVideoKeyRef.current = renderKey;
    setVideoRenderStatus("rendering");
    setVideoRenderProgress(6);
    setVideoExportMessage("正在后台预渲染 MP4，完成后即可直接下载。");

    let progressTimer: number | undefined = window.setInterval(() => {
      setVideoRenderProgress((value) => {
        if (value < 55) return value + 5;
        if (value < 82) return value + 2;
        if (value < 94) return value + 1;
        return value;
      });
    }, 1000);

    void renderScriptToMp4(text, controller.signal)
      .then((mp4Blob) => {
        if (controller.signal.aborted || videoRenderIdRef.current !== renderId) return;
        preparedVideoBlobRef.current = mp4Blob;
        preparedVideoKeyRef.current = renderKey;
        setVideoRenderStatus("ready");
        setVideoRenderProgress(100);
        setVideoExportMessage("MP4 已预渲染完成，可以下载。");
      })
      .catch((error) => {
        if (isAbortError(error) || controller.signal.aborted) return;
        if (videoRenderIdRef.current !== renderId) return;
        preparedVideoBlobRef.current = null;
        preparedVideoKeyRef.current = "";
        setVideoRenderStatus("error");
        setVideoRenderProgress(0);
        setVideoExportMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (progressTimer !== undefined) {
          window.clearInterval(progressTimer);
          progressTimer = undefined;
        }
        if (videoRenderControllerRef.current === controller) {
          videoRenderControllerRef.current = null;
        }
      });
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    revokeManualDownloadUrl();
    const url = URL.createObjectURL(blob);
    videoDownloadUrlRef.current = url;
    setVideoDownloadUrl(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    link.remove();
  };

  const recordScriptToWebm = async (
    text: string,
    options: {
      tts?: boolean;
      speed?: number;
      onMessage?: (message: string) => void;
    } = {},
  ) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
    const result = validateScript(parsed);
    if (!result.ok) {
      throw new Error(result.error);
    }

    const recorderMimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
        ? "video/webm;codecs=vp8,opus"
        : "video/webm";

    runnerRef.current?.cancel();
    runnerRef.current = null;
    audioRef.current?.pause();
    resolveActiveAudio();
    setIsPaused(false);

    let frameTimer: number | undefined;
    let audioContext: AudioContext | null = null;
    const previousTtsEnabled = ttsEnabledRef.current;
    const previousPlaybackSpeed = playbackSpeedRef.current;
    try {
      const exportTtsEnabled = options.tts ?? ttsEnabledRef.current;
      const exportPlaybackSpeed = options.speed ?? playbackSpeedRef.current;
      ttsEnabledRef.current = exportTtsEnabled;
      playbackSpeedRef.current = exportPlaybackSpeed;

      if (ttsEnabledRef.current) {
        options.onMessage?.("正在预生成旁白语音...");
        const ttsReady = await prefetchNarrations(result.script.commands);
        if (!ttsReady) throw new Error("语音预生成被取消，无法导出视频。");
      }

      const exportScript = {
        ...result.script,
        commands: result.script.commands.filter((command) => command.type !== "wait"),
      };
      setActiveCommands(exportScript.commands);
      setCanvas(exportScript.canvas);
      setElements([]);
      setAnnotations([]);
      setNarration(null);
      setStepIndex(0);
      setStepTotal(exportScript.commands.length);
      setStatus("running");
      setWaitState(null);
      options.onMessage?.("正在准备录制画布...");
      await waitForNextFrame();

      const svg = document.querySelector('[data-testid="whiteboard-svg"]') as SVGSVGElement | null;
      if (!svg) throw new Error("没有找到白板画布，无法导出视频。");

      const recordingCanvas = document.createElement("canvas");
      recordingCanvas.width = exportScript.canvas.width;
      recordingCanvas.height = exportScript.canvas.height;
      const context = recordingCanvas.getContext("2d");
      if (!context) throw new Error("无法创建视频画布。");

      const videoStream = recordingCanvas.captureStream(30);
      let destination: MediaStreamAudioDestinationNode | null = null;
      if (ttsEnabledRef.current) {
        audioContext = new AudioContext();
        destination = audioContext.createMediaStreamDestination();
        destination.stream.getAudioTracks().forEach((track) => videoStream.addTrack(track));
      }

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(videoStream, { mimeType: recorderMimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      let drawing = false;
      frameTimer = window.setInterval(() => {
        if (drawing) return;
        drawing = true;
        void drawSvgToCanvas(svg, context, exportScript.canvas.width, exportScript.canvas.height)
          .catch(() => undefined)
          .finally(() => {
            drawing = false;
          });
      }, 1000 / 15);
      await drawSvgToCanvas(svg, context, exportScript.canvas.width, exportScript.canvas.height);

      options.onMessage?.("正在录制白板讲解...");
      const recordingDone = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
      });
      recorder.start(1000);

      const runner = new ScriptRunner(
        exportScript,
        {
          onCanvasChange: (c) => setCanvas(c),
          onElementsChange: (els) => setElements(els),
          onAnnotationsChange: (anns) => setAnnotations(anns),
          onStepChange: (i, total) => {
            setStepIndex(i);
            setStepTotal(total);
          },
          onNarrationChange: (n) => playNarrationForExport(n, audioContext, destination),
          onWaitChange: () => undefined,
          onComplete: () => undefined,
          onError: (msg) => {
            throw new Error(msg);
          },
        },
        { playbackSpeed: exportPlaybackSpeed },
      );
      runnerRef.current = runner;
      await runner.run();
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      recorder.stop();
      const webmBlob = await recordingDone;
      if (webmBlob.size === 0) throw new Error("录制结果为空。");
      setStatus("done");
      return webmBlob;
    } finally {
      if (frameTimer !== undefined) window.clearInterval(frameTimer);
      audioContext?.close().catch(() => undefined);
      runnerRef.current = null;
      setIsPaused(false);
      ttsEnabledRef.current = previousTtsEnabled;
      playbackSpeedRef.current = previousPlaybackSpeed;
    }
  };

  const handleExportMp4 = async () => {
    if (videoRenderStatus !== "ready") {
      if (videoRenderStatus === "rendering") {
        setVideoExportMessage("MP4 还在后台预渲染，完成后就能下载。");
      } else {
        setVideoExportMessage("请先生成讲解，系统会自动预渲染 MP4。");
      }
      return;
    }
    if (preparedVideoKeyRef.current !== getVideoRenderKey(scriptText) || !preparedVideoBlobRef.current) {
      resetPreparedVideo("讲解脚本或播放设置已变化，请重新生成讲解后再下载 MP4。");
      return;
    }
    downloadBlob(preparedVideoBlobRef.current, "whiteboard-lecture.mp4");
    setVideoExportMessage("MP4 已准备下载。如果浏览器没有弹出下载，请使用备用下载链接。");
  };

  useEffect(() => {
    if (videoRenderStatus === "idle" || !preparedVideoKeyRef.current) return;
    if (preparedVideoKeyRef.current !== getVideoRenderKey(scriptText)) {
      resetPreparedVideo("");
    }
  }, [scriptText, ttsEnabled, playbackSpeed, videoRenderStatus]);

  useEffect(() => {
    window.aiWhiteboardRecordScript = async ({ scriptText, uploadUrl, ttsEnabled, playbackSpeed }) => {
      const webmBlob = await recordScriptToWebm(scriptText, {
        tts: ttsEnabled,
        speed: playbackSpeed,
        onMessage: setVideoExportMessage,
      });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "video/webm" },
        body: webmBlob,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `上传录制视频失败：${response.status}`);
      }
      return { ok: true, size: webmBlob.size };
    };
    return () => {
      delete window.aiWhiteboardRecordScript;
    };
  });

  const stepLabel = useMemo(() => {
    if (status === "error") return "执行出错";
    if (status === "preparing") return "正在预生成语音";
    if (status === "idle") return "等待运行";
    if (status === "done") return "执行完成";
    if (stepTotal === 0) return "等待运行";
    // While running, stepIndex points to the command currently executing.
    const currentNumber = Math.min(stepIndex + 1, stepTotal);
    return `正在执行第 ${currentNumber} / ${stepTotal} 步`;
  }, [status, stepIndex, stepTotal]);

  const currentCommand =
    status === "running" && activeCommands[stepIndex]
      ? activeCommands[stepIndex]
      : null;

  const aiBusy =
    aiStatus === "checking" ||
    aiStatus === "recognizing" ||
    aiStatus === "generating" ||
    aiStatus === "repairing";
  const exportButtonDisabled = videoRenderStatus !== "ready";
  const exportButtonLabel =
    videoRenderStatus === "rendering"
      ? `${Math.round(Math.max(videoRenderProgress, 1))}%`
      : videoRenderStatus === "ready"
        ? "下载 MP4"
        : "导出 MP4";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping =
        tagName === "textarea" ||
        tagName === "input" ||
        target?.isContentEditable;
      if (isTyping) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePausePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleStepBackward();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        handleStepForward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div
      ref={rootRef}
      className="relative flex h-screen w-screen flex-col bg-background text-foreground"
    >
      {aiBusy ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/65 backdrop-blur-sm">
          <Card className="w-[360px] border-primary/20 p-5 shadow-lg">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <div className="text-sm font-semibold">
                  {aiStatus === "recognizing" ? "正在识别题目图片" : "正在生成讲解"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {aiStatus === "recognizing"
                    ? "提取题干、图中文字和关键条件"
                    : "自动生成脚本、预检优化并生成语音"}
                </div>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${Math.max(aiProgress, 8)}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>{aiMessage || "正在准备..."}</span>
              <span className="font-mono">{Math.round(Math.max(aiProgress, 8))}%</span>
            </div>
            <Button
              className="mt-4 w-full"
              variant="outline"
              size="sm"
              onClick={handleCancelAiGeneration}
              data-testid="button-cancel-ai-generation"
            >
              <Square className="mr-1.5 h-3.5 w-3.5" />
              {aiStatus === "recognizing" ? "取消识别" : "取消生成"}
            </Button>
          </Card>
        </div>
      ) : null}
      {/* Header */}
      {!isFullscreen ? (
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-label="AI 白板">
              <path d="M4 4h16v12H4z" />
              <path d="M8 20h8" />
              <path d="M12 16v4" />
              <path d="M7 8l3 3 7-7" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">AI 白板</h1>
            <p className="text-xs text-muted-foreground">JSON 命令式白板 · MVP</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={toggleFullscreen}
            title="全屏模式"
            data-testid="button-fullscreen"
          >
            <Maximize2 className="mr-1.5 h-3.5 w-3.5" />
            全屏
          </Button>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={status === "running" || status === "preparing"}
            data-testid="button-run"
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            运行脚本
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportMp4}
            disabled={exportButtonDisabled}
            className="relative overflow-hidden"
            data-testid="button-export-mp4"
          >
            {videoRenderStatus === "rendering" ? (
              <span
                className="absolute inset-y-0 left-0 bg-primary/15 transition-all duration-500"
                style={{ width: `${Math.max(videoRenderProgress, 6)}%` }}
              />
            ) : null}
            <span className="relative z-10 inline-flex items-center">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {exportButtonLabel}
            </span>
          </Button>
          {status === "running" || status === "preparing" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={handleStop}
              data-testid="button-stop"
            >
              <Square className="mr-1.5 h-3.5 w-3.5" />
              停止
            </Button>
          ) : null}
          {waitState ? (
            <Button
              size="sm"
              variant="default"
              onClick={handleContinue}
              data-testid="button-next"
            >
              <StepForward className="mr-1.5 h-3.5 w-3.5" />
              下一步
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={handleClear}
            data-testid="button-clear"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            清空画布
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleLoadSample}
            data-testid="button-load-sample"
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            示例
          </Button>
          <Button
            size="sm"
            variant={scriptPanelOpen ? "secondary" : "outline"}
            onClick={() => setScriptPanelOpen((open) => !open)}
            data-testid="button-toggle-script"
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            脚本
          </Button>
          <Badge variant="outline" className="ml-2 max-w-[220px] truncate" data-testid="badge-status">
            {(status === "running" || status === "preparing") && (
              <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            )}
            {status === "done" && (
              <CheckCircle2 className="mr-1.5 h-3 w-3 text-emerald-500" />
            )}
            {status === "error" && (
              <AlertCircle className="mr-1.5 h-3 w-3 text-destructive" />
            )}
            {stepLabel}
          </Badge>
        </div>
      </header>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        {scriptPanelOpen && !isFullscreen ? (
          <aside className="flex w-[420px] flex-col border-r">
            <div className="flex items-center gap-3">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-[64px] text-xs font-medium">语音速度</div>
              <Slider
                value={[playbackSpeed]}
                min={0.5}
                max={1.5}
                step={0.05}
                disabled={status === "running" || status === "preparing"}
                onValueChange={(value) => setPlaybackSpeed(value[0] ?? 0.75)}
                className="flex-1"
                data-testid="slider-playback-speed"
              />
              <span className="w-12 text-right font-mono text-xs text-muted-foreground">
                {playbackSpeed.toFixed(2)}x
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-[64px] text-xs font-medium">Azure TTS</div>
              <Switch
                checked={ttsEnabled}
                onCheckedChange={setTtsEnabled}
                data-testid="switch-tts"
              />
              <span className="truncate text-xs text-muted-foreground" title={ttsStatus}>
                {ttsStatus}
              </span>
            </div>
            {waitState ? (
              <div className="rounded-md border bg-primary/5 px-3 py-2 text-xs text-primary">
                {waitState.message}
              </div>
            ) : null}

            <div className="mt-4 flex flex-1 flex-col overflow-hidden">
              <label className="mb-2 text-xs font-medium text-muted-foreground">
                JSON 命令脚本
              </label>
              <Textarea
                value={scriptText}
                onChange={(e) => setScriptText(e.target.value)}
                spellCheck={false}
                className="flex-1 resize-none font-mono text-xs leading-relaxed"
                placeholder='{ "canvas": {...}, "commands": [...] }'
                data-testid="input-script"
              />
            </div>

            {errorMsg ? (
              <Card className="mt-3 border-destructive/40 bg-destructive/5 p-3">
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="font-medium" data-testid="text-error">
                    {errorMsg}
                  </div>
                </div>
              </Card>
            ) : null}
          </aside>
        ) : null}

        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="relative flex flex-1 overflow-hidden">
            <WhiteboardCanvas
              canvas={canvas}
              elements={elements}
              annotations={annotations}
              allowUpscale={isFullscreen}
            />
            {isFullscreen ? (
              <div className="pointer-events-none absolute inset-x-4 top-4 z-20 flex items-center justify-between gap-3">
                <Badge
                  variant="secondary"
                  className="pointer-events-auto bg-background/85 shadow-sm backdrop-blur"
                  data-testid="badge-fullscreen-status"
                >
                  {(status === "running" || status === "preparing") && (
                    <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  )}
                  {stepLabel}
                </Badge>
                <div className="pointer-events-auto flex items-center gap-2 rounded-md bg-background/85 p-1 shadow-sm backdrop-blur">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={togglePausePlayback}
                    disabled={status !== "running" && status !== "preparing"}
                    title="暂停/继续（空格）"
                    data-testid="button-fullscreen-pause-toggle"
                  >
                    {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleStepBackward}
                    disabled={status === "preparing" || aiBusy || stepIndex <= 0}
                    title="后退一步（←）"
                    data-testid="button-fullscreen-step-back"
                  >
                    <SkipBack className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleStepForward}
                    disabled={status === "preparing" || aiBusy || (stepTotal > 0 && stepIndex >= stepTotal)}
                    title="前进一步（→）"
                    data-testid="button-fullscreen-step-forward"
                  >
                    <SkipForward className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={exitFullscreen}
                    title="退出全屏"
                    data-testid="button-exit-fullscreen"
                  >
                    <Minimize2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Narration / subtitle bar — appears between canvas and step indicator */}
          <NarrationBar text={narration} charsPerSecond={9 * playbackSpeed} />

          {!isFullscreen ? <Separator /> : null}
          {!isFullscreen ? (
          <div className="flex items-center gap-3 px-6 py-3 text-xs">
            <span className="font-mono text-muted-foreground" data-testid="text-step-label">
              {stepLabel}
            </span>
            {currentCommand ? (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-foreground" data-testid="text-current-command">
                  {describeCommand(currentCommand)}
                </span>
              </>
            ) : null}
            {stepTotal > 0 ? (
              <div className="ml-auto h-1.5 w-48 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{
                    width: `${
                      status === "done"
                        ? 100
                        : Math.round(
                            (Math.min(stepIndex, stepTotal) / stepTotal) * 100,
                          )
                    }%`,
                  }}
                  data-testid="progress-bar"
                />
              </div>
            ) : null}
          </div>
          ) : null}

          {!isFullscreen ? (
          <div className="border-t bg-background px-6 py-4">
            <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between gap-3">
              <div
                className="flex items-center gap-1 rounded-md bg-muted p-1"
                data-testid="toggle-explanation-mode"
              >
                <Button
                  type="button"
                  size="sm"
                  variant={explanationMode === "detailed" ? "secondary" : "ghost"}
                  className="h-8 px-3 text-xs"
                  disabled={aiBusy}
                  onClick={() => setExplanationMode("detailed")}
                  data-testid="toggle-mode-detailed"
                >
                  详细讲解
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={explanationMode === "concise" ? "secondary" : "ghost"}
                  className="h-8 px-3 text-xs"
                  disabled={aiBusy}
                  onClick={() => setExplanationMode("concise")}
                  data-testid="toggle-mode-concise"
                >
                  简洁讲解
                </Button>
              </div>
              <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                {explanationMode === "concise"
                  ? "只点破关键卡点，仍配合白板提示"
                  : "读题、分析、推导、总结完整展开"}
              </span>
            </div>
            <div className="mx-auto mb-3 flex max-w-3xl items-center justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={handleStepBackward}
                disabled={status === "preparing" || aiBusy || stepIndex <= 0}
                title="后退一步（←）"
                data-testid="button-step-back"
              >
                <SkipBack className="mr-1.5 h-3.5 w-3.5" />
                后退
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 min-w-[86px] px-3 text-xs"
                onClick={togglePausePlayback}
                disabled={status !== "running" && status !== "preparing"}
                title="暂停/继续（空格）"
                data-testid="button-pause-toggle"
              >
                {isPaused ? (
                  <>
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    继续
                  </>
                ) : (
                  <>
                    <Pause className="mr-1.5 h-3.5 w-3.5" />
                    暂停
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs"
                onClick={handleStepForward}
                disabled={status === "preparing" || aiBusy || (stepTotal > 0 && stepIndex >= stepTotal)}
                title="前进一步（→）"
                data-testid="button-step-forward"
              >
                <SkipForward className="mr-1.5 h-3.5 w-3.5" />
                前进
              </Button>
            </div>
            {aiMessage ? (
              <div
                className={`mx-auto mb-3 max-w-3xl rounded-md px-3 py-2 text-xs ${
                  aiStatus === "error"
                    ? "bg-destructive/5 text-destructive"
                    : "bg-muted/60 text-muted-foreground"
                }`}
              >
                <div>{aiMessage}</div>
                {aiExplanation ? (
                  <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed">
                    {aiExplanation}
                  </div>
                ) : null}
              </div>
            ) : null}
            {videoExportMessage ? (
              <div
                className={`mx-auto mb-3 max-w-3xl rounded-md px-3 py-2 text-xs ${
                  videoRenderStatus === "error"
                    ? "bg-destructive/5 text-destructive"
                    : "bg-muted/60 text-muted-foreground"
                }`}
                data-testid="text-video-export-status"
              >
                <div>{videoExportMessage}</div>
                {videoDownloadUrl ? (
                  <a
                    className="mt-2 inline-flex font-medium text-primary underline underline-offset-4"
                    href={videoDownloadUrl}
                    download="whiteboard-lecture.mp4"
                    data-testid="link-video-download-fallback"
                  >
                    备用下载链接
                  </a>
                ) : null}
              </div>
            ) : null}
            <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border bg-background p-2 shadow-sm">
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={handleImageInputChange}
                data-testid="input-problem-image"
              />
              <Button
                size="icon"
                variant="ghost"
                disabled={aiBusy}
                onClick={() => imageInputRef.current?.click()}
                aria-label="上传题目图片"
                title="上传题目图片"
                data-testid="button-upload-problem-image"
              >
                <ImagePlus className="h-4 w-4" />
              </Button>
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleAiSend();
                  }
                }}
                disabled={aiBusy}
                spellCheck={false}
                className="max-h-32 min-h-[44px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm leading-relaxed shadow-none focus-visible:ring-0"
                placeholder="输入题目，或点击左侧图片按钮上传截图/照片..."
                data-testid="input-ai-prompt"
              />
              <Button
                size="icon"
                disabled={aiBusy || !aiPrompt.trim()}
                onClick={handleAiSend}
                aria-label="发送"
                data-testid="button-ai-send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
