// What the Anki exports (.apkg, plain text) share: the cards as Anki sees
// them, their field HTML, their tags and the deck they land in. Anki fields
// are HTML; cloze deletions ({{c1::…}}) pass through untouched.

import { Marked } from "marked";

export interface AnkiCard {
  kind: "basic" | "cloze";
  /** Markdown; a cloze card's text with its {{cN::…}} deletions. */
  front: string;
  /** Markdown; a cloze card's "Back Extra". */
  back: string;
  tags: string[];
}

export interface AnkiDeck {
  /** Anki deck path, `::` between levels ("Thermodynamics::Lesson 1"). */
  name: string;
  cards: AnkiCard[];
}

const marked = new Marked({ gfm: true, breaks: false, async: false });

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Markdown to Anki field HTML: `$…$` and `$$…$$` become MathJax delimiters, a lone paragraph loses its <p>. */
export function markdownToAnki(md: string): string {
  const kept: string[] = [];
  const hold = (s: string) => {
    kept.push(s);
    return `AMPHIKEPT${kept.length - 1}X`;
  };
  const src = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => hold(`\\[${escapeHtml(tex.trim())}\\]`))
    .replace(/\$(?!\$)((?:\\.|[^\\$\n])+?)\$(?!\d)/g, (_m, tex: string) => hold(`\\(${escapeHtml(tex)}\\)`));
  let html = (marked.parse(src) as string).trim();
  const single = /^<p>([\s\S]*)<\/p>$/.exec(html);
  if (single?.[1] !== undefined && !single[1].includes("<p>")) html = single[1];
  // The line breaks marked puts between blocks mean nothing in HTML: without them a plain-text row stays one line.
  return html.replace(/>\n+</g, "><").replace(/AMPHIKEPT(\d+)X/g, (_m, i: string) => kept[Number(i)] ?? "");
}

/** One Anki tag: no spaces (they separate tags), never empty. */
export const ankiTag = (s: string) => s.trim().replace(/\s+/g, "_").replace(/"/g, "");

/** One deck path segment: no `::` (the Anki separator), never empty. */
export const deckSegment = (s: string) => s.replace(/::/g, ":").replace(/\s+/g, " ").trim() || "-";

/** The deck of a course or a lesson: `Course::Lesson`, which Anki shows nested and Cursus imports as course and subset. */
export const deckName = (course: string, lesson?: string) => [course, lesson].filter((s): s is string => Boolean(s)).map(deckSegment).join("::");

/** The cloze numbers a text uses, sorted (an Anki cloze note makes one card per number). */
export function clozeNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1])))].filter((n) => n > 0).sort((a, b) => a - b);
}
