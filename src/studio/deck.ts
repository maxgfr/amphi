// Slides as data, shared by the slide decks and the video storyboards: what
// the model answers is read leniently (aliases, missing fields, citation
// labels inside the text), then every slide is made whole so the editor and
// the renderers never meet a missing field. The model only ever gives text:
// the layouts and diagrams are drawn by us.

import { z } from "zod";
import { citationsIn } from "../ai/context.ts";

export const LAYOUTS = ["title", "bullets", "two-columns", "quote", "diagram", "key-figure"] as const;
export type SlideLayout = (typeof LAYOUTS)[number];
export const DIAGRAMS = ["steps", "cycle", "comparison", "hierarchy"] as const;
export type DiagramKind = (typeof DIAGRAMS)[number];

export interface DiagramItem {
  label: string;
  /** A sentence under the label (steps, cycle). */
  detail: string;
  /** Points under the item (comparison columns, hierarchy branches). */
  children: string[];
}

export interface Diagram {
  kind: DiagramKind;
  /** The top of a hierarchy. */
  root: string;
  items: DiagramItem[];
}

export interface Column {
  heading: string;
  bullets: string[];
}

/** Every field is always there; a layout reads the ones it needs, so switching layouts keeps the text. */
export interface Slide {
  id: string;
  layout: SlideLayout;
  title: string;
  subtitle: string;
  bullets: string[];
  columns: [Column, Column];
  quote: string;
  author: string;
  figure: { value: string; label: string };
  diagram: Diagram;
  /** What to say, for the presenter. */
  notes: string;
  /** Citation labels of the passages the slide comes from ("S1 p.3"). */
  cites: string[];
}

export const MAX_BULLETS = 7;
export const MAX_ITEMS = 6;
export const MAX_CHILDREN = 5;

let seq = 0;
export const newSlideId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const LABEL = /\s*\[(S\d+[^\]]*)\]/g;

/** Text without its citation labels, and the labels it held. */
export function splitCites(s: string): { text: string; cites: string[] } {
  const cites = citationsIn(s);
  return {
    text: s
      .replace(LABEL, "")
      .replace(/\s+/g, " ")
      .trim(),
    cites,
  };
}

export function emptySlide(layout: SlideLayout = "bullets"): Slide {
  return {
    id: newSlideId(),
    layout,
    title: "",
    subtitle: "",
    bullets: [],
    columns: [
      { heading: "", bullets: [] },
      { heading: "", bullets: [] },
    ],
    quote: "",
    author: "",
    figure: { value: "", label: "" },
    diagram: { kind: "steps", root: "", items: [] },
    notes: "",
    cites: [],
  };
}

