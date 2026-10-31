import { describe, expect, test } from "bun:test";
import type { Source } from "../data/schema.ts";
import { passageText } from "./cite.ts";

const base = { id: "s", courseId: "c", title: "T", createdAt: 0, updatedAt: 0 } as unknown as Source;

describe("passageText", () => {
  test("a note's part", () => {
    const s = { ...base, kind: "text", text: "First part." } as Source;
    expect(passageText(s, "S2", "S2 §1")).toBe("First part.");
  });
  test("every passage of a page", () => {
    const s = { ...base, kind: "pdf", pages: [{ n: 1, text: "One." }, { n: 2, text: "Two." }] } as Source;
    expect(passageText(s, "S1", "S1 p.2")).toBe("Two.");
  });
  test("the passage running at a moment", () => {
    const segments = [
      { start: 0, end: 30, text: "Intro." },
      { start: 30, end: 70, text: "Entropy." },
      { start: 70, end: 100, text: "Second law." },
    ];
    const s = { ...base, kind: "recording", transcript: { segments } } as unknown as Source;
    expect(passageText(s, "S1", "S1 1:20", 80)).toBe("Second law.");
  });
  test("a bare key shows the start", () => {
    const s = { ...base, kind: "text", text: "Start.\n\nMore." } as Source;
    expect(passageText(s, "S1", "S1")).toContain("Start.");
  });
});
