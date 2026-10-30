// Transcriptions, one at a time, for this tab: decode on the page and run the
// model in the speech worker, or send to the user's provider. The progress is
// kept here rather than in the panel, so leaving the source's page does not
// stop the run; the result is written to the source.

import { useSyncExternalStore } from "react";
import { getBlob, get, update } from "../data/db.ts";
import type { Id, Source, TranscriptData } from "../data/schema.ts";
import { tr } from "../i18n.ts";
import { scriptURL } from "../trusted.ts";
import type { WorkerIn, WorkerOut } from "../workers/speech.ts";
import { type Engine, engineLabel, type LocalEngine } from "./engines.ts";

export type Stage =
  | { stage: "queued" }
  | { stage: "decode" }
  | { stage: "download"; ratio: number; loaded: number; total: number }
  | { stage: "transcribe"; ratio: number | null; elapsed: number; duration: number }
  | { stage: "upload"; done: number; parts: number };

export interface Choice {
  engine: Engine;
  /** "auto" or an ISO 639-1 code. */
  language: string;
  /** The provider's transcription model, for servers that need it named. */
  model?: string;
}

const stages = new Map<Id, Stage>();
const listeners = new Set<() => void>();
const cancelled = new Set<Id>();
let queue: Promise<void> = Promise.resolve();
let stopCurrent: (() => void) | null = null;
let currentId: Id | null = null;

function set(id: Id, s: Stage | null) {
  if (s) stages.set(id, s);
  else stages.delete(id);
  for (const fn of listeners) fn();
}

/** The run of a source in this tab, or undefined when none is running or waiting. */
export function useStage(id: Id): Stage | undefined {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => stages.get(id),
  );
}

export const isRunning = (id: Id) => stages.has(id);

class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "AbortError";
  }
}

export function cancelTranscription(id: Id) {
  if (!stages.has(id)) return;
  cancelled.add(id);
  if (currentId === id) stopCurrent?.();
  else {
    set(id, null);
    void update("sources", id, { status: "pending" });
  }
}

/** Queue a transcription of the source; it starts when the one before it ends. */
export function startTranscription(source: Source, choice: Choice) {
  if (stages.has(source.id)) return;
  cancelled.delete(source.id);
  set(source.id, { stage: "queued" });
  void update("sources", source.id, { status: "transcribing", error: undefined });
  queue = queue.then(() => runOne(source.id, choice));
}

async function runOne(id: Id, choice: Choice) {
  if (cancelled.has(id)) return;
  currentId = id;
  try {
    const source = await get("sources", id);
    const blob = source?.blobId ? (await getBlob(source.blobId))?.data : undefined;
    if (!source || !blob) throw new Error(tr("The file of this source is missing.", "Le fichier de cette source est introuvable.", "Die Datei dieser Quelle fehlt."));
    const lang = choice.language === "auto" ? undefined : choice.language;
    let data: TranscriptData;
    if (choice.engine.kind === "cloud") {
      const ctl = new AbortController();
      stopCurrent = () => ctl.abort();
      const { cloudTranscribe } = await import("./cloud.ts");
      const r = await cloudTranscribe(blob, { language: lang, model: choice.model, signal: ctl.signal, onDecode: () => set(id, { stage: "decode" }), onPart: (done, parts) => set(id, { stage: "upload", done, parts }) });
      data = { segments: r.segments, language: r.language ?? lang, duration: source.duration ?? r.duration, engine: r.engine };
    } else {
      data = await onDevice(id, blob, choice.engine, lang);
    }
    if (cancelled.has(id)) throw new Cancelled();
    await update("sources", id, { transcript: data, status: "ready", error: undefined, duration: source.duration ?? data.duration });
  } catch (e) {
    if (cancelled.has(id) || (e as Error)?.name === "AbortError") await update("sources", id, { status: "pending" });
    else await update("sources", id, { status: "error", error: e instanceof Error ? e.message : String(e) });
  } finally {
    cancelled.delete(id);
    stopCurrent = null;
    currentId = null;
    set(id, null);
  }
}

let worker: Worker | null = null;
const getWorker = () => (worker ??= new Worker(scriptURL("./speech.js"), { type: "module", name: "amphi-speech" }));

async function onDevice(id: Id, blob: Blob, engine: LocalEngine, lang: string | undefined): Promise<TranscriptData> {
  set(id, { stage: "decode" });
  const { decodeAudio, spokenLanguage } = await import("llm-connect/nemo");
  const samples = await decodeAudio(blob);
  const duration = samples.length / 16_000;
  const started = performance.now();
  const w = getWorker();
  const transcript = await new Promise<import("llm-connect").Transcript>((resolve, reject) => {
    let ratio: number | null = null;
    let transcribing = false;
    const progress = () => set(id, { stage: "transcribe", ratio, elapsed: (performance.now() - started) / 1000, duration });
    const tick = setInterval(() => transcribing && progress(), 500);
    const done = () => clearInterval(tick);
    // Stopping drops the worker and the model it holds: the next run loads it again (from the cache).
    stopCurrent = () => {
      done();
      worker?.terminate();
      worker = null;
      reject(new Cancelled());
    };
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "load") set(id, { stage: "download", ratio: m.ratio, loaded: m.loaded, total: m.total });
      else if (m.type === "ready" || m.type === "progress") {
        transcribing = true;
        if (m.type === "progress") ratio = m.ratio;
        progress();
      } else if (m.type === "done") {
        done();
        resolve(m.transcript);
      } else {
        done();
        reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      done();
      worker = null;
      reject(new Error(e.message || tr("The speech worker stopped.", "Le module de transcription s'est arrêté.", "Das Transkriptionsmodul wurde beendet.")));
    };
    // Whisper does not detect the language: without one it listens for the browser's.
    const msg: WorkerIn = { type: "run", engine, samples, language: lang ?? (engine.kind === "whisper" ? spokenLanguage() : undefined) };
    w.postMessage(msg, [samples.buffer]);
  });
  return {
    segments: transcript.segments.map(({ start, end, text }) => ({ start, end, text })),
    language: transcript.language ?? lang,
    // The media's length, not where the speech ends.
    duration,
    engine: engineLabel(engine),
  };
}
