// Progress's steps for Today: the concepts to review (src/learn/progress.ts),
// and the next lesson of each learning path (src/learn/path.ts).

import { list } from "../data/db.ts";
import type { Concept, Course, Id, Lesson } from "../data/schema.ts";
import { addStepRule, type Step } from "./next.ts";
import { type Mastery, masteryByConcept, reviewSteps } from "./progress.ts";

addStepRule(async (now) => {
  const [courses, concepts, events, lessons] = await Promise.all([list("courses"), list("concepts"), list("events"), list("lessons")]);
  return [...reviewSteps(courses, concepts, events, now), ...pathSteps(courses, lessons, concepts, masteryByConcept(concepts, events, now))];
});

/** Per learning path, its first lesson whose concepts are not all known (level 3 or more). */
export function pathSteps(courses: readonly Course[], lessons: readonly Lesson[], concepts: readonly Concept[], mastery: Map<Id, Mastery>): Step[] {
  const live = new Set(concepts.map((c) => c.id));
  const steps: Step[] = [];
  for (const course of courses) {
    const path = lessons.filter((l) => l.courseId === course.id && l.conceptIds?.length).sort((a, b) => a.order - b.order);
    const next = path.find((l) => l.conceptIds!.some((id) => live.has(id) && (mastery.get(id)?.level ?? 0) < 3));
    if (next) steps.push({ kind: "next-lesson", courseId: course.id, lessonId: next.id, title: next.title, weight: 55 });
  }
  return steps;
}
