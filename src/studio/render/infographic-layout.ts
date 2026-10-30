// Infographics as data and as a scene: the blocks the model answers with
// (key figures, a timeline, steps, a comparison, a hierarchy, definitions),
// checked one by one, then laid out top to bottom as one tall themed image.
// The model gives text only; every shape is ours.

import { z } from "zod";
import { citeLabel } from "./mindmap-tree.ts";
import { branch, type Role, type Scene, type Shape, textWidth, wrap } from "./svg.ts";

export interface Tree {
  label: string;
  children: Tree[];
}

export type Block = { title?: string; cite?: string } & (
  | { type: "keyFigures"; items: { value: string; label: string; cite?: string }[] }
  | { type: "timeline"; items: { date: string; label: string; cite?: string }[] }
  | { type: "steps"; items: { title: string; text: string; cite?: string }[] }
  | { type: "comparison"; columns: string[]; rows: { label: string; values: string[] }[] }
  | { type: "hierarchy"; root: Tree }
  | { type: "definitions"; items: { term: string; definition: string; cite?: string }[] }
);

export type BlockType = Block["type"];

export interface InfographicData {
  title: string;
  subtitle?: string;
  blocks: Block[];
}

const str = z.union([z.string(), z.number()]).transform((v) => String(v).trim());
const opt = z.union([z.string(), z.number()]).nullish().transform((v) => (v === null || v === undefined ? undefined : String(v).trim() || undefined));
const cite = z.string().nullish().transform((v) => citeLabel(v));

interface RawTree {
  label?: string | number | null;
  title?: string | number | null;
  children?: RawTree[] | null;
}
const RawTree: z.ZodType<RawTree> = z.lazy(() => z.object({ label: z.union([z.string(), z.number()]).nullish(), title: z.union([z.string(), z.number()]).nullish(), children: z.array(RawTree).nullish() }));

function toTree(r: RawTree, depth = 0): Tree | null {
  const label = String(r.label ?? r.title ?? "").trim();
  if (!label) return null;
  return { label, children: depth >= 3 ? [] : (r.children ?? []).map((c) => toTree(c, depth + 1)).filter((c) => c !== null) };
}

const head = { title: opt, cite };
const BLOCKS = {
  keyFigures: z.object({ ...head, items: z.array(z.object({ value: str, label: str, cite })).min(1) }),
  timeline: z.object({ ...head, items: z.array(z.object({ date: str, label: str, cite })).min(1) }),
  steps: z.object({ ...head, items: z.array(z.object({ title: str, text: opt.transform((v) => v ?? ""), cite })).min(1) }),
  comparison: z.object({
    ...head,
    columns: z.array(str).min(1),
    rows: z.array(z.union([z.object({ label: str, values: z.array(str) }), z.array(str).min(1).transform(([label, ...values]) => ({ label: label!, values }))])).min(1),
  }),
  hierarchy: z.object({ ...head, root: RawTree }),
  definitions: z.object({ ...head, items: z.array(z.object({ term: str, definition: str, cite })).min(1) }),
} as const;

const ALIASES: Record<string, BlockType> = {
  keyfigures: "keyFigures",
  figures: "keyFigures",
  stats: "keyFigures",
  numbers: "keyFigures",
  timeline: "timeline",
  dates: "timeline",
  steps: "steps",
  process: "steps",
  comparison: "comparison",
  table: "comparison",
  compare: "comparison",
  hierarchy: "hierarchy",
  tree: "hierarchy",
  definitions: "definitions",
  glossary: "definitions",
};

/** One block made consistent, or null when it does not hold together. */
export function normalizeBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object") return null;
  const t = String((raw as { type?: unknown }).type ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const type = ALIASES[t];
  if (!type) return null;
  const parsed = BLOCKS[type].safeParse(raw);
  if (!parsed.success) return null;
  const b = parsed.data as { title?: string; cite?: string } & Record<string, unknown>;
  const base = { title: b.title, cite: b.cite };
  if (type === "hierarchy") {
    const root = toTree(b.root as RawTree);
    return root ? { ...base, type, root } : null;
  }
  if (type === "comparison") {
    const columns = b.columns as string[];
    const rows = (b.rows as { label: string; values: string[] }[]).map((r) => ({ label: r.label, values: columns.map((_, i) => r.values[i] ?? "") }));
    return { ...base, type, columns, rows };
  }
  return { ...base, type, items: b.items } as Block;
}

export const InfographicAnswer = z
  .object({ title: str, subtitle: opt, blocks: z.array(z.unknown()) })
  .transform((o) => ({ title: o.title, subtitle: o.subtitle, blocks: o.blocks.map(normalizeBlock).filter((b) => b !== null) }))
  .refine((o) => o.title.length > 0 && o.blocks.length > 0, { message: "needs a title and at least one block of a known type with its fields" });

