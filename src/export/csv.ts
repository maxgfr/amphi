// Anki's "Notes in plain text" format: tab-separated, with the header lines
// Anki 2.1.55+ reads (separator, HTML fields, deck, tag column). Columns:
// front (or cloze text), back (or back extra), tags, and the note type when
// some cards are cloze ("Basic" / "Cloze", Anki's stock note types).

import { type AnkiDeck, markdownToAnki } from "./anki.ts";

/** A field quoted when it holds a tab, a line break or a quote (RFC 4180, as Anki reads it). */
const field = (s: string) => (/[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function buildTsv(d: AnkiDeck): string {
  const cloze = d.cards.some((c) => c.kind === "cloze");
  const head = ["#separator:tab", "#html:true", `#deck:${d.name}`, "#tags column:3", ...(cloze ? ["#notetype column:4"] : [])];
  const rows = d.cards.map((c) => [markdownToAnki(c.front), markdownToAnki(c.back), c.tags.join(" "), ...(cloze ? [c.kind === "cloze" ? "Cloze" : "Basic"] : [])].map(field).join("\t"));
  return `${[...head, ...rows].join("\n")}\n`;
}
