import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { InteractiveStore } from "../../server/interactive/store";
import { assess, decodeAudio } from "../../server/interactive/assess";
import { itemSchema } from "../../shared/interactive";
const dir = path.resolve("output/interactive-qa");
const ledger = path.join(dir, "azure-confusion-probe.json");
if (fs.existsSync(ledger))
  throw Error("Probe budget already used; inspect existing results.");
const rows = JSON.parse(
  fs.readFileSync(
    "/Users/tianyufeng/Desktop/孩子学习/HFF/Unit 5/The Candy Quest 互动精讲/全英文慢速教学_7至8分钟试听版/制作文件/配音清单.json",
    "utf8",
  ),
);
const row = rows.find((x: any) => x.text.trim() === "Did I eat it all?");
if (!row) throw Error("Cached audio not found");
const item = itemSchema.parse({
  id: "read",
  objectiveId: "read",
  objective: "Read eat",
  domain: "reading",
  kind: "read",
  title: "Read",
  prompt: "Read",
  lecture: [],
  reference: "Did I ate it all?",
  keywords: ["ate"],
  alternatives: { ate: ["eat"] },
  rubric: [
    { id: "complete", label: "Complete", weight: 40, required: true },
    { id: "sound", label: "Sounds", weight: 60, required: true },
  ],
  feedback: Object.fromEntries(
    ["prompt", "correct", "hint", "model", "scaffold", "uncertain"].map((k) => [
      k,
      "a.wav",
    ]),
  ),
  hintText: "",
  modelText: "",
  scaffoldText: "",
  practice: { title: "read", steps: ["read"], success: "read" },
});
const store = new InteractiveStore(path.join(dir, "probe-db"));
fs.writeFileSync(
  ledger,
  JSON.stringify({ status: "submitted", budget: 1, provider: "azure" }),
);
try {
  const { wav, seconds } = await decodeAudio(
    fs.readFileSync(row.file).toString("base64"),
  );
  const e = await assess(item, wav, seconds, store);
  fs.writeFileSync(
    ledger,
    JSON.stringify(
      { status: "complete", source: row.file, result: e, usage: store.usage() },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(e));
} catch (e) {
  fs.writeFileSync(
    ledger,
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
