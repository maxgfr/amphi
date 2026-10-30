// The video file: scenes painted on a 1280×720 canvas, encoded with
// Mediabunny through WebCodecs as H.264 in MP4 where the browser encodes it,
// else VP9 or VP8 in WebM, with the narration decoded and encoded again
// beside it (AAC or Opus in MP4, Opus in WebM). Frames are only drawn where
// something moves (fades, bullets appearing); a still scene is held by one
// frame a second, which keeps encoding quick and seeking right.

import { tr } from "../i18n.ts";
import type { Progress } from "./types.ts";
import { paintScene } from "./render/paint.ts";
import { SLIDE_H, SLIDE_W, type SlideScene } from "./render/slide-layout.ts";
import { FPS, frameAt, frameTimes, type Span } from "./video-core.ts";

export interface VideoFormat {
  container: "mp4" | "webm";
  video: "avc" | "vp9" | "vp8";
  audio: "aac" | "opus";
}

/** What this browser can encode the video as, or why it cannot. */
export async function videoFormat(): Promise<VideoFormat | { problem: string }> {
  const none = tr(
    "This browser cannot encode video (no WebCodecs video encoder): the summary plays here as a narrated slideshow, and there is no video file to export.",
    "Ce navigateur ne sait pas encoder de vidéo (pas d'encodeur vidéo WebCodecs) : le résumé se joue ici en diaporama commenté, sans fichier vidéo à exporter.",
    "Dieser Browser kann kein Video kodieren (kein WebCodecs-Videoencoder): Die Zusammenfassung läuft hier als kommentierte Diashow, ohne Videodatei zum Exportieren.",
  );
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") return { problem: none };
  const mb = await import("mediabunny");
  const size = { width: SLIDE_W, height: SLIDE_H };
  const audio = { numberOfChannels: 1, sampleRate: 48_000 };
  const videoCodec = (cs: ("avc" | "vp9" | "vp8")[]) => mb.getFirstEncodableVideoCodec(cs, size).catch(() => null) as Promise<VideoFormat["video"] | null>;
  const audioCodec = (cs: VideoFormat["audio"][]) => mb.getFirstEncodableAudioCodec(cs, audio).catch(() => null) as Promise<VideoFormat["audio"] | null>;
  const avc = await videoCodec(["avc"]);
  const mp4Audio = avc ? await audioCodec(["aac", "opus"]) : null;
  if (avc && mp4Audio) return { container: "mp4", video: avc, audio: mp4Audio };
  const vp = await videoCodec(["vp9", "vp8"]);
  const opus = vp ? await audioCodec(["opus"]) : null;
  if (vp && opus) return { container: "webm", video: vp, audio: opus };
  return { problem: none };
}

export const videoExtension = (mime: string) => (mime.includes("mp4") ? "mp4" : "webm");

export async function encodeVideo(o: { scenes: SlideScene[]; spans: Span[]; duration: number; narration: Blob; format: VideoFormat; signal?: AbortSignal; progress?: (p: Progress) => void }): Promise<{ blob: Blob; mime: string }> {
  const mb = await import("mediabunny");
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(SLIDE_W, SLIDE_H) : Object.assign(document.createElement("canvas"), { width: SLIDE_W, height: SLIDE_H });
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("No canvas.");
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: o.format.container === "mp4" ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat(), target });
  const video = new mb.CanvasSource(canvas, { codec: o.format.video, quality: mb.QUALITY_HIGH, keyFrameInterval: 2 });
  const audio = new mb.AudioSampleSource({ codec: o.format.audio, quality: mb.QUALITY_MEDIUM, transform: { sampleRate: 48_000, numberOfChannels: 1 } });
  output.addVideoTrack(video, { frameRate: FPS });
  output.addAudioTrack(audio);
  const input = new mb.Input({ source: new mb.BlobSource(o.narration), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("The narration has no audio.");
    await output.start();
    // The narration goes in alongside the frames, a little ahead of them, so the file is interleaved.
    const samples = new mb.AudioSampleSink(track).samples();
    let pending: IteratorResult<InstanceType<typeof mb.AudioSample>> | null = null;
    const audioUntil = async (t: number) => {
      for (;;) {
        pending ??= await samples.next();
        if (pending.done || pending.value.timestamp > t) return;
        await audio.add(pending.value);
        pending.value.close();
        pending = null;
      }
    };
    const steps = o.scenes.map((s) => s.steps);
    const times = frameTimes(o.spans, steps, o.duration);
    let fading = false;
    for (const [n, t] of times.entries()) {
      o.signal?.throwIfAborted();
      const f = frameAt(t, o.spans, steps);
      ctx.clearRect(0, 0, SLIDE_W, SLIDE_H);
      // The scene before stays fully shown underneath while the next one fades in.
      if (f.fade < 1 && f.scene > 0) paintScene(ctx, o.scenes[f.scene - 1]!);
      paintScene(ctx, o.scenes[f.scene]!, { alpha: f.fade, reveal: f.reveal });
      const next = times[n + 1] ?? o.duration;
      // A key frame once a fade is over: the still frames held after it start clean, with no trace of the scene before.
      const settled = fading && f.fade >= 1;
      fading = f.fade < 1;
      await video.add(t, Math.max(1 / FPS, next - t), settled ? { keyFrame: true } : undefined);
      await audioUntil(next + 0.5);
      if (n % 10 === 0) o.progress?.({ ratio: n / times.length, label: tr(`Encoding the video… ${Math.round((n / times.length) * 100)} %`, `Encodage de la vidéo… ${Math.round((n / times.length) * 100)} %`, `Video wird kodiert… ${Math.round((n / times.length) * 100)} %`) });
    }
    await audioUntil(Infinity);
    video.close();
    audio.close();
    await output.finalize();
    const mime = await output.getMimeType();
    return { blob: new Blob([target.buffer!], { type: mime }), mime };
  } catch (e) {
    if (output.state !== "finalized" && output.state !== "canceled") await output.cancel().catch(() => {});
    throw e;
  } finally {
    input.dispose();
  }
}
