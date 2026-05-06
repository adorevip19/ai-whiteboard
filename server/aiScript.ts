import fs from "node:fs/promises";
import path from "node:path";
import {
  validateScript,
  type LayoutSlot,
  type WhiteboardCommand,
  type WhiteboardScript,
} from "../client/src/whiteboard/commandTypes";

type PreflightSeverity = "error" | "warning" | "suggestion";

export type ScriptPreflightIssue = {
  severity: PreflightSeverity;
  commandIndex?: number;
  commandId?: string;
  commandType?: string;
  message: string;
  suggestion?: string;
};

export type ScriptPreflightReport = {
  ok: boolean;
  summary: string;
  errors: number;
  warnings: number;
  suggestions: number;
  issues: ScriptPreflightIssue[];
};

export type KnowledgeSummaryItem = {
  name: string;
  explanation: string;
};

export type KnowledgeSummary = {
  title: string;
  overview: string;
  concepts: KnowledgeSummaryItem[];
  formulas: KnowledgeSummaryItem[];
  principles: KnowledgeSummaryItem[];
  background: KnowledgeSummaryItem[];
  followUpPrompt: string;
};

export type AiScriptResult = {
  scriptText: string;
  script: WhiteboardScript;
  explanation: string;
  knowledgeSummary?: KnowledgeSummary;
  report: ScriptPreflightReport;
  rounds: Array<{
    round: number;
    action: "generate" | "repair";
    model?: string;
    durationMs?: number;
    report: ScriptPreflightReport;
  }>;
};

export type ImageProblemRecognitionResult = {
  problemText: string;
  diagramDescription: string;
  subject?: string;
  confidence: "high" | "medium" | "low";
  notes?: string;
};

export type AiExplanationMode = "detailed" | "concise";

const DEFAULT_GENERATE_MODEL = "openai/gpt-5.5";
const DEFAULT_REPAIR_MODEL = "openai/gpt-5.2";
const DEFAULT_VISION_MODEL = "openai/gpt-5.4";
const DEFAULT_MAX_ROUNDS = 4;
const PERPLEXITY_AGENT_URL = "https://api.perplexity.ai/v1/agent";

