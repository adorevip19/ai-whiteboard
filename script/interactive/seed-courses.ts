import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { courseSchema } from "../../shared/interactive";
/** Deploy-time content is private, immutable and copied into the persistent volume. */
export function seedCourses(
  root: string,
  source = path.resolve("course-bundles"),
) {
  if (!fs.existsSync(source)) return;
  for (const folder of fs.readdirSync(source)) {
    const src = path.join(source, folder);
    if (!fs.statSync(src).isDirectory()) continue;
    const c = courseSchema.parse(
      JSON.parse(fs.readFileSync(path.join(src, "course.json"), "utf8")),
    );
    const dest = path.join(root, c.id, c.version);
    if (fs.existsSync(dest)) continue;
    for (const [file, meta] of Object.entries(c.assets)) {
      const p = path.join(src, file);
      if (!fs.lstatSync(p).isFile()) throw Error("Invalid course asset");
      const bytes = fs.readFileSync(p);
      if (
        bytes.length !== meta.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== meta.sha256
      )
        throw Error("Course asset integrity failed");
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const temp = dest + ".seed-" + randomUUID();
    fs.mkdirSync(temp);
    try {
      for (const f of ["course.json", ...Object.keys(c.assets)])
        fs.copyFileSync(path.join(src, f), path.join(temp, f));
      fs.renameSync(temp, dest);
    } catch (e) {
      fs.rmSync(temp, { recursive: true, force: true });
      throw e;
    }
  }
}
