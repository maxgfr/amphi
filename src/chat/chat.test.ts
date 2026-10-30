import { expect, test } from "bun:test";
import type { Source } from "../data/schema.ts";
import { needsSummary, spellCitations } from "./chat.ts";

const s = (id: string, title: string): Source => ({ id, title, createdAt: 0, updatedAt: 0, courseId: "c", kind: "pdf", status: "ready" });

test("labels become source names outside their turn", () => {
  const out = spellCitations("A [S1 p.3], B [S2 12:34], C [S3].", ["a", "b"], [s("a", "Slides"), s("b", "Lecture")]);
  expect(out).toBe("A (Slides, p.3), B (Lecture, 12:34), C [S3].");
});

test("a long, changed conversation needs a summary", () => {
  const messages = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: "x", at: i + 10 }));
  const chat = { id: "x", createdAt: 0, updatedAt: 0, courseId: "c", mode: "chat" as const, title: "t", messages };
  expect(needsSummary(chat)).toBe(true);
  expect(needsSummary({ ...chat, summarizedAt: 100 })).toBe(false);
  expect(needsSummary({ ...chat, messages: messages.slice(0, 4) })).toBe(false);
});
