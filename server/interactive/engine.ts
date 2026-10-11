import {
  domains,
  domainLabels,
  scoreCombined,
  type Course,
  type Evaluation,
  type Item,
  type ItemProgress,
} from "../../shared/interactive";
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function choiceGrade(item: Item, answer: string): Evaluation {
  if (!item.choices?.some((x) => x.id === answer))
    throw new Error("请选择一个有效选项");
  const yes = answer === item.correctChoice;
  return {
    outcome: "graded",
    score: yes ? 100 : 0,
    goalMet: yes,
    transcript: answer,
    reason: yes ? "选择正确" : "需要订正",
    criteria: item.rubric.map((x) => ({ id: x.id, met: yes })),
  };
}
export function applyEvaluation(
  old: ItemProgress,
  e: Evaluation,
  item: Item,
): ItemProgress {
  const p = { ...old, evaluation: e, attempts: old.attempts + 1 };
  if (e.outcome === "unavailable") {
    p.attempts = old.attempts;
    p.feedback = undefined;
    p.status = old.status;
    return p;
  }
  if (e.outcome === "uncertain") {
    p.uncertainAttempts = (old.uncertainAttempts ?? 0) + 1;
    p.released = p.uncertainAttempts >= 3;
    p.status = p.released ? "complete" : "retry";
    p.releaseReason = p.released ? "unscored" : undefined;
    p.feedback = p.released ? undefined : item.feedback.uncertain;
    return p;
  }
  if (
    e.score === null ||
    !Number.isFinite(e.score) ||
    e.score < 0 ||
    e.score > 100
  )
    throw new Error("Invalid grade");
  p.first = old.first ?? e.score;
  p.final = e.score;
  p.combined = scoreCombined(p.first, e.score);
  p.assisted = old.assisted || Boolean(e.assistance) || old.first !== null;
  p.failures = (old.failures ?? 0) + (e.goalMet ? 0 : 1);
  p.released = !e.goalMet && p.failures >= 3;
  p.releaseReason = p.released ? "incorrect" : undefined;
  if (p.released) {
    p.status = "complete";
    p.feedback = undefined;
  } else if (e.goalMet) {
    p.status = "complete";
    p.feedback = item.feedback.correct;
  } else {
    p.status = "retry";
    p.feedback =
      old.first === null
        ? item.feedback.hint
        : p.attempts <= 2
          ? item.feedback.model
          : item.feedback.scaffold;
  }
  return p;
}
export function freshProgress(c: Course): ItemProgress[] {
  return c.items.map((i, n) => ({
    id: i.id,
    calls: 0,
    attempts: 0,
    first: null,
    final: null,
    combined: null,
    status: "ready",
    assisted: false,
  }));
}
export function buildReport(
  c: Course,
  p: ItemProgress[],
  attempts: any[],
  completed: boolean,
) {
  const dimensions = domains.map((d) => {
    const rows = p.filter(
      (x) => c.items.find((i) => i.id === x.id)!.domain === d,
    );
    const graded = rows.filter((x) => x.combined !== null);
    return {
      id: d,
      label: domainLabels[d],
      weight: 25,
      observations: graded.length,
      total: rows.length,
      score: graded.length
        ? graded.reduce((s, x) => s + x.combined!, 0) / graded.length
        : null,
      first: graded.length
        ? graded.reduce((s, x) => s + x.first!, 0) / graded.length
        : null,
      final: graded.length
        ? graded.reduce((s, x) => s + x.final!, 0) / graded.length
        : null,
    };
  });
  const objectives = new Map<
    string,
    {
      id: string;
      label: string;
      observations: number;
      difficulties: number;
      assisted: number;
      items: string[];
      practice: Item["practice"];
    }
  >();
  c.items.forEach((i, n) => {
    const x = p[n];
    if (x.first === null) return;
    const o = objectives.get(i.objectiveId) || {
      id: i.objectiveId,
      label: i.objective,
      observations: 0,
      difficulties: 0,
      assisted: 0,
      items: [],
      practice: i.practice,
    };
    // Recommend the task that actually needed help, not the first task in its group.
    if (
      (x.first < 80 && o.difficulties === 0) ||
      (x.assisted && o.assisted === 0 && o.difficulties === 0)
    )
      o.practice = i.practice;
    o.observations++;
    if (x.first < 80 || x.released) o.difficulties++;
    if (x.assisted) o.assisted++;
    o.items.push(i.id);
    objectives.set(i.objectiveId, o);
  });
  const findings = Array.from(objectives.values())
    .filter((o) => o.difficulties || o.assisted)
    .map((o) => ({
      ...o,
      level:
        o.difficulties >= 2
          ? "优先练习"
          : o.difficulties
            ? "待巩固，需要再次观察"
            : "有支持时可以完成",
      scoredObservations: o.observations,
    }))
    .sort((a, b) => b.difficulties - a.difficulties || b.assisted - a.assisted);
  return {
    courseId: c.id,
    version: c.version,
    title: c.title,
    complete: completed,
    total: completed && p.every(x => x.combined !== null && x.releaseReason !== "unscored")
      ? dimensions.reduce((s, d) => s + d.score! * 0.25, 0)
      : null,
    unscoredItems: p.filter(x => x.status === "complete" && (x.combined === null || x.releaseReason === "unscored")).map(x => ({ id: x.id, title: c.items.find(i => i.id === x.id)!.title })),
    dimensions,
    completedItems: p.filter((x) => x.status === "complete").length,
    totalItems: p.length,
    findings,
    practice: findings.slice(0, 3).map((x) => ({
      objectiveId: x.id,
      evidenceItems: x.items,
      ...x.practice,
    })),
    items: c.items.map((i, n) => ({
      id: i.id,
      title: i.title,
      objective: i.objective,
      domain: i.domain,
      kind: i.kind,
      choices: i.choices,
      rubric: i.rubric,
      progress: p[n],
      attempts: attempts.filter((a) => a.item_id === i.id),
    })),
    disclaimer:
      "本报告描述这节课的表现。单次错误只提示再次观察，跟读正确不等同于独立理解或表达。课后练习不改写原课程成绩。",
  };
}