const knowledgeSummarySchema = {
  type: "object",
  properties: {
    title: { type: "string", maxLength: 48 },
    overview: { type: "string", maxLength: 90 },
    concepts: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 32 },
          explanation: { type: "string", maxLength: 96 },
        },
        required: ["name", "explanation"],
        additionalProperties: false,
      },
    },
    formulas: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 48 },
          explanation: { type: "string", maxLength: 96 },
        },
        required: ["name", "explanation"],
        additionalProperties: false,
      },
    },
    principles: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 40 },
          explanation: { type: "string", maxLength: 96 },
        },
        required: ["name", "explanation"],
        additionalProperties: false,
      },
    },
    background: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          name: { type: "string", maxLength: 32 },
          explanation: { type: "string", maxLength: 80 },
        },
        required: ["name", "explanation"],
        additionalProperties: false,
      },
    },
    followUpPrompt: { type: "string" },
  },
  required: ["title", "overview", "concepts", "formulas", "principles", "background", "followUpPrompt"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

const aiScriptResultSchema = {
  type: "object",
  properties: {
    explanation: { type: "string" },
    scriptLines: {
      type: "array",
      items: { type: "string" },
    },
    knowledgeSummary: knowledgeSummarySchema,
  },
  required: ["explanation", "scriptLines", "knowledgeSummary"],
  additionalProperties: false,
} satisfies Record<string, unknown>;

function countBySeverity(issues: ScriptPreflightIssue[], severity: PreflightSeverity) {
  return issues.filter((issue) => issue.severity === severity).length;
}

function buildReport(issues: ScriptPreflightIssue[]): ScriptPreflightReport {
  const errors = countBySeverity(issues, "error");
  const warnings = countBySeverity(issues, "warning");
  const suggestions = countBySeverity(issues, "suggestion");
  const ok = errors === 0;
  const summary = ok
    ? warnings > 0
      ? `脚本可播放，但还有 ${warnings} 个布局或教学风险、${suggestions} 条建议。`
      : suggestions > 0
        ? `脚本可播放，还有 ${suggestions} 条教学优化建议。`
      : "脚本已通过预检，可以播放。"
    : `预检发现 ${errors} 个错误、${warnings} 个风险、${suggestions} 条建议。`;
  return { ok, summary, errors, warnings, suggestions, issues };
}

function needsAiRepair(report: ScriptPreflightReport) {
  return report.errors > 0 || report.warnings > 0;
}

function getCommandId(command: WhiteboardCommand) {
  return "id" in command && typeof command.id === "string" ? command.id : undefined;
}

function getCommandNarration(command: WhiteboardCommand) {
  return "narration" in command && typeof command.narration === "string"
    ? command.narration.trim()
    : "";
}

function estimateTextWidth(text: string, fontSize: number) {
  let width = 0;
  for (const char of text) {
    width += /[\u4e00-\u9fff]/.test(char) ? fontSize * 1.05 : fontSize * 0.6;
  }
  return width + fontSize * 0.12;
}

function estimateWrappedTextLines(text: string, fontSize: number, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    const chars = Array.from(paragraph.trim());
    if (chars.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const char of chars) {
      const next = current + char;
      if (current && estimateTextWidth(next, fontSize) > maxWidth) {
        lines.push(current);
        current = char;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

function estimateParagraphTextBBox(
  command: Extract<WhiteboardCommand, { type: "write_paragraph" }>,
  rect: { x: number; y: number; width: number; height: number },
) {
  const padding = command.padding ?? 18;
  const fontSize = command.fontSize;
  const lineGap = command.lineGap ?? fontSize * 1.65;
  const maxTextWidth = Math.max(20, rect.width - padding * 2);
  const lines = estimateWrappedTextLines(command.text, fontSize, maxTextWidth);
  const maxLines = Math.max(1, Math.floor((rect.height - padding * 2) / lineGap));
  const visibleLines = Math.max(1, Math.min(lines.length, maxLines));
  const measuredWidth = Math.min(
    maxTextWidth,
    Math.max(fontSize, ...lines.slice(0, visibleLines).map((line) => estimateTextWidth(line, fontSize))),
  );
  return {
    x: rect.x + padding,
    y: rect.y + padding,
    width: measuredWidth,
    height: Math.max(fontSize, Math.min(Math.max(fontSize, rect.height - padding * 2), fontSize * 1.2 + (visibleLines - 1) * lineGap)),
  };
}

function estimateMathCommandBBox(
  command: Extract<WhiteboardCommand, { type: "write_math" | "write_math_steps" }>,
) {
  if (command.type === "write_math") {
    return {
      x: command.x,
      y: command.y,
      width: Math.max(command.fontSize * 3, command.latex.length * command.fontSize * 0.42),
      height: command.fontSize * (command.displayMode ? 1.8 : 1.35),
    };
  }
  const maxLength = Math.max(...command.steps.map((step) => step.length));
  return {
    x: command.x,
    y: command.y,
    width: Math.max(command.fontSize * 4, maxLength * command.fontSize * 0.42),
    height: (command.lineGap ?? command.fontSize * 1.45) * command.steps.length,
  };
}

function buildLayoutSlots(
  script: WhiteboardScript,
  variant: Extract<WhiteboardCommand, { type: "layout_page" }>["variant"],
): LayoutSlot[] {
  const margin = 72;
  const top = 145;
  const bottom = 64;
  const gap = 28;
  const width = script.canvas.width - margin * 2;
  const height = script.canvas.height - top - bottom;
  if (variant === "two_column") {
    const colW = (width - gap) / 2;
    return [
      { id: "left", x: margin, y: top, width: colW, height, label: "左栏" },
      { id: "right", x: margin + colW + gap, y: top, width: colW, height, label: "右栏" },
    ];
  }
  if (variant === "revision") {
    const noteH = Math.max(92, height * 0.22);
    const cardH = height - noteH - gap;
    const colW = (width - gap) / 2;
    return [
      { id: "before", x: margin, y: top, width: colW, height: cardH, label: "原文" },
      { id: "after", x: margin + colW + gap, y: top, width: colW, height: cardH, label: "修改后" },
      { id: "note", x: margin, y: top + cardH + gap, width, height: noteH, label: "点评" },
    ];
  }
  if (variant === "three_panel") {
    const colW = (width - gap * 2) / 3;
    return [
      { id: "left", x: margin, y: top, width: colW, height, label: "一" },
      { id: "middle", x: margin + colW + gap, y: top, width: colW, height, label: "二" },
      { id: "right", x: margin + (colW + gap) * 2, y: top, width: colW, height, label: "三" },
    ];
  }
  return [{ id: "content", x: margin, y: top, width, height, label: "内容" }];
}

function unionSlots(slots: LayoutSlot[]) {
  const x1 = Math.min(...slots.map((slot) => slot.x));
  const y1 = Math.min(...slots.map((slot) => slot.y));
  const x2 = Math.max(...slots.map((slot) => slot.x + slot.width));
  const y2 = Math.max(...slots.map((slot) => slot.y + slot.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function countVisibleChars(text: string) {
  return Array.from(text.replace(/\s+/g, "")).length;
}

function recommendedTextDurationMs(text: string) {
  const chars = countVisibleChars(text);
  if (chars > 20) return 1500;
  if (chars >= 8) return 1000;
  return 0;
}

function recommendedNarrationDurationMs(text: string) {
  const chars = countVisibleChars(text);
  if (chars < 18) return 0;
  return Math.ceil((chars / 6) * 1000);
}

function addIssue(
  issues: ScriptPreflightIssue[],
  command: WhiteboardCommand | undefined,
  commandIndex: number | undefined,
  severity: PreflightSeverity,
  message: string,
  suggestion?: string,
) {
  issues.push({
    severity,
    commandIndex,
    commandId: command ? getCommandId(command) : undefined,
    commandType: command?.type,
    message,
    suggestion,
  });
}

function addPacingIssues(
  issues: ScriptPreflightIssue[],
  command: WhiteboardCommand,
  commandIndex: number,
  visibleText: string | undefined,
) {
  const duration = "duration" in command && typeof command.duration === "number"
    ? command.duration
    : undefined;
  if (duration === undefined) return;

  if (visibleText) {
    const chars = countVisibleChars(visibleText);
    const recommended = recommendedTextDurationMs(visibleText);
    if (
      recommended > 0 &&
      duration < recommended &&
      ((chars > 20 && duration < 1200) || duration <= 500)
    ) {
      addIssue(
        issues,
        command,
        commandIndex,
        "warning",
        `文字书写节奏过快：${chars} 个可见字符只给了 ${duration}ms，学生可能看不清。`,
        `把该文字命令的 duration 提高到至少 ${recommended}ms；范文、修改后原文、题干重述等长文本建议每行 1500–2500ms，并在整段写完后留阅读停顿。`,
      );
    }
  }

  const narration = getCommandNarration(command);
  const recommendedNarration = recommendedNarrationDurationMs(narration);
  if (recommendedNarration > 0 && duration < recommendedNarration * 0.5) {
    addIssue(
      issues,
      command,
      commandIndex,
      "warning",
      `旁白与动画时长不匹配：${countVisibleChars(narration)} 个旁白字符只给了 ${duration}ms。`,
      `把 duration 提高到约 ${recommendedNarration}ms，或缩短旁白；不要依赖 TTS 等待来掩盖过短动画，手机端语音暂停时白板会显得过快。`,
    );
  }
}

function addNarrationStyleIssues(
  issues: ScriptPreflightIssue[],
  command: WhiteboardCommand,
  commandIndex: number,
) {
  const narration = getCommandNarration(command);
  if (!narration) return;

  const thirdPartyPattern = /(让孩子|给学生|学生们可以|家长可以|大人可以|老师可以|让他|让她|让他们)/;
  if (thirdPartyPattern.test(narration)) {
    addIssue(
      issues,
      command,
      commandIndex,
      "warning",
      "旁白出现面向第三方的口吻。",
      "改成老师直接面向学生本人说话，例如“你看这里”“这一步要抓住……”“你可以先暂停想一想”。",
    );
  }

  const operationPattern =
    /(我|我们|这里|现在|接着|先|再|最后)?[^。！？；，,]{0,8}(新建|切到|切换|翻到|擦掉|擦除|清空|删除|画出|画一|画条|写下|写出|圈起来|框起来|划出来|标出|标记|移动到|移到|放到|拖到)/;
  if (operationPattern.test(narration)) {
    addIssue(
      issues,
      command,
      commandIndex,
      "warning",
      "旁白在描述白板操作过程。",
      "不要播报“我画/写/擦/圈/切页/移动”。白板动作会自己呈现，旁白应讲知识点、思路和学生此刻要注意什么。",
    );
  }
}

function pointOutOfCanvas(x: number, y: number, script: WhiteboardScript) {
  return x < 0 || y < 0 || x > script.canvas.width || y > script.canvas.height;
}

function pointIdListText(ids: string[]) {
  return ids.map((id) => `"${id}"`).join("、");
}

function checkRect(
  issues: ScriptPreflightIssue[],
  script: WhiteboardScript,
  command: WhiteboardCommand,
  commandIndex: number,
  rect: { x: number; y: number; width: number; height: number },
  label: string,
) {
  const overflow =
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > script.canvas.width ||
    rect.y + rect.height > script.canvas.height;
  if (overflow) {
    addIssue(
      issues,
      command,
      commandIndex,
      "warning",
      `${label} 可能超出画布范围。`,
      "调整 x/y/width/height，给画布边缘至少留 24px 安全距离。",
    );
  }
}

function estimateSegmentLayout(command: Extract<WhiteboardCommand, { type: "write_text_segments" }>) {
  let cursorX = command.x;
  let previousFontSize = command.fontSize;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const segments = command.segments.map((segment) => {
    const fontSize = segment.fontSize ?? command.fontSize;
    const fontSizeDelta = Math.max(0, fontSize - previousFontSize);
    if (fontSizeDelta > 0 && cursorX > command.x) {
      cursorX += fontSizeDelta * 0.65 + 4;
    }
    const width = estimateTextWidth(segment.text, fontSize);
    const bbox = {
      x: cursorX,
      y: command.y - fontSize,
      width,
      height: fontSize * 1.25,
    };
    cursorX += width;
    previousFontSize = fontSize;
    minY = Math.min(minY, bbox.y);
    maxY = Math.max(maxY, bbox.y + bbox.height);
    return { segment, fontSize, bbox };
  });
  return {
    segments,
    bbox: {
      x: command.x,
      y: Number.isFinite(minY) ? minY : command.y - command.fontSize,
      width: Math.max(cursorX - command.x, command.fontSize),
      height: Number.isFinite(maxY - minY) ? maxY - minY : command.fontSize * 1.25,
    },
  };
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap = 0,
) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

function rectOverlapArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function rectArea(rect: { width: number; height: number }) {
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

type MathLogicItem = {
  command: WhiteboardCommand;
  commandIndex: number;
  expression: string;
  label: string;
};

function normalizeMathExpression(expression: string) {
  return expression
    .replace(/\\text\{([^}]*)\}/g, " $1 ")
    .replace(/\\(?:times|cdot)/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\cdots/g, "…")
    .replace(/\\sqrt/g, "sqrt")
    .replace(/\\frac/g, "frac")
    .replace(/[{}]/g, "")
    .replace(/[，。；;、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeMathExpression(expression: string) {
  const normalized = normalizeMathExpression(expression);
  return /[=＝]/.test(normalized) && /[\dA-Za-zＭｍMxyabcnk]/.test(normalized);
}

function getTrailingResultNumber(expression: string) {
  const normalized = normalizeMathExpression(expression);
  const match = normalized.match(/[=＝]\s*(-?\d+(?:\.\d+)?)\s*$/);
  return match?.[1];
}

function getAnswerLikeNumber(expression: string) {
  const normalized = normalizeMathExpression(expression);
  const match = normalized.match(/答(?:案)?[:：]?\s*[^-\d]*(-?\d+(?:\.\d+)?)/);
  return match?.[1];
}

function expressionEndsWithEquals(expression: string) {
  const normalized = normalizeMathExpression(expression);
  return /(?:^|[^=＝])[=＝]\s*$/.test(normalized);
}

function repairDecodedLatexEscapes(text: string) {
  return text.replace(/\f(?=rac|box|ill|ont|oreach)/g, "\\f");
}

function normalizeLatexText(text: string) {
  return repairDecodedLatexEscapes(text)
    .replace(/(^|[^\\])therefore(?=[A-Z])/g, "$1\\therefore ")
    .replace(/(^|[^\\])because(?=[A-Z])/g, "$1\\because ");
}

function containsRawLatexCommand(text: string) {
  return /\\(?:frac|sqrt|circ|Rightarrow|Leftarrow|rightarrow|leftarrow|Leftrightarrow|therefore|because|angle|triangle|parallel|perp|cdot|times|div|leq|geq|neq|text|sin|cos|tan|log|ln|overline|widehat|hat|vec)\b/.test(
    normalizeLatexText(text),
  );
}

function isFormulaDominantPlainText(text: string) {
  const normalized = normalizeLatexText(text).trim();
  if (!normalized) return false;
  const cjkCount = Array.from(normalized).filter((char) => /[\u4e00-\u9fff]/.test(char)).length;
  const hasMathOperator = /[=＝<>≈≠≤≥+\-*/^_]|⇒|⇔|→|←|∴|∵|∠|⊥|∥|°/.test(normalized);
  const hasMathSymbol = /[A-Za-zΑ-Ωα-ω]\d*|\d/.test(normalized);
  return hasMathOperator && hasMathSymbol && cjkCount <= 4;
}

function shouldUseMathCommand(text: string) {
  const normalized = normalizeLatexText(text).trim();
  if (!normalized) return false;
  if (containsRawLatexCommand(normalized)) return true;
  return isFormulaDominantPlainText(normalized);
}

function canAutoConvertTextToMath(text: string) {
  const normalized = normalizeLatexText(text).trim();
  if (!shouldUseMathCommand(normalized)) return false;
  return !/[\u4e00-\u9fff]/.test(normalized);
}

function addPlainTextFormulaIssue(
  issues: ScriptPreflightIssue[],
  command: WhiteboardCommand,
  commandIndex: number,
  text: string,
  label: string,
) {
  if (!shouldUseMathCommand(text)) return;
  addIssue(
    issues,
    command,
    commandIndex,
    "warning",
    `${label} 使用普通文本承载数学公式或 LaTeX，板书会出现非标准公式。`,
    "把这一行改成 write_math；连续多行推导改成 write_math_steps。中文说明和公式应拆成相邻的 write_text + write_math，不要把公式塞进普通文本。",
  );
}

function addMathLogicChecks(issues: ScriptPreflightIssue[], items: MathLogicItem[]) {
  let latestCompleteResult: string | undefined;
  let latestAnswerNumber: string | undefined;
  const unfinished: MathLogicItem[] = [];

  for (const item of items) {
    const normalized = normalizeMathExpression(item.expression);
    const answerNumber = getAnswerLikeNumber(normalized);
    if (answerNumber) latestAnswerNumber = answerNumber;

    if (looksLikeMathExpression(normalized) && expressionEndsWithEquals(normalized)) {
      unfinished.push(item);
      addIssue(
        issues,
        item.command,
        item.commandIndex,
        "warning",
        `数学推导"${item.label}: ${normalized}"以等号结尾，右侧结果缺失。`,
        latestCompleteResult
          ? `把这一行补完整，不要留下空等号。例如先写出等号右侧结果；若这里承接上一行，可考虑补成 "... = ${latestCompleteResult}"。`
          : "补全等号右侧的结果；不要只在最终答案框里给答案，推导链本身也要算完整。",
      );
    }

    const result = getTrailingResultNumber(normalized);
    if (result && !expressionEndsWithEquals(normalized)) {
      latestCompleteResult = result;
    }
  }

  if (unfinished.length > 0 && latestAnswerNumber) {
    const last = unfinished[unfinished.length - 1];
    addIssue(
      issues,
      last.command,
      last.commandIndex,
      "warning",
      `最终答案出现了 ${latestAnswerNumber}，但前面的公式推导还有空等号。`,
      `把推导链显式写到最终答案，例如 "M - 2 = 30"、"M = 30 + 2 = ${latestAnswerNumber}"；不要让学生自己脑补最后一步。`,
    );
  }
}

function analyzeValidScript(script: WhiteboardScript) {
  const issues: ScriptPreflightIssue[] = [];
  const ids = new Map<string, number>();
  const created = new Set<string>();
  const coordinateSystems = new Set<string>();
  const textSegments = new Map<
    string,
    {
      command: Extract<WhiteboardCommand, { type: "write_text_segments" }>;
      commandIndex: number;
      layout: ReturnType<typeof estimateSegmentLayout>;
    }
  >();
  const textBboxes: Array<{
    sceneId: string;
    id: string;
    command: WhiteboardCommand;
    commandIndex: number;
    bbox: { x: number; y: number; width: number; height: number };
  }> = [];
  const rectangles: Array<{
    sceneId: string;
    command: Extract<WhiteboardCommand, { type: "draw_rectangle" }>;
    commandIndex: number;
  }> = [];
  const geometryPages = new Map<string, number>();
  let hasGeometryCommands = false;
  const mathLogicItems: MathLogicItem[] = [];
  let currentPageId = script.pages?.[0]?.id ?? "default";
  const pageSceneVersions = new Map<string, number>([[currentPageId, 0]]);
  const currentSceneId = () => `${currentPageId}:${pageSceneVersions.get(currentPageId) ?? 0}`;
  const pageObjectCounts = new Map<string, number>();
  const pageSlots = new Map<string, Map<string, LayoutSlot>>();

  if (script.canvas.width < 600 || script.canvas.height < 400) {
    addIssue(
      issues,
      undefined,
      undefined,
      "warning",
      "画布尺寸偏小，复杂讲解可能拥挤。",
      "默认建议使用 1200x800；长讲解可用更大的画布。",
    );
  }

  script.commands.forEach((command, index) => {
    if (command.type === "switch_page") {
      currentPageId = command.pageId;
      if (!pageSceneVersions.has(currentPageId)) pageSceneVersions.set(currentPageId, 0);
      return;
    }

    if (command.type === "clear_canvas") {
      pageSceneVersions.set(currentPageId, (pageSceneVersions.get(currentPageId) ?? 0) + 1);
      pageSlots.delete(currentPageId);
      return;
    }

    if (
      command.type !== "laser_pointer" &&
      command.type !== "wait" &&
      command.type !== "clear_annotations" &&
      command.type !== "erase_object" &&
      command.type !== "erase_area"
    ) {
      pageObjectCounts.set(currentPageId, (pageObjectCounts.get(currentPageId) ?? 0) + 1);
    }

    const id = getCommandId(command);
    if (id) {
      if (ids.has(id)) {
        addIssue(
          issues,
          command,
          index,
          "error",
          `id "${id}" 重复。`,
          "每个可引用对象必须使用唯一 id。",
        );
      }
      ids.set(id, index);
    }

    const narration = getCommandNarration(command);
    addNarrationStyleIssues(issues, command, index);
    if (narration && command.type !== "laser_pointer") {
      const prev = script.commands[index - 1];
      const next = script.commands[index + 1];
      const hasNearbyLaser =
        prev?.type === "laser_pointer" ||
        next?.type === "laser_pointer";
      if (!hasNearbyLaser) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          "这条旁白附近没有激光笔指示。",
          "在该命令前后紧邻加入 laser_pointer，最好用 to/path 做顺滑移动。",
        );
      }
    }

    if (command.type === "write_text") {
      addPacingIssues(issues, command, index, command.text);
      addPlainTextFormulaIssue(issues, command, index, command.text, "write_text");
      if (looksLikeMathExpression(command.text) || getAnswerLikeNumber(command.text)) {
        mathLogicItems.push({
          command,
          commandIndex: index,
          expression: command.text,
          label: command.id,
        });
      }
      const width = estimateTextWidth(command.text, command.fontSize);
      const bbox = {
        x: command.x,
        y: command.y - command.fontSize,
        width,
        height: command.fontSize * 1.25,
      };
      textBboxes.push({ sceneId: currentSceneId(), id: command.id, command, commandIndex: index, bbox });
      checkRect(
        issues,
        script,
        command,
        index,
        bbox,
        "文本",
      );
      if (countVisibleChars(command.text) > 28 || width > script.canvas.width * 0.62) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          `长单行文本 "${command.id}" 容易挤占版面并与其他文字重叠。`,
          "长题干、作文原文、结论串联应改用 layout_page + write_paragraph 自动换行；不要用多个大字号 write_text 手搓坐标。",
        );
      }
    }

    if (command.type === "write_text_segments") {
      const text = command.segments.map((segment) => segment.text).join("");
      addPacingIssues(issues, command, index, text);
      if (shouldUseMathCommand(text)) {
        addPlainTextFormulaIssue(issues, command, index, text, "write_text_segments");
      } else {
        for (const segment of command.segments) {
          addPlainTextFormulaIssue(
            issues,
            command,
            index,
            segment.text,
            `write_text_segments 片段 "${segment.id}"`,
          );
        }
      }
      if (looksLikeMathExpression(text) || getAnswerLikeNumber(text)) {
        mathLogicItems.push({
          command,
          commandIndex: index,
          expression: text,
          label: command.id,
        });
      }
      const layout = estimateSegmentLayout(command);
      textSegments.set(command.id, { command, commandIndex: index, layout });
      textBboxes.push({
        sceneId: currentSceneId(),
        id: command.id,
        command,
        commandIndex: index,
        bbox: layout.bbox,
      });
      checkRect(
        issues,
        script,
        command,
        index,
        layout.bbox,
        "分段文本",
      );
      if (countVisibleChars(text) > 28 || layout.bbox.width > script.canvas.width * 0.62) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          `长单行分段文本 "${command.id}" 容易挤占版面并与其他文字重叠。`,
          "如果需要彩色关键词，先用 write_paragraph 承载正文，或拆成多行分段文本；不要把整句都塞进一行 write_text_segments。",
        );
      }
    }

    if (command.type === "layout_page") {
      const slots = buildLayoutSlots(script, command.variant);
      pageSlots.set(currentPageId, new Map(slots.map((slot) => [slot.id, slot])));
      addPacingIssues(issues, command, index, undefined);
      checkRect(
        issues,
        script,
        command,
        index,
        { x: 0, y: 0, width: script.canvas.width, height: script.canvas.height },
        "页面版式",
      );
    }

    if (command.type === "write_paragraph") {
      addPacingIssues(issues, command, index, command.text);
      const slotMap = pageSlots.get(currentPageId);
      const slot = command.slotId ? slotMap?.get(command.slotId) : undefined;
      if (command.slotId && !slot) {
        addIssue(
          issues,
          command,
          index,
          "error",
          `write_paragraph 引用了不存在的 slotId "${command.slotId}"。`,
          "先在当前页执行 layout_page，并使用该版式支持的槽位，例如 content、left、right、before、after、note。",
        );
      }
      const rect =
        slot ??
        (typeof command.x === "number" &&
        typeof command.y === "number" &&
        typeof command.width === "number" &&
        typeof command.height === "number"
          ? { x: command.x, y: command.y, width: command.width, height: command.height }
          : undefined);
      if (rect) {
        const textBbox = estimateParagraphTextBBox(command, rect);
        textBboxes.push({ sceneId: currentSceneId(), id: command.id, command, commandIndex: index, bbox: textBbox });
        checkRect(issues, script, command, index, rect, "段落");
        checkRect(issues, script, command, index, textBbox, "段落文字");
      }
    }

    if (command.type === "revision_compare") {
      addPacingIssues(issues, command, index, `${command.before}${command.after}${command.note ?? ""}`);
      const slotMap = pageSlots.get(currentPageId);
      const slot = command.slotId ? slotMap?.get(command.slotId) : undefined;
      if (command.slotId && !slot) {
        addIssue(
          issues,
          command,
          index,
          "error",
          `revision_compare 引用了不存在的 slotId "${command.slotId}"。`,
          "先在当前页执行 layout_page；作文修改页推荐 variant=revision，再使用 before、after 或 note 槽位。",
        );
      }
      const revisionSlots = ["before", "after", "note"]
        .map((id) => slotMap?.get(id))
        .filter((item): item is LayoutSlot => Boolean(item));
      const bbox =
        command.slotId && revisionSlots.some((item) => item.id === command.slotId) && revisionSlots.length >= 2
          ? unionSlots(revisionSlots)
          : slot ??
            (typeof command.x === "number" &&
            typeof command.y === "number" &&
            typeof command.width === "number" &&
            typeof command.height === "number"
              ? { x: command.x, y: command.y, width: command.width, height: command.height }
              : undefined);
      if (bbox) {
        textBboxes.push({ sceneId: currentSceneId(), id: command.id, command, commandIndex: index, bbox });
        checkRect(issues, script, command, index, bbox, "修改对比");
      }
    }

    if (command.type === "write_math") {
      addPacingIssues(issues, command, index, command.latex);
      mathLogicItems.push({
        command,
        commandIndex: index,
        expression: command.latex,
        label: command.id,
      });
      checkRect(
        issues,
        script,
        command,
        index,
        estimateMathCommandBBox(command),
        "数学公式",
      );
    }

    if (command.type === "write_math_steps") {
      addPacingIssues(issues, command, index, command.steps.join(""));
      command.steps.forEach((step, stepIndex) => {
        mathLogicItems.push({
          command,
          commandIndex: index,
          expression: step,
          label: `${command.id} 第 ${stepIndex + 1} 行`,
        });
      });
      checkRect(
        issues,
        script,
        command,
        index,
        estimateMathCommandBBox(command),
        "公式步骤",
      );
    }

    if (command.type === "draw_rectangle") {
      rectangles.push({ sceneId: currentSceneId(), command, commandIndex: index });
      checkRect(issues, script, command, index, command, "矩形");
      if (command.width < 12 || command.height < 12) {
        addIssue(
          issues,
          command,
          index,
          "suggestion",
          "矩形尺寸很小，不适合作为结构框。",
          "如果只是强调小字，改用 emphasize_text 的 underline/dot/color。",
        );
      }
    }

    if (command.type === "draw_circle") {
      geometryPages.set(currentPageId, (geometryPages.get(currentPageId) ?? 0) + 1);
      checkRect(
        issues,
        script,
        command,
        index,
        {
          x: command.cx - command.radius,
          y: command.cy - command.radius,
          width: command.radius * 2,
          height: command.radius * 2,
        },
        "圆形",
      );
      if (command.radius < 14) {
        addIssue(
          issues,
          command,
          index,
          "suggestion",
          "圆圈半径很小，AI 通常很难精准套住小数字。",
          "优先改成 write_text_segments + emphasize_text。",
        );
      }
    }

    if (command.type === "annotate_circle") {
      if (command.rx < 16 || command.ry < 12) {
        addIssue(
          issues,
          command,
          index,
          "suggestion",
          "圈画目标太小，容易偏。",
          "小数字、短词优先使用 emphasize_text，而不是 annotate_circle。",
        );
      }
    }

    if (command.type === "draw_line" || command.type === "draw_arrow") {
      if (
        pointOutOfCanvas(command.from[0], command.from[1], script) ||
        pointOutOfCanvas(command.to[0], command.to[1], script)
      ) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          "线段或箭头端点超出画布。",
          "把 from/to 调整到 canvas 坐标范围内。",
        );
      }
    }

    if (command.type === "laser_pointer") {
      addPacingIssues(issues, command, index, undefined);
      const points = [
        [command.x, command.y],
        ...(command.to ? [[command.to.x, command.to.y] as [number, number]] : []),
        ...(command.path ?? []),
      ] as [number, number][];
      if (points.some(([x, y]) => pointOutOfCanvas(x, y, script))) {
        addIssue(
          issues,
          command,
          index,
          "error",
          "激光笔坐标超出画布。",
          "所有 x/y/to/path 点都必须位于 canvas 范围内。",
        );
      }
      if (!command.to && !command.path) {
        addIssue(
          issues,
          command,
          index,
          "suggestion",
          "激光笔是固定点。",
          "课堂讲解中优先用 to 或 path，让激光笔顺滑移动到讲解区域。",
        );
      }
    }

    if (command.type === "move_object" && !created.has(command.targetId)) {
      addIssue(
        issues,
        command,
        index,
        "error",
        `move_object 引用了尚未创建的 targetId "${command.targetId}"。`,
        "先创建目标对象，再移动它。",
      );
    }

    if (command.type === "annotate_object" && !created.has(command.targetId)) {
      addIssue(
        issues,
        command,
        index,
        "error",
        `annotate_object 引用了尚未创建的 targetId "${command.targetId}"。`,
        "确认 targetId 拼写，且目标对象在批注前已经绘制。",
      );
    }

    if (command.type === "emphasize_text" && !created.has(command.targetId)) {
      addIssue(
        issues,
        command,
        index,
        "error",
        `emphasize_text 引用了尚未创建的 targetId "${command.targetId}"。`,
        "先用 write_text 或 write_text_segments 创建文本，再强调它。",
      );
    }

    if (command.type === "emphasize_text") {
      const target = textSegments.get(command.targetId);
      if (target && command.segmentId) {
        const segment = target.command.segments.find((item) => item.id === command.segmentId);
        if (segment && command.style === "font_size" && typeof command.fontSize === "number") {
          segment.fontSize = command.fontSize;
          target.layout = estimateSegmentLayout(target.command);
        }
        if (segment && (command.style === "font_size" || command.style === "underline" || command.style === "dot")) {
          const indexInLine = target.layout.segments.findIndex(
            (item) => item.segment.id === command.segmentId,
          );
          const current = target.layout.segments[indexInLine];
          const prev = target.layout.segments[indexInLine - 1];
          const next = target.layout.segments[indexInLine + 1];
          const padding = command.style === "font_size" ? 8 : 3;
          if (current && prev && rectsOverlap(prev.bbox, current.bbox, padding)) {
            addIssue(
              issues,
              command,
              index,
              "warning",
              `emphasize_text 可能让片段 "${command.segmentId}" 与前一个文字片段重叠。`,
              "降低 fontSize、拆行显示，或在该片段前增加空格/调整 x 坐标。",
            );
          }
          if (current && next && rectsOverlap(current.bbox, next.bbox, padding)) {
            addIssue(
              issues,
              command,
              index,
              "warning",
              `emphasize_text 可能让片段 "${command.segmentId}" 与后一个文字片段重叠。`,
              "降低 fontSize、拆行显示，或在该片段后增加空格/调整后续文字位置。",
            );
          }
          if (current) {
            checkRect(issues, script, command, index, current.bbox, "强调文字片段");
          }
        }
      }
    }

    if (
      (command.type === "draw_function" ||
        command.type === "plot_point" ||
        command.type === "draw_coordinate_segment") &&
      !coordinateSystems.has(command.coordinateSystemId)
    ) {
      addIssue(
        issues,
        command,
        index,
        "error",
        `${command.type} 引用了尚未创建的坐标系 "${command.coordinateSystemId}"。`,
        "先使用 draw_coordinate_system 创建坐标系。",
      );
    }

    if (command.type === "draw_coordinate_system") {
      coordinateSystems.add(command.id);
      checkRect(issues, script, command, index, command, "坐标系");
    }

    if (command.type === "draw_point") {
      geometryPages.set(currentPageId, (geometryPages.get(currentPageId) ?? 0) + 1);
      if (pointOutOfCanvas(command.x, command.y, script)) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          "几何点坐标超出画布。",
          "几何点必须放在 canvas 范围内，并给标签留出空白。",
        );
      }
    }

    if (command.type === "draw_segment") {
      geometryPages.set(currentPageId, (geometryPages.get(currentPageId) ?? 0) + 1);
      if (
        pointOutOfCanvas(command.from[0], command.from[1], script) ||
        pointOutOfCanvas(command.to[0], command.to[1], script)
      ) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          "几何线段端点超出画布。",
          "调整 from/to，几何图形四周至少留 32px 空白用于点名和标记。",
        );
      }
    }

    if (command.type === "draw_ray") {
      geometryPages.set(currentPageId, (geometryPages.get(currentPageId) ?? 0) + 1);
      if (
        pointOutOfCanvas(command.from[0], command.from[1], script) ||
        pointOutOfCanvas(command.through[0], command.through[1], script)
      ) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          "射线起点或经过点超出画布。",
          "调整 from/through，射线方向要清楚，不要穿过文字区。",
        );
      }
    }

    if (command.type === "draw_angle") {
      hasGeometryCommands = true;
      geometryPages.set(currentPageId, (geometryPages.get(currentPageId) ?? 0) + 1);
      if (
        pointOutOfCanvas(command.vertex[0], command.vertex[1], script) ||
        pointOutOfCanvas(command.from[0], command.from[1], script) ||
        pointOutOfCanvas(command.to[0], command.to[1], script)
      ) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          "角标的顶点或边上点超出画布。",
          "使用 vertex/from/to 准确定义角，角弧 radius 不要压住点名。",
        );
      }
    }

    if (command.type === "mark_equal_segments" || command.type === "mark_parallel") {
      hasGeometryCommands = true;
      geometryPages.set(currentPageId, (geometryPages.get(currentPageId) ?? 0) + 1);
      for (const segment of command.segments) {
        if (
          pointOutOfCanvas(segment.from[0], segment.from[1], script) ||
          pointOutOfCanvas(segment.to[0], segment.to[1], script)
        ) {
          addIssue(
            issues,
            command,
            index,
            "warning",
            `${command.type} 的某条线段端点超出画布。`,
            "几何标记应贴在线段中部，端点必须在 canvas 范围内。",
          );
          break;
        }
      }
    }

    if (command.type === "mark_perpendicular") {
      hasGeometryCommands = true;
      geometryPages.set(currentPageId, (geometryPages.get(currentPageId) ?? 0) + 1);
      if (
        pointOutOfCanvas(command.vertex[0], command.vertex[1], script) ||
        pointOutOfCanvas(command.point1[0], command.point1[1], script) ||
        pointOutOfCanvas(command.point2[0], command.point2[1], script)
      ) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          "垂直标记的点位超出画布。",
          "vertex 是直角顶点，point1/point2 分别在两条垂线方向上。",
        );
      }
    }

    if (command.type === "highlight_polygon") {
      hasGeometryCommands = true;
      geometryPages.set(currentPageId, (geometryPages.get(currentPageId) ?? 0) + 1);
      if (command.points.some(([x, y]) => pointOutOfCanvas(x, y, script))) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          "高亮多边形有顶点超出画布。",
          "highlight_polygon 应用于三角形、四边形或局部区域，高亮不要盖住证明文字。",
        );
      }
    }

    if (command.type === "construct_geometry") {
      hasGeometryCommands = true;
      geometryPages.set(currentPageId, (geometryPages.get(currentPageId) ?? 0) + 4);
      const knownPoints = new Set(command.points.map((point) => point.id));
      const checkPointIds = (idsToCheck: string[], label: string) => {
        const missing = idsToCheck.filter((pointId) => !knownPoints.has(pointId));
        if (missing.length > 0) {
          addIssue(
            issues,
            command,
            index,
            "error",
            `construct_geometry 的 ${label} 引用了尚未定义的点 ${pointIdListText(missing)}。`,
            "把基础点写进 points，或把会生成新点的 perpendicular_projection / intersection 放在引用它之前。",
          );
        }
      };

      if (command.points.some((point) => pointOutOfCanvas(point.x, point.y, script))) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          "construct_geometry 中有基础点超出画布。",
          "图片识别后的几何重构应先把 A/B/C/D/O 等可靠点放进 canvas 范围内，再让构造层生成垂足和交点。",
        );
      }

      if (command.points.length > 10) {
        addIssue(
          issues,
          command,
          index,
          "suggestion",
          "construct_geometry 的基础点较多，可能是模型在手动猜太多构造点。",
          "只把识别可靠的主点写入 points；垂足、交点、外接圆圆心等交给构造层计算。",
        );
      }

      if (command.constructions.length === 0) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          "construct_geometry 没有任何 constructions。",
          "至少加入 segment、circumcircle、perpendicular_projection 或 intersection。",
        );
      }

      command.constructions.forEach((construction) => {
        if (construction.kind === "segment") {
          checkPointIds([construction.from, construction.to], "segment");
        }
        if (construction.kind === "circumcircle") {
          checkPointIds(construction.through, "circumcircle");
        }
        if (construction.kind === "perpendicular_projection") {
          checkPointIds([construction.point, ...construction.line], "perpendicular_projection");
          knownPoints.add(construction.footId);
        }
        if (construction.kind === "intersection") {
          checkPointIds(construction.lines.flat(), "intersection");
          knownPoints.add(construction.id);
        }
        if (construction.kind === "highlight_polygon") {
          checkPointIds(construction.points, "highlight_polygon");
        }
      });
    }

    if (id && command.type !== "laser_pointer") {
      created.add(id);
    }
  });

  if (!script.pages?.length && script.commands.length > 30) {
    addIssue(
      issues,
      undefined,
      undefined,
      "warning",
      "脚本命令较多但没有使用多页白板，单页内容可能过满。",
      "将讲解拆成 pages，并用 switch_page 分页：读题一页、找规律一页、计算一页、总结一页。",
    );
  }

  for (const [pageId, count] of Array.from(pageObjectCounts.entries())) {
    if (count > 14) {
      addIssue(
        issues,
        undefined,
        undefined,
        "warning",
        `白板页 "${pageId}" 包含 ${count} 个主要对象，可能过满。`,
        "一页只讲一个小问题。优先删除重复小图、装饰性框线、过多标签和多余磁场符号；推导页不要复制完整物理图，只保留公式或 3–6 个元素的极简参照。仍然拥挤时再用 switch_page 拆页。",
      );
    }
  }

  if (hasGeometryCommands && script.pages && script.pages.length >= 3) {
    const pageIds = script.pages.map((page) => page.id);
    const pagesWithoutGeometry = pageIds.filter((pageId) => (geometryPages.get(pageId) ?? 0) < 3);
    if (pagesWithoutGeometry.length > 0) {
      addIssue(
        issues,
        undefined,
        undefined,
        "warning",
        `多页几何讲解中，${pagesWithoutGeometry.length} 个页面缺少稳定几何参照图。`,
        `几何题翻页后仍要保留关键图形。请在这些页面补一个左侧或右上角的简化几何图，并保持主点相对位置一致：${pagesWithoutGeometry.join("、")}。`,
      );
    }
  }

  const textOverlapPairs = new Set<string>();
  for (let i = 0; i < textBboxes.length; i++) {
    for (let j = i + 1; j < textBboxes.length; j++) {
      const a = textBboxes[i];
      const b = textBboxes[j];
      if (a.sceneId !== b.sceneId || a.id === b.id) continue;
      const minArea = Math.min(rectArea(a.bbox), rectArea(b.bbox));
      if (minArea <= 0) continue;
      const hardOverlap = rectOverlapArea(a.bbox, b.bbox) / minArea;
      const tooClose = rectsOverlap(a.bbox, b.bbox, 8);
      if (!tooClose || hardOverlap < 0.02) continue;
      const pairKey = [a.id, b.id].sort().join("::");
      if (textOverlapPairs.has(pairKey)) continue;
      textOverlapPairs.add(pairKey);
      addIssue(
        issues,
        b.command,
        b.commandIndex,
        hardOverlap > 0.12 ? "error" : "warning",
        `文本 "${a.id}" 与 "${b.id}" 发生重叠或间距过近。`,
        "重新规划版面：一页先用 layout_page 建 slot；长正文/题干/作文改用 write_paragraph；左右对比改用 revision_compare；普通文字行之间至少留 1.45 倍字号的行距。",
      );
    }
  }

  for (const { sceneId, command: rect, commandIndex } of rectangles) {
    const rectBox = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
    const nearbyTexts = textBboxes.filter(
      (text) => text.sceneId === sceneId && rectsOverlap(rectBox, text.bbox, 0),
    );
    for (const text of nearbyTexts) {
      const left = text.bbox.x - rect.x;
      const right = rect.x + rect.width - (text.bbox.x + text.bbox.width);
      const top = text.bbox.y - rect.y;
      const bottom = rect.y + rect.height - (text.bbox.y + text.bbox.height);
      const minHorizontal = 24;
      const minVertical = 18;
      if (left < minHorizontal || right < minHorizontal || top < minVertical || bottom < minVertical) {
        addIssue(
          issues,
          rect,
          commandIndex,
          "warning",
          `矩形 "${rect.id}" 与文本 "${text.id}" 的内边距不足，可能出现文字压框或贴边。`,
          "扩大矩形框，或把文字向内移动；左右至少留 24px，上下至少留 18px。若这个框没有必要，直接删除框。",
        );
      }
    }
  }

  addMathLogicChecks(issues, mathLogicItems);

  return buildReport(issues);
}

