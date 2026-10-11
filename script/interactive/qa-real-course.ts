import "dotenv/config";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
const dir = "output/interactive-qa",
  file = dir + "/real-course-run.json";
if (fs.existsSync(file))
  throw Error("QA already started; do not auto-reissue assessment calls.");
let cookie = "";
const call = async (url: string, data?: any) => {
  const r = await fetch("http://localhost:5018/api/interactive" + url, {
    method: data ? "POST" : "GET",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
  });
  for (const c of r.headers.getSetCookie()) cookie += "; " + c.split(";")[0];
  const body = await r.json();
  if (!r.ok) throw Error(body.message);
  return body;
};
await call("/login", { password: process.env.INTERACTIVE_FAMILY_PASSWORD });
await call("/parent/unlock", { pin: process.env.INTERACTIVE_PARENT_PIN });
const r = await call("/runs", {
  courseId: "candy-quest-pilot",
  version: "1.0.0-preview",
  testOnly: true,
});
const state: any = {
  runId: r.id,
  kind: "engineering prerecorded test, not child performance",
  submitted: [],
  results: [],
};
const save = () => fs.writeFileSync(file, JSON.stringify(state, null, 2));
save();
for (const [itemId, choice] of [
  ["q1", "A"],
  ["q1", "B"],
  ["q2", "A"],
  ["q3", "B"],
  ["q4", null],
  ["q5", null],
  ["q6", "C"],
  ["q7", null],
  ["q8", null],
]) {
  const requestId = randomUUID();
  state.submitted.push({ itemId, requestId });
  save();
  const body: any = { itemId, requestId };
  if (choice) body.choice = choice;
  else body.audio = fs.readFileSync(`${dir}/${itemId}.wav`).toString("base64");
  const res = await call(`/runs/${r.id}/answers`, body);
  const p = res.run.progress.find((p: any) => p.id === itemId);
  state.results.push(p);
  save();
  console.log(
    JSON.stringify({
      itemId,
      status: p.status,
      score: p.combined,
      reason: p.evaluation?.reason,
    }),
  );
  if (itemId === "q1" && choice === "A") continue;
  if (p.status !== "complete")
    throw Error("Needs review; stop without retrying");
}
state.report = await call(`/runs/${r.id}/report`);
save();
console.log("Completed report", state.report.total);
