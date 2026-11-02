// Discover: the student brings something (a topic, a question, a book or a
// link, a skill) and says where it goes (a new topic, a course they have, one
// of its concepts to dig into, or new sources for it). With a model that
// searches the web, a first call researches it with the provider's own search
// tool and a second one turns those notes into a plan (concepts in learning
// order) and proposed sources whose URLs are checked against the search
// results; pages the course already has, even in the trash, are never offered
// again. Without web search the plan is the model's own, its readings carry no
// URL and are marked unsourced. The app never opens those pages: a page cannot
// read other sites (CORS), the student opens them and brings back what matters.

import type { ToolSet } from "ai";
import { webSearchTools } from "llm-connect";
import { z } from "zod";
import { ask, type AskResult, capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { fresh, get, list, listAll, put, update } from "../data/db.ts";
import { addNote } from "../data/importers.ts";
import type { Artifact, Concept, Course, Id } from "../data/schema.ts";
import { colon, trIn } from "../i18n.ts";
import type { MindmapData } from "../studio/render/mindmap-tree.ts";
import { freeHue } from "../ui/hue.ts";
import { conceptRecords, conceptTree, insertConcepts, RawConcept } from "./concepts.ts";
import { matchConcept } from "./progress.ts";

export type Level = "beginner" | "intermediate" | "advanced";

/** What the student brings. */
export type SeedKind = "topic" | "question" | "work" | "skill";
export const SEED_KINDS: readonly SeedKind[] = ["topic", "question", "work", "skill"];

export interface DiscoverInput {
  kind: SeedKind;
  /** The topic, the question, the work's title or link, the skill. */
  topic: string;
  level: Level;
  /** What the student wants, in their own words ("pass the bar exam in June"); may be empty. */
  goal: string;
  /** Code of the language to write in ("fr"). */
  language: string;
}

/** Where it goes: a new topic (empty), into a course, into one of its concepts, or new sources for a course. */
export interface DiscoverTarget {
  courseId?: Id;
  conceptId?: Id;
  refresh?: boolean;
}

export type Intent = "map" | "extend" | "dig" | "refresh";

export const intentOf = (t: DiscoverTarget): Intent => (!t.courseId ? "map" : t.conceptId ? "dig" : t.refresh ? "refresh" : "extend");

export interface Proposal {
  title: string;
  /** Only when the web was searched. */
  url?: string;
  why: string;
  level?: string;
  /** What the page says, from the search. */
  excerpt: string;
  /** "found": the URL is among the search results; "unlisted": the model gave it but the search did not list it; "unsourced": no web search; "given": the student's own link. */
  status: "found" | "unlisted" | "unsourced" | "given";
  /** Ticked at first. */
  suggested: boolean;
}

export interface TopicMap {
  title: string;
  overview: string;
  /** An answer to the question, or the concept explained further (Markdown). */
  explanation?: string;
  /** `match`: the course's concept it already is, when adding into a course. */
  concepts: (RawConcept & { match?: Id })[];
  proposals: Proposal[];
  /** Pages left out because the course already has them. */
  skipped?: number;
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
  explanation: z.string().nullish(),
  concepts: z.array(RawConcept).min(1),
  sources: z.array(RawProposal).nullish(),
  readings: z.array(RawProposal).nullish(),
});
export type TopicAnswer = z.infer<typeof TopicAnswer>;

/** New sources may come without a new concept. */
const RefreshAnswer = TopicAnswer.extend({ concepts: z.array(RawConcept).nullish().transform((c) => c ?? []) });

const CONCEPTS_PART = `"concepts": [ { "title": string, "summary": string, "prerequisites": string[] } ]`;
const shapeOf = (web: boolean, explained: boolean) =>
  `{ "title": string, "overview": string,${explained ? ` "explanation": string,` : ""} ${CONCEPTS_PART},
  ${web ? `"sources": [ { "title": string, "url": string, "why": string, "level": string, "excerpt": string } ]` : `"readings": [ { "title": string, "why": string, "level": string } ]`} }`;

const LEVEL: Record<Level, string> = { beginner: "a beginner (no prior knowledge)", intermediate: "an intermediate learner (knows the basics)", advanced: "an advanced learner" };

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

/** What the course already holds, so nothing is proposed twice. */
export interface Known {
  /** `urlKey` of every web source of the course, the trash included. */
  urls: ReadonlySet<string>;
  concepts: readonly Concept[];
}

