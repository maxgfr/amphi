// Talking with one's sources: each question is answered from the passages
// that match it (and the recent exchange), cited; an exchange can be
// summarised into a note that joins the sources.

import type { ModelMessage } from "ai";
import { budgetFor, buildContext, CITE_RULE } from "../ai/context.ts";
import { ask, askStream, capabilities, writeIn } from "../ai/llm.ts";
import { addNote } from "../data/importers.ts";
import { update } from "../data/db.ts";
import type { Chat, Source } from "../data/schema.ts";
import { trIn } from "../i18n.ts";

/** How many earlier messages travel with each question. */
const HISTORY = 12;

export const TUTOR_SYSTEM =
  "You are a Socratic tutor. Help the student understand the concept by asking one graded question at a time, starting from what they already know; give hints rather than answers, correct misconceptions precisely, and only give the full explanation once they have tried. Keep each turn short.";

export function chatSystem(chat: Chat, language: string, extra = ""): string {
  const role = chat.mode === "tutor" ? TUTOR_SYSTEM : "You are a study assistant for a university student. Answer from their course sources, clearly and precisely, with examples when useful.";
  return `${role} Write in ${writeIn(language)}, in Markdown. ${CITE_RULE}${extra ? `\n\n${extra}` : ""}`;
}

/** The sources for this question, then the conversation. */
export function chatMessages(chat: Chat, sources: Source[], question: string): ModelMessage[] {
  const recent = chat.messages.slice(-HISTORY);
  const query = [question, ...recent.filter((m) => m.role === "user").map((m) => m.content)].join(" ");
  const context = buildContext(sources, { query, budget: budgetFor(capabilities().contextWindow) });
  return [
    { role: "user", content: `Here are my course sources.\n\n${context.text}` },
    { role: "assistant", content: "Understood. Ask me anything about them." },
    // Earlier answers name their sources in full: their labels belonged to the passages of that turn.
    ...recent.map((m) => ({ role: m.role, content: m.role === "assistant" ? spellCitations(m.content, m.sourceIds, sources) : m.content }) as ModelMessage),
    { role: "user", content: question },
  ];
}

export async function* answer(chat: Chat, sources: Source[], question: string, language: string, signal?: AbortSignal, extraSystem = ""): AsyncGenerator<string> {
  yield* askStream({ system: chatSystem(chat, language, extraSystem), messages: chatMessages(chat, sources, question), signal });
}

/** "[S1 p.3]" → "(Title, p.3)": labels only mean something next to the passages they were given with. */
export function spellCitations(text: string, sourceIds: readonly string[] | undefined, sources: Source[]): string {
  if (!sourceIds) return text;
  return text.replace(/\[S(\d+)((?: (?:p\.\d+|§\d+|\d+:\d{2}(?::\d{2})?))?)\]/g, (m, n: string, rest: string) => {
    const s = sources.find((x) => x.id === sourceIds[Number(n) - 1]);
    return s ? `(${s.title}${rest ? `,${rest}` : ""})` : m;
  });
}

/** Summarise the exchange; the summary is kept on the chat and as a note among the sources. */
export async function summarizeChat(chat: Chat, sources: Source[], language: string, signal?: AbortSignal): Promise<string> {
  const transcript = chat.messages.map((m) => `${m.role === "user" ? "Student" : "Assistant"}: ${spellCitations(m.content, m.sourceIds, sources)}`).join("\n\n");
  const { text } = await ask({
    system: `You summarise a study conversation for the student's notes. Write in ${writeIn(language)}, Markdown, with three short sections: what was clarified (the explanations, as the key points to remember), the questions that remain open, and the concepts worked on. Keep the references to sources, such as (Title, p.3), that appear. No title.`,
    prompt: transcript,
    signal,
  });
  const summary = text.trim();
  const tt = trIn(language);
  await update("chats", chat.id, { summary, summarizedAt: Date.now() });
  await addNote({ courseId: chat.courseId, lessonId: chat.lessonId }, `${tt("Exchange summary", "Résumé d'échange", "Zusammenfassung des Gesprächs")} · ${chat.title}`, summary);
  return summary;
}

/** A conversation worth summarising: long enough, and changed since its last summary. */
export const needsSummary = (chat: Chat) => chat.messages.length >= 6 && (!chat.summarizedAt || chat.messages.some((m) => m.at > chat.summarizedAt!));
