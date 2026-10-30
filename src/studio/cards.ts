// The flashcards' data and what is shared by their view and their exports
// (kept apart from the view so the exports and tests need no DOM).

import { resolveLabel } from "../ai/context.ts";
import type { Artifact, Course, Lesson, Source } from "../data/schema.ts";
import { type AnkiDeck, ankiTag, deckName } from "../export/anki.ts";
import { keysOf } from "../ui/cite.ts";

export type CardKind = "basic" | "cloze";

export interface Flashcard {
  id: string;
  kind: CardKind;
  /** Markdown: the question, or a cloze card's text with its {{cN::…}} deletions. */
  front: string;
  /** Markdown: the answer, or a cloze card's extra (may be empty). */
  back: string;
  /** The notion it tests, in a few words. */
  concept: string;
  /** The passage it comes from ("S1 p.3"). */
  cite?: string;
}

export interface FlashcardsData {
  cards: Flashcard[];
}

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;
export const HAS_CLOZE = /\{\{c\d+::[\s\S]+?\}\}/;
const LABEL = /^S\d+(?: (?:p\.\d+|§\d+|\d+:\d{2}(?::\d{2})?))?$/;

/** A cloze card's question: each deletion hidden (its hint shown when it has one). */
export const clozeQuestion = (text: string) => text.replace(CLOZE, (_m, _n, _a, hint?: string) => `**[${hint?.trim() || "…"}]**`);
/** A cloze card's answer: each deletion shown in bold. */
export const clozeAnswer = (text: string) => text.replace(CLOZE, (_m, _n, answer: string) => `**${answer}**`);

/** A citation as the model may write it ("[S1 p.3]", "S1 p.3"), or nothing when it is not one. */
export const label = (s: string | undefined) => {
  const v = s?.trim().replace(/^\[|\]$/g, "");
  return v && LABEL.test(v) ? v : undefined;
};

/** The cards as an Anki deck: `Course::Lesson`, tagged with course, lesson and concept, the source named on the back. */
export function ankiDeck(a: Artifact<FlashcardsData>, ctx: { course: Course; lesson?: Lesson; sources: Source[] }): AnkiDeck {
  const keys = keysOf(a.sourceIds);
  const where = (cite?: string) => {
    const r = cite ? resolveLabel(cite, keys) : null;
    const s = r && ctx.sources.find((x) => x.id === r.sourceId);
    const at = cite?.split(" ")[1];
    return s ? `*${s.title}${at ? `, ${at}` : ""}*` : "";
  };
  return {
    name: deckName(ctx.course.title, ctx.lesson?.title),
    cards: a.data.cards.map((c) => ({
      kind: c.kind,
      front: c.front,
      back: [c.back, where(c.cite)].filter(Boolean).join("\n\n"),
      tags: [ctx.course.title, ctx.lesson?.title, c.concept].filter((x): x is string => Boolean(x?.trim())).map(ankiTag),
    })),
  };
}

