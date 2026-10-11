import { courseSchema, type Course } from "../../shared/interactive";
export const fixture = (): Course =>
  courseSchema.parse({
    schemaVersion: 1,
    id: "test",
    version: "v1",
    title: "Test",
    description: "Test",
    language: "en-US",
    sourceVideoSha256: "0".repeat(64),
    assets: { "a.wav": { sha256: "0".repeat(64), bytes: 1 } },
    productionQa: { status: "reviewed", note: "fixture" },
    items: [
      "vocabulary",
      "vocabulary",
      "comprehension",
      "comprehension",
      "expression",
      "expression",
      "reading",
      "reading",
    ].map((d, n) => ({
      id: "q" + n,
      objectiveId: d,
      objective: d,
      domain: d,
      kind: "choice",
      title: "Q" + n,
      prompt: "Choose",
      lecture: [],
      reference: "Yes",
      choices: [
        { id: "a", text: "Yes" },
        { id: "b", text: "No" },
      ],
      correctChoice: "a",
      rubric: [
        { id: "meaning", label: "Meaning", weight: 100, required: true },
      ],
      feedback: Object.fromEntries(
        ["prompt", "correct", "hint", "model", "scaffold", "uncertain"].map(
          (k) => [k, "a.wav"],
        ),
      ),
      hintText: "Hint",
      modelText: "Model",
      scaffoldText: "Scaffold",
      practice: { title: "Practice", steps: ["Try"], success: "Yes" },
    })),
  });
