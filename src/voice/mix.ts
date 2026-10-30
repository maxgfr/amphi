// The arithmetic of a spoken piece, kept free of the browser so it is tested
// directly: cutting text into what a voice reads at once, trimming and
// resampling clips, placing them on one timeline with pauses, WAV in and out,
// and subtitles.

export interface Line {
  /** 0 for the narrator or the first host, 1 for the second host. */
  speaker: number;
  text: string;
}

export interface Cue {
  /** Seconds. */
  start: number;
  end: number;
  speaker: number;
  text: string;
}

export interface Clip {
  samples: Float32Array;
  sampleRate: number;
}

/** The rate everything is mixed at: what Kokoro and the providers' voices produce. */
export const MIX_RATE = 24_000;

/** Silence before a line: short when the same voice goes on, longer when the other one answers. */
export const PAUSE_SAME = 0.35;
export const PAUSE_TURN = 0.55;
/** Silence between the sentences of one line, which the voices read one at a time. */
export const PAUSE_SENTENCE = 0.12;

export const pauseBefore = (previous: number | undefined, speaker: number): number => (previous === undefined ? 0 : previous === speaker ? PAUSE_SAME : PAUSE_TURN);

/** Where each line sits once its clips (`frames` samples at `rate`) are laid end to end with their pauses; counted in samples, as they are written. */
export function layout(lines: { speaker: number; text: string; frames: number }[], rate = MIX_RATE): Cue[] {
  const cues: Cue[] = [];
  let at = 0;
  let previous: number | undefined;
  for (const l of lines) {
    at += silence(pauseBefore(previous, l.speaker), rate).length;
    cues.push({ start: round(at / rate), end: round((at + l.frames) / rate), speaker: l.speaker, text: l.text });
    at += l.frames;
    previous = l.speaker;
  }
  return cues;
}

const round = (s: number) => Math.round(s * 1000) / 1000;

/** Sentences of a text, each at most `max` characters (a longer one is cut at commas, then at spaces). */
export function sentences(text: string, max = 400): string[] {
  const out: string[] = [];
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?…]+(?:[.!?…]+["'»”)]*|$)\s*/g) ?? [];
  for (const raw of parts) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    let cur = "";
    for (const piece of s.split(/(?<=[,;:])\s+|\s+/)) {
      if (cur && cur.length + piece.length + 1 > max) {
        out.push(cur);
        cur = "";
      }
      cur = cur ? `${cur} ${piece}` : piece;
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** The clip without its leading and trailing silence (a few milliseconds kept so words do not clip). */
export function trimSilence(c: Clip, threshold = 0.01, keep = 0.03): Clip {
  const s = c.samples;
  let a = 0;
  while (a < s.length && Math.abs(s[a]!) < threshold) a++;
  let b = s.length;
  while (b > a && Math.abs(s[b - 1]!) < threshold) b--;
  if (a >= b) return { samples: new Float32Array(0), sampleRate: c.sampleRate };
  const pad = Math.round(keep * c.sampleRate);
  return { samples: s.slice(Math.max(0, a - pad), Math.min(s.length, b + pad)), sampleRate: c.sampleRate };
}

/** Linear resampling: plenty for speech going to a lossy encoder. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const n = Math.max(1, Math.round((samples.length * to) / from));
  const out = new Float32Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const j = Math.floor(x);
    const f = x - j;
    const a = samples[Math.min(j, samples.length - 1)]!;
    const b = samples[Math.min(j + 1, samples.length - 1)]!;
    out[i] = a + (b - a) * f;
  }
  return out;
}

/** Clips joined with `gap` seconds of silence between them, at `rate`. */
export function join(clips: Clip[], rate: number, gap = 0): Float32Array {
  const parts = clips.map((c) => resample(c.samples, c.sampleRate, rate));
  const g = Math.round(gap * rate);
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0) + g * Math.max(0, parts.length - 1));
  let at = 0;
  parts.forEach((p, i) => {
    if (i) at += g;
    out.set(p, at);
    at += p.length;
  });
  return out;
}

export const silence = (seconds: number, rate = MIX_RATE) => new Float32Array(Math.round(seconds * rate));

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** A WAV file's samples (PCM 8/16/24/32-bit or float, channels averaged), or null when it is not one. */
export function decodeWav(bytes: Uint8Array): Clip | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let format = 0;
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at);
    // Streams written before their length is known say 0 or 0xFFFFFFFF: the data runs to the end.
    let size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      rate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true);
    } else if (id === "data") {
      if (!channels || !rate) return null;
      if (size === 0 || body + size > bytes.byteLength) size = bytes.byteLength - body;
      const width = bits / 8;
      const frames = Math.floor(size / (width * channels));
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * width;
          if (format === 3 && bits === 32) sum += v.getFloat32(p, true);
          else if (bits === 16) sum += v.getInt16(p, true) / 0x8000;
          else if (bits === 8) sum += (v.getUint8(p) - 128) / 128;
          else if (bits === 24) sum += ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 0x800000);
          else if (bits === 32) sum += v.getInt32(p, true) / 0x80000000;
          else return null;
        }
        out[i] = sum / channels;
      }
      return { samples: out, sampleRate: rate };
    }
    at = body + size + (size % 2);
  }
  return null;
}

/** Kokoro's corrections to eSpeak NG's English phonemes, as kokoro-js makes them (Apache-2.0). */
export function kokoroPhonemes(p: string, american: boolean): string {
  let out = p
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (american) out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return out.trim();
}

/** hh:mm:ss.mmm */
export function vttTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

/** WebVTT subtitles, one cue per line, with the speaker's name as a voice tag when there are names. */
export function toVtt(cues: Cue[], names?: string[]): string {
  const clean = (s: string) => s.replace(/-->/g, "→").replace(/\s*\n+\s*/g, " ").trim();
  const body = cues.map((c, i) => {
    const name = names?.[c.speaker];
    const text = clean(c.text).replace(/[<&]/g, (ch) => (ch === "<" ? "&lt;" : "&amp;"));
    return `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${name ? `<v ${clean(name).replace(/[<>&]/g, "")}>` : ""}${text}`;
  });
  return `WEBVTT\n\n${body.join("\n\n")}\n`;
}

/** A short, stable fingerprint of a script, to know whether its audio is still the one it was made from. */
export function fingerprint(lines: Line[]): string {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(lines.map((l) => [l.speaker, l.text]))) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