/** The model's answer as a plan and proposals: URLs only from a web search, checked against what it returned, none the course already has. */
export function toTopicMap(raw: TopicAnswer, input: DiscoverInput, found: AskResult["sources"], web: boolean, known?: Known): TopicMap {
  const listed = new Set(found.map((s) => urlKey(s.url)).filter((k) => k !== null));
  const seen = new Set<string>(known?.urls);
  const proposals: Proposal[] = [];
  let skipped = 0;
  // A link the student gave is the work itself, kept and ticked.
  const given = input.kind === "work" ? urlKey(input.topic) : null;
  if (given && !seen.has(given)) {
    seen.add(given);
    proposals.push({ title: clean(raw.title) || input.topic.trim(), url: input.topic.trim(), why: "", excerpt: clean(raw.overview), status: "given", suggested: true });
  }
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
    if (key && known?.urls.has(key)) skipped++;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const isFound = listed.has(key);
    // When the provider lists no results at all there is nothing to check against: keep them, ticked, but say so.
    proposals.push({ ...base, url: p.url!.trim(), status: isFound ? "found" : "unlisted", suggested: isFound || listed.size === 0 });
  }
  const concepts = raw.concepts.map((c) => ({ ...c, match: known ? matchConcept(c.title, known.concepts)?.id : undefined }));
  return { title: clean(raw.title) || input.topic.trim(), overview: clean(raw.overview), explanation: clean(raw.explanation) || undefined, concepts, proposals: proposals.slice(0, MAX_PROPOSALS), skipped, web };
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

/** The course, and the concept, a discovery goes into, with what they already hold. */
export interface DiscoverContext extends Known {
  course?: Course;
  concept?: Concept;
}

export async function loadDiscoverContext(target: DiscoverTarget): Promise<DiscoverContext> {
  if (!target.courseId) return { urls: new Set(), concepts: [] };
  const [course, concepts, sources] = await Promise.all([get("courses", target.courseId), list("concepts", "courseId", target.courseId), listAll("sources")]);
  const urls = new Set(sources.flatMap((s) => (s.courseId === target.courseId && !s.deletedAt && s.url ? [urlKey(s.url)].filter((k) => k !== null) : [])));
  concepts.sort((a, b) => a.order - b.order);
  return { course, concept: target.conceptId ? concepts.find((c) => c.id === target.conceptId) : undefined, urls, concepts };
}

const SEED_LABEL: Record<SeedKind, string> = {
  topic: "Topic",
  question: "Their question",
  work: "The work they want to study (a book, a paper, a course or a page)",
  skill: "The skill they want to learn",
};

/** What the model is told about the student and what they bring. */
export function brief(input: DiscoverInput, ctx?: DiscoverContext, intent: Intent = "map"): string {
  const goal = input.goal.trim();
  const names = ctx?.concepts.map((c) => c.title).join("; ");
  const lines: string[] = [];
  if (intent === "dig" && ctx?.concept) {
    lines.push(`Concept to dig into: ${ctx.concept.title}`);
    if (ctx.concept.summary) lines.push(`What the student has about it so far: ${ctx.concept.summary}`);
    if (ctx.course) lines.push(`It belongs to their ${ctx.course.kind}: ${ctx.course.title}${names ? `, whose concepts are: ${names}` : ""}`);
  } else if (intent === "refresh" && ctx?.course) {
    lines.push(`Topic: ${ctx.course.title}`);
    if (names) lines.push(`Its concepts: ${names}`);
    if (ctx.urls.size) lines.push(`Pages it already has (never propose them again): ${[...ctx.urls].join(", ")}`);
  } else {
    lines.push(`${SEED_LABEL[input.kind]}: ${input.topic.trim()}`);
    if (intent === "extend" && ctx?.course) lines.push(`It goes into their ${ctx.course.kind} "${ctx.course.title}"${names ? `, which already covers: ${names}` : ""}`);
  }
  lines.push(`The student is ${LEVEL[input.level]}.`);
  if (goal) lines.push(`Their goal, in their own words: ${goal}`);
  return lines.join("\n");
}

const PLAN_RULE =
  "Give 5 to 12 concepts in the order to learn them: what comes first is needed by what follows. Each concept has a short title (1 to 6 words), a one-paragraph explanation at the student's level as its summary, and its prerequisites (titles of earlier concepts of the list).";

