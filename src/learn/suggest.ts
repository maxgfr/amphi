// Topics to discover next, from what the student already follows: further
// than a course goes, what it needs first, or next to it. One call without
// tools (cheap: nothing is searched yet, Discover does that once one is
// picked), and only when the student asks; the answer stays on this device
// until their courses or concepts change.

import { z } from "zod";
import { writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { getMeta, list, setMeta } from "../data/db.ts";
import type { Concept, Course, Id, StudyEvent } from "../data/schema.ts";
import type { Level } from "./discover.ts";
import { isWeak, masteryByConcept } from "./progress.ts";

export type SuggestionKind = "further" | "prerequisite" | "related";

export interface Suggestion {
  title: string;
  kind: SuggestionKind;
  why: string;
  level: Level;
  /** The course it comes from. */
  courseId?: Id;
}

export interface SuggestionCache {
  at: number;
  /** What the suggestions were made from (courses and concepts, not mastery). */
  fingerprint: string;
  language: string;
  items: Suggestion[];
  /** Titles the student set aside. */
  dismissed: string[];
}

const KEY = "discover-suggestions";
const MAX_COURSES = 12;

/** A short hash, so the fingerprint stays small in storage. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** What the model is told: the recent courses and topics, numbered, with their concepts and how well each is known. */
export function suggestionBasis(courses: readonly Course[], concepts: readonly Concept[], events: readonly StudyEvent[], now = Date.now()): { text: string; fingerprint: string; courses: Course[] } {
  const recent = [...courses].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_COURSES);
  const mastery = masteryByConcept(concepts, events, now);
  const lines: string[] = [];
  const keys: string[] = [];
  for (const [i, c] of recent.entries()) {
    const own = concepts.filter((x) => x.courseId === c.id).sort((a, b) => a.order - b.order);
    const facts = [c.level ? `level: ${c.level}` : "", c.goal ? `goal: ${c.goal}` : ""].filter(Boolean).join(", ");
    lines.push(`[${i + 1}] ${c.kind === "topic" ? "Topic" : "Course"}: ${c.title}${facts ? ` (${facts})` : ""}`);
    if (own.length) {
      const names = own.map((x) => {
        const m = mastery.get(x.id);
        return `${x.title}${isWeak(m) ? " (shaky)" : m && m.level >= 3 ? " (known)" : ""}`;
      });
      lines.push(`    concepts: ${names.join("; ")}`);
    }
    keys.push(`${c.id}:${c.title}:${own.map((x) => x.title).join("|")}`);
  }
  return { text: lines.join("\n"), fingerprint: hash(keys.sort().join("\n")), courses: recent };
}

const Answer = z.object({
  suggestions: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        kind: z.enum(["further", "prerequisite", "related"]).catch("related"),
        why: z.string().nullish(),
        level: z.enum(["beginner", "intermediate", "advanced"]).catch("beginner"),
        from: z.coerce.number().int().nullish(),
      }),
    )
    .min(1),
});

const SHAPE = `{ "suggestions": [ { "title": string, "kind": "further" | "prerequisite" | "related", "why": string, "level": "beginner" | "intermediate" | "advanced", "from": number } ] }`;

async function basis(now = Date.now()) {
  const [courses, concepts, events] = await Promise.all([list("courses"), list("concepts"), list("events")]);
  return suggestionBasis(courses, concepts, events, now);
}

/** What the tests pass instead of the model. */
export interface SuggestDeps {
  askJson: typeof askJson;
}

/** Ask for up to six topics, and keep them. */
export async function suggestTopics(language: string, o: { signal?: AbortSignal; deps?: Partial<SuggestDeps> } = {}): Promise<SuggestionCache> {
  const deps = { askJson, ...o.deps };
  const b = await basis();
  const raw = await deps.askJson(Answer, {
    system: `You suggest what a student could learn next, from the courses and topics they follow. Give 3 to 6 topics, each one a good thing to discover on its own: "further" goes beyond a course, "prerequisite" is something a course needs and the student seems to lack (shaky concepts point to it), "related" sits next to what they follow. Each has a short title (1 to 8 words, a topic, not a sentence), "why": one sentence for this student, its level, and "from": the number of the course it comes from. Never suggest something a course already covers. Write in ${writeIn(language)}.`,
    prompt: b.text,
    shape: SHAPE,
    signal: o.signal,
  });
  const previous = await getMeta<SuggestionCache>(KEY);
  const cache: SuggestionCache = {
    at: Date.now(),
    fingerprint: b.fingerprint,
    language,
    items: raw.suggestions.slice(0, 6).map((s) => ({ title: s.title, kind: s.kind, why: s.why?.trim() ?? "", level: s.level, courseId: s.from ? b.courses[s.from - 1]?.id : undefined })),
    dismissed: previous?.dismissed ?? [],
  };
  await setMeta(KEY, cache);
  return cache;
}

/** The kept suggestions (without the dismissed ones), whether the courses changed since, and whether there is anything to suggest from. */
export async function loadSuggestions(): Promise<{ cache?: SuggestionCache; items: Suggestion[]; stale: boolean; courses: number }> {
  const [cache, b] = await Promise.all([getMeta<SuggestionCache>(KEY), basis()]);
  const items = cache ? cache.items.filter((s) => !cache.dismissed.includes(s.title)) : [];
  return { cache, items, stale: Boolean(cache && cache.fingerprint !== b.fingerprint), courses: b.courses.length };
}

export async function dismissSuggestion(title: string): Promise<void> {
  const cache = await getMeta<SuggestionCache>(KEY);
  if (cache) await setMeta(KEY, { ...cache, dismissed: [...new Set([...cache.dismissed, title])].slice(-50) });
}