export function preflightScriptText(scriptText: string): {
  report: ScriptPreflightReport;
  script?: WhiteboardScript;
} {
  let parsed: unknown;
  try {
    parsed = parseJsonObjectText(scriptText);
  } catch (error) {
    return {
      report: buildReport([
        {
          severity: "error",
          message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
          suggestion: "请输出纯 JSON，不要包含 Markdown 代码围栏或解释文字。",
        },
      ]),
    };
  }

  const validation = validateScript(parsed);
  if (!validation.ok) {
    return {
      report: buildReport([
        {
          severity: "error",
          message: validation.error,
          suggestion: "请按 AI_GUIDE.md 和 commandTypes.ts 中的命令 schema 修正字段。",
        },
      ]),
    };
  }

  return {
    script: validation.script,
    report: analyzeValidScript(validation.script),
  };
}

function extractTextFromPerplexityResponse(body: any) {
  if (typeof body?.output_text === "string" && body.output_text.trim()) {
    return body.output_text.trim();
  }
  const parts: string[] = [];
  for (const item of body?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? text;
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("AI 没有返回 JSON 对象。");
  }
  return parseJsonObjectText(source.slice(first, last + 1));
}

function parseJsonObjectText(text: string) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const repaired = repairCommonAiJsonEscapes(text);
    if (repaired !== text) {
      try {
        return JSON.parse(repaired);
      } catch {
        // Fall through to the original error so the user sees the real location.
      }
    }
    throw error;
  }
}

