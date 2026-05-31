import fs from "node:fs/promises";
import path from "node:path";
import {
  validateScript,
  type ImageAnchor,
  type LayoutSlot,
  type WhiteboardCommand,
  type WhiteboardScript,
} from "../client/src/whiteboard/commandTypes";
import {
  applyBoardTheme,
  defaultCanvasBackground,
  normalizeBoardTheme,
  type BoardTheme,
} from "../client/src/whiteboard/theme";
import {
  canvasSizeForAspect,
  normalizeCanvasAspect,
  type CanvasAspect,
} from "../client/src/whiteboard/canvasAspect";

type PreflightSeverity = "error" | "warning" | "suggestion";

type Rect = { x: number; y: number; width: number; height: number };
const SOURCE_IMAGE_PLACEHOLDER = "__SOURCE_IMAGE_1__";

type SourceImageSize = { width: number; height: number };
type AiScriptPayloadDraft = {
  script?: WhiteboardScript;
  scriptText: string;
  explanation: string;
  knowledgeSummary?: KnowledgeSummary;
};

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
  imageAnchors?: ImageAnchor[];
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
  return report.errors > 0;
}

function preflightScore(report: ScriptPreflightReport) {
  return report.errors * 10000 + report.warnings * 100 + report.suggestions;
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
  const measuredWidth = Math.min(
    maxTextWidth,
    Math.max(fontSize, ...lines.map((line) => estimateTextWidth(line, fontSize))),
  );
  return {
    x: rect.x + padding,
    y: rect.y + padding,
    width: measuredWidth,
    height: Math.max(fontSize, fontSize * 1.2 + (lines.length - 1) * lineGap),
  };
}

