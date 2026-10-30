// How well each concept is known, from the study events (quiz answers,
// flashcards, self-assessments, tutor sessions), and which concepts to review
// next. Pure functions: no database, no React, so they are unit-tested.

import type { Concept, Course, Id, StudyEvent } from "../data/schema.ts";
import type { Step } from "./next.ts";

const DAY = 86_400_000;
/** An event counts half as much after two weeks: what was shown lately says more. */
const HALF_LIFE_DAYS = 14;

// Words that do not tell concepts apart, in the three interface languages.
const STOP = new Set(
  "the a an of and or in on to for with its is are le la les l de des du d un une et ou en au aux sur par pour der die das dem den des ein eine einer eines und oder im in von vom zu zur zum mit".split(" "),
);

/** "The Second Law of Thermodynamics" → ["second", "law", "thermodynamic"]: no case, no accents, no small words, no plural "s". */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * How close two concept names are, 0 (unrelated) to 1 (the same words). They match when every
 * word of the shorter name is in the longer ("Second law" and "The second law of
 * thermodynamics"), or when they share most of their words; the score ranks the matches.
 */
export function nameSimilarity(a: string, b: string): number {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  const jaccard = shared / (A.size + B.size - shared);
  if (shared === Math.min(A.size, B.size)) return jaccard;
  return jaccard >= 0.75 ? jaccard : 0;
}

export const sameConcept = (a: string, b: string) => nameSimilarity(a, b) > 0;

/** The concept a name refers to: the closest match, the earlier one on a tie. */
export function matchConcept(name: string, concepts: readonly Concept[]): Concept | undefined {
  let best: Concept | undefined;
  let score = 0;
  for (const c of [...concepts].sort((x, y) => x.order - y.order)) {
    const s = nameSimilarity(name, c.title);
    if (s > score) {
      best = c;
      score = s;
    }
  }
  return best;
}

/** Each concept's events: by link when the event has one, else by the concept name it carries. */
export function eventsByConcept(concepts: readonly Concept[], events: readonly StudyEvent[]): Map<Id, StudyEvent[]> {
  const out = new Map<Id, StudyEvent[]>(concepts.map((c) => [c.id, []]));
  for (const e of events) {
    const id = e.conceptId && out.has(e.conceptId) ? e.conceptId : e.concept ? matchConcept(e.concept, concepts)?.id : undefined;
    if (id) out.get(id)!.push(e);
  }
  return out;
}

export interface Mastery {
  /** 0 (not known or not seen) to 4 (mastered). */
  level: 0 | 1 | 2 | 3 | 4;
  /** How many events it rests on. */
  events: number;
  /** The weighted score, 0..1, when there are events. */
  score?: number;
  /** When it was last worked on. */
  last?: number;
}

/**
 * Mastery from a concept's events: the average of their scores (0..1), each weighted by how
 * recent it is (half the weight after two weeks), on a 0–4 scale. A single event cannot make a
 * concept mastered (at most 3); no event at all is 0.
 */
export function masteryOf(events: readonly StudyEvent[], now = Date.now()): Mastery {
  if (!events.length) return { level: 0, events: 0 };
  let weights = 0;
  let sum = 0;
  let last = 0;
  for (const e of events) {
    const w = 0.5 ** (Math.max(0, now - e.at) / DAY / HALF_LIFE_DAYS);
    weights += w;
    sum += w * Math.min(1, Math.max(0, e.score));
    last = Math.max(last, e.at);
  }
  const score = sum / weights;
  const level = Math.min(Math.round(score * 4), events.length < 2 ? 3 : 4) as Mastery["level"];
  return { level, events: events.length, score, last };
}

export function masteryByConcept(concepts: readonly Concept[], events: readonly StudyEvent[], now = Date.now()): Map<Id, Mastery> {
  const by = eventsByConcept(concepts, events);
  return new Map(concepts.map((c) => [c.id, masteryOf(by.get(c.id) ?? [], now)]));
}

/** Worked on and still weak: 0 or 1 with at least one event. */
export const isWeak = (m: Mastery | undefined) => Boolean(m && m.events > 0 && m.level <= 1);

/** At most this many concepts to review per course, so Today stays short. */
const PER_COURSE = 3;

/**
 * "Review this concept" steps: the weak concepts, and before them the prerequisites of weak
 * concepts that are not known well yet (2 or less). They weigh under close exams and pending
 * transcriptions (src/learn/next.ts).
 */
export function reviewSteps(courses: readonly Course[], concepts: readonly Concept[], events: readonly StudyEvent[], now = Date.now()): Step[] {
  const steps: Step[] = [];
  for (const course of courses) {
    const cs = concepts.filter((c) => c.courseId === course.id).sort((a, b) => a.order - b.order);
    if (!cs.length) continue;
    const m = masteryByConcept(
      cs,
      events.filter((e) => e.courseId === course.id),
      now,
    );
    const weak = cs.filter((c) => isWeak(m.get(c.id)));
    const ids = new Set(cs.map((c) => c.id));
    const prereqs = new Set(weak.flatMap((c) => c.prerequisites).filter((id) => ids.has(id) && !weak.some((w) => w.id === id) && m.get(id)!.level <= 2));
    const picked = [...cs.filter((c) => prereqs.has(c.id)).map((c) => ({ c, weight: 51 })), ...weak.map((c) => ({ c, weight: 50 - m.get(c.id)!.level }))];
    for (const { c, weight } of picked.slice(0, PER_COURSE)) steps.push({ kind: "review-concept", courseId: course.id, conceptId: c.id, title: c.title, weight });
  }
  return steps;
}
