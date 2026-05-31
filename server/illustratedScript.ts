import type {
  WhiteboardCommand,
  WhiteboardScript,
} from "../client/src/whiteboard/commandTypes";

export type IllustrationAssetInput = {
  id?: string;
  title?: string;
  caption?: string;
  narration?: string;
  dataUrl: string;
  pageId?: string;
  keywords?: string[];
};

export type IllustrationAsset = {
  id: string;
  title: string;
  caption: string;
  narration: string;
  dataUrl: string;
  pageId?: string;
  keywords: string[];
};

export type IllustrationSuggestion = {
  pageId: string;
  title: string;
  score: number;
  reason: string;
  keywords: string[];
};

export type IllustrationEnhancementResult = {
  script: WhiteboardScript;
  scriptText: string;
  suggestions: IllustrationSuggestion[];
  inserted: Array<{
    assetId: string;
    pageId: string;
    illustrationPageId: string;
    title: string;
  }>;
  skipped: Array<{
    assetId?: string;
    reason: string;
  }>;
};

type PageSection = {
  pageId: string;
  title: string;
  commandStart: number;
  commandEnd: number;
  text: string;
};

const MAX_ILLUSTRATION_ASSETS = 8;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/;

const concreteObjectKeywords = [
  "桥",
  "道路",
  "高架",
  "电线杆",
  "水库",
  "隧道",
  "搅拌车",
  "搅拌站",
  "工地",
  "模板",
  "骨料",
  "水泥浆",
  "钢筋",
  "大坝",
  "山体",
  "锚杆",
  "火山",
  "细胞",
  "器官",
  "植物",
  "电路",
  "实验",
  "装置",
  "地图",
  "路线",
  "苹果",
  "水池",
  "商店",
];

const structureKeywords = [
  "内部",
  "剖面",
  "结构",
  "组成",
  "材料",
  "骨架",
  "搭档",
  "保护",
  "来源",
  "层层",
];

const processKeywords = [
  "制造",
  "搅拌",
  "运输",
  "泵送",
  "浇筑",
  "振捣",
  "养护",
  "凝固",
  "反应",
  "水化",
  "喷射",
  "加固",
  "演变",
  "回收",
];

function commandText(command: WhiteboardCommand) {
  const parts: string[] = [];
  if ("title" in command && typeof command.title === "string") parts.push(command.title);
  if ("text" in command && typeof command.text === "string") parts.push(command.text);
  if ("narration" in command && typeof command.narration === "string") {
    parts.push(command.narration);
  }
  if (command.type === "write_text_segments") {
    parts.push(command.segments.map((segment) => segment.text).join(""));
  }
  return parts.join(" ");
}

function normalizeText(value: unknown, fallback = "", limit = 120) {
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\s+/g, " ").slice(0, limit)
    : fallback;
}