function repairCommonAiJsonEscapes(text: string) {
  return text
    // AI often writes LaTeX in JSON as "\div" / "\sqrt" instead of "\\div".
    .replace(/\\(?!["\\/bfnrtu])/g, "\\\\")
    // If an outer JSON string decoded "\frac" as a form-feed escape, restore it.
    .replace(/\f(?=rac|box|ill|ont|oreach)/g, "\\\\f");
}

function stringifyScript(script: WhiteboardScript) {
  return JSON.stringify(script, null, 2);
}

function normalizeGeneratedScript(script: WhiteboardScript): WhiteboardScript {
  const normalized = {
    ...script,
    commands: script.commands
      .filter((command) => command.type !== "wait")
      .map((command) => {
        if (command.type === "write_text") {
          const text = normalizeLatexText(command.text);
          if (canAutoConvertTextToMath(text)) {
            return {
              type: "write_math",
              id: command.id,
              latex: text,
              x: command.x,
              y: Math.max(0, command.y - command.fontSize),
              fontSize: command.fontSize,
              color: command.color,
              displayMode: false,
              duration: command.duration,
              narration: command.narration,
            } satisfies Extract<WhiteboardCommand, { type: "write_math" }>;
          }
          if (text !== command.text) {
            return {
              ...command,
              text,
            };
          }
        }

        if (command.type === "write_math") {
          const latex = normalizeLatexText(command.latex);
          if (latex !== command.latex) return { ...command, latex };
        }

        if (command.type === "write_math_steps") {
          const steps = command.steps.map(normalizeLatexText);
          if (steps.some((step, index) => step !== command.steps[index])) {
            return { ...command, steps };
          }
        }

        return command;
      }),
  };
  return fitMathCommandsToCanvas(uniquifyRepeatedLayoutPages(normalized));
}

function uniquifyRepeatedLayoutPages(script: WhiteboardScript): WhiteboardScript {
  const pageById = new Map((script.pages ?? []).map((page) => [page.id, page]));
  const pageUseCounts = new Map<string, number>();
  const extraPages: NonNullable<WhiteboardScript["pages"]> = [];
  const commands = script.commands.map((command, index) => {
    if (command.type !== "switch_page") return command;
    const nextCommand = script.commands
      .slice(index + 1)
      .find((candidate) => candidate.type !== "laser_pointer" && candidate.type !== "clear_annotations");
    const count = pageUseCounts.get(command.pageId) ?? 0;
    pageUseCounts.set(command.pageId, count + 1);
    if (count === 0 || nextCommand?.type !== "layout_page") return command;

    const nextId = `${command.pageId}_${count + 1}`;
    if (!pageById.has(nextId)) {
      const basePage = pageById.get(command.pageId);
      const page = {
        id: nextId,
        title: command.title ?? basePage?.title ?? nextId,
      };
      pageById.set(nextId, page);
      extraPages.push(page);
    }
    return {
      ...command,
      pageId: nextId,
    };
  });

  if (extraPages.length === 0) return script;
  return {
    ...script,
    pages: [...(script.pages ?? []), ...extraPages],
    commands,
  };
}

function fitMathCommandsToCanvas(script: WhiteboardScript): WhiteboardScript {
  const margin = 28;
  const maxWidth = Math.max(80, script.canvas.width - margin * 2);
  const maxHeight = Math.max(80, script.canvas.height - margin * 2);
  const commands = script.commands.map((command) => {
    if (command.type !== "write_math" && command.type !== "write_math_steps") return command;

    let next: Extract<WhiteboardCommand, { type: "write_math" | "write_math_steps" }> = { ...command };
    let bbox = estimateMathCommandBBox(next);
    if (bbox.width > maxWidth || bbox.height > maxHeight) {
      const widthScale = maxWidth / Math.max(1, bbox.width);
      const heightScale = maxHeight / Math.max(1, bbox.height);
      const scale = Math.max(0.62, Math.min(1, widthScale, heightScale));
      const fontSize = Math.max(20, Math.floor(next.fontSize * scale));
      next =
        next.type === "write_math_steps"
          ? {
              ...next,
              fontSize,
              lineGap: Math.max(fontSize * 1.35, Math.min(next.lineGap ?? fontSize * 1.45, fontSize * 1.55)),
            }
          : { ...next, fontSize };
      bbox = estimateMathCommandBBox(next);
    }

    const maxX = script.canvas.width - margin - bbox.width;
    const maxY = script.canvas.height - margin - bbox.height;
    const x = Math.max(margin, Math.min(next.x, maxX));
    const y = Math.max(margin, Math.min(next.y, maxY));
    if (x === next.x && y === next.y) return next;
    return { ...next, x, y };
  });
  return { ...script, commands };
}

function removeWaitCommands(script: WhiteboardScript): WhiteboardScript {
  return {
    ...script,
    commands: script.commands.filter((command) => command.type !== "wait"),
  };
}

function getMaxRepairRounds() {
  const value = Number.parseInt(process.env.PERPLEXITY_MAX_REPAIR_ROUNDS ?? "", 10);
  if (!Number.isFinite(value)) return DEFAULT_MAX_ROUNDS;
  return Math.max(1, Math.min(value, 5));
}

async function readGuideExcerpt() {
  const guidePath = path.resolve(process.cwd(), "AI_GUIDE.md");
  const guide = await fs.readFile(guidePath, "utf-8").catch(() => "");
  if (!guide) return "";
  const prioritySections = [
    "## 0.",
    "## 1. 工具定位",
    "## 2. 顶层 Schema",
    "## 3. 命令类型",
    "## 5.",
    "## 6.",
    "## 7.",
  ];
  const lines = guide.split("\n");
  const picked: string[] = [];
  let include = false;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      include = prioritySections.some((title) => line.startsWith(title));
    }
    if (include) picked.push(line);
  }
  return picked.join("\n").slice(0, 26000);
}

async function callPerplexityJson(params: {
  instructions: string;
  input: string | Array<{
    role: "user" | "system" | "assistant";
    content: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string }
    >;
  }>;
  model?: string;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  schemaName?: string;
  schema?: Record<string, unknown>;
  retryInvalidJson?: boolean;
}): Promise<{ model: string; json: unknown }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("Perplexity API 未配置。请设置 PERPLEXITY_API_KEY。"), {
      status: 501,
    });
  }

  const model =
    params.model ||
    process.env.PERPLEXITY_MODEL ||
    DEFAULT_REPAIR_MODEL;
  const response = await fetch(PERPLEXITY_AGENT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: params.input,
      instructions: params.instructions,
      language_preference: "zh",
      max_output_tokens: params.maxOutputTokens ?? 12000,
      max_steps: 1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: params.schemaName ?? "ai_whiteboard_script_text",
          schema: params.schema ?? {
            type: "object",
            properties: {
              explanation: { type: "string" },
              scriptText: { type: "string" },
            },
            required: ["explanation", "scriptText"],
            additionalProperties: false,
          },
        },
      },
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Perplexity Agent API 调用失败：${response.status} ${text}`);
  }

  const body = await response.json();
  const text = extractTextFromPerplexityResponse(body);
  if (!text) {
    throw new Error("Perplexity Agent API 没有返回可用文本。");
  }
  let json: unknown;
  try {
    json = extractJsonObject(text);
  } catch (error) {
    if (params.retryInvalidJson === false) throw error;
    console.warn(
      `[ai-script] model returned invalid JSON, retrying once: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    const retry: { model: string; json: unknown } = await callPerplexityJson({
      ...params,
      retryInvalidJson: false,
      input: `上一轮模型输出不是合法 JSON，解析错误为：${
        error instanceof Error ? error.message : String(error)
      }

请重新完成同一个任务，只输出符合 response schema 的 JSON，不要 Markdown，不要解释文字。注意：
- scriptLines 必须是按行拆分的脚本文本数组，不要输出一个超长字符串。
- 每个字符串必须闭合，不能在字符串中直接换行。
- knowledgeSummary 必须保留。

原始任务：
${typeof params.input === "string" ? params.input : JSON.stringify(params.input).slice(0, 20000)}

上一轮无效输出片段：
${text.slice(0, 12000)}`,
    });
    return retry;
  }
  return {
    model: typeof body?.model === "string" ? body.model : model,
    json,
  };
}

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function normalizeKnowledgeSummary(payload: unknown): KnowledgeSummary | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const source = payload as Partial<KnowledgeSummary>;
  const normalizeText = (value: unknown, fallback = "", limit = 120) =>
    typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ").slice(0, limit) : fallback;
  const normalizeItems = (value: unknown, limit: number, explanationLimit = 90): KnowledgeSummaryItem[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as Partial<KnowledgeSummaryItem>;
        const name = normalizeText(record.name, "", 36);
        const explanation = normalizeText(record.explanation, "", explanationLimit);
        if (!name || !explanation) return null;
        return { name, explanation };
      })
      .filter((item): item is KnowledgeSummaryItem => Boolean(item))
      .slice(0, limit);
  };

  const title = normalizeText(source.title, "这道题用到的知识点", 48);
  const overview = normalizeText(source.overview, "核心公式、适用条件和易错点速查。", 90);
  const followUpPrompt = normalizeText(source.followUpPrompt, "", 900);
  const baseFollowUpPrompt =
    followUpPrompt ||
    `请围绕“${title}”生成一份专题白板讲解，重点讲清公式、适用条件、解题步骤和易错点。`;
  return {
    title,
    overview,
    concepts: normalizeItems(source.concepts, 4),
    formulas: normalizeItems(source.formulas, 5),
    principles: normalizeItems(source.principles, 4),
    background: normalizeItems(source.background, 2, 80),
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
}

