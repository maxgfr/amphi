import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { fresh, put, resetDbForTests } from "../data/db.ts";
import type { Concept, Course, StudyEvent } from "../data/schema.ts";
import { nextSteps } from "./next.ts";
import { eventsByConcept, masteryOf, matchConcept, nameSimilarity, nameTokens, reviewSteps, sameConcept } from "./progress.ts";
import "./rules.ts";

const DAY = 86_400_000;
const NOW = new Date("2026-10-30T12:00:00").getTime();

const concept = (title: string, order: number, extra: Partial<Concept> = {}): Concept => ({ ...fresh(NOW), courseId: "c1", title, summary: "", order, prerequisites: [], refs: [], ...extra });
const event = (score: number, extra: Partial<StudyEvent> = {}): StudyEvent => ({ ...fresh(NOW), courseId: "c1", kind: "quiz", score, at: NOW, ...extra });

test("names lose case, accents, small words and plurals", () => {
  expect(nameTokens("The Second Law of Thermodynamics")).toEqual(["second", "law", "thermodynamic"]);
  expect(nameTokens("L'énergie interne")).toEqual(["energie", "interne"]);
  expect(nameTokens("Die Entropie und das Chaos")).toEqual(["entropie", "chao"]);
});

test("concept names match loosely but not across different notions", () => {
  expect(sameConcept("Second law", "The second law of thermodynamics")).toBe(true);
  expect(sameConcept("second LAW", "Second law")).toBe(true);
  expect(sameConcept("Énergie", "energie")).toBe(true);
  expect(sameConcept("Entropy", "Entropy and disorder")).toBe(true);
  expect(sameConcept("First law of thermodynamics", "First law of motion")).toBe(false);
  expect(sameConcept("Entropy", "Enthalpy")).toBe(false);
  expect(sameConcept("", "Entropy")).toBe(false);
  expect(nameSimilarity("Entropy", "Entropy")).toBe(1);
});

test("an event goes to the closest concept, by link first", () => {
  const entropy = concept("Entropy", 1);
  const disorder = concept("Entropy and disorder", 2);
  const second = concept("The second law of thermodynamics", 3);
  expect(matchConcept("entropy", [disorder, entropy])?.id).toBe(entropy.id);
  expect(matchConcept("Heat", [entropy, second])).toBeUndefined();
  const by = eventsByConcept([entropy, disorder, second], [event(1, { concept: "Second law" }), event(0, { concept: "Entropy", conceptId: second.id }), event(1, { concept: "Heat" })]);
  expect(by.get(second.id)?.length).toBe(2);
  expect(by.get(entropy.id)?.length).toBe(0);
});

test("mastery: unseen is 0, one event at most 3, recent events weigh more", () => {
  expect(masteryOf([], NOW)).toEqual({ level: 0, events: 0 });
  expect(masteryOf([event(1)], NOW).level).toBe(3);
  expect(masteryOf([event(1), event(1)], NOW).level).toBe(4);
  expect(masteryOf([event(0), event(0)], NOW).level).toBe(0);
  expect(masteryOf([event(1), event(0)], NOW).level).toBe(2);
  // Wrong a month ago, right today: today counts four times as much.
  const better = masteryOf([event(0, { at: NOW - 28 * DAY }), event(1, { at: NOW })], NOW);
  expect(better.score).toBeCloseTo(0.8, 5);
  expect(better.level).toBe(3);
  const worse = masteryOf([event(1, { at: NOW - 28 * DAY }), event(0, { at: NOW })], NOW);
  expect(worse.level).toBe(1);
  expect(worse.last).toBe(NOW);
  expect(masteryOf([event(0.5, { kind: "self" }), event(0.5, { kind: "tutor" })], NOW).level).toBe(2);
});

test("weak concepts and their shaky prerequisites are to review", () => {
  const course: Course = { ...fresh(NOW), id: "c1", kind: "course", title: "Thermo" };
  const energy = concept("Energy", 1);
  const entropy = concept("Entropy", 2, { prerequisites: [energy.id] });
  const second = concept("Second law", 3, { prerequisites: [entropy.id] });
  const unseen = concept("Heat engines", 4);
  const events = [event(0, { concept: "Second law" }), event(0.25, { concept: "second law" }), event(1, { conceptId: energy.id }), event(1, { conceptId: energy.id })];
  const steps = reviewSteps([course], [energy, entropy, second, unseen], events, NOW);
  // Entropy is unseen but needed by a weak concept; Energy is known; Heat engines was never worked on.
  expect(steps.map((s) => [s.title, s.weight])).toEqual([
    ["Entropy", 51],
    ["Second law", 49],
  ]);
  expect(steps.every((s) => s.kind === "review-concept" && s.courseId === "c1")).toBe(true);
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

test("Today lists concepts to review under close exams and pending transcriptions", async () => {
  const c = await put("courses", { ...fresh(NOW), kind: "course", title: "Chem", examDate: "2026-11-20" });
  await put("sources", { ...fresh(NOW), courseId: c.id, kind: "recording", title: "Rec", status: "pending" });
  const acids = await put("concepts", { ...fresh(NOW), courseId: c.id, title: "Acids and bases", summary: "", order: 1, prerequisites: [], refs: [] });
  await put("events", { ...fresh(NOW), courseId: c.id, kind: "quiz", concept: "Acids", score: 0, at: NOW });
  const steps = await nextSteps(true, NOW);
  expect(steps.map((s) => s.kind)).toEqual(["transcribe", "exam-soon", "review-concept"]);
  expect(steps.at(-1)).toMatchObject({ conceptId: acids.id, title: "Acids and bases" });
});