/** What to make of the seed, per intent: the plan, the explanation, the kind of sources. */
function task(input: DiscoverInput, intent: Intent): { rule: string; explained: boolean; pages: string } {
  switch (intent) {
    case "dig":
      return {
        rule: "First explain the concept further in \"explanation\": a few paragraphs of Markdown at the student's level that go beyond what they have (how it works, an example, a common mistake). Then 2 to 6 sub-concepts that break it down, in the order to learn them, each with a short title, a one-paragraph summary and its prerequisites (titles of earlier sub-concepts).",
        explained: true,
        pages: "pages about this concept specifically",
      };
    case "refresh":
      return { rule: "Give as concepts only important ones missing from the topic's list, possibly none, each with a short title, a summary and its prerequisites.", explained: false, pages: "new or better pages for this topic, never one it already has" };
    default:
      switch (input.kind) {
        case "question":
          return { rule: `First answer the question in "explanation": a few paragraphs of Markdown at the student's level. Then the concepts needed to understand the answer. ${PLAN_RULE}`, explained: true, pages: "pages that answer the question or explain what it needs" };
        case "work":
          return { rule: `The concepts are the work's main ideas in the order to read and understand them. ${PLAN_RULE}`, explained: false, pages: "the work itself when it is freely available, then good summaries, lectures and discussions of it" };
        case "skill":
          return { rule: `The concepts are the sub-skills to practise, in the order to practise them. ${PLAN_RULE}`, explained: false, pages: "tutorials, exercises and worked examples first, then references" };
        default:
          return { rule: PLAN_RULE, explained: false, pages: "courses, textbooks, encyclopedia articles, lecture notes" };
      }
  }
}

/** Map what the student brings, for where it goes. A refresh needs a model that searches the web. */
/** Where a discovery is: searching the web, then turning the notes into a map (or mapping straight away without search). */
export type DiscoverStage = "searching" | "mapping";

export async function discover(input: DiscoverInput, target: DiscoverTarget = {}, o: { signal?: AbortSignal; deps?: Partial<DiscoverDeps>; context?: DiscoverContext; stage?: (s: DiscoverStage) => void } = {}): Promise<TopicMap> {
  const deps = { ...defaults, ...o.deps };
  const intent = intentOf(target);
  const ctx = o.context ?? (target.courseId ? await loadDiscoverContext(target) : undefined);
  const language = writeIn(input.language);
  const { rule, explained, pages } = task(input, intent);
  const schema = intent === "refresh" ? RefreshAnswer : TopicAnswer;
  const tools = await deps.searchTools();
  const prompt = brief(input, ctx, intent);
  if (Object.keys(tools).length) {
    o.stage?.("searching");
    const research = await deps.ask({
      system: `You research on the web for a student who wants to learn. Search the web, then write research notes: the key concepts in the order to learn them with their prerequisites${explained ? ", what is needed to explain it well" : ""}, and 5 to 10 good pages for this student's level and goal (${pages}; prefer reputable and free ones). For each page give its title, its exact URL as the search returned it, what it covers, its level, and a short excerpt or summary of what the page says. List only pages the search returned. Write in ${language}.`,
      prompt,
      tools,
      signal: o.signal,
    });
    const listed = research.sources.map((s) => `- ${s.title ?? ""} <${s.url}>`).join("\n");
    o.stage?.("mapping");
    const raw = await deps.askJson(schema, {
      system: `You map a topic for a student from web research notes. ${rule} Then 5 to 10 sources from the notes: title, the exact URL from the notes (never make one up), why it helps this student, its level, and "excerpt": what the page says, in a few sentences of Markdown taken from the notes. Write in ${language}.`,
      prompt: `${prompt}\n\nResearch notes:\n${research.text}${listed ? `\n\nPages the search returned:\n${listed}` : ""}`,
      shape: shapeOf(true, explained),
      signal: o.signal,
    });
    return toTopicMap(raw, input, research.sources, true, ctx);
  }
  if (intent === "refresh") throw new Error("Finding new sources needs a model that can search the web.");
  o.stage?.("mapping");
  const raw = await deps.askJson(schema, {
    system: `You map a topic for a student, from your own knowledge: you cannot search the web. ${rule} Then 3 to 8 reading suggestions (well-known textbooks, courses or kinds of resources) with why each helps and its level. Never give a URL or a link: the student will look them up. Write in ${language}.`,
    prompt,
    shape: shapeOf(false, explained),
    signal: o.signal,
  });
  return toTopicMap(raw, input, [], false, ctx);
}

