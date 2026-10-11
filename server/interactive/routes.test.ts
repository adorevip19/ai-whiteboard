import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { registerInteractiveRoutes } from "./routes";
import { fixture } from "./fixture";
for (const passwordless of [false, true])
  test(`HTTP passwordless=${passwordless}, draft isolation, answer locks, duplicate requests and parent evidence`, async (t) => {
    process.env.INTERACTIVE_PASSWORDLESS = String(passwordless);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "class-http-"));
    process.env.INTERACTIVE_FAMILY_PASSWORD = "test-family";
    process.env.INTERACTIVE_PARENT_PIN = "test-parent";
    process.env.INTERACTIVE_SESSION_SECRET = "test-secret-".repeat(4);
    const c = fixture();
    c.productionQa.status = "draft";
    const folder = path.join(dir, "courses", c.id, c.version);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "course.json"), JSON.stringify(c));
    fs.writeFileSync(path.join(folder, "a.wav"), "x");
    const app = express();
    app.use(express.json());
    const store = registerInteractiveRoutes(app, { dir });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const port = (server.address() as any).port;
    let cookie = "";
    const call = async (url: string, data?: any) => {
      const r = await fetch(`http://127.0.0.1:${port}/api/interactive${url}`, {
        method: data ? "POST" : "GET",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: data ? JSON.stringify(data) : undefined,
      });
      const cookies = r.headers.getSetCookie();
      if (cookies.length)
        cookie += "; " + cookies.map((x) => x.split(";")[0]).join("; ");
      return { status: r.status, data: await r.json() };
    };
    t.after(async () => {
      await new Promise<void>((r) => server.close(() => r()));
      store.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const session = await call("/session");
    assert.equal(session.data.authenticated, passwordless);
    assert.equal(session.data.parent, passwordless);
    assert.equal(session.data.passwordless, passwordless);
    assert.equal((await call("/courses")).status, passwordless ? 200 : 401);
    assert.equal(
      (await call("/login", { password: "test-family" })).status,
      200,
    );
    assert.equal(
      (await call("/runs", { courseId: c.id, version: c.version })).status,
      passwordless ? 200 : 403,
    );
    await call("/parent/unlock", { pin: "test-parent" });
    const run = (await call("/runs", { courseId: c.id, version: c.version }))
      .data;
    assert.equal(run.items[0].correctChoice, undefined);
    assert.equal(run.progress[1].status, "ready");
    const url = `/runs/${run.id}/answers`;
    assert.equal(
      (await call(url, { itemId: "nonexistent", requestId: randomUUID(), choice: "a" }))
        .status,
      404,
    );
    const id = randomUUID();
    let result = await call(url, { itemId: "q0", requestId: id, choice: "b" });
    assert.equal(result.data.run.progress[0].first, 0);
    result = await call(url, { itemId: "q0", requestId: id, choice: "a" });
    assert.equal(result.data.run.progress[0].first, 0);
    assert.equal(result.data.run.progress[0].calls, 1);
    result = await call(url, {
      itemId: "q0",
      requestId: randomUUID(),
      choice: "a",
    });
    assert.equal(result.data.run.progress[0].combined, 30);
    assert.equal(result.data.run.progress[1].status, "ready");
    const report = (await call(`/runs/${run.id}/report`)).data;
    assert.equal(report.total, null);
    assert.equal(report.items[0].attempts.length, 2);
    assert.equal(
      (
        await call(`/parent/review/${report.items[0].attempts[0].id}`, {
          transcript: "answer",
          reason: "Observed",
          assistance: false,
          criteria: [{ id: "meaning", met: true }],
        })
      ).status,
      400,
    );
  });
