import { describe, expect, test } from "bun:test";
import { filesFor, totalBytes, voiceLangOf } from "./catalog.ts";
import { decodeWav, encodeWav, fingerprint, join, kokoroPhonemes, layout, MIX_RATE, PAUSE_SAME, PAUSE_TURN, pauseBefore, resample, sentences, silence, toVtt, trimSilence, vttTime } from "./mix.ts";
import { DEFAULT_PREFS, planFor } from "./prefs.ts";

describe("timeline", () => {
  test("pauses are short within a voice and longer at a change of voice", () => {
    expect(pauseBefore(undefined, 0)).toBe(0);
    expect(pauseBefore(0, 0)).toBe(PAUSE_SAME);
    expect(pauseBefore(0, 1)).toBe(PAUSE_TURN);
    expect(PAUSE_TURN).toBeGreaterThan(PAUSE_SAME);
  });

  test("cues follow each other with their pauses", () => {
    const cues = layout(
      [
        { speaker: 0, text: "Hello.", frames: 1.5 * MIX_RATE },
        { speaker: 1, text: "Hi!", frames: 0.75 * MIX_RATE },
        { speaker: 1, text: "Shall we?", frames: MIX_RATE },
      ],
      MIX_RATE,
    );
    expect(cues).toEqual([
      { start: 0, end: 1.5, speaker: 0, text: "Hello." },
      { start: 2.05, end: 2.8, speaker: 1, text: "Hi!" },
      { start: 3.15, end: 4.15, speaker: 1, text: "Shall we?" },
    ]);
  });

  test("cues are counted in the samples written, so they match the file", () => {
    // 1 s at 1000 Hz, then a 0.55 s pause of 550 samples.
    const [, b] = layout(
      [
        { speaker: 0, text: "a", frames: 1000 },
        { speaker: 1, text: "b", frames: 333 },
      ],
      1000,
    );
    expect(b).toEqual({ start: 1 + silence(PAUSE_TURN, 1000).length / 1000, end: 1.883, speaker: 1, text: "b" });
  });
});

describe("clips", () => {
  test("resampling keeps the duration", () => {
    const one = new Float32Array(22_050).fill(0.5);
    const out = resample(one, 22_050, MIX_RATE);
    expect(out.length).toBe(MIX_RATE);
    expect(out[100]).toBeCloseTo(0.5);
    expect(resample(one, 22_050, 22_050)).toBe(one);
  });

  test("silence is trimmed at both ends, with a small margin", () => {
    const s = new Float32Array(1000);
    s.fill(0.5, 400, 600);
    const t = trimSilence({ samples: s, sampleRate: 1000 }, 0.01, 0.01);
    expect(t.samples.length).toBe(220);
    expect(trimSilence({ samples: new Float32Array(10), sampleRate: 1000 }).samples.length).toBe(0);
  });

  test("clips join with gaps, resampled to one rate", () => {
    const a = { samples: new Float32Array(100).fill(1), sampleRate: 100 };
    const b = { samples: new Float32Array(50).fill(-1), sampleRate: 50 };
    const out = join([a, b], 100, 0.5);
    expect(out.length).toBe(100 + 50 + 100);
    expect(out[120]).toBe(0);
    expect(out[200]).toBe(-1);
  });

  test("WAV round trip", () => {
    const s = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 10) * 0.8);
    const back = decodeWav(encodeWav(s, MIX_RATE))!;
    expect(back.sampleRate).toBe(MIX_RATE);
    expect(back.samples.length).toBe(480);
    expect(back.samples[42]).toBeCloseTo(s[42]!, 3);
    expect(decodeWav(new TextEncoder().encode("not a wave file"))).toBeNull();
  });

  test("a WAV whose data length is unknown runs to the end of the file", () => {
    const wav = encodeWav(new Float32Array(10).fill(0.25), 8000);
    new DataView(wav.buffer).setUint32(40, 0xffffffff, true);
    expect(decodeWav(wav)!.samples.length).toBe(10);
  });
});

describe("text", () => {
  test("sentences, with long ones cut", () => {
    expect(sentences("Entropy grows. Does it?  Yes!  And so on")).toEqual(["Entropy grows.", "Does it?", "Yes!", "And so on"]);
    const long = sentences(`${"word ".repeat(200)}end.`, 100);
    expect(long.length).toBeGreaterThan(5);
    expect(long.every((s) => s.length <= 100)).toBe(true);
    expect(long.join(" ").split(" ").length).toBe(201);
  });

  test("Kokoro's phoneme corrections", () => {
    expect(kokoroPhonemes("ɹˈɛd ʲɛs", true)).toBe("ɹˈɛd jɛs");
    expect(kokoroPhonemes("nˈaɪnti", true)).toBe("nˈaɪndi");
    expect(kokoroPhonemes("nˈaɪnti", false)).toBe("nˈaɪnti");
  });
});

describe("subtitles", () => {
  test("times", () => {
    expect(vttTime(0)).toBe("00:00:00.000");
    expect(vttTime(3723.4567)).toBe("01:02:03.457");
  });

  test("WebVTT with voice tags and escaped text", () => {
    const vtt = toVtt(
      [
        { start: 0, end: 1.25, speaker: 0, text: "A <b> & B" },
        { start: 1.8, end: 3, speaker: 1, text: "arrow --> here\nand there" },
      ],
      ["Léa", "Tom"],
    );
    expect(vtt).toBe("WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.250\n<v Léa>A &lt;b> &amp; B\n\n2\n00:00:01.800 --> 00:00:03.000\n<v Tom>arrow → here and there\n");
    expect(toVtt([{ start: 0, end: 1, speaker: 0, text: "Solo" }])).toBe("WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nSolo\n");
  });

  test("a script's fingerprint changes with its text and speakers only", () => {
    const a = fingerprint([{ speaker: 0, text: "Hi" }]);
    expect(fingerprint([{ speaker: 0, text: "Hi" }])).toBe(a);
    expect(fingerprint([{ speaker: 1, text: "Hi" }])).not.toBe(a);
    expect(fingerprint([{ speaker: 0, text: "Hi!" }])).not.toBe(a);
  });
});

describe("voices", () => {
  test("languages the device voices speak", () => {
    expect(voiceLangOf("fr-CA")).toBe("fr");
    expect(voiceLangOf("DE")).toBe("de");
    expect(voiceLangOf("es")).toBeNull();
  });

  test("a dialogue in French downloads one model, in German two", () => {
    const fr = filesFor(DEFAULT_PREFS.voices.fr);
    expect(fr.filter((f) => f.url.endsWith(".onnx")).length).toBe(1);
    expect(filesFor(DEFAULT_PREFS.voices.de).filter((f) => f.url.endsWith(".onnx")).length).toBe(2);
    // Kokoro: the model, its tokenizer and one style file per voice.
    const en = filesFor(DEFAULT_PREFS.voices.en);
    expect(en.length).toBe(4);
    expect(totalBytes(en)).toBeGreaterThan(90_000_000);
    expect(en.every((f) => /^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//.test(f.url) && /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
  });

  test("other languages go to the provider", () => {
    expect(planFor("es", DEFAULT_PREFS)).toEqual({ engine: "provider" });
    expect(planFor("fr", DEFAULT_PREFS)).toMatchObject({ engine: "device", lang: "fr" });
    expect(planFor("fr", { ...DEFAULT_PREFS, engine: { ...DEFAULT_PREFS.engine, fr: "provider" } })).toEqual({ engine: "provider" });
  });
});
