import { type ChangeEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  FolderPlus,
  Gauge,
  ImagePlus,
  Library,
  Link2,
  Loader2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pause,
  Play,
  Save,
  Send,
  Share2,
  Smartphone,
  Sparkles,
  SkipBack,
  SkipForward,
  StepForward,
  Square,
  Trash2,
  Volume2,
  XCircle,
} from "lucide-react";
import { WhiteboardCanvas } from "@/whiteboard/WhiteboardCanvas";
import { NarrationBar } from "@/whiteboard/NarrationBar";
import { ScriptRunner, type WaitState } from "@/whiteboard/ScriptRunner";
import { WHITEBOARD_HANDWRITING_FONT_FAMILY } from "@/whiteboard/fonts";
import { ensureKatexRuntimeLoaded } from "@/whiteboard/MathRenderer";
import japaneseWashiBackground from "@/assets/japanese-washi-bg.svg";
import {
  validateScript,
  describeCommand,
  type AnnotationElement,
  type CanvasConfig,
  type RenderedElement,
  type WhiteboardCommand,
  type WhiteboardScript,
} from "@/whiteboard/commandTypes";
import { sampleScriptString, sampleScript } from "@/whiteboard/sampleScript";
import {
  boardFramePulseColor,
  boardInkColor,
  defaultCanvasBackground,
  type BoardTheme,
} from "@/whiteboard/theme";
import { normalizeCanvasAspect, type CanvasAspect } from "@/whiteboard/canvasAspect";

type RunStatus = "idle" | "preparing" | "running" | "done" | "error";
type AiStatus =
  | "idle"
  | "checking"
  | "recognizing"
  | "generating"
  | "repairing"
  | "synthesizing"
  | "error";
type ExplanationMode = "detailed" | "concise";
type VideoRenderStatus = "idle" | "rendering" | "ready" | "error";
type KnowledgeStatus = "idle" | "summarizing" | "ready" | "error";
type TopicGenerationStatus = "idle" | "generating" | "synthesizing" | "ready" | "error";

type CachedTtsAudio = {
  url: string;
  blob: Blob;
};

type ExportAudioBuffer = {
  buffer: AudioBuffer;
  durationMs: number;
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

type KnowledgeSummaryItem = {
  name: string;
  explanation: string;
};

type KnowledgeSummary = {
  title: string;
  overview: string;
  concepts: KnowledgeSummaryItem[];
  formulas: KnowledgeSummaryItem[];
  principles: KnowledgeSummaryItem[];
  background: KnowledgeSummaryItem[];
  followUpPrompt: string;
};

type AiScriptResponse = {
  scriptText: string;
  explanation: string;
  knowledgeSummary?: KnowledgeSummary;
  report: ScriptPreflightReport;
  rounds?: Array<{
    round: number;
    action: "generate" | "repair";
    model?: string;
    durationMs?: number;
    report: ScriptPreflightReport;
  }>;
};

type ScriptPreflightResponse = {
  report: ScriptPreflightReport;
  script?: WhiteboardScript;
};

type ImageRecognitionResponse = {
  problemText: string;
  diagramDescription: string;
  imageAnchors?: Array<{
    id: string;
    label?: string;
    bbox?: [number, number, number, number];
    point?: [number, number];
  }>;
  subject?: string;
  confidence: "high" | "medium" | "low";
  notes?: string;
};

type PreparedWhiteboardImage = {
  dataUrl: string;
  width: number;
  height: number;
};

type SourceImageContext = {
  prompt: string;
  sourceImageDataUrl: string;
  sourceImageSize?: { width: number; height: number };
  imageAnchors?: ImageRecognitionResponse["imageAnchors"];
};

type KnowledgeSummaryResponse = {
  knowledgeSummary: KnowledgeSummary;
};

type LectureSession = {
  id: string;
  title: string;
  scriptText: string;
  stepIndex: number;
  stepTotal: number;
  playbackSpeed: number;
  ttsEnabled: boolean;
  knowledgeSummary: KnowledgeSummary | null;
  source: "main" | "topic";
};

type TopicLectureSession = LectureSession & {
  aiResult: AiScriptResponse;
};

type RecordedWebmSegments = {
  segments: Blob[];
};

type LectureGroup = {
  id: string;
  parentId: string | null;
  name: string;
  shareId: string | null;
  shareActive: boolean;
  createdAt: number;
  updatedAt: number;
};

type SavedLecture = {
  id: string;
  groupId: string | null;
  title: string;
  ttsEnabled: boolean;
  playbackSpeed: number;
  shareId: string | null;
  shareActive: boolean;
  createdAt: number;
  updatedAt: number;
};

const MAX_UPLOAD_IMAGE_SIZE = 10 * 1024 * 1024;
const WHITEBOARD_SOURCE_IMAGE_MAX_SIDE = 1400;
const WHITEBOARD_SOURCE_IMAGE_TARGET_BYTES = 1_200_000;
const TTS_RETRY_DELAYS_MS = [1200, 2500, 5000, 8000, 12000];
const VIDEO_FRAME_INTERVAL_MS = 1000 / 15;
const VIDEO_RECORDING_SEGMENT_MS = 45_000;
const SVG_FRAME_RENDER_TIMEOUT_MS = 2500;
const FLOATING_CONTROL_SIZE = 56;
const FLOATING_CONTROL_MARGIN = 16;
const STANDARD_PLAYBACK_SPEED = 1;
const SHORT_VIDEO_PLAYBACK_SPEED = 1.25;
const WHITEBOARD_ANIMATION_SPEED_MULTIPLIER = 1.15;
const EXPORT_NARRATION_TAIL_PADDING_MS = 300;
const SILENT_AUDIO_DATA_URI =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA==";

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

function commandHasDuration(cmd: WhiteboardCommand): cmd is WhiteboardCommand & { duration: number } {
  return "duration" in cmd && typeof cmd.duration === "number";
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function latexToExportText(latex: string): string {
  return normalizeLatexPlainText(replaceLatexFractions(latex));
}

function readLatexGroup(value: string, start: number) {
  let depth = 0;
  let text = "";
  for (let i = start; i < value.length; i++) {
    const char = value[i];
    if (char === "{") {
      if (depth > 0) text += char;
      depth++;
      continue;
    }
    if (char === "}") {
      depth--;
      if (depth === 0) return { text, end: i + 1 };
      text += char;
      continue;
    }
    text += char;
  }
  return { text, end: value.length };
}

function replaceLatexFractions(latex: string): string {
  const readGroup = (value: string, start: number) => {
    let depth = 0;
    let text = "";
    for (let i = start; i < value.length; i++) {
      const char = value[i];
      if (char === "{") {
        if (depth > 0) text += char;
        depth++;
        continue;
      }
      if (char === "}") {
        depth--;
        if (depth === 0) return { text, end: i + 1 };
        text += char;
        continue;
      }
      text += char;
    }
    return { text, end: value.length };
  };
  const replaceFractions = (value: string) => {
    let output = "";
    for (let i = 0; i < value.length; i++) {
      const command = ["\\dfrac", "\\tfrac", "\\frac"].find((candidate) =>
        value.startsWith(candidate, i),
      );
      if (!command || value[i + command.length] !== "{") {
        output += value[i];
        continue;
      }
      const numerator = readGroup(value, i + command.length);
      const denominator = value[numerator.end] === "{"
        ? readGroup(value, numerator.end)
        : { text: "", end: numerator.end };
      output += `(${replaceFractions(numerator.text)})/(${replaceFractions(denominator.text)})`;
      i = denominator.end - 1;
    }
    return output;
  };

  return replaceFractions(latex);
}

function normalizeLatexPlainText(latex: string): string {
  const commandSymbols: Record<string, string> = {
    "\\alpha": "α",
    "\\beta": "β",
    "\\gamma": "γ",
    "\\delta": "δ",
    "\\Delta": "Δ",
    "\\epsilon": "ε",
    "\\varepsilon": "ε",
    "\\zeta": "ζ",
    "\\eta": "η",
    "\\theta": "θ",
    "\\vartheta": "θ",
    "\\Theta": "Θ",
    "\\lambda": "λ",
    "\\mu": "μ",
    "\\nu": "ν",
    "\\xi": "ξ",
    "\\Xi": "Ξ",
    "\\pi": "π",
    "\\Pi": "Π",
    "\\rho": "ρ",
    "\\sigma": "σ",
    "\\Sigma": "Σ",
    "\\sum": "Σ",
    "\\tau": "τ",
    "\\phi": "φ",
    "\\varphi": "φ",
    "\\Phi": "Φ",
    "\\omega": "ω",
    "\\Omega": "Ω",
    "\\infty": "∞",
    "\\partial": "∂",
    "\\nabla": "∇",
    "\\pm": "±",
    "\\times": "×",
    "\\div": "÷",
    "\\approx": "≈",
    "\\sim": "∼",
    "\\equiv": "≡",
  };
  const withSymbols = Object.entries(commandSymbols).reduce(
    (value, [command, symbol]) => value.replaceAll(command, symbol),
    latex,
  );

  return withSymbols
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\mathrm\{([^}]*)\}/g, "$1")
    .replace(/\\left|\\right/g, "")
    .replace(/\\qquad|\\quad|\\,|\\;|\\ /g, " ")
    .replace(/\\lim_\{([^}]*)\}/g, "lim $1")
    .replace(/\\to/g, "→")
    .replace(/\\Longleftrightarrow/g, "⇔")
    .replace(/\\Rightarrow/g, "⇒")
    .replace(/\\therefore/g, "∴")
    .replace(/\\exists/g, "∃")
    .replace(/\\in/g, "∈")
    .replace(/\\cdot/g, "·")
    .replace(/\\ell/g, "ℓ")
    .replace(/\\frac/g, "")
    .replace(/\\sin/g, "sin")
    .replace(/\\cos/g, "cos")
    .replace(/\\tan/g, "tan")
    .replace(/\\sqrt\{([^}]*)\}/g, "√($1)")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/\\'/g, "'")
    .replace(/_\{([^}]*)\}/g, "₍$1₎")
    .replace(/_([A-Za-z0-9]+)/g, "₍$1₎")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type ExportMathPart =
  | { type: "text"; text: string }
  | { type: "fraction"; numerator: ExportMathPart[]; denominator: ExportMathPart[] };

function parseLatexForExport(latex: string): ExportMathPart[] {
  const parts: ExportMathPart[] = [];
  let buffer = "";
  const flush = () => {
    const text = normalizeLatexPlainText(buffer);
    if (text) parts.push({ type: "text", text });
    buffer = "";
  };

  for (let i = 0; i < latex.length; i++) {
    const command = ["\\dfrac", "\\tfrac", "\\frac"].find((candidate) =>
      latex.startsWith(candidate, i),
    );
    if (!command || latex[i + command.length] !== "{") {
      buffer += latex[i];
      continue;
    }

    flush();
    const numerator = readLatexGroup(latex, i + command.length);
    const denominator = latex[numerator.end] === "{"
      ? readLatexGroup(latex, numerator.end)
      : { text: "", end: numerator.end };
    parts.push({
      type: "fraction",
      numerator: parseLatexForExport(numerator.text),
      denominator: parseLatexForExport(denominator.text),
    });
    i = denominator.end - 1;
  }

  flush();
  return parts;
}

function estimateExportMathPartsWidth(parts: ExportMathPart[], fontSize: number): number {
  return parts.reduce((width, part) => {
    if (part.type === "text") return width + estimateExportTextWidth(part.text, fontSize);
    const numeratorWidth = estimateExportMathPartsWidth(part.numerator, fontSize * 0.78);
    const denominatorWidth = estimateExportMathPartsWidth(part.denominator, fontSize * 0.78);
    return width + Math.max(numeratorWidth, denominatorWidth, fontSize * 1.5) + fontSize * 0.45;
  }, 0);
}

function estimateExportTextWidth(text: string, fontSize: number) {
  let units = 0;
  for (const char of Array.from(text)) {
    units += /[\u4e00-\u9fff]/.test(char) ? 0.95 : /[il.,:;|]/.test(char) ? 0.28 : 0.58;
  }
  return Math.max(fontSize * 0.4, units * fontSize);
}

function appendSvgText(
  group: SVGGElement,
  textContent: string,
  x: number,
  y: number,
  fontSize: number,
  color: string,
) {
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", String(x));
  text.setAttribute("y", String(y));
  text.setAttribute("fill", color);
  text.setAttribute("font-size", String(fontSize));
  text.setAttribute("font-family", WHITEBOARD_HANDWRITING_FONT_FAMILY);
  text.textContent = textContent;
  group.appendChild(text);
}

