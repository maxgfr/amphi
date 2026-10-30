// Cutting audio for providers that cap uploads (25 MB at OpenAI and Groq): a
// recording too big to send whole is decoded to 16 kHz mono, cut at a quiet
// moment before each limit, sent as WAV pieces, and the pieces' times are
// shifted back to where they sit in the recording.

import type { Segment } from "../data/schema.ts";

/** What one upload may weigh: under the providers' 25 MB, with room for the form around it. */
export const MAX_UPLOAD = 24_000_000;

const WAV_HEADER = 44;

/** The longest stretch, in seconds, a 16-bit mono WAV of `maxBytes` holds. */
export const maxSecondsFor = (maxBytes: number, rate: number) => Math.floor((maxBytes - WAV_HEADER) / (2 * rate));

/**
 * Pieces of at most `maxSeconds`, as [start, end) sample indices covering the whole audio. Each cut
 * falls at the quietest tenth of a second within the last `search` seconds before the limit, so a
 * word is rarely split.
 */
export function planCuts(samples: Float32Array, rate: number, maxSeconds: number, search = 15): [number, number][] {
  const max = Math.floor(maxSeconds * rate);
  if (max <= 0) throw new Error("planCuts: maxSeconds must be positive");
  const win = Math.max(1, Math.floor(rate / 10));
  const out: [number, number][] = [];
  let start = 0;
  while (samples.length - start > max) {
    const limit = start + max;
    const from = Math.max(start + Math.floor(max / 2), limit - Math.floor(search * rate));
    let cut = limit;
    let quietest = Number.POSITIVE_INFINITY;
    for (let w = limit - win; w >= from; w -= win) {
      let energy = 0;
      for (let i = w; i < w + win; i++) energy += samples[i]! * samples[i]!;
      if (energy < quietest) {
        quietest = energy;
        cut = w + Math.floor(win / 2);
      }
    }
    out.push([start, cut]);
    start = cut;
  }
  out.push([start, samples.length]);
  return out;
}

/** Mono samples as a 16-bit PCM WAV file. */
export function wav(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(WAV_HEADER + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(WAV_HEADER + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** The pieces' segments on the recording's clock: each piece's times start at its offset (seconds). */
export function mergeParts(parts: { offset: number; segments: readonly Segment[] }[]): Segment[] {
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return parts.flatMap((p) => p.segments.map((s) => ({ text: s.text, start: round(s.start + p.offset), end: round(s.end + p.offset) })));
}