/** A new topic's map (the first form of Discover). */
export function discoverTopic(input: DiscoverInput, o: { signal?: AbortSignal; deps?: Partial<DiscoverDeps> } = {}): Promise<TopicMap> {
  return discover(input, {}, o);
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
  const course = await put("courses", {
    ...fresh(),
    kind: "topic",
    title: map.title,
    hue: freeHue(await list("courses")),
    language: input.language,
    goal: input.goal.trim() || undefined,
    level: input.level,
    seed: input.kind,
    searchedAt: map.web ? Date.now() : undefined,
  });
  const where = { courseId: course.id };
  if (map.explanation) await addNote(where, input.topic.trim(), map.explanation);
  await addProposals(where, chosen, input.language);
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

async function addProposals(where: { courseId: Id }, chosen: readonly Proposal[], language: string) {
  for (const p of chosen) await addNote(where, p.title, proposalNote(p, language), p.url && p.status !== "unsourced" ? { kind: "web", url: p.url } : {});
}

/** The ticked proposals and concepts, as indexes into the map. */
export interface Chosen {
  proposals: readonly number[];
  concepts: readonly number[];
}

/**
 * Keep what was chosen: a new topic, or notes and concepts added into the
 * course (a dug concept's sub-concepts right after it). The course's mind map
 * is left as it is: the student may have edited it.
 */
export async function applyDiscovery(input: DiscoverInput, target: DiscoverTarget, map: TopicMap, chosen: Chosen): Promise<Course> {
  const proposals = map.proposals.filter((_, i) => chosen.proposals.includes(i));
  const intent = intentOf(target);
  if (intent === "map") return createTopic(input, map, proposals);
  const ctx = await loadDiscoverContext(target);
  if (!ctx.course) throw new Error("This course no longer exists.");
  const where = { courseId: ctx.course.id };
  const tt = trIn(input.language);
  if (map.explanation) await addNote(where, intent === "dig" && ctx.concept ? `${tt("Deeper", "Approfondir", "Vertiefung")} · ${ctx.concept.title}` : input.topic.trim(), map.explanation);
  await addProposals(where, proposals, input.language);
  const concepts = map.concepts.filter((_, i) => chosen.concepts.includes(i));
  if (concepts.length) await insertConcepts(ctx.course.id, concepts, intent === "dig" && ctx.concept ? { after: ctx.concept, parentId: ctx.concept.id } : {});
  return (map.web ? await update("courses", ctx.course.id, { searchedAt: Date.now() }) : undefined) ?? ctx.course;
}

/** What Discover was doing, kept on this device so a reload loses neither the form nor a map already paid for. */
export interface DiscoverDraft {
  input: DiscoverInput;
  /** The map job shown (src/learn/discover-jobs.ts). */
  open?: string;
  /** Before maps were jobs: the map itself. */
  map?: TopicMap | null;
  /** Indexes of the ticked proposals. */
  chosen?: number[];
  /** Indexes of the ticked concepts, when adding into a course. */
  concepts?: number[];
  /** The course a new map goes into, when chosen. */
  into?: string;
  /** A map was being made when the page went away. */
  mapping?: boolean;
}

/** One draft per place: a new topic, a course, a concept, a course's new sources. */
export const draftKey = (t: DiscoverTarget = {}) => ["amphi-discover-draft", t.courseId, t.conceptId, t.refresh ? "r" : undefined].filter(Boolean).join(":");

export function loadDraft(target: DiscoverTarget = {}): DiscoverDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(target)) ?? "null") as DiscoverDraft | null;
    if (!d || typeof d.input?.topic !== "string") return null;
    // Drafts from before seeds and concept ticks.
    return { ...d, input: { ...d.input, kind: SEED_KINDS.includes(d.input.kind) ? d.input.kind : "topic", goal: d.input.goal ?? "" }, chosen: Array.isArray(d.chosen) ? d.chosen : [], concepts: Array.isArray(d.concepts) ? d.concepts : undefined };
  } catch {
    return null;
  }
}

export function saveDraft(d: DiscoverDraft, target: DiscoverTarget = {}): void {
  try {
    if (!d.input.topic.trim() && !d.input.goal.trim() && !d.map && !d.open) localStorage.removeItem(draftKey(target));
    else localStorage.setItem(draftKey(target), JSON.stringify(d));
  } catch {
    // Storage full or blocked: the draft is a convenience.
  }
}

export function clearDraft(target: DiscoverTarget = {}): void {
  try {
    localStorage.removeItem(draftKey(target));
  } catch {
    // Nothing to clear.
  }
}
