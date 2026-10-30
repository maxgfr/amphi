import { expect, test } from "bun:test";
import { MAX_UPLOAD, maxSecondsFor, mergeParts, planCuts, wav } from "./chunks.ts";

const RATE = 16_000;

test("a short recording is one piece", () => {
  expect(planCuts(new Float32Array(RATE * 5), RATE, 10)).toEqual([[0, RATE * 5]]);
});

test("a long recording is cut under the limit, at its quietest moment, covering everything", () => {
  // 25 s of tone with a silent tenth of a second at 8.0 s and at 17.0 s.
  const s = new Float32Array(RATE * 25).map((_, i) => Math.sin(i / 5) * 0.5);
  for (const at of [8, 17]) s.fill(0, at * RATE, at * RATE + RATE / 10);
  const cuts = planCuts(s, RATE, 10, 5);
  expect(cuts.length).toBe(3);
  expect(cuts[0]![0]).toBe(0);
  expect(cuts.at(-1)![1]).toBe(s.length);
  for (let i = 1; i < cuts.length; i++) expect(cuts[i]![0]).toBe(cuts[i - 1]![1]);
  for (const [a, b] of cuts) expect(b - a).toBeLessThanOrEqual(10 * RATE);
  expect(Math.abs(cuts[0]![1] / RATE - 8.05)).toBeLessThan(0.1);
  expect(Math.abs(cuts[1]![1] / RATE - 17.05)).toBeLessThan(0.1);
});

test("a WAV piece of the longest stretch fits one upload", () => {
  const seconds = maxSecondsFor(MAX_UPLOAD, RATE);
  expect(seconds).toBeGreaterThan(700);
  expect(wav(new Float32Array(10), RATE).length).toBe(44 + 20);
  expect(44 + seconds * RATE * 2).toBeLessThanOrEqual(MAX_UPLOAD);
  const file = wav(new Float32Array([0, 1, -1]), RATE);
  const view = new DataView(file.buffer);
  expect(new TextDecoder().decode(file.slice(0, 4))).toBe("RIFF");
  expect(new TextDecoder().decode(file.slice(8, 12))).toBe("WAVE");
  expect(view.getUint32(24, true)).toBe(RATE);
  expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([0, 32767, -32768]);
});

test("pieces' segments are shifted to the recording's clock", () => {
  const merged = mergeParts([
    { offset: 0, segments: [{ start: 0, end: 2.5, text: "One" }] },
    { offset: 786.4, segments: [{ start: 0.2, end: 1.1, text: "Two" }] },
  ]);
  expect(merged).toEqual([
    { start: 0, end: 2.5, text: "One" },
    { start: 786.6, end: 787.5, text: "Two" },
  ]);
});
