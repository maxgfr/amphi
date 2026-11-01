import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { fresh, get, list, put, resetDbForTests } from "../data/db.ts";
import type { MindmapData } from "../studio/render/mindmap-tree.ts";
import { applyDiscovery, brief, createTopic, type DiscoverDeps, type DiscoverInput, discover, discoverTopic, loadDiscoverContext, proposalNote, TopicAnswer, toTopicMap, urlKey } from "./discover.ts";

const INPUT: DiscoverInput = { kind: "topic", topic: "Thermodynamics", level: "beginner", goal: "Pass the June exam", language: "en" };

const ANSWER = TopicAnswer.parse({
  title: "Thermodynamics",
  overview: "Heat, work and energy.",
  concepts: [{ title: "Energy", summary: "What can do work." }, { title: "Entropy", summary: "Disorder.", prerequisites: ["Energy"] }],
  sources: [
    { title: "Thermodynamics (Wikipedia)", url: "https://en.wikipedia.org/wiki/Thermodynamics", why: "An overview", level: "beginner", excerpt: "Thermodynamics deals with heat and work." },
    { title: "Same page again", url: "https://www.en.wikipedia.org/wiki/Thermodynamics/" },
    { title: "Made-up course", url: "https://example.edu/thermo-101", why: "A course", summary: "A summary instead of an excerpt." },
    { title: "Not a web page", url: "javascript:alert(1)" },
    { title: "No URL" },
  ],
});

test("URLs compare without www, fragment or trailing slash, http(s) only", () => {
  expect(urlKey("https://www.example.org/a/?q=1#x")).toBe("example.org/a?q=1");
  expect(urlKey("http://example.org/a/")).toBe("example.org/a");
  expect(urlKey("javascript:alert(1)")).toBeNull();
  expect(urlKey("not a url")).toBeNull();
});

test("with web search, proposals keep their URL and are checked against the search results", () => {
  const map = toTopicMap(ANSWER, INPUT, [{ url: "https://en.wikipedia.org/wiki/Thermodynamics#History", title: "Thermodynamics" }], true);
  expect(map.web).toBe(true);
  expect(map.concepts.map((c) => c.title)).toEqual(["Energy", "Entropy"]);
  expect(map.proposals.map((p) => [p.title, p.status, p.suggested])).toEqual([
    ["Thermodynamics (Wikipedia)", "found", true],
    ["Made-up course", "unlisted", false],
  ]);
  expect(map.proposals[1]!.excerpt).toBe("A summary instead of an excerpt.");
});

test("with web search but no listed results, proposals are kept and ticked", () => {
  const map = toTopicMap(ANSWER, INPUT, [], true);
  expect(map.proposals.map((p) => [p.status, p.suggested])).toEqual([
    ["unlisted", true],
    ["unlisted", true],
  ]);
});

test("without web search, no URL survives and readings are unsourced", () => {
  const map = toTopicMap(TopicAnswer.parse({ concepts: [{ title: "Energy" }], readings: [{ title: "Callen, Thermodynamics", why: "The classic", level: "advanced", url: "https://invented.example" }] }), INPUT, [], false);
  expect(map.title).toBe("Thermodynamics");
  expect(map.proposals).toEqual([{ title: "Callen, Thermodynamics", why: "The classic", level: "advanced", excerpt: "", status: "unsourced", suggested: false }]);
  expect(proposalNote(map.proposals[0]!, "en")).toContain("unsourced, to verify");
});

function fakeDeps(tools: boolean, calls: { system: string; prompt?: string; tools?: unknown }[]): Partial<DiscoverDeps> {
  return {
    searchTools: async () => (tools ? ({ web_search: {} } as never) : {}),
    ask: async (o) => {
      calls.push({ system: o.system, prompt: o.prompt, tools: o.tools });
      return { text: "Notes: Wikipedia covers it.", sources: [{ url: "https://en.wikipedia.org/wiki/Thermodynamics", title: "Thermodynamics" }] };
    },
    askJson: (async (schema: { parse: (v: unknown) => unknown }, o: { system: string; prompt: string }) => {
      calls.push({ system: o.system, prompt: o.prompt });
      return schema.parse(ANSWER);
    }) as never,
  };
}

