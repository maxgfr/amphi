// Discover a topic: with a model that searches the web, a first call
// researches the topic with the provider's own search tool and a second one
// turns those notes into a plan (concepts in learning order) and proposed
// sources whose URLs are checked against the search results. Without web
// search the plan is the model's own, its readings carry no URL and are marked
// unsourced. The app never opens those pages: a page cannot read other sites
// (CORS), the student opens them and brings back what matters.

import type { ToolSet } from "ai";
import { webSearchTools } from "llm-connect";
import { z } from "zod";
import { ask, type AskResult, capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { fresh, list, put } from "../data/db.ts";
import { addNote } from "../data/importers.ts";
import type { Artifact, Course } from "../data/schema.ts";
import { colon, trIn } from "../i18n.ts";
import type { MindmapData } from "../studio/render/mindmap-tree.ts";
import { freeHue } from "../ui/hue.ts";
import { conceptRecords, conceptTree, RawConcept } from "./concepts.ts";

export type Level = "beginner" | "intermediate" | "advanced";
export type Goal = "exam" | "general" | "project";

export interface DiscoverInput {
  topic: string;
  level: Level;
  goal: Goal;
  /** Code of the language to write in ("fr"). */
  language: string;
}

export interface Proposal {
  title: string;
  /** Only when the web was searched. */
  url?: string;
  why: string;
  level?: string;
  /** What the page says, from the search. */
  excerpt: string;
  /** "found": the URL is among the search results; "unlisted": the model gave it but the search did not list it; "unsourced": no web search. */
  status: "found" | "unlisted" | "unsourced";
  /** Ticked at first. */
  suggested: boolean;
}

export interface TopicMap {
  title: string;
  overview: string;
  concepts: RawConcept[];
  proposals: Proposal[];
  /** Whether the web was searched. */
  web: boolean;
}

const RawProposal = z.object({
  title: z.string().trim().min(1),
  url: z.string().nullish(),
  why: z.string().nullish(),
  level: z.string().nullish(),
  excerpt: z.string().nullish(),
  summary: z.string().nullish(),
});

export const TopicAnswer = z.object({
  title: z.string().nullish(),
  overview: z.string().nullish(),
  concepts: z.array(RawConcept).min(1),
  sources: z.array(RawProposal).nullish(),
  readings: z.array(RawProposal).nullish(),
});
export type TopicAnswer = z.infer<typeof TopicAnswer>;

const CONCEPTS_PART = `"concepts": [ { "title": string, "summary": string, "prerequisites": string[] } ]`;
const WEB_SHAPE = `{ "title": string, "overview": string, ${CONCEPTS_PART},
  "sources": [ { "title": string, "url": string, "why": string, "level": string, "excerpt": string } ] }`;
const PLAN_SHAPE = `{ "title": string, "overview": string, ${CONCEPTS_PART},
  "readings": [ { "title": string, "why": string, "level": string } ] }`;

const LEVEL: Record<Level, string> = { beginner: "a beginner (no prior knowledge)", intermediate: "an intermediate learner (knows the basics)", advanced: "an advanced learner" };
const GOAL: Record<Goal, string> = { exam: "pass an exam on it", general: "build general knowledge of it", project: "use it in a project" };

const MAX_PROPOSALS = 10;

/** A URL to compare: http(s) only, no "www.", no fragment, no trailing slash. */
export function urlKey(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return null;
  }
}

const clean = (s: string | null | undefined) => s?.trim() ?? "";

/** The model's answer as a plan and proposals: URLs only from a web search, checked against what it returned. */
export function toTopicMap(raw: TopicAnswer, input: DiscoverInput, found: AskResult["sources"], web: boolean): TopicMap {
  const listed = new Set(found.map((s) => urlKey(s.url)).filter((k) => k !== null));
  const seen = new Set<string>();
  const proposals: Proposal[] = [];
  for (const p of [...(raw.sources ?? []), ...(raw.readings ?? [])]) {
    const base = { title: p.title.replace(/\s+/g, " "), why: clean(p.why), level: clean(p.level) || undefined, excerpt: clean(p.excerpt) || clean(p.summary) };
    if (!web) {
      // A model without search makes URLs up: never keep one.
      if (seen.has(base.title)) continue;
      seen.add(base.title);
      proposals.push({ ...base, excerpt: base.excerpt, status: "unsourced", suggested: false });
      continue;
    }
    const key = p.url ? urlKey(p.url) : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const isFound = listed.has(key);
    // When the provider lists no results at all there is nothing to check against: keep them, ticked, but say so.
    proposals.push({ ...base, url: p.url!.trim(), status: isFound ? "found" : "unlisted", suggested: isFound || listed.size === 0 });
  }
  return { title: clean(raw.title) || input.topic.trim(), overview: clean(raw.overview), concepts: raw.concepts, proposals: proposals.slice(0, MAX_PROPOSALS), web };
}

