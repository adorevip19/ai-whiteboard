import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Gauge,
  Play,
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

type CachedTtsAudio = {
  url: string;
  blob: Blob;
};

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
  const [playbackSpeed, setPlaybackSpeed] = useState(0.75);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<string>("TTS 未开启");
  const [waitState, setWaitState] = useState<WaitState | null>(null);

  const runnerRef = useRef<ScriptRunner | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSpeedRef = useRef(playbackSpeed);
  const ttsRequestIdRef = useRef(0);
  const ttsCacheRef = useRef<Map<string, CachedTtsAudio>>(new Map());
  const ttsPrefetchControllerRef = useRef<AbortController | null>(null);
  const audioResolveRef = useRef<(() => void) | null>(null);

  const resolveActiveAudio = () => {
    const resolve = audioResolveRef.current;
    audioResolveRef.current = null;
    resolve?.();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      runnerRef.current?.cancel();
      audioRef.current?.pause();
      resolveActiveAudio();
      ttsPrefetchControllerRef.current?.abort();
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

  const playCachedNarration = (text: string | null) => {
    setNarration(text);

    resolveActiveAudio();
    const requestId = ++ttsRequestIdRef.current;
    audioRef.current?.pause();
    audioRef.current = null;

    if (!ttsEnabled) {
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
  ) => {
    const cacheKey = getTtsCacheKey(text);
    const cached = ttsCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, rate: 1 }),
      signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message ?? `TTS 请求失败：${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = {
      blob,
      url,
    };
    ttsCacheRef.current.set(cacheKey, audio);
    return audio;
  };

  const prefetchNarrations = async (commands: WhiteboardCommand[]) => {
    if (!ttsEnabled) {
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
        await synthesizeNarration(text, controller.signal);
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

  const handleRun = async () => {
    // Cancel any in-flight run.
    runnerRef.current?.cancel();
    runnerRef.current = null;
    ttsPrefetchControllerRef.current?.abort();

    setErrorMsg("");
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
        setStatus("done");
      },
      onError: (msg) => {
        setErrorMsg(msg);
        setStatus("error");
      },
    }, { playbackSpeed });
    runnerRef.current = runner;
    void runner.run();
  };

  const handleStop = () => {
    runnerRef.current?.cancel();
    runnerRef.current = null;
    ttsPrefetchControllerRef.current?.abort();
    ttsRequestIdRef.current += 1;
    audioRef.current?.pause();
    resolveActiveAudio();
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
  };

  const handleContinue = () => {
    runnerRef.current?.continueFromWait();
  };

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

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-6 py-3">
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
        <Badge variant="outline" data-testid="badge-status">
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
      </header>

      {/* Body: split panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: controls + JSON */}
        <aside className="flex w-[420px] flex-col border-r">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Button
              size="sm"
              onClick={handleRun}
              disabled={status === "running" || status === "preparing"}
              data-testid="button-run"
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              运行脚本
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
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleLoadSample}
              data-testid="button-load-sample"
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              示例
            </Button>
          </div>

          <div className="space-y-3 border-b px-4 py-3">
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
          </div>

          <div className="flex flex-1 flex-col overflow-hidden p-4">
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
          </div>
        </aside>

        {/* Right: whiteboard + step indicator */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            <WhiteboardCanvas canvas={canvas} elements={elements} annotations={annotations} />
          </div>

          {/* Narration / subtitle bar — appears between canvas and step indicator */}
          <NarrationBar text={narration} charsPerSecond={9 * playbackSpeed} />

          <Separator />
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
        </main>
      </div>
    </div>
  );
}