test("the web path searches first, then structures the notes with the results listed", async () => {
  const calls: { system: string; prompt?: string; tools?: unknown }[] = [];
  const map = await discoverTopic(INPUT, { deps: fakeDeps(true, calls) });
  expect(calls).toHaveLength(2);
  expect(calls[0]!.tools).toEqual({ web_search: {} });
  expect(calls[0]!.system).toContain("Search the web");
  expect(calls[1]!.prompt).toContain("Notes: Wikipedia covers it.");
  expect(calls[1]!.prompt).toContain("<https://en.wikipedia.org/wiki/Thermodynamics>");
  expect(map.web).toBe(true);
  expect(map.proposals[0]!.status).toBe("found");
});

test("without a search tool, one call asks for a plan without URLs", async () => {
  const calls: { system: string; prompt?: string; tools?: unknown }[] = [];
  const map = await discoverTopic(INPUT, { deps: fakeDeps(false, calls) });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.system).toContain("cannot search the web");
  expect(calls[0]!.system).toContain("Never give a URL");
  expect(calls[0]!.prompt).toContain("Their goal, in their own words: Pass the June exam");
  expect(map.web).toBe(false);
  expect(map.proposals.every((p) => p.url === undefined && p.status === "unsourced")).toBe(true);
});

test("an empty goal is left out of the prompt and of the topic", async () => {
  const calls: { system: string; prompt?: string; tools?: unknown }[] = [];
  const input = { ...INPUT, goal: "  " };
  await discoverTopic(input, { deps: fakeDeps(false, calls) });
  expect(calls[0]!.prompt).not.toContain("goal");
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
  const course = await createTopic(input, toTopicMap(ANSWER, input, [], false), []);
  expect(course.goal).toBeUndefined();
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

test("creating the topic makes the course, the notes, the concepts and a mind map", async () => {
  const map = toTopicMap(ANSWER, INPUT, [{ url: "https://en.wikipedia.org/wiki/Thermodynamics" }], true);
  const course = await createTopic(INPUT, map, map.proposals.slice(0, 1));
  expect(course).toMatchObject({ kind: "topic", title: "Thermodynamics", goal: "Pass the June exam", level: "beginner", language: "en" });
  const [sources, concepts, artifacts] = await Promise.all([list("sources", "courseId", course.id), list("concepts", "courseId", course.id), list("artifacts", "courseId", course.id)]);
  expect(sources.map((s) => [s.kind, s.title, s.url, s.status])).toEqual([["web", "Thermodynamics (Wikipedia)", "https://en.wikipedia.org/wiki/Thermodynamics", "ready"]]);
  expect(sources[0]!.text).toBe("Thermodynamics deals with heat and work.\n\n_An overview_");
  expect(concepts.sort((a, b) => a.order - b.order).map((c) => c.title)).toEqual(["Energy", "Entropy"]);
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]).toMatchObject({ type: "mindmap", status: "ready", title: "Mind map · Thermodynamics" });
  const root = (artifacts[0]!.data as MindmapData).root;
  expect(root.children[0]!.title).toBe("Energy");
  expect(root.children[0]!.children[0]!.title).toBe("Entropy");
});

