import fs from "node:fs/promises";
import path from "node:path";
import {
  validateScript,
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

export type AiScriptResult = {
  scriptText: string;
  script: WhiteboardScript;
  explanation: string;
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
const DEFAULT_MAX_ROUNDS = 3;
const PERPLEXITY_AGENT_URL = "https://api.perplexity.ai/v1/agent";

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
    width += /[\u4e00-\u9fff]/.test(char) ? fontSize : fontSize * 0.56;
  }
  return width;
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
    pageId: string;
    id: string;
    command: WhiteboardCommand;
    commandIndex: number;
    bbox: { x: number; y: number; width: number; height: number };
  }> = [];
  const rectangles: Array<{
    pageId: string;
    command: Extract<WhiteboardCommand, { type: "draw_rectangle" }>;
    commandIndex: number;
  }> = [];
  const mathLogicItems: MathLogicItem[] = [];
  let currentPageId = script.pages?.[0]?.id ?? "default";
  const pageObjectCounts = new Map<string, number>();

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
      textBboxes.push({ pageId: currentPageId, id: command.id, command, commandIndex: index, bbox });
      checkRect(
        issues,
        script,
        command,
        index,
        bbox,
        "文本",
      );
    }

    if (command.type === "write_text_segments") {
      const text = command.segments.map((segment) => segment.text).join("");
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
        pageId: currentPageId,
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
    }

    if (command.type === "write_math") {
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
        {
          x: command.x,
          y: command.y,
          width: Math.max(command.fontSize * 3, command.latex.length * command.fontSize * 0.42),
          height: command.fontSize * (command.displayMode ? 1.8 : 1.35),
        },
        "数学公式",
      );
    }

    if (command.type === "write_math_steps") {
      command.steps.forEach((step, stepIndex) => {
        mathLogicItems.push({
          command,
          commandIndex: index,
          expression: step,
          label: `${command.id} 第 ${stepIndex + 1} 行`,
        });
      });
      const maxLength = Math.max(...command.steps.map((step) => step.length));
      checkRect(
        issues,
        script,
        command,
        index,
        {
          x: command.x,
          y: command.y,
          width: Math.max(command.fontSize * 4, maxLength * command.fontSize * 0.42),
          height: (command.lineGap ?? command.fontSize * 1.45) * command.steps.length,
        },
        "公式步骤",
      );
    }

    if (command.type === "draw_rectangle") {
      rectangles.push({ pageId: currentPageId, command, commandIndex: index });
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
        "一页只讲一个小问题；把后续推导或答案拆到下一页，用 switch_page 翻页。",
      );
    }
  }

  for (const { pageId, command: rect, commandIndex } of rectangles) {
    const rectBox = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
    const nearbyTexts = textBboxes.filter(
      (text) => text.pageId === pageId && rectsOverlap(rectBox, text.bbox, 0),
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
    parsed = JSON.parse(scriptText);
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
    "## 1. 工具定位",
    "## 2. 顶层 Schema",
    "## 3. 命令类型",
    "## 5. 生成策略",
    "## 6. 自检清单",
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
}) {
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
  return {
    model: typeof body?.model === "string" ? body.model : model,
    json: extractJsonObject(text),
  };
}

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function normalizeAiScriptPayload(payload: any): {
  script: WhiteboardScript;
  scriptText: string;
  explanation: string;
} {
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
  };
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
2. 输出格式必须是 {"explanation": "...", "scriptText": "{\\"canvas\\": {...}, \\"commands\\": [...]}"}。
3. scriptText 必须是一个字符串，字符串内容必须是 AI Whiteboard 播放器可直接运行的完整 JSON 脚本。
4. 每条有 narration 的教学动作，附近必须有 laser_pointer 指示。优先使用 to 或 path 做顺滑移动。
5. 小数字、短词、变量的强调优先用 write_text_segments + emphasize_text，不要用大圈硬套小目标。
6. 初中数学优先使用 write_math、write_math_steps、draw_coordinate_system、draw_function、plot_point、draw_coordinate_segment 等结构化命令。
7. 不要使用预生成板书图片或遮罩揭示路线。
8. 画面要留白，避免文字、图形、框、箭头互相压住。
9. 不要默认给文字和公式套矩形框；只有题目区、结论区、流程节点、真正需要分组的区域才使用 draw_rectangle。
10. 圈画要谨慎；不要用 annotate_circle 圈小数字、短词或已经很明显的内容。优化脚本时应删除无意义框线和圈画，或改成 emphasize_text。
11. narration 要像亲和、有耐心、会打比方的老师在讲课。不要机械播报；允许适度重复、适度啰嗦、接地气类比和轻微幽默。关键概念可以换说法重复强调，帮助学生慢慢听懂。
12. 完整讲题必须优先使用多页白板：顶层写 pages，并用 switch_page 分阶段切换。不要把读题、分析、计算、总结硬塞进一页。一页只讲一个小问题；如果一页主要对象超过 12–14 个，要拆到下一页。
13. 数学推导必须逻辑完整：任何公式行都不能以等号结尾；最终答案出现前，推导链必须显式算到该答案。例如不要写 "M - 2 =" 或 "M = 30 + 2 ="，必须写成 "M - 2 = 30" 和 "M = 30 + 2 = 32"。
14. 几何证明必须优先使用几何专用命令：draw_point、draw_segment、draw_ray、draw_angle、mark_equal_segments、mark_parallel、mark_perpendicular、highlight_polygon。不要用普通圈画猜点位；辅助线、角标、等长、平行、垂直和全等区域都要用结构化几何命令表达。
15. 复杂几何构造或图片题重构优先使用 construct_geometry，让 JSXGraph 辅助构造层计算垂足、交点和外接圆，不要手动猜 E/F/H 等构造点坐标；constructions 必须按依赖顺序书写。
16. 讲解题目之前，必须先安排“读题”阶段：把题干主要信息读给学生听，并在白板上展示题目关键词。
17. 读题之后，必须安排“题干分析”阶段：帮学生拆出已知条件、要求什么、图示表达了什么、应该抓哪个物理/数学关系。
18. 如果用户输入来自题目图片，且包含图示、表格、实验装置、几何图或函数图，不能只讲文字题干；必须在白板上重构图示的关键结构。物理题优先用矩形、线段、箭头、标签重构装置/过程/受力/光路/电路等；几何题优先用几何专用命令或 construct_geometry；函数题优先用坐标系和函数图像。
19. 不要生成 wait 命令，不要安排“等待用户点击下一步”的互动等待点。播放器已经有暂停/继续功能，学生需要思考时会自行暂停。

