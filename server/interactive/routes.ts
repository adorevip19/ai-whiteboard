import express, { type Express, type Request, type Response } from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import {
  courseSchema,
  publicItem,
  type Course,
  type Evaluation,
  type ItemProgress,
} from "../../shared/interactive";
import { InteractiveStore } from "./store";
import { choiceGrade, buildReport } from "./engine";
import { upgradeTeacherHelp } from "./course-upgrade";
import { seedCourses } from "../../script/interactive/seed-courses";
import { assess, decodeAudio, saveReviewAudio } from "./assess";
const equal = (a: string, b: string) =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
export function registerInteractiveRoutes(
  app: Express,
  options: { dir?: string; evaluate?: typeof assess } = {},
) {
  const dir =
    options.dir ||
    process.env.INTERACTIVE_DATA_DIR ||
    path.join(
      process.env.DATABASE_DIR ||
        process.env.RAILWAY_VOLUME_MOUNT_PATH ||
        process.cwd(),
      "interactive-data",
    );
  const store = new InteractiveStore(dir);
  const root = path.join(dir, "courses");
  fs.mkdirSync(root, { recursive: true });
  seedCourses(root);
  upgradeTeacherHelp(store, root);
  const passwordless = process.env.INTERACTIVE_PASSWORDLESS === "true";
  const password = process.env.INTERACTIVE_FAMILY_PASSWORD || "",
    pin = process.env.INTERACTIVE_PARENT_PIN || "",
    secret = process.env.INTERACTIVE_SESSION_SECRET || "";
  const sign = (s: string) =>
    createHmac("sha256", secret).update(s).digest("base64url");
  const cookieValue = (req: Request, name: string) =>
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(name + "="))
      ?.slice(name.length + 1) || "";
  const valid = (req: Request, name: string) => {
    if (passwordless) return true;
    const [role, exp, sig] = cookieValue(req, name).split(".");
    return (
      role === name &&
      Number(exp) > Date.now() &&
      Boolean(secret) &&
      Boolean(sig) &&
      equal(sig, sign(role + "." + exp))
    );
  };
  const setCookie = (req: Request, res: Response, name: string, ms: number) => {
    const body = name + "." + (Date.now() + ms);
    res.append(
      "Set-Cookie",
      `${name}=${body}.${sign(body)}; Path=/api/interactive; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ms / 1000)}${req.secure || req.get("x-forwarded-proto") === "https" ? "; Secure" : ""}`,
    );
  };
  const course = (id: string, version: string) => {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(version)
    )
      throw Object.assign(new Error("课程版本无效"), { status: 400 });
    return courseSchema.parse(
      JSON.parse(
        fs.readFileSync(path.join(root, id, version, "course.json"), "utf8"),
      ),
    );
  };
  const courseForRun = (id: string) => {
    const r = store.run(id);
    return { r, c: course(r.course_id, r.version) };
  };
  const safeState = (r: any, c: Course) => ({
    id: r.id,
    testOnly: !!r.is_test,
    courseId: c.id,
    version: c.version,
    title: c.title,
    completed: !!r.completed,
    position: r.position,
    progress: r.progress.map((p: ItemProgress) => ({
      ...p,
      evaluation: p.evaluation
        ? {
            outcome: p.evaluation.outcome,
            score: p.evaluation.score,
            goalMet: p.evaluation.goalMet,
            reason: p.evaluation.reason,
            transcript: p.evaluation.transcript,
          }
        : undefined,
    })),
    items: c.items.map((i, n) =>
      r.progress[n].status === "locked"
        ? {
            id: i.id,
            title: i.title,
            domain: i.domain,
            kind: i.kind,
            locked: true,
          }
        : publicItem(i, r.progress[n].first !== null),
    ),
    productionQa: c.productionQa,
  });
  const wrap =
    (f: (req: Request, res: Response) => any) =>
    (req: Request, res: Response) =>
      Promise.resolve()
        .then(() => f(req, res))
        .catch((e) => {
          res.status(e.status || (e instanceof z.ZodError ? 400 : 500)).json({
            message:
              e instanceof z.ZodError
                ? "请求格式不正确"
                : String(e.message || "互动服务暂不可用").slice(0, 240),
          });
        });
  const parent = (req: Request) => {
    if (!valid(req, "lesson_parent"))
      throw Object.assign(new Error("请先解锁家长区"), { status: 403 });
  };
  const loginLimits = new Map<string, { count: number; until: number }>();
  app.use("/api/interactive", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET" && req.get("origin")) {
      try {
        if (new URL(req.get("origin")!).host !== req.get("host"))
          return res.status(403).json({ message: "请求来源不匹配" });
      } catch {
        return res.status(403).json({ message: "请求来源无效" });
      }
    }
    if (!passwordless && (!password || !pin || secret.length < 32))
      return res
        .status(503)
        .json({ message: "互动课程尚未初始化家庭访问配置" });
    if (req.path === "/login" || req.path === "/session") return next();
    if (!valid(req, "lesson_family"))
      return res.status(401).json({ message: "请先登录家庭课程" });
    if (/^\/runs\/[^/]+/.test(req.path)) {
      try {
        const { c } = courseForRun(req.path.split("/")[2]);
        if (c.productionQa.status === "draft" && !valid(req, "lesson_parent"))
          return res
            .status(403)
            .json({ message: "工程预览课程需要家长解锁后体验" });
      } catch {
        return res.status(404).json({ message: "课程记录不存在" });
      }
    }
    next();
  });
  app.get("/api/interactive/session", (req, res) =>
    res.json({
      passwordless,
      authenticated: valid(req, "lesson_family"),
      parent: valid(req, "lesson_parent"),
    }),
  );
  app.post(
    "/api/interactive/login",
    wrap((req, res) => {
      const ip = req.ip || "local";
      let lim = loginLimits.get(ip);
      if (!lim || lim.until < Date.now()) {
        lim = { count: 0, until: Date.now() + 600000 };
        loginLimits.set(ip, lim);
      }
      if (lim.count >= 10)
        return res.status(429).json({ message: "尝试过多，请十分钟后再试" });
      if (!equal(String(req.body.password || ""), password)) {
        lim.count++;
        return res.status(401).json({ message: "家庭口令不正确" });
      }
      setCookie(req, res, "lesson_family", 7 * 86400000);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/interactive/parent/unlock",
    wrap((req, res) => {
      const ip = (req.ip || "local") + ":parent";
      let lim = loginLimits.get(ip);
      if (!lim || lim.until < Date.now()) {
        lim = { count: 0, until: Date.now() + 600000 };
        loginLimits.set(ip, lim);
      }
      if (lim.count >= 10)
        throw Object.assign(new Error("家长解锁尝试过多，请稍后再试"), {
          status: 429,
        });
      if (!equal(String(req.body.pin || ""), pin)) {
        lim.count++;
        throw Object.assign(new Error("家长口令不正确"), { status: 403 });
      }
      setCookie(req, res, "lesson_parent", 15 * 60000);
      res.json({ ok: true });
    }),
  );
  app.post("/api/interactive/parent/lock", (req, res) => {
    res.append(
      "Set-Cookie",
      "lesson_parent=; Path=/api/interactive; HttpOnly; SameSite=Strict; Max-Age=0",
    );
    res.json({ ok: true });
  });
  app.get(
    "/api/interactive/courses",
    wrap((req, res) => {
      const out: any[] = [];
      for (const id of fs.readdirSync(root)) {
        if (!fs.statSync(path.join(root, id)).isDirectory()) continue;
        for (const v of fs.readdirSync(path.join(root, id))) {
          try {
            const c = course(id, v);
            out.push({
              id: c.id,
              version: c.version,
              title: c.title,
              description: c.description,
              items: c.items.length,
              qa: c.productionQa,
            });
          } catch {}
        }
      }
      const latest = new Map<string, any>();
      for (const c of out) {
        if (
          !latest.has(c.id) ||
          c.version.localeCompare(latest.get(c.id).version, undefined, {
            numeric: true,
          }) > 0
        )
          latest.set(c.id, c);
      }
      res.json({
        courses: Array.from(latest.values()),
        runs: store.list().map((r: any) => {
          let courseTitle = r.course_id;
          try {
            courseTitle = course(r.course_id, r.version).title;
          } catch {}
          return { ...r, courseTitle };
        }),
      });
    }),
  );
  app.post(
    "/api/interactive/runs",
    wrap((req, res) => {
      const c = course(String(req.body.courseId), String(req.body.version));
      if (c.productionQa.status !== "reviewed") parent(req);
      if (req.body.testOnly) parent(req);
      res.json(safeState(store.create(c, req.body.testOnly === true), c));
    }),
  );
  app.get(
    "/api/interactive/runs/:id",
    wrap((req, res) => {
      const { r, c } = courseForRun(String(req.params.id));
      res.json(safeState(r, c));
    }),
  );
  app.put(
    "/api/interactive/runs/:id/position",
    wrap((req, res) => {
      const { r, c } = courseForRun(String(req.params.id));
      const body = z
        .object({
          itemId: z.string(),
          clip: z.number().int().nonnegative(),
          seconds: z.number().min(0).max(7200),
        })
        .parse(req.body);
      const n = c.items.findIndex((i) => i.id === body.itemId);
      if (
        n < 0 ||
        r.progress[n].status === "locked" ||
        body.clip >= Math.max(1, c.items[n].lecture.length)
      )
        throw Object.assign(new Error("未解锁的位置"), { status: 409 });
      store.db
        .prepare("UPDATE runs SET position=? WHERE id=?")
        .run(JSON.stringify(body), r.id);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/interactive/runs/:id/media/:file",
    wrap((req, res) => {
      const { r, c } = courseForRun(String(req.params.id));
      const file = String(req.params.file);
      if (!c.assets[file])
        throw Object.assign(new Error("素材不存在"), { status: 404 });
      const allowed = new Set<string>();
      c.items.forEach((i, n) => {
        const p = r.progress[n];
        if (p.status === "locked") return;
        for (const f of [
          ...i.lecture,
          i.feedback.prompt,
          ...(i.image ? [i.image] : []),
          ...(i.images || []),
        ])
          allowed.add(f);
        if (p.feedback) allowed.add(p.feedback);
        if (p.first !== null) {
          allowed.add(i.feedback.hint);
          allowed.add(i.feedback.model);
          allowed.add(i.feedback.scaffold);
        }
        if (p.status === "complete") allowed.add(i.feedback.correct);
      });
      if (!allowed.has(file) && !valid(req, "lesson_parent"))
        throw Object.assign(new Error("这段素材尚未解锁"), { status: 403 });
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.sendFile(path.resolve(root, c.id, c.version, file));
    }),
  );
  app.post(
    "/api/interactive/runs/:id/answers",
    wrap(async (req, res) => {
      const body = z
        .object({
          itemId: z.string(),
          requestId: z.string().uuid(),
          choice: z.string().optional(),
          audio: z
            .string()
            .max(8 * 1024 * 1024)
            .optional(),
        })
        .parse(req.body);
      const { r, c } = courseForRun(String(req.params.id));
      const item = c.items.find((i) => i.id === body.itemId);
      if (!item) throw Object.assign(new Error("题目不存在"), { status: 404 });
      if (
        item.kind === "choice" &&
        !item.choices?.some((x) => x.id === body.choice)
      )
        throw Object.assign(new Error("请选择一个选项"), { status: 400 });
      if (item.kind !== "choice" && !body.audio)
        throw Object.assign(new Error("请先录制回答"), { status: 400 });
      // Reserve before any provider call, including concurrent submissions.
      const reservation = store.reserve(r.id, item.id, body.requestId, c);
      if (reservation.existing)
        return res
          .status(reservation.attempt.state === "processing" ? 202 : 200)
          .json({
            state: reservation.attempt.state,
            run: safeState(store.run(r.id), c),
          });
      let wav: Buffer | undefined;
      let e: Evaluation;
      try {
        if (item.kind === "choice") e = choiceGrade(item, body.choice!);
        else {
          const decoded = await decodeAudio(body.audio!);
          wav = decoded.wav;
          e = await (options.evaluate || assess)(
            item,
            decoded.wav,
            decoded.seconds,
            store,
          );
        }
      } catch (err) {
        e = {
          outcome: "unavailable",
          score: null,
          goalMet: false,
          transcript: "",
          reason: err instanceof Error ? err.message : "评估服务暂不可用",
          criteria: [],
        };
      }
      let file: string | undefined;
      if (wav && !e.goalMet) {
        try {
          file = await saveReviewAudio(path.join(dir, "review-audio"), wav);
        } catch {
          e = {
            outcome: "unavailable",
            score: null,
            goalMet: false,
            transcript: e.transcript,
            reason: "录音保存失败，请稍后重新回答",
            criteria: [],
          };
        }
      }
      store.finish(reservation.attempt.id, c, e, file);
      res.json({ state: "done", run: safeState(store.run(r.id), c) });
    }),
  );
  app.get(
    "/api/interactive/runs/:id/report",
    wrap((req, res) => {
      const { r, c } = courseForRun(String(req.params.id));
      const report = {
        testOnly: !!r.is_test,
        ...buildReport(
          c,
          r.progress,
          store.attempts(r.id).map((a) => ({
            id: a.id,
            item_id: a.item_id,
            state: a.state,
            created: a.created,
            reviewed: a.reviewed,
            evaluation: a.evaluation,
            hasAudio: !!a.audio_path,
          })),
          !!r.completed,
        ),
      };
      if (valid(req, "lesson_parent"))
        return res.json({
          ...report,
          reviews: store.db
            .prepare(
              "SELECT * FROM reviews WHERE attempt_id IN (SELECT id FROM attempts WHERE run_id=?)",
            )
            .all(r.id),
          practiceHistory: store.db
            .prepare(
              "SELECT * FROM practice WHERE run_id=? ORDER BY created DESC",
            )
            .all(r.id),
        });
      res.json({
        ...report,
        items: undefined,
        findings: report.findings.slice(0, 2),
      });
    }),
  );
  app.get(
    "/api/interactive/parent/usage",
    wrap((req, res) => {
      parent(req);
      res.json({
        usage: store.usage(),
        limits: {
          azureCallsPerDay: Number(
            process.env.INTERACTIVE_AZURE_DAILY_CALLS || 100,
          ),
          azureSecondsPerDay: 1800,
          semanticCallsPerDay: Number(
            process.env.INTERACTIVE_SEMANTIC_DAILY_CALLS || 30,
          ),
          evaluationsPerItem: 5,
          liveGeminiCalls: 0,
        },
      });
    }),
  );
  app.get(
    "/api/interactive/parent/audio/:id",
    wrap((req, res) => {
      parent(req);
      store.cleanup();
      const a = store.db
        .prepare("SELECT audio_path FROM attempts WHERE id=?")
        .get(String(req.params.id)) as any;
      if (!a?.audio_path || !fs.existsSync(a.audio_path))
        throw Object.assign(new Error("录音已过期，请重新提交回答"), {
          status: 404,
        });
      res.sendFile(path.resolve(a.audio_path));
    }),
  );
  app.post(
    "/api/interactive/parent/review/:id",
    wrap(async (req, res) => {
      parent(req);
      const body = z
        .object({
          transcript: z.string().trim().min(1).max(2000),
          reason: z.string().trim().min(3).max(1000),
          observed: z.literal(true),
          assistance: z.boolean(),
          criteria: z.array(z.object({ id: z.string(), met: z.boolean() })),
        })
        .parse(req.body);
      const a = store.db
        .prepare("SELECT * FROM attempts WHERE id=?")
        .get(String(req.params.id)) as any;
      if (!a) throw Object.assign(new Error("回答不存在"), { status: 404 });
      const { r, c } = courseForRun(a.run_id);
      const item = c.items.find((i) => i.id === a.item_id)!;
      if (
        body.criteria.length !== item.rubric.length ||
        new Set(body.criteria.map((x) => x.id)).size !== item.rubric.length ||
        item.rubric.some((x) => !body.criteria.some((y) => y.id === x.id))
      )
        throw Object.assign(new Error("请逐项填写评分依据"), { status: 400 });
      const score = item.rubric.reduce(
        (s, x) =>
          s + (body.criteria.find((y) => y.id === x.id)!.met ? x.weight : 0),
        0,
      );
      const goalMet = item.rubric
        .filter((x) => x.required)
        .every((x) => body.criteria.find((y) => y.id === x.id)!.met);
      const file = store.review(
        a.id,
        c,
        {
          outcome: "graded",
          score,
          goalMet,
          transcript: body.transcript,
          reason: body.reason,
          criteria: body.criteria,
          reviewed: true,
          assistance: body.assistance,
        },
        body.reason,
      );
      if (file) {
        await fsp.unlink(file).catch(() => {});
        store.db
          .prepare("UPDATE attempts SET audio_path=NULL WHERE id=?")
          .run(a.id);
      }
      res.json({ run: safeState(store.run(r.id), c) });
    }),
  );
  app.post(
    "/api/interactive/runs/:id/practice",
    wrap((req, res) => {
      parent(req);
      const { r, c } = courseForRun(String(req.params.id));
      const body = z
        .object({
          objectiveId: z.string(),
          note: z.string().trim().min(1).max(1000),
        })
        .parse(req.body);
      if (
        !r.completed ||
        !c.items.some((i) => i.objectiveId === body.objectiveId)
      )
        throw Object.assign(new Error("请先完成课程，再记录课后练习"), {
          status: 409,
        });
      store.db
        .prepare("INSERT INTO practice VALUES(?,?,?,?,?)")
        .run(randomUUID(), r.id, body.objectiveId, body.note, Date.now());
      res.json({ ok: true });
    }),
  );
  const timer = setInterval(() => store.cleanup(), 3600000);
  timer.unref();
  store.cleanup();
  return store;
}
