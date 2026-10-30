// Quizzes as data: the questions the model answers with, checked and made
// consistent (a choice index that exists, a true/false that is a boolean),
// the scoring, and the Markdown export. No React here, so it is unit-tested.

import { z } from "zod";
import type { T } from "../i18n.ts";
import { citeLabel } from "./render/mindmap-tree.ts";

export type QuestionKind = "mcq" | "truefalse" | "short";

interface QuestionBase {
  id: string;
  question: string;
  explanation: string;
  /** The notion it tests, as the quiz names it (study events carry it). */
  concept: string;
  /** The main passage, "S1 p.3". */
  cite?: string;
}

export type Question = QuestionBase & ({ kind: "mcq"; choices: string[]; answer: number } | { kind: "truefalse"; answer: boolean } | { kind: "short"; answer: string });

export interface QuizResult {
  at: number;
  score: number;
  total: number;
}

export interface QuizData {
  questions: Question[];
  /** Past attempts, latest last. */
  results?: QuizResult[];
}

/** What the student answered: a choice index, true/false, or text. */
export type Response = number | boolean | string;

const RawQuestion = z.object({
  kind: z.string().nullish(),
  type: z.string().nullish(),
  question: z.string().trim().min(1),
  choices: z.array(z.union([z.string(), z.number()])).nullish(),
  answer: z.union([z.number(), z.boolean(), z.string()]),
  explanation: z.string().nullish(),
  concept: z.string().nullish(),
  cite: z.string().nullish(),
});
type RawQuestion = z.infer<typeof RawQuestion>;

const KINDS: Record<string, QuestionKind> = {
  mcq: "mcq",
  "multiple-choice": "mcq",
  multiplechoice: "mcq",
  choice: "mcq",
  qcm: "mcq",
  truefalse: "truefalse",
  tf: "truefalse",
  boolean: "truefalse",
  short: "short",
  "short-answer": "short",
  shortanswer: "short",
  open: "short",
};

const TRUE = new Set(["true", "vrai", "wahr", "yes", "oui", "ja"]);
const FALSE = new Set(["false", "faux", "falsch", "no", "non", "nein"]);

/** One question made consistent, or null when it cannot be (a choice index out of range…). */
export function normalizeQuestion(raw: RawQuestion, id: string): Question | null {
  const key = (raw.kind ?? raw.type ?? "")
    .toLowerCase()
    .replace(/[\s_/]+/g, "-")
    .replace(/^true-?false$/, "truefalse");
  const choices = (raw.choices ?? []).map((c) => String(c).trim()).filter(Boolean);
  const kind: QuestionKind | undefined = KINDS[key] ?? KINDS[key.replace(/-/g, "")] ?? (choices.length >= 2 ? "mcq" : typeof raw.answer === "boolean" ? "truefalse" : undefined);
  const base: QuestionBase = {
    id,
    question: raw.question.trim(),
    explanation: raw.explanation?.trim() ?? "",
    concept: raw.concept?.trim() ?? "",
    cite: citeLabel(raw.cite),
  };
  if (kind === "mcq") {
    if (choices.length < 2) return null;
    let answer = -1;
    if (typeof raw.answer === "number") answer = raw.answer;
    else if (typeof raw.answer === "string") {
      const a = raw.answer.trim();
      const exact = choices.findIndex((c) => c.toLowerCase() === a.toLowerCase());
      if (exact >= 0) answer = exact;
      else if (/^[A-Za-z]$/.test(a)) answer = a.toUpperCase().charCodeAt(0) - 65;
      else if (/^\d+$/.test(a)) answer = Number(a);
    }
    if (!Number.isInteger(answer) || answer < 0 || answer >= choices.length) return null;
    return { ...base, kind, choices, answer };
  }
  if (kind === "truefalse") {
    const a = typeof raw.answer === "string" ? raw.answer.trim().toLowerCase() : raw.answer;
    const answer = a === true || (typeof a === "string" && TRUE.has(a)) ? true : a === false || (typeof a === "string" && FALSE.has(a)) ? false : null;
    return answer === null ? null : { ...base, kind, answer };
  }
  if (kind === "short") {
    const answer = String(raw.answer).trim();
    return answer ? { ...base, kind, answer } : null;
  }
  return null;
}

