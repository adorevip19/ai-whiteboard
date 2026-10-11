import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fixture } from "./fixture";
import { compatibleHelpUpdate, upgradeTeacherHelp } from "./course-upgrade";
import { InteractiveStore } from "./store";
import { courseSchema } from "../../shared/interactive";
test("bilingual help preserves English questions, scores and saved progress", () => {
  const before = fixture();
  before.id = "candy-quest-pilot";
  before.version = "1.0.0-preview";
  const after = structuredClone(before);
  after.version = "1.1.0-preview";
  after.items[0].hintText = "想一想。Think.";
  assert.equal(compatibleHelpUpdate(before, after), true);
  const changed = structuredClone(after);
  changed.items[0].correctChoice = "b";
  assert.equal(compatibleHelpUpdate(before, changed), false);
  const chinese = structuredClone(after);
  chinese.items[0].prompt = "请选择";
  assert.equal(courseSchema.safeParse(chinese).success, false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "help-upgrade-"));
  const store = new InteractiveStore(root);
  try {
    for (const c of [before, after]) {
      const dir = path.join(root, "courses", c.id, c.version);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "course.json"), JSON.stringify(c));
    }
    const run = store.create(before);
    const snapshot = store.run(run.id);
    upgradeTeacherHelp(store, path.join(root, "courses"));
    const current = store.run(run.id);
    assert.equal(current.version, after.version);
    assert.deepEqual(current.progress, snapshot.progress);
    assert.deepEqual(current.position, snapshot.position);
    upgradeTeacherHelp(store, path.join(root, "courses"));
    assert.equal(
      (store.db.prepare("SELECT count(*) n FROM course_upgrades").get() as any)
        .n,
      1,
    );
  } finally {
    store.db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
