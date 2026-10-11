import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { courseSchema } from "../../shared/interactive";
const source = path.resolve(process.argv[2] || "");
if (!process.argv[2])
  throw Error(
    "Usage: tsx script/interactive/import-course.ts <course-folder> [data-directory]",
  );
const c = courseSchema.parse(
  JSON.parse(await fs.readFile(path.join(source, "course.json"), "utf8")),
);
for (const [file, meta] of Object.entries(c.assets)) {
  const stat = await fs.lstat(path.join(source, file));
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error("Assets must be ordinary files: " + file);
  const b = await fs.readFile(path.join(source, file));
  if (
    b.length !== meta.bytes ||
    createHash("sha256").update(b).digest("hex") !== meta.sha256
  )
    throw Error("Asset mismatch: " + file);
}
const root = path.resolve(
  process.argv[3] || process.env.INTERACTIVE_DATA_DIR || "interactive-data",
);
const destination = path.join(root, "courses", c.id, c.version);
try {
  await fs.access(destination);
  throw Error("Course version already exists; export a new version instead.");
} catch (e: any) {
  if (e.code !== "ENOENT") throw e;
}
await fs.mkdir(path.dirname(destination), { recursive: true });
const staging = destination + ".import-" + randomUUID();
try {
  await fs.mkdir(staging);
  for (const file of ["course.json", ...Object.keys(c.assets)])
    await fs.copyFile(path.join(source, file), path.join(staging, file));
  await fs.rename(staging, destination);
} catch (e) {
  await fs.rm(staging, { recursive: true, force: true });
  throw e;
}
console.log(
  JSON.stringify({
    id: c.id,
    version: c.version,
    items: c.items.length,
    qa: c.productionQa,
    destination,
  }),
);
