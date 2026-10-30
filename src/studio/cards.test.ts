import { expect, test } from "bun:test";
import { fresh } from "../data/db.ts";
import type { Artifact, Course, Lesson, Source } from "../data/schema.ts";
import { ankiDeck, clozeAnswer, clozeQuestion, type FlashcardsData } from "./cards.ts";

test("a cloze card hides its deletions in the question (showing a hint when given) and bolds them in the answer", () => {
  const text = "In an {{c1::isolated}} system entropy never {{c2::decreases::verb}}.";
  expect(clozeQuestion(text)).toBe("In an **[…]** system entropy never **[verb]**.");
  expect(clozeAnswer(text)).toBe("In an **isolated** system entropy never **decreases**.");
});

test("the Anki deck is Course::Lesson, its cards tagged with course, lesson and concept, the cited source named on the back", () => {
  const course: Course = { ...fresh(), kind: "course", title: "Thermo dynamics" };
  const lesson: Lesson = { ...fresh(), courseId: course.id, title: "Lesson 1", order: 1 };
  const note: Source = { ...fresh(), courseId: course.id, kind: "text", title: "Entropy", text: "x", status: "ready" };
  const a = {
    ...fresh(),
    courseId: course.id,
    type: "flashcards",
    title: "Flashcards",
    sourceIds: [note.id],
    options: {},
    status: "ready",
    version: 1,
    data: { cards: [{ id: "1", kind: "basic", front: "Q", back: "A", concept: "second law", cite: "S1 §2" }] },
  } satisfies Artifact<FlashcardsData>;
  expect(ankiDeck(a, { course, lesson, sources: [note] })).toEqual({
    name: "Thermo dynamics::Lesson 1",
    cards: [{ kind: "basic", front: "Q", back: "A\n\n*Entropy, §2*", tags: ["Thermo_dynamics", "Lesson_1", "second_law"] }],
  });
});