export const SHAPE = `{
  "title": string, "subtitle"?: string,
  "blocks": [ // each block has "type", an optional "title" and an optional "cite" (a passage label, e.g. "S1 p.3"), then:
    { "type": "keyFigures", "items": [ { "value": string, "label": string, "cite"?: string } ] },
    { "type": "timeline", "items": [ { "date": string, "label": string, "cite"?: string } ] },
    { "type": "steps", "items": [ { "title": string, "text": string, "cite"?: string } ] },
    { "type": "comparison", "columns": string[], "rows": [ { "label": string, "values": string[] } ] },
    { "type": "hierarchy", "root": { "label": string, "children": [ { "label": string, "children": [ … ] } ] } },
    { "type": "definitions", "items": [ { "term": string, "definition": string, "cite"?: string } ] }
  ]
}`;

/** The infographic as plain text: the SVG's description and a text alternative. */
export function infographicText(d: InfographicData): string {
  const out = [`# ${d.title}`];
  if (d.subtitle) out.push(d.subtitle);
  const c = (s?: string) => (s ? ` [${s}]` : "");
  const tree = (n: Tree, depth: number): string[] => [`${"  ".repeat(depth)}- ${n.label}`, ...n.children.flatMap((ch) => tree(ch, depth + 1))];
  for (const b of d.blocks) {
    out.push("", `## ${b.title ?? ""}${c(b.cite)}`.trimEnd());
    if (b.type === "keyFigures") for (const i of b.items) out.push(`- ${i.value}: ${i.label}${c(i.cite)}`);
    else if (b.type === "timeline") for (const i of b.items) out.push(`- ${i.date}: ${i.label}${c(i.cite)}`);
    else if (b.type === "steps") b.items.forEach((i, n) => out.push(`${n + 1}. ${i.title}${i.text ? `: ${i.text}` : ""}${c(i.cite)}`));
    else if (b.type === "definitions") for (const i of b.items) out.push(`- ${i.term}: ${i.definition}${c(i.cite)}`);
    else if (b.type === "hierarchy") out.push(...tree(b.root, 0));
    else {
      out.push(`| | ${b.columns.join(" | ")} |`, `|---|${b.columns.map(() => "---").join("|")}|`);
      for (const r of b.rows) out.push(`| ${r.label} | ${r.values.join(" | ")} |`);
    }
  }
  return `${out.join("\n")}\n`;
}

// Layout.

export const WIDTH = 880;
const PAD = 40;
const INNER = WIDTH - PAD * 2;
const CARD_PAD = 24;
const LH = 1.35;

interface Ctx {
  shapes: Shape[];
  y: number;
}

/** Lines of text from `y` (the first line's top); returns the bottom. */
function text(ctx: Ctx, lines: string[], x: number, y: number, size: number, fill: Role, weight = 400, anchor: "start" | "middle" | "end" = "start"): number {
  lines.forEach((line, i) => ctx.shapes.push({ kind: "text", x, y: y + size * LH * (i + 0.5), text: line, size, weight, fill, anchor }));
  return y + lines.length * size * LH;
}

/** A citation right after the last line when it fits, else under it; returns the new bottom. */
function citeAfter(ctx: Ctx, label: string | undefined, x: number, lastLine: string, size: number, weight: number, bottom: number, maxX: number): number {
  if (!label) return bottom;
  const cw = textWidth(label, 11, 600) + 8;
  const end = x + textWidth(lastLine, size, weight) + 6;
  if (end + cw <= maxX) {
    ctx.shapes.push({ kind: "text", x: end, y: bottom - (size * LH) / 2, text: label, size: 11, weight: 600, fill: "accent", cite: label });
    return bottom;
  }
  ctx.shapes.push({ kind: "text", x, y: bottom + 8, text: label, size: 11, weight: 600, fill: "accent", cite: label });
  return bottom + 16;
}

function keyFigures(ctx: Ctx, b: Extract<Block, { type: "keyFigures" }>, x: number, w: number) {
  const n = b.items.length;
  const perRow = n === 4 ? 2 : Math.min(3, n);
  const gap = 16;
  const tw = (w - gap * (perRow - 1)) / perRow;
  for (let r = 0; r * perRow < n; r++) {
    const row = b.items.slice(r * perRow, r * perRow + perRow);
    const laid = row.map((it) => ({ it, value: wrap(it.value, 32, tw - 32, 700, 2), label: wrap(it.label, 14, tw - 32, 400, 4) }));
    const h = Math.max(...laid.map((l) => 20 + l.value.length * 32 * LH + 6 + l.label.length * 14 * LH + (l.it.cite ? 22 : 0) + 18));
    laid.forEach((l, i) => {
      const tx = x + i * (tw + gap);
      const idx = r * perRow + i;
      ctx.shapes.push({ kind: "rect", x: tx, y: ctx.y, w: tw, h, r: 10, fill: "surface2" });
      ctx.shapes.push({ kind: "rect", x: tx + 16, y: ctx.y + 14, w: 28, h: 4, r: 2, fill: branch(idx) });
      let yy = text(ctx, l.value, tx + 16, ctx.y + 24, 32, "text", 700);
      yy = text(ctx, l.label, tx + 16, yy + 4, 14, "muted");
      if (l.it.cite) ctx.shapes.push({ kind: "text", x: tx + 16, y: yy + 12, text: l.it.cite, size: 11, weight: 600, fill: "accent", cite: l.it.cite });
    });
    ctx.y += h + gap;
  }
  ctx.y -= gap;
}