function normalizeAiScriptPayload(payload: any): {
  script: WhiteboardScript;
  scriptText: string;
  explanation: string;
  knowledgeSummary?: KnowledgeSummary;
} {
  const knowledgeSummary = normalizeKnowledgeSummary(payload?.knowledgeSummary);
  if (typeof payload?.scriptText === "string") {
    const parsed = extractJsonObject(payload.scriptText);
    const validation = validateScript(parsed);
    if (!validation.ok) {
      throw new Error(`AI 返回的脚本文本不合法：${validation.error}`);
    }
    const script = removeWaitCommands(validation.script);
    return {
      script,
      scriptText: stringifyScript(script),
      explanation:
        typeof payload?.explanation === "string"
          ? payload.explanation
          : typeof payload?.summary === "string"
            ? payload.summary
            : "已生成白板脚本。",
      knowledgeSummary,
    };
  }

  const candidate = payload?.script ?? payload?.whiteboardScript ?? payload;
  const validation = validateScript(candidate);
  if (!validation.ok) {
    throw new Error(`AI 返回的脚本不合法：${validation.error}`);
  }
  const script = removeWaitCommands(validation.script);
  return {
    script,
    scriptText: stringifyScript(script),
    explanation:
      typeof payload?.explanation === "string"
        ? payload.explanation
        : typeof payload?.summary === "string"
          ? payload.summary
          : "已生成白板脚本。",
    knowledgeSummary,
  };
}