const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? "" : String(v)));
const texts = z
  .union([z.array(z.union([z.string(), z.number(), z.null()])), z.string(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined ? [] : typeof v === "string" ? v.split("\n") : v.map((x) => (x === null ? "" : String(x)))));

const RawItem = z.union([
  z.string().transform((label) => ({ label, detail: "", children: [] as string[] })),
  z.object({ label: text, title: text, detail: text, text: text, children: texts, points: texts }).transform((o) => ({ label: o.label || o.title, detail: o.detail || o.text, children: o.children.length ? o.children : o.points })),
]);

/** One slide as the model may write it. */
export const RawSlide = z.object({
  layout: text,
  type: text,
  visual: text,
  title: text,
  subtitle: text,
  bullets: texts,
  points: texts,
  columns: z
    .array(z.union([z.object({ heading: text, title: text, bullets: texts, points: texts }), z.null()]))
    .nullish()
    .transform((cs) => (cs ?? []).filter((c) => c !== null).map((c) => ({ heading: c.heading || c.title, bullets: c.bullets.length ? c.bullets : c.points }))),
  left: z.object({ heading: text, title: text, bullets: texts }).nullish(),
  right: z.object({ heading: text, title: text, bullets: texts }).nullish(),
  quote: z.union([z.string(), z.object({ text: text, author: text })]).nullish(),
  author: text,
  figure: z.object({ value: text, label: text }).nullish(),
  value: text,
  label: text,
  diagram: z
    .object({ kind: text, type: text, root: text, items: z.array(z.union([RawItem, z.null()])).nullish() })
    .nullish(),
  notes: text,
  speakerNotes: text,
  cites: texts,
  narration: text,
});
export type RawSlide = z.infer<typeof RawSlide>;

const LAYOUT_ALIASES: Record<string, SlideLayout> = {
  title: "title",
  cover: "title",
  section: "title",
  bullets: "bullets",
  list: "bullets",
  text: "bullets",
  twocolumns: "two-columns",
  twocolumn: "two-columns",
  columns: "two-columns",
  quote: "quote",
  citation: "quote",
  diagram: "diagram",
  steps: "diagram",
  cycle: "diagram",
  comparison: "diagram",
  hierarchy: "diagram",
  keyfigure: "key-figure",
  figure: "key-figure",
  stat: "key-figure",
  number: "key-figure",
};

const DIAGRAM_ALIASES: Record<string, DiagramKind> = { steps: "steps", process: "steps", timeline: "steps", cycle: "cycle", loop: "cycle", comparison: "comparison", compare: "comparison", table: "comparison", hierarchy: "hierarchy", tree: "hierarchy" };

const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** A slide made whole: labels moved out of the text into `cites`, lists trimmed, the layout fitted to what it holds. */
export function toSlide(raw: RawSlide): Slide {
  const cites = new Set<string>();
  const clean = (s: string) => {
    const r = splitCites(s);
    for (const c of r.cites) cites.add(c);
    return r.text;
  };
  const list = (xs: string[], max: number) => xs.map(clean).filter(Boolean).slice(0, max);
  const s = emptySlide();
  const asked = key(raw.layout || raw.visual || raw.type);
  let layout = LAYOUT_ALIASES[asked];
  s.title = clean(raw.title);
  s.subtitle = clean(raw.subtitle);
  s.bullets = list(raw.bullets.length ? raw.bullets : raw.points, MAX_BULLETS);
  const cols = raw.columns.length ? raw.columns : [raw.left, raw.right].filter((c) => c).map((c) => ({ heading: c!.heading || c!.title, bullets: c!.bullets }));
  s.columns = [0, 1].map((i) => ({ heading: clean(cols[i]?.heading ?? ""), bullets: list(cols[i]?.bullets ?? [], MAX_BULLETS) })) as [Column, Column];
  const q = raw.quote;
  s.quote = clean(typeof q === "string" ? q : (q?.text ?? ""));
  s.author = clean((typeof q === "object" && q?.author) || raw.author);
  s.figure = { value: clean(raw.figure?.value || raw.value), label: clean(raw.figure?.label || raw.label) };
  const d = raw.diagram;
  const kind = DIAGRAM_ALIASES[key(d?.kind || d?.type || "")] ?? DIAGRAM_ALIASES[asked] ?? "steps";
  s.diagram = {
    kind,
    root: clean(d?.root ?? ""),
    items: (d?.items ?? [])
      .filter((it) => it !== null)
      .map((it) => ({ label: clean(it.label), detail: clean(it.detail), children: list(it.children, MAX_CHILDREN) }))
      .filter((it) => it.label || it.children.length)
      .slice(0, MAX_ITEMS),
  };
  s.notes = clean(raw.notes || raw.speakerNotes);
  for (const c of raw.cites) for (const l of citationsIn(c.includes("[") ? c : `[${c.replace(/^[[(\s]+|[\])\s]+$/g, "")}]`)) cites.add(l);
  s.cites = [...cites].slice(0, 6);
  // The layout the slide can hold: a diagram needs items, a figure a value, a quote its words.
  if (!layout) layout = s.diagram.items.length >= 2 ? "diagram" : s.figure.value ? "key-figure" : s.quote ? "quote" : s.columns.some((c) => c.bullets.length) ? "two-columns" : s.bullets.length ? "bullets" : "title";
  if (layout === "diagram" && !diagramUsable(s.diagram)) layout = "bullets";
  if (layout === "key-figure" && !s.figure.value) layout = "bullets";
  if (layout === "quote" && !s.quote) layout = "bullets";
  if (layout === "two-columns" && !s.columns.some((c) => c.bullets.length || c.heading)) layout = "bullets";
  if (layout === "bullets" && !s.bullets.length) {
    // Whatever the slide held goes to its bullets rather than being lost; with nothing, it is a section title.
    s.bullets = [...s.diagram.items.map((it) => [it.label, it.detail].filter(Boolean).join(": ")), ...s.columns.flatMap((c) => c.bullets), s.quote, s.figure.label].filter(Boolean).slice(0, MAX_BULLETS);
    if (!s.bullets.length) layout = "title";
  }
  s.layout = layout;
  return s;
}

export const diagramUsable = (d: Diagram) => (d.kind === "hierarchy" ? d.items.length >= 1 : d.items.length >= 2);

const MIN_TITLE = z.string().trim().min(1).max(200);

/** A deck as the model answers it. */
export const SlidesAnswer = z
  .object({ title: MIN_TITLE, slides: z.array(z.union([RawSlide, z.null()])) })
  .transform((a) => ({ title: a.title, slides: a.slides.filter((s) => s !== null).map(toSlide).filter((s) => s.title || s.bullets.length || s.layout !== "title") }))
  .refine((a) => a.slides.length > 0, { message: "the deck needs at least one slide" });

export const SLIDES_SHAPE = `{ "title": "deck title", "slides": [
  { "layout": "title", "title": "...", "subtitle": "...", "notes": "what the presenter says", "cites": ["S1 p.2"] },
  { "layout": "bullets", "title": "...", "bullets": ["short point", "..."], "notes": "...", "cites": ["S1 p.3"] },
  { "layout": "two-columns", "title": "...", "columns": [{ "heading": "...", "bullets": ["..."] }, { "heading": "...", "bullets": ["..."] }], "notes": "...", "cites": [] },
  { "layout": "quote", "title": "...", "quote": "a sentence quoted from the sources", "author": "who said it", "notes": "...", "cites": [] },
  { "layout": "diagram", "title": "...", "diagram": { "kind": "steps" | "cycle" | "comparison" | "hierarchy", "root": "top of a hierarchy", "items": [{ "label": "...", "detail": "one sentence (steps, cycle)", "children": ["point (comparison column, hierarchy branch)"] }] }, "notes": "...", "cites": [] },
  { "layout": "key-figure", "title": "...", "figure": { "value": "42 %", "label": "what the number is" }, "bullets": ["optional context"], "notes": "...", "cites": [] }
] }`;

/** The deck as Markdown: one section per slide, with its notes. */
export function slidesMarkdown(title: string, slides: Slide[]): string {
  const body = slides.map((s, i) => {
    const lines = [`## ${i + 1}. ${s.title || "—"}`, ""];
    const bullets = (xs: string[]) => xs.map((b) => `- ${b}`);
    switch (s.layout) {
      case "title":
        if (s.subtitle) lines.push(s.subtitle, "");
        break;
      case "bullets":
        lines.push(...bullets(s.bullets), "");
        break;
      case "two-columns":
        for (const c of s.columns) lines.push(`**${c.heading}**`, "", ...bullets(c.bullets), "");
        break;
      case "quote":
        lines.push(`> ${s.quote}${s.author ? ` (${s.author})` : ""}`, "");
        break;
      case "key-figure":
        lines.push(`**${s.figure.value}** ${s.figure.label}`, "", ...bullets(s.bullets), "");
        break;
      case "diagram":
        if (s.diagram.root) lines.push(`**${s.diagram.root}**`, "");
        for (const it of s.diagram.items) {
          lines.push(`- ${it.label}${it.detail ? `: ${it.detail}` : ""}`);
          for (const c of it.children) lines.push(`  - ${c}`);
        }
        lines.push("");
        break;
    }
    if (s.cites.length) lines.push(s.cites.map((c) => `[${c}]`).join(" "), "");
    if (s.notes) lines.push(`*${s.notes}*`, "");
    return lines.join("\n");
  });
  return `# ${title}\n\n${body.join("\n")}`.trimEnd() + "\n";
}