function timeline(ctx: Ctx, b: Extract<Block, { type: "timeline" }>, x: number, w: number) {
  const dateW = Math.min(170, Math.max(70, ...b.items.map((i) => textWidth(i.date, 15, 700))) + 8);
  const lineX = x + dateW + 18;
  const top = ctx.y;
  const start = ctx.shapes.length;
  const labelX = lineX + 22;
  const maxW = x + w - labelX;
  b.items.forEach((it, i) => {
    const date = wrap(it.date, 15, dateW, 700, 2);
    const label = wrap(it.label, 15, maxW, 400, 6);
    const y0 = ctx.y;
    text(ctx, date, lineX - 18, y0, 15, "text", 700, "end");
    let bottom = text(ctx, label, labelX, y0, 15, "text");
    bottom = citeAfter(ctx, it.cite, labelX, label.at(-1)!, 15, 400, bottom, x + w);
    ctx.shapes.push({ kind: "circle", cx: lineX, cy: y0 + (15 * LH) / 2, r: 6, fill: branch(i), stroke: "surface", strokeWidth: 2 });
    ctx.y = Math.max(bottom, y0 + date.length * 15 * LH) + 18;
  });
  ctx.y -= 18;
  // The line goes under the dots: put it first.
  ctx.shapes.splice(start, 0, { kind: "line", x1: lineX, y1: top + 6, x2: lineX, y2: ctx.y - 6, stroke: "line", strokeWidth: 2 });
}

function steps(ctx: Ctx, b: Extract<Block, { type: "steps" }>, x: number, w: number) {
  const r = 16;
  const tx = x + r * 2 + 16;
  const maxW = x + w - tx;
  const centres: number[] = [];
  const start = ctx.shapes.length;
  b.items.forEach((it, i) => {
    const y0 = ctx.y;
    const title = wrap(it.title, 16, maxW, 700, 3);
    let bottom = text(ctx, title, tx, y0 + 4, 16, "text", 700);
    const body = it.text ? wrap(it.text, 14, maxW, 400, 8) : [];
    if (body.length) bottom = text(ctx, body, tx, bottom + 2, 14, "muted");
    bottom = citeAfter(ctx, it.cite, tx, (body.length ? body : title).at(-1)!, body.length ? 14 : 16, body.length ? 400 : 700, bottom, x + w);
    centres.push(y0 + r);
    ctx.shapes.push({ kind: "circle", cx: x + r, cy: y0 + r, r, fill: "accent" });
    ctx.shapes.push({ kind: "text", x: x + r, y: y0 + r, text: String(i + 1), size: 14, weight: 700, fill: "accentInk", anchor: "middle" });
    ctx.y = Math.max(bottom, y0 + r * 2) + 20;
  });
  ctx.y -= 20;
  if (centres.length > 1) ctx.shapes.splice(start, 0, { kind: "line", x1: x + r, y1: centres[0]!, x2: x + r, y2: centres.at(-1)!, stroke: "line", strokeWidth: 2 });
}

function comparison(ctx: Ctx, b: Extract<Block, { type: "comparison" }>, x: number, w: number) {
  const cols = b.columns.length + 1;
  const firstW = Math.min(220, w / cols + 30);
  const cw = (w - firstW) / (cols - 1);
  const cellPad = 10;
  const rowOf = (label: string, values: string[], header: boolean) => {
    const size = 14;
    const weight = header ? 700 : 400;
    const cells = [wrap(label, size, firstW - cellPad * 2, 700, 4), ...values.map((v) => wrap(v, size, cw - cellPad * 2, weight, 6))];
    const h = Math.max(...cells.map((c) => c.length)) * size * LH + cellPad * 2;
    if (header) ctx.shapes.push({ kind: "rect", x, y: ctx.y, w, h, r: 6, fill: "accentSoft" });
    cells.forEach((c, i) => text(ctx, c, (i === 0 ? x : x + firstW + (i - 1) * cw) + cellPad, ctx.y + cellPad, size, "text", i === 0 || header ? 700 : 400));
    ctx.y += h;
    if (!header) ctx.shapes.push({ kind: "line", x1: x, y1: ctx.y, x2: x + w, y2: ctx.y, stroke: "line" });
  };
  rowOf("", b.columns, true);
  for (const r of b.rows) rowOf(r.label, r.values, false);
}

