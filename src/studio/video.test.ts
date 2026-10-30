import { expect, test } from "bun:test";
import type { Cue } from "../voice/mix.ts";
import { emptySlide } from "./deck.ts";
import { FADE, FPS, frameAt, frameTimes, LEAD, narrationLines, revealTime, sceneTimeline, StoryboardAnswer, storyboardMarkdown, storyboardPrint, subtitleCues, TAIL, type VideoScene } from "./video-core.ts";

const cue = (start: number, end: number, text = "x"): Cue => ({ start, end, speaker: 0, text });

test("a storyboard keeps the scenes that have narration, without citation labels, at most twelve", () => {
  const ok = StoryboardAnswer.parse({
    title: "Entropy",
    scenes: [
      { visual: "title", title: "Entropy", subtitle: "In one minute", narration: "Today, entropy [S1 p.2]." },
      { visual: "bullets", title: "No voice", bullets: ["a"], narration: "  " },
      null,
      { visual: "key-figure", title: "Zero", figure: { value: 0, label: "decrease" }, narration: "It never decreases." },
    ],
  });
  expect(ok.scenes.map((s) => [s.layout, s.narration])).toEqual([
    ["title", "Today, entropy."],
    ["key-figure", "It never decreases."],
  ]);
  expect(StoryboardAnswer.safeParse({ title: "T", scenes: [{ title: "a", narration: "" }] }).success).toBe(false);
  const many = StoryboardAnswer.parse({ title: "T", scenes: Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, bullets: ["b"], narration: "n" })) });
  expect(many.scenes).toHaveLength(12);
});

test("scenes are timed by the narration's cues: each comes in just before its line, the last stays a moment", () => {
  const { spans, duration } = sceneTimeline([cue(0, 3), cue(3.35, 7), cue(7.35, 9)]);
  expect(duration).toBeCloseTo(9 + TAIL);
  expect(spans[0]).toEqual({ start: 0, end: 3.35 - LEAD, speechStart: 0, speechEnd: 3 });
  expect(spans[1]!.start).toBeCloseTo(3.35 - LEAD);
  expect(spans[2]!.end).toBeCloseTo(duration);
  // A scene never comes in before the previous line ends.
  expect(sceneTimeline([cue(0, 3), cue(3.05, 4)]).spans[1]!.start).toBe(3);
  expect(sceneTimeline([])).toEqual({ spans: [], duration: 0 });
});

test("reveal steps spread over the narration, and the frame at a time says what is shown", () => {
  const span = { start: 2, end: 10, speechStart: 2.25, speechEnd: 9.25 };
  expect(revealTime(span, 3, 1)).toBe(2.25);
  expect(revealTime(span, 3, 2)).toBeCloseTo(2.25 + (1 / 3) * 7 * 0.9);
  expect(revealTime(span, 3, 3)).toBeLessThan(9.25);
  const spans = [{ start: 0, end: 2, speechStart: 0, speechEnd: 1.9 }, span];
  expect(frameAt(1, spans, [0, 3])).toMatchObject({ scene: 0, fade: 1 });
  const mid = frameAt(2 + FADE / 2, spans, [0, 3]);
  expect(mid.scene).toBe(1);
  expect(mid.fade).toBeGreaterThan(0);
  expect(mid.fade).toBeLessThan(1);
  expect(frameAt(2 + FADE, spans, [0, 3]).fade).toBe(1);
  const late = frameAt(9.5, spans, [0, 3]);
  expect([1, 2, 3].map(late.reveal)).toEqual([1, 1, 1]);
  expect(frameAt(2.3, spans, [0, 3]).reveal(3)).toBe(0);
});

test("frames are drawn at the frame rate while something moves, once a second otherwise", () => {
  const { spans, duration } = sceneTimeline([cue(0, 4), cue(4.35, 10)]);
  const steps = [0, 2];
  const times = frameTimes(spans, steps, duration);
  expect(times[0]).toBe(0);
  expect(times.at(-1)!).toBeLessThan(duration);
  for (let i = 1; i < times.length; i++) {
    expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    // Never more than a second without a frame, always on the frame grid.
    expect(times[i]! - times[i - 1]!).toBeLessThanOrEqual(1 + 1e-9);
    expect(Math.abs(times[i]! * FPS - Math.round(times[i]! * FPS))).toBeLessThan(1e-6);
  }
  // Every frame of the fade is there.
  const fade = times.filter((t) => t >= spans[1]!.start && t <= spans[1]!.start + FADE);
  expect(fade.length).toBeGreaterThanOrEqual(Math.floor(FADE * FPS));
  // Far fewer frames than a constant rate.
  expect(times.length).toBeLessThan(duration * FPS * 0.4);
});

test("subtitles go a sentence at a time, sharing their line's time by length", () => {
  const subs = subtitleCues([cue(0, 6, "Entropy measures disorder. It never decreases in an isolated system."), cue(6.5, 8, "Done.")]);
  expect(subs.map((s) => s.text)).toEqual(["Entropy measures disorder.", "It never decreases in an isolated system.", "Done."]);
  expect(subs[0]!.start).toBe(0);
  expect(subs[1]!.start).toBe(subs[0]!.end);
  expect(subs[1]!.end).toBe(6);
  expect(subs[1]!.end - subs[1]!.start).toBeGreaterThan(subs[0]!.end - subs[0]!.start);
});

const scene = (title: string, narration: string): VideoScene => ({ ...emptySlide("bullets"), title, bullets: ["a"], narration });

test("narration, fingerprint and Markdown follow the voiced scenes", () => {
  const scenes = [scene("One", "First."), scene("Silent", " "), scene("Two", "Second.")];
  expect(narrationLines(scenes)).toEqual([
    { speaker: 0, text: "First." },
    { speaker: 0, text: "Second." },
  ]);
  const print = storyboardPrint(scenes);
  // The ids do not count; text and visuals do.
  expect(storyboardPrint(scenes.map((s) => ({ ...s, id: "other" })))).toBe(print);
  expect(storyboardPrint([{ ...scenes[0]!, bullets: ["b"] }, scenes[1]!, scenes[2]!])).not.toBe(print);
  expect(storyboardPrint([scenes[0]!, scenes[1]!, { ...scenes[2]!, narration: "Third." }])).not.toBe(print);
  const { spans } = sceneTimeline([cue(0, 2), cue(62, 64)]);
  const md = storyboardMarkdown("Video", scenes, spans);
  expect(md).toContain("## 1. One (0:00)\n\n- a\n\n> First.");
  expect(md).toContain("## 2. Silent\n");
  expect(md).toContain("## 3. Two (1:01)");
});