function estimateMathCommandBBox(
  command: Extract<WhiteboardCommand, { type: "write_math" | "write_math_steps" }>,
) {
  const estimateLatexHeight = (latex: string, fontSize: number, displayMode = false) => {
    const hasTallOperators =
      /\\(?:frac|dfrac|tfrac|sqrt|lim|sum|prod|int|begin|overline|widehat)\b/.test(latex) ||
      /_[{\\]|\^{/.test(latex);
    const base = displayMode ? 2.25 : 1.75;
    return fontSize * (hasTallOperators ? Math.max(base, displayMode ? 2.7 : 2.35) : base);
  };
  if (command.type === "write_math") {
    return {
      x: command.x,
      y: command.y,
      width: Math.max(command.fontSize * 3.5, command.latex.length * command.fontSize * 0.52),
      height: estimateLatexHeight(command.latex, command.fontSize, command.displayMode),
    };
  }
  const maxLength = Math.max(...command.steps.map((step) => step.length));
  const estimatedLineHeight = Math.max(
    ...command.steps.map((step) =>
      estimateLatexHeight(step, command.fontSize, command.displayMode),
    ),
  );
  const lineGap = Math.max(
    command.lineGap ?? command.fontSize * 1.45,
    estimatedLineHeight * 1.12,
  );
  return {
    x: command.x,
    y: command.y,
    width: Math.max(command.fontSize * 4.5, maxLength * command.fontSize * 0.52),
    height: lineGap * command.steps.length,
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
  return Math.ceil((chars / 4.2) * 1000 + 500);
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
  if (recommendedNarration > 0 && duration < recommendedNarration * 0.85) {
    addIssue(
      issues,
      command,
      commandIndex,
      "warning",
      `旁白与动画时长不匹配：${countVisibleChars(narration)} 个旁白字符只给了 ${duration}ms。`,
      `把 duration 提高到约 ${recommendedNarration}ms，或缩短旁白；不要依赖 TTS 等待来掩盖过短动画，尤其是 iOS Safari 播放导出视频时会显得白板跑在语音前面。`,
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

function rectContains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
  padding = 0,
) {
  return (
    inner.x >= outer.x + padding &&
    inner.y >= outer.y + padding &&
    inner.x + inner.width <= outer.x + outer.width - padding &&
    inner.y + inner.height <= outer.y + outer.height - padding
  );
}

function boundsFromPoints(points: [number, number][], padding = 0): Rect {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x1 = Math.min(...xs) - padding;
  const y1 = Math.min(...ys) - padding;
  const x2 = Math.max(...xs) + padding;
  const y2 = Math.max(...ys) + padding;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function shiftRect(rect: Rect, dx: number, dy: number): Rect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

function rectCenter(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function rectCenterInside(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
  padding = 0,
) {
  const center = rectCenter(inner);
  return (
    center.x >= outer.x + padding &&
    center.x <= outer.x + outer.width - padding &&
    center.y >= outer.y + padding &&
    center.y <= outer.y + outer.height - padding
  );
}

function expandRect(rect: Rect, padding: number): Rect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function pointInsideRect(point: [number, number], rect: Rect) {
  return (
    point[0] >= rect.x &&
    point[0] <= rect.x + rect.width &&
    point[1] >= rect.y &&
    point[1] <= rect.y + rect.height
  );
}

function lineOrientation(a: [number, number], b: [number, number], c: [number, number]) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 0.0001) return 0;
  return value > 0 ? 1 : 2;
}

function pointOnSegment(a: [number, number], b: [number, number], c: [number, number]) {
  return (
    b[0] <= Math.max(a[0], c[0]) + 0.0001 &&
    b[0] + 0.0001 >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) + 0.0001 &&
    b[1] + 0.0001 >= Math.min(a[1], c[1])
  );
}

function segmentsIntersect(
  a1: [number, number],
  a2: [number, number],
  b1: [number, number],
  b2: [number, number],
) {
  const o1 = lineOrientation(a1, a2, b1);
  const o2 = lineOrientation(a1, a2, b2);
  const o3 = lineOrientation(b1, b2, a1);
  const o4 = lineOrientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(a1, b1, a2)) return true;
  if (o2 === 0 && pointOnSegment(a1, b2, a2)) return true;
  if (o3 === 0 && pointOnSegment(b1, a1, b2)) return true;
  if (o4 === 0 && pointOnSegment(b1, a2, b2)) return true;
  return false;
}

function segmentIntersectsRect(from: [number, number], to: [number, number], rect: Rect) {
  if (pointInsideRect(from, rect) || pointInsideRect(to, rect)) return true;
  const topLeft: [number, number] = [rect.x, rect.y];
  const topRight: [number, number] = [rect.x + rect.width, rect.y];
  const bottomLeft: [number, number] = [rect.x, rect.y + rect.height];
  const bottomRight: [number, number] = [rect.x + rect.width, rect.y + rect.height];
  return (
    segmentsIntersect(from, to, topLeft, topRight) ||
    segmentsIntersect(from, to, topRight, bottomRight) ||
    segmentsIntersect(from, to, bottomRight, bottomLeft) ||
    segmentsIntersect(from, to, bottomLeft, topLeft)
  );
}

function linearOccupancySegments(command: WhiteboardCommand): Array<[[number, number], [number, number]]> {
  if (command.type === "draw_line" || command.type === "draw_arrow" || command.type === "draw_segment") {
    return [[command.from, command.to]];
  }
  if (command.type === "draw_ray") {
    const length = command.length ?? 260;
    const dx = command.through[0] - command.from[0];
    const dy = command.through[1] - command.from[1];
    const magnitude = Math.hypot(dx, dy) || 1;
    return [
      [
        command.from,
        [command.from[0] + (dx / magnitude) * length, command.from[1] + (dy / magnitude) * length],
      ],
    ];
  }
  if (command.type === "draw_path") {
    return command.points.slice(1).map((point, index) => [command.points[index], point]);
  }
  if (command.type === "draw_brace") {
    return [[command.from, command.to]];
  }
  return [];
}

function linearStructuralTouchesRect(item: { type: WhiteboardCommand["type"]; command?: WhiteboardCommand }, rect: Rect) {
  if (!item.command) return true;
  const segments = linearOccupancySegments(item.command);
  if (segments.length === 0) return true;
  const padding =
    "width" in item.command && typeof item.command.width === "number"
      ? Math.max(2, item.command.width / 2 + 2)
      : 4;
  const target = expandRect(rect, padding);
  return segments.some(([from, to]) => segmentIntersectsRect(from, to, target));
}

function isTextualOccupancyType(type: WhiteboardCommand["type"]) {
  return (
    type === "write_text" ||
    type === "write_text_segments" ||
    type === "write_paragraph" ||
    type === "revision_compare" ||
    type === "write_math" ||
    type === "write_math_steps" ||
    type === "write_division_layout"
  );
}

function isStructuralVisualOccupancyType(type: WhiteboardCommand["type"]) {
  return (
    type === "draw_line" ||
    type === "draw_arrow" ||
    type === "draw_path" ||
    type === "draw_image" ||
    type === "draw_triangle" ||
    type === "draw_circle" ||
    type === "draw_arc_arrow" ||
    type === "draw_brace" ||
    type === "draw_coordinate_system" ||
    type === "draw_function" ||
    type === "plot_point" ||
    type === "draw_coordinate_segment" ||
    type === "draw_point" ||
    type === "draw_segment" ||
    type === "draw_ray" ||
    type === "draw_angle" ||
    type === "mark_equal_segments" ||
    type === "mark_parallel" ||
    type === "mark_perpendicular" ||
    type === "highlight_polygon" ||
    type === "construct_geometry"
  );
}

function isContainerOccupancyType(type: WhiteboardCommand["type"]) {
  return type === "draw_rectangle";
}

function overlapSeverityForOccupancy(
  a: OccupancyItem,
  b: OccupancyItem,
  overlapRatio: number,
): PreflightSeverity {
  const textualA = isTextualOccupancyType(a.type);
  const textualB = isTextualOccupancyType(b.type);
  const structuralA = isStructuralVisualOccupancyType(a.type);
  const structuralB = isStructuralVisualOccupancyType(b.type);
  if (textualA && textualB) return overlapRatio > 0.12 ? "error" : "warning";
  if ((textualA && structuralB) || (textualB && structuralA)) return "error";
  if (textualA || textualB) return overlapRatio > 0.3 ? "error" : "warning";
  return overlapRatio > 0.45 ? "warning" : "suggestion";
}

function overlapThresholdForOccupancy(a: OccupancyItem, b: OccupancyItem) {
  const involvesTextualItem = isTextualOccupancyType(a.type) || isTextualOccupancyType(b.type);
  return involvesTextualItem ? 0.08 : 0.22;
}

type OccupancyItem = {
  pageId: string;
  sceneId: string;
  id: string;
  type: WhiteboardCommand["type"];
  command: WhiteboardCommand;
  commandIndex: number;
  bbox: Rect;
};

type OccupancyCell = {
  row: number;
  col: number;
  label: string;
  occupancy: number;
  ids: string[];
};

type FreeRegion = {
  label: string;
  cells: string[];
  bbox: Rect;
  occupancy: number;
  fits: string[];
};

type OccupancyPageState = {
  pageId: string;
  sceneId: string;
  items: OccupancyItem[];
  cells: OccupancyCell[];
  freeRegions: FreeRegion[];
};

function estimateDivisionLayoutBBox(
  command: Extract<WhiteboardCommand, { type: "write_division_layout" }>,
): Rect {
  const text = `${command.divisor}${command.dividend}${command.quotient}${command.remainder}`;
  return {
    x: command.x,
    y: command.y - command.fontSize * 0.4,
    width: Math.max(command.fontSize * 4.2, estimateTextWidth(text, command.fontSize) * 0.72),
    height: command.fontSize * 4.1,
  };
}

function estimateDrawPointBBox(command: Extract<WhiteboardCommand, { type: "draw_point" }>): Rect {
  const radius = command.radius ?? 5;
  const fontSize = command.fontSize ?? 18;
  const labelWidth = command.label ? estimateTextWidth(command.label, fontSize) : 0;
  const pad = Math.max(10, radius + 4);
  const labelPosition = command.labelPosition ?? "top";
  let x1 = command.x - pad;
  let y1 = command.y - pad;
  let x2 = command.x + pad;
  let y2 = command.y + pad;
  if (command.label) {
    if (labelPosition === "right") x2 += labelWidth + 10;
    if (labelPosition === "left") x1 -= labelWidth + 10;
    if (labelPosition === "top") y1 -= fontSize + 8;
    if (labelPosition === "bottom") y2 += fontSize + 8;
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function estimateCommandOccupancyBBox(
  command: WhiteboardCommand,
  script: WhiteboardScript,
  slotMap: Map<string, LayoutSlot> | undefined,
): Rect | undefined {
  if (command.type === "write_text") {
    return {
      x: command.x,
      y: command.y - command.fontSize,
      width: estimateTextWidth(command.text, command.fontSize),
      height: command.fontSize * 1.25,
    };
  }
  if (command.type === "write_text_segments") return estimateSegmentLayout(command).bbox;
  if (command.type === "write_math" || command.type === "write_math_steps") return estimateMathCommandBBox(command);
  if (command.type === "write_division_layout") return estimateDivisionLayoutBBox(command);
  if (command.type === "write_paragraph") {
    const slot = command.slotId ? slotMap?.get(command.slotId) : undefined;
    const rect =
      slot ??
      (typeof command.x === "number" &&
      typeof command.y === "number" &&
      typeof command.width === "number" &&
      typeof command.height === "number"
        ? { x: command.x, y: command.y, width: command.width, height: command.height }
        : undefined);
    return rect ? estimateParagraphTextBBox(command, rect) : undefined;
  }
  if (command.type === "revision_compare") {
    const slot = command.slotId ? slotMap?.get(command.slotId) : undefined;
    const revisionSlots = ["before", "after", "note"]
      .map((id) => slotMap?.get(id))
      .filter((item): item is LayoutSlot => Boolean(item));
    return command.slotId && revisionSlots.some((item) => item.id === command.slotId) && revisionSlots.length >= 2
      ? unionSlots(revisionSlots)
      : slot ??
          (typeof command.x === "number" &&
          typeof command.y === "number" &&
          typeof command.width === "number" &&
          typeof command.height === "number"
            ? { x: command.x, y: command.y, width: command.width, height: command.height }
            : undefined);
  }
  if (command.type === "layout_page") {
    return { x: 48, y: 36, width: script.canvas.width - 96, height: 96 };
  }
  if (command.type === "draw_rectangle" || command.type === "draw_image" || command.type === "draw_coordinate_system") {
    return { x: command.x, y: command.y, width: command.width, height: command.height };
  }
  if (command.type === "draw_triangle") return boundsFromPoints(command.points, command.strokeWidth ?? 3);
  if (command.type === "draw_circle") {
    return {
      x: command.cx - command.radius,
      y: command.cy - command.radius,
      width: command.radius * 2,
      height: command.radius * 2,
    };
  }
  if (command.type === "draw_arc_arrow") {
    const pad = (command.width ?? 3) + (command.headSize ?? 14);
    return {
      x: command.cx - command.radius - pad,
      y: command.cy - command.radius - pad,
      width: (command.radius + pad) * 2,
      height: (command.radius + pad) * 2,
    };
  }
  if (command.type === "draw_line" || command.type === "draw_arrow") {
    return boundsFromPoints([command.from, command.to], Math.max(8, (command.width ?? 3) + (command.type === "draw_arrow" ? command.headSize ?? 14 : 0)));
  }
  if (command.type === "draw_path") return boundsFromPoints(command.points, command.width ?? 4);
  if (command.type === "draw_brace") {
    return boundsFromPoints([command.from, command.to], Math.max(command.depth ?? 24, command.width ?? 3));
  }
  if (command.type === "draw_point") return estimateDrawPointBBox(command);
  if (command.type === "draw_segment") return boundsFromPoints([command.from, command.to], Math.max(10, command.width ?? 3));
  if (command.type === "draw_ray") {
    const length = command.length ?? 260;
    const dx = command.through[0] - command.from[0];
    const dy = command.through[1] - command.from[1];
    const magnitude = Math.hypot(dx, dy) || 1;
    const end: [number, number] = [
      command.from[0] + (dx / magnitude) * length,
      command.from[1] + (dy / magnitude) * length,
    ];
    return boundsFromPoints([command.from, end], Math.max(10, command.width ?? 3));
  }
  if (command.type === "draw_angle") {
    const radius = command.radius ?? 34;
    return {
      x: command.vertex[0] - radius - 12,
      y: command.vertex[1] - radius - 12,
      width: radius * 2 + 24 + (command.label ? estimateTextWidth(command.label, command.fontSize ?? 18) : 0),
      height: radius * 2 + 24 + (command.label ? command.fontSize ?? 18 : 0),
    };
  }
  if (command.type === "mark_equal_segments" || command.type === "mark_parallel") {
    return boundsFromPoints(command.segments.flatMap((segment) => [segment.from, segment.to]), Math.max(14, command.size ?? 12));
  }
  if (command.type === "mark_perpendicular") {
    return boundsFromPoints([command.vertex, command.point1, command.point2], Math.max(14, command.size ?? 18));
  }
  if (command.type === "highlight_polygon") return boundsFromPoints(command.points, command.strokeWidth ?? 2);
  if (command.type === "construct_geometry") {
    return command.points.length > 0
      ? boundsFromPoints(command.points.map((point) => [point.x, point.y]), 44)
      : undefined;
  }
  if (command.type === "draw_function" || command.type === "plot_point" || command.type === "draw_coordinate_segment") {
    // Coordinate children are intentionally drawn inside their coordinate
    // system. Counting each child as occupying the whole plot area makes the
    // state matrix look falsely crowded and causes noisy repair loops.
    return undefined;
  }
  return undefined;
}

function buildWhiteboardOccupancyState(script: WhiteboardScript): OccupancyPageState[] {
  const initialPageId = script.pages?.[0]?.id ?? "default";
  let currentPageId = initialPageId;
  const pageSceneVersions = new Map<string, number>([[initialPageId, 0]]);
  const pageObjects = new Map<string, Map<string, OccupancyItem>>([[initialPageId, new Map()]]);
  const pageSlots = new Map<string, Map<string, LayoutSlot>>();
  const sceneIdFor = (pageId: string) => `${pageId}:${pageSceneVersions.get(pageId) ?? 0}`;
  const ensureObjects = (pageId: string) => {
    let objects = pageObjects.get(pageId);
    if (!objects) {
      objects = new Map();
      pageObjects.set(pageId, objects);
    }
    return objects;
  };

  script.commands.forEach((command, commandIndex) => {
    if (command.type === "switch_page") {
      currentPageId = command.pageId;
      if (!pageSceneVersions.has(currentPageId)) pageSceneVersions.set(currentPageId, 0);
      ensureObjects(currentPageId);
      return;
    }

    if (command.type === "clear_canvas") {
      pageSceneVersions.set(currentPageId, (pageSceneVersions.get(currentPageId) ?? 0) + 1);
      pageObjects.set(currentPageId, new Map());
      pageSlots.delete(currentPageId);
      return;
    }

    if (command.type === "layout_page") {
      const slots = buildLayoutSlots(script, command.variant);
      pageSlots.set(currentPageId, new Map(slots.map((slot) => [slot.id, slot])));
    }

    if (command.type === "erase_object") {
      const objects = ensureObjects(currentPageId);
      const targetIds = [...(command.targetIds ?? []), ...(command.targetId ? [command.targetId] : [])];
      targetIds.forEach((id) => objects.delete(id));
      return;
    }

    if (command.type === "erase_area") return;

    if (command.type === "move_object") {
      const objects = ensureObjects(currentPageId);
      const target = objects.get(command.targetId);
      if (!target) return;
      let bbox = target.bbox;
      if (command.by) {
        bbox = shiftRect(bbox, command.by.dx, command.by.dy);
      } else if (command.to) {
        if (command.anchor === "center") {
          const center = rectCenter(bbox);
          bbox = shiftRect(bbox, command.to.x - center.x, command.to.y - center.y);
        } else {
          bbox = { ...bbox, x: command.to.x, y: command.to.y };
        }
      }
      objects.set(command.targetId, { ...target, bbox, commandIndex, sceneId: sceneIdFor(currentPageId) });
      return;
    }

    const id = getCommandId(command);
    if (!id || command.type === "laser_pointer") return;
    const bbox = estimateCommandOccupancyBBox(command, script, pageSlots.get(currentPageId));
    if (!bbox) return;
    ensureObjects(currentPageId).set(id, {
      pageId: currentPageId,
      sceneId: sceneIdFor(currentPageId),
      id,
      type: command.type,
      command,
      commandIndex,
      bbox,
    });
  });

  return Array.from(pageObjects.entries()).map(([pageId, objects]) => {
    const sceneId = sceneIdFor(pageId);
    const items = Array.from(objects.values()).filter((item) => item.sceneId === sceneId);
    const cells = buildOccupancyCells(script, items);
    return {
      pageId,
      sceneId,
      items,
      cells,
      freeRegions: buildFreeRegions(script, cells),
    };
  });
}

function buildOccupancyCells(script: WhiteboardScript, items: OccupancyItem[]): OccupancyCell[] {
  const cols = 6;
  const rows = 4;
  const cellWidth = script.canvas.width / cols;
  const cellHeight = script.canvas.height / rows;
  const cells: OccupancyCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cellRect = { x: col * cellWidth, y: row * cellHeight, width: cellWidth, height: cellHeight };
      const overlapping = items
        .map((item) => ({
          item,
          area: rectOverlapArea(cellRect, item.bbox),
        }))
        .filter(({ area }) => area > 0);
      const occupancy = Math.min(
        1,
        overlapping.reduce((sum, { area }) => sum + area, 0) / rectArea(cellRect),
      );
      cells.push({
        row: row + 1,
        col: col + 1,
        label: `R${row + 1}C${col + 1}`,
        occupancy: Math.round(occupancy * 100) / 100,
        ids: overlapping
          .sort((a, b) => b.area - a.area)
          .slice(0, 5)
          .map(({ item }) => item.id),
      });
    }
  }
  return cells;
}

function freeRegionFits(rect: Rect) {
  const fits: string[] = [];
  if (rect.width >= 240 && rect.height >= 70) fits.push("short_text_or_formula");
  if (rect.width >= 420 && rect.height >= 140) fits.push("paragraph_or_steps");
  if (rect.width >= 420 && rect.height >= 260) fits.push("diagram_or_chart");
  if (rect.width >= 760 && rect.height >= 180) fits.push("wide_explanation");
  return fits;
}

function buildFreeRegions(script: WhiteboardScript, cells: OccupancyCell[]): FreeRegion[] {
  const cols = 6;
  const rows = 4;
  const cellWidth = script.canvas.width / cols;
  const cellHeight = script.canvas.height / rows;
  const cellAt = (row: number, col: number) =>
    cells.find((cell) => cell.row === row + 1 && cell.col === col + 1);
  const regions: Array<FreeRegion & { area: number }> = [];

  for (let top = 0; top < rows; top++) {
    for (let left = 0; left < cols; left++) {
      for (let bottom = top; bottom < rows; bottom++) {
        for (let right = left; right < cols; right++) {
          const regionCells: OccupancyCell[] = [];
          let blocked = false;
          for (let row = top; row <= bottom; row++) {
            for (let col = left; col <= right; col++) {
              const cell = cellAt(row, col);
              if (!cell || cell.occupancy > 0.16 || cell.ids.length > 1) blocked = true;
              if (cell) regionCells.push(cell);
            }
          }
          if (blocked || regionCells.length === 0) continue;
          const bbox = {
            x: Math.round(left * cellWidth + 16),
            y: Math.round(top * cellHeight + 16),
            width: Math.round((right - left + 1) * cellWidth - 32),
            height: Math.round((bottom - top + 1) * cellHeight - 32),
          };
          const fits = freeRegionFits(bbox);
          if (fits.length === 0) continue;
          const occupancy =
            Math.round(
              (regionCells.reduce((sum, cell) => sum + cell.occupancy, 0) / regionCells.length) * 100,
            ) / 100;
          regions.push({
            label: `R${top + 1}C${left + 1}:R${bottom + 1}C${right + 1}`,
            cells: regionCells.map((cell) => cell.label),
            bbox,
            occupancy,
            fits,
            area: bbox.width * bbox.height,
          });
        }
      }
    }
  }

  const maximal = regions
    .filter((region) => {
      return !regions.some((other) => {
        if (other === region || other.area <= region.area) return false;
        return rectContains(other.bbox, region.bbox, -1);
      });
    })
    .sort((a, b) => b.area - a.area || a.occupancy - b.occupancy)
    .slice(0, 6);

  return maximal.map(({ area: _area, ...region }) => region);
}

function whiteboardStateForPrompt(script: WhiteboardScript) {
  const states = buildWhiteboardOccupancyState(script);
  return JSON.stringify(
    states.map((state) => ({
      pageId: state.pageId,
      sceneId: state.sceneId,
      occupiedCells: state.cells
        .filter((cell) => cell.occupancy >= 0.18 || cell.ids.length >= 3)
        .map((cell) => ({
          cell: cell.label,
          occupancy: cell.occupancy,
          ids: cell.ids,
        })),
      freeRegions: state.freeRegions.map((region) => ({
        region: region.label,
        bbox: {
          x: region.bbox.x,
          y: region.bbox.y,
          width: region.bbox.width,
          height: region.bbox.height,
        },
        avgOccupancy: region.occupancy,
        fits: region.fits,
      })),
      placementAdvice:
        state.freeRegions.length > 0
          ? "新增文字/公式/段落/图示前，优先从 freeRegions 中选择能容纳内容的 bbox；不要写入 occupiedCells。"
          : "当前页没有足够宽敞的空白区。新增内容前必须 erase_object/clear_canvas 清理旧内容，或 switch_page 新开一页。",
      objects: state.items.slice(0, 28).map((item) => ({
        id: item.id,
        type: item.type,
        bbox: {
          x: Math.round(item.bbox.x),
          y: Math.round(item.bbox.y),
          width: Math.round(item.bbox.width),
          height: Math.round(item.bbox.height),
        },
      })),
    })),
    null,
    2,
  );
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
  return text
    .replace(/\f(?=rac|box|ill|ont|oreach)/g, "\\f")
    .replace(/\t(?=imes|ext|herefore|riangle|an|heta)/g, "\\t")
    .replace(/\b(?=ecause|ox|eta)/g, "\\b")
    .replace(/\r(?=ightarrow)/g, "\\r")
    .replace(/\n(?=e\b|eq|ot)/g, "\\n");
}

function normalizeLatexText(text: string) {
  return repairDecodedLatexEscapes(text)
    .replace(/\\ne\b/g, "\\neq")
    .replace(/_([A-Za-z0-9]+)(?![A-Za-z0-9}])/g, "_{$1}")
    .replace(/(^|[^\\])therefore(?=[A-Z])/g, "$1\\therefore ")
    .replace(/(^|[^\\])because(?=[A-Z])/g, "$1\\because ");
}

function normalizeInlineLatexForPlainText(text: string) {
  return normalizeLatexText(text)
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\div/g, "÷")
    .replace(/\\therefore/g, "∴")
    .replace(/\\because/g, "∵")
    .replace(/\\perp/g, "⊥")
    .replace(/\\parallel/g, "∥")
    .replace(/\\circ/g, "°")
    .replace(/\\leq/g, "≤")
    .replace(/\\geq/g, "≥")
    .replace(/\\neq/g, "≠")
    .replace(/[{}]/g, "");
}

function containsRawLatexCommand(text: string) {
  return /\\(?:frac|sqrt|circ|Rightarrow|Leftarrow|rightarrow|leftarrow|Leftrightarrow|therefore|because|angle|triangle|parallel|perp|cdot|times|div|leq|geq|ne|neq|text|sin|cos|tan|log|ln|overline|widehat|hat|vec)\b/.test(
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
  const coordinateSystemUsages = new Map<
    string,
    {
      command: Extract<WhiteboardCommand, { type: "draw_coordinate_system" }>;
      commandIndex: number;
      pageId: string;
      childIds: string[];
      segmentCount: number;
    }
  >();
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
          "长题干、作文原文、结论串联应改用显式 x/y/width/height 的 write_paragraph 自动换行；不要使用模板框或多个大字号 write_text 手搓坐标。",
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

    if (command.type === "draw_image") {
      checkRect(issues, script, command, index, command, "原题图片");
      if (!command.src.startsWith("data:image/") && !/^https?:\/\//.test(command.src) && command.src !== SOURCE_IMAGE_PLACEHOLDER) {
        addIssue(
          issues,
          command,
          index,
          "warning",
          `draw_image "${command.id}" 的 src 不是 data:image 或 URL。`,
          `上传题图生成时请使用占位符 ${SOURCE_IMAGE_PLACEHOLDER}，最终脚本会由后端替换为原图资源。`,
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
      command.type === "draw_function" ||
      command.type === "plot_point" ||
      command.type === "draw_coordinate_segment"
    ) {
      if (!coordinateSystems.has(command.coordinateSystemId)) {
        addIssue(
          issues,
          command,
          index,
          "error",
          `${command.type} 引用了尚未创建的坐标系 "${command.coordinateSystemId}"。`,
          "先使用 draw_coordinate_system 创建坐标系。",
        );
      } else {
        const usage = coordinateSystemUsages.get(command.coordinateSystemId);
        if (usage) {
          usage.childIds.push(getCommandId(command) ?? `${command.type}_${index}`);
          if (command.type === "draw_coordinate_segment") usage.segmentCount += 1;
        }
      }
    }

    if (command.type === "draw_coordinate_system") {
      coordinateSystems.add(command.id);
      coordinateSystemUsages.set(command.id, {
        command,
        commandIndex: index,
        pageId: currentPageId,
        childIds: [],
        segmentCount: 0,
      });
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

  for (const [coordinateSystemId, usage] of Array.from(coordinateSystemUsages.entries())) {
    if (usage.childIds.length === 0) {
      addIssue(
        issues,
        usage.command,
        usage.commandIndex,
        "error",
        `坐标系 "${coordinateSystemId}" 没有任何图像数据。`,
        "如果题图包含 F-t、v-t、函数图或统计图，创建坐标系后必须用 draw_coordinate_segment / draw_function / plot_point 把识别到的每一段图像画出来；不能只留下空坐标轴。",
      );
    } else if (usage.segmentCount === 1 && usage.childIds.length === 1) {
      addIssue(
        issues,
        usage.command,
        usage.commandIndex,
        "warning",
        `坐标系 "${coordinateSystemId}" 只有 1 个数据线段，可能漏画了分段图像。`,
        "若原图是 F-t、v-t、折线、阶梯图或分段函数，请逐段补齐所有水平段、斜线段、零值段和必要的辅助虚线。",
      );
    }
  }

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

  const occupancyStates = buildWhiteboardOccupancyState(script);
  for (const state of occupancyStates) {
    for (const cell of state.cells) {
      const cellItems = cell.ids
        .map((id) => state.items.find((item) => item.id === id))
        .filter((item): item is OccupancyItem => Boolean(item));
      const hasTextualItem = cellItems.some((item) => isTextualOccupancyType(item.type));
      if (cell.occupancy >= 0.72 && cell.ids.length >= 2) {
        if (!hasTextualItem) continue;
        addIssue(
          issues,
          undefined,
          undefined,
          "warning",
          `白板页 "${state.pageId}" 的状态矩阵 ${cell.label} 已明显拥挤，当前占用约 ${Math.round(cell.occupancy * 100)}%。`,
          `不要继续在这个网格写字或放对象；优先改用相邻空白网格，或 switch_page 新开一页。当前主要对象：${cell.ids.join("、")}。`,
        );
      }
    }

    const hasWritableFreeRegion = state.freeRegions.some((region) =>
      region.fits.some((fit) => fit === "paragraph_or_steps" || fit === "diagram_or_chart" || fit === "wide_explanation"),
    );
    const hasTextualItems = state.items.some((item) => isTextualOccupancyType(item.type));
    if (state.items.length >= 8 && hasTextualItems && !hasWritableFreeRegion) {
      addIssue(
        issues,
        undefined,
        undefined,
        "warning",
        `白板页 "${state.pageId}" 当前没有足够容纳新板书的宽敞空白区。`,
        "继续讲解前应先 erase_object/clear_canvas 清理不再需要的内容，或 switch_page 新开一页；不要在边角或已有文字旁硬塞新内容。",
      );
    }

    const pageOverlapPairs = new Set<string>();
    for (let i = 0; i < state.items.length; i++) {
      for (let j = i + 1; j < state.items.length; j++) {
        const a = state.items[i];
        const b = state.items[j];
        if (a.type === "layout_page" || b.type === "layout_page") continue;
        if (isStructuralVisualOccupancyType(a.type) && isStructuralVisualOccupancyType(b.type)) {
          continue;
        }
        if (
          (isContainerOccupancyType(a.type) && rectContains(a.bbox, b.bbox, 8)) ||
          (isContainerOccupancyType(b.type) && rectContains(b.bbox, a.bbox, 8))
        ) {
          continue;
        }
        if (
          (isContainerOccupancyType(a.type) &&
            isTextualOccupancyType(b.type) &&
            rectCenterInside(a.bbox, b.bbox, 14)) ||
          (isContainerOccupancyType(b.type) &&
            isTextualOccupancyType(a.type) &&
            rectCenterInside(b.bbox, a.bbox, 14))
        ) {
          continue;
        }
        const minArea = Math.min(rectArea(a.bbox), rectArea(b.bbox));
        if (minArea <= 0) continue;
        const overlapArea = rectOverlapArea(a.bbox, b.bbox);
        const overlapRatio = overlapArea / minArea;
        const involvesTextualItem = isTextualOccupancyType(a.type) || isTextualOccupancyType(b.type);
        if (involvesTextualItem) {
          const structural = isStructuralVisualOccupancyType(a.type) ? a : isStructuralVisualOccupancyType(b.type) ? b : undefined;
          const textual = isTextualOccupancyType(a.type) ? a : isTextualOccupancyType(b.type) ? b : undefined;
          if (structural && textual && !linearStructuralTouchesRect(structural, textual.bbox)) {
            continue;
          }
        }
        const threshold = overlapThresholdForOccupancy(a, b);
        if (overlapRatio < threshold && !(involvesTextualItem && overlapArea > 8 && rectsOverlap(a.bbox, b.bbox, 6))) {
          continue;
        }
        const pairKey = [a.id, b.id].sort().join("::");
        if (pageOverlapPairs.has(pairKey)) continue;
        pageOverlapPairs.add(pairKey);
        let severity = overlapSeverityForOccupancy(a, b, overlapRatio);
        if (
          severity === "error" &&
          ((isTextualOccupancyType(a.type) && linearOccupancySegments(b.command).length > 0) ||
            (isTextualOccupancyType(b.type) && linearOccupancySegments(a.command).length > 0))
        ) {
          severity = "warning";
        }
        addIssue(
          issues,
          b.commandIndex >= a.commandIndex ? b.command : undefined,
          b.commandIndex >= a.commandIndex ? b.commandIndex : undefined,
          severity,
          `白板状态矩阵显示对象 "${a.id}" 与 "${b.id}" 占用区域重叠。`,
          "在生成或修复时先查看当前页对象 bbox 和网格占用；新文字、公式、图形应放到空白区域，或先 erase_object / clear_canvas / switch_page。",
        );
      }
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
        "重新规划版面：把白板当成空白黑板，长正文/题干/作文改用显式 x/y/width/height 的 write_paragraph；普通文字行之间至少留 1.45 倍字号的行距。",
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

  const normalized = normalizeGeneratedScript(validation.script);
  return {
    script: normalized,
    report: analyzeValidScript(normalized),
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
    // Preserve LaTeX commands that start with JSON-valid escapes such as
    // \times, \text, \triangle, \therefore, \neq before JSON.parse decodes
    // them into tabs/newlines.
    .replace(
      /(^|[^\\])\\(?=(?:frac|sqrt|circ|Rightarrow|Leftarrow|rightarrow|leftarrow|Leftrightarrow|therefore|because|angle|triangle|parallel|perp|cdot|times|div|leq|geq|ne|neq|text|sin|cos|tan|log|ln|overline|widehat|hat|vec)\b)/g,
      "$1\\\\",
    )
    // AI often writes LaTeX in JSON as "\div" / "\sqrt" instead of "\\div".
    .replace(/\\(?!["\\/bfnrtu])/g, "\\\\")
    // If an outer JSON string decoded "\frac" as a form-feed escape, restore it.
    .replace(/\f(?=rac|box|ill|ont|oreach)/g, "\\\\f");
}

function stringifyScript(script: WhiteboardScript) {
  return JSON.stringify(script, null, 2);
}

function shrinkLongTextFontSize(text: string, fontSize: number, maxWidth?: number) {
  const visibleChars = countVisibleChars(text);
  if (visibleChars <= 16 && (!maxWidth || estimateTextWidth(text, fontSize) <= maxWidth)) {
    return fontSize;
  }

  let next = fontSize;
  if (visibleChars > 16 && fontSize > 22) {
    next = Math.max(20, next - 2);
  }
  if (visibleChars > 28 && fontSize > 24) {
    next = Math.min(next, Math.max(20, fontSize - 4));
  }
  if (maxWidth) {
    const minByWidth = visibleChars > 28 ? Math.max(20, fontSize - 4) : 18;
    while (next > minByWidth && estimateTextWidth(text, next) > maxWidth) {
      next -= 1;
    }
  }
  return next;
}

function normalizeLongTextCommandTypography(command: WhiteboardCommand): WhiteboardCommand {
  if (command.type === "write_text") {
    const maxWidth = 0.58 * 1200;
    const fontSize = shrinkLongTextFontSize(command.text, command.fontSize, maxWidth);
    return fontSize === command.fontSize ? command : { ...command, fontSize };
  }

  if (command.type === "write_text_segments") {
    const text = command.segments.map((segment) => segment.text).join("");
    const maxWidth = 0.58 * 1200;
    const fontSize = shrinkLongTextFontSize(text, command.fontSize, maxWidth);
    const scale = fontSize / command.fontSize;
    const segments = command.segments.map((segment) => {
      if (typeof segment.fontSize !== "number") return segment;
      return {
        ...segment,
        fontSize: Math.max(18, Math.round(segment.fontSize * scale)),
      };
    });
    const changed =
      fontSize !== command.fontSize ||
      segments.some((segment, index) => segment.fontSize !== command.segments[index].fontSize);
    return changed ? { ...command, fontSize, segments } : command;
  }

  if (command.type === "write_paragraph") {
    const fontSize = shrinkLongTextFontSize(command.text, command.fontSize);
    if (fontSize === command.fontSize) return command;
    const lineGap =
      typeof command.lineGap === "number"
        ? Math.max(fontSize * 1.45, command.lineGap - (command.fontSize - fontSize) * 1.4)
        : undefined;
    return { ...command, fontSize, ...(lineGap ? { lineGap } : {}) };
  }

  return command;
}

function normalizeGeneratedScript(script: WhiteboardScript): WhiteboardScript {
  const normalized = {
    ...script,
    commands: script.commands
      .filter((command): command is Exclude<WhiteboardCommand, { type: "wait" }> => command.type !== "wait")
      .map((command) => {
        command = normalizeLongTextCommandTypography(command) as typeof command;
        command = normalizeNarrationDuration(command) as typeof command;
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
              text: normalizeInlineLatexForPlainText(text),
            };
          }
        }

        if (command.type === "write_text_segments") {
          const segments = command.segments.map((segment) => ({
            ...segment,
            text: normalizeInlineLatexForPlainText(segment.text),
          }));
          if (segments.some((segment, index) => segment.text !== command.segments[index].text)) {
            return { ...command, segments };
          }
        }

        if (command.type === "write_paragraph") {
          const text = normalizeInlineLatexForPlainText(command.text);
          if (text !== command.text) return { ...command, text };
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
  return removeInvalidMoveObjectCommands(
    fitReadableCommandsToFreeSpace(
      fitMathCommandsToCanvas(uniquifyRepeatedLayoutPages(normalized)),
    ),
  );
}

function estimateNarrationDurationForScriptMs(narration: string) {
  let cjk = 0;
  let latin = 0;
  let punctuation = 0;
  for (const char of narration) {
    if (/[\u4e00-\u9fff]/.test(char)) cjk += 1;
    else if (/[A-Za-z0-9]/.test(char)) latin += 1;
    else if (!/\s/.test(char)) punctuation += 1;
  }
  return Math.max(1400, Math.round(cjk * 260 + latin * 85 + punctuation * 180 + 600));
}

function normalizeNarrationDuration(command: WhiteboardCommand): WhiteboardCommand {
  const narration = getCommandNarration(command);
  if (!narration || !("duration" in command) || typeof command.duration !== "number") {
    return command;
  }
  const estimated = estimateNarrationDurationForScriptMs(narration);
  const minimum = Math.ceil(Math.max(command.duration, estimated * 0.55) / 100) * 100;
  if (minimum <= command.duration) return command;
  return { ...command, duration: minimum } as WhiteboardCommand;
}

function removeInvalidMoveObjectCommands(script: WhiteboardScript): WhiteboardScript {
  const created = new Set<string>();
  const commands: WhiteboardCommand[] = [];

  for (const command of script.commands) {
    if (command.type === "move_object") {
      if (created.has(command.targetId)) {
        commands.push(command);
      }
      continue;
    }

    commands.push(command);
    const id = getCommandId(command);
    if (id && command.type !== "laser_pointer") {
      created.add(id);
    }
  }

  if (commands.length === script.commands.length) return script;
  return { ...script, commands };
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

function splitWideLatexForCanvas(latex: string) {
  const normalized = latex.trim();
  if (!normalized) return [];
  const separators = /\\Longleftrightarrow|\\Leftrightarrow|\\Rightarrow|\\implies|\\qquad|\\quad/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = separators.exec(normalized))) {
    const before = normalized.slice(lastIndex, match.index).trim();
    if (before) parts.push(before);
    const separator = match[0];
    lastIndex = match.index + separator.length;
    if (separator !== "\\qquad" && separator !== "\\quad") {
      const nextSeparator = new RegExp(separators.source, "g");
      nextSeparator.lastIndex = lastIndex;
      const next = nextSeparator.exec(normalized);
      const afterEnd = next ? next.index : normalized.length;
      const after = normalized.slice(lastIndex, afterEnd).trim();
      if (after) {
        parts.push(`${separator} ${after}`);
        lastIndex = afterEnd;
        separators.lastIndex = afterEnd;
      }
    }
  }
  const tail = normalized.slice(lastIndex).trim();
  if (tail) parts.push(tail);
  return parts.filter(Boolean);
}

function scaleMathCommand(
  command: Extract<WhiteboardCommand, { type: "write_math" | "write_math_steps" }>,
  scale: number,
) {
  const minFontSize = command.type === "write_math_steps" ? 17 : 18;
  const fontSize = Math.max(minFontSize, Math.floor(command.fontSize * scale));
  if (command.type === "write_math_steps") {
    return {
      ...command,
      fontSize,
      lineGap: Math.max(fontSize * 1.45, Math.min(command.lineGap ?? fontSize * 1.65, fontSize * 2.15)),
    };
  }
  return { ...command, fontSize };
}

function clampMathCommandToCanvas(
  command: Extract<WhiteboardCommand, { type: "write_math" | "write_math_steps" }>,
  script: WhiteboardScript,
  margin: number,
) {
  let next = { ...command };
  let bbox = estimateMathCommandBBox(next);
  const maxWidth = Math.max(80, script.canvas.width - margin * 2);
  const maxHeight = Math.max(80, script.canvas.height - margin * 2);

  for (let round = 0; round < 5 && (bbox.width > maxWidth || bbox.height > maxHeight); round += 1) {
    const widthScale = maxWidth / Math.max(1, bbox.width);
    const heightScale = maxHeight / Math.max(1, bbox.height);
    const scale = Math.max(0.42, Math.min(0.96, widthScale, heightScale));
    const scaled = scaleMathCommand(next, scale);
    if (scaled.fontSize === next.fontSize) break;
    next = scaled;
    bbox = estimateMathCommandBBox(next);
  }

  const maxX = script.canvas.width - margin - bbox.width;
  const maxY = script.canvas.height - margin - bbox.height;
  const x = Math.max(margin, Math.min(next.x, Math.max(margin, maxX)));
  const y = Math.max(margin, Math.min(next.y, Math.max(margin, maxY)));
  return { ...next, x, y };
}

function hasCanvasPosition(command: WhiteboardCommand): command is WhiteboardCommand & { x: number; y: number } {
  const candidate = command as { x?: unknown; y?: unknown };
  return typeof candidate.x === "number" && typeof candidate.y === "number";
}

function isReadableMovableCommand(command: WhiteboardCommand) {
  return (
    hasCanvasPosition(command) &&
    (command.type === "write_text" ||
      command.type === "write_text_segments" ||
      command.type === "write_math" ||
      command.type === "write_math_steps")
  );
}

function moveCommandTo(command: WhiteboardCommand, x: number, y: number): WhiteboardCommand {
  if (!hasCanvasPosition(command)) return command;
  return { ...command, x, y } as WhiteboardCommand;
}

function readableCandidatePositions(
  command: WhiteboardCommand & { x: number; y: number },
  bbox: Rect,
  script: WhiteboardScript,
) {
  const margin = 48;
  const positions: Array<{ x: number; y: number }> = [{ x: command.x, y: command.y }];
  const maxX = Math.max(margin, script.canvas.width - margin - bbox.width);
  const maxY = Math.max(margin, script.canvas.height - margin - bbox.height);
  const clampedOriginal = {
    x: Math.max(margin, Math.min(command.x, maxX)),
    y: Math.max(margin, Math.min(command.y, maxY)),
  };
  positions.push(clampedOriginal);

  const rowStep = Math.max(48, Math.min(140, bbox.height + 24));
  for (let y = clampedOriginal.y + rowStep; y <= maxY; y += rowStep) {
    positions.push({ x: clampedOriginal.x, y });
  }
  for (let y = Math.max(margin, clampedOriginal.y - rowStep); y >= margin; y -= rowStep) {
    positions.push({ x: clampedOriginal.x, y });
  }

  const columns = [
    margin,
    Math.max(margin, (script.canvas.width - bbox.width) / 2),
    maxX,
    script.canvas.width * 0.08,
    script.canvas.width * 0.52,
  ];
  for (const x of columns) {
    for (let y = 130; y <= maxY; y += rowStep) {
      positions.push({ x: Math.max(margin, Math.min(x, maxX)), y });
    }
  }

  const seen = new Set<string>();
  return positions.filter((position) => {
    const key = `${Math.round(position.x)}:${Math.round(position.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fitReadableCommandsToFreeSpace(script: WhiteboardScript): WhiteboardScript {
  const occupiedByScene = new Map<
    string,
    Array<{ id: string; type: WhiteboardCommand["type"]; command: WhiteboardCommand; bbox: Rect }>
  >();
  let currentPageId = script.pages?.[0]?.id ?? "default";
  let sceneNonce = 0;
  const currentSceneKey = () => `${currentPageId}:${sceneNonce}`;
  const commands: WhiteboardCommand[] = [];

  const collides = (
    bbox: Rect,
    command: WhiteboardCommand,
    occupied: Array<{ type: WhiteboardCommand["type"]; command: WhiteboardCommand; bbox: Rect }>,
  ) =>
    occupied.some((item) => {
      if (isContainerOccupancyType(item.type) && rectCenterInside(item.bbox, bbox, 14)) {
        return false;
      }
      if (isContainerOccupancyType(command.type) && rectCenterInside(bbox, item.bbox, 14)) {
        return false;
      }
      const padding = isTextualOccupancyType(command.type) || isTextualOccupancyType(item.type) ? 10 : 4;
      if (!rectsOverlap(bbox, item.bbox, padding)) return false;
      if (isTextualOccupancyType(command.type) && isStructuralVisualOccupancyType(item.type)) {
        if (!linearStructuralTouchesRect(item, bbox)) return false;
      }
      if (isStructuralVisualOccupancyType(command.type) && isTextualOccupancyType(item.type)) {
        if (!linearStructuralTouchesRect({ type: command.type, command }, item.bbox)) return false;
      }
      const overlapArea = rectOverlapArea(bbox, item.bbox);
      if (overlapArea <= 8) return false;
      const minArea = Math.min(rectArea(bbox), rectArea(item.bbox));
      if (minArea <= 0) return false;
      return overlapArea / minArea > (isTextualOccupancyType(item.type) ? 0.025 : 0.08);
    });

  for (const command of script.commands) {
    if (command.type === "switch_page") {
      currentPageId = command.pageId;
      sceneNonce = 0;
      commands.push(command);
      continue;
    }
    if (command.type === "clear_canvas") {
      sceneNonce += 1;
      commands.push(command);
      continue;
    }

    let next: WhiteboardCommand = command;
    let bbox = estimateCommandOccupancyBBox(next, script, undefined);
    const occupied = occupiedByScene.get(currentSceneKey()) ?? [];
    if (bbox && isReadableMovableCommand(next) && collides(bbox, next, occupied)) {
      const candidates = readableCandidatePositions(next, bbox, script);
      for (const candidate of candidates) {
        const moved = moveCommandTo(next, candidate.x, candidate.y);
        const movedBBox = estimateCommandOccupancyBBox(moved, script, undefined);
        if (!movedBBox) continue;
        const inside =
          movedBBox.x >= 24 &&
          movedBBox.y >= 24 &&
          movedBBox.x + movedBBox.width <= script.canvas.width - 24 &&
          movedBBox.y + movedBBox.height <= script.canvas.height - 24;
        if (inside && !collides(movedBBox, moved, occupied)) {
          next = moved;
          bbox = movedBBox;
          break;
        }
      }
    }

    commands.push(next);
    bbox = bbox ?? estimateCommandOccupancyBBox(next, script, undefined);
    if (bbox && next.type !== "laser_pointer") {
      occupied.push({
        id: getCommandId(next) ?? `${commands.length}`,
        type: next.type,
        command: next,
        bbox,
      });
      occupiedByScene.set(currentSceneKey(), occupied);
    }
  }

  return { ...script, commands };
}

function fitMathCommandsToCanvas(script: WhiteboardScript): WhiteboardScript {
  const margin = 28;
  const maxWidth = Math.max(80, script.canvas.width - margin * 2);
  const maxHeight = Math.max(80, script.canvas.height - margin * 2);
  const commands = script.commands.map((command) => {
    if (command.type !== "write_math" && command.type !== "write_math_steps") return command;

    let next: Extract<WhiteboardCommand, { type: "write_math" | "write_math_steps" }> = { ...command };
    let bbox = estimateMathCommandBBox(next);
    if (next.type === "write_math" && bbox.width > maxWidth * 0.92) {
      const split = splitWideLatexForCanvas(next.latex);
      if (split.length >= 2) {
        next = {
          ...next,
          type: "write_math_steps",
          steps: split,
          lineGap: Math.max(next.fontSize * 1.7, 58),
        };
        bbox = estimateMathCommandBBox(next);
      }
    }
    if (bbox.width > maxWidth || bbox.height > maxHeight) {
      const widthScale = maxWidth / Math.max(1, bbox.width);
      const heightScale = maxHeight / Math.max(1, bbox.height);
      const scale = Math.max(0.42, Math.min(1, widthScale, heightScale));
      next = scaleMathCommand(next, scale);
      bbox = estimateMathCommandBBox(next);
    }

    return clampMathCommandToCanvas(next, script, margin);
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
2. 第一页只做专题导入：把白板当成空白黑板，使用 write_text 标题 + 显式 x/y/width/height 的 write_paragraph；不要使用 layout_page、slotId 或模板框。
3. 需要列要点时，直接用显式坐标分成左右或上下区域；每块内容只放一个 write_paragraph，公式另用显式 x/y 的 write_math 或 write_math_steps 放在段落下方。
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
5a. emphasize_text.style 只能写 "bold"、"color"、"font_size"、"underline"、"dot" 之一；不要写 highlight、circle、ring、pulse、spotlight、box、mark 等别名。
6. 初中数学优先使用 write_math、write_math_steps、draw_coordinate_system、draw_function、plot_point、draw_coordinate_segment 等结构化命令。
7. 禁止把 LaTeX 公式写进 write_text。任何包含 \\frac、\\sqrt、\\circ、\\Rightarrow、\\therefore、^、_、分数、根号、上下标、箭头的数学表达，都必须用 write_math 或 write_math_steps；普通中文解释和公式要拆成相邻的 write_text + write_math。
7a. write_math/write_math_steps 里只能写纯数学符号、变量、数字、英文下标或单位；不要把中文解释塞进 LaTeX，尤其不要写 \\text{水平方向平衡}、\\text{不变}、\\text{合} 这类中文文本。中文解释必须用 write_text/write_paragraph，公式单独用 write_math/write_math_steps。
8. 不要使用预生成板书图片或遮罩揭示路线。
9. 画面要留白，严禁文字互相重叠、文字压住标题、批注遮挡正文、图形/框/箭头压住文字。长题干、作文原文、修改后原文、点评长句优先使用显式 x/y/width/height 的 write_paragraph 或 revision_compare，不要用模板框，不要用多个大字号 write_text 手搓坐标。
9a. 复述题目、题干分析、讲解说明、总结句这类长文字字号要克制：比标题小很多，比普通短标签再小约 2px。write_paragraph 建议 fontSize 22–26；必须用单行 write_text 时，超过 16 个中文字符就把字号比原计划下调 2，超过 28 个中文字符继续拆行或改用 write_paragraph。
9b. 可以使用归一布局输入做粗排版：xN/yN、posN、sizeN、fromN/toN、pointsN、bboxN 表示相对当前画布宽高的 0~1 坐标，后端会先换算成绝对 x/y/width/height/from/to/points/bbox，再统一做 bbox 预检。若同时写绝对字段和归一字段，绝对字段优先。像素级公式局部批注和图片内部 anchors 仍按命令原格式书写。
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
21. 如果用户输入来自题目图片，且系统提供了原题图片资源占位符 ${SOURCE_IMAGE_PLACEHOLDER}，优先用 draw_image 把原图清晰放到白板上，再用 laser_pointer、emphasize_text、箭头、短标签或极简示意图围绕原图讲解；不要为了复刻原图而把每个图形细节重新画一遍。只有需要突出某个抽象关系、分段图像或推导辅助时，才额外画简化图示。
21a. draw_image 命令格式：{"type":"draw_image","id":"source_question","src":"${SOURCE_IMAGE_PLACEHOLDER}","x":60,"y":120,"width":720,"height":420,"radius":8,"duration":500,"narration":"..."}。src 必须原样使用占位符，不要改写、不要编造 URL。
21a1. 只要已经使用 draw_image 展示原题图，就不要再完整重画原题里的装置图、F-t 图、v-t 图、选项列表或表格；讲解重点必须通过 imageAnchor、laser_pointer、annotate_circle、draw_arrow 和旁边的短公式完成。额外重画只允许画 1 个极简关系示意或 1–2 行公式，不能复制整张题图。
21a2. 如果原题图是横向长图或包含完整题干/选项/多个小图，第一页只能放原图、标题和少量激光笔/圈画/箭头；不要在同一页放公式推导、长段文字或结论列表。读图后必须 switch_page 到新页再写公式、判断选项和答案。
21a3. 原图模式下，后续讲解页必须“少而分散”：一页最多放 1 个 write_math_steps 或 1 组 3 行以内的公式，最多放 4 条短文本；如果要判断 A/B/C/D 四个选项，必须拆成至少 2 页，或只写最终正确选项和 1–2 条关键排除理由。不要把运动判断、摩擦计算、选项排除和最终答案全部塞进同一页。
21b. 如果没有提供原题图片资源，但用户输入包含图示、表格、实验装置、几何图或函数图，不能只讲文字题干；必须在白板上重构图示的关键结构。物理题优先用矩形、线段、箭头、标签重构装置/过程/受力/光路/电路等；几何题优先用几何专用命令或 construct_geometry；函数题优先用坐标系和函数图像。
21c. 对题目图片里的 F-t、v-t、s-t、I-U、函数图、统计图、折线图、阶梯图和实验图像，如果已经使用原图展示，可直接在原图上用激光笔/箭头/短标签指出关键段；如果额外重画坐标图，必须逐段重构识别结果：先 draw_coordinate_system，再用 draw_coordinate_segment 画每一个可见数据段。分段常量用水平线段，匀加速/匀减速用斜线段，静止或零值段也要画在坐标轴上；4～6s 这类水平延续段不能省略。只有解析式图像才用 draw_function；不要用 draw_function 去猜图片中的分段/实验图像。
21d. 坐标系不能空着。每个 draw_coordinate_system 后面必须至少有一个 draw_coordinate_segment、draw_function 或 plot_point；如果识别描述中给出了多段图像，必须逐条画完整，不能只画最显眼的一段。
22. 不要生成 wait 命令，不要安排“等待用户点击下一步”的互动等待点。播放器已经有暂停/继续功能，学生需要思考时会自行暂停。
23. 理科题必须按“读题抓条件 → 图示关系 → 公式推导 → 答案总结”组织。半衰期题画时间轴/倍半衰期示意；弹簧/滑块题画两个木块和弹簧、位移方向；带电粒子进磁场题画磁场符号、速度方向、圆轨迹和半径。
24. 物理公式、变量下标、分式、平方、单位换算和推导步骤必须用 write_math 或 write_math_steps。不要把 m_1、m_2、\\frac{1}{2}、F=kx、qvB=mv^2/R、48/24=2 这类内容塞进 write_text 或 write_text_segments。
25. 不要使用 layout_page、slotId 或可见模板框来做普通讲解。白板应像一张白纸/黑板，老师在上面直接写写画画；长段落用显式 x/y/width/height 的 write_paragraph，并从标题下方至少 60px 开始。
26. 短物理计算题通常控制在 4–5 页、45–80 条命令。完整图示只在图示关系页出现；推导页不要重复复制整套小图，必要时只放 3–6 个元素的极简参照。磁场题不要铺满很多 ×/· 磁场符号，3–6 个足够。
27. 物理过程的分段关系优先用彩色线段、箭头、段名标签和公式标签表达；不要用 draw_brace 横跨大半个图去括运动轨迹。大括号只适合短范围分组，跨度过长会抢画面重点。
28. 旁白避免“写出来”“写成”“画出”“下一步要做的是写……”这类操作感说法；开场可以直接朗读原题或复述问题，但不要说“我来念一遍”这类描述动作的话。后续改成“关系是……”“可以得到……”“关键在于……”“把两个力相等理解成……”。
29. knowledgeSummary 是给学生随时点开的速查卡，不是另一段讲解稿。只写干货：概念名、公式、适用条件、关键原理、易错点。每条 explanation 控制在 15–40 个中文字符，像笔记一样短；不要写“这里整理了”“本节课主要”“你会发现”这类套话。background 只放真正必要的前置知识，没有就空数组。
30. 不要为了排版画装饰性框、卡片、模板槽位。只有真正需要表示集合、流程节点、结论范围时才用 draw_rectangle；普通讲解文字和公式不要套框。
31. 每个新的阶段必须使用唯一 pageId。不要对同一个 pageId 反复 switch_page 后继续堆内容；这会把旧页面内容恢复出来并与新内容重叠。需要新页面就创建新的 pageId，例如 formulas_2、summary_2。
32. 生成每一页时必须在心里维护一个“白板状态矩阵”：按当前页/当前场景记录已创建对象的 bbox 和 6×4 网格占用。这个规则适用于所有学科和所有讲解类型，不只适用于几何题。写下一条命令前，先检查当前页已有对象和矩阵占用；新文字、公式、段落、表格式信息、图形、箭头、坐标图、流程图、批注不要放进已占用或拥挤网格。若要复用区域，必须先 erase_object、clear_canvas，或 switch_page 新开一页；不要靠覆盖、贴边、压框来节省空间。
33. 文字/公式/段落是最高优先级可读对象：任何学科中，文字和公式都不能压住图形、箭头、坐标轴、流程节点、图片重构或其他文字。图形内部元素可以自然相交，但只要与文字/公式发生遮挡或贴得太近，就必须移动、擦除或拆页。
34. 每页先分区再落笔：常见分区包括“题干区、图示区、推导区、结论区、对比区、例子区”。一页中不要同时把长段落、主图、推导公式、总结结论都塞进同一片区域；信息密度过高时优先 switch_page，而不是缩小字号。
35. 动笔前要像老师看黑板一样先找空白区：先估算将要写/画的内容尺寸，短公式至少预留约 240×70，推导步骤或段落至少预留约 420×140，图示/图表至少预留约 420×260。只有找到能容纳内容的空白 bbox 才能落笔；找不到时，必须先擦除本页不再需要的对象，或直接 switch_page 新开一页。
36. 长公式不能横向硬塞。凡是含 \\Longleftrightarrow、\\Rightarrow、多个中文 \\text{...}、大分式或两边都很长的公式，优先改成 write_math_steps 拆成 2–4 行，或切到新页单独讲；不要把长公式放在图形右侧再延伸出画布。
37. move_object 只能移动此前已经创建出来的对象。不要用 move_object 做初始摆放；如果对象还没出现，直接在创建命令里设置最终 x/y/from/to 坐标。

以下是项目 AI_GUIDE 摘要：
${guideExcerpt}`;
}

function replaceSourceImagePlaceholders(
  script: WhiteboardScript,
  sourceImageDataUrl?: string,
): WhiteboardScript {
  if (!sourceImageDataUrl) return script;
  return {
    ...script,
    commands: script.commands.map((command) =>
      command.type === "draw_image" && command.src === SOURCE_IMAGE_PLACEHOLDER
        ? { ...command, src: sourceImageDataUrl }
        : command,
    ),
  };
}

function sourceImageCommandForScript(
  script: WhiteboardScript,
  imageAnchors: ImageAnchor[],
  sourceImageSize?: SourceImageSize,
): Extract<WhiteboardCommand, { type: "draw_image" }> {
  const canvasWidth = script.canvas.width || 1200;
  const canvasHeight = script.canvas.height || 800;
  const maxWidth = Math.max(320, canvasWidth - 80);
  const maxHeight = Math.max(260, canvasHeight - 160);
  const ratio =
    sourceImageSize && sourceImageSize.width > 0 && sourceImageSize.height > 0
      ? sourceImageSize.width / sourceImageSize.height
      : 16 / 9;
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  return {
    type: "draw_image",
    id: "source_question",
    src: SOURCE_IMAGE_PLACEHOLDER,
    x: Math.round((canvasWidth - width) / 2),
    y: Math.round(Math.max(60, (canvasHeight - height) / 2 - 20)),
    width: Math.round(width),
    height: Math.round(height),
    radius: 8,
    anchors: imageAnchors.length > 0 ? imageAnchors : undefined,
    duration: 5200,
    narration: "先看原题图，关键位置直接在图上指给你看。",
  };
}

function ensureSourceImagePage(
  script: WhiteboardScript,
  hasSourceImage: boolean,
  imageAnchors: ImageAnchor[],
  sourceImageSize?: SourceImageSize,
): WhiteboardScript {
  if (!hasSourceImage) return script;
  if (script.commands.some((command) => command.type === "draw_image")) {
    return script;
  }

  const sourcePageId = "source_image_page";
  const mainPageId = "generated_explanation";
  const hasPages = Array.isArray(script.pages) && script.pages.length > 0;
  const firstGeneratedCommand = script.commands[0];
  const generatedAlreadySwitches = firstGeneratedCommand?.type === "switch_page";
  const pages = [
    { id: sourcePageId, title: "原题图" },
    ...(hasPages ? script.pages!.filter((page) => page.id !== sourcePageId) : [{ id: mainPageId, title: "讲解" }]),
  ];
  const sourceCommands: WhiteboardCommand[] = [
    {
      type: "switch_page",
      pageId: sourcePageId,
      title: "原题图",
      duration: 300,
    },
    sourceImageCommandForScript(script, imageAnchors, sourceImageSize),
    imageAnchors[0]
      ? {
          type: "laser_pointer",
          id: "source_question_pointer",
          x: 0,
          y: 0,
          imageAnchor: imageAnchors[0].id,
          duration: 900,
          style: "pulse",
        }
      : {
          type: "laser_pointer",
          id: "source_question_pointer",
          x: Math.round(script.canvas.width / 2),
          y: Math.round(script.canvas.height / 2),
          duration: 900,
          style: "pulse",
        },
  ];
  const originalCommands = generatedAlreadySwitches
    ? script.commands
    : [
        {
          type: "switch_page",
          pageId: mainPageId,
          title: "讲解",
          duration: 300,
        } satisfies Extract<WhiteboardCommand, { type: "switch_page" }>,
        ...script.commands,
      ];

  return {
    ...script,
    pages,
    commands: [...sourceCommands, ...originalCommands],
  };
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeImageAnchor(anchor: Partial<ImageAnchor>): ImageAnchor | undefined {
  const id = typeof anchor.id === "string" ? anchor.id.trim() : "";
  if (!id) return undefined;
  let bbox: ImageAnchor["bbox"];
  if (Array.isArray(anchor.bbox) && anchor.bbox.length === 4 && anchor.bbox.every((value) => typeof value === "number")) {
    const x = clamp01(anchor.bbox[0]);
    const y = clamp01(anchor.bbox[1]);
    const width = Math.max(0.001, Math.min(1 - x, anchor.bbox[2]));
    const height = Math.max(0.001, Math.min(1 - y, anchor.bbox[3]));
    bbox = [x, y, width, height];
  }
  let point: ImageAnchor["point"];
  if (Array.isArray(anchor.point) && anchor.point.length === 2 && anchor.point.every((value) => typeof value === "number")) {
    point = [clamp01(anchor.point[0]), clamp01(anchor.point[1])];
  }
  if (!bbox && !point) return undefined;
  return {
    id,
    label: typeof anchor.label === "string" ? anchor.label.trim().slice(0, 80) : undefined,
    bbox,
    point,
  };
}

function normalizeImageAnchors(anchors: unknown): ImageAnchor[] {
  if (!Array.isArray(anchors)) return [];
  const seen = new Set<string>();
  const normalized: ImageAnchor[] = [];
  for (const raw of anchors) {
    if (!raw || typeof raw !== "object") continue;
    const anchor = normalizeImageAnchor(raw as Partial<ImageAnchor>);
    if (!anchor || seen.has(anchor.id)) continue;
    seen.add(anchor.id);
    normalized.push(anchor);
    if (normalized.length >= 24) break;
  }
  return normalized;
}

function imageVisibleRect(
  command: Extract<WhiteboardCommand, { type: "draw_image" }>,
  sourceImageSize?: SourceImageSize,
): Rect {
  if (!sourceImageSize?.width || !sourceImageSize.height || sourceImageSize.width <= 0 || sourceImageSize.height <= 0) {
    return { x: command.x, y: command.y, width: command.width, height: command.height };
  }
  const sourceRatio = sourceImageSize.width / sourceImageSize.height;
  const boxRatio = command.width / command.height;
  if (!Number.isFinite(sourceRatio) || !Number.isFinite(boxRatio)) {
    return { x: command.x, y: command.y, width: command.width, height: command.height };
  }
  if (boxRatio > sourceRatio) {
    const width = command.height * sourceRatio;
    return { x: command.x + (command.width - width) / 2, y: command.y, width, height: command.height };
  }
  const height = command.width / sourceRatio;
  return { x: command.x, y: command.y + (command.height - height) / 2, width: command.width, height };
}

function anchorRectToCanvas(
  imageCommand: Extract<WhiteboardCommand, { type: "draw_image" }>,
  anchor: ImageAnchor,
  sourceImageSize?: SourceImageSize,
): Rect {
  const visible = imageVisibleRect(imageCommand, sourceImageSize);
  if (anchor.bbox) {
    return {
      x: visible.x + anchor.bbox[0] * visible.width,
      y: visible.y + anchor.bbox[1] * visible.height,
      width: anchor.bbox[2] * visible.width,
      height: anchor.bbox[3] * visible.height,
    };
  }
  const point = anchor.point ?? [0.5, 0.5];
  return {
    x: visible.x + point[0] * visible.width - 18,
    y: visible.y + point[1] * visible.height - 18,
    width: 36,
    height: 36,
  };
}

function anchorPointToCanvas(rect: Rect): [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}

function materializeImageAnchors(
  script: WhiteboardScript,
  imageAnchors: ImageAnchor[] = [],
  sourceImageSize?: SourceImageSize,
): WhiteboardScript {
  if (imageAnchors.length === 0) return script;
  let sourceImage: Extract<WhiteboardCommand, { type: "draw_image" }> | undefined;
  for (const command of script.commands) {
    if (command.type === "draw_image") {
      sourceImage = command;
      break;
    }
  }
  if (!sourceImage) return script;
  const anchorMap = new Map<string, ImageAnchor>();
  for (const anchor of [...imageAnchors, ...(sourceImage.anchors ?? [])]) {
    anchorMap.set(anchor.id, anchor);
  }
  const resolveRect = (id?: string) => {
    if (!id) return undefined;
    const anchor = anchorMap.get(id);
    return anchor ? anchorRectToCanvas(sourceImage, anchor, sourceImageSize) : undefined;
  };
  return {
    ...script,
    commands: script.commands.map((command) => {
      if (command.type === "draw_image") {
        return {
          ...command,
          anchors: imageAnchors.length > 0 ? imageAnchors : command.anchors,
        };
      }
      if (command.type === "laser_pointer" && command.imageAnchor) {
        const rect = resolveRect(command.imageAnchor);
        if (!rect) return command;
        const [x, y] = anchorPointToCanvas(rect);
        return { ...command, x, y, imageAnchor: undefined };
      }
      if (command.type === "annotate_circle" && command.imageAnchor) {
        const rect = resolveRect(command.imageAnchor);
        if (!rect) return command;
        return {
          ...command,
          cx: rect.x + rect.width / 2,
          cy: rect.y + rect.height / 2,
          rx: Math.max(18, rect.width / 2 + 8),
          ry: Math.max(14, rect.height / 2 + 8),
          imageAnchor: undefined,
        };
      }
      if (command.type === "draw_arrow" && (command.fromImageAnchor || command.toImageAnchor)) {
        const fromRect = resolveRect(command.fromImageAnchor);
        const toRect = resolveRect(command.toImageAnchor);
        return {
          ...command,
          from: fromRect ? anchorPointToCanvas(fromRect) : command.from,
          to: toRect ? anchorPointToCanvas(toRect) : command.to,
          fromImageAnchor: undefined,
          toImageAnchor: undefined,
        };
      }
      return command;
    }),
  };
}

function materializeImageAnchoredPayload(
  current: AiScriptPayloadDraft,
  imageAnchors: ImageAnchor[],
  sourceImageSize?: SourceImageSize,
): AiScriptPayloadDraft {
  if (!current.script || imageAnchors.length === 0) return current;
  const script = materializeImageAnchors(current.script, imageAnchors, sourceImageSize);
  return { ...current, script, scriptText: stringifyScript(script) };
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
  options: {
    sourceImageDataUrl?: string;
    imageAnchors?: ImageAnchor[];
    sourceImageSize?: SourceImageSize;
    boardTheme?: BoardTheme;
    canvasAspect?: CanvasAspect;
  } = {},
): Promise<AiScriptResult> {
  const guideExcerpt = await readGuideExcerpt();
  const sourceImageDataUrl = options.sourceImageDataUrl?.trim();
  const hasSourceImage = Boolean(sourceImageDataUrl);
  const imageAnchors = normalizeImageAnchors(options.imageAnchors);
  const sourceImageSize =
    options.sourceImageSize &&
    Number.isFinite(options.sourceImageSize.width) &&
    Number.isFinite(options.sourceImageSize.height) &&
    options.sourceImageSize.width > 0 &&
    options.sourceImageSize.height > 0
      ? options.sourceImageSize
      : undefined;
  const rounds: AiScriptResult["rounds"] = [];
  const boardTheme = normalizeBoardTheme(options.boardTheme);
  const canvasAspect = normalizeCanvasAspect(options.canvasAspect);
  const canvasSize = canvasSizeForAspect(canvasAspect);
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

白板背景要求：
${boardTheme === "dark"
  ? `本次必须生成黑色白板版本。canvas.background 必须使用 "${defaultCanvasBackground("dark")}"，canvas.theme 必须写 "dark"。所有文字、公式、线条、坐标轴、几何图、标注和默认墨迹都要适配黑底：主文字用接近白色的浅色，辅助线和网格用中高亮度灰色，浅色填充要改成深色低透明填充。不要输出黑色或深灰文字/线条。`
  : `本次生成默认白色白板版本。canvas.background 使用 "#ffffff"，canvas.theme 可写 "light" 或省略。`}

画面比例要求：
${canvasAspect === "portrait"
  ? `本次必须生成 9:16 手机短视频竖屏版本。canvas.width 必须是 ${canvasSize.width}，canvas.height 必须是 ${canvasSize.height}。按 4 列 × 8 行理解竖屏画布，内容从上到下分段推进；标题和结论不要横向铺太宽，长句必须用 write_paragraph 自动换行，图形和推导优先上下排列。`
  : `本次生成标准横版白板。canvas.width 建议是 ${canvasSize.width}，canvas.height 建议是 ${canvasSize.height}。`}

布局规划要求：
在生成 scriptLines 前，先按“页/场景”规划白板状态矩阵。当前画布为 ${canvasSize.width}×${canvasSize.height}，${canvasAspect === "portrait" ? "按 4 列 × 8 行理解：R1C1 在左上，R8C4 在右下。" : "按 6 列 × 4 行理解：R1C1 在左上，R4C6 在右下。"}每添加一条可见命令后，更新该对象的 bbox、占用网格和剩余 freeRegions；下一条可见命令必须先估算自身尺寸，再放进能容纳它的空白 bbox。短公式至少预留约 240×70，推导步骤或段落至少预留约 420×140，图示/图表至少预留约 420×260。找不到足够空白区时，必须先 erase_object/clear_canvas 清理不再需要的对象，或 switch_page 新开一页。长段落使用显式 x/y/width/height 的 write_paragraph；不要使用 layout_page、slotId 或模板框。

原题图片资源：
${hasSourceImage ? `系统已提供原题图片资源。需要展示题图时，使用 draw_image，src 必须写成 "${SOURCE_IMAGE_PLACEHOLDER}"。不要把图片改写成 URL，不要输出 base64。${sourceImageSize ? `原图尺寸约 ${sourceImageSize.width}×${sourceImageSize.height}，宽高比 ${(sourceImageSize.width / sourceImageSize.height).toFixed(2)}。` : ""}` : "本次未提供原题图片资源；如题目有图示，需要用白板命令重构关键图形关系。"}

图片定位锚点：
${imageAnchors.length > 0 ? `视觉识别已给出这些原题图关键区域（bbox/point 均为 0~1 归一化坐标）：\n${JSON.stringify(imageAnchors, null, 2)}\n需要指示图片局部时，优先在 laser_pointer 写 imageAnchor；圈画局部时用 annotate_circle 的 imageAnchor；箭头端点可用 fromImageAnchor/toImageAnchor。后端会把锚点换算成白板坐标。` : "本次没有可用图片锚点；如需指示原图局部，只能估算图片内位置。"}

带图题处理要求：
${hasSourceImage ? `如果用户需求包含“图片/图示内容”或 OCR 提到图甲/图乙/图丙、坐标图、F-t、v-t、折线、阶梯、虚线、表格等内容，优先把原题图片放在白板上，旁边写关键关系，并用 laser_pointer、箭头、短标签在原图上指示。除非为了讲解必要，不要完整复刻原图。` : `如果用户需求包含“图片/图示内容”或 OCR 提到图甲/图乙/图丙、坐标图、F-t、v-t、折线、阶梯、虚线、表格等内容，必须在白板上重构这些关键结构。特别是物理图像题：装置图要画物体、墙/面、箭头和已知量；F-t/v-t 等图像要用 draw_coordinate_system + draw_coordinate_segment 按识别出的每一段画全，例如 0～2、2～4、4～6 都要有对应线段，不能留下空坐标系，不能只画斜线而漏掉水平段。`}
${hasSourceImage ? "本次已有原题图片资源：除非用户明确要求重画图，不要再用 draw_coordinate_system 复刻题图中的 F-t/v-t 图，也不要重画装置图。直接在原图上用锚点标注，并在旁边写核心公式/判断即可。" : ""}
${hasSourceImage && sourceImageSize && sourceImageSize.width / sourceImageSize.height > 1.8 ? "本次原图是横向长图：第一页必须让原图独占主要画面，最多加少量锚点指示；所有公式推导、选项判断和答案必须放到第二页或后续页面，不能和 source_question 同页重叠。" : ""}
${hasSourceImage ? "原图模式下严禁把多个推导块挤在一页：每个讲解页最多一个 write_math_steps，公式块高度要预留 280px 以上；选项判断放不下时必须 switch_page。宁可多一页，也不要让 text_24、steps_c、math_mu 这类对象互相重叠。" : ""}

请同时给出 explanation，说明这份脚本如何讲解，以及为什么这样安排。
请同时给出 knowledgeSummary：它是课中速查卡，只总结干货。overview 不超过 40 个中文字符；每条 explanation 不超过 40 个中文字符；concepts/formulas/principles/background 合计尽量 6–10 条。不要写背景故事、课堂话术或泛泛解释。followUpPrompt 要能直接用于再生成一节专题讲解课。
注意：scriptLines 是完整 JSON 脚本文本按行拆成的字符串数组。每一项放一行 JSON 文本，后端会 join("\\n")；不要把完整脚本放进单个超长字符串。`,
    signal,
  });
  const firstDurationMs = elapsedMs(firstStartedAt);

  let current = materializeImageAnchoredPayload(
    normalizeAiScriptPayloadDraft(first.json),
    imageAnchors,
    sourceImageSize,
  );
  let check = preflightScriptText(current.scriptText);
  let best =
    current.script
      ? {
          current,
          check,
        }
      : undefined;
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

白板背景要求：
${boardTheme === "dark"
  ? `修复后仍必须是黑色白板版本：canvas.background 使用 "${defaultCanvasBackground("dark")}"，canvas.theme 写 "dark"，文字、公式、线条、坐标轴和标注都必须是黑底可读的浅色或高对比强调色。`
  : `修复后保持默认白色白板版本。`}

预检报告：
${reportForPrompt(check.report)}

当前白板状态矩阵（按页列出已占用网格、对象 bbox、可用 freeRegions；修复时必须先选择能容纳内容的 freeRegion，或显式擦除/换页）：
${check.script ? whiteboardStateForPrompt(check.script) : "脚本未通过 schema 校验，暂无状态矩阵。"}

当前脚本：
${current.scriptText}

请输出修复后的完整 JSON，包含 explanation、scriptLines、knowledgeSummary，其中 scriptLines 是完整 JSON 脚本文本按行拆成的字符串数组。knowledgeSummary 要和修复后的脚本内容保持一致。`,
      signal,
    });
    const repairDurationMs = elapsedMs(repairStartedAt);
    current = materializeImageAnchoredPayload(
      normalizeAiScriptPayloadDraft(repaired.json),
      imageAnchors,
      sourceImageSize,
    );
    check = preflightScriptText(current.scriptText);
    if (
      current.script &&
      (!best || preflightScore(check.report) < preflightScore(best.check.report))
    ) {
      best = { current, check };
    }
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

  if (best && (!current.script || preflightScore(best.check.report) < preflightScore(check.report))) {
    console.warn(
      `[ai-script] using best valid round instead of latest round: ${best.check.report.summary}`,
    );
    current = best.current;
    check = best.check;
  }

  if (!current.script) {
    console.warn(`[ai-script] final failed report: ${reportForPrompt(check.report)}`);
    const firstIssue =
      check.report.issues.find((issue) => issue.severity === "error") ?? check.report.issues[0];
    throw new Error(
      `AI 修复后仍未得到可用脚本：${check.report.summary}${
        firstIssue ? ` 首个问题：${firstIssue.message}` : ""
      }`,
    );
  }

  const normalizedFinalScript = replaceSourceImagePlaceholders(
    materializeImageAnchors(
      ensureSourceImagePage(
        normalizeGeneratedScript(current.script),
        hasSourceImage,
        imageAnchors,
        sourceImageSize,
      ),
      imageAnchors,
      sourceImageSize,
    ),
    sourceImageDataUrl,
  );
  const finalScript = applyBoardTheme(normalizedFinalScript, boardTheme);
  const finalScriptText = stringifyScript(finalScript);
  const finalCheck = preflightScriptText(finalScriptText);
  if (finalCheck.report.errors > 0) {
    console.warn(`[ai-script] final normalized script still invalid: ${reportForPrompt(finalCheck.report)}`);
    const firstIssue =
      finalCheck.report.issues.find((issue) => issue.severity === "error") ??
      finalCheck.report.issues[0];
    throw new Error(
      `AI 修复后仍未得到可用脚本：${finalCheck.report.summary}${
        firstIssue ? ` 首个问题：${firstIssue.message}` : ""
      }`,
    );
  }

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
        imageAnchors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              bbox: {
                type: "array",
                items: { type: "number" },
                minItems: 4,
                maxItems: 4,
              },
              point: {
                type: "array",
                items: { type: "number" },
                minItems: 2,
                maxItems: 2,
              },
            },
            required: ["id", "label", "bbox", "point"],
            additionalProperties: false,
          },
        },
        subject: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        notes: { type: "string" },
      },
      required: ["problemText", "diagramDescription", "imageAnchors", "subject", "confidence", "notes"],
      additionalProperties: false,
    },
    instructions: `你是面向 AI Whiteboard 的题目图片 OCR 与理解助手。

任务：
1. 从图片中提取完整题目文本，包括题干、选项、已知条件、图中文字、坐标、角标、表格内容、单位等。
2. 必须单独提取图片/图示部分，写入 diagramDescription。图片部分包括几何图、函数图、物理装置图、受力图、光路图、电路图、统计图、表格、实验示意图、流程图等。
3. diagramDescription 要足够支持后续白板重构：描述图中对象、位置关系、箭头方向、标注文字、数据、角度、坐标、连接关系、实验器材、状态变化等。
3a. 如果图中有坐标图、函数图、F-t/v-t/s-t 等物理图像、折线图、阶梯图或统计图，diagramDescription 必须逐个图列出：坐标轴名称和单位、横纵轴刻度、每一段数据线段的起点/终点或区间和值、水平段/斜线段/零值段、虚线辅助线、图下注记。不要只写“已知 F-t 图和 v-t 图”。
4. 输出 imageAnchors：提取 6~16 个后续讲解最可能指示或圈画的关键区域。坐标使用相对整张图片左上角的归一化坐标，范围 0~1。每个锚点必须同时提供 bbox 和 point：bbox 格式为 [x,y,width,height]，point 是 bbox 中心点或最适合激光笔落点的位置 [x,y]。id 用简短英文/拼音/数字下划线，例如 "ft_2_4_segment"、"option_a"、"left_block"。锚点要覆盖图表曲线段、关键刻度、物体、箭头、选项、题干已知量等。
5. 不要解题，不要生成白板脚本，只做题目识别与结构化转写。
6. 如果局部看不清，用“[看不清]”标出来，不要编造。
7. 输出 JSON：{"problemText":"...","diagramDescription":"...","imageAnchors":[...],"subject":"...","confidence":"high|medium|low","notes":"..."}。所有字段都必须出现；没有可写内容时用空字符串或空数组。`,
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
    imageAnchors: normalizeImageAnchors(payload.imageAnchors),
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

当前白板状态矩阵（按页列出已占用网格、对象 bbox、可用 freeRegions；优化时必须先看这里，新增内容只能放进足够容纳它的 freeRegion。找不到空白区时先擦除或换页）：
${check.script ? whiteboardStateForPrompt(check.script) : "脚本未通过 schema 校验，暂无状态矩阵。"}

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
