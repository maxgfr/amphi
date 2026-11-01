// A topic's concepts as a path of lessons: the model groups them, in order,
// into a few lessons and files each source under the lesson it serves. Each
// concept and each source lands in one lesson only; what the model forgets
// goes into the last one. Lessons already made keep their concepts: a second
// path only plans the concepts added since.

import { z } from "zod";
import { writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { fresh, list, put, update } from "../data/db.ts";
import type { Concept, Course, Id, Lesson, Source } from "../data/schema.ts";
import { currentLang } from "../i18n.ts";
import { matchConcept } from "./progress.ts";

export const PathAnswer = z.object({
  lessons: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        goal: z.string().nullish(),
        concepts: z.array(z.coerce.string()).nullish(),
        sources: z.array(z.coerce.number().int()).nullish(),
      }),
    )
    .min(1),
});
export type PathAnswer = z.infer<typeof PathAnswer>;

const SHAPE = `{ "lessons": [ { "title": string, "goal": string, "concepts": string[], "sources": number[] } ] }`;

export interface PlannedLesson {
  title: string;
  goal: string;
  conceptIds: Id[];
  sourceIds: Id[];
}

/** The model's lessons, made sound: known concepts and sources only, each once, none forgotten. */
export function toPath(raw: PathAnswer, concepts: readonly Concept[], sources: readonly Source[]): PlannedLesson[] {
  const usedConcepts = new Set<Id>();
  const usedSources = new Set<Id>();
  const out: PlannedLesson[] = [];
  for (const l of raw.lessons) {
    const conceptIds: Id[] = [];
    for (const name of l.concepts ?? []) {
      const c = matchConcept(name, concepts);
      if (c && !usedConcepts.has(c.id)) {
        usedConcepts.add(c.id);
        conceptIds.push(c.id);
      }
    }
    const sourceIds: Id[] = [];
    for (const n of l.sources ?? []) {
      const s = sources[n - 1];
      if (s && !usedSources.has(s.id)) {
        usedSources.add(s.id);
        sourceIds.push(s.id);
      }
    }
    if (conceptIds.length || sourceIds.length) out.push({ title: l.title.replace(/\s+/g, " "), goal: l.goal?.trim() ?? "", conceptIds, sourceIds });
  }
  const left = concepts.filter((c) => !usedConcepts.has(c.id)).map((c) => c.id);
  if (left.length && out.length) out.at(-1)!.conceptIds.push(...left);
  else if (left.length) out.push({ title: concepts.find((c) => c.id === left[0])!.title, goal: "", conceptIds: left, sourceIds: [] });
  return out;
}

/** What a path is planned from: the concepts no lesson has yet, and the sources not in a lesson. */
export async function pathBasis(courseId: Id): Promise<{ concepts: Concept[]; sources: Source[]; lessons: Lesson[] }> {
  const [concepts, sources, lessons] = await Promise.all([list("concepts", "courseId", courseId), list("sources", "courseId", courseId), list("lessons", "courseId", courseId)]);
  const planned = new Set(lessons.flatMap((l) => l.conceptIds ?? []));
  return {
    concepts: concepts.filter((c) => !planned.has(c.id)).sort((a, b) => a.order - b.order),
    sources: sources.filter((s) => !s.lessonId).sort((a, b) => a.createdAt - b.createdAt),
    lessons: lessons.sort((a, b) => a.order - b.order),
  };
}

export interface PathDeps {
  askJson: typeof askJson;
}

export async function planPath(course: Course, o: { signal?: AbortSignal; deps?: Partial<PathDeps> } = {}): Promise<PlannedLesson[]> {
  const deps = { askJson, ...o.deps };
  const { concepts, sources, lessons } = await pathBasis(course.id);
  if (!concepts.length) return [];
  const prompt = [
    `Topic: ${course.title}${course.level ? ` (the student is ${course.level})` : ""}${course.goal ? `\nTheir goal: ${course.goal}` : ""}`,
    lessons.length ? `Lessons it already has: ${lessons.map((l) => l.title).join("; ")}` : "",
    `Concepts to plan, in learning order:\n${concepts.map((c) => `- ${c.title}${c.summary ? `: ${c.summary.slice(0, 200)}` : ""}`).join("\n")}`,
    sources.length ? `Sources, numbered:\n${sources.map((s, i) => `[${i + 1}] ${s.title}${s.url ? ` <${s.url}>` : ""}${s.text ? `: ${s.text.replace(/\s+/g, " ").slice(0, 400)}` : ""}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const raw = await deps.askJson(PathAnswer, {
    system: `You plan a path of lessons through a topic for a student. Group the concepts, keeping their order, into 2 to 8 lessons of 1 to 4 concepts each, one sitting each. Each lesson has a short title, "goal": one sentence on what the student can do after it, "concepts": the titles of its concepts exactly as listed, and "sources": the numbers of the sources to read for it (each source in one lesson at most). Write in ${writeIn(course.language || currentLang())}.`,
    prompt,
    shape: SHAPE,
    signal: o.signal,
  });
  return toPath(raw, concepts, sources);
}

/** Make the lessons, after those the course has, and file the sources into them. */
export async function applyPath(courseId: Id, path: readonly PlannedLesson[]): Promise<Lesson[]> {
  const existing = await list("lessons", "courseId", courseId);
  let order = existing.reduce((n, l) => Math.max(n, l.order), 0);
  const made: Lesson[] = [];
  for (const p of path) {
    const lesson = await put("lessons", { ...fresh(), courseId, title: p.title, goal: p.goal || undefined, order: ++order, conceptIds: p.conceptIds });
    for (const id of p.sourceIds) await update("sources", id, { lessonId: lesson.id });
    made.push(lesson);
  }
  return made;
}
