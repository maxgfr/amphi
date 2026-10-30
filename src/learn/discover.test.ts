import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { list, resetDbForTests } from "../data/db.ts";
import type { MindmapData } from "../studio/render/mindmap-tree.ts";
import { createTopic, type DiscoverDeps, type DiscoverInput, discoverTopic, proposalNote, TopicAnswer, toTopicMap, urlKey } from "./discover.ts";

const INPUT: DiscoverInput = { topic: "Thermodynamics", level: "beginner", goal: "exam", language: "en" };

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
  expect(map.web).toBe(false);
  expect(map.proposals.every((p) => p.url === undefined && p.status === "unsourced")).toBe(true);
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

test("creating the topic makes the course, the notes, the concepts and a mind map", async () => {
  const map = toTopicMap(ANSWER, INPUT, [{ url: "https://en.wikipedia.org/wiki/Thermodynamics" }], true);
  const course = await createTopic(INPUT, map, map.proposals.slice(0, 1));
  expect(course).toMatchObject({ kind: "topic", title: "Thermodynamics", goal: "exam", level: "beginner", language: "en" });
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