test("each seed and intent tells the model what the student brings and what the course has", () => {
  expect(brief({ ...INPUT, kind: "question", topic: "Why does ice float?" })).toStartWith("Their question: Why does ice float?");
  const ctx = { course: { id: "c", createdAt: 0, updatedAt: 0, kind: "course" as const, title: "Physics" }, concept: { id: "k", createdAt: 0, updatedAt: 0, courseId: "c", title: "Entropy", summary: "Disorder.", order: 1, prerequisites: [], refs: [] }, concepts: [], urls: new Set(["example.org/a"]) };
  ctx.concepts = [ctx.concept] as never;
  expect(brief(INPUT, ctx, "dig")).toContain("Concept to dig into: Entropy\nWhat the student has about it so far: Disorder.");
  expect(brief(INPUT, ctx, "refresh")).toContain("Pages it already has (never propose them again): example.org/a");
  expect(brief({ ...INPUT, kind: "skill", topic: "SQL" }, ctx, "extend")).toContain('It goes into their course "Physics", which already covers: Entropy');
});

test("pages the course has are left out and counted; a given link is kept; known concepts are matched", () => {
  const known = { urls: new Set(["en.wikipedia.org/wiki/Thermodynamics"]), concepts: [{ id: "k1", createdAt: 0, updatedAt: 0, courseId: "c", title: "Energy", summary: "", order: 1, prerequisites: [], refs: [] }] };
  const map = toTopicMap(ANSWER, { ...INPUT, kind: "work", topic: "https://example.org/fermi" }, [], true, known);
  expect(map.skipped).toBe(2);
  expect(map.proposals.map((p) => [p.url, p.status, p.suggested])).toEqual([
    ["https://example.org/fermi", "given", true],
    ["https://example.edu/thermo-101", "unlisted", true],
  ]);
  expect(map.concepts.map((c) => c.match)).toEqual(["k1", undefined]);
});

test("new sources need a search tool; digging asks for an explanation and sub-concepts", async () => {
  const calls: { system: string; prompt?: string; tools?: unknown }[] = [];
  await expect(discover(INPUT, { courseId: "c", refresh: true }, { deps: fakeDeps(false, calls), context: { urls: new Set(), concepts: [] } })).rejects.toThrow("web");
  await discover(INPUT, { courseId: "c", conceptId: "k" }, { deps: fakeDeps(true, calls), context: { urls: new Set(), concepts: [] } });
  expect(calls.at(-1)!.system).toContain("2 to 6 sub-concepts");
});

test("a dig adds its explanation, its sub-concepts after the concept and the chosen pages into the course", async () => {
  const c = await put("courses", { ...fresh(), kind: "course", title: "Physics" });
  const [energy, work] = await Promise.all([put("concepts", { ...fresh(), courseId: c.id, title: "Energy", summary: "", order: 1, prerequisites: [], refs: [] }), put("concepts", { ...fresh(), courseId: c.id, title: "Work", summary: "", order: 2, prerequisites: [], refs: [] })]);
  await put("sources", { ...fresh(), courseId: c.id, kind: "web", title: "Old", url: "https://en.wikipedia.org/wiki/Thermodynamics", status: "ready", trashedAt: Date.now() });
  const target = { courseId: c.id, conceptId: energy.id };
  const ctx = await loadDiscoverContext(target);
  const raw = TopicAnswer.parse({ ...ANSWER, explanation: "Energy, *further*.", concepts: [{ title: "Kinetic energy", summary: "Of motion." }, { title: "Energy" }] });
  const map = toTopicMap(raw, INPUT, [], true, ctx);
  expect(map.skipped).toBe(2);
  await applyDiscovery(INPUT, target, map, { proposals: [0], concepts: [0, 1] });
  const concepts = (await list("concepts", "courseId", c.id)).sort((a, b) => a.order - b.order);
  expect(concepts.map((x) => x.title)).toEqual(["Energy", "Kinetic energy", "Work"]);
  expect(concepts[1]).toMatchObject({ parentId: energy.id, prerequisites: [energy.id] });
  expect(concepts[2]!.id).toBe(work.id);
  const notes = (await list("sources", "courseId", c.id)).map((s) => s.title).sort();
  expect(notes).toEqual(["Deeper · Energy", "Made-up course"]);
  expect((await get("courses", c.id))?.searchedAt).toBeNumber();
});
