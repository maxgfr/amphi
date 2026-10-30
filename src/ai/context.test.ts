import { describe, expect, test } from "bun:test";
import type { Source } from "../data/schema.ts";
import { budgetFor, buildContext, chunk, citationsIn, passagesOf, resolveLabel } from "./context.ts";
import { expandCitations } from "./labels.ts";

const base = { createdAt: 0, updatedAt: 0, courseId: "c", status: "ready" as const };
const pdf: Source = { ...base, id: "a", kind: "pdf", title: "Slides", pages: [{ n: 1, text: "Entropy measures disorder." }, { n: 2, text: "The second law: entropy never decreases." }] };
const rec: Source = {
  ...base,
  id: "b",
  kind: "recording",
  title: "Lecture",
  transcript: { segments: [{ start: 0, end: 30, text: "Hello." }, { start: 30, end: 65, text: "Today, heat engines." }, { start: 65, end: 90, text: "Carnot cycle." }] },
};
const note: Source = { ...base, id: "n", kind: "text", title: "Notes", text: "First part.\n\nSecond part." };

describe("chunk", () => {
  test("keeps short text whole and packs paragraphs", () => {
    expect(chunk("a\n\nb")).toEqual(["a\n\nb"]);
  });
  test("cuts long text under the limit, at sentence ends", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const parts = chunk(text, 200);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(200);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text);
  });
});

describe("passages", () => {
  test("label PDF pages, transcript moments and note parts", () => {
    expect(passagesOf(pdf, "S1").map((p) => p.label)).toEqual(["S1 p.1", "S1 p.2"]);
    expect(passagesOf(rec, "S2").map((p) => p.label)).toEqual(["S2 0:00", "S2 1:05"]);
    expect(passagesOf(note, "S3").map((p) => p.label)).toEqual(["S3 §1"]);
  });
});

describe("buildContext", () => {
  test("keeps everything when it fits", () => {
    const c = buildContext([pdf, rec]);
    expect(c.partial).toBe(false);
    expect(c.text).toContain('S1 = "Slides" (PDF)');
    expect(c.text).toContain("[S2 1:05]");
  });
  test("keeps the passages that match the question when it does not fit", () => {
    const c = buildContext([pdf, rec], { query: "Carnot", budget: 60 });
    expect(c.partial).toBe(true);
    expect(c.passages.map((p) => p.label)).toEqual(["S2 1:05"]);
  });
  test("spreads over everything without a question", () => {
    const c = buildContext([pdf, rec], { budget: 80 });
    expect(c.passages.length).toBeGreaterThan(0);
    expect(c.passages.length).toBeLessThan(4);
  });
});

describe("citations", () => {
  test("are found and resolved back to their source", () => {
    const text = "Entropy grows [S1 p.2]. Carnot [S2 1:05] and [S2 1:05:10]. Notes [S3 §1] [S9]";
    expect(citationsIn(text)).toEqual(["S1 p.2", "S2 1:05", "S2 1:05:10", "S3 §1", "S9"]);
    const keys = new Map([
      ["a", "S1"],
      ["b", "S2"],
    ]);
    expect(resolveLabel("S1 p.2", keys)).toEqual({ sourceId: "a", page: 2, t: undefined });
    expect(resolveLabel("S2 1:05", keys)).toEqual({ sourceId: "b", page: undefined, t: 65 });
    expect(resolveLabel("S2 1:05:10", keys)).toEqual({ sourceId: "b", page: undefined, t: 3910 });
    expect(resolveLabel("S9", keys)).toBeNull();
  });

  test("grouped in one bracket are split, other brackets are left alone", () => {
    expect(citationsIn("Joule [S1 §1, S2 §1] and Mayer [S2 p.3; S3 1:05]")).toEqual(["S1 §1", "S2 §1", "S2 p.3", "S3 1:05"]);
    expect(expandCitations("[S1 §1, S2 §1]")).toBe("[S1 §1] [S2 §1]");
    expect(expandCitations("[S1 p.2, see the slides]")).toBe("[S1 p.2, see the slides]");
  });
});

test("budget follows the context window", () => {
  expect(budgetFor(undefined)).toBe(120_000);
  expect(budgetFor(8_000)).toBe(16_000);
  expect(budgetFor(200_000)).toBe(350_000);
  expect(budgetFor(2_000_000)).toBe(600_000);
});
