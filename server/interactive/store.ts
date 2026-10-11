import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Course,
  ItemProgress,
  Evaluation,
} from "../../shared/interactive";
import { freshProgress, applyEvaluation } from "./engine";
export class InteractiveStore {
  db: Database.Database;
  constructor(public dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(path.join(dir, "interactive.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,course_id TEXT NOT NULL,version TEXT NOT NULL,progress TEXT NOT NULL,created INTEGER NOT NULL,completed INTEGER,position TEXT NOT NULL DEFAULT '{}');
 CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,item_id TEXT NOT NULL,request_id TEXT NOT NULL,state TEXT NOT NULL,evaluation TEXT,audio_path TEXT,created INTEGER NOT NULL,reviewed INTEGER NOT NULL DEFAULT 0, UNIQUE(run_id,request_id));
 CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,previous TEXT,new_evaluation TEXT NOT NULL,reason TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,provider TEXT NOT NULL,day TEXT NOT NULL,seconds REAL NOT NULL DEFAULT 0,status TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS practice(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,objective_id TEXT NOT NULL,note TEXT NOT NULL,created INTEGER NOT NULL);
 `);
    if (
      !(this.db.prepare("PRAGMA table_info(runs)").all() as any[]).some(
        (x) => x.name === "is_test",
      )
    )
      this.db.exec(
        "ALTER TABLE runs ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0",
      );
    // Interrupted provider calls are uncertain, never reissued automatically.
    this.db.transaction(() => {
      for (const a of this.db
        .prepare("SELECT * FROM attempts WHERE state='processing'")
        .all() as any[]) {
        const r = this.run(a.run_id);
        const n = r.progress.findIndex((p: ItemProgress) => p.id === a.item_id);
        const e: Evaluation = {
          outcome: "unavailable",
          score: null,
          goalMet: false,
          transcript: "",
          reason: "上一次评估因服务重启中断，未评分。请重新回答。",
          criteria: [],
        };
        if (n >= 0) {
          r.progress[n].calls = Math.max(0, r.progress[n].calls - 1);
          r.progress[n].evaluation = e;
        }
        this.db
          .prepare(
            "UPDATE attempts SET state='interrupted',evaluation=? WHERE id=?",
          )
          .run(JSON.stringify(e), a.id);
        this.db
          .prepare("UPDATE runs SET progress=? WHERE id=?")
          .run(JSON.stringify(r.progress), r.id);
      }
    })();
  }
  create(c: Course, testOnly = false) {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO runs(id,course_id,version,progress,created) VALUES(?,?,?,?,?)",
      )
      .run(id, c.id, c.version, JSON.stringify(freshProgress(c)), Date.now());
    if (testOnly)
      this.db.prepare("UPDATE runs SET is_test=1 WHERE id=?").run(id);
    return this.run(id);
  }
  run(id: string) {
    const r = this.db.prepare("SELECT * FROM runs WHERE id=?").get(id) as any;
    if (!r) throw Object.assign(new Error("课程记录不存在"), { status: 404 });
    const progress = JSON.parse(r.progress) as ItemProgress[];
    let changed = false;
    for (const p of progress) {
      if (p.failures === undefined) {
        p.failures = this.attempts(id).filter(a => a.item_id === p.id && a.evaluation?.outcome === "graded" && !a.evaluation.goalMet).length;
        changed = true;
      }
      if (p.uncertainAttempts === undefined) {
        p.uncertainAttempts = this.attempts(id).filter(a => a.item_id === p.id && a.evaluation?.outcome === "uncertain").length;
        changed = true;
      }
      if (p.status !== "complete" && p.uncertainAttempts >= 3) {
        p.status = "complete";
        p.released = true;
        p.releaseReason = "unscored";
        p.feedback = undefined;
        changed = true;
      }
      if (p.status !== "complete" && p.failures >= 3) {
        p.status = "complete";
        p.released = true;
        p.releaseReason = "incorrect";
        p.feedback = undefined;
        changed = true;
      } else if (p.status === "review") {
        p.status = "retry";
        changed = true;
      }
    }
    for (let n = 1; n < progress.length; n++) {
      if (progress[n].status === "locked") {
        progress[n].status = "ready";
        changed = true;
      }
    }
    if (changed) {
      r.completed = progress.every(p => p.status === "complete") ? (r.completed || Date.now()) : r.completed;
      this.db.prepare("UPDATE runs SET progress=?,completed=? WHERE id=?").run(JSON.stringify(progress), r.completed, id);
    }
    return {
      ...r,
      progress,
      position: JSON.parse(r.position),
    };
  }
  list() {
    return this.db
      .prepare(
        "SELECT id,course_id,version,created,completed,is_test FROM runs ORDER BY created DESC",
      )
      .all();
  }
  attempts(id: string) {
    return (
      this.db
        .prepare("SELECT * FROM attempts WHERE run_id=? ORDER BY created,rowid")
        .all(id) as any[]
    ).map((a) => ({
      ...a,
      evaluation: a.evaluation ? JSON.parse(a.evaluation) : null,
    }));
  }
  reserve(runId: string, itemId: string, requestId: string, c: Course) {
    return this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM attempts WHERE run_id=? AND request_id=?")
        .get(runId, requestId) as any;
      if (existing) {
        if (existing.item_id !== itemId)
          throw Object.assign(new Error("请求标识已用于另一题"), {
            status: 409,
          });
        return { existing: true, attempt: existing };
      }
      const r = this.run(runId);
      const at = c.items.findIndex(x => x.id === itemId);
      if (at < 0 || r.progress[at].status === "complete")
        throw Object.assign(new Error("题目不存在或已完成，已保存成绩不重复提交"), {
          status: 409,
        });
      const p = r.progress[at];
      if (
        this.db
          .prepare(
            "SELECT id FROM attempts WHERE run_id=? AND state='processing'",
          )
          .get(runId)
      )
        throw Object.assign(new Error("已有回答正在评估，请等待结果"), {
          status: 409,
        });
      const id = randomUUID();
      p.calls++;
      this.db
        .prepare("UPDATE runs SET progress=? WHERE id=?")
        .run(JSON.stringify(r.progress), runId);
      this.db
        .prepare(
          "INSERT INTO attempts(id,run_id,item_id,request_id,state,created) VALUES(?,?,?,?,?,?)",
        )
        .run(id, runId, itemId, requestId, "processing", Date.now());
      return { existing: false, attempt: { id } };
    })();
  }
  finish(id: string, c: Course, e: Evaluation, audioPath?: string) {
    return this.db.transaction(() => {
      const a = this.db
        .prepare("SELECT * FROM attempts WHERE id=?")
        .get(id) as any;
      if (!a || a.state !== "processing") return;
      const r = this.run(a.run_id);
      const at = c.items.findIndex((i) => i.id === a.item_id);
      let old = r.progress[at];
      // Local validation/no speech and service outages do not consume a child's attempt.
      if (e.outcome === "unavailable")
        old = { ...old, calls: Math.max(0, old.calls - 1) };
      r.progress[at] = applyEvaluation(old, e, c.items[at]);
      if (
        r.progress[at].status === "complete" &&
        r.progress[at + 1]?.status === "locked"
      )
        r.progress[at + 1].status = "ready";
      const complete = r.progress.every(
        (x: ItemProgress) => x.status === "complete",
      );
      this.db
        .prepare(
          "UPDATE attempts SET state=?,evaluation=?,audio_path=? WHERE id=?",
        )
        .run("done", JSON.stringify(e), audioPath ?? null, id);
      this.db
        .prepare("UPDATE runs SET progress=?,completed=? WHERE id=?")
        .run(JSON.stringify(r.progress), complete ? Date.now() : null, r.id);
    })();
  }
  review(attemptId: string, c: Course, e: Evaluation, reason: string) {
    return this.db.transaction(() => {
      const a = this.db
        .prepare("SELECT * FROM attempts WHERE id=?")
        .get(attemptId) as any;
      if (!a || a.state === "processing")
        throw Object.assign(new Error("找不到可复核的回答"), { status: 409 });
      if (e.outcome !== "graded" || !e.transcript.trim())
        throw new Error("家长须核对实际回答并记录依据");
      const prior = a.evaluation;
      this.db
        .prepare("INSERT INTO reviews VALUES(?,?,?,?,?,?)")
        .run(
          randomUUID(),
          attemptId,
          prior,
          JSON.stringify(e),
          reason,
          Date.now(),
        );
      this.db
        .prepare("UPDATE attempts SET evaluation=?,reviewed=1 WHERE id=?")
        .run(JSON.stringify({ ...e, reviewed: true }), attemptId);
      const r = this.run(a.run_id);
      const all = this.attempts(r.id);
      const p = freshProgress(c);
      for (let n = 0; n < c.items.length; n++) {
        p[n].status = "ready";
        for (const x of all.filter((x) => x.item_id === c.items[n].id)) {
          if (!x.evaluation) continue;
          if (x.evaluation.outcome !== "unavailable") p[n].calls++;
          p[n] = applyEvaluation(p[n], x.evaluation, c.items[n]);
        }
      }
      this.db
        .prepare("UPDATE runs SET progress=?,completed=? WHERE id=?")
        .run(
          JSON.stringify(p),
          p.every((x) => x.status === "complete") ? Date.now() : null,
          r.id,
        );
      return a.audio_path as string | null;
    })();
  }
  usageStart(provider: string, seconds = 0) {
    const day = new Date().toISOString().slice(0, 10);
    return this.db.transaction(() => {
      const u = this.db
        .prepare(
          "SELECT count(*) n,coalesce(sum(seconds),0) seconds FROM usage WHERE day=? AND provider=?",
        )
        .get(day, provider) as any;
      const cap =
        provider === "azure"
          ? Number(process.env.INTERACTIVE_AZURE_DAILY_CALLS || 100)
          : Number(process.env.INTERACTIVE_SEMANTIC_DAILY_CALLS || 30);
      if (u.n >= cap || (provider === "azure" && u.seconds + seconds > 1800))
        throw Object.assign(
          new Error(
            `${provider === "azure" ? "Azure语音评估" : "语义判断"}今日使用上限已达到，请家长查看用量`,
          ),
          { status: 429 },
        );
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO usage VALUES(?,?,?,?,?,?)")
        .run(id, provider, day, seconds, "submitted", Date.now());
      return id;
    })();
  }
  usageEnd(id: string, status: string) {
    this.db.prepare("UPDATE usage SET status=? WHERE id=?").run(status, id);
  }
  usage() {
    return this.db
      .prepare(
        "SELECT day,provider,count(*) calls,sum(seconds) seconds,sum(status='failed') failures FROM usage GROUP BY day,provider ORDER BY day DESC",
      )
      .all();
  }
  cleanup() {
    const old = this.db
      .prepare(
        "SELECT id,audio_path FROM attempts WHERE audio_path IS NOT NULL AND created<?",
      )
      .all(Date.now() - 7 * 86400000) as any[];
    for (const a of old) {
      try {
        fs.unlinkSync(a.audio_path);
      } catch {}
      this.db
        .prepare("UPDATE attempts SET audio_path=NULL WHERE id=?")
        .run(a.id);
    }
  }
}
