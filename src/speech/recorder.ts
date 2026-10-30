// The microphone, for one lecture at a time in this tab: MediaRecorder hands
// a chunk every ten seconds and each one is written to IndexedDB at once
// (src/speech/draft.ts). The recorder lives outside the screen, so browsing
// the course while recording does not stop it. The screen stays awake while
// recording (Wake Lock, taken again when the tab comes back), and a Web Lock
// tells other tabs a recording is running.

import { useSyncExternalStore } from "react";
import type { Id, Marker, Source } from "../data/schema.ts";
import { tr } from "../i18n.ts";
import { type Draft, finishDraft, LOCK, newDraftId, pickMime, saveChunk, saveDraft } from "./draft.ts";

export type RecState = "idle" | "starting" | "recording" | "paused" | "stopping";

export interface Snapshot {
  state: RecState;
  courseId?: Id;
  lessonId?: Id;
  markers: Marker[];
  error?: string;
  /** The source the last recording became. */
  saved?: Id;
}

const TIMESLICE = 10_000;
const HEARTBEAT = 5_000;

let snap: Snapshot = { state: "idle", markers: [] };
const listeners = new Set<() => void>();
function emit(patch: Partial<Snapshot>) {
  snap = { ...snap, ...patch };
  for (const fn of listeners) fn();
}

export function useRecorder(): Snapshot {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snap,
  );
}
export const recorderState = () => snap.state;

let media: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let audio: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let samples: Float32Array<ArrayBuffer> | null = null;
let base: Omit<Draft, "elapsed" | "markers" | "chunks" | "updatedAt"> | null = null;
let chunks: Blob[] = [];
let written = 0;
let writes: Promise<unknown> = Promise.resolve();
let accumulated = 0;
let since = 0;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let wake: WakeLockSentinel | null = null;
let releaseLock: (() => void) | null = null;

/** Seconds recorded, pauses excluded. */
export function elapsed(): number {
  return (accumulated + (snap.state === "recording" ? performance.now() - since : 0)) / 1000;
}

/** The input's loudness, 0 to 1 (a decibel scale from -60 dB). */
export function level(): number {
  if (!analyser || !samples) return 0;
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length);
  const db = 20 * Math.log10(rms || 1e-6);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

const draft = (): Draft => ({ ...base!, elapsed: Math.round(elapsed() * 10) / 10, markers: snap.markers, chunks: written, updatedAt: Date.now() });
/** Writes run one after the other, so the draft on disk never counts a chunk that is not there. */
const queue = (fn: () => Promise<unknown>) => (writes = writes.then(fn).catch(() => {}));

async function keepAwake() {
  if (wake || document.visibilityState !== "visible") return;
  try {
    wake = await navigator.wakeLock.request("screen");
    // The browser lets go when the tab is hidden; `onVisible` takes it again.
    wake.addEventListener("release", () => {
      wake = null;
    });
  } catch {
    wake = null;
  }
}
function onVisible() {
  if (snap.state === "recording" || snap.state === "paused") void keepAwake();
}

function micError(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return tr("Microphone access was refused. Allow it in the browser's site settings, then try again.", "L'accès au micro a été refusé. Autorisez-le dans les réglages du site du navigateur, puis réessayez.", "Der Mikrofonzugriff wurde verweigert. Erlauben Sie ihn in den Website-Einstellungen des Browsers und versuchen Sie es erneut.");
  if (name === "NotFoundError" || name === "OverconstrainedError") return tr("No microphone was found.", "Aucun micro n'a été trouvé.", "Kein Mikrofon gefunden.");
  return e instanceof Error ? e.message : String(e);
}

export async function startRecording(where: { courseId: Id; lessonId?: Id; newLesson?: boolean }): Promise<void> {
  if (snap.state !== "idle") return;
  emit({ state: "starting", courseId: where.courseId, lessonId: where.lessonId, markers: [], error: undefined, saved: undefined });
  try {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error(tr("This browser cannot record audio.", "Ce navigateur ne peut pas enregistrer de son.", "Dieser Browser kann keinen Ton aufnehmen."));
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    const mime = pickMime((t) => MediaRecorder.isTypeSupported(t));
    // 32 kb/s Opus is plenty for speech, and keeps an hour and a half under the providers' 25 MB.
    media = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
    base = { id: newDraftId(), courseId: where.courseId, lessonId: where.lessonId, newLesson: where.newLesson, mime: media.mimeType || mime, startedAt: Date.now() };
    chunks = [];
    written = 0;
    accumulated = 0;
    writes = Promise.resolve();
    media.addEventListener("dataavailable", (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      const n = chunks.length - 1;
      queue(async () => {
        await saveChunk(draft(), n, e.data);
        written = Math.max(written, n + 1);
      });
    });
    media.addEventListener("error", () => void stopRecording());
    for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => void stopRecording());
    await saveDraft(draft());
    try {
      audio = new AudioContext();
      analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      samples = new Float32Array(analyser.fftSize);
      audio.createMediaStreamSource(stream).connect(analyser);
    } catch {
      analyser = null;
    }
    media.start(TIMESLICE);
    since = performance.now();
    heartbeat = setInterval(() => queue(() => saveDraft(draft())), HEARTBEAT);
    navigator.locks?.request(LOCK, () => new Promise<void>((r) => (releaseLock = r))).catch(() => {});
    document.addEventListener("visibilitychange", onVisible);
    void keepAwake();
    emit({ state: "recording" });
  } catch (e) {
    cleanup();
    emit({ state: "idle", error: micError(e) });
  }
}

export function pauseRecording() {
  if (snap.state !== "recording" || !media) return;
  media.pause();
  accumulated += performance.now() - since;
  emit({ state: "paused" });
  queue(() => saveDraft(draft()));
}

export function resumeRecording() {
  if (snap.state !== "paused" || !media) return;
  media.resume();
  since = performance.now();
  emit({ state: "recording" });
}

/** An "important" moment, at the time recorded so far. */
export function markMoment() {
  if (snap.state !== "recording" && snap.state !== "paused") return;
  const t = Math.round(elapsed() * 10) / 10;
  if (snap.markers.some((m) => Math.abs(m.t - t) < 1)) return;
  emit({ markers: [...snap.markers, { t }] });
  queue(() => saveDraft(draft()));
}

function cleanup() {
  clearInterval(heartbeat);
  for (const track of stream?.getTracks() ?? []) track.stop();
  void audio?.close().catch(() => {});
  document.removeEventListener("visibilitychange", onVisible);
  void wake?.release().catch(() => {});
  wake = null;
  releaseLock?.();
  releaseLock = null;
  media = null;
  stream = null;
  audio = null;
  analyser = null;
}

/** Stop, keep the recording as a source waiting for transcription, and return it. */
export async function stopRecording(): Promise<Source | null> {
  if ((snap.state !== "recording" && snap.state !== "paused") || !media) return null;
  const m = media;
  // No heartbeat after this point: it would write the draft back once the source exists.
  clearInterval(heartbeat);
  const total = elapsed();
  accumulated = total * 1000;
  emit({ state: "stopping" });
  try {
    await new Promise<void>((resolve) => {
      m.addEventListener("stop", () => resolve(), { once: true });
      m.stop();
    });
    await writes;
    const source = await finishDraft(draft(), chunks, total);
    cleanup();
    chunks = [];
    emit({ state: "idle", markers: [], saved: source.id });
    return source;
  } catch (e) {
    // The chunks stay on disk: the record screen offers to recover them.
    cleanup();
    emit({ state: "idle", error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
