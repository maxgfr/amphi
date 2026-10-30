// The mixed audio, encoded as it is made with Mediabunny: Opus in WebM where
// the browser encodes Opus (Chrome, Firefox, Edge), else AAC in M4A (Safari),
// else 16-bit WAV when WebCodecs has no audio encoder at all.

import { MIX_RATE } from "./mix.ts";

export interface AudioWriter {
  add(samples: Float32Array): Promise<void>;
  finish(): Promise<{ blob: Blob; mime: string }>;
  cancel(): Promise<void>;
}

/** The extension a saved file gets for a mime type. */
export const extensionOf = (mime: string) => (mime.includes("webm") ? "webm" : mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("mpeg") ? "mp3" : "wav");

export async function openWriter(rate = MIX_RATE): Promise<AudioWriter> {
  const mb = await import("mediabunny");
  // Opus encodes at 48 kHz and Chrome's AAC at 44.1 or 48 kHz: resample once, inside Mediabunny.
  const encoded = typeof AudioEncoder === "undefined" ? null : await mb.getFirstEncodableAudioCodec(["opus", "aac"], { numberOfChannels: 1, sampleRate: 48_000 }).catch(() => null);
  const format = encoded === "opus" ? new mb.WebMOutputFormat() : encoded === "aac" ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WavOutputFormat();
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format, target });
  const source = encoded ? new mb.AudioSampleSource({ codec: encoded, quality: mb.QUALITY_MEDIUM, transform: { sampleRate: 48_000 } }) : new mb.AudioSampleSource({ codec: "pcm-s16" });
  output.addAudioTrack(source);
  await output.start();
  let frames = 0;
  return {
    async add(samples) {
      if (!samples.length) return;
      const sample = new mb.AudioSample({ data: samples, format: "f32", numberOfChannels: 1, sampleRate: rate, timestamp: frames / rate });
      frames += samples.length;
      await source.add(sample);
      sample.close();
    },
    async finish() {
      source.close();
      await output.finalize();
      // An audio-only WebM or MP4 is still "video/…" for some formats' defaults.
      const mime = (await output.getMimeType()).replace(/^video\//, "audio/");
      return { blob: new Blob([target.buffer!], { type: mime }), mime };
    },
    async cancel() {
      await output.cancel();
    },
  };
}
