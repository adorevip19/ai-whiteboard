import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { InteractiveStore } from "../../server/interactive/store";
import { assess, decodeAudio } from "../../server/interactive/assess";
import { fixture } from "../../server/interactive/fixture";
const root =
  "/Users/tianyufeng/Desktop/孩子学习/HFF/Unit 5/The Candy Quest 互动精讲/全英文互动课堂/制作文件/双语语音提示/制作文件/合并配音";
const plans = JSON.parse(
  fs.readFileSync(path.join(root, "发音核对计划.json"), "utf8"),
);
const store = new InteractiveStore(
  path.resolve("output/interactive-qa/probe-db"),
);
for (const [n, p] of plans.entries()) {
  const dest = path.join(root, `发音核对结果-${n}.json`);
  if (fs.existsSync(dest)) {
    console.log("reuse", n);
    continue;
  }
  fs.writeFileSync(
    dest,
    JSON.stringify({ status: "submitted", automaticRetries: 0 }),
    { flag: "wx" },
  );
  const item = {
    ...fixture().items[0],
    kind: "read" as const,
    reference: p.reference,
    keywords: ["eat", "ate"],
    alternatives: { eat: ["ate"], ate: ["eat"] },
  };
  try {
    const { wav, seconds } = await decodeAudio(
      fs.readFileSync(p.file).toString("base64"),
    );
    const result = await assess(item, wav, seconds, store);
    fs.writeFileSync(
      dest,
      JSON.stringify({ status: "complete", result, source: p }, null, 2),
    );
    console.log(n, result.outcome, result.goalMet, result.score);
  } catch (e) {
    fs.writeFileSync(
      dest,
      JSON.stringify({ status: "failed_no_retry", error: String(e) }),
    );
    console.log(n, "failed");
  }
}
store.db.close();
