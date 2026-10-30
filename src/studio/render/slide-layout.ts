// A slide laid out as a 16:9 scene of shapes (1280×720): drawn by React in
// the page and in presentation mode, painted on a canvas for the video, and
// turned into PowerPoint shapes. Text is wrapped here, once, with a measurer
// that can be injected (tests, the canvas). Shapes carry what the other
// renderers need: the reveal step a video shows them at, and which
// paragraph and text box a line belongs to.

import type { Diagram, Slide } from "../deck.ts";
import { branch, branchSoft, type Role, type Scene, type Shape, textWidth } from "./svg.ts";

export const SLIDE_W = 1280;
export const SLIDE_H = 720;
const M = 72;
const LH = 1.25;

export type Measure = (text: string, size: number, weight: number) => number;

export type SlideShape = Shape & {
  /** Shown from this reveal step on (0: from the start). */
  step?: number;
  /** Lines of one paragraph share an id. */
  para?: number;
  /** The text box a line sits in: its left edge and width. */
  box?: { x: number; w: number };
  /** A bullet paragraph (its dot is drawn apart, marked `deco`). */
  bullet?: boolean;
  /** The slide's title. */
  heading?: boolean;
  /** Drawn in the page and the video, left out of PowerPoint (bullet dots, arrow heads, the slide number). */
  deco?: boolean;
  /** A line ending in an arrow head. */
  arrow?: boolean;
};

export interface SlideScene extends Scene {
  shapes: SlideShape[];
  /** How many reveal steps the slide has. */
  steps: number;
}

