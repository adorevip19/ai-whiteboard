import { z } from "zod";
export const domains = [
  "vocabulary",
  "comprehension",
  "expression",
  "reading",
] as const;
export type Domain = (typeof domains)[number];
export const domainLabels: Record<Domain, string> = {
  vocabulary: "词汇理解",
  comprehension: "课文理解",
  expression: "句型运用",
  reading: "朗读与重点发音",
};
const asset = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(mp4|mp3|wav|png|jpg)$/);
const criterion = z.object({
  id: z.string(),
  label: z.string(),
  weight: z.number().positive(),
  required: z.boolean(),
  accepted: z.array(z.string()).default([]),
});
export const itemSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  objectiveId: z.string(),
  objective: z.string(),
  domain: z.enum(domains),
  kind: z.enum(["choice", "read", "speak"]),
  title: z.string(),
  prompt: z.string(),
  displayText: z.string().optional(),
  image: asset.optional(),
  images: z.array(asset).max(4).optional(),
  lecture: z.array(asset),
  reference: z.string(),
  keywords: z.array(z.string()).default([]),
  alternatives: z.record(z.array(z.string())).default({}),
  choices: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
  correctChoice: z.string().optional(),
  rubric: z.array(criterion).min(1),
  feedback: z.object({
    prompt: asset,
    correct: asset,
    hint: asset,
    model: asset,
    scaffold: asset,
    uncertain: asset,
  }),
  hintText: z.string(),
  modelText: z.string(),
  scaffoldText: z.string(),
  practice: z.object({
    title: z.string(),
    steps: z.array(z.string()).min(1),
    success: z.string(),
  }),
  source: z
    .array(
      z.object({
        start: z.number().nonnegative(),
        end: z.number().positive(),
        page: z.string(),
      }),
    )
    .default([]),
});
export const courseSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
    title: z.string(),
    description: z.string(),
    language: z.literal("en-US"),
    sourceVideoSha256: z.string().regex(/^[0-9a-f]{64}$/),
    items: z.array(itemSchema).min(8),
    assets: z.record(
      asset,
      z.object({
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        bytes: z.number().positive(),
      }),
    ),
    productionQa: z.object({
      status: z.enum(["draft", "reviewed"]),
      note: z.string(),
    }),
  })
  .superRefine((c, ctx) => {
    if (new Set(c.items.map((i) => i.id)).size !== c.items.length)
      ctx.addIssue({ code: "custom", message: "Duplicate item IDs" });
    for (const d of domains)
      if (c.items.filter((i) => i.domain === d).length < 2)
        ctx.addIssue({
          code: "custom",
          message: `At least two items required for ${d}`,
        });
    for (const i of c.items) {
      if (
        [
          i.title,
          i.prompt,
          i.displayText || "",
          ...(i.choices || []).map((x) => x.text),
        ].some((t) => /[\u3400-\u9fff]/.test(t))
      )
        ctx.addIssue({
          code: "custom",
          message: `Questions must remain English: ${i.id}`,
        });
      if (
        new Set(i.rubric.map((r) => r.id)).size !== i.rubric.length ||
        !i.rubric.some((r) => r.required)
      )
        ctx.addIssue({ code: "custom", message: `Invalid rubric: ${i.id}` });
      if (Math.abs(i.rubric.reduce((s, x) => s + x.weight, 0) - 100) > 0.001)
        ctx.addIssue({
          code: "custom",
          message: `Rubric weights must sum to 100: ${i.id}`,
        });
      if (
        i.kind === "choice" &&
        !i.choices?.some((x) => x.id === i.correctChoice)
      )
        ctx.addIssue({
          code: "custom",
          message: `Invalid correct choice: ${i.id}`,
        });
      for (const f of [
        ...i.lecture,
        ...Object.values(i.feedback),
        ...(i.image ? [i.image] : []),
        ...(i.images || []),
      ])
        if (!c.assets[f])
          ctx.addIssue({ code: "custom", message: `Missing asset: ${f}` });
      for (const s of i.source)
        if (s.end <= s.start)
          ctx.addIssue({
            code: "custom",
            message: `Invalid source range: ${i.id}`,
          });
    }
  });
export type Course = z.infer<typeof courseSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Evaluation = {
  outcome: "graded" | "uncertain" | "unavailable";
  score: number | null;
  goalMet: boolean;
  transcript: string;
  reason: string;
  criteria: Array<{ id: string; met: boolean | null }>;
  evidence?: unknown;
  reviewed?: boolean;
  assistance?: boolean;
};
export type ItemProgress = {
  id: string;
  calls: number;
  failures?: number;
  uncertainAttempts?: number;
  releaseReason?: "incorrect" | "unscored";
  released?: boolean;
  attempts: number;
  first: number | null;
  final: number | null;
  combined: number | null;
  status: "locked" | "ready" | "retry" | "review" | "complete";
  feedback?: string;
  evaluation?: Evaluation;
  assisted: boolean;
};
export const scoreCombined = (first: number, final: number) =>
  first * 0.7 + final * 0.3;
export const publicItem = (i: Item, revealed: boolean) => ({
  id: i.id,
  title: i.title,
  prompt: i.prompt,
  kind: i.kind,
  domain: i.domain,
  objective: i.objective,
  displayText: i.displayText,
  image: i.image,
  images: i.images,
  lecture: i.lecture,
  choices: i.choices,
  promptAudio: i.feedback.prompt,
  ...(revealed
    ? {
        hintText: i.hintText,
        modelText: i.modelText,
        scaffoldText: i.scaffoldText,
      }
    : {}),
});

export function nextLessonIndex(progress: ItemProgress[], current: number): number {
  const later = progress.findIndex((p, n) => n > current && p.status !== "complete");
  return later >= 0 ? later : progress.findIndex(p => p.status !== "complete");
}
