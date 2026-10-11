import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { courseSchema, type Evaluation } from "../../shared/interactive";
import { InteractiveStore } from "../../server/interactive/store";
import { choiceGrade, buildReport } from "../../server/interactive/engine";
const root =
  "/Users/tianyufeng/Desktop/孩子学习/HFF/Unit 5/The Candy Quest 互动精讲/中英穿插完整版_网页互动课堂";
const out = path.join(root, "制作文件/全课模拟验收.json");
if (fs.existsSync(out))
  throw Error("Saved simulation already exists; reuse it.");
const c = courseSchema.parse(
  JSON.parse(fs.readFileSync(path.join(root, "课程包/course.json"), "utf8")),
);
assert.equal(c.items.length, 24);
const store = new InteractiveStore(path.resolve("interactive-data"));
const run = store.create(c, true);
const apply = (item: any, e: Evaluation) => {
  const r = store.reserve(run.id, item.id, randomUUID(), c);
  store.finish(r.attempt.id, c, e);
};
for (const [n, item] of c.items.entries()) {
  if (n === 0) {
    const wrong = item.choices!.find((x) => x.id !== item.correctChoice)!.id;
    apply(item, choiceGrade(item, wrong));
    assert.equal(store.run(run.id).completed, null);
  }
  if (n === 23) {
    apply(item, {
      outcome: "graded",
      score: 67,
      goalMet: false,
      transcript: "He wanted more candy. He found candy in a candy store.",
      reason: "工程模拟：遗漏下一步找钱",
      criteria: item.rubric.map((r) => ({ id: r.id, met: r.id !== "next" })),
      evidence: { simulation: true },
    });
    assert.equal(store.run(run.id).completed, null);
  }
  apply(
    item,
    item.kind === "choice"
      ? choiceGrade(item, item.correctChoice!)
      : {
          outcome: "graded",
          score: 100,
          goalMet: true,
          transcript: item.reference,
          reason: "工程模拟，不代表儿童实际表现",
          criteria: item.rubric.map((r) => ({ id: r.id, met: true })),
          evidence: { simulation: true },
        },
  );
  const state = store.run(run.id);
  assert.equal(state.progress[n].status, "complete");
  if (n < 23) assert.equal(state.completed, null);
}
const state = store.run(run.id);
assert.ok(state.completed);
assert.equal(state.progress[0].first, 0);
assert.equal(state.progress[23].first, 67);
const report = buildReport(
  c,
  state.progress,
  store.attempts(run.id),
  Boolean(state.completed),
);
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      testOnly: true,
      kind: "simulated engine acceptance, not child performance",
      runId: run.id,
      report,
    },
    null,
    2,
  ),
);
console.log(
  "24 mandatory items complete; report total",
  report.total,
  "test run",
  run.id,
);
store.db.close();
