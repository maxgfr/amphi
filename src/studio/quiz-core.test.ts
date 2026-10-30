import { expect, test } from "bun:test";
import { trIn } from "../i18n.ts";
import { answerText, Grade, missed, normalizeQuestion, type Question, QuizAnswer, quizMarkdown, scoreChoice, tally, timeFor, verdictOf, verdictScore } from "./quiz-core.ts";

const en = trIn("en");
const raw = (o: Record<string, unknown>) => ({ question: "Q?", answer: 0, ...o }) as Parameters<typeof normalizeQuestion>[0];

test("questions are made consistent, or dropped", () => {
  expect(normalizeQuestion(raw({ kind: "mcq", choices: ["a", "b", "c"], answer: 2 }), "q1")).toMatchObject({ kind: "mcq", answer: 2 });
  expect(normalizeQuestion(raw({ kind: "multiple choice", choices: ["a", "b"], answer: "B" }), "q1")).toMatchObject({ kind: "mcq", answer: 1 });
  expect(normalizeQuestion(raw({ kind: "mcq", choices: ["Heat", "Work"], answer: "work" }), "q1")).toMatchObject({ answer: 1 });
  expect(normalizeQuestion(raw({ kind: "mcq", choices: ["a", "b"], answer: 2 }), "q1")).toBeNull();
  expect(normalizeQuestion(raw({ kind: "mcq", choices: ["a"], answer: 0 }), "q1")).toBeNull();
  expect(normalizeQuestion(raw({ kind: "true-false", answer: "Vrai" }), "q1")).toMatchObject({ kind: "truefalse", answer: true });
  expect(normalizeQuestion(raw({ type: "true_false", answer: false }), "q1")).toMatchObject({ kind: "truefalse", answer: false });
  expect(normalizeQuestion(raw({ kind: "truefalse", answer: "maybe" }), "q1")).toBeNull();
  expect(normalizeQuestion(raw({ kind: "short answer", answer: " It increases " }), "q1")).toMatchObject({ kind: "short", answer: "It increases" });
  expect(normalizeQuestion(raw({ kind: "short", answer: "" }), "q1")).toBeNull();
  expect(normalizeQuestion(raw({ kind: "essay", answer: "x" }), "q1")).toBeNull();
  // No kind: guessed from the choices or the answer.
  expect(normalizeQuestion(raw({ choices: ["a", "b"], answer: 1 }), "q1")?.kind).toBe("mcq");
  expect(normalizeQuestion(raw({ answer: true }), "q1")?.kind).toBe("truefalse");
  expect(normalizeQuestion(raw({ kind: "mcq", choices: ["a", "b"], cite: "[S1 p.2]", concept: " Entropy " }), "q1")).toMatchObject({ cite: "S1 p.2", concept: "Entropy" });
});

test("the model's answer keeps the questions that hold together", () => {
  const parsed = QuizAnswer.parse({
    questions: [
      { kind: "mcq", question: "Which?", choices: ["a", "b"], answer: 0, explanation: "Because [S1 §1].", concept: "Entropy", cite: "S1 §1" },
      { kind: "mcq", question: "Broken", choices: ["a"], answer: 3 },
      { kind: "truefalse", question: "True?", answer: true },
    ],
  });
  expect(parsed.map((q) => q.id)).toEqual(["q1", "q3"]);
  expect(QuizAnswer.parse([{ kind: "short", question: "Why?", answer: "Because" }])).toHaveLength(1);
  expect(QuizAnswer.safeParse({ questions: [{ kind: "mcq", question: "x", choices: [], answer: 0 }] }).success).toBe(false);
  expect(QuizAnswer.safeParse({ questions: [] }).success).toBe(false);
  expect(QuizAnswer.safeParse({ nothing: true }).success).toBe(false);
});

const qs: Question[] = [
  { id: "a", kind: "mcq", question: "A?", choices: ["x", "y", "z"], answer: 1, explanation: "Y it is [S1 §1].", concept: "c1", cite: "S1 §1" },
  { id: "b", kind: "truefalse", question: "B?", answer: false, explanation: "", concept: "c2", cite: "S1 §2" },
  { id: "c", kind: "short", question: "C?", answer: "Never", explanation: "It never decreases.", concept: "c3" },
];

test("scoring: choices checked here, short answers by verdict, half points for partly right", () => {
  expect(scoreChoice(qs[0]!, 1)).toBe(1);
  expect(scoreChoice(qs[0]!, 0)).toBe(0);
  expect(scoreChoice(qs[1]!, false)).toBe(1);
  expect(scoreChoice(qs[1]!, true)).toBe(0);
  expect(scoreChoice(qs[0]!, undefined)).toBe(0);
  expect(scoreChoice(qs[2]!, "Never")).toBe(0);
  expect(verdictScore("correct")).toBe(1);
  expect(verdictScore("partial")).toBe(0.5);
  expect(verdictScore("incorrect")).toBe(0);
  expect([1, 0.5, 0].map(verdictOf)).toEqual(["correct", "partial", "incorrect"]);
  const scores = { a: 1, c: 0.5 };
  expect(tally(qs, scores)).toEqual({ points: 1.5, total: 3, ratio: 0.5 });
  expect(missed(qs, scores).map((q) => q.id)).toEqual(["b", "c"]);
  expect(tally([], {})).toEqual({ points: 0, total: 0, ratio: 0 });
  expect(timeFor(qs)).toBe(150);
  expect(Grade.parse({ verdict: "partial" })).toEqual({ verdict: "partial", feedback: "" });
  expect(Grade.safeParse({ verdict: "maybe" }).success).toBe(false);
});

test("the Markdown export lists the questions, then the answers with their sources", () => {
  expect(answerText(qs[0]!, en)).toBe("B. y");
  expect(answerText(qs[1]!, trIn("fr"))).toBe("Faux");
  const md = quizMarkdown("Quiz · Lesson 1", qs, en);
  expect(md).toBe(
    [
      "# Quiz · Lesson 1",
      "",
      "## 1. A?",
      "",
      "- A. x",
      "- B. y",
      "- C. z",
      "",
      "## 2. B?",
      "",
      "- True",
      "- False",
      "",
      "## 3. C?",
      "",
      "_Short answer_",
      "",
      "## Answers",
      "",
      "1. **B. y**: Y it is [S1 §1].",
      "2. **False**: [S1 §2]",
      "3. **Never**: It never decreases.",
      "",
    ].join("\n"),
  );
});
