import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { courseSchema, type Course } from "../../shared/interactive";
import type { InteractiveStore } from "./store";

// Only teacher-help wording/audio may change in an in-progress lesson.
// Preserve the original course package, every attempt, score and saved position.
export function compatibleHelpUpdate(before: Course, after: Course) {
  const core = (c: Course) => {
    const copy = structuredClone(c);
    copy.version = "ignored";
    copy.description = "ignored";
    const helpAssets = new Set<string>();
    const protectedAssets = new Set(
      copy.items.flatMap((i) => [
        i.feedback.prompt,
        i.feedback.correct,
        ...i.lecture,
        ...(i.image ? [i.image] : []),
        ...(i.images || []),
      ]),
    );
    for (const i of copy.items) {
      i.hintText = i.modelText = i.scaffoldText = "ignored";
      for (const k of ["hint", "model", "scaffold", "uncertain"] as const) {
        helpAssets.add(i.feedback[k]);
        i.feedback[k] = "ignored.wav";
      }
    }
    for (const f of Array.from(helpAssets))
      if (!protectedAssets.has(f)) delete copy.assets[f];
    return copy;
  };
  return isDeepStrictEqual(core(before), core(after));
}
export function upgradeTeacherHelp(store: InteractiveStore, root: string) {
  const id = "candy-quest-pilot",
    from = "1.0.0-preview",
    to = "1.1.0-preview";
  const files = [from, to].map((v) => path.join(root, id, v, "course.json"));
  if (!files.every((f) => fs.existsSync(f))) return;
  const [before, after] = files.map((f) =>
    courseSchema.parse(JSON.parse(fs.readFileSync(f, "utf8"))),
  );
  if (!compatibleHelpUpdate(before, after))
    throw Error("Teacher-help update changed assessment or lecture content");
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS course_upgrades(run_id TEXT, from_version TEXT, to_version TEXT, created INTEGER, PRIMARY KEY(run_id,to_version))",
  );
  store.db.transaction(() => {
    const rows = store.db
      .prepare(
        "SELECT id FROM runs WHERE course_id=? AND version=? AND completed IS NULL",
      )
      .all(id, from) as { id: string }[];
    for (const row of rows) {
      store.db
        .prepare("INSERT OR IGNORE INTO course_upgrades VALUES(?,?,?,?)")
        .run(row.id, from, to, Date.now());
      store.db.prepare("UPDATE runs SET version=? WHERE id=?").run(to, row.id);
    }
  })();
}
