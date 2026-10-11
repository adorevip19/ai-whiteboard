import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  courseSchema,
  nextLessonIndex,
  type Course,
  type Evaluation,
} from "../../shared/interactive";
import { InteractiveStore } from "./store";
import { applyEvaluation, buildReport, freshProgress } from "./engine";
import { fixture } from "./fixture";
const grade = (score: number, goalMet = score === 100): Evaluation => ({
  outcome: "graded",
  score,
  goalMet,
  transcript: "answer",
  reason: "test",
  criteria: [{ id: "meaning", met: goalMet }],
});
const unavailable: Evaluation = {
  outcome: "unavailable",
  score: null,
  goalMet: false,
  transcript: "",
  reason: "offline",
  criteria: [],
};
function db(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lesson-test-"));
  const s = new InteractiveStore(dir);
  t.after(() => {
    s.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return s;
}
test("schema rejects traversal, invalid versions and vacuous passing rubric", () => {
  for (const mutate of [
    (c: any) => (c.assets["../a.wav"] = c.assets["a.wav"]),
    (c: any) => (c.version = ".."),
    (c: any) => (c.items[0].rubric[0].required = false),
  ]) {
    const c = fixture();
    mutate(c);
    assert.equal(courseSchema.safeParse(c).success, false);
  }
});
test("first score stays, correction unlocks even when blended score is low", () => {
  const c = fixture();
  let p = freshProgress(c)[0];
  p = applyEvaluation({ ...p, calls: 1 }, grade(0), c.items[0]);
  p = applyEvaluation({ ...p, calls: 2 }, grade(100), c.items[0]);
  assert.equal(p.first, 0);
  assert.equal(p.combined, 30);
  assert.equal(p.status, "complete");
  assert.equal(p.assisted, true);
});
test("outage earns no grade and consumes no child attempt", (t) => {
  const s = db(t),
    c = fixture(),
    r = s.create(c),
    a = s.reserve(r.id, "q0", randomUUID(), c);
  s.finish(a.attempt.id, c, unavailable);
  const p = s.run(r.id).progress[0];
  assert.equal(p.first, null);
  assert.equal(p.calls, 0);
  assert.equal(p.attempts, 0);
  assert.equal(p.status, "ready");
});
test("free navigation, concurrency and idempotency enforced by server", (t) => {
  const s = db(t),
    c = fixture(),
    r = s.create(c),
    id = randomUUID();
  assert.equal(r.progress[7].status, "ready");
  const a = s.reserve(r.id, "q0", id, c);
  assert.equal(s.reserve(r.id, "q0", id, c).existing, true);
  assert.throws(() => s.reserve(r.id, "q0", randomUUID(), c), /正在评估/);
  s.finish(a.attempt.id, c, grade(100));
  assert.equal(s.run(r.id).progress[1].status, "ready");
  assert.equal(s.reserve(r.id, "q0", id, c).existing, true);
  assert.equal(s.reserve(r.id, "q2", randomUUID(), c).existing, false);
});
test("three failures release the item without granting mastery or points", (t) => {
  const s = db(t),
    c = fixture(),
    r = s.create(c);
  let last = "";
  for (let i = 0; i < 3; i++) {
    last = s.reserve(r.id, "q0", randomUUID(), c).attempt.id;
    s.finish(last, c, grade(0));
  }
  assert.equal(s.run(r.id).progress[0].status, "complete");
  assert.equal(s.run(r.id).progress[0].released, true);
  assert.equal(s.run(r.id).progress[0].combined, 0);
  assert.throws(() => s.reserve(r.id, "q0", randomUUID(), c), /已完成/);
  s.review(last, c, { ...grade(100), assistance: true }, "Observed correction");
  assert.equal(s.run(r.id).progress[0].first, 0);
  assert.equal(s.run(r.id).progress[0].combined, 30);
  assert.equal(s.run(r.id).progress[1].status, "ready");
  assert.equal(s.db.prepare("SELECT count(*) n FROM reviews").get()?.n, 1);
  assert.equal(s.attempts(r.id)[0].evaluation.score, 0);
});
test("review replay excludes outages and keeps submission order", (t) => {
  const s = db(t),
    c = fixture(),
    r = s.create(c);
  const a = s.reserve(r.id, "q0", randomUUID(), c);
  s.finish(a.attempt.id, c, unavailable);
  const b = s.reserve(r.id, "q0", randomUUID(), c);
  s.finish(b.attempt.id, c, grade(0));
  s.review(b.attempt.id, c, grade(100), "Recognition correction");
  assert.equal(s.run(r.id).progress[0].calls, 1);
  assert.equal(s.run(r.id).progress[0].attempts, 1);
  assert.equal(s.run(r.id).progress[0].first, 100);
});
test("report totals only appear after every objective, dimensions equally weighted", (t) => {
  const s = db(t),
    c = fixture(),
    r = s.create(c);
  assert.equal(buildReport(c, r.progress, [], false).total, null);
  for (let n = 0; n < 8; n++) {
    const a = s.reserve(r.id, "q" + n, randomUUID(), c);
    s.finish(a.attempt.id, c, grade(100));
  }
  const done = s.run(r.id),
    report = buildReport(c, done.progress, s.attempts(r.id), !!done.completed);
  assert.equal(report.total, 100);
  assert.equal(report.dimensions.length, 4);
  assert.equal(report.completedItems, 8);
});
test("usage hard cap reserves before provider and failed calls still count", (t) => {
  const s = db(t);
  process.env.INTERACTIVE_AZURE_DAILY_CALLS = "1";
  t.after(() => delete process.env.INTERACTIVE_AZURE_DAILY_CALLS);
  const id = s.usageStart("azure", 3);
  s.usageEnd(id, "failed");
  assert.throws(() => s.usageStart("azure", 3), /上限/);
});

test("practice recommendation follows the weak task in a shared objective", () => {
  const c = fixture();
  c.items[5].practice.title = "Practise the second expression task";
  const p = freshProgress(c);
  for (let n = 0; n < p.length; n++)
    p[n] = applyEvaluation({ ...p[n], calls: 1 }, grade(100), c.items[n]);
  p[5] = { ...p[5], first: 0, combined: 30, assisted: true };
  assert.equal(
    buildReport(c, p, [], true).practice[0].title,
    "Practise the second expression task",
  );
});

test("interrupted requests recover without automatic provider retry", (t) => {
  const s = db(t),
    c = fixture(),
    r = s.create(c),
    id = randomUUID();
  s.reserve(r.id, "q0", id, c);
  const reopened = new InteractiveStore(s.dir);
  t.after(() => reopened.db.close());
  assert.equal(reopened.run(r.id).progress[0].calls, 0);
  assert.equal(
    reopened.reserve(r.id, "q0", id, c).attempt.state,
    "interrupted",
  );
  assert.equal(reopened.reserve(r.id, "q0", randomUUID(), c).existing, false);
});

 test("legacy review records release and unlock navigation without changing scores", (t) => {
  const s = db(t), c = fixture(), r = s.create(c);
  for (let n = 0; n < 3; n++) {
    const a = s.reserve(r.id, "q0", randomUUID(), c);
    s.finish(a.attempt.id, c, grade(0));
  }
  const p = s.run(r.id).progress;
  delete p[0].failures;
  delete p[0].released;
  p[0].status = "review";
  p[7].status = "locked";
  s.db.prepare("UPDATE runs SET progress=? WHERE id=?").run(JSON.stringify(p), r.id);
  const migrated = s.run(r.id);
  assert.equal(migrated.progress[0].released, true);
  assert.equal(migrated.progress[0].combined, 0);
  assert.equal(migrated.progress[7].status, "ready");
 });
 test("uncertain audio and outages are not counted as wrong answers", () => {
  const c = fixture();
  let p = freshProgress(c)[0];
  p = applyEvaluation(p, { ...unavailable, outcome: "uncertain" }, c.items[0]);
  for (let n = 0; n < 2; n++) p = applyEvaluation(p, grade(0), c.items[0]);
  assert.equal(p.status, "retry");
  p = applyEvaluation(p, grade(0), c.items[0]);
  assert.equal(p.released, true);
 });

test("last question directs to an unfinished earlier question, then report", () => {
 const c = fixture(), p = freshProgress(c);
 p.forEach(x => x.status = "complete");
 p[6].status = "retry";
 assert.equal(nextLessonIndex(p, 7), 6);
 p[6].status = "complete";
 assert.equal(nextLessonIndex(p, 7), -1);
});
test("three uncertain recordings finish without invented grades, including legacy migration", (t) => {
 const s = db(t), c = fixture(), r = s.create(c);
 for (let n=0;n<3;n++) {
  const a=s.reserve(r.id,"q0",randomUUID(),c);
  s.finish(a.attempt.id,c,{...unavailable,outcome:"uncertain"});
 }
 let p=s.run(r.id).progress;
 assert.equal(p[0].status,"complete");
 assert.equal(p[0].combined,null);
 assert.equal(p[0].releaseReason,"unscored");
 delete p[0].uncertainAttempts;
 p[0].status="retry";
 s.db.prepare("UPDATE runs SET progress=? WHERE id=?").run(JSON.stringify(p),r.id);
 p=s.run(r.id).progress;
 assert.equal(p[0].status,"complete");
 p.forEach(x=>x.status="complete");
 const report=buildReport(c,p,[],true);
 assert.equal(report.total,null);
 assert.ok(report.unscoredItems.some(x=>x.id==="q0"));
});
