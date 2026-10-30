// The tutor: a Socratic chat on one concept (src/chat in "tutor" mode). When
// the student ends the session it is summarised into a note, and the model
// rates how well the student understood, from the exchange, as a "tutor"
// study event.

import { z } from "zod";
import { writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { spellCitations, summarizeChat } from "../chat/chat.ts";
import { fresh, list, put } from "../data/db.ts";
import type { Chat, Concept, Source } from "../data/schema.ts";
import { trIn } from "../i18n.ts";

/** What the tutor is told about its concept, after TUTOR_SYSTEM. */
export function tutorSystem(concept: Concept): string {
  return `The concept of this session: "${concept.title}".${concept.summary ? ` What it covers: ${concept.summary}` : ""} Stay on this concept and what it builds on. When the sources do not cover something, rely on the description above and well-established knowledge, and say so.`;
}

/** The session to carry on (the last one not ended yet), or a new one opened by the tutor. */
export async function tutorChat(concept: Concept, language: string): Promise<Chat> {
  const open = (await list("chats", "courseId", concept.courseId)).filter((c) => c.mode === "tutor" && c.conceptId === concept.id && !c.summarizedAt).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (open) return open;
  const tt = trIn(language);
  return put("chats", {
    ...fresh(),
    courseId: concept.courseId,
    mode: "tutor",
    conceptId: concept.id,
    title: `${tt("Tutor", "Tuteur", "Tutor")} · ${concept.title}`,
    // The opening question needs no model: the tutor starts from what the student knows.
    messages: [
      {
        role: "assistant",
        content: tt(`Let's work on “${concept.title}”. To start: what do you already know about it, in your own words?`, `Travaillons « ${concept.title} ». Pour commencer : que savez-vous déjà à ce sujet, avec vos propres mots ?`, `Arbeiten wir an „${concept.title}“. Zum Anfang: Was wissen Sie schon darüber, in Ihren eigenen Worten?`),
        at: Date.now(),
      },
    ],
  });
}

export const Understanding = z
  .object({ score: z.coerce.number().min(0).max(100), reason: z.string().default("") })
  // Some models answer in percent.
  .transform((o) => ({ ...o, score: o.score > 1 ? o.score / 100 : o.score }));

/** The student's turns, enough to rate them. */
export const hasStudentTurn = (chat: Chat) => chat.messages.some((m) => m.role === "user");

export interface SessionEnd {
  summary: string;
  score: number;
  reason: string;
}

/** End a tutor session: its summary (kept as a note) and an understanding score (kept as a study event). */
export async function endTutorSession(chat: Chat, concept: Concept, sources: Source[], language: string, signal?: AbortSignal): Promise<SessionEnd> {
  const summary = await summarizeChat(chat, sources, language, signal);
  const transcript = chat.messages.map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${spellCitations(m.content, m.sourceIds, sources)}`).join("\n\n");
  const rated = await askJson(Understanding, {
    system: `You assess how well a student understood one concept, "${concept.title}", from a tutoring session. Judge only the student's own answers: what they explained correctly, what they got wrong, how much help they needed. "score" is from 0 (not understood) to 1 (understood and explained well without help); "reason" is one sentence addressed to the student ("you"), in ${writeIn(language)}.`,
    prompt: transcript,
    shape: `{ "score": number, "reason": string }`,
    signal,
  });
  await put("events", { ...fresh(), courseId: chat.courseId, conceptId: concept.id, kind: "tutor", score: rated.score, at: Date.now() });
  return { summary, score: rated.score, reason: rated.reason };
}