/** Words packed into lines of at most `max` pixels with the measurer given (a word longer than a line is cut). */
export function wrapText(text: string, size: number, max: number, measure: Measure, weight = 400, maxLines = Infinity): string[] {
  const w = (s: string) => measure(s, size, weight);
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (let word of words) {
    while (w(word) > max && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && w(word.slice(0, cut)) > max) cut--;
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (cur && w(next) > max) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last.length > 1 && w(`${last}…`) > max) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.replace(/\s+$/, "")}…`;
    return kept;
  }
  return lines;
}

interface Block {
  lines: string[];
  size: number;
  weight: number;
}

const height = (b: Block) => b.lines.length * b.size * LH;

class Builder {
  shapes: SlideShape[] = [];
  steps = 0;
  private paras = 0;
  constructor(readonly measure: Measure) {}

  fit(text: string, sizes: number[], max: number, maxH: number, weight = 400, maxLines = 4): Block {
    for (const size of sizes) {
      const lines = wrapText(text, size, max, this.measure, weight);
      if (lines.length <= maxLines && lines.length * size * LH <= maxH) return { lines, size, weight };
    }
    const size = sizes.at(-1)!;
    return { lines: wrapText(text, size, max, this.measure, weight, Math.max(1, Math.min(maxLines, Math.floor(maxH / (size * LH))))), size, weight };
  }

  /** A paragraph's lines from `top`; returns its height. */
  text(b: Block, o: { x: number; top: number; w: number; fill: Role; anchor?: "start" | "middle" | "end"; step?: number; bullet?: boolean; heading?: boolean; cite?: string; deco?: boolean }): number {
    const para = this.paras++;
    const anchor = o.anchor ?? "start";
    const left = anchor === "middle" ? o.x - o.w / 2 : anchor === "end" ? o.x - o.w : o.x;
    b.lines.forEach((line, i) => {
      this.shapes.push({
        kind: "text",
        x: o.x,
        y: o.top + b.size * LH * (i + 0.5),
        text: line,
        size: b.size,
        fill: o.fill,
        weight: b.weight,
        anchor,
        para,
        box: { x: left, w: o.w },
        ...(o.step ? { step: o.step } : {}),
        ...(o.bullet ? { bullet: true } : {}),
        ...(o.heading ? { heading: true } : {}),
        ...(o.cite ? { cite: o.cite } : {}),
        ...(o.deco ? { deco: true } : {}),
      });
    });
    if (o.step) this.steps = Math.max(this.steps, o.step);
    return height(b);
  }

  add(s: SlideShape, step?: number) {
    if (step) {
      s.step = step;
      this.steps = Math.max(this.steps, step);
    }
    this.shapes.push(s);
  }

  arrow(x1: number, y1: number, x2: number, y2: number, stroke: Role, step?: number) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const len = 14;
    // The line stops at the head's base so its end does not poke through the point.
    const bx = x2 - Math.cos(a) * len * 0.8;
    const by = y2 - Math.sin(a) * len * 0.8;
    this.add({ kind: "line", x1, y1, x2: bx, y2: by, stroke, strokeWidth: 3, arrow: true }, step);
    const p = (r: number, da: number) => `${(x2 - Math.cos(a + da) * r).toFixed(1)} ${(y2 - Math.sin(a + da) * r).toFixed(1)}`;
    this.add({ kind: "path", d: `M ${x2.toFixed(1)} ${y2.toFixed(1)} L ${p(len, 0.45)} L ${p(len, -0.45)} Z`, fill: stroke, stroke, strokeWidth: 1, deco: true }, step);
  }
}

/** Bullets from `top`, all at one size that fits `maxH`; returns the height used. */
function bulletList(b: Builder, items: string[], o: { x: number; top: number; w: number; maxH: number; sizes: number[]; dot: Role; fill?: Role; step?: (i: number) => number | undefined }): number {
  if (!items.length) return 0;
  const indent = 36;
  let chosen: Block[] = [];
  let size = o.sizes.at(-1)!;
  for (const s of o.sizes) {
    const blocks = items.map((t) => ({ lines: wrapText(t, s, o.w - indent, b.measure), size: s, weight: 400 }));
    const total = blocks.reduce((n, x) => n + height(x), 0) + (blocks.length - 1) * s * 0.55;
    chosen = blocks;
    size = s;
    if (total <= o.maxH && blocks.every((x) => x.lines.length <= 4)) break;
  }
  const maxLinesEach = Math.max(1, Math.floor((o.maxH - (items.length - 1) * size * 0.55) / items.length / (size * LH)));
  let y = o.top;
  chosen.forEach((blk, i) => {
    const lines = blk.lines.length * size * LH > o.maxH ? wrapText(items[i]!, size, o.w - indent, b.measure, 400, maxLinesEach) : blk.lines;
    const block = { lines, size, weight: 400 };
    const step = o.step?.(i);
    b.add({ kind: "circle", cx: o.x + 9, cy: y + size * LH * 0.5, r: Math.max(4, size * 0.17), fill: o.dot, deco: true }, step);
    y += b.text(block, { x: o.x + indent, top: y, w: o.w - indent, fill: o.fill ?? "text", step, bullet: true }) + size * 0.55;
  });
  return y - o.top - size * 0.55;
}

function header(b: Builder, slide: Slide): number {
  const top = 52;
  const t = b.fit(slide.title || " ", [44, 38, 32], SLIDE_W - 2 * M, 2 * 44 * LH, 700, 2);
  const h = b.text(t, { x: M, top, w: SLIDE_W - 2 * M, fill: "text", heading: true });
  b.add({ kind: "rect", x: M, y: top + h + 12, w: 56, h: 6, r: 3, fill: "accent" });
  return top + h + 48;
}

const BOTTOM = SLIDE_H - 84;

function footer(b: Builder, slide: Slide, index: number, total: number, number: boolean) {
  const y = SLIDE_H - 54;
  let x = M;
  for (const c of slide.cites) {
    const blk = { lines: [c], size: 18, weight: 500 };
    b.text(blk, { x, top: y, w: b.measure(c, 18, 500) + 4, fill: "muted", cite: c });
    x += b.measure(c, 18, 500) + 24;
    if (x > SLIDE_W / 2) break;
  }
  if (number && total > 1) b.text({ lines: [`${index + 1} / ${total}`], size: 18, weight: 500 }, { x: SLIDE_W - M, top: y, w: 120, fill: "muted", anchor: "end", deco: true });
}

function titleLayout(b: Builder, slide: Slide) {
  const w = SLIDE_W - 2 * 120;
  const t = b.fit(slide.title || " ", [64, 56, 48, 40], w, 3 * 64 * LH, 700, 3);
  const mid = SLIDE_H * 0.52;
  b.text(t, { x: SLIDE_W / 2, top: mid - height(t), w, fill: "text", anchor: "middle", heading: true });
  b.add({ kind: "rect", x: SLIDE_W / 2 - 40, y: mid + 18, w: 80, h: 6, r: 3, fill: "accent" });
  if (slide.subtitle) b.text(b.fit(slide.subtitle, [30, 26, 22], w, 150, 400, 3), { x: SLIDE_W / 2, top: mid + 52, w, fill: "muted", anchor: "middle", step: 1 });
}

function bulletsLayout(b: Builder, slide: Slide, top: number) {
  bulletList(b, slide.bullets, { x: M, top, w: SLIDE_W - 2 * M, maxH: BOTTOM - top, sizes: [32, 30, 28, 26, 24, 22, 20, 18], dot: "accent", step: (i) => i + 1 });
}

function columnsLayout(b: Builder, cols: { heading: string; bullets: string[] }[], top: number, banner: boolean) {
  const n = cols.length;
  const gap = 32;
  const colW = (SLIDE_W - 2 * M - (n - 1) * gap) / n;
  const pad = 26;
  const maxH = BOTTOM - top;
  const headSize = n > 2 ? 24 : 28;
  const heads = cols.map((c) => b.fit(c.heading || " ", [headSize, headSize - 4], colW - 2 * pad, 2 * headSize * LH, 700, 2));
  const headH = Math.max(...heads.map(height));
  // One bullet size for every column, the largest that fits them all.
  const sizes = [26, 24, 22, 20, 18, 16];
  const room = maxH - headH - (banner ? 2 * 18 : 24) - 2 * pad;
  const fits = (s: number) =>
    cols.every((c) => {
      const hs = c.bullets.map((t) => wrapText(t, s, colW - 2 * pad - 36, b.measure).length * s * LH);
      return hs.reduce((a, x) => a + x, 0) + (hs.length - 1) * s * 0.55 <= room;
    });
  const size = sizes.find(fits) ?? sizes.at(-1)!;
  // Panels as tall as the fullest column, not the whole slide.
  const listH = Math.max(0, ...cols.map((c) => c.bullets.reduce((h, t) => h + wrapText(t, size, colW - 2 * pad - 36, b.measure).length * size * LH + size * 0.55, 0)));
  const panelH = Math.min(maxH, Math.max(maxH * 0.55, headH + (banner ? 36 : 24) + 2 * pad + listH));
  cols.forEach((c, i) => {
    const x = M + i * (colW + gap);
    const step = i + 1;
    b.add({ kind: "rect", x, y: top, w: colW, h: panelH, r: 16, fill: banner ? "surface2" : branchSoft(i), strokeWidth: 0 }, step);
    let y = top;
    if (banner) {
      const bh = headH + 36;
      b.add({ kind: "rect", x, y: top, w: colW, h: bh, r: 16, fill: branch(i) }, step);
      b.text(heads[i]!, { x: x + colW / 2, top: top + 18, w: colW - 2 * pad, fill: "accentInk", anchor: "middle", step });
      y = top + bh + pad;
    } else {
      b.text(heads[i]!, { x: x + pad, top: top + pad, w: colW - 2 * pad, fill: branch(i), step });
      y = top + pad + headH + 24;
    }
    bulletList(b, c.bullets, { x: x + pad, top: y, w: colW - 2 * pad, maxH: top + panelH - pad - y, sizes: [size], dot: branch(i), step: () => step });
  });
}

function quoteLayout(b: Builder, slide: Slide, top: number) {
  const w = SLIDE_W - 2 * 170;
  b.text({ lines: ["“"], size: 200, weight: 700 }, { x: M + 20, top: top - 50, w: 120, fill: "accentSoft", deco: true });
  const q = b.fit(slide.quote, [44, 40, 36, 32, 28, 24], w, BOTTOM - top - 70, 500, 7);
  const a = slide.author ? { lines: wrapText(`— ${slide.author}`, 24, w, b.measure, 400, 2), size: 24, weight: 400 } : null;
  const total = height(q) + (a ? 28 + height(a) : 0);
  const y = top + Math.max(0, (BOTTOM - top - total) / 2);
  b.text(q, { x: SLIDE_W / 2, top: y, w, fill: "text", anchor: "middle" });
  if (a) b.text(a, { x: SLIDE_W / 2, top: y + height(q) + 28, w, fill: "muted", anchor: "middle", step: 1 });
}

function figureLayout(b: Builder, slide: Slide, top: number) {
  const w = SLIDE_W - 2 * M;
  const v = b.fit(slide.figure.value || "—", [160, 140, 120, 100, 80, 64, 48], w, 220, 800, 1);
  const l = slide.figure.label ? b.fit(slide.figure.label, [34, 30, 26], SLIDE_W - 2 * 160, 2 * 34 * LH, 500, 2) : null;
  const extra = slide.bullets.slice(0, 3).map((t) => b.fit(t, [22, 20], SLIDE_W - 2 * 200, 2 * 22 * LH, 400, 2));
  const total = height(v) + (l ? 8 + height(l) : 0) + extra.reduce((n, x) => n + 12 + height(x), extra.length ? 24 : 0);
  let y = top + Math.max(0, (BOTTOM - top - total) / 2);
  y += b.text(v, { x: SLIDE_W / 2, top: y, w, fill: "accent", anchor: "middle" });
  if (l) y += 8 + b.text(l, { x: SLIDE_W / 2, top: y + 8, w: SLIDE_W - 2 * 160, fill: "text", anchor: "middle" });
  if (extra.length) y += 24;
  extra.forEach((x, i) => {
    y += 12 + b.text(x, { x: SLIDE_W / 2, top: y + 12, w: SLIDE_W - 2 * 200, fill: "muted", anchor: "middle", step: i + 1 });
  });
}

function stepsDiagram(b: Builder, d: Diagram, top: number) {
  const n = d.items.length;
  if (!n) return;
  const gap = n > 4 ? 36 : 48;
  const boxW = (SLIDE_W - 2 * M - (n - 1) * gap) / n;
  const pad = 18;
  const inner = boxW - 2 * pad;
  const maxH = BOTTOM - top;
  const labelSize = [26, 24, 22, 20, 18, 16].find((s) => d.items.every((it) => wrapText(it.label, s, inner, b.measure, 700).length <= 3)) ?? 16;
  const detailSize = [20, 18, 16, 14].find((s) => d.items.every((it) => wrapText(it.detail, s, inner, b.measure).length <= 6)) ?? 14;
  const labels = d.items.map((it) => ({ lines: wrapText(it.label, labelSize, inner, b.measure, 700, 3), size: labelSize, weight: 700 }));
  const details = d.items.map((it) => ({ lines: it.detail ? wrapText(it.detail, detailSize, inner, b.measure, 400, 6) : [], size: detailSize, weight: 400 }));
  const badge = 22;
  const content = Math.max(...labels.map((l, i) => height(l) + (details[i]!.lines.length ? 10 + height(details[i]!) : 0)));
  const boxH = Math.min(maxH, pad + badge * 2 + 16 + content + pad);
  const y0 = top + (maxH - boxH) / 2;
  d.items.forEach((_, i) => {
    const x = M + i * (boxW + gap);
    const step = i + 1;
    b.add({ kind: "rect", x, y: y0, w: boxW, h: boxH, r: 14, fill: branchSoft(i), stroke: branch(i), strokeWidth: 2 }, step);
    b.add({ kind: "circle", cx: x + pad + badge, cy: y0 + pad + badge, r: badge, fill: branch(i) }, step);
    b.text({ lines: [String(i + 1)], size: 22, weight: 700 }, { x: x + pad + badge, top: y0 + pad + badge - 22 * LH * 0.5, w: badge * 2, fill: "accentInk", anchor: "middle", step });
    let y = y0 + pad + badge * 2 + 16;
    y += b.text(labels[i]!, { x: x + pad, top: y, w: inner, fill: "text", step });
    if (details[i]!.lines.length) b.text(details[i]!, { x: x + pad, top: y + 10, w: inner, fill: "muted", step });
    if (i > 0) b.arrow(x - gap + 8, y0 + boxH / 2, x - 8, y0 + boxH / 2, "muted", step);
  });
}

function cycleDiagram(b: Builder, d: Diagram, top: number) {
  const n = d.items.length;
  if (!n) return;
  const maxH = BOTTOM - top;
  const nodeW = n > 4 ? 250 : 290;
  const pad = 14;
  const labelSize = [24, 22, 20, 18].find((s) => d.items.every((it) => wrapText(it.label, s, nodeW - 2 * pad, b.measure, 700).length <= 2)) ?? 18;
  const detailSize = 17;
  const labels = d.items.map((it) => ({ lines: wrapText(it.label, labelSize, nodeW - 2 * pad, b.measure, 700, 2), size: labelSize, weight: 700 }));
  const details = d.items.map((it) => ({ lines: it.detail ? wrapText(it.detail, detailSize, nodeW - 2 * pad, b.measure, 400, 2) : [], size: detailSize, weight: 400 }));
  const nodeH = Math.min(maxH / 2.6, Math.max(...labels.map((l, i) => height(l) + (details[i]!.lines.length ? 6 + height(details[i]!) : 0))) + 2 * pad);
  const cx = SLIDE_W / 2;
  const cy = top + maxH / 2;
  const rx = Math.min(SLIDE_W / 2 - M - nodeW / 2, 420);
  const ry = maxH / 2 - nodeH / 2;
  const at = (i: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  };
  // Where the segment from a node's centre towards `to` leaves its box.
  const edge = (c: { x: number; y: number }, to: { x: number; y: number }, gap: number) => {
    const dx = to.x - c.x;
    const dy = to.y - c.y;
    const t = Math.min(dx ? nodeW / 2 / Math.abs(dx) : Infinity, dy ? nodeH / 2 / Math.abs(dy) : Infinity);
    const len = Math.hypot(dx, dy) || 1;
    return { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap };
  };
  d.items.forEach((_, i) => {
    const c = at(i);
    const step = i + 1;
    b.add({ kind: "rect", x: c.x - nodeW / 2, y: c.y - nodeH / 2, w: nodeW, h: nodeH, r: 18, fill: branchSoft(i), stroke: branch(i), strokeWidth: 2 }, step);
    const inner = height(labels[i]!) + (details[i]!.lines.length ? 6 + height(details[i]!) : 0);
    const y = c.y - inner / 2;
    b.text(labels[i]!, { x: c.x, top: y, w: nodeW - 2 * pad, fill: "text", anchor: "middle", step });
    if (details[i]!.lines.length) b.text(details[i]!, { x: c.x, top: y + height(labels[i]!) + 6, w: nodeW - 2 * pad, fill: "muted", anchor: "middle", step });
  });
  if (n < 2) return;
  d.items.forEach((_, i) => {
    const from = at(i);
    const to = at((i + 1) % n);
    // Two nodes face each other: offset the two arrows so they do not overlap.
    const off = n === 2 ? (i === 0 ? -18 : 18) : 0;
    const a = edge({ x: from.x + off, y: from.y }, { x: to.x + off, y: to.y }, 8);
    const z = edge({ x: to.x + off, y: to.y }, { x: from.x + off, y: from.y }, 8);
    // An arrow comes with the node it points to; the one closing the loop with the last node.
    b.arrow(a.x, a.y, z.x, z.y, branch(i), i < n - 1 ? i + 2 : n);
  });
}

function hierarchyDiagram(b: Builder, d: Diagram, root: string, top: number) {
  const n = d.items.length;
  const rootW = Math.min(520, Math.max(260, b.measure(root, 26, 700) + 64));
  const r = b.fit(root || " ", [26, 24, 22], rootW - 40, 2 * 26 * LH, 700, 2);
  const rootH = height(r) + 28;
  b.add({ kind: "rect", x: SLIDE_W / 2 - rootW / 2, y: top, w: rootW, h: rootH, r: 14, fill: "accent" });
  b.text(r, { x: SLIDE_W / 2, top: top + 14, w: rootW - 40, fill: "accentInk", anchor: "middle" });
  if (!n) return;
  const gap = 24;
  const boxW = (SLIDE_W - 2 * M - (n - 1) * gap) / n;
  const pad = 14;
  const labelSize = [22, 20, 18, 16].find((s) => d.items.every((it) => wrapText(it.label, s, boxW - 2 * pad, b.measure, 700).length <= 2)) ?? 16;
  const labels = d.items.map((it) => ({ lines: wrapText(it.label, labelSize, boxW - 2 * pad, b.measure, 700, 2), size: labelSize, weight: 700 }));
  const boxH = Math.max(...labels.map(height)) + 2 * pad;
  const busY = top + rootH + 34;
  const boxY = busY + 30;
  const centre = (i: number) => M + i * (boxW + gap) + boxW / 2;
  b.add({ kind: "line", x1: SLIDE_W / 2, y1: top + rootH, x2: SLIDE_W / 2, y2: busY, stroke: "line", strokeWidth: 3 });
  if (n > 1) b.add({ kind: "line", x1: centre(0), y1: busY, x2: centre(n - 1), y2: busY, stroke: "line", strokeWidth: 3 });
  const childRoom = BOTTOM - (boxY + boxH + 16);
  const childSize = [20, 18, 16, 14].find((s) => d.items.every((it) => it.children.reduce((h, c) => h + wrapText(c, s, boxW - 30, b.measure).length * s * LH + s * 0.4, 0) <= childRoom)) ?? 14;
  d.items.forEach((it, i) => {
    const x = M + i * (boxW + gap);
    const step = i + 1;
    b.add({ kind: "line", x1: centre(i), y1: busY, x2: centre(i), y2: boxY, stroke: "line", strokeWidth: 3 }, step);
    b.add({ kind: "rect", x, y: boxY, w: boxW, h: boxH, r: 12, fill: branchSoft(i), stroke: branch(i), strokeWidth: 2 }, step);
    b.text(labels[i]!, { x: centre(i), top: boxY + pad, w: boxW - 2 * pad, fill: "text", anchor: "middle", step });
    bulletList(b, it.children, { x: x + 4, top: boxY + boxH + 16, w: boxW - 4, maxH: childRoom, sizes: [childSize], dot: branch(i), fill: "text", step: () => step });
  });
}

function diagramLayout(b: Builder, slide: Slide, top: number) {
  const d = slide.diagram;
  switch (d.kind) {
    case "steps":
      return stepsDiagram(b, d, top);
    case "cycle":
      return cycleDiagram(b, d, top);
    case "comparison":
      return columnsLayout(
        b,
        d.items.slice(0, 3).map((it) => ({ heading: it.label, bullets: it.children.length ? it.children : it.detail ? [it.detail] : [] })),
        top,
        true,
      );
    case "hierarchy":
      return hierarchyDiagram(b, d, d.root || slide.title, top);
  }
}

/** The slide as a scene: `index` and `total` number it; `number: false` leaves the number out (video). */
export function slideScene(slide: Slide, o: { index?: number; total?: number; measure?: Measure; number?: boolean } = {}): SlideScene {
  const b = new Builder(o.measure ?? textWidth);
  b.add({ kind: "rect", x: 0, y: 0, w: SLIDE_W, h: 8, fill: "accent" });
  if (slide.layout === "title") titleLayout(b, slide);
  else {
    const top = header(b, slide);
    if (slide.layout === "bullets") bulletsLayout(b, slide, top);
    else if (slide.layout === "two-columns") columnsLayout(b, slide.columns, top, false);
    else if (slide.layout === "quote") quoteLayout(b, slide, top);
    else if (slide.layout === "key-figure") figureLayout(b, slide, top);
    else diagramLayout(b, slide, top);
  }
  footer(b, slide, o.index ?? 0, o.total ?? 1, o.number ?? true);
  const desc = slideText(slide);
  return { width: SLIDE_W, height: SLIDE_H, title: slide.title || desc.slice(0, 80) || " ", desc, background: "surface", shapes: b.shapes, steps: b.steps };
}

/** What the slide says, as one line of text (an image's description). */
export function slideText(s: Slide): string {
  const parts: string[] = [s.title];
  if (s.layout === "title") parts.push(s.subtitle);
  else if (s.layout === "bullets") parts.push(...s.bullets);
  else if (s.layout === "two-columns") for (const c of s.columns) parts.push(c.heading, ...c.bullets);
  else if (s.layout === "quote") parts.push(s.quote, s.author);
  else if (s.layout === "key-figure") parts.push(`${s.figure.value} ${s.figure.label}`, ...s.bullets);
  else {
    parts.push(s.diagram.kind === "hierarchy" ? s.diagram.root : "");
    for (const it of s.diagram.items) parts.push([it.label, it.detail].filter(Boolean).join(": "), ...it.children);
  }
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(". ");
}

/** The scene with only what is shown at reveal step `k` (the live slideshow). */
export const revealed = (scene: SlideScene, k: number): SlideScene => ({ ...scene, shapes: scene.shapes.filter((s) => (s.step ?? 0) <= k) });
