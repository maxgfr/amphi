import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { fresh, put, resetDbForTests } from "../data/db.ts";
import type { Course } from "../data/schema.ts";
import { dismissSuggestion, loadSuggestions, suggestionBasis, type SuggestDeps, suggestTopics } from "./suggest.ts";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

const course = (title: string, extra: Partial<Course> = {}): Course => ({ ...fresh(), kind: "course", title, ...extra });

test("the basis numbers the courses, flags shaky concepts, and its fingerprint ignores mastery", () => {
  const c = course("Physics", { level: "beginner" });
  const k = { ...fresh(), courseId: c.id, title: "Entropy", summary: "", order: 1, prerequisites: [], refs: [] };
  const weak = { ...fresh(), courseId: c.id, conceptId: k.id, kind: "quiz" as const, score: 0, at: Date.now() };
  const a = suggestionBasis([c], [k], [weak]);
  expect(a.text).toBe("[1] Course: Physics (level: beginner)\n    concepts: Entropy (shaky)");
  expect(suggestionBasis([c], [k], []).fingerprint).toBe(a.fingerprint);
  expect(suggestionBasis([c], [{ ...k, title: "Enthalpy" }], []).fingerprint).not.toBe(a.fingerprint);
});

test("suggestions are kept with their course, set aside one by one, and go stale when the courses change", async () => {
  const c = await put("courses", course("Physics"));
  const deps: Partial<SuggestDeps> = {
    askJson: (async (schema: { parse: (v: unknown) => unknown }) => schema.parse({ suggestions: [{ title: "Statistical mechanics", kind: "further", why: "Where entropy comes from.", level: "intermediate", from: 1 }, { title: "Calculus", kind: "odd", level: "?", from: 9 }] })) as never,
  };
  const cache = await suggestTopics("en", { deps });
  expect(cache.items).toEqual([
    { title: "Statistical mechanics", kind: "further", why: "Where entropy comes from.", level: "intermediate", courseId: c.id },
    { title: "Calculus", kind: "related", why: "", level: "beginner", courseId: undefined },
  ]);
  await dismissSuggestion("Calculus");
  let loaded = await loadSuggestions();
  expect(loaded.items.map((s) => s.title)).toEqual(["Statistical mechanics"]);
  expect(loaded.stale).toBe(false);
  await put("courses", course("Chemistry"));
  loaded = await loadSuggestions();
  expect(loaded.stale).toBe(true);
});
