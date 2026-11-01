import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { nextSteps } from "../learn/next.ts";
import "../learn/rules.ts";
import { list, listAll, listTrash, resetDbForTests } from "./db.ts";
import { hasDemo, loadDemo, removeDemo } from "./demo.ts";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

test("the demo fills every part of amphi, gives Today something to do, and leaves in one go", async () => {
  await loadDemo("fr");
  expect(await hasDemo()).toBe(true);
  const courses = await list("courses");
  expect(courses.map((c) => [c.kind, c.title]).sort()).toEqual([
    ["course", "Thermodynamique"],
    ["topic", "Photosynthèse"],
  ]);
  expect((await list("artifacts")).map((a) => a.type).sort()).toEqual(["flashcards", "mindmap", "mindmap", "quiz", "report"]);
  expect((await list("lessons")).filter((l) => l.conceptIds?.length)).toHaveLength(2);
  expect(await listTrash()).toHaveLength(1);
  const kinds = (await nextSteps(false)).map((s) => s.kind);
  expect(kinds).toContain("exam-soon");
  expect(kinds).toContain("review-concept");
  expect(kinds).toContain("next-lesson");
  await removeDemo();
  expect(await hasDemo()).toBe(false);
  for (const t of ["courses", "lessons", "sources", "artifacts", "concepts", "events"] as const) expect((await listAll(t)).every((r) => r.deletedAt)).toBe(true);
});
