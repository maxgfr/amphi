// The page's side of the voice worker (src/workers/voice.ts): one worker,
// requests by id, and cancellation by terminating it (inference cannot be
// interrupted otherwise).

import { scriptURL } from "../trusted.ts";
import type { VoiceReply, VoiceRequest } from "../workers/voice.ts";
import { type DeviceVoice, filesFor, type ModelFile, modelById } from "./catalog.ts";
import type { Clip } from "./mix.ts";
import { refreshCached, VOICE_CACHE } from "./prefs.ts";

type Pending = { resolve: (r: VoiceReply & { type: "done" }) => void; reject: (e: Error) => void; progress?: (loaded: number, total: number) => void };

let worker: Worker | null = null;
let next = 1;
const pending = new Map<number, Pending>();

function stop(reason: Error) {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(reason);
  pending.clear();
}

function ensure(): Worker {
  if (worker) return worker;
  const w = new Worker(scriptURL("./voice.js"), { type: "module", name: "voice" });
  w.onmessage = (e: MessageEvent<VoiceReply>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.type === "progress") return p.progress?.(m.loaded, m.total);
    pending.delete(m.id);
    if (m.type === "done") p.resolve(m);
    else p.reject(new Error(m.message));
  };
  w.onerror = (e) => stop(new Error(e.message || "voice worker failed"));
  worker = w;
  return w;
}

type Body = VoiceRequest extends infer R ? (R extends VoiceRequest ? Omit<R, "id"> : never) : never;

function call(body: Body, o: { signal?: AbortSignal; progress?: (loaded: number, total: number) => void } = {}) {
  o.signal?.throwIfAborted();
  const w = ensure();
  const id = next++;
  return new Promise<VoiceReply & { type: "done" }>((resolve, reject) => {
    const abort = () => stop(new DOMException("Aborted", "AbortError") as Error);
    o.signal?.addEventListener("abort", abort, { once: true });
    pending.set(id, {
      resolve: (r) => {
        o.signal?.removeEventListener("abort", abort);
        resolve(r);
      },
      reject: (e) => {
        o.signal?.removeEventListener("abort", abort);
        reject(e);
      },
      progress: o.progress,
    });
    w.postMessage({ ...body, id } as VoiceRequest);
  });
}

/** Download (or find in the cache) every file of these voices. */
export async function downloadFiles(files: ModelFile[], o: { signal?: AbortSignal; progress?: (loaded: number, total: number) => void } = {}): Promise<void> {
  try {
    if (files.length) await call({ type: "download", files }, o);
  } finally {
    await refreshCached();
  }
}

export const downloadVoices = (voiceIds: string[], o: Parameters<typeof downloadFiles>[1] = {}) => downloadFiles(filesFor(voiceIds), o);

export async function deviceSpeak(voice: DeviceVoice, text: string, speed: number, signal?: AbortSignal): Promise<Clip> {
  const model = modelById(voice.model);
  if (!model) throw new Error(`unknown voice model ${voice.model}`);
  const r = await call({ type: "speak", voice, model, text, speed }, { signal });
  return { samples: r.samples ?? new Float32Array(0), sampleRate: r.sampleRate ?? 24_000 };
}

/** Delete downloaded voice files from this device. */
export async function removeFiles(files: ModelFile[]): Promise<void> {
  // The worker keeps loaded models in memory: let it go with them.
  stop(new Error("voices removed"));
  const cache = await caches.open(VOICE_CACHE);
  for (const f of files) await cache.delete(f.url);
  await refreshCached();
}
