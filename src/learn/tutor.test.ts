import { expect, test } from "bun:test";
import type { Concept } from "../data/schema.ts";
import { tutorSystem, Understanding } from "./tutor.ts";

test("an understanding score is 0..1, percentages brought back", () => {
  expect(Understanding.parse({ score: 0.4, reason: "ok" }).score).toBe(0.4);
  expect(Understanding.parse({ score: 70 }).score).toBe(0.7);
  expect(Understanding.parse({ score: "1" }).score).toBe(1);
  expect(Understanding.safeParse({ score: -1 }).success).toBe(false);
});

test("the tutor is told the concept and its summary", () => {
  const c = { title: "Entropy", summary: "Disorder [S1 p.2]." } as Concept;
  expect(tutorSystem(c)).toContain('The concept of this session: "Entropy". What it covers: Disorder [S1 p.2].');
});
