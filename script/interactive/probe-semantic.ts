import "dotenv/config";
import fs from "node:fs";
import { assess, decodeAudio } from "../../server/interactive/assess";
import { InteractiveStore } from "../../server/interactive/store";
const dir = "output/interactive-qa";
const file = dir + "/semantic-probe.json";
if (fs.existsSync(file))
  throw Error("Probe already submitted; no automatic retry");
const root =
  "/Users/tianyufeng/Desktop/孩子学习/HFF/Unit 5/The Candy Quest 互动精讲/全英文互动课堂";
const c = JSON.parse(fs.readFileSync(root + "/课程包/course.json", "utf8"));
const item = {
  ...c.items[7],
  rubric: c.items[7].rubric.map((r: any) => ({ ...r, accepted: [] })),
};
const store = new InteractiveStore(dir + "/probe-db");
fs.writeFileSync(
  file,
  JSON.stringify({ status: "submitted", budget: { azure: 1, semantic: 1 } }),
);
try {
  const audio = await decodeAudio(
    fs.readFileSync(dir + "/q8.wav").toString("base64"),
  );
  const result = await assess(item, audio.wav, audio.seconds, store);
  fs.writeFileSync(
    file,
    JSON.stringify({ result, usage: store.usage() }, null, 2),
  );
  console.log(
    JSON.stringify({
      outcome: result.outcome,
      goalMet: result.goalMet,
      score: result.score,
    }),
  );
} catch (e) {
  fs.writeFileSync(
    file,
    JSON.stringify(
      { status: "failed_no_retry", message: String(e), usage: store.usage() },
      null,
      2,
    ),
  );
  console.log(String(e));
} finally {
  store.db.close();
}