function normalizeAiScriptPayloadDraft(payload: any): {
  script?: WhiteboardScript;
  scriptText: string;
  explanation: string;
  knowledgeSummary?: KnowledgeSummary;
} {
  const explanation =
    typeof payload?.explanation === "string"
      ? payload.explanation
      : typeof payload?.summary === "string"
        ? payload.summary
        : "已生成白板脚本。";

  if (Array.isArray(payload?.scriptLines)) {
    const scriptText = payload.scriptLines.map((line: unknown) => String(line)).join("\n");
    try {
      return normalizeAiScriptPayload({
        ...payload,
        scriptText,
      });
    } catch {
      return {
        scriptText,
        explanation,
        knowledgeSummary: normalizeKnowledgeSummary(payload?.knowledgeSummary),
      };
    }
  }

  if (typeof payload?.scriptText === "string") {
    try {
      return normalizeAiScriptPayload(payload);
    } catch {
      return {
        scriptText: payload.scriptText,
        explanation,
        knowledgeSummary: normalizeKnowledgeSummary(payload?.knowledgeSummary),
      };
    }
  }

  const candidate = payload?.script ?? payload?.whiteboardScript ?? payload;
  try {
    return normalizeAiScriptPayload(payload);
  } catch {
    return {
      scriptText: stringifyUnknownScriptCandidate(candidate),
      explanation,
      knowledgeSummary: normalizeKnowledgeSummary(payload?.knowledgeSummary),
    };
  }
}

function stringifyUnknownScriptCandidate(candidate: unknown) {
  if (typeof candidate === "string") return candidate;
  try {
    return JSON.stringify(candidate, null, 2);
  } catch {
    return String(candidate);
  }
}

function reportForPrompt(report: ScriptPreflightReport) {
  return JSON.stringify(
    {
      summary: report.summary,
      errors: report.errors,
      warnings: report.warnings,
      suggestions: report.suggestions,
      issues: report.issues.slice(0, 40),
    },
    null,
    2,
  );
}