/** What the calls go through; the tests pass their own. */
export interface DiscoverDeps {
  ask: typeof ask;
  askJson: typeof askJson;
  /** The provider's web search tool, `{}` when the model has none. */
  searchTools: () => Promise<ToolSet>;
}

const defaults: DiscoverDeps = {
  ask,
  askJson,
  searchTools: () => webSearchTools(capabilities().webSearch, { maxUses: 5 }),
};

/** Whether the saved model can search the web. */
export function canSearch(): boolean {
  try {
    return Boolean(capabilities().webSearch);
  } catch {
    return false;
  }
}

function brief(input: DiscoverInput) {
  return `Topic: ${input.topic.trim()}\nThe student is ${LEVEL[input.level]} and wants to ${GOAL[input.goal]}.`;
}

const PLAN_RULE =
  "Give 5 to 12 concepts in the order to learn them: what comes first is needed by what follows. Each concept has a short title (1 to 6 words), a one-paragraph explanation at the student's level as its summary, and its prerequisites (titles of earlier concepts of the list).";

export async function discoverTopic(input: DiscoverInput, o: { signal?: AbortSignal; deps?: Partial<DiscoverDeps> } = {}): Promise<TopicMap> {
  const deps = { ...defaults, ...o.deps };
  const language = writeIn(input.language);
  const tools = await deps.searchTools();
  if (Object.keys(tools).length) {
    const research = await deps.ask({
      system: `You research a topic on the web for a student who wants to learn it. Search the web, then write research notes: the key concepts in the order to learn them with their prerequisites, and 5 to 10 good pages for this student's level and goal (courses, textbooks, encyclopedia articles, lecture notes; prefer reputable and free ones). For each page give its title, its exact URL as the search returned it, what it covers, its level, and a short excerpt or summary of what the page says. List only pages the search returned. Write in ${language}.`,
      prompt: brief(input),
      tools,
      signal: o.signal,
    });
    const listed = research.sources.map((s) => `- ${s.title ?? ""} <${s.url}>`).join("\n");
    const raw = await deps.askJson(TopicAnswer, {
      system: `You map a topic for a student from web research notes. ${PLAN_RULE} Then 5 to 10 sources from the notes: title, the exact URL from the notes (never make one up), why it helps this student, its level, and "excerpt": what the page says, in a few sentences of Markdown taken from the notes. Write in ${language}.`,
      prompt: `${brief(input)}\n\nResearch notes:\n${research.text}${listed ? `\n\nPages the search returned:\n${listed}` : ""}`,
      shape: WEB_SHAPE,
      signal: o.signal,
    });
    return toTopicMap(raw, input, research.sources, true);
  }
  const raw = await deps.askJson(TopicAnswer, {
    system: `You map a topic for a student, from your own knowledge: you cannot search the web. ${PLAN_RULE} Then 3 to 8 reading suggestions (well-known textbooks, courses or kinds of resources) with why each helps and its level. Never give a URL or a link: the student will look them up. Write in ${language}.`,
    prompt: brief(input),
    shape: PLAN_SHAPE,
    signal: o.signal,
  });
  return toTopicMap(raw, input, [], false);
}

/** The note a proposal becomes: what the page says, then why it was proposed. */
export function proposalNote(p: Proposal, language: string): string {
  const tt = trIn(language);
  const why = p.why ? `_${p.why}_` : "";
  if (p.status === "unsourced") {
    return [`> ${tt("Suggested without a web search: unsourced, to verify.", "Suggéré sans recherche web : non sourcé, à vérifier.", "Ohne Websuche vorgeschlagen: ohne Quelle, zu prüfen.")}`, why, p.level ? `${colon(tt("Level", "Niveau", "Niveau"), language)} ${p.level}` : ""].filter(Boolean).join("\n\n");
  }
  return [p.excerpt, why].filter(Boolean).join("\n\n");
}

/** The topic, its chosen sources as notes, its concepts and their mind map. */
export async function createTopic(input: DiscoverInput, map: TopicMap, chosen: readonly Proposal[]): Promise<Course> {
  const course = await put("courses", { ...fresh(), kind: "topic", title: map.title, hue: freeHue(await list("courses")), language: input.language, goal: input.goal, level: input.level });
  const where = { courseId: course.id };
  for (const p of chosen) await addNote(where, p.title, proposalNote(p, input.language), p.url && p.status !== "unsourced" ? { kind: "web", url: p.url } : {});
  const concepts = conceptRecords(map.concepts, course.id);
  for (const c of concepts) await put("concepts", c);
  const tt = trIn(input.language);
  const artifact: Artifact<MindmapData> = {
    ...fresh(),
    courseId: course.id,
    type: "mindmap",
    title: `${tt("Mind map", "Carte mentale", "Mindmap")} · ${course.title}`,
    sourceIds: [],
    options: { detail: "compact", focus: "" },
    language: input.language,
    data: { root: conceptTree(course.title, concepts) },
    status: "ready",
    version: 1,
  };
  await put("artifacts", artifact as Artifact);
  return course;
}