以下是项目 AI_GUIDE 摘要：
${guideExcerpt}`;
}

function explanationModeInstructions(mode: AiExplanationMode) {
  if (mode === "concise") {
    return `讲解模式：简洁讲解。

必须遵守：
1. 用户大概率已经读过题、思考过一段时间；不要完整从头铺开讲。
2. 只给一个小提示，围绕最根本、最容易卡住的关键点讲清楚即可。
3. 总页数控制在 1–2 页，命令数量尽量控制在 8–18 条。
4. narration 总量要短，通常 1–2 句核心提示即可；不要做完整推导和长篇总结。
5. 即使简洁，也必须配合白板动作：至少写出关键条件/关键关系，用激光笔指向卡点；带图题至少画出决定解题的关键图示局部或关系。
6. 如果题目来自图片，不必完整重画所有细节，只重构最影响判断的图形关系。`;
  }

  return `讲解模式：详细讲解。

必须遵守：
1. 采用完整课堂讲解：先读题，再分析题干与已知条件，然后逐步讲解解法，最后总结答案。
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
    instructions: `${baseInstructions(guideExcerpt)}

${explanationModeInstructions(mode)}`,
    input: `请根据用户需求生成一份完整 AI Whiteboard 白板讲解脚本。

用户需求：
${prompt}

请同时给出 explanation，说明这份脚本如何讲解，以及为什么这样安排。
注意：scriptText 必须是完整 JSON 脚本字符串，不是对象。`,
    signal,
  });
  const firstDurationMs = elapsedMs(firstStartedAt);

  let current = normalizeAiScriptPayload(first.json);
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

  for (let round = 2; round <= maxRounds && needsAiRepair(check.report); round++) {
    const repairStartedAt = performance.now();
    const repaired = await callPerplexityJson({
      model: repairModel,
      instructions: `${baseInstructions(guideExcerpt)}

${explanationModeInstructions(mode)}`,
      input: `请修复下面这份 AI Whiteboard 脚本。保持原教学意图，但必须解决预检报告中的错误和风险。

预检报告：
${reportForPrompt(check.report)}

当前脚本：
${current.scriptText}

请输出修复后的完整 JSON，格式仍然是 {"explanation": "...", "scriptText": "..."}，其中 scriptText 是完整 JSON 脚本字符串。`,
      signal,
    });
    const repairDurationMs = elapsedMs(repairStartedAt);
    current = normalizeAiScriptPayload(repaired.json);
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
  }

  return {
    ...current,
    report: check.report,
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

  for (let round = 1; round <= maxRounds; round++) {
    if (!needsAiRepair(check.report) && round > 1) break;
    const repaired = await callPerplexityJson({
      model: repairModel,
      instructions: baseInstructions(guideExcerpt),
      input: `请检查并优化下面这份 AI Whiteboard 脚本。

用户额外要求：
${userInstruction?.trim() || "无"}

预检报告：
${reportForPrompt(check.report)}

当前脚本：
${currentText}

请修复错误、降低布局风险，并按 AI_GUIDE 优化激光笔、数学表达、强调方式。输出完整 JSON：{"explanation": "...", "scriptText": "..."}，其中 scriptText 是完整 JSON 脚本字符串。`,
      signal,
    });
    const normalized = normalizeAiScriptPayload(repaired.json);
    currentText = normalized.scriptText;
    currentScript = normalized.script;
    explanation = normalized.explanation;
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

  return {
    scriptText: currentText,
    script: currentScript,
    explanation,
    report: check.report,
    rounds,
  };
}