function baseInstructions(guideExcerpt: string) {
  return `你是 AI Whiteboard 的白板脚本生成与修复模型。

必须遵守：
1. 只输出 JSON 对象，不要 Markdown，不要代码围栏。
2. 输出格式必须严格符合本次 response schema。生成讲解脚本时至少包含 explanation、scriptLines，并同时整理 knowledgeSummary；不要输出 schema 外字段。
3. scriptLines 必须是 AI Whiteboard 播放器可直接运行的完整 JSON 脚本文本按行拆分后的数组；后端会用换行重新拼成 scriptText。不要把整份脚本塞进一个超长字符串，也不要输出 Markdown。
4. 每条有 narration 的教学动作，附近必须有 laser_pointer 指示。优先使用 to 或 path 做顺滑移动。
5. 小数字、短词、变量的强调优先用 write_text_segments + emphasize_text，不要用大圈硬套小目标。
6. 初中数学优先使用 write_math、write_math_steps、draw_coordinate_system、draw_function、plot_point、draw_coordinate_segment 等结构化命令。
7. 禁止把 LaTeX 公式写进 write_text。任何包含 \\frac、\\sqrt、\\circ、\\Rightarrow、\\therefore、^、_、分数、根号、上下标、箭头的数学表达，都必须用 write_math 或 write_math_steps；普通中文解释和公式要拆成相邻的 write_text + write_math。
8. 不要使用预生成板书图片或遮罩揭示路线。
9. 画面要留白，严禁文字互相重叠、文字压住标题、批注遮挡正文、图形/框/箭头压住文字。长题干、作文原文、修改后原文、点评长句优先使用 layout_page + write_paragraph 或 revision_compare，不要用多个大字号 write_text 手搓坐标。
10. 不要默认给文字和公式套矩形框；只有题目区、结论区、流程节点、真正需要分组的区域才使用 draw_rectangle。
11. 圈画要谨慎；不要用 annotate_circle 圈小数字、短词或已经很明显的内容。优化脚本时应删除无意义框线和圈画，或改成 emphasize_text。
12. narration 要像亲和、有耐心、会打比方的老师直接面对学生本人讲课。不要机械播报；允许适度重复、适度啰嗦、接地气类比和轻微幽默。关键概念可以换说法重复强调，帮助学生慢慢听懂。
12a. narration 不能描述白板操作过程，不能说“我新建一页”“我切到下一页”“我擦掉”“我画/写/圈/框/移动/标出”。白板动作会自己呈现，旁白只讲知识点、思路和学生该注意的内容。
12b. narration 不能面向第三方，不能说“让孩子看”“给学生展示”“家长可以……”。要直接对正在听课的学生说“你看这里”“这一步要抓住……”“先想一想……”。
13. 完整讲题必须优先使用多页白板：顶层写 pages，并用 switch_page 分阶段切换。不要把读题、分析、计算、总结硬塞进一页。一页只讲一个小问题；如果一页主要对象超过 12–14 个，要拆到下一页。
14. 数学推导必须逻辑完整：任何公式行都不能以等号结尾；最终答案出现前，推导链必须显式算到该答案。例如不要写 "M - 2 =" 或 "M = 30 + 2 ="，必须写成 "M - 2 = 30" 和 "M = 30 + 2 = 32"。
15. 几何证明必须优先使用几何专用命令：draw_point、draw_segment、draw_ray、draw_angle、mark_equal_segments、mark_parallel、mark_perpendicular、highlight_polygon。不要用普通圈画猜点位；辅助线、角标、等长、平行、垂直和全等区域都要用结构化几何命令表达。
16. 几何题要先规划版面：多页讲解时，每一页都必须保留关键几何图作为参照，通常固定在左侧或右上角；推导、条件和结论写在另一侧。不要让证明页变成纯文字或纯公式页。
17. 几何图跨页要稳定：A/B/C/O/H/M 等主点相对位置基本一致；后续页只叠加本页关注的辅助线、角标、等长/垂直标记或高亮区域。
18. 复杂几何构造或图片题重构优先使用 construct_geometry，让 JSXGraph 辅助构造层计算垂足、交点和外接圆，不要手动猜 E/F/H 等构造点坐标；constructions 必须按依赖顺序书写。
19. 讲解题目之前，必须先安排“读题”阶段：第一段有效 narration 必须用旁白朗读原题，或在原题过长/识别不完整时先复述问题。白板上同步展示题目关键词或题干摘要，然后再进入分析和解法。
20. 读题之后，必须安排“题干分析”阶段：帮学生拆出已知条件、要求什么、图示表达了什么、应该抓哪个物理/数学关系。
21. 如果用户输入来自题目图片，且包含图示、表格、实验装置、几何图或函数图，不能只讲文字题干；必须在白板上重构图示的关键结构。物理题优先用矩形、线段、箭头、标签重构装置/过程/受力/光路/电路等；几何题优先用几何专用命令或 construct_geometry；函数题优先用坐标系和函数图像。
22. 不要生成 wait 命令，不要安排“等待用户点击下一步”的互动等待点。播放器已经有暂停/继续功能，学生需要思考时会自行暂停。
23. 理科题必须按“读题抓条件 → 图示关系 → 公式推导 → 答案总结”组织。半衰期题画时间轴/倍半衰期示意；弹簧/滑块题画两个木块和弹簧、位移方向；带电粒子进磁场题画磁场符号、速度方向、圆轨迹和半径。
24. 物理公式、变量下标、分式、平方、单位换算和推导步骤必须用 write_math 或 write_math_steps。不要把 m_1、m_2、\\frac{1}{2}、F=kx、qvB=mv^2/R、48/24=2 这类内容塞进 write_text 或 write_text_segments。
25. 在 layout_page 的 slot 内不要先放普通标题再紧接 write_paragraph(slotId)。slot 段落会占用整块槽位，容易和标题重叠；标题应使用 layout_page.title/subtitle，或段落使用显式 x/y/width/height 并从标题下方开始。
26. 短物理计算题通常控制在 4–5 页、45–80 条命令。完整图示只在图示关系页出现；推导页不要重复复制整套小图，必要时只放 3–6 个元素的极简参照。磁场题不要铺满很多 ×/· 磁场符号，3–6 个足够。
27. 物理过程的分段关系优先用彩色线段、箭头、段名标签和公式标签表达；不要用 draw_brace 横跨大半个图去括运动轨迹。大括号只适合短范围分组，跨度过长会抢画面重点。
28. 旁白避免“写出来”“写成”“画出”“下一步要做的是写……”这类操作感说法；开场可以直接朗读原题或复述问题，但不要说“我来念一遍”这类描述动作的话。后续改成“关系是……”“可以得到……”“关键在于……”“把两个力相等理解成……”。
29. knowledgeSummary 是给学生随时点开的速查卡，不是另一段讲解稿。只写干货：概念名、公式、适用条件、关键原理、易错点。每条 explanation 控制在 15–40 个中文字符，像笔记一样短；不要写“这里整理了”“本节课主要”“你会发现”这类套话。background 只放真正必要的前置知识，没有就空数组。
30. 使用 layout_page 的 slot 后，slot 内只放一个主内容块最稳：长内容用 write_paragraph(slotId)，公式用显式 x/y 放在段落下方。不要在同一 slot 顶部再叠加 write_text 标题；需要小标题时改用 layout_page.subtitle，或给 write_paragraph 使用显式 x/y/width/height 并把 y 往下移至少 70px。
31. 每个新的版式阶段必须使用唯一 pageId。不要对同一个 pageId 再次 switch_page 后重新 layout_page；这会把旧页面内容恢复出来并与新内容重叠。需要新页面就创建新的 pageId，例如 formulas_2、summary_2。

以下是项目 AI_GUIDE 摘要：
${guideExcerpt}`;
}

function explanationModeInstructions(mode: AiExplanationMode) {
  if (mode === "concise") {
    return `讲解模式：简洁讲解。

必须遵守：
1. 用户大概率已经读过题、思考过一段时间；不要完整从头铺开讲。
2. 开场第一段有效 narration 仍然必须先用旁白朗读原题或复述问题，控制在一句话内；随后只给一个小提示，围绕最根本、最容易卡住的关键点讲清楚即可。
3. 总页数控制在 1–2 页，命令数量尽量控制在 8–18 条。
4. narration 总量要短，通常 1–2 句核心提示即可；不要做完整推导和长篇总结。
5. 即使简洁，也必须配合白板动作：至少写出关键条件/关键关系，用激光笔指向卡点；带图题至少画出决定解题的关键图示局部或关系。
6. 如果题目来自图片，不必完整重画所有细节，只重构最影响判断的图形关系。`;
  }

  return `讲解模式：详细讲解。

必须遵守：
1. 采用完整课堂讲解：先读题，再分析题干与已知条件，然后逐步讲解解法，最后总结答案。
1a. 第一段有效 narration 必须先用旁白朗读原题，或在原题很长时复述问题；不要直接跳到公式、答案或解题技巧。
2. 带图题要重构关键图示，并围绕图示进行讲解。
3. 可以使用多页白板，把读题、分析、图示、推导、答案分开呈现。`;
}

