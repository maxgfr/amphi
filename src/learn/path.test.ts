import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { fresh, get, list, put, resetDbForTests } from "../data/db.ts";
import type { Concept, Source } from "../data/schema.ts";
import { applyPath, PathAnswer, pathBasis, planPath, toPath } from "./path.ts";
import { masteryOf } from "./progress.ts";
import { pathSteps } from "./rules.ts";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

const concept = (courseId: string, title: string, order: number): Concept => ({ ...fresh(), courseId, title, summary: "", order, prerequisites: [], refs: [] });
const note = (courseId: string, title: string): Source => ({ ...fresh(), courseId, kind: "web", title, text: "x", status: "ready" });

test("each concept and source lands in one lesson; forgotten concepts go into the last one", () => {
  const cs = ["Energy", "Entropy", "The second law"].map((t, i) => concept("c", t, i + 1));
  const ss = [note("c", "Fermi"), note("c", "Callen")];
  const raw = PathAnswer.parse({
    lessons: [
      { title: "Energy first", goal: "Say what energy is.", concepts: ["energy", "Nonsense"], sources: [1, 1, 9] },
      { title: "Disorder", concepts: ["Entropy", "Energy"], sources: [2] },
      { title: "Empty", concepts: [], sources: [] },
    ],
  });
  expect(toPath(raw, cs, ss)).toEqual([
    { title: "Energy first", goal: "Say what energy is.", conceptIds: [cs[0]!.id], sourceIds: [ss[0]!.id] },
    { title: "Disorder", goal: "", conceptIds: [cs[1]!.id, cs[2]!.id], sourceIds: [ss[1]!.id] },
  ]);
});

test("a path becomes lessons with their sources; a second plan covers only new concepts; Today points to the first unknown lesson", async () => {
  const c = await put("courses", { ...fresh(), kind: "topic", title: "Thermo" });
  const [energy, entropy] = await Promise.all([put("concepts", concept(c.id, "Energy", 1)), put("concepts", concept(c.id, "Entropy", 2))]);
  const fermi = await put("sources", note(c.id, "Fermi"));
  let prompt = "";
  const plan = await planPath(c, {
    deps: {
      askJson: (async (schema: { parse: (v: unknown) => unknown }, o: { prompt: string }) => {
        prompt = o.prompt;
        return schema.parse({ lessons: [{ title: "One", concepts: ["Energy"], sources: [1] }, { title: "Two", concepts: ["Entropy"] }] });
      }) as never,
    },
  });
  expect(prompt).toContain("[1] Fermi");
  const lessons = await applyPath(c.id, plan);
  expect(lessons.map((l) => [l.title, l.order, l.conceptIds])).toEqual([
    ["One", 1, [energy.id]],
    ["Two", 2, [entropy.id]],
  ]);
  expect((await get("sources", fermi.id))?.lessonId).toBe(lessons[0]!.id);
  await put("concepts", concept(c.id, "The second law", 3));
  expect((await pathBasis(c.id)).concepts.map((x) => x.title)).toEqual(["The second law"]);

  const known = masteryOf([0, 1].map(() => ({ ...fresh(), courseId: c.id, kind: "self" as const, score: 1, at: Date.now() })));
  const all = await list("concepts", "courseId", c.id);
  expect(pathSteps([c], lessons, all, new Map([[energy.id, known]]))).toEqual([{ kind: "next-lesson", courseId: c.id, lessonId: lessons[1]!.id, title: "Two", weight: 55 }]);
});
