import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { AlertCircle, Loader2, Maximize2, Minimize2, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NarrationBar } from "@/whiteboard/NarrationBar";
import { ScriptRunner, type WaitState } from "@/whiteboard/ScriptRunner";
import { WhiteboardCanvas } from "@/whiteboard/WhiteboardCanvas";
import { sampleScript } from "@/whiteboard/sampleScript";
import {
  validateScript,
  type AnnotationElement,
  type CanvasConfig,
  type RenderedElement,
  type WhiteboardCommand,
  type WhiteboardScript,
} from "@/whiteboard/commandTypes";

type PlayerStatus = "loading" | "idle" | "preparing" | "playing" | "paused" | "done" | "error";

type SharePayload = {
  id: string;
  scriptText: string;
  ttsEnabled: boolean;
  playbackSpeed: number;
};

type CachedAudio = {
  url: string;
  blob: Blob;
};

const SILENT_AUDIO_DATA_URI =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==";

function getNarrationFromCommand(cmd: WhiteboardCommand) {
  return "narration" in cmd && typeof cmd.narration === "string"
    ? cmd.narration.trim() || null
    : null;
}

function clampVoiceSpeed(speed: number) {
  return Math.max(0.5, Math.min(speed, 2));
}

export default function SharedPlayerPage() {
  const { id } = useParams<{ id: string }>();
  const [script, setScript] = useState<WhiteboardScript | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [canvas, setCanvas] = useState<CanvasConfig>(sampleScript.canvas);
  const [elements, setElements] = useState<RenderedElement[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationElement[]>([]);
  const [narration, setNarration] = useState<string | null>(null);
  const [status, setStatus] = useState<PlayerStatus>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [stepTotal, setStepTotal] = useState(0);
  const [waitState, setWaitState] = useState<WaitState | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const runnerRef = useRef<ScriptRunner | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const narrationAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioResolveRef = useRef<(() => void) | null>(null);
  const audioCacheRef = useRef<Map<string, CachedAudio>>(new Map());
  const intentionallyStoppedAudioRef = useRef<WeakSet<HTMLAudioElement>>(new WeakSet());

  const stepLabel = useMemo(() => {
    if (status === "loading") return "正在加载";
    if (status === "preparing") return "正在准备语音";
    if (status === "done") return "播放完成";
    if (status === "error") return "播放出错";
    if (!stepTotal) return "等待播放";
    return `第 ${Math.min(stepIndex + 1, stepTotal)} / ${stepTotal} 步`;
  }, [status, stepIndex, stepTotal]);

  const resolveActiveAudio = () => {
    const resolve = audioResolveRef.current;
    audioResolveRef.current = null;
    resolve?.();
  };

  const getNarrationAudioElement = () => {
    if (!narrationAudioElementRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.setAttribute("playsinline", "true");
      narrationAudioElementRef.current = audio;
    }
    return narrationAudioElementRef.current;
  };

  const unlockNarrationAudio = async () => {
    if (!ttsEnabled) return;
    const audio = getNarrationAudioElement();
    if (!audio.paused && !audio.ended) return;
    audio.onended = null;
    audio.onerror = null;
    audio.onpause = null;
    audio.muted = true;
    audio.src = SILENT_AUDIO_DATA_URI;
    audio.load();
    try {
      await audio.play();
    } catch {
      // The actual narration play path will show an actionable error if Safari still blocks it.
    } finally {
      intentionallyStoppedAudioRef.current.add(audio);
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      audio.removeAttribute("src");
      audio.load();
    }
  };

  const stopActiveNarration = (resolvePromise = true) => {
    const audio = audioRef.current;
    if (audio) {
      intentionallyStoppedAudioRef.current.add(audio);
      audio.onended = null;
      audio.onerror = null;
      audio.onpause = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    }
    if (resolvePromise) resolveActiveAudio();
  };

  useEffect(() => {
    let cancelled = false;
    const loadShare = async () => {
      try {
        setStatus("loading");
        const response = await fetch(`/api/shares/${id}`);
        const body = (await response.json().catch(() => null)) as SharePayload | null;
        if (!response.ok || !body) {
          throw new Error(body && "message" in body ? String(body.message) : "分享不存在。");
        }
        const parsed = JSON.parse(body.scriptText);
        const result = validateScript(parsed);
        if (!result.ok) throw new Error(result.error);
        if (cancelled) return;
        setScript(result.script);
        setCanvas(result.script.canvas);
        setStepTotal(result.script.commands.length);
        setTtsEnabled(body.ttsEnabled);
        setPlaybackSpeed(body.playbackSpeed);
        setStatus("idle");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    };
    void loadShare();
    return () => {
      cancelled = true;
      runnerRef.current?.cancel();
      stopActiveNarration();
      audioCacheRef.current.forEach((audio) => URL.revokeObjectURL(audio.url));
      audioCacheRef.current.clear();
    };
  }, [id]);

  const synthesizeNarration = async (text: string) => {
    const cached = audioCacheRef.current.get(text);
    if (cached) return cached;
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, speed: playbackSpeed }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message ?? `语音生成失败：${response.status}`);
    }
    const blob = await response.blob();
    const audio = { blob, url: URL.createObjectURL(blob) };
    audioCacheRef.current.set(text, audio);
    return audio;
  };

  const prefetchNarrations = async (commands: WhiteboardCommand[]) => {
    if (!ttsEnabled) return;
    const narrations = Array.from(
      new Set(commands.map(getNarrationFromCommand).filter(Boolean) as string[]),
    );
    for (const text of narrations) {
      await synthesizeNarration(text);
    }
  };

  const playNarration = (text: string | null) => {
    setNarration(text);
    stopActiveNarration();
    if (!ttsEnabled || !text) return Promise.resolve();
    const cached = audioCacheRef.current.get(text);
    if (!cached) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const audio = getNarrationAudioElement();
      intentionallyStoppedAudioRef.current.delete(audio);
      audio.onended = null;
      audio.onerror = null;
      audio.onpause = null;
      audio.muted = false;
      audio.src = cached.url;
      audio.load();
      audioRef.current = audio;
      const finish = () => {
        if (audioResolveRef.current === finish) audioResolveRef.current = null;
        audio.onended = null;
        audio.onerror = null;
        audio.onpause = null;
        resolve();
      };
      audioResolveRef.current = finish;
      audio.playbackRate = clampVoiceSpeed(playbackSpeed);
      audio.onended = finish;
      audio.onerror = finish;
      audio.onpause = () => {
        window.setTimeout(() => {
          if (
            intentionallyStoppedAudioRef.current.has(audio) ||
            audio.ended ||
            (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 0.05)
          ) {
            return;
          }
          runnerRef.current?.pause();
          setStatus("paused");
        }, 0);
      };
      void audio.play().catch(() => {
        if (intentionallyStoppedAudioRef.current.has(audio)) return;
        runnerRef.current?.pause();
        setStatus("paused");
      });
    });
  };

  const resetPlaybackState = () => {
    runnerRef.current?.cancel();
    runnerRef.current = null;
    stopActiveNarration();
    setElements([]);
    setAnnotations([]);
    setNarration(null);
    setStepIndex(0);
    setWaitState(null);
    if (script) setCanvas(script.canvas);
  };

  const play = async () => {
    if (!script || status === "preparing" || status === "playing") return;
    try {
      enterFullscreen();
      await unlockNarrationAudio();
      resetPlaybackState();
      setErrorMsg("");
      setStatus("preparing");
      await prefetchNarrations(script.commands);
      setStatus("playing");
      const runner = new ScriptRunner(
        script,
        {
          onCanvasChange: setCanvas,
          onElementsChange: setElements,
          onAnnotationsChange: setAnnotations,
          onStepChange: (i, total) => {
            setStepIndex(i);
            setStepTotal(total);
          },
          onNarrationChange: (text) => playNarration(text),
          onWaitChange: setWaitState,
          onComplete: () => {
            setWaitState(null);
            setStatus("done");
          },
          onError: (message) => {
            setErrorMsg(message);
            setStatus("error");
          },
        },
        { playbackSpeed },
      );
      runnerRef.current = runner;
      await runner.run();
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const pause = () => {
    if (status !== "playing") return;
    runnerRef.current?.pause();
    audioRef.current?.pause();
    setStatus("paused");
  };

  const resume = () => {
    if (status !== "paused") return;
    runnerRef.current?.resume();
    const audio = audioRef.current;
    if (audio) void audio.play().catch(() => undefined);
    setStatus("playing");
  };

  const restart = () => {
    resetPlaybackState();
    setStatus("idle");
  };

  const enterFullscreen = () => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement === root) {
      setIsFullscreen(true);
      return;
    }
    const request = root.requestFullscreen?.();
    if (!request) return;
    void request.then(
      () => setIsFullscreen(true),
      () => setIsFullscreen(document.fullscreenElement === rootRef.current),
    );
  };

  const exitFullscreen = () => {
    setIsFullscreen(false);
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => undefined);
    }
  };

  const toggleFullscreen = () => {
    if (isFullscreen) exitFullscreen();
    else enterFullscreen();
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const primaryAction = status === "paused" ? resume : play;
  const primaryDisabled = status === "loading" || status === "preparing" || status === "playing" || status === "error";

  return (
    <div ref={rootRef} className="flex h-[100dvh] w-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b px-3 py-2 sm:px-5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold sm:text-base">AI 白板讲解</h1>
          <p className="truncate text-xs text-muted-foreground">只读观看模式</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="max-w-[42vw] truncate text-[11px] sm:text-xs">
            {stepLabel}
          </Badge>
          <Button size="icon" variant="outline" onClick={toggleFullscreen} title="全屏">
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <main className="relative flex flex-1 overflow-hidden">
        <WhiteboardCanvas
          canvas={canvas}
          elements={elements}
          annotations={annotations}
          allowUpscale
          fullBleed={isFullscreen}
        />
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-center sm:inset-x-4 sm:bottom-4">
          <div className="max-w-[92vw] sm:max-w-3xl">
            <NarrationBar text={narration} charsPerSecond={9 * playbackSpeed} overlay />
          </div>
        </div>
        {status === "loading" || status === "preparing" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/45 backdrop-blur-sm">
            <Card className="flex items-center gap-3 p-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status === "loading" ? "正在加载分享..." : "正在准备语音..."}
            </Card>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/55 p-4 backdrop-blur-sm">
            <Card className="max-w-md border-destructive/30 p-4 text-sm text-destructive">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <AlertCircle className="h-4 w-4" />
                无法播放分享
              </div>
              <div>{errorMsg}</div>
            </Card>
          </div>
        ) : null}
      </main>

      <footer className="flex items-center justify-center gap-2 border-t bg-background/95 px-3 py-2">
        <Button onClick={primaryAction} disabled={primaryDisabled} size="sm">
          {status === "paused" ? <Play className="mr-1.5 h-4 w-4" /> : <Play className="mr-1.5 h-4 w-4" />}
          {status === "paused" ? "继续" : "播放"}
        </Button>
        <Button onClick={pause} disabled={status !== "playing"} size="sm" variant="outline">
          <Pause className="mr-1.5 h-4 w-4" />
          暂停
        </Button>
        <Button onClick={restart} disabled={status === "loading" || status === "preparing"} size="sm" variant="outline">
          <RotateCcw className="mr-1.5 h-4 w-4" />
          重播
        </Button>
        {waitState ? (
          <Button onClick={() => runnerRef.current?.continueFromWait()} size="sm" variant="outline">
            继续
          </Button>
        ) : null}
      </footer>
    </div>
  );
}
