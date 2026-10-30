import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { fresh, put, resetDbForTests } from "../data/db.ts";
import { daysUntil, nextSteps } from "./next.ts";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

test("a new student is asked to create a course first", async () => {
  const steps = await nextSteps(false);
  expect(steps.map((s) => s.kind)).toEqual(["create-course", "setup-ai"]);
});

test("pending transcriptions, close exams and unused lessons come up", async () => {
  const now = new Date("2026-10-30T12:00:00").getTime();
  const c = await put("courses", { ...fresh(now), kind: "course", title: "Chem", examDate: "2026-11-04" });
  const l = await put("lessons", { ...fresh(now), courseId: c.id, title: "Acids", order: 1 });
  await put("sources", { ...fresh(now), courseId: c.id, lessonId: l.id, kind: "pdf", title: "Slides", status: "ready", pages: [{ n: 1, text: "x" }] });
  await put("sources", { ...fresh(now), courseId: c.id, lessonId: l.id, kind: "recording", title: "Rec", status: "pending" });
  const kinds = (await nextSteps(true, now)).map((s) => s.kind);
  expect(kinds).toEqual(["exam-soon", "transcribe", "summarize-lesson"]);
});

test("days until a date", () => {
  expect(daysUntil("2026-11-04", new Date("2026-10-30T12:00:00").getTime())).toBe(5);
});
