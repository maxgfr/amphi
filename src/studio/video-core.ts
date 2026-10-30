// Video summaries as data and as a timeline, free of the browser so they are
// tested directly: the storyboard the model answers (scenes drawn like
// slides, each with what the narrator says), where each scene sits once the
// narration is read (from the voice's cues), which frames to draw (a frame
// rate only where something moves), and subtitles a sentence at a time.

import { z } from "zod";
import { type Cue, fingerprint, sentences } from "../voice/mix.ts";
import { RawSlide, type Slide, toSlide } from "./deck.ts";

export interface VideoScene extends Slide {
  /** What the narrator says over the scene. */
  narration: string;
}

export const MAX_SCENES = 12;

const spoken = (s: string) =>
  s
    .replace(/\s*\[S\d+[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const toScene = (raw: RawSlide): VideoScene => ({ ...toSlide(raw), narration: spoken(raw.narration) });

/** A storyboard as the model answers it: scenes without narration are dropped, at most twelve kept. */
export const StoryboardAnswer = z
  .object({ title: z.string().trim().min(1).max(200), scenes: z.array(z.union([RawSlide, z.null()])) })
  .transform((a) => ({ title: a.title, scenes: a.scenes.filter((s) => s !== null).map(toScene).filter((s) => s.narration).slice(0, MAX_SCENES) }))
  .refine((a) => a.scenes.length > 0, { message: "the storyboard needs at least one scene with narration" });

export const STORYBOARD_SHAPE = `{ "title": "video title", "scenes": [
  { "visual": "title", "title": "...", "subtitle": "...", "narration": "what the narrator says over this scene", "cites": ["S1 p.2"] },
  { "visual": "bullets", "title": "...", "bullets": ["short point", "..."], "narration": "...", "cites": [] },
  { "visual": "diagram", "title": "...", "diagram": { "kind": "steps" | "cycle" | "comparison" | "hierarchy", "root": "top of a hierarchy", "items": [{ "label": "...", "detail": "one sentence (steps, cycle)", "children": ["point (comparison, hierarchy)"] }] }, "narration": "...", "cites": [] },
  { "visual": "key-figure", "title": "...", "figure": { "value": "42 %", "label": "what the number is" }, "narration": "...", "cites": [] },
  { "visual": "quote", "title": "...", "quote": "a sentence from the sources", "author": "...", "narration": "...", "cites": [] }
] }`;

/** The scenes that are read, in order (a scene whose narration was emptied is left out of the video). */
export const voiced = (scenes: VideoScene[]) => scenes.filter((s) => s.narration.trim());

/** One narration line per voiced scene. */
export const narrationLines = (scenes: VideoScene[]) => voiced(scenes).map((s) => ({ speaker: 0, text: s.narration.trim() }));

/** What a render was made from (narration and visuals): when it changes, the video is out of date. */
export const storyboardPrint = (scenes: VideoScene[]) => fingerprint(voiced(scenes).map(({ id: _id, ...s }) => ({ speaker: 0, text: JSON.stringify(s) })));

export interface Span {
  /** When the scene is on screen (it fades in from `start`). */
  start: number;
  end: number;
  /** When its narration is read. */
  speechStart: number;
  speechEnd: number;
}

/** Seconds a scene takes to fade in over the previous one, and a bullet to appear. */
export const FADE = 0.5;
export const REVEAL = 0.35;
/** The last scene stays this long after the voice ends. */
export const TAIL = 1.2;
/** A scene comes in this long before its narration (within the pause between lines). */
export const LEAD = 0.25;
export const FPS = 30;

/** Where each scene sits on the narration's timeline: one cue per scene, in order. */
export function sceneTimeline(cues: Cue[], tail = TAIL): { spans: Span[]; duration: number } {
  const duration = cues.length ? cues.at(-1)!.end + tail : 0;
  const spans = cues.map((c, i) => ({ start: i === 0 ? 0 : Math.max(cues[i - 1]!.end, c.start - LEAD), end: 0, speechStart: c.start, speechEnd: c.end }));
  spans.forEach((s, i) => {
    s.end = spans[i + 1]?.start ?? duration;
  });
  return { spans, duration };
}

/** When reveal step `k` (1…steps) of a scene appears: spread over the first nine tenths of its narration, the first as it starts. */
export function revealTime(span: Span, steps: number, k: number): number {
  if (steps <= 0 || k <= 1) return span.speechStart;
  return span.speechStart + ((k - 1) / steps) * Math.max(0, span.speechEnd - span.speechStart) * 0.9;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => x * x * (3 - 2 * x);

/** What is on screen at `t`: the scene, how far it has faded in over the previous one, and each step's opacity. */
export function frameAt(t: number, spans: Span[], steps: number[]): { scene: number; fade: number; reveal: (step: number) => number } {
  let i = spans.findLastIndex((s) => t >= s.start);
  if (i < 0) i = 0;
  const span = spans[i]!;
  const fade = i === 0 ? 1 : ease(clamp01((t - span.start) / FADE));
  const n = steps[i] ?? 0;
  return { scene: i, fade, reveal: (k) => ease(clamp01((t - revealTime(span, n, k)) / REVEAL)) };
}

/** The moments to draw a frame at, on a 1/FPS grid: every frame while something moves, one a second otherwise. */
export function frameTimes(spans: Span[], steps: number[], duration: number, fps = FPS): number[] {
  const at = new Set<number>();
  const q = (t: number) => Math.round(t * fps);
  const run = (from: number, len: number) => {
    for (let f = q(from); f <= q(from + len) + 1; f++) at.add(f);
  };
  spans.forEach((s, i) => {
    if (i > 0) run(s.start, FADE);
    for (let k = 1; k <= (steps[i] ?? 0); k++) run(revealTime(s, steps[i]!, k), REVEAL);
  });
  for (let f = 0; f < q(duration); f += fps) at.add(f);
  const last = q(duration);
  return [...at]
    .filter((f) => f >= 0 && f < last)
    .sort((a, b) => a - b)
    .map((f) => f / fps);
}

/** Subtitles a sentence at a time: each cue cut into sentences, its time shared out by their length. */
export function subtitleCues(cues: Cue[], max = 110): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const parts = sentences(c.text, max);
    const total = parts.reduce((n, p) => n + p.length, 0) || 1;
    let at = c.start;
    for (const p of parts) {
      const end = at + ((c.end - c.start) * p.length) / total;
      out.push({ start: round(at), end: round(end), speaker: c.speaker, text: p });
      at = end;
    }
  }
  return out;
}

const round = (s: number) => Math.round(s * 1000) / 1000;

/** The storyboard as Markdown: each scene, what it shows and what is said, and when it starts once rendered (`spans` of the voiced scenes). */
export function storyboardMarkdown(title: string, scenes: VideoScene[], spans?: Span[]): string {
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  let read = 0;
  const body = scenes.map((s, i) => {
    const span = s.narration.trim() ? spans?.[read++] : undefined;
    const shown = [s.subtitle, ...s.bullets, s.quote && `“${s.quote}”${s.author ? ` (${s.author})` : ""}`, s.figure.value && `${s.figure.value} ${s.figure.label}`].filter(Boolean);
    const lines = [`## ${i + 1}. ${s.title || "—"}${span ? ` (${clock(span.start)})` : ""}`, ""];
    if (s.layout === "diagram") for (const it of s.diagram.items) lines.push(`- ${it.label}${it.detail ? `: ${it.detail}` : ""}${it.children.length ? ` (${it.children.join(", ")})` : ""}`);
    else for (const x of shown) lines.push(`- ${x}`);
    lines.push("", `> ${s.narration}`, "");
    if (s.cites.length) lines.push(s.cites.map((c) => `[${c}]`).join(" "), "");
    return lines.join("\n");
  });
  return `# ${title}\n\n${body.join("\n")}`.trimEnd() + "\n";
}