function appendExportMathParts(
  group: SVGGElement,
  parts: ExportMathPart[],
  x: number,
  baselineY: number,
  fontSize: number,
  color: string,
) {
  let cursorX = x;
  for (const part of parts) {
    if (part.type === "text") {
      appendSvgText(group, part.text, cursorX, baselineY, fontSize, color);
      cursorX += estimateExportTextWidth(part.text, fontSize);
      continue;
    }

    const fractionFontSize = fontSize * 0.78;
    const numeratorWidth = estimateExportMathPartsWidth(part.numerator, fractionFontSize);
    const denominatorWidth = estimateExportMathPartsWidth(part.denominator, fractionFontSize);
    const fractionWidth = Math.max(numeratorWidth, denominatorWidth, fontSize * 1.5) + fontSize * 0.45;
    const fractionX = cursorX;
    const centerX = fractionX + fractionWidth / 2;
    const numeratorX = centerX - numeratorWidth / 2;
    const denominatorX = centerX - denominatorWidth / 2;
    const lineY = baselineY - fontSize * 0.28;

    appendExportMathParts(
      group,
      part.numerator,
      numeratorX,
      baselineY - fontSize * 0.68,
      fractionFontSize,
      color,
    );
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(fractionX + fontSize * 0.12));
    line.setAttribute("x2", String(fractionX + fractionWidth - fontSize * 0.12));
    line.setAttribute("y1", String(lineY));
    line.setAttribute("y2", String(lineY));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", String(Math.max(1.5, fontSize * 0.045)));
    group.appendChild(line);
    appendExportMathParts(
      group,
      part.denominator,
      denominatorX,
      baselineY + fontSize * 0.55,
      fractionFontSize,
      color,
    );
    cursorX += fractionWidth;
  }
  return cursorX - x;
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
  const [playbackSpeed, setPlaybackSpeed] = useState(STANDARD_PLAYBACK_SPEED);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsStatus, setTtsStatus] = useState<string>("TTS 待生成");
  const [waitState, setWaitState] = useState<WaitState | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [boardTheme, setBoardTheme] = useState<BoardTheme>("light");
  const [canvasAspect, setCanvasAspect] = useState<CanvasAspect>("landscape");
  const [aiStatus, setAiStatus] = useState<AiStatus>("idle");
  const [aiMessage, setAiMessage] = useState("");
  const [aiExplanation, setAiExplanation] = useState("");
  const [preflightReport, setPreflightReport] = useState<ScriptPreflightReport | null>(null);
  const [scriptPanelOpen, setScriptPanelOpen] = useState(false);
  const scriptFileInputRef = useRef<HTMLInputElement | null>(null);
  const [aiProgress, setAiProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [explanationMode, setExplanationMode] = useState<ExplanationMode>("detailed");
  const [videoExportMessage, setVideoExportMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [libraryMessage, setLibraryMessage] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [lectureGroups, setLectureGroups] = useState<LectureGroup[]>([]);
  const [savedLectures, setSavedLectures] = useState<SavedLecture[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [videoDownloadUrl, setVideoDownloadUrl] = useState("");
  const [videoRenderStatus, setVideoRenderStatus] = useState<VideoRenderStatus>("idle");
  const [videoRenderProgress, setVideoRenderProgress] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const runnerRef = useRef<ScriptRunner | null>(null);
  const scriptTextRef = useRef(scriptText);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const narrationAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const stepIndexRef = useRef(0);
  const stepTotalRef = useRef(0);
  const playbackSpeedRef = useRef(playbackSpeed);
  const ttsEnabledRef = useRef(ttsEnabled);
  const boardThemeRef = useRef<BoardTheme>(boardTheme);
  const canvasAspectRef = useRef<CanvasAspect>(canvasAspect);
  const ttsRequestIdRef = useRef(0);
  const ttsCacheRef = useRef<Map<string, CachedTtsAudio>>(new Map());
  const ttsPrefetchControllerRef = useRef<AbortController | null>(null);
  const aiGenerationControllerRef = useRef<AbortController | null>(null);
  const aiGenerationIdRef = useRef(0);
  const sourceImageContextRef = useRef<SourceImageContext | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoRenderControllerRef = useRef<AbortController | null>(null);
  const videoRenderIdRef = useRef(0);
  const knowledgeSummaryControllerRef = useRef<AbortController | null>(null);
  const knowledgeSummaryRequestIdRef = useRef(0);
  const topicGenerationControllerRef = useRef<AbortController | null>(null);
  const topicGenerationIdRef = useRef(0);
  const preparedVideoBlobRef = useRef<Blob | null>(null);
  const preparedVideoKeyRef = useRef("");
  const videoDownloadUrlRef = useRef("");
  const audioResolveRef = useRef<(() => void) | null>(null);
  const intentionallyStoppedAudioRef = useRef<WeakSet<HTMLAudioElement>>(new WeakSet());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [morePanelOpen, setMorePanelOpen] = useState(false);
  const [floatingControlPosition, setFloatingControlPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [readyToPlayOpen, setReadyToPlayOpen] = useState(false);
  const [knowledgeSummary, setKnowledgeSummary] = useState<KnowledgeSummary | null>(null);
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeStatus>("idle");
  const [knowledgeMessage, setKnowledgeMessage] = useState("");
  const [knowledgePanelOpen, setKnowledgePanelOpen] = useState(false);
  const [knowledgeSummaryKey, setKnowledgeSummaryKey] = useState("");
  const [suspendedLectureSession, setSuspendedLectureSession] = useState<LectureSession | null>(null);
  const [topicLectureSession, setTopicLectureSession] = useState<TopicLectureSession | null>(null);
  const [topicGenerationStatus, setTopicGenerationStatus] =
    useState<TopicGenerationStatus>("idle");
  const [topicGenerationProgress, setTopicGenerationProgress] = useState(0);
  const [topicGenerationMessage, setTopicGenerationMessage] = useState("");
  const floatingControlDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextFloatingClickRef = useRef(false);

  const getDefaultFloatingControlPosition = () => ({
    x: window.innerWidth - FLOATING_CONTROL_SIZE - FLOATING_CONTROL_MARGIN,
    y: window.innerHeight - FLOATING_CONTROL_SIZE - FLOATING_CONTROL_MARGIN,
  });

  const clampFloatingControlPosition = (position: { x: number; y: number }) => ({
    x: Math.max(
      FLOATING_CONTROL_MARGIN,
      Math.min(position.x, window.innerWidth - FLOATING_CONTROL_SIZE - FLOATING_CONTROL_MARGIN),
    ),
    y: Math.max(
      FLOATING_CONTROL_MARGIN,
      Math.min(position.y, window.innerHeight - FLOATING_CONTROL_SIZE - FLOATING_CONTROL_MARGIN),
    ),
  });

  const updateStepProgress = (index: number, total = stepTotalRef.current) => {
    stepIndexRef.current = index;
    stepTotalRef.current = total;
    setStepIndex(index);
    setStepTotal(total);
  };

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
    if (!ttsEnabledRef.current) return;
    const audio = getNarrationAudioElement();
    if (!audio.paused && !audio.ended) return;
    const previousSrc = audio.getAttribute("src");
    audio.onended = null;
    audio.onerror = null;
    audio.onpause = null;
    audio.muted = true;
    audio.src = SILENT_AUDIO_DATA_URI;
    audio.load();
    try {
      await audio.play();
    } catch {
      // iOS may still require the eventual play call; the normal error path will surface it.
    } finally {
      intentionallyStoppedAudioRef.current.add(audio);
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
      if (previousSrc) {
        audio.src = previousSrc;
      } else {
        audio.removeAttribute("src");
      }
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
      stopActiveNarration();
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
    setFloatingControlPosition((position) =>
      position ? clampFloatingControlPosition(position) : getDefaultFloatingControlPosition(),
    );
    const onResize = () => {
      setFloatingControlPosition((position) =>
        position ? clampFloatingControlPosition(position) : getDefaultFloatingControlPosition(),
      );
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  useEffect(() => {
    scriptTextRef.current = scriptText;
  }, [scriptText]);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
    runnerRef.current?.setPlaybackSpeed(playbackSpeed);
  }, [playbackSpeed]);

  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
    if (!ttsEnabled) setTtsStatus("TTS 未开启");
    else setTtsStatus((current) => (current === "TTS 未开启" ? "TTS 待生成" : current));
  }, [ttsEnabled]);

  useEffect(() => {
    boardThemeRef.current = boardTheme;
  }, [boardTheme]);

  useEffect(() => {
    canvasAspectRef.current = canvasAspect;
  }, [canvasAspect]);

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
    if (status === "idle" || status === "done") {
      void handleRun();
      return;
    }
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
      void document.exitFullscreen().catch(() => undefined);
    }
  };

  const toggleFullscreen = () => {
    if (isFullscreen) exitFullscreen();
    else enterFullscreen();
  };

  const collapseFloatingUi = () => {
    setControlsOpen(false);
    setMorePanelOpen(false);
  };

  const handleFloatingControlPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const position = floatingControlPosition ?? getDefaultFloatingControlPosition();
    floatingControlDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.x,
      startY: position.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleFloatingControlPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = floatingControlDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      collapseFloatingUi();
    }
    if (!drag.moved) return;
    event.preventDefault();
    setFloatingControlPosition(
      clampFloatingControlPosition({
        x: drag.startX + dx,
        y: drag.startY + dy,
      }),
    );
  };

  const finishFloatingControlDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = floatingControlDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    floatingControlDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved) suppressNextFloatingClickRef.current = true;
  };

  const handleFloatingControlClick = () => {
    if (suppressNextFloatingClickRef.current) {
      suppressNextFloatingClickRef.current = false;
      return;
    }
    if (controlsOpen) {
      collapseFloatingUi();
    } else {
      setControlsOpen(true);
    }
  };

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (status === "running" || status === "preparing") {
      setControlsOpen(false);
      setMorePanelOpen(false);
      setAiPanelOpen(false);
    }
  }, [status]);

  const playCachedNarration = (text: string | null) => {
    setNarration(text);

    stopActiveNarration();
    const requestId = ++ttsRequestIdRef.current;

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
        if (audioResolveRef.current === finish) {
          audioResolveRef.current = null;
        }
        audio.onended = null;
        audio.onerror = null;
        audio.onpause = null;
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
            if (
              requestId !== ttsRequestIdRef.current ||
              intentionallyStoppedAudioRef.current.has(audio)
            ) {
              return;
            }
            runnerRef.current?.pause();
            setIsPaused(true);
            setTtsStatus("浏览器阻止了自动播放，请点击继续或关闭 TTS");
          },
        );
      };

      audio.onended = finish;
      audio.onerror = finish;
      audio.onpause = () => {
        window.setTimeout(() => {
          if (
            requestId !== ttsRequestIdRef.current ||
            intentionallyStoppedAudioRef.current.has(audio) ||
            audio.ended ||
            (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 0.05)
          ) {
            return;
          }
          runnerRef.current?.pause();
          setIsPaused(true);
          setTtsStatus("语音已暂停，点击继续播放");
        }, 0);
      };
      playAudio();
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
          body: JSON.stringify({ text, rate: STANDARD_PLAYBACK_SPEED }),
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

  const prefetchNarrations = async (
    commands: WhiteboardCommand[],
    options: {
      progressStart?: number;
      progressEnd?: number;
      syncAiProgress?: boolean;
    } = {},
  ) => {
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
      if (ttsPrefetchControllerRef.current === controller) {
        ttsPrefetchControllerRef.current = null;
      }
      return true;
    }

    try {
      const progressStart = options.progressStart ?? 78;
      const progressEnd = options.progressEnd ?? 98;
      const progressSpan = Math.max(0, progressEnd - progressStart);
      const syncAiProgress = options.syncAiProgress ?? true;
      for (let i = 0; i < narrations.length; i++) {
        const text = narrations[i];
        setTtsStatus(`正在预生成语音 ${i + 1}/${narrations.length}`);
        if (syncAiProgress) {
          setAiMessage(`正在生成语音 ${i + 1}/${narrations.length}`);
          setAiProgress(
            Math.min(
              progressEnd,
              progressStart + Math.round(((i + 1) / narrations.length) * progressSpan),
            ),
          );
        }
        await synthesizeNarration(text, controller.signal, {
          onRetry: ({ nextAttempt, maxAttempts, delayMs, error }) => {
            const message = error instanceof Error ? error.message : String(error);
            const seconds = Math.ceil(delayMs / 1000);
            const retryText = `语音 ${i + 1}/${narrations.length} 生成中断，${seconds} 秒后自动重试 ${nextAttempt}/${maxAttempts}`;
            setTtsStatus(retryText);
            if (syncAiProgress) setAiMessage(`${retryText}：${message}`);
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

  const runScriptText = async (
    text: string,
    options: { startIndex?: number; skipPrefetch?: boolean } = {},
  ) => {
    // Cancel any in-flight run.
    runnerRef.current?.cancel();
    runnerRef.current = null;
    ttsPrefetchControllerRef.current?.abort();

    setErrorMsg("");
    setIsPaused(false);
    await unlockNarrationAudio();
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
    void summarizeKnowledgeForScript(text);

    const startIndex = Math.max(
      0,
      Math.min(options.startIndex ?? 0, result.script.commands.length),
    );
    const narrationsToPrefetch = result.script.commands.slice(startIndex);
    if (ttsEnabled && !options.skipPrefetch) {
      setStatus("preparing");
      const ttsReady = await prefetchNarrations(narrationsToPrefetch, {
        syncAiProgress: false,
      });
      if (!ttsReady) {
        return;
      }
    } else {
      setStatus("running");
    }

    // Reset state for a fresh run.
    setActiveCommands(result.script.commands);
    setCanvas(result.script.canvas);
    setElements([]);
    setAnnotations([]);
    setNarration(null);
    updateStepProgress(startIndex, result.script.commands.length);
    setStatus("running");
    setWaitState(null);

    const runner = new ScriptRunner(result.script, {
      onCanvasChange: (c) => setCanvas(c),
      onElementsChange: (els) => setElements(els),
      onAnnotationsChange: (anns) => setAnnotations(anns),
      onStepChange: (i, total) => {
        updateStepProgress(i, total);
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
    }, { playbackSpeed, startIndex });
    runnerRef.current = runner;
    void runner.run();
  };

  const handleRun = async () => {
    enterFullscreen();
    const startIndex =
      status !== "running" &&
      status !== "preparing" &&
      stepTotalRef.current > 0 &&
      stepIndexRef.current > 0 &&
      stepIndexRef.current < stepTotalRef.current
        ? stepIndexRef.current
        : 0;
    await runScriptText(scriptTextRef.current, { startIndex });
  };

  const getShareUrl = (id: string) =>
    `${window.location.origin}${window.location.pathname}#/share/${id}`;
  const getGroupShareUrl = (id: string) =>
    `${window.location.origin}${window.location.pathname}#/group-share/${id}`;

  const refreshLibrary = async () => {
    const response = await fetch("/api/lectures");
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message ?? `读取讲解库失败：${response.status}`);
    setLectureGroups(body.groups ?? []);
    setSavedLectures(body.lectures ?? []);
  };

  const handleOpenLibrary = async () => {
    setLibraryOpen((open) => !open);
    try {
      await refreshLibrary();
      setLibraryMessage("");
    } catch (e) {
      setLibraryMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveLecture = async () => {
    setLibraryMessage("正在保存讲解...");
    let parsed: unknown;
    try {
      parsed = JSON.parse(scriptTextRef.current);
    } catch (e) {
      setLibraryMessage("");
      setStatus("error");
      setErrorMsg(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const result = validateScript(parsed);
    if (!result.ok) {
      setLibraryMessage("");
      setStatus("error");
      setErrorMsg(result.error);
      return;
    }
    const title =
      result.script.commands.find(
        (command): command is WhiteboardCommand & { text: string } =>
          "text" in command && typeof command.text === "string" && Boolean(command.text.trim()),
      )?.text.trim() ?? "未命名讲解";

    try {
      const response = await fetch("/api/lectures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          script: result.script,
          ttsEnabled,
          playbackSpeed,
          groupId: selectedGroupId,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? `保存失败：${response.status}`);
      await refreshLibrary();
      setLibraryOpen(true);
      setLibraryMessage(`已保存：${body.title ?? title}`);
    } catch (e) {
      setLibraryMessage(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleCreateShare = async () => {
    setShareMessage("正在创建分享链接...");
    let parsed: unknown;
    try {
      parsed = JSON.parse(scriptText);
    } catch (e) {
      setShareMessage("");
      setStatus("error");
      setErrorMsg(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const result = validateScript(parsed);
    if (!result.ok) {
      setShareMessage("");
      setStatus("error");
      setErrorMsg(result.error);
      return;
    }

    try {
      const response = await fetch("/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: result.script,
          ttsEnabled,
          playbackSpeed,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message ?? `创建分享失败：${response.status}`);
      }
      const url = getShareUrl(body.id);
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      setShareMessage(`分享链接已创建：${url}`);
    } catch (e) {
      setShareMessage(`创建分享失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleCreateGroup = async (parentId: string | null) => {
    const name = window.prompt(parentId ? "子分组名称" : "分组名称");
    if (!name?.trim()) return;
    setLibraryMessage("正在创建分组...");
    try {
      const response = await fetch("/api/lecture-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), parentId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? `创建分组失败：${response.status}`);
      await refreshLibrary();
      setSelectedGroupId(body.id);
      setLibraryMessage(`已创建分组：${body.name}`);
    } catch (e) {
      setLibraryMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleLoadLecture = async (id: string) => {
    try {
      const response = await fetch(`/api/lectures/${id}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? `加载讲解失败：${response.status}`);
      const nextScriptText = JSON.stringify(JSON.parse(body.scriptText), null, 2);
      scriptTextRef.current = nextScriptText;
      setScriptText(nextScriptText);
      setTtsEnabled(body.ttsEnabled);
      setPlaybackSpeed(body.playbackSpeed);
      setSelectedGroupId(body.groupId ?? null);
      setScriptPanelOpen(true);
      resetKnowledgeSummary("");
      setSuspendedLectureSession(null);
      setTopicLectureSession(null);
      setTopicGenerationStatus("idle");
      setTopicGenerationProgress(0);
      setTopicGenerationMessage("");
      void summarizeKnowledgeForScript(nextScriptText, { originalPrompt: body.title, force: true });
      setLibraryMessage(`已加载：${body.title}`);
    } catch (e) {
      setLibraryMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleMoveLecture = async (id: string, groupId: string | null) => {
    try {
      const response = await fetch(`/api/lectures/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? `移动讲解失败：${response.status}`);
      await refreshLibrary();
      setLibraryMessage("已移动讲解。");
    } catch (e) {
      setLibraryMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleShareLecture = async (lecture: SavedLecture) => {
    try {
      const response = await fetch(`/api/lectures/${lecture.id}/share`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? `分享失败：${response.status}`);
      const url = getShareUrl(body.id);
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      await refreshLibrary();
      setLibraryMessage(`分享链接已复制：${url}`);
    } catch (e) {
      setLibraryMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleShareGroup = async (group: LectureGroup) => {
    try {
      const response = await fetch(`/api/lecture-groups/${group.id}/share`, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? `分组分享失败：${response.status}`);
      const url = getGroupShareUrl(body.id);
      await navigator.clipboard?.writeText(url).catch(() => undefined);
      await refreshLibrary();
      setLibraryMessage(`分组分享链接已复制：${url}`);
    } catch (e) {
      setLibraryMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStopGroupShare = async (group: LectureGroup) => {
    try {
      const response = await fetch(`/api/lecture-groups/${group.id}/share`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? `停止分组分享失败：${response.status}`);
      await refreshLibrary();
      setLibraryMessage("已停止分组分享，原链接将不可访问。");
    } catch (e) {
      setLibraryMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStopLectureShare = async (lecture: SavedLecture) => {
    try {
      const response = await fetch(`/api/lectures/${lecture.id}/share`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? `停止分享失败：${response.status}`);
      await refreshLibrary();
      setLibraryMessage("已停止分享，原分享链接将不可访问。");
    } catch (e) {
      setLibraryMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteLecture = async (lecture: SavedLecture) => {
    if (!window.confirm(`删除讲解“${lecture.title}”？`)) return;
    try {
      const response = await fetch(`/api/lectures/${lecture.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? `删除失败：${response.status}`);
      await refreshLibrary();
      setLibraryMessage("已删除讲解。");
    } catch (e) {
      setLibraryMessage(e instanceof Error ? e.message : String(e));
    }
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

  const getScriptKnowledgeKey = (text: string) => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return `${text.length}:${hash >>> 0}`;
  };

  const normalizeKnowledgeSummary = (summary?: KnowledgeSummary | null) => {
    if (!summary) return null;
    const cleanText = (value: string | undefined, limit: number) =>
      (value?.trim() ?? "").replace(/\s+/g, " ").slice(0, limit);
    const cleanItems = (items: KnowledgeSummaryItem[] | undefined) =>
      (Array.isArray(items) ? items : [])
        .map((item) => ({
          name: cleanText(item.name, 36),
          explanation: cleanText(item.explanation, 90),
        }))
        .filter((item) => item.name && item.explanation)
        .slice(0, 5);
    const title = cleanText(summary.title, 48) || "这道题用到的知识点";
    const overview =
      cleanText(summary.overview, 90) || "核心公式、适用条件和易错点速查。";
    const baseFollowUpPrompt =
      summary.followUpPrompt?.trim() ||
      `请围绕“${title}”生成一份专题白板讲解，重点讲清公式、适用条件、解题步骤和易错点。`;
    return {
      title,
      overview,
      concepts: cleanItems(summary.concepts),
      formulas: cleanItems(summary.formulas),
      principles: cleanItems(summary.principles),
      background: cleanItems(summary.background).slice(0, 2),
      followUpPrompt: `请生成一份“专题知识点讲解”白板脚本，不要重新解原题，而是专门讲清下面这些基础知识。

专题标题：${title}
专题内容：${baseFollowUpPrompt}

生成要求：
1. 控制在 4–5 页、35–60 条命令，适合作为临时插播课。
2. 第一页只做专题导入：使用 layout_page.title/subtitle 和一个 write_paragraph(slotId:"content")；不要在同一个 content slot 里再叠加 write_text 或 write_text_segments。
3. 需要列要点时，优先使用 two_column 或 three_panel，每个 slot 只放一个 write_paragraph；公式另用显式 x/y 的 write_math 或 write_math_steps 放在段落下方。
4. 这不是几何证明专题时，不要使用 draw_point、draw_segment、draw_ray、draw_angle、mark_equal_segments、mark_parallel、mark_perpendicular、highlight_polygon、construct_geometry。
5. 旁白直接面向学生讲概念和方法，不描述白板操作过程。`,
    };
  };

  const resetKnowledgeSummary = (message = "") => {
    knowledgeSummaryControllerRef.current?.abort();
    knowledgeSummaryControllerRef.current = null;
    knowledgeSummaryRequestIdRef.current += 1;
    setKnowledgeSummary(null);
    setKnowledgeSummaryKey("");
    setKnowledgeStatus("idle");
    setKnowledgeMessage(message);
    setKnowledgePanelOpen(false);
  };

  const activateKnowledgeSummary = (text: string, summary?: KnowledgeSummary | null) => {
    const normalized = normalizeKnowledgeSummary(summary);
    if (!normalized) {
      resetKnowledgeSummary("");
      return;
    }
    knowledgeSummaryControllerRef.current?.abort();
    knowledgeSummaryControllerRef.current = null;
    knowledgeSummaryRequestIdRef.current += 1;
    setKnowledgeSummary(normalized);
    setKnowledgeSummaryKey(getScriptKnowledgeKey(text));
    setKnowledgeStatus("ready");
    setKnowledgeMessage("知识点已准备好");
  };

  const summarizeKnowledgeForScript = async (
    text: string,
    options: { originalPrompt?: string; force?: boolean } = {},
  ) => {
    const key = getScriptKnowledgeKey(text);
    if (!options.force && knowledgeSummaryKey === key && knowledgeStatus === "ready") return;
    if (!options.force && knowledgeSummaryKey === key && knowledgeStatus === "summarizing") return;
    knowledgeSummaryControllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = knowledgeSummaryRequestIdRef.current + 1;
    knowledgeSummaryRequestIdRef.current = requestId;
    knowledgeSummaryControllerRef.current = controller;
    setKnowledgeStatus("summarizing");
    if (knowledgeSummaryKey !== key) setKnowledgeSummary(null);
    setKnowledgeSummaryKey(key);
    setKnowledgeMessage("知识点整理中");
    if (options.force) setKnowledgeSummary(null);
    try {
      const result = await callAiEndpoint<KnowledgeSummaryResponse>(
        "/api/ai-script/knowledge-summary",
        {
          scriptText: text,
          originalPrompt: options.originalPrompt ?? aiPrompt,
          mode: explanationMode,
        },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        knowledgeSummaryRequestIdRef.current !== requestId ||
        getScriptKnowledgeKey(scriptTextRef.current) !== key
      ) {
        return;
      }
      activateKnowledgeSummary(text, result.knowledgeSummary);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      if (knowledgeSummaryRequestIdRef.current !== requestId) return;
      setKnowledgeStatus("error");
      setKnowledgeMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (knowledgeSummaryControllerRef.current === controller) {
        knowledgeSummaryControllerRef.current = null;
      }
    }
  };

  const createLectureSession = (
    source: LectureSession["source"],
    title: string,
    summary: KnowledgeSummary | null = knowledgeSummary,
    text = scriptText,
  ): LectureSession => ({
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    scriptText: text,
    stepIndex: stepIndexRef.current,
    stepTotal: stepTotalRef.current,
    playbackSpeed: playbackSpeedRef.current,
    ttsEnabled: ttsEnabledRef.current,
    knowledgeSummary: summary,
    source,
  });

  const prefetchNarrationsForTopic = async (
    commands: WhiteboardCommand[],
    signal: AbortSignal,
    progressStart = 78,
    progressEnd = 98,
  ) => {
    if (!ttsEnabledRef.current) return true;
    const narrations = Array.from(
      new Set(commands.map(getNarrationFromCommand).filter(Boolean) as string[]),
    );
    if (narrations.length === 0) return true;
    const span = Math.max(0, progressEnd - progressStart);
    for (let i = 0; i < narrations.length; i++) {
      const text = narrations[i];
      setTopicGenerationStatus("synthesizing");
      setTopicGenerationMessage(`专题语音生成中 ${i + 1}/${narrations.length}`);
      setTopicGenerationProgress(
        Math.min(progressEnd, progressStart + Math.round(((i + 1) / narrations.length) * span)),
      );
      await synthesizeNarration(text, signal);
    }
    return true;
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

  const prepareWhiteboardSourceImage = (dataUrl: string) =>
    new Promise<PreparedWhiteboardImage>((resolve) => {
      const image = new Image();
      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (!width || !height) {
          resolve({ dataUrl, width: 0, height: 0 });
          return;
        }
        const maxSide = Math.max(width, height);
        const scale = Math.min(1, WHITEBOARD_SOURCE_IMAGE_MAX_SIDE / maxSide);
        const targetWidth = Math.max(1, Math.round(width * scale));
        const targetHeight = Math.max(1, Math.round(height * scale));
        if (scale === 1 && dataUrl.length <= WHITEBOARD_SOURCE_IMAGE_TARGET_BYTES) {
          resolve({ dataUrl, width, height });
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve({ dataUrl, width, height });
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
        resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.86), width: targetWidth, height: targetHeight });
      };
      image.onerror = () => resolve({ dataUrl, width: 0, height: 0 });
      image.src = dataUrl;
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
      const sourceImage = await prepareWhiteboardSourceImage(imageDataUrl);
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
          ? "讲解模式：简洁讲解。讲解开始第一段有效旁白仍必须先朗读原题或复述问题；用户可能已经读过题并思考过，读题后只需要用一两句话点破最关键、最容易卡住的思路；仍然要配合白板动作展示关键关系。"
          : "讲解模式：详细讲解。讲解开始第一段有效旁白必须先朗读原题或复述问题；读题之后必须帮学生分析题干，拆出已知条件、图示信息和要解决的问题。",
        "这道题的原始图片会作为白板图片资源传入。带图题优先直接展示原图，并在原图旁边或原图上用激光笔、箭头、短标签讲解关键位置；不要完整复刻原图。",
        result.imageAnchors?.length
          ? `图片关键区域锚点：\n${JSON.stringify(result.imageAnchors, null, 2)}\n讲解时优先使用这些锚点做精准指示：laser_pointer 可写 imageAnchor，圈画可写 annotate_circle.imageAnchor，箭头端点可写 fromImageAnchor/toImageAnchor。`
          : "",
        "如果需要额外重画 F-t、v-t、s-t、函数图、折线图或阶梯图作为辅助示意，必须把每一段图像都重构出来：分段常量画水平段，匀变速画斜线段，零值段也要画，不能留下空坐标系，也不能只画其中一段。",
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
      if (progressTimer !== undefined) {
        window.clearInterval(progressTimer);
        progressTimer = undefined;
      }
      setAiMessage(
        `图片识别完成，识别置信度：${
          result.confidence === "high" ? "高" : result.confidence === "medium" ? "中" : "低"
        }。正在生成讲解...`,
      );
      setAiExplanation(result.notes ?? "");
      if (aiGenerationControllerRef.current === controller) {
        aiGenerationControllerRef.current = null;
      }
      const sourceImageContext: SourceImageContext = {
        prompt: nextPrompt,
        sourceImageDataUrl: sourceImage.dataUrl,
        sourceImageSize:
          sourceImage.width > 0 && sourceImage.height > 0
            ? { width: sourceImage.width, height: sourceImage.height }
            : undefined,
        imageAnchors: result.imageAnchors,
      };
      sourceImageContextRef.current = sourceImageContext;
      await handleGenerateWithAi({
        promptOverride: nextPrompt,
        readyMessage: "图片识别和讲解脚本已准备好。",
        generatingMessage: "图片已识别，正在生成并修复讲解脚本...",
        sourceImageDataUrl: sourceImageContext.sourceImageDataUrl,
        sourceImageSize: sourceImageContext.sourceImageSize,
        imageAnchors: sourceImageContext.imageAnchors,
      });
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
    scriptTextRef.current = result.scriptText;
    setScriptText(result.scriptText);
    setSuspendedLectureSession(null);
    setTopicLectureSession(null);
    setTopicGenerationStatus("idle");
    setTopicGenerationProgress(0);
    setTopicGenerationMessage("");
    setAiExplanation(result.explanation);
    setPreflightReport(result.report);
    setAiMessage(result.report.summary);
    setErrorMsg("");
    if (result.knowledgeSummary) {
      activateKnowledgeSummary(result.scriptText, result.knowledgeSummary);
    } else if (result.report.ok) {
      void summarizeKnowledgeForScript(result.scriptText, { originalPrompt: aiPrompt });
    } else {
      resetKnowledgeSummary("");
    }
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

  const handleGenerateWithAi = async (
    options: {
      promptOverride?: string;
      readyMessage?: string;
      generatingMessage?: string;
      sourceImageDataUrl?: string;
      sourceImageSize?: { width: number; height: number };
      imageAnchors?: ImageRecognitionResponse["imageAnchors"];
    } = {},
  ) => {
    const prompt = (options.promptOverride ?? aiPrompt).trim();
    if (!prompt) return;
    const retainedSourceImage =
      !options.sourceImageDataUrl &&
      sourceImageContextRef.current &&
      (prompt === sourceImageContextRef.current.prompt ||
        prompt.includes("原始图片会作为白板图片资源传入") ||
        prompt.includes("图片关键区域锚点"))
        ? sourceImageContextRef.current
        : null;
    const sourceImageDataUrl = options.sourceImageDataUrl ?? retainedSourceImage?.sourceImageDataUrl;
    const sourceImageSize = options.sourceImageSize ?? retainedSourceImage?.sourceImageSize;
    const imageAnchors = options.imageAnchors ?? retainedSourceImage?.imageAnchors;
    aiGenerationControllerRef.current?.abort();
    const controller = new AbortController();
    const generationId = aiGenerationIdRef.current + 1;
    aiGenerationIdRef.current = generationId;
    aiGenerationControllerRef.current = controller;

    setTtsEnabled(true);
    ttsEnabledRef.current = true;
    setAiStatus("generating");
    setAiProgress(12);
    setAiMessage(options.generatingMessage ?? "正在准备讲解...");
    setPreflightReport(null);
    setReadyToPlayOpen(false);
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
        {
          prompt,
          mode: explanationMode,
          boardTheme: boardThemeRef.current,
          canvasAspect: canvasAspectRef.current,
          sourceImageDataUrl,
          sourceImageSize,
          imageAnchors,
        },
        controller.signal,
      );
      if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;
      setAiProgress(76);
      applyAiResult(result);
      let generatedScript: WhiteboardScript | null = null;
      if (result.report.ok) {
        const parsed = JSON.parse(result.scriptText) as unknown;
        const validated = validateScript(parsed);
        if (!validated.ok) throw new Error(`AI 返回的脚本无效：${validated.error}`);
        generatedScript = validated.script;
      }
      if (result.report.ok) {
        startVideoPreRender(result.scriptText);
      } else {
        resetPreparedVideo("");
      }
      if (result.report.ok && generatedScript && ttsEnabledRef.current) {
        if (progressTimer !== undefined) {
          window.clearInterval(progressTimer);
          progressTimer = undefined;
        }
        setAiStatus("synthesizing");
        setAiMessage("脚本已生成，正在预生成语音...");
        setAiProgress(78);
        const ttsReady = await prefetchNarrations(generatedScript.commands, {
          progressStart: 78,
          progressEnd: 98,
          syncAiProgress: true,
        });
        if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;
        if (!ttsReady) throw new Error("语音预生成失败，请稍后重试或关闭 TTS。");
      }
      if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;
      setAiStatus("idle");
      setAiProgress(100);
      if (result.report.ok) {
        setAiPanelOpen(false);
        setReadyToPlayOpen(true);
        setAiMessage(options.readyMessage ?? "讲解脚本和语音已准备好。");
      }
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
    setReadyToPlayOpen(false);
    setAiMessage(
      aiStatus === "recognizing"
        ? "已取消图片识别。"
        : aiStatus === "checking" || aiStatus === "repairing"
          ? "已取消脚本文件预检。"
          : aiStatus === "synthesizing"
            ? "已取消语音生成。"
          : "已取消生成讲解。",
    );
  };

  const handleStop = () => {
    runnerRef.current?.cancel();
    runnerRef.current = null;
    ttsPrefetchControllerRef.current?.abort();
    ttsRequestIdRef.current += 1;
    stopActiveNarration();
    setIsPaused(false);
    setStatus("idle");
    setWaitState(null);
    setReadyToPlayOpen(false);
  };

  const handleConfirmReadyToPlay = async () => {
    setReadyToPlayOpen(false);
    await runScriptText(scriptTextRef.current, { skipPrefetch: true });
  };

  const handleClear = () => {
    runnerRef.current?.cancel();
    runnerRef.current = null;
    ttsPrefetchControllerRef.current?.abort();
    ttsRequestIdRef.current += 1;
    stopActiveNarration();
    setIsPaused(false);
    setElements([]);
    setAnnotations([]);
    updateStepProgress(0, 0);
    setStatus("idle");
    setErrorMsg("");
    setActiveCommands([]);
    setNarration(null);
    setWaitState(null);
    setReadyToPlayOpen(false);
    resetKnowledgeSummary("");
    setSuspendedLectureSession(null);
    setTopicLectureSession(null);
    setTopicGenerationStatus("idle");
    setTopicGenerationProgress(0);
    setTopicGenerationMessage("");
  };

  const handleLoadSample = () => {
    scriptTextRef.current = sampleScriptString;
    setScriptText(sampleScriptString);
    setErrorMsg("");
    setPreflightReport(null);
    setAiExplanation("");
    setAiMessage("");
    setReadyToPlayOpen(false);
    resetKnowledgeSummary("");
    setSuspendedLectureSession(null);
    setTopicLectureSession(null);
    setTopicGenerationStatus("idle");
    setTopicGenerationProgress(0);
    setTopicGenerationMessage("");
    void summarizeKnowledgeForScript(sampleScriptString, { force: true });
  };

  const handleLoadScriptFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || aiBusy) return;

    aiGenerationControllerRef.current?.abort();
    const controller = new AbortController();
    const generationId = aiGenerationIdRef.current + 1;
    aiGenerationIdRef.current = generationId;
    aiGenerationControllerRef.current = controller;

    try {
      await unlockNarrationAudio();
      setAiStatus("checking");
      setAiProgress(12);
      setAiMessage(`正在读取并预检脚本文件：${file.name}`);
      setPreflightReport(null);
      setReadyToPlayOpen(false);

      const fileText = await file.text();
      if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;
      const parsed = JSON.parse(fileText) as unknown;
      const maybeWrappedScript =
        parsed &&
        typeof parsed === "object" &&
        "script" in parsed &&
        (parsed as { script?: unknown }).script
          ? (parsed as { script: unknown; ttsEnabled?: unknown; playbackSpeed?: unknown })
          : null;
      const scriptInput = maybeWrappedScript?.script ?? parsed;
      const result = validateScript(scriptInput);
      if (!result.ok) {
        setErrorMsg(`脚本文件无效：${result.error}`);
        setStatus("error");
        setAiMessage(`脚本文件无效：${result.error}`);
        setAiStatus("error");
        setAiProgress(0);
        return;
      }

      const inputScriptText = JSON.stringify(result.script, null, 2);
      setAiProgress(28);
      const preflight = await callAiEndpoint<ScriptPreflightResponse>(
        "/api/ai-script/preflight",
        { scriptText: inputScriptText },
        controller.signal,
      );
      if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;

      setPreflightReport(preflight.report);
      let nextScriptText = preflight.script
        ? JSON.stringify(preflight.script, null, 2)
        : inputScriptText;
      let nextReport = preflight.report;
      let nextExplanation = "已预检用户加载的脚本文件。";
      let nextMessage = `已加载脚本文件：${file.name}。${preflight.report.summary}`;
      let nextKnowledgeSummary: KnowledgeSummary | undefined;

      if (preflight.report.errors > 0 || preflight.report.warnings > 0) {
        setAiStatus("repairing");
        setAiProgress(42);
        setAiMessage("预检发现播放体验风险，正在自动优化脚本...");
        const repaired = await callAiEndpoint<AiScriptResponse>(
          "/api/ai-script/repair",
          {
            scriptText: inputScriptText,
            instruction:
              "这是用户自行加载的白板脚本文件。请在保持教学内容不变的前提下，修复预检问题，并重点优化播放体验：长正文、范文、修改后的原文、题干重述不能一闪而过；增加合理 duration 和阅读停顿；划线、圈画、激光笔讲解前必须让正文稳定呈现。",
          },
          controller.signal,
        );
        if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;
        nextScriptText = repaired.scriptText;
        nextReport = repaired.report;
        nextExplanation = repaired.explanation;
        nextMessage = `已加载并自动优化：${file.name}。${repaired.report.summary}`;
        nextKnowledgeSummary = repaired.knowledgeSummary;
      }

      setAiProgress(preflight.report.errors > 0 || preflight.report.warnings > 0 ? 70 : 58);
      const finalParsed = JSON.parse(nextScriptText);
      const finalValidated = validateScript(finalParsed);
      if (!finalValidated.ok) {
        throw new Error(`优化后的脚本无效：${finalValidated.error}`);
      }

      if (typeof maybeWrappedScript?.ttsEnabled === "boolean") {
        setTtsEnabled(maybeWrappedScript.ttsEnabled);
        ttsEnabledRef.current = maybeWrappedScript.ttsEnabled;
      }
      if (
        typeof maybeWrappedScript?.playbackSpeed === "number" &&
        Number.isFinite(maybeWrappedScript.playbackSpeed)
      ) {
        const nextPlaybackSpeed = Math.max(0.5, Math.min(maybeWrappedScript.playbackSpeed, 1.5));
        setPlaybackSpeed(nextPlaybackSpeed);
        playbackSpeedRef.current = nextPlaybackSpeed;
      }

      runnerRef.current?.cancel();
      runnerRef.current = null;
      ttsPrefetchControllerRef.current?.abort();
      ttsRequestIdRef.current += 1;
      stopActiveNarration();
      scriptTextRef.current = nextScriptText;
      setScriptText(nextScriptText);
      setCanvas(finalValidated.script.canvas);
      setErrorMsg("");
      setPreflightReport(nextReport);
      setAiExplanation(nextExplanation);
      setAiMessage(`${nextMessage} 正在准备语音...`);
      setVideoExportMessage("脚本文件已加载，正在准备播放和视频导出。");
      setStatus("idle");
      setIsPaused(false);
      updateStepProgress(0, 0);
      setElements([]);
      setAnnotations([]);
      setActiveCommands([]);
      setNarration(null);
      setWaitState(null);
      setSuspendedLectureSession(null);
      setTopicLectureSession(null);
      setTopicGenerationStatus("idle");
      setTopicGenerationProgress(0);
      setTopicGenerationMessage("");
      if (nextKnowledgeSummary) {
        activateKnowledgeSummary(nextScriptText, nextKnowledgeSummary);
      } else {
        void summarizeKnowledgeForScript(nextScriptText, { originalPrompt: file.name, force: true });
      }

      if (ttsEnabledRef.current) {
        setAiStatus("synthesizing");
        setAiProgress(76);
        setAiMessage("脚本文件已加载，正在预生成语音...");
        const ttsReady = await prefetchNarrations(finalValidated.script.commands, {
          progressStart: 76,
          progressEnd: 98,
          syncAiProgress: true,
        });
        if (controller.signal.aborted || aiGenerationIdRef.current !== generationId) return;
        if (!ttsReady) throw new Error("语音预生成失败，请稍后重试或关闭 TTS。");
      } else {
        setTtsStatus("TTS 未开启");
      }

      startVideoPreRender(nextScriptText);
      setAiMessage(
        ttsEnabledRef.current
          ? "脚本和语音已准备好，正在开始播放..."
          : "脚本已准备好，正在开始播放...",
      );
      setAiProgress(100);
      setAiStatus("idle");
      enterFullscreen();
      void runScriptText(nextScriptText, { skipPrefetch: true });
      window.setTimeout(() => setAiProgress(0), 450);
    } catch (e) {
      if (isAbortError(e) || controller.signal.aborted) {
        setAiMessage("已取消脚本文件预检。");
        setAiStatus("idle");
        setAiProgress(0);
        return;
      }
      setStatus("error");
      setErrorMsg(`读取脚本文件失败：${e instanceof Error ? e.message : String(e)}`);
      setAiMessage(`读取脚本文件失败：${e instanceof Error ? e.message : String(e)}`);
      setAiStatus("error");
      setAiProgress(0);
    } finally {
      if (aiGenerationControllerRef.current === controller) {
        aiGenerationControllerRef.current = null;
      }
    }
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
    stopActiveNarration();
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
          updateStepProgress(target, result.script.commands.length);
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
    const target = Math.max(0, stepIndexRef.current - 1);
    updateStepProgress(target, stepTotalRef.current);
    void renderThroughStep(target);
  };

  const handleStepForward = () => {
    if (waitState) {
      handleContinue();
      return;
    }
    const total = stepTotalRef.current || activeCommands.length;
    const target = Math.min(total, stepIndexRef.current + 1);
    updateStepProgress(target, total);
    void renderThroughStep(target);
  };

  const handleAiSend = async () => {
    if (!aiPrompt.trim() || aiBusy) return;
    await handleGenerateWithAi();
  };

  const handleGenerateTopicLecture = async () => {
    if (!knowledgeSummary || topicGenerationStatus === "generating" || topicGenerationStatus === "synthesizing") {
      return;
    }
    topicGenerationControllerRef.current?.abort();
    const controller = new AbortController();
    const generationId = topicGenerationIdRef.current + 1;
    topicGenerationIdRef.current = generationId;
    topicGenerationControllerRef.current = controller;
    const savedSession = createLectureSession(
      "main",
      knowledgeSummary.title || "刚才这道题",
      knowledgeSummary,
    );
    setSuspendedLectureSession(savedSession);
    setTopicLectureSession(null);
    setTopicGenerationStatus("generating");
    setTopicGenerationProgress(12);
    setTopicGenerationMessage("专题讲解生成中");
    let progressTimer: number | undefined;
    try {
      progressTimer = window.setInterval(() => {
        setTopicGenerationProgress((value) => {
          if (value < 72) return value + 4;
          if (value < 88) return value + 1;
          return value;
        });
      }, 900);
      const result = await callAiEndpoint<AiScriptResponse>(
        "/api/ai-script/generate",
        {
          prompt: knowledgeSummary.followUpPrompt,
          mode: "detailed",
          boardTheme: boardThemeRef.current,
          canvasAspect: canvasAspectRef.current,
        },
        controller.signal,
      );
      if (controller.signal.aborted || topicGenerationIdRef.current !== generationId) return;
      setTopicGenerationProgress(76);
      let generatedScript: WhiteboardScript | null = null;
      if (result.report.ok) {
        const parsed = JSON.parse(result.scriptText) as unknown;
        const validated = validateScript(parsed);
        if (!validated.ok) throw new Error(`专题脚本无效：${validated.error}`);
        generatedScript = validated.script;
      } else {
        throw new Error(result.report.summary);
      }
      if (progressTimer !== undefined) {
        window.clearInterval(progressTimer);
        progressTimer = undefined;
      }
      if (ttsEnabledRef.current) {
        await prefetchNarrationsForTopic(generatedScript.commands, controller.signal, 78, 98);
      }
      if (controller.signal.aborted || topicGenerationIdRef.current !== generationId) return;
      const topicSummary =
        normalizeKnowledgeSummary(result.knowledgeSummary) ?? knowledgeSummary;
      const topicSession: TopicLectureSession = {
        ...createLectureSession("topic", topicSummary.title || "专题讲解", topicSummary, result.scriptText),
        stepIndex: 0,
        stepTotal: generatedScript.commands.length,
        aiResult: result,
      };
      setTopicLectureSession(topicSession);
      setTopicGenerationStatus("ready");
      setTopicGenerationProgress(100);
      setTopicGenerationMessage("专题讲解已准备好");
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        setTopicGenerationStatus("idle");
        setTopicGenerationProgress(0);
        setTopicGenerationMessage("已取消专题讲解生成");
        return;
      }
      setTopicGenerationStatus("error");
      setTopicGenerationProgress(0);
      setTopicGenerationMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (progressTimer !== undefined) window.clearInterval(progressTimer);
      if (topicGenerationControllerRef.current === controller) {
        topicGenerationControllerRef.current = null;
      }
    }
  };

  const handleEnterTopicLecture = async () => {
    if (!topicLectureSession) return;
    setSuspendedLectureSession((current) => {
      if (!current) {
        return createLectureSession("main", knowledgeSummary?.title || "刚才这道题", knowledgeSummary);
      }
      return {
        ...current,
        stepIndex: stepIndexRef.current,
        stepTotal: stepTotalRef.current,
        playbackSpeed: playbackSpeedRef.current,
        ttsEnabled: ttsEnabledRef.current,
        knowledgeSummary,
        scriptText: scriptTextRef.current,
      };
    });
    runnerRef.current?.cancel();
    runnerRef.current = null;
    stopActiveNarration();
    scriptTextRef.current = topicLectureSession.scriptText;
    setScriptText(topicLectureSession.scriptText);
    setPlaybackSpeed(topicLectureSession.playbackSpeed);
    setTtsEnabled(topicLectureSession.ttsEnabled);
    activateKnowledgeSummary(topicLectureSession.scriptText, topicLectureSession.knowledgeSummary);
    setKnowledgePanelOpen(false);
    setReadyToPlayOpen(true);
    setAiMessage("专题讲解已经准备好。");
    setStatus("idle");
    setIsPaused(false);
    updateStepProgress(0, topicLectureSession.stepTotal);
    setElements([]);
    setAnnotations([]);
    setNarration(null);
  };

  const handleReturnToSuspendedLecture = async (autoPlay = false) => {
    if (!suspendedLectureSession) return;
    runnerRef.current?.cancel();
    runnerRef.current = null;
    stopActiveNarration();
    const session = suspendedLectureSession;
    scriptTextRef.current = session.scriptText;
    setScriptText(session.scriptText);
    setPlaybackSpeed(session.playbackSpeed);
    setTtsEnabled(session.ttsEnabled);
    activateKnowledgeSummary(session.scriptText, session.knowledgeSummary);
    setKnowledgePanelOpen(false);
    setReadyToPlayOpen(false);
    setAiMessage("已回到刚才这道题。");
    setIsPaused(false);
    if (autoPlay) {
      await runScriptText(session.scriptText, {
        startIndex: session.stepIndex,
        skipPrefetch: true,
      });
    } else {
      await renderThroughStep(session.stepIndex);
    }
  };

  const drawSvgToCanvas = async (
    svg: SVGSVGElement,
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    canvasConfig: CanvasConfig = canvas,
  ) => {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    clone.style.background = canvasConfig.background;
    clone.querySelectorAll("foreignObject").forEach((foreignObject) => {
      const x = Number(foreignObject.getAttribute("x") ?? 0);
      const y = Number(foreignObject.getAttribute("y") ?? 0);
      const transform = foreignObject.getAttribute("transform");
      const opacity = foreignObject.getAttribute("opacity");
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      if (transform) group.setAttribute("transform", transform);
      if (opacity) group.setAttribute("opacity", opacity);

      const htmlDivs = Array.from(foreignObject.querySelectorAll("div")).filter((div) => {
        const text = div.textContent?.trim() ?? "";
        return text.length > 0 && !Array.from(div.children).some((child) => child.tagName.toLowerCase() === "div");
      });
      const mathNodes = Array.from(
        foreignObject.querySelectorAll<HTMLElement>("[data-latex]"),
      );
      const lines = htmlDivs.length > 0
        ? htmlDivs.map((div) => div.textContent?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean)
        : [foreignObject.textContent?.replace(/\s+/g, " ").trim() ?? ""].filter(Boolean);
      const styleSource = (mathNodes[0] ?? htmlDivs[0] ?? foreignObject.querySelector("div")) as HTMLElement | null;
      const fontSize = Number.parseFloat(styleSource?.style.fontSize ?? "") || 32;
      const color = styleSource?.style.color || boardInkColor(canvasConfig);
      const lineGap = fontSize * 1.45;

      if (mathNodes.length > 0) {
        const padding = Number.parseFloat(
          (foreignObject.querySelector("div") as HTMLElement | null)?.style.padding ?? "",
        ) || Math.max(12, fontSize * 0.65);
        mathNodes.forEach((node, index) => {
          const latex = node.dataset.latex ?? "";
          const parts = parseLatexForExport(latex);
          appendExportMathParts(
            group,
            parts,
            x + padding,
            y + padding + fontSize + index * Math.max(lineGap, fontSize * 2.25),
            fontSize,
            color,
          );
        });
      } else {
        lines.forEach((line, index) => {
          appendSvgText(group, line, x, y + fontSize + index * lineGap, fontSize, color);
        });
      }

      foreignObject.replaceWith(group);
    });
    const serialized = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      image.decoding = "async";
      await waitWithTimeout(
        new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("白板帧渲染失败。"));
          image.src = url;
        }),
        SVG_FRAME_RENDER_TIMEOUT_MS,
        "白板帧渲染超时。",
      );
      context.fillStyle = canvasConfig.background;
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const decodeExportNarrationBuffers = async (
    commands: WhiteboardCommand[],
    audioContext: AudioContext,
  ) => {
    const buffers = new Map<string, ExportAudioBuffer>();
    for (const command of commands) {
      const narration = getNarrationFromCommand(command);
      if (!narration || buffers.has(narration)) continue;
      const cached = ttsCacheRef.current.get(getTtsCacheKey(narration));
      if (!cached) continue;
      const arrayBuffer = await cached.blob.arrayBuffer();
      const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) continue;
      buffers.set(narration, {
        buffer,
        durationMs: Math.max(1, Math.round(buffer.duration * 1000)),
      });
    }
    return buffers;
  };

  const createTtsTimedExportScript = (
    sourceScript: WhiteboardScript,
    audioBuffers: Map<string, ExportAudioBuffer>,
    playbackSpeed: number,
  ): WhiteboardScript => {
    const normalizedSpeed = Math.max(0.5, Math.min(playbackSpeed, 2));
    return {
      ...sourceScript,
      commands: sourceScript.commands
        .filter((command) => command.type !== "wait")
        .map((command) => {
          const narration = getNarrationFromCommand(command);
          const audio = narration ? audioBuffers.get(narration) : undefined;
          if (!audio || !commandHasDuration(command)) return command;
          // ScriptRunner shortens visual durations by playback speed and the
          // whiteboard animation multiplier. For exported videos we want the
          // visual command itself to last at least as long as the actual spoken
          // narration, otherwise iOS Safari makes the board feel ahead of voice.
          const narrationSyncedDuration = Math.ceil(
            audio.durationMs * WHITEBOARD_ANIMATION_SPEED_MULTIPLIER +
              EXPORT_NARRATION_TAIL_PADDING_MS * normalizedSpeed,
          );
          return {
            ...command,
            duration: Math.max(command.duration, narrationSyncedDuration),
          } as WhiteboardCommand;
        }),
    };
  };

  const playNarrationForExport = async (
    text: string | null,
    audioContext: AudioContext | null,
    destination: MediaStreamAudioDestinationNode | null,
    audioBuffers: Map<string, ExportAudioBuffer>,
  ) => {
    setNarration(text);
    if (!text || !audioContext || !destination || !ttsEnabledRef.current) return;
    let audioBuffer = audioBuffers.get(text)?.buffer;
    if (!audioBuffer) {
      const cached = ttsCacheRef.current.get(getTtsCacheKey(text));
      if (!cached) return;
      const buffer = await cached.blob.arrayBuffer();
      audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
    }
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
    theme = boardThemeRef.current,
    aspect = canvasAspectRef.current,
  ) => JSON.stringify({ text, tts, speed: Number(speed.toFixed(2)), theme, aspect });

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
        boardTheme: boardThemeRef.current,
        canvasAspect: canvasAspectRef.current,
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

    const recorderMimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : "video/webm";

    runnerRef.current?.cancel();
    runnerRef.current = null;
    stopActiveNarration();
    setIsPaused(false);

    let frameTimer: number | undefined;
    let recorderDataTimer: number | undefined;
    let audioContext: AudioContext | null = null;
    let silentAudioSource: ConstantSourceNode | null = null;
    const previousTtsEnabled = ttsEnabledRef.current;
    const previousPlaybackSpeed = playbackSpeedRef.current;
    try {
      const exportTtsEnabled = options.tts ?? ttsEnabledRef.current;
      const exportPlaybackSpeed = options.speed ?? playbackSpeedRef.current;
      ttsEnabledRef.current = exportTtsEnabled;
      playbackSpeedRef.current = exportPlaybackSpeed;

      if (ttsEnabledRef.current) {
        audioContext = new AudioContext();
      }

      if (ttsEnabledRef.current) {
        options.onMessage?.("正在预生成旁白语音...");
        const ttsReady = await prefetchNarrations(result.script.commands);
        if (!ttsReady) throw new Error("语音预生成被取消，无法导出视频。");
      }

      const exportAudioBuffers =
        ttsEnabledRef.current && audioContext
          ? await decodeExportNarrationBuffers(result.script.commands, audioContext)
          : new Map<string, ExportAudioBuffer>();
      const exportScript = createTtsTimedExportScript(
        result.script,
        exportAudioBuffers,
        exportPlaybackSpeed,
      );
      setActiveCommands(exportScript.commands);
      setCanvas(exportScript.canvas);
      setElements([]);
      setAnnotations([]);
      setNarration(null);
      updateStepProgress(0, exportScript.commands.length);
      setStatus("running");
      setWaitState(null);
      options.onMessage?.("正在准备录制画布...");
      await ensureKatexRuntimeLoaded();
      await waitForNextFrame();

      const getRecordingSvg = () =>
        document.querySelector('[data-testid="whiteboard-svg"]') as SVGSVGElement | null;
      if (!getRecordingSvg()) throw new Error("没有找到白板画布，无法导出视频。");

      const recordingCanvas = document.createElement("canvas");
      recordingCanvas.width = exportScript.canvas.width;
      recordingCanvas.height = exportScript.canvas.height;
      const context = recordingCanvas.getContext("2d");
      if (!context) throw new Error("无法创建视频画布。");

      let destination: MediaStreamAudioDestinationNode | null = null;
      if (ttsEnabledRef.current && audioContext) {
        destination = audioContext.createMediaStreamDestination();
        const silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        silentAudioSource = audioContext.createConstantSource();
        silentAudioSource.offset.value = 1;
        silentAudioSource.connect(silentGain).connect(destination);
        silentAudioSource.start();
      }
      const stream = recordingCanvas.captureStream(15);
      const [videoTrack] = stream.getVideoTracks() as CanvasCaptureMediaStreamTrack[];
      if (!videoTrack) throw new Error("无法创建视频轨道。");
      destination?.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
      let framePulse = false;
      const requestVideoFrame = () => {
        framePulse = !framePulse;
        context.save();
        context.globalAlpha = 1;
        context.fillStyle = framePulse ? canvas.background : boardFramePulseColor(exportScript.canvas);
        context.fillRect(recordingCanvas.width - 4, recordingCanvas.height - 4, 4, 4);
        context.restore();
        videoTrack.requestFrame?.();
      };

      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: recorderMimeType });
      const recordingDone = new Promise<Blob>((resolve) => {
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
      });

      let drawing = false;
      frameTimer = window.setInterval(() => {
        if (drawing) {
          requestVideoFrame();
          return;
        }
        drawing = true;
        const currentSvg = getRecordingSvg();
        if (!currentSvg) {
          drawing = false;
          requestVideoFrame();
          return;
        }
        void drawSvgToCanvas(
          currentSvg,
          context,
          exportScript.canvas.width,
          exportScript.canvas.height,
          exportScript.canvas,
        )
          .catch(() => undefined)
          .finally(() => {
            drawing = false;
            requestVideoFrame();
          });
      }, VIDEO_FRAME_INTERVAL_MS);
      const initialRecordingSvg = getRecordingSvg();
      if (!initialRecordingSvg) throw new Error("没有找到白板画布，无法导出视频。");
      await drawSvgToCanvas(
        initialRecordingSvg,
        context,
        exportScript.canvas.width,
        exportScript.canvas.height,
        exportScript.canvas,
      );
      requestVideoFrame();

      options.onMessage?.("正在录制白板讲解...");
      recorder.start(1000);
      recorderDataTimer = window.setInterval(() => {
        if (recorder.state === "recording") recorder.requestData();
      }, VIDEO_RECORDING_SEGMENT_MS);
      requestVideoFrame();

      const runner = new ScriptRunner(
        exportScript,
        {
          onCanvasChange: (c) => setCanvas(c),
          onElementsChange: (els) => setElements(els),
          onAnnotationsChange: (anns) => setAnnotations(anns),
          onStepChange: (i, total) => {
            updateStepProgress(i, total);
          },
          onNarrationChange: (n) =>
            playNarrationForExport(n, audioContext, destination, exportAudioBuffers),
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
      if (recorderDataTimer !== undefined) {
        window.clearInterval(recorderDataTimer);
        recorderDataTimer = undefined;
      }
      if (recorder.state === "recording") {
        recorder.requestData();
        recorder.stop();
      }
      const webm = await recordingDone;
      stream.getTracks().forEach((track) => track.stop());
      if (webm.size === 0) throw new Error("录制结果为空。");
      setStatus("done");
      return { segments: [webm] };
    } finally {
      if (frameTimer !== undefined) window.clearInterval(frameTimer);
      if (recorderDataTimer !== undefined) window.clearInterval(recorderDataTimer);
      silentAudioSource?.stop();
      silentAudioSource?.disconnect();
      audioContext?.close().catch(() => undefined);
      runnerRef.current = null;
      setIsPaused(false);
      ttsEnabledRef.current = previousTtsEnabled;
      playbackSpeedRef.current = previousPlaybackSpeed;
    }
  };

  const handleExportMp4 = async () => {
    if (videoRenderStatus === "rendering") {
      setVideoExportMessage("MP4 还在后台预渲染，完成后就能下载。");
      return;
    }
    if (videoRenderStatus !== "ready") {
      if (scriptText.trim()) {
        startVideoPreRender(scriptText);
        setVideoExportMessage("正在重新预渲染 MP4。");
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
  }, [scriptText, ttsEnabled, playbackSpeed, boardTheme, canvasAspect, videoRenderStatus]);

  useEffect(() => {
    window.aiWhiteboardRecordScript = async ({ scriptText, uploadUrl, ttsEnabled, playbackSpeed }) => {
      const recording = await recordScriptToWebm(scriptText, {
        tts: ttsEnabled,
        speed: playbackSpeed,
        onMessage: setVideoExportMessage,
      });
      const webm = new Blob(recording.segments, { type: "video/webm" });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "video/webm" },
        body: webm,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `上传录制视频失败：${response.status}`);
      }
      return {
        ok: true,
        size: webm.size,
      };
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
  const currentGroupLectures = savedLectures.filter(
    (lecture) => (lecture.groupId ?? null) === selectedGroupId,
  );
  const currentChildGroups = lectureGroups.filter(
    (group) => (group.parentId ?? null) === selectedGroupId,
  );
  const selectedGroupName =
    lectureGroups.find((group) => group.id === selectedGroupId)?.name ?? "全部讲解";
  const groupDepth = (groupId: string | null) => {
    let depth = 0;
    let current = lectureGroups.find((group) => group.id === groupId);
    while (current?.parentId) {
      depth += 1;
      current = lectureGroups.find((group) => group.id === current?.parentId);
    }
    return depth;
  };

  const aiBusy =
    aiStatus === "checking" ||
    aiStatus === "recognizing" ||
    aiStatus === "generating" ||
    aiStatus === "repairing" ||
    aiStatus === "synthesizing";
  const topicBusy =
    topicGenerationStatus === "generating" || topicGenerationStatus === "synthesizing";
  const knowledgeEntryLabel =
    topicGenerationStatus === "ready"
      ? "专题讲解已准备好"
      : topicBusy
        ? `${topicGenerationStatus === "synthesizing" ? "专题语音" : "专题讲解"} ${Math.round(Math.max(topicGenerationProgress, 1))}%`
        : knowledgeStatus === "ready"
          ? "知识点"
          : knowledgeStatus === "summarizing"
            ? "知识点整理中"
            : knowledgeStatus === "error"
              ? "知识点整理失败"
              : "";
  const knowledgeSections = [
    { title: "基础概念", items: knowledgeSummary?.concepts ?? [] },
    { title: "公式 / 定理", items: knowledgeSummary?.formulas ?? [] },
    { title: "关键原理", items: knowledgeSummary?.principles ?? [] },
    { title: "背景知识", items: knowledgeSummary?.background ?? [] },
  ].filter((section) => section.items.length > 0);
  const exportButtonDisabled = videoRenderStatus !== "ready";
  const exportButtonLabel =
    videoRenderStatus === "rendering"
      ? `${Math.round(Math.max(videoRenderProgress, 1))}%`
      : videoRenderStatus === "ready"
        ? "下载 MP4"
        : "导出 MP4";
  const floatingPanelOpensAbove =
    (floatingControlPosition?.y ?? window.innerHeight - FLOATING_CONTROL_SIZE - FLOATING_CONTROL_MARGIN) >
    window.innerHeight * 0.42;
  const floatingPanelAlignsRight =
    (floatingControlPosition?.x ?? window.innerWidth - FLOATING_CONTROL_SIZE - FLOATING_CONTROL_MARGIN) >
    window.innerWidth * 0.5;
  const floatingPanelHorizontalStyle = floatingPanelAlignsRight ? { right: 0 } : { left: 0 };
  const floatingControlStyle = floatingControlPosition
    ? {
        left: floatingControlPosition.x,
        top: floatingControlPosition.y,
      }
    : {
        right: FLOATING_CONTROL_MARGIN,
        bottom: FLOATING_CONTROL_MARGIN,
      };
  const floatingControlsPanelStyle = floatingPanelOpensAbove
    ? { bottom: FLOATING_CONTROL_SIZE + 8, ...floatingPanelHorizontalStyle }
    : { top: FLOATING_CONTROL_SIZE + 8, ...floatingPanelHorizontalStyle };
  const floatingMorePanelStyle = floatingPanelOpensAbove
    ? { bottom: FLOATING_CONTROL_SIZE + (controlsOpen ? 304 : 8), ...floatingPanelHorizontalStyle }
    : { top: FLOATING_CONTROL_SIZE + (controlsOpen ? 304 : 8), ...floatingPanelHorizontalStyle };
  const canResumeFromSelectedStep =
    status !== "running" &&
    status !== "preparing" &&
    stepTotal > 0 &&
    stepIndex > 0 &&
    stepIndex < stepTotal;

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
      className="relative flex h-[100dvh] w-screen flex-col text-foreground"
      style={{
        backgroundColor: "#f7efe2",
        backgroundImage: `url(${japaneseWashiBackground})`,
        backgroundRepeat: "repeat",
        backgroundSize: "520px 520px",
      }}
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
                  {aiStatus === "recognizing"
                    ? "正在识别题目图片"
                    : aiStatus === "checking"
                      ? "正在预检脚本"
                      : aiStatus === "repairing"
                        ? "正在优化脚本"
                        : aiStatus === "synthesizing"
                          ? "正在生成语音"
                        : "正在生成讲解"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {aiStatus === "recognizing"
                    ? "提取题干、图中文字和关键条件"
                    : aiStatus === "checking"
                      ? "检查格式、布局和播放节奏"
                      : aiStatus === "repairing"
                        ? "修复风险并优化板书节奏"
                        : aiStatus === "synthesizing"
                          ? "把旁白提前合成为可播放音频"
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
              {aiStatus === "recognizing"
                ? "取消识别"
                : aiStatus === "checking" || aiStatus === "repairing"
                  ? "取消预检"
                  : aiStatus === "synthesizing"
                    ? "取消语音生成"
                  : "取消生成"}
            </Button>
          </Card>
        </div>
      ) : null}
      {!aiBusy && readyToPlayOpen ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/35 px-4 backdrop-blur-[2px]">
          <Card className="w-[min(420px,calc(100vw-2rem))] border-primary/20 bg-background/95 p-5 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Play className="h-5 w-5" />
            </div>
            <div className="text-base font-semibold">讲解已准备好</div>
            <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
              脚本和语音已经准备完成。现在开始播放吗？
            </div>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setReadyToPlayOpen(false)}
                data-testid="button-ready-play-no"
              >
                否
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirmReadyToPlay()}
                data-testid="button-ready-play-yes"
              >
                <Play className="mr-1.5 h-4 w-4" />
                是，开始播放
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
      <div className="relative flex flex-1 overflow-hidden">
        {scriptPanelOpen && !isFullscreen ? (
          <aside className="absolute inset-y-0 left-0 z-40 flex w-full max-w-[460px] flex-col border-r bg-background/95 p-4 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-3">
              <Gauge className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-[64px] text-xs font-medium">语音速度</div>
              <Slider
                value={[playbackSpeed]}
                min={0.5}
                max={1.5}
                step={0.05}
                disabled={status === "running" || status === "preparing"}
                onValueChange={(value) => setPlaybackSpeed(value[0] ?? STANDARD_PLAYBACK_SPEED)}
                className="flex-1"
                data-testid="slider-playback-speed"
              />
              <span className="w-12 text-right font-mono text-xs text-muted-foreground">
                {playbackSpeed.toFixed(2)}x
              </span>
              <Button
                type="button"
                size="sm"
                variant={playbackSpeed === STANDARD_PLAYBACK_SPEED ? "secondary" : "outline"}
                disabled={status === "running" || status === "preparing"}
                onClick={() => setPlaybackSpeed(STANDARD_PLAYBACK_SPEED)}
                className="h-7 px-2 text-xs"
                data-testid="button-speed-standard"
              >
                标准
              </Button>
              <Button
                type="button"
                size="sm"
                variant={playbackSpeed === SHORT_VIDEO_PLAYBACK_SPEED ? "secondary" : "outline"}
                disabled={status === "running" || status === "preparing"}
                onClick={() => setPlaybackSpeed(SHORT_VIDEO_PLAYBACK_SPEED)}
                className="h-7 px-2 text-xs"
                data-testid="button-speed-short-video"
              >
                短视频
              </Button>
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
            <div className="flex items-center gap-3">
              <Square className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-[64px] text-xs font-medium">黑色白板</div>
              <Switch
                checked={boardTheme === "dark"}
                onCheckedChange={(checked) => {
                  const nextTheme = checked ? "dark" : "light";
                  setBoardTheme(nextTheme);
                  boardThemeRef.current = nextTheme;
                  resetPreparedVideo("");
                  setCanvas((current) => ({
                    ...current,
                    theme: nextTheme,
                    background: defaultCanvasBackground(nextTheme),
                  }));
                }}
                data-testid="switch-board-theme"
              />
              <span className="truncate text-xs text-muted-foreground">
                {boardTheme === "dark" ? "生成黑底反色脚本" : "生成白底脚本"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Smartphone className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-[64px] text-xs font-medium">9:16 竖屏</div>
              <Switch
                checked={canvasAspect === "portrait"}
                onCheckedChange={(checked) => {
                  const nextAspect = normalizeCanvasAspect(checked ? "portrait" : "landscape");
                  setCanvasAspect(nextAspect);
                  canvasAspectRef.current = nextAspect;
                  resetPreparedVideo("");
                }}
                data-testid="switch-canvas-aspect"
              />
              <span className="truncate text-xs text-muted-foreground">
                {canvasAspect === "portrait" ? "手机短视频画面" : "横版白板画面"}
              </span>
            </div>
            {waitState ? (
              <div className="rounded-md border bg-primary/5 px-3 py-2 text-xs text-primary">
                {waitState.message}
              </div>
            ) : null}

            <div className="mt-4 flex flex-1 flex-col overflow-hidden">
              <div className="mb-2 flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-muted-foreground">
                  JSON 命令脚本
                </label>
                <input
                  ref={scriptFileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={handleLoadScriptFile}
                  data-testid="input-script-file"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={status === "running" || status === "preparing" || aiBusy}
                  onClick={() => scriptFileInputRef.current?.click()}
                  data-testid="button-load-script-file"
                >
                  <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                  加载文件
                </Button>
              </div>
              <Textarea
                value={scriptText}
                onChange={(e) => {
                  scriptTextRef.current = e.target.value;
                  setScriptText(e.target.value);
                  resetKnowledgeSummary("");
                }}
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
            {shareMessage ? (
              <Card className="mt-3 border-primary/20 bg-primary/5 p-3">
                <div className="break-all text-xs text-primary" data-testid="text-share-message">
                  {shareMessage}
                </div>
              </Card>
            ) : null}
          </aside>
        ) : null}
        {libraryOpen && !isFullscreen ? (
          <aside className="absolute inset-y-0 right-0 z-40 flex w-full max-w-[460px] flex-col border-l bg-background/95 shadow-2xl backdrop-blur">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <div className="text-sm font-semibold">讲解库</div>
                <div className="text-xs text-muted-foreground">{selectedGroupName}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setLibraryOpen(false)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => setSelectedGroupId(null)}>
                全部
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleCreateGroup(selectedGroupId)}>
                <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
                新建{selectedGroupId ? "子" : ""}分组
              </Button>
            </div>
            {libraryMessage ? (
              <div className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                {libraryMessage}
              </div>
            ) : null}
            <div className="flex-1 overflow-auto p-4">
              <div className="mb-4 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">分组</div>
                {lectureGroups.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                    还没有分组，可以按主题创建。
                  </div>
                ) : (
                  <div className="space-y-1">
                    {lectureGroups.map((group) => (
                      <div
                        key={group.id}
                        className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs ${
                          selectedGroupId === group.id ? "border-primary bg-primary/5" : "bg-background"
                        }`}
                        style={{ paddingLeft: 12 + groupDepth(group.id) * 16 }}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left"
                          onClick={() => setSelectedGroupId(group.id)}
                        >
                          {group.name}
                          {group.shareActive ? " · 分享中" : ""}
                        </button>
                        <div className="ml-2 flex shrink-0 items-center gap-1">
                          <span className="text-muted-foreground">
                            {savedLectures.filter((lecture) => lecture.groupId === group.id).length}
                          </span>
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleShareGroup(group)}>
                            分享
                          </Button>
                          {group.shareActive ? (
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleStopGroupShare(group)}>
                              停止
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground">当前分组内容</div>
                  <div className="text-xs text-muted-foreground">
                    {currentChildGroups.length} 组 · {currentGroupLectures.length} 个讲解
                  </div>
                </div>
                {currentChildGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    className="flex w-full items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-left text-xs"
                    onClick={() => setSelectedGroupId(group.id)}
                  >
                    <span>{group.name}</span>
                    <span className="text-muted-foreground">进入</span>
                  </button>
                ))}
                {currentGroupLectures.length === 0 && currentChildGroups.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    当前分组还没有讲解。
                  </div>
                ) : null}
                {currentGroupLectures.map((lecture) => (
                  <Card key={lecture.id} className="p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{lecture.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {new Date(lecture.updatedAt).toLocaleString()}
                          {lecture.shareActive ? " · 分享中" : ""}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleLoadLecture(lecture.id)}>
                        打开
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleShareLecture(lecture)}>
                        <Link2 className="mr-1.5 h-3.5 w-3.5" />
                        {lecture.shareActive ? "复制分享" : "分享"}
                      </Button>
                      {lecture.shareActive ? (
                        <Button size="sm" variant="outline" onClick={() => handleStopLectureShare(lecture)}>
                          停止分享
                        </Button>
                      ) : null}
                      <select
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        value={lecture.groupId ?? ""}
                        onChange={(event) => handleMoveLecture(lecture.id, event.target.value || null)}
                      >
                        <option value="">未分组</option>
                        {lectureGroups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {" ".repeat(groupDepth(group.id) * 2)}
                            {group.name}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteLecture(lecture)}>
                        删除
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </aside>
        ) : null}

        <main className="relative flex flex-1 overflow-hidden">
          <div className={isFullscreen ? "relative flex flex-1 overflow-hidden" : "relative flex flex-1 overflow-hidden p-3 sm:p-5 lg:p-7"}>
            <WhiteboardCanvas
              canvas={canvas}
              elements={elements}
              annotations={annotations}
              allowUpscale
              fullBleed={isFullscreen}
            />

            <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-2 sm:inset-x-5 sm:top-5">
              <Badge
                variant="secondary"
                className="pointer-events-auto max-w-[72vw] truncate bg-background/88 text-[11px] shadow-sm backdrop-blur sm:max-w-[360px] sm:text-xs"
                data-testid={isFullscreen ? "badge-fullscreen-status" : "badge-status"}
              >
                {(status === "running" || status === "preparing") && (
                  <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                )}
                {status === "done" && <CheckCircle2 className="mr-1.5 h-3 w-3 text-emerald-500" />}
                {status === "error" && <AlertCircle className="mr-1.5 h-3 w-3 text-destructive" />}
                {stepLabel}
              </Badge>

              {isFullscreen ? (
                <div className="pointer-events-auto flex items-center gap-1 rounded-md bg-background/85 p-1 shadow-sm backdrop-blur sm:gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 sm:h-9 sm:w-9"
                    onClick={togglePausePlayback}
                    disabled={status === "preparing" || status === "error" || aiBusy}
                    title="播放/暂停（空格）"
                    data-testid="button-fullscreen-pause-toggle"
                  >
                    {status === "running" && !isPaused ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 sm:h-9 sm:w-9"
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
                    className="h-8 w-8 sm:h-9 sm:w-9"
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
                    className="h-8 w-8 sm:h-9 sm:w-9"
                    onClick={exitFullscreen}
                    title="退出全屏"
                    data-testid="button-exit-fullscreen"
                  >
                    <Minimize2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </div>

            {!isFullscreen && currentCommand ? (
              <div className="pointer-events-none absolute left-3 top-12 z-20 max-w-[72vw] rounded-md bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur sm:left-5 sm:top-14 sm:max-w-[460px]">
                <span data-testid="text-current-command">{describeCommand(currentCommand)}</span>
              </div>
            ) : null}

            {knowledgeEntryLabel ? (
              <div className="absolute right-3 top-16 z-30 flex flex-col items-end gap-2 sm:right-5 sm:top-20">
                <Button
                  type="button"
                  size="sm"
                  variant={topicGenerationStatus === "ready" ? "default" : "secondary"}
                  className="h-8 rounded-full bg-background/90 px-3 text-xs shadow-sm backdrop-blur hover:bg-background"
                  onClick={() => setKnowledgePanelOpen((open) => !open)}
                  data-testid="button-knowledge-entry"
                >
                  {knowledgeStatus === "summarizing" || topicBusy ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : topicGenerationStatus === "ready" ? (
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <BookOpen className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {knowledgeEntryLabel}
                </Button>
                {topicBusy ? (
                  <div className="h-1 w-40 overflow-hidden rounded-full bg-background/70 shadow-sm backdrop-blur">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${Math.max(topicGenerationProgress, 4)}%` }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {knowledgePanelOpen ? (
              <Card className="absolute right-3 top-28 z-40 flex max-h-[min(620px,calc(100%-9rem))] w-[min(380px,calc(100vw-1.5rem))] flex-col overflow-hidden border-primary/15 bg-background/96 shadow-2xl backdrop-blur sm:right-5">
                <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <BookOpen className="h-4 w-4 text-primary" />
                      <span className="truncate">
                        {knowledgeSummary?.title ?? "这道题用到的基础知识"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {knowledgeStatus === "ready"
                        ? knowledgeSummary?.overview
                        : knowledgeStatus === "error"
                          ? knowledgeMessage || "知识点整理失败，可以稍后重试。"
                          : "知识点正在整理，准备好后会显示在这里。"}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setKnowledgePanelOpen(false)}
                    data-testid="button-close-knowledge-panel"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 overflow-auto px-4 py-3">
                  {knowledgeStatus === "summarizing" ? (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      知识点整理中
                    </div>
                  ) : null}
                  {knowledgeStatus === "error" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void summarizeKnowledgeForScript(scriptTextRef.current, { force: true })}
                      data-testid="button-retry-knowledge-summary"
                    >
                      重新整理知识点
                    </Button>
                  ) : null}
                  {knowledgeStatus === "ready" ? (
                    <div className="space-y-4">
                      {knowledgeSections.length === 0 ? (
                        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                          这次讲解没有整理出额外知识点。
                        </div>
                      ) : null}
                      {knowledgeSections.map((section) => (
                        <section key={section.title}>
                          <div className="mb-2 text-xs font-semibold text-muted-foreground">
                            {section.title}
                          </div>
                          <div className="space-y-2">
                            {section.items.map((item, index) => (
                              <div
                                key={`${section.title}-${item.name}-${index}`}
                                className="rounded-lg border bg-background/80 px-3 py-2"
                              >
                                <div className="text-sm font-medium">{item.name}</div>
                                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                  {item.explanation}
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2 border-t px-4 py-3">
                  {topicGenerationStatus === "ready" && topicLectureSession ? (
                    <Button
                      className="w-full"
                      size="sm"
                      onClick={() => void handleEnterTopicLecture()}
                      data-testid="button-enter-topic-lecture"
                    >
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      进入专题讲解
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      size="sm"
                      variant="outline"
                      disabled={!knowledgeSummary || topicBusy}
                      onClick={() => void handleGenerateTopicLecture()}
                      data-testid="button-generate-topic-lecture"
                    >
                      {topicBusy ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {topicBusy ? topicGenerationMessage || "专题讲解生成中" : "生成专题讲解"}
                    </Button>
                  )}
                  {topicGenerationStatus === "error" ? (
                    <div className="text-xs leading-relaxed text-destructive">
                      {topicGenerationMessage}
                    </div>
                  ) : null}
                  {suspendedLectureSession && scriptTextRef.current !== suspendedLectureSession.scriptText ? (
                    <Button
                      className="w-full"
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleReturnToSuspendedLecture(true)}
                      data-testid="button-return-main-lecture"
                    >
                      <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                      返回刚才题目
                    </Button>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {!isFullscreen && stepTotal > 0 ? (
              <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center sm:inset-x-5 sm:bottom-5">
                <div className="h-1.5 w-[min(420px,58vw)] overflow-hidden rounded-full bg-background/70 shadow-sm backdrop-blur">
                  <div
                    className="h-full bg-primary transition-all duration-200"
                    style={{
                      width: `${
                        status === "done"
                          ? 100
                          : Math.round((Math.min(stepIndex, stepTotal) / stepTotal) * 100)
                      }%`,
                    }}
                    data-testid="progress-bar"
                  />
                </div>
              </div>
            ) : null}

            <div className="pointer-events-none absolute inset-x-2 bottom-8 z-20 flex justify-center sm:inset-x-4 sm:bottom-10">
              <div className="max-w-[92vw] sm:max-w-3xl">
                <NarrationBar text={narration} charsPerSecond={9 * playbackSpeed} overlay />
              </div>
            </div>

            {!isFullscreen && (errorMsg || aiMessage || videoExportMessage || shareMessage) ? (
              <div className="pointer-events-none absolute inset-x-3 top-16 z-30 flex justify-center sm:inset-x-5 sm:top-5">
                <div
                  className={`pointer-events-auto max-w-2xl rounded-md px-3 py-2 text-xs shadow-sm backdrop-blur ${
                    status === "error" || aiStatus === "error" || videoRenderStatus === "error"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-background/88 text-muted-foreground"
                  }`}
                  data-testid="text-floating-message"
                >
                  <div>{errorMsg || aiMessage || videoExportMessage || shareMessage}</div>
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
              </div>
            ) : null}
          </div>

          {!isFullscreen && (controlsOpen || morePanelOpen) ? (
            <button
              type="button"
              className="absolute inset-0 z-30 cursor-default bg-transparent"
              aria-label="收起控制面板"
              onClick={collapseFloatingUi}
            />
          ) : null}

          {!isFullscreen ? (
            <div
              className="fixed z-50"
              style={floatingControlStyle}
            >
              {morePanelOpen ? (
                <div
                  className="absolute w-[min(340px,calc(100vw-2rem))] rounded-xl border bg-background/95 p-3 shadow-2xl backdrop-blur"
                  style={floatingMorePanelStyle}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAiPanelOpen(true);
                        collapseFloatingUi();
                      }}
                      data-testid="button-open-ai-panel"
                    >
                      <Bot className="mr-1.5 h-3.5 w-3.5" />
                      生成讲解
                    </Button>
                    <Button
                      size="sm"
                      variant={scriptPanelOpen ? "secondary" : "outline"}
                      onClick={() => {
                        setScriptPanelOpen((open) => !open);
                        setLibraryOpen(false);
                        collapseFloatingUi();
                      }}
                      data-testid="button-toggle-script"
                    >
                      <FileText className="mr-1.5 h-3.5 w-3.5" />
                      脚本
                    </Button>
                    <Button
                      size="sm"
                      variant={libraryOpen ? "secondary" : "outline"}
                      onClick={() => {
                        void handleOpenLibrary();
                        setScriptPanelOpen(false);
                        collapseFloatingUi();
                      }}
                      data-testid="button-open-library"
                    >
                      <Library className="mr-1.5 h-3.5 w-3.5" />
                      讲解库
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void handleSaveLecture();
                        collapseFloatingUi();
                      }}
                      disabled={status === "preparing" || aiBusy}
                      data-testid="button-save-lecture"
                    >
                      <Save className="mr-1.5 h-3.5 w-3.5" />
                      保存
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void handleCreateShare();
                        collapseFloatingUi();
                      }}
                      disabled={status === "preparing" || aiBusy}
                      data-testid="button-create-share"
                    >
                      <Share2 className="mr-1.5 h-3.5 w-3.5" />
                      分享
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void handleExportMp4();
                        collapseFloatingUi();
                      }}
                      disabled={exportButtonDisabled}
                      data-testid="button-export-mp4"
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      {exportButtonLabel}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        handleLoadSample();
                        collapseFloatingUi();
                      }}
                      data-testid="button-load-sample"
                    >
                      <FileText className="mr-1.5 h-3.5 w-3.5" />
                      示例
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        handleClear();
                        collapseFloatingUi();
                      }}
                      data-testid="button-clear"
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      清空
                    </Button>
                  </div>
                </div>
              ) : null}
              {controlsOpen ? (
                <div
                  className="absolute right-0 flex flex-col gap-2 rounded-xl border bg-background/95 p-2 shadow-2xl backdrop-blur"
                  style={floatingControlsPanelStyle}
                >
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={togglePausePlayback}
                    disabled={status === "preparing" || status === "error" || aiBusy}
                    title="播放/暂停（空格）"
                    data-testid="button-pause-toggle"
                  >
                    {status === "running" && !isPaused ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleStepBackward}
                    disabled={status === "preparing" || aiBusy || stepIndex <= 0}
                    title="后退一步（←）"
                    data-testid="button-step-back"
                  >
                    <SkipBack className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleStepForward}
                    disabled={status === "preparing" || aiBusy || (stepTotal > 0 && stepIndex >= stepTotal)}
                    title="前进一步（→）"
                    data-testid="button-step-forward"
                  >
                    <SkipForward className="h-4 w-4" />
                  </Button>
                  {status === "running" || status === "preparing" ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleStop}
                      title="停止"
                      data-testid="button-stop"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={toggleFullscreen}
                    title="全屏模式"
                    data-testid="button-fullscreen"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant={morePanelOpen ? "secondary" : "ghost"}
                    onClick={() => setMorePanelOpen((open) => !open)}
                    title="更多"
                    data-testid="button-more-actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
              <Button
                size="icon"
                className="h-14 w-14 touch-none rounded-full shadow-2xl cursor-grab active:cursor-grabbing"
                onClick={handleFloatingControlClick}
                onPointerDown={handleFloatingControlPointerDown}
                onPointerMove={handleFloatingControlPointerMove}
                onPointerUp={finishFloatingControlDrag}
                onPointerCancel={finishFloatingControlDrag}
                title="打开控制，可拖动"
                data-testid="button-floating-controls"
              >
                {controlsOpen ? <XCircle className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>
            </div>
          ) : null}

          {!isFullscreen && aiPanelOpen ? (
            <div className="absolute inset-x-3 bottom-3 z-40 sm:inset-x-6 sm:bottom-6">
              <Card className="mx-auto max-w-3xl border-primary/15 bg-background/96 p-3 shadow-2xl backdrop-blur">
                <div className="mb-3 flex items-center justify-between gap-3">
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
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setAiPanelOpen(false)}
                    title="收起生成面板"
                    data-testid="button-close-ai-panel"
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-end gap-2 rounded-xl border bg-background p-2 shadow-sm">
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
              </Card>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