function safeId(value: string) {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 48);
  return ascii || `asset_${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueId(base: string, used: Set<string>) {
  let id = base;
  let index = 2;
  while (used.has(id)) {
    id = `${base}_${index}`;
    index++;
  }
  used.add(id);
  return id;
}

function normalizeKeywords(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const keyword = normalizeText(item, "", 20);
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    output.push(keyword);
    if (output.length >= 8) break;
  }
  return output;
}

export function normalizeIllustrationAssets(
  rawAssets: unknown,
): { assets: IllustrationAsset[]; skipped: IllustrationEnhancementResult["skipped"] } {
  const skipped: IllustrationEnhancementResult["skipped"] = [];
  if (!Array.isArray(rawAssets)) return { assets: [], skipped };

  const usedIds = new Set<string>();
  const assets: IllustrationAsset[] = [];
  for (const raw of rawAssets.slice(0, MAX_ILLUSTRATION_ASSETS)) {
    if (!raw || typeof raw !== "object") {
      skipped.push({ reason: "插图资产不是对象。" });
      continue;
    }
    const input = raw as Partial<IllustrationAssetInput>;
    const dataUrl = normalizeText(input.dataUrl, "", 20_000_000);
    const rawId = normalizeText(input.id, "", 80);
    if (!IMAGE_DATA_URL_PATTERN.test(dataUrl)) {
      skipped.push({ assetId: rawId || undefined, reason: "插图只接受 PNG/JPEG/WEBP data URL。" });
      continue;
    }
    const title = normalizeText(input.title, "插图讲解", 42);
    const caption = normalizeText(input.caption, title, 90);
    const id = uniqueId(safeId(rawId || title), usedIds);
    assets.push({
      id,
      title,
      caption,
      narration: normalizeText(input.narration, caption, 260),
      dataUrl,
      pageId: normalizeText(input.pageId, "", 80) || undefined,
      keywords: normalizeKeywords(input.keywords),
    });
  }
  return { assets, skipped };
}

function pageTitle(script: WhiteboardScript, pageId: string, fallback: string) {
  const page = script.pages?.find((item) => item.id === pageId);
  return normalizeText(page?.title, fallback, 42);
}

function buildPageSections(script: WhiteboardScript): PageSection[] {
  const sections: PageSection[] = [];
  let current: PageSection | null = null;
  const defaultPageId = script.pages?.[0]?.id ?? "main";

  for (let index = 0; index < script.commands.length; index++) {
    const command = script.commands[index];
    if (command.type === "switch_page") {
      if (current) {
        current.commandEnd = index;
        sections.push(current);
      }
      current = {
        pageId: command.pageId,
        title: normalizeText(command.title, pageTitle(script, command.pageId, command.pageId), 42),
        commandStart: index,
        commandEnd: script.commands.length,
        text: commandText(command),
      };
      continue;
    }
    if (!current) {
      current = {
        pageId: defaultPageId,
        title: pageTitle(script, defaultPageId, "讲解"),
        commandStart: 0,
        commandEnd: script.commands.length,
        text: "",
      };
    }
    const text = commandText(command);
    if (text) current.text += ` ${text}`;
  }
  if (current) sections.push(current);
  return sections.length > 0
    ? sections
    : [
        {
          pageId: defaultPageId,
          title: pageTitle(script, defaultPageId, "讲解"),
          commandStart: 0,
          commandEnd: script.commands.length,
          text: "",
        },
      ];
}

function countMatches(text: string, keywords: string[]) {
  return keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
}

export function suggestIllustrationSlots(script: WhiteboardScript, maxSlots = 6) {
  const sections = buildPageSections(script);
  const suggestions = sections
    .map((section) => {
      const text = `${section.title} ${section.text}`;
      const objects = countMatches(text, concreteObjectKeywords);
      const structures = countMatches(text, structureKeywords);
      const processes = countMatches(text, processKeywords);
      const mathSymbols = /\\frac|\\sqrt|[=＋+\-×÷*/^]|方程|竖式|证明|推导/.test(text) ? 1 : 0;
      const score = Math.max(
        0,
        Math.min(1, objects * 0.16 + structures * 0.13 + processes * 0.12 - mathSymbols * 0.12),
      );
      const keywords = [
        ...concreteObjectKeywords.filter((keyword) => text.includes(keyword)),
        ...structureKeywords.filter((keyword) => text.includes(keyword)),
        ...processKeywords.filter((keyword) => text.includes(keyword)),
      ].slice(0, 8);
      const reason =
        structures > 0
          ? "包含具体结构或内部组成，插图能降低理解成本。"
          : processes > 0
            ? "包含过程变化，插图适合作为视觉锚点。"
            : "包含具体对象或实际场景，插图能帮助建立画面。";
      return {
        pageId: section.pageId,
        title: section.title,
        score: Number(score.toFixed(2)),
        reason,
        keywords,
      };
    })
    .filter((item) => item.score >= 0.42 && item.keywords.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, maxSlots));
  return suggestions;
}

function assetMatchScore(asset: IllustrationAsset, section: PageSection) {
  if (asset.pageId && asset.pageId === section.pageId) return 10;
  const text = `${section.pageId} ${section.title} ${section.text}`;
  let score = 0;
  for (const keyword of asset.keywords) {
    if (text.includes(keyword)) score += 2;
  }
  if (asset.title && text.includes(asset.title)) score += 3;
  if (asset.caption && text.includes(asset.caption.slice(0, 12))) score += 1;
  return score;
}

function resolveAssetPages(script: WhiteboardScript, assets: IllustrationAsset[]) {
  const sections = buildPageSections(script);
  const suggestions = suggestIllustrationSlots(script, 8);
  const suggestedIds = new Set(suggestions.map((item) => item.pageId));
  const assignments: Array<{ asset: IllustrationAsset; section: PageSection }> = [];
  const usedPages = new Set<string>();

  for (const asset of assets) {
    const sorted = sections
      .map((section) => ({
        section,
        score: assetMatchScore(asset, section) + (suggestedIds.has(section.pageId) ? 0.5 : 0),
      }))
      .sort((a, b) => b.score - a.score);
    const picked =
      sorted.find((item) => item.score > 0 && !usedPages.has(item.section.pageId)) ??
      sorted.find((item) => item.score > 0) ??
      sections.find((section) => suggestedIds.has(section.pageId) && !usedPages.has(section.pageId)) ??
      sections.find((section) => !usedPages.has(section.pageId)) ??
      sections[0];
    if (!picked) continue;
    const section = "section" in picked ? picked.section : picked;
    assignments.push({ asset, section });
    usedPages.add(section.pageId);
  }
  return { assignments, suggestions };
}

function createIllustrationCommands(
  script: WhiteboardScript,
  asset: IllustrationAsset,
  pageId: string,
): WhiteboardCommand[] {
  const width = script.canvas.width || 1200;
  const height = script.canvas.height || 820;
  const imageWidth = Math.round(width * 0.72);
  const imageHeight = Math.round(height * 0.58);
  const imageX = Math.round((width - imageWidth) / 2);
  const imageY = 165;
  return [
    {
      type: "switch_page",
      pageId,
      title: asset.title,
      duration: 260,
    },
    {
      type: "write_text",
      id: `${pageId}_title`,
      text: asset.title,
      x: 64,
      y: 76,
      fontSize: 38,
      color: "#1f2937",
      bold: true,
      duration: 700,
    },
    {
      type: "draw_image",
      id: `${pageId}_image`,
      src: asset.dataUrl,
      x: imageX,
      y: imageY,
      width: imageWidth,
      height: imageHeight,
      radius: 12,
      duration: 900,
      narration: asset.narration,
    },
    {
      type: "write_paragraph",
      id: `${pageId}_caption`,
      text: asset.caption,
      x: 140,
      y: Math.min(height - 115, imageY + imageHeight + 28),
      width: width - 280,
      height: 80,
      fontSize: 26,
      color: "#334155",
      lineGap: 9,
      duration: 900,
    },
  ];
}

export function enhanceScriptWithIllustrations(
  script: WhiteboardScript,
  rawAssets: unknown,
): IllustrationEnhancementResult {
  const { assets, skipped } = normalizeIllustrationAssets(rawAssets);
  const { assignments, suggestions } = resolveAssetPages(script, assets);
  if (assignments.length === 0) {
    return {
      script,
      scriptText: JSON.stringify(script),
      suggestions,
      inserted: [],
      skipped: assets.length === 0 ? [...skipped, { reason: "没有可用插图资产。" }] : skipped,
    };
  }

  const existingPageIds = new Set(script.pages?.map((page) => page.id) ?? []);
  const insertedByCommandIndex = new Map<number, WhiteboardCommand[]>();
  const newPages = [...(script.pages ?? [])];
  const inserted: IllustrationEnhancementResult["inserted"] = [];
  const usedIds = new Set(existingPageIds);

  for (const { asset, section } of assignments) {
    const illustrationPageId = uniqueId(`illustration_${asset.id}`, usedIds);
    existingPageIds.add(illustrationPageId);
    newPages.push({ id: illustrationPageId, title: asset.title });
    const commands = createIllustrationCommands(script, asset, illustrationPageId);
    const current = insertedByCommandIndex.get(section.commandStart) ?? [];
    insertedByCommandIndex.set(section.commandStart, [...current, ...commands]);
    inserted.push({
      assetId: asset.id,
      pageId: section.pageId,
      illustrationPageId,
      title: asset.title,
    });
  }

  const commands: WhiteboardCommand[] = [];
  for (let index = 0; index < script.commands.length; index++) {
    const before = insertedByCommandIndex.get(index);
    if (before) commands.push(...before);
    commands.push(script.commands[index]);
  }
  const prepend = insertedByCommandIndex.get(0);
  if (script.commands.length === 0 && prepend) commands.push(...prepend);

  const enhanced = {
    ...script,
    pages: newPages,
    commands,
  };
  return {
    script: enhanced,
    scriptText: JSON.stringify(enhanced),
    suggestions,
    inserted,
    skipped,
  };
}