export async function generateAiScript(
  prompt: string,
  mode: AiExplanationMode = "detailed",
  signal?: AbortSignal,
): Promise<AiScriptResult> {
  const guideExcerpt = await readGuideExcerpt();
  const rounds: AiScriptResult["rounds"] = [];
  const maxRounds = getMaxRepairRounds();
  const generateModel =
    process.env.PERPLEXITY_GENERATE_MODEL ||
    process.env.PERPLEXITY_MODEL ||
    DEFAULT_GENERATE_MODEL;
  const repairModel =
    process.env.PERPLEXITY_REPAIR_MODEL ||
    DEFAULT_REPAIR_MODEL;

  const firstStartedAt = performance.now();
  const first = await callPerplexityJson({
    model: generateModel,
    maxOutputTokens: 26000,
    schemaName: "ai_whiteboard_script_with_knowledge",
    schema: aiScriptResultSchema,
    instructions: `${baseInstructions(guideExcerpt)}

${explanationModeInstructions(mode)}`,
    input: `请根据用户需求生成一份完整 AI Whiteboard 白板讲解脚本。

用户需求：
${prompt}

请同时给出 explanation，说明这份脚本如何讲解，以及为什么这样安排。
请同时给出 knowledgeSummary：它是课中速查卡，只总结干货。overview 不超过 40 个中文字符；每条 explanation 不超过 40 个中文字符；concepts/formulas/principles/background 合计尽量 6–10 条。不要写背景故事、课堂话术或泛泛解释。followUpPrompt 要能直接用于再生成一节专题讲解课。
注意：scriptLines 是完整 JSON 脚本文本按行拆成的字符串数组。每一项放一行 JSON 文本，后端会 join("\\n")；不要把完整脚本放进单个超长字符串。`,
    signal,
  });
  const firstDurationMs = elapsedMs(firstStartedAt);

  let current = normalizeAiScriptPayloadDraft(first.json);
  let check = preflightScriptText(current.scriptText);
  rounds.push({
    round: 1,
    action: "generate",
    model: first.model,
    durationMs: firstDurationMs,
    report: check.report,
  });
  console.log(
    `[ai-script] generate round 1 ${firstDurationMs}ms: ${check.report.summary}`,
  );
  if (check.report.errors > 0) {
    console.warn(`[ai-script] generate round 1 errors: ${reportForPrompt(check.report)}`);
  }

  for (let round = 2; round <= maxRounds && needsAiRepair(check.report); round++) {
    const repairStartedAt = performance.now();
    const repaired = await callPerplexityJson({
      model: repairModel,
      maxOutputTokens: 26000,
      schemaName: "ai_whiteboard_script_with_knowledge",
      schema: aiScriptResultSchema,
      instructions: `${baseInstructions(guideExcerpt)}

${explanationModeInstructions(mode)}`,
      input: `请修复下面这份 AI Whiteboard 脚本。保持原教学意图，但必须解决预检报告中的错误和风险，特别是板书节奏过快、长文本 duration 太短、缺少阅读停顿等播放体验问题。

预检报告：
${reportForPrompt(check.report)}

当前脚本：
${current.scriptText}

请输出修复后的完整 JSON，包含 explanation、scriptLines、knowledgeSummary，其中 scriptLines 是完整 JSON 脚本文本按行拆成的字符串数组。knowledgeSummary 要和修复后的脚本内容保持一致。`,
      signal,
    });
    const repairDurationMs = elapsedMs(repairStartedAt);
    current = normalizeAiScriptPayloadDraft(repaired.json);
    check = preflightScriptText(current.scriptText);
    rounds.push({
      round,
      action: "repair",
      model: repaired.model,
      durationMs: repairDurationMs,
      report: check.report,
    });
    console.log(
      `[ai-script] repair round ${round} ${repairDurationMs}ms: ${check.report.summary}`,
    );
    if (check.report.errors > 0) {
      console.warn(`[ai-script] repair round ${round} errors: ${reportForPrompt(check.report)}`);
    }
  }

  if (!current.script) {
    console.warn(`[ai-script] final failed report: ${reportForPrompt(check.report)}`);
    const firstIssue = check.report.issues[0];
    throw new Error(
      `AI 修复后仍未得到可用脚本：${check.report.summary}${
        firstIssue ? ` 首个问题：${firstIssue.message}` : ""
      }`,
    );
  }

  const finalScript = normalizeGeneratedScript(current.script);
  const finalScriptText = stringifyScript(finalScript);
  const finalCheck = preflightScriptText(finalScriptText);

  return {
    script: finalScript,
    scriptText: finalScriptText,
    explanation: current.explanation,
    knowledgeSummary: current.knowledgeSummary,
    report: finalCheck.report,
    rounds,
  };
}

export async function recognizeProblemFromImage(
  imageDataUrl: string,
  userHint?: string,
  signal?: AbortSignal,
): Promise<ImageProblemRecognitionResult> {
  const model =
    process.env.PERPLEXITY_VISION_MODEL ||
    process.env.PERPLEXITY_MODEL ||
    DEFAULT_VISION_MODEL;
  const recognized = await callPerplexityJson({
    model,
    signal,
    maxOutputTokens: 4000,
    schemaName: "ai_whiteboard_problem_ocr",
    schema: {
      type: "object",
      properties: {
        problemText: { type: "string" },
        diagramDescription: { type: "string" },
        subject: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        notes: { type: "string" },
      },
      required: ["problemText", "diagramDescription", "subject", "confidence", "notes"],
      additionalProperties: false,
    },
    instructions: `你是面向 AI Whiteboard 的题目图片 OCR 与理解助手。

任务：
1. 从图片中提取完整题目文本，包括题干、选项、已知条件、图中文字、坐标、角标、表格内容、单位等。
2. 必须单独提取图片/图示部分，写入 diagramDescription。图片部分包括几何图、函数图、物理装置图、受力图、光路图、电路图、统计图、表格、实验示意图、流程图等。
3. diagramDescription 要足够支持后续白板重构：描述图中对象、位置关系、箭头方向、标注文字、数据、角度、坐标、连接关系、实验器材、状态变化等。
4. 不要解题，不要生成白板脚本，只做题目识别与结构化转写。
5. 如果局部看不清，用“[看不清]”标出来，不要编造。
6. 输出 JSON：{"problemText":"...","diagramDescription":"...","subject":"...","confidence":"high|medium|low","notes":"..."}。所有字段都必须出现；没有可写内容时用空字符串。`,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `请识别这张题目图片，整理成后续可以直接用于生成讲解脚本的题目文本。${
              userHint?.trim() ? `\n用户补充说明：${userHint.trim()}` : ""
            }`,
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
          },
        ],
      },
    ],
  });

  const payload = recognized.json as Partial<ImageProblemRecognitionResult>;
  const problemText = typeof payload.problemText === "string" ? payload.problemText.trim() : "";
  if (!problemText) {
    throw new Error("图片识别没有得到可用题目文本。");
  }
  const confidence =
    payload.confidence === "high" || payload.confidence === "medium" || payload.confidence === "low"
      ? payload.confidence
      : "medium";
  return {
    problemText,
    diagramDescription:
      typeof payload.diagramDescription === "string" ? payload.diagramDescription.trim() : "",
    subject: typeof payload.subject === "string" ? payload.subject.trim() : undefined,
    confidence,
    notes: typeof payload.notes === "string" ? payload.notes.trim() : undefined,
  };
}

export async function summarizeScriptKnowledge(
  scriptText: string,
  originalPrompt = "",
  mode: AiExplanationMode = "detailed",
  signal?: AbortSignal,
): Promise<{ knowledgeSummary: KnowledgeSummary }> {
  const preflight = preflightScriptText(scriptText);
  if (!preflight.script) {
    throw new Error(`无法整理知识点：${preflight.report.summary}`);
  }
  const guideExcerpt = await readGuideExcerpt();
  const model =
    process.env.PERPLEXITY_REPAIR_MODEL ||
    process.env.PERPLEXITY_MODEL ||
    DEFAULT_REPAIR_MODEL;
  const result = await callPerplexityJson({
    model,
    signal,
    maxOutputTokens: 4000,
    schemaName: "ai_whiteboard_knowledge_summary",
    schema: {
      type: "object",
      properties: {
        knowledgeSummary: knowledgeSummarySchema,
      },
      required: ["knowledgeSummary"],
      additionalProperties: false,
    },
    instructions: `你是 AI Whiteboard 的知识点整理助手。

任务：
1. 根据白板脚本和旁白，整理学生随时可查看的知识点速查卡。
2. 不要生成白板脚本，不要解题重讲，不要写课堂话术，只提炼干货。
3. 只保留：概念名、公式/定理、适用条件、关键原理、易错点。background 只放真正必要的前置知识，没有就空数组。
4. overview 不超过 40 个中文字符；每条 explanation 控制在 15–40 个中文字符，像笔记，不像讲稿。
5. 禁止套话和废话，例如“这里整理了……”“本节课主要……”“帮助你理解……”“这个知识点很重要……”。
6. followUpPrompt 要能直接用于再生成一节专题白板讲解，专门讲清这些公式、定理、适用条件和易错点。

讲解模式：${mode === "concise" ? "简洁讲解" : "详细讲解"}

AI Guide 摘要：
${guideExcerpt}`,
    input: `原始用户需求：
${originalPrompt.trim() || "未提供"}

白板脚本：
${scriptText}`,
  });
  const knowledgeSummary = normalizeKnowledgeSummary(
    (result.json as { knowledgeSummary?: unknown })?.knowledgeSummary,
  );
  if (!knowledgeSummary) {
    throw new Error("AI 没有返回可用知识点整理。");
  }
  return { knowledgeSummary };
}

export async function repairAiScript(
  scriptText: string,
  userInstruction?: string,
  signal?: AbortSignal,
): Promise<AiScriptResult> {
  const guideExcerpt = await readGuideExcerpt();
  const rounds: AiScriptResult["rounds"] = [];
  const maxRounds = getMaxRepairRounds();
  const repairModel =
    process.env.PERPLEXITY_REPAIR_MODEL ||
    process.env.PERPLEXITY_MODEL ||
    DEFAULT_REPAIR_MODEL;
  let check = preflightScriptText(scriptText);
  let currentText = scriptText;
  let currentScript = check.script;
  let explanation = "已检查脚本。";
  let knowledgeSummary: KnowledgeSummary | undefined;

  for (let round = 1; round <= maxRounds; round++) {
    if (!needsAiRepair(check.report) && round > 1) break;
    const repaired = await callPerplexityJson({
      model: repairModel,
      maxOutputTokens: 26000,
      schemaName: "ai_whiteboard_script_with_knowledge",
      schema: aiScriptResultSchema,
      instructions: baseInstructions(guideExcerpt),
      input: `请检查并优化下面这份 AI Whiteboard 脚本。

用户额外要求：
${userInstruction?.trim() || "无"}

预检报告：
${reportForPrompt(check.report)}

当前脚本：
${currentText}

请修复错误、降低布局风险，并按 AI_GUIDE 优化板书节奏、长文本 duration、阅读停顿、激光笔、数学表达、强调方式和旁白口吻。尤其要避免范文、修改后原文、题干重述被 300–500ms 快速刷屏；旁白不能描述白板操作过程，也不能面向第三方，要像老师直接对学生本人讲课。输出完整 JSON，包含 explanation、scriptLines、knowledgeSummary，其中 scriptLines 是完整 JSON 脚本文本按行拆成的字符串数组。`,
      signal,
    });
    const normalized = normalizeAiScriptPayloadDraft(repaired.json);
    currentText = normalized.scriptText;
    currentScript = normalized.script;
    explanation = normalized.explanation;
    knowledgeSummary = normalized.knowledgeSummary;
    check = preflightScriptText(currentText);
    rounds.push({
      round,
      action: "repair",
      model: repaired.model,
      report: check.report,
    });
    if (!needsAiRepair(check.report)) break;
  }

  if (!currentScript) {
    throw new Error("脚本无法通过基础 schema 校验，AI 修复未得到可用结果。");
  }

  const finalScript = normalizeGeneratedScript(currentScript);
  const finalText = stringifyScript(finalScript);
  const finalCheck = preflightScriptText(finalText);

  return {
    scriptText: finalText,
    script: finalScript,
    explanation,
    knowledgeSummary,
    report: finalCheck.report,
    rounds,
  };
}