/** The model's answer: { questions: [...] } or a bare array, the questions that hold together kept. */
export const QuizAnswer = z
  .union([z.object({ questions: z.array(RawQuestion) }).transform((o) => o.questions), z.array(RawQuestion)])
  .transform((qs) => qs.map((q, i) => normalizeQuestion(q, `q${i + 1}`)).filter((q) => q !== null))
  .refine((qs) => qs.length > 0, { message: "no usable question: check each question's kind, choices and answer" });

export const SHAPE = `{ "questions": [ {
  "kind": "mcq" | "truefalse" | "short",
  "question": string,
  "choices"?: string[],            // mcq only, 4 choices
  "answer": number | boolean | string, // mcq: index of the right choice (0-based); truefalse: true or false; short: the expected answer
  "explanation": string,           // why, with citation labels in square brackets
  "concept": string,               // the notion tested, 1 to 4 words
  "cite": string                   // the main passage label, e.g. "S1 p.3"
} ] }`;

/** 1 when right, 0 when wrong; short answers are graded by the model instead. */
export function scoreChoice(q: Question, r: Response | undefined): number {
  if (r === undefined) return 0;
  if (q.kind === "mcq") return r === q.answer ? 1 : 0;
  if (q.kind === "truefalse") return r === q.answer ? 1 : 0;
  return 0;
}

export type Verdict = "correct" | "partial" | "incorrect";
export const verdictScore = (v: Verdict) => (v === "correct" ? 1 : v === "partial" ? 0.5 : 0);
export const verdictOf = (score: number): Verdict => (score >= 1 ? "correct" : score > 0 ? "partial" : "incorrect");

export const Grade = z.object({ verdict: z.enum(["correct", "partial", "incorrect"]), feedback: z.string().default("") });

/** Points (half points for partly right answers) over the questions asked. */
export function tally(questions: readonly Question[], scores: Readonly<Record<string, number>>): { points: number; total: number; ratio: number } {
  const points = questions.reduce((s, q) => s + (scores[q.id] ?? 0), 0);
  const total = questions.length;
  return { points, total, ratio: total ? points / total : 0 };
}

/** The questions not fully right, to try again. */
export const missed = (questions: readonly Question[], scores: Readonly<Record<string, number>>) => questions.filter((q) => (scores[q.id] ?? 0) < 1);

/** The right answer as text. */
export function answerText(q: Question, t: T): string {
  if (q.kind === "mcq") return `${String.fromCharCode(65 + q.answer)}. ${q.choices[q.answer]}`;
  if (q.kind === "truefalse") return q.answer ? t("True", "Vrai", "Wahr") : t("False", "Faux", "Falsch");
  return q.answer;
}

/** A time budget: 30 s per choice question, 90 s per short answer. */
export const timeFor = (questions: readonly Question[]) => questions.reduce((s, q) => s + (q.kind === "short" ? 90 : 30), 0);

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

/** Questions, then the answers with their explanations: printable, or pasted into notes. */
export function quizMarkdown(title: string, questions: readonly Question[], t: T): string {
  const out = [`# ${oneLine(title)}`, ""];
  questions.forEach((q, i) => {
    out.push(`## ${i + 1}. ${oneLine(q.question)}`, "");
    if (q.kind === "mcq") q.choices.forEach((c, j) => out.push(`- ${String.fromCharCode(65 + j)}. ${oneLine(c)}`));
    else if (q.kind === "truefalse") out.push(`- ${t("True", "Vrai", "Wahr")}`, `- ${t("False", "Faux", "Falsch")}`);
    else out.push(`_${t("Short answer", "Réponse courte", "Kurze Antwort")}_`);
    out.push("");
  });
  out.push(`## ${t("Answers", "Réponses", "Antworten")}`, "");
  questions.forEach((q, i) => {
    const why = [q.explanation ? oneLine(q.explanation) : "", q.cite && !q.explanation.includes(`[${q.cite}]`) ? `[${q.cite}]` : ""].filter(Boolean).join(" ");
    out.push(`${i + 1}. **${oneLine(answerText(q, t))}**${why ? `: ${why}` : ""}`);
  });
  return `${out.join("\n")}\n`;
}