function hierarchy(ctx: Ctx, b: Extract<Block, { type: "hierarchy" }>, x: number, w: number) {
  const indent = 28;
  const walk = (n: Tree, depth: number, colour: number): number => {
    const nx = x + depth * indent;
    const size = depth === 0 ? 16 : 15;
    const weight = depth === 0 ? 700 : depth === 1 ? 600 : 400;
    const lines = wrap(n.label, size, x + w - nx - 24, weight, 3);
    const h = lines.length * size * LH + 12;
    const y0 = ctx.y;
    const bw = Math.max(...lines.map((l) => textWidth(l, size, weight))) + 24;
    ctx.shapes.push({ kind: "rect", x: nx, y: y0, w: Math.min(bw, x + w - nx), h, r: 8, fill: depth === 0 ? "accentSoft" : "surface", stroke: depth === 0 ? "accent" : colour < 0 ? "line" : branch(colour), strokeWidth: 1.5 });
    text(ctx, lines, nx + 12, y0 + 6, size, "text", weight);
    ctx.y += h + 8;
    const mid = y0 + h / 2;
    n.children.forEach((c, i) => {
      const cy = walk(c, depth + 1, depth === 0 ? i : colour);
      const px = nx + 14;
      ctx.shapes.push({ kind: "path", d: `M${px} ${y0 + h} V${cy} H${nx + indent}`, stroke: depth === 0 ? branch(i) : branch(colour), strokeWidth: 1.5 });
    });
    return mid;
  };
  walk(b.root, 0, -1);
  ctx.y -= 8;
}

function definitions(ctx: Ctx, b: Extract<Block, { type: "definitions" }>, x: number, w: number) {
  const termW = Math.min(220, w * 0.3);
  const defX = x + termW + 20;
  b.items.forEach((it, i) => {
    const y0 = ctx.y;
    const term = wrap(it.term, 15, termW, 700, 3);
    const def = wrap(it.definition, 15, x + w - defX, 400, 10);
    text(ctx, term, x, y0, 15, "text", 700);
    let bottom = text(ctx, def, defX, y0, 15, "text");
    bottom = citeAfter(ctx, it.cite, defX, def.at(-1)!, 15, 400, bottom, x + w);
    ctx.y = Math.max(bottom, y0 + term.length * 15 * LH) + 12;
    if (i < b.items.length - 1) ctx.shapes.push({ kind: "line", x1: x, y1: ctx.y - 6, x2: x + w, y2: ctx.y - 6, stroke: "line" });
    ctx.y += 6;
  });
  ctx.y -= 18;
}

export function infographicScene(d: InfographicData): Scene {
  const ctx: Ctx = { shapes: [], y: PAD };
  ctx.shapes.push({ kind: "rect", x: PAD, y: PAD, w: 56, h: 6, r: 3, fill: "accent" });
  ctx.y += 22;
  ctx.y = text(ctx, wrap(d.title, 30, INNER, 700, 4), PAD, ctx.y, 30, "text", 700);
  if (d.subtitle) ctx.y = text(ctx, wrap(d.subtitle, 17, INNER, 400, 4), PAD, ctx.y + 6, 17, "muted");
  ctx.y += 28;
  for (const b of d.blocks) {
    const top = ctx.y;
    const at = ctx.shapes.length;
    const x = PAD + CARD_PAD;
    const w = INNER - CARD_PAD * 2;
    ctx.y += CARD_PAD;
    if (b.title || b.cite) {
      const lines = b.title ? wrap(b.title, 20, w - 70, 700, 3) : [""];
      const bottom = text(ctx, lines, x, ctx.y, 20, "text", 700);
      ctx.y = citeAfter(ctx, b.cite, x, lines.at(-1)!, 20, 700, bottom, x + w) + 16;
    }
    if (b.type === "keyFigures") keyFigures(ctx, b, x, w);
    else if (b.type === "timeline") timeline(ctx, b, x, w);
    else if (b.type === "steps") steps(ctx, b, x, w);
    else if (b.type === "comparison") comparison(ctx, b, x, w);
    else if (b.type === "hierarchy") hierarchy(ctx, b, x, w);
    else definitions(ctx, b, x, w);
    ctx.y += CARD_PAD;
    // The card goes under what it holds.
    ctx.shapes.splice(at, 0, { kind: "rect", x: PAD, y: top, w: INNER, h: ctx.y - top, r: 14, fill: "surface", stroke: "line" });
    ctx.y += 20;
  }
  return { width: WIDTH, height: Math.ceil(ctx.y - 20 + PAD), title: d.title, desc: infographicText(d), shapes: ctx.shapes };
}
