// What the model reads: the chosen sources cut into labelled passages
// ("S1 p.3" for a PDF page, "S2 12:34" for a moment of a recording, "S3 §2"
// for a part of a note), all of them when they fit, else the passages that
// best match the question (minisearch), else evenly spread ones. Every answer
// cites these labels, and the interface turns them back into links.

import MiniSearch from "minisearch";
import type { Source } from "../data/schema.ts";
import { clock } from "../i18n.ts";
import { expandCitations } from "./labels.ts";

export interface Passage {
  id: string;
  sourceId: string;
  /** "S1 p.3", "S2 12:34", "S3 §2". */
  label: string;
  page?: number;
  /** Seconds into the media. */
  t?: number;
  text: string;
}

const MAX_CHUNK = 1500;

/** Paragraph-aligned pieces of at most `max` characters (a longer paragraph is cut at sentence ends). */
export function chunk(text: string, max = MAX_CHUNK): string[] {
  // Units to pack: whole paragraphs, or the sentences of a long one (hard-cut if still too long).
  const units: { text: string; sep: string }[] = [];
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length <= max) {
      units.push({ text: para, sep: "\n\n" });
      continue;
    }
    (para.match(/[^.!?]+[.!?]*\s*/g) ?? [para]).forEach((sentence, i) => {
      const s = sentence.trim();
      for (let j = 0; j < s.length; j += max) units.push({ text: s.slice(j, j + max), sep: i === 0 && j === 0 ? "\n\n" : " " });
    });
  }
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    if (cur && cur.length + u.sep.length + u.text.length > max) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? cur + u.sep + u.text : u.text;
  }
  if (cur) out.push(cur);
  return out;
}

export function passagesOf(source: Source, key: string): Passage[] {
  const out: Passage[] = [];
  if (source.pages?.length) {
    for (const page of source.pages) {
      chunk(page.text).forEach((text, i) => out.push({ id: `${source.id}:p${page.n}:${i}`, sourceId: source.id, label: `${key} p.${page.n}`, page: page.n, text }));
    }
  } else if (source.transcript?.segments.length) {
    let start = 0;
    let text = "";
    let first = true;
    const push = () => {
      if (text.trim()) out.push({ id: `${source.id}:t${Math.floor(start)}`, sourceId: source.id, label: `${key} ${clock(start)}`, t: start, text: text.trim() });
      text = "";
      first = true;
    };
    for (const seg of source.transcript.segments) {
      if (first) {
        start = seg.start;
        first = false;
      }
      text += `${seg.text} `;
      if (seg.end - start >= 60 || text.length >= 1200) push();
    }
    push();
  } else if (source.text) {
    chunk(source.text).forEach((text, i) => out.push({ id: `${source.id}:s${i + 1}`, sourceId: source.id, label: `${key} §${i + 1}`, text }));
  }
  return out;
}

export interface Context {
  /** The passages formatted for the prompt, with a legend of the sources. */
  text: string;
  passages: Passage[];
  /** Source id → "S1". */
  keys: Map<string, string>;
  /** Whether some passages were left out to fit. */
  partial: boolean;
}

const KIND: Record<Source["kind"], string> = { pdf: "PDF", text: "note", audio: "audio transcript", video: "video transcript", recording: "lecture recording transcript", web: "web page" };

/** The sources as the model reads them, within `budget` characters. */
export function buildContext(sources: Source[], o: { query?: string; budget?: number } = {}): Context {
  const budget = o.budget ?? 120_000;
  const keys = new Map(sources.map((s, i) => [s.id, `S${i + 1}`]));
  const all = sources.flatMap((s) => passagesOf(s, keys.get(s.id)!));
  const size = (ps: Passage[]) => ps.reduce((n, p) => n + p.text.length + p.label.length + 4, 0);
  let chosen = all;
  if (size(all) > budget) {
    if (o.query?.trim()) {
      const ms = new MiniSearch<Passage>({ fields: ["text"], storeFields: ["id"], searchOptions: { fuzzy: 0.2, prefix: true } });
      ms.addAll(all);
      const ranked = ms.search(o.query).map((r) => r.id as string);
      const byId = new Map(all.map((p) => [p.id, p]));
      const keep = new Set<string>();
      let used = 0;
      for (const id of ranked) {
        const p = byId.get(id)!;
        if (used + p.text.length > budget) break;
        keep.add(id);
        used += p.text.length + p.label.length + 4;
      }
      chosen = all.filter((p) => keep.has(p.id));
    } else {
      // Evenly spread over everything, in order, so a summary sees the whole course.
      const ratio = budget / size(all);
      let acc = 0;
      chosen = all.filter(() => {
        acc += ratio;
        if (acc >= 1) {
          acc -= 1;
          return true;
        }
        return false;
      });
    }
  }
  const legend = sources.map((s) => `${keys.get(s.id)} = "${s.title}" (${KIND[s.kind]})`).join("\n");
  const body = chosen.map((p) => `[${p.label}]\n${p.text}`).join("\n\n");
  return { text: `Sources:\n${legend}\n\n${body}`, passages: chosen, keys, partial: chosen.length < all.length };
}

export const CITE_RULE =
  "Ground everything in the sources. Cite the passages you use with their label in square brackets right after the statement, e.g. [S1 p.3] or [S2 12:34]; use only labels that appear in the sources. Never invent facts the sources do not support; say plainly when they do not cover something.";

const LABEL = /\[(S\d+(?: (?:p\.\d+|§\d+|\d+:\d{2}(?::\d{2})?))?)\]/g;

/** The citation labels a text uses, in order of first appearance. */
export function citationsIn(text: string): string[] {
  return [...new Set([...expandCitations(text).matchAll(LABEL)].map((m) => m[1]!))];
}

/** Where a label points: the source and the page or moment. */
export function resolveLabel(label: string, keys: Map<string, string>): { sourceId: string; page?: number; t?: number } | null {
  const m = /^S(\d+)(?: (?:p\.(\d+)|§\d+|(\d+(?::\d{2}){1,2})))?$/.exec(label);
  if (!m) return null;
  const sourceId = [...keys].find(([, k]) => k === `S${m[1]}`)?.[0];
  if (!sourceId) return null;
  const t = m[3]
    ?.split(":")
    .map(Number)
    .reduce((a, b) => a * 60 + b, 0);
  return { sourceId, page: m[2] ? Number(m[2]) : undefined, t };
}

/** Rough model budget in characters from its context window in tokens (half for the sources). */
export function budgetFor(contextWindow?: number): number {
  if (!contextWindow) return 120_000;
  return Math.max(16_000, Math.min(600_000, Math.floor(contextWindow * 0.5 * 3.5)));
}
