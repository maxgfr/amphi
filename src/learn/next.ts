// What to do now, for the Today screen: one clear next action first, a few
// more after. Each rule looks at what the student has and has not done yet.

import { list } from "../data/db.ts";
import type { Course, Id } from "../data/schema.ts";

export type StepKind = "setup-ai" | "create-course" | "transcribe" | "summarize-lesson" | "exam-soon" | "review-concept";

export interface Step {
  kind: StepKind;
  courseId?: Id;
  lessonId?: Id;
  sourceId?: Id;
  conceptId?: Id;
  /** Data for the sentence: a title, a number of days… */
  title?: string;
  days?: number;
  /** Higher first. */
  weight: number;
}

const DAY = 86_400_000;

export function daysUntil(date: string, now = Date.now()): number {
  return Math.ceil((new Date(`${date}T00:00:00`).getTime() - now) / DAY);
}

/** Rules other modules add (Progress adds concepts to review). */
type Rule = (now: number) => Promise<Step[]>;
const rules: Rule[] = [];
export const addStepRule = (r: Rule) => rules.push(r);

export async function nextSteps(configured: boolean, now = Date.now()): Promise<Step[]> {
  const [courses, lessons, sources, artifacts] = await Promise.all([list("courses"), list("lessons"), list("sources"), list("artifacts")]);
  const steps: Step[] = [];
  if (!courses.length) steps.push({ kind: "create-course", weight: 100 });
  if (!configured) steps.push({ kind: "setup-ai", weight: courses.length ? 90 : 50 });
  for (const s of sources) {
    if (s.status === "pending") steps.push({ kind: "transcribe", courseId: s.courseId, lessonId: s.lessonId, sourceId: s.id, title: s.title, weight: 80 });
  }
  const byCourse = new Map<Id, Course>(courses.map((c) => [c.id, c]));
  for (const c of courses) {
    if (!c.examDate) continue;
    const days = daysUntil(c.examDate, now);
    if (days >= 0 && days <= 21) steps.push({ kind: "exam-soon", courseId: c.id, title: c.title, days, weight: 95 - 2 * days });
  }
  // Recent lessons with sources and nothing made from them yet.
  for (const l of lessons) {
    if (now - l.createdAt > 14 * DAY || !byCourse.has(l.courseId)) continue;
    const has = sources.some((s) => s.lessonId === l.id && s.status === "ready");
    const made = artifacts.some((a) => a.lessonId === l.id);
    if (has && !made) steps.push({ kind: "summarize-lesson", courseId: l.courseId, lessonId: l.id, title: l.title, weight: 60 - (now - l.createdAt) / DAY });
  }
  for (const r of rules) steps.push(...(await r(now)));
  return steps.sort((a, b) => b.weight - a.weight);
}
