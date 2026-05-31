import fs from "node:fs/promises";
import path from "node:path";
import { enhanceScriptWithIllustrations } from "../server/illustratedScript";
import { validateScript } from "../client/src/whiteboard/commandTypes";

type AssetManifestItem = {
  id?: string;
  title?: string;
  caption?: string;
  narration?: string;
  dataUrl?: string;
  path?: string;
  pageId?: string;
  keywords?: string[];
};

const args = parseArgs(process.argv.slice(2));

if (!args.script || (!args.assets && !args.image && !args.asset) || !args.out) {
  console.error(
    [
      "Usage:",
      "  npx tsx script/apply-illustrations.ts --script script.json --assets assets.json --out illustrated.json",
      "  npx tsx script/apply-illustrations.ts --script script.json --image img1.png --image img2.jpg --out illustrated.json",
      "  npx tsx script/apply-illustrations.ts --script script.json --asset 'img.png|标题|说明|关键词1,关键词2|pageId' --out illustrated.json",
    ].join("\n"),
  );
  process.exit(2);
}

const scriptPath = one(args.script);
const outPath = one(args.out);
const scriptText = await fs.readFile(scriptPath, "utf8");
const scriptJson = JSON.parse(scriptText);
const validation = validateScript(scriptJson);
if (!validation.ok) {
  throw new Error(`脚本无效：${validation.error}`);
}

const assetsJson = await loadAssets(args);

const assets = await Promise.all(
  assetsJson.map(async (asset: AssetManifestItem) => {
    if (asset.dataUrl || !asset.path) return asset;
    return {
      ...asset,
      dataUrl: await fileToDataUrl(asset.path),
    };
  }),
);

const result = enhanceScriptWithIllustrations(validation.script, assets);
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, JSON.stringify(result.script, null, 2));

console.log(
  JSON.stringify(
    {
      ok: true,
      out: outPath,
      inserted: result.inserted,
      skipped: result.skipped,
      suggestions: result.suggestions,
    },
    null,
    2,
  ),
);

async function fileToDataUrl(filePath: string) {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
        ? "image/webp"
        : "image/png";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function parseArgs(argv: string[]) {
  const parsed: Record<string, string | string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    const value = next && !next.startsWith("--") ? next : "true";
    if (parsed[key]) {
      const current = parsed[key];
      parsed[key] = Array.isArray(current) ? [...current, value] : [current, value];
    } else {
      parsed[key] = value;
    }
    if (next && !next.startsWith("--")) i++;
  }
  return parsed;
}

function one(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value;
  throw new Error("缺少必要参数。");
}

function many(value: string | string[] | undefined) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function loadAssets(args: Record<string, string | string[]>) {
  const fromManifest = args.assets
    ? JSON.parse(await fs.readFile(one(args.assets), "utf8"))
    : [];
  if (!Array.isArray(fromManifest)) {
    throw new Error("assets 必须是数组。");
  }

  const fromImages = many(args.image).map((imagePath) => assetFromImagePath(imagePath));
  const fromAssetArgs = many(args.asset).map(parseAssetArg);
  return [...fromManifest, ...fromImages, ...fromAssetArgs];
}

function assetFromImagePath(imagePath: string): AssetManifestItem {
  const parsed = path.parse(imagePath);
  const title = humanizeFileName(parsed.name);
  return {
    id: parsed.name,
    title,
    caption: title,
    path: imagePath,
    keywords: title.split(/[ _-]+/).filter(Boolean).slice(0, 6),
  };
}

function parseAssetArg(value: string): AssetManifestItem {
  const [imagePath, title, caption, keywords, pageId] = value.split("|");
  if (!imagePath?.trim()) {
    throw new Error("--asset 必须至少包含图片路径。");
  }
  const base = assetFromImagePath(imagePath.trim());
  return {
    ...base,
    title: title?.trim() || base.title,
    caption: caption?.trim() || title?.trim() || base.caption,
    keywords: keywords
      ? keywords
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : base.keywords,
    pageId: pageId?.trim() || undefined,
  };
}

function humanizeFileName(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42) || "插图讲解";
}
