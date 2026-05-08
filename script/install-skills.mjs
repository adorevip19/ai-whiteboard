#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const sourceRoot = path.join(repoRoot, "skills");
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const targetRoot = path.join(codexHome, "skills");

const entries = await fs.readdir(sourceRoot, { withFileTypes: true }).catch((error) => {
  if (error?.code === "ENOENT") return [];
  throw error;
});

if (entries.length === 0) {
  console.log("No bundled skills found.");
  process.exit(0);
}

await fs.mkdir(targetRoot, { recursive: true });

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const source = path.join(sourceRoot, entry.name);
  const target = path.join(targetRoot, entry.name);
  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(source, target, {
    recursive: true,
    filter: (item) => !item.endsWith(".DS_Store"),
  });
  await chmodScripts(path.join(target, "scripts"));
  console.log(`Installed skill: ${entry.name} -> ${target}`);
}

async function chmodScripts(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      await chmodScripts(fullPath);
    } else if (/\.(mjs|js|sh|py)$/.test(item.name)) {
      await fs.chmod(fullPath, 0o755);
    }
  }
}
