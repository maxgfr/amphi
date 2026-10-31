// The voices that run on this device, off the page's thread: eSpeak NG turns
// text into phonemes, then Kokoro (English) or Piper (French, German) turns
// them into speech with ONNX Runtime on wasm. Models come from Hugging Face
// once, checked against their SHA-256 and kept in the "amphi-voices" cache;
// the phonemizer and ONNX Runtime are the site's own files.
//
// Messages: { id, type: "download", files } answers progress then done;
// { id, type: "speak", voice, model, text, speed } answers done with the clip.
// To cancel, the page terminates the worker.

import createPiperPhonemize from "@diffusionstudio/piper-wasm/build/piper_phonemize.js";
import * as ort from "onnxruntime-web/wasm";
import type { DeviceVoice, ModelFile, VoiceModel } from "../voice/catalog.ts";
import { kokoroPhonemes } from "../voice/mix.ts";
import { recycling } from "./recycle.ts";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const CACHE = "amphi-voices";
const here = (path: string) => new URL(path, scope.location.href).href;

ort.env.wasm.wasmPaths = here("./ort/");
// Threads need cross-origin isolation, which GitHub Pages cannot turn on.
ort.env.wasm.numThreads = scope.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

export type VoiceRequest = { id: number; type: "download"; files: ModelFile[] } | { id: number; type: "speak"; voice: DeviceVoice; model: VoiceModel; text: string; speed: number };
export type VoiceReply = { id: number; type: "progress"; loaded: number; total: number } | { id: number; type: "done"; samples?: Float32Array; sampleRate?: number } | { id: number; type: "error"; message: string };

const post = (m: VoiceReply, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A model file from the cache, else downloaded, checked and cached. */
async function file(f: ModelFile, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(f.url);
  if (hit) {
    const buf = await hit.arrayBuffer();
    onBytes(f.bytes);
    return buf;
  }
  const res = await fetch(f.url);
  if (!res.ok || !res.body) throw new Error(`${new URL(f.url).pathname.split("/").pop()}: HTTP ${res.status}`);
  const out = new Uint8Array(f.bytes);
  const reader = res.body.getReader();
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.byteLength > out.byteLength) throw new Error("unexpected file size");
    out.set(value, at);
    at += value.byteLength;
    onBytes(value.byteLength);
  }
  if (at !== f.bytes || (await sha256(out.buffer)) !== f.sha256) throw new Error(`${new URL(f.url).pathname.split("/").pop()}: the download is corrupt`);
  await cache.put(f.url, new Response(out, { headers: { "content-type": "application/octet-stream" } }));
  return out.buffer;
}

async function download(id: number, files: ModelFile[]) {
  const total = files.reduce((n, f) => n + f.bytes, 0);
  let loaded = 0;
  let last = 0;
  for (const f of files) {
    await file(f, (n) => {
      loaded += n;
      const now = performance.now();
      if (now - last > 150 || loaded === total) {
        last = now;
        post({ id, type: "progress", loaded, total });
      }
    });
  }
}

// eSpeak NG: its files are fetched once; `callMain` runs again on the same
// instance, which is renewed every 20 runs (its heap fills up and aborts after some fifty).
type Phonemizer = { callMain(args: string[]): void };
const lines: string[] = [];
let espeakFiles: Promise<ArrayBuffer[]> | null = null;
const espeak = recycling(async () => {
  espeakFiles ??= Promise.all(["./vendor/piper_phonemize.wasm", "./vendor/espeak-ng.data"].map(async (p) => (await fetch(here(p))).arrayBuffer())).catch((e) => {
    espeakFiles = null;
    throw e;
  });
  const [wasm, data] = await espeakFiles;
  return (await createPiperPhonemize({
    print: (l: string) => lines.push(l),
    printErr: () => {},
    wasmBinary: wasm,
    getPreloadedPackage: () => data,
    locateFile: (p: string) => here(`./vendor/${p}`),
  })) as Phonemizer;
}, 20);

/** Each text's phonemes, as eSpeak NG writes them (one entry per code point, punctuation kept). */
function phonemize(voice: string, texts: string[]): Promise<string[][]> {
  return espeak((module) => {
    lines.length = 0;
    module.callMain(["-l", voice, "--input", JSON.stringify(texts.map((text) => ({ text }))), "--espeak_data", "/espeak-ng-data"]);
    return lines.map((l) => (JSON.parse(l) as { phonemes: string[] }).phonemes);
  });
}

const sessions = new Map<string, Promise<{ session: ort.InferenceSession; config: unknown }>>();

function load(model: VoiceModel, json: (f: ModelFile) => boolean) {
  let s = sessions.get(model.id);
  if (!s) {
    s = (async () => {
      const bufs = await Promise.all(model.files.map((f) => file(f, () => {})));
      const onnx = bufs[model.files.findIndex((f) => f.url.endsWith(".onnx"))]!;
      const cfg = bufs[model.files.findIndex(json)];
      const session = await ort.InferenceSession.create(new Uint8Array(onnx), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      return { session, config: cfg ? JSON.parse(new TextDecoder().decode(cfg)) : null };
    })();
    s.catch(() => sessions.delete(model.id));
    sessions.set(model.id, s);
  }
  return s;
}

const int64 = (ids: number[]) => new ort.Tensor("int64", BigInt64Array.from(ids, (n) => BigInt(n)), [1, ids.length]);

// Piper: the model's own phoneme table, with "^" to start, "$" to end and "_" between phonemes.
interface PiperConfig {
  audio: { sample_rate: number };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  phoneme_id_map: Record<string, number[]>;
}

async function piper(voice: DeviceVoice, model: VoiceModel, text: string, speed: number) {
  const { session, config } = await load(model, (f) => f.url.endsWith(".onnx.json"));
  const cfg = config as PiperConfig;
  const [phonemes = []] = await phonemize(voice.espeak, [text]);
  const map = cfg.phoneme_id_map;
  const pad = map._?.[0] ?? 0;
  const ids = [...(map["^"] ?? [1]), pad];
  for (const p of phonemes) {
    const id = map[p];
    if (id) ids.push(...id, pad);
  }
  ids.push(...(map.$ ?? [2]));
  const feeds: Record<string, ort.Tensor> = {
    input: int64(ids),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor("float32", Float32Array.from([cfg.inference.noise_scale, cfg.inference.length_scale / speed, cfg.inference.noise_w]), [3]),
  };
  if (voice.speaker !== undefined && session.inputNames.includes("sid")) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(voice.speaker)]), [1]);
  const out = await session.run(feeds);
  return { samples: out.output!.data as Float32Array, sampleRate: cfg.audio.sample_rate };
}

// Kokoro: phonemes post-processed as kokoro-js does, mapped through its
// tokenizer's vocabulary, with a style vector picked by length.
const KOKORO_MAX = 510;
const styles = new Map<string, Promise<Float32Array>>();

async function kokoro(voice: DeviceVoice, model: VoiceModel, text: string, speed: number) {
  const { session, config } = await load(model, (f) => f.url.endsWith("tokenizer.json"));
  const vocab = (config as { model: { vocab: Record<string, number> } }).model.vocab;
  let style = styles.get(voice.id);
  if (!style) {
    style = file(voice.files[0]!, () => {}).then((b) => new Float32Array(b));
    styles.set(voice.id, style);
  }
  const clean = text.replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"').replace(/\s+/g, " ").trim();
  const [phonemes = []] = await phonemize(voice.espeak, [clean]);
  const ids = [...kokoroPhonemes(phonemes.join(""), voice.espeak === "en-us")].map((c) => vocab[c]).filter((n): n is number => n !== undefined).slice(0, KOKORO_MAX - 2);
  const n = ids.length;
  const s = (await style).slice(n * 256, n * 256 + 256);
  const out = await session.run({ input_ids: int64([0, ...ids, 0]), style: new ort.Tensor("float32", s, [1, 256]), speed: new ort.Tensor("float32", Float32Array.from([speed]), [1]) });
  return { samples: out.waveform!.data as Float32Array, sampleRate: 24_000 };
}

scope.onmessage = async (e: MessageEvent<VoiceRequest>) => {
  const m = e.data;
  try {
    if (m.type === "download") {
      await download(m.id, m.files);
      post({ id: m.id, type: "done" });
    } else {
      const clip = m.model.engine === "kokoro" ? await kokoro(m.voice, m.model, m.text, m.speed) : await piper(m.voice, m.model, m.text, m.speed);
      // The output tensor's buffer may be shared with ONNX Runtime: send a copy.
      const samples = clip.samples.slice();
      post({ id: m.id, type: "done", samples, sampleRate: clip.sampleRate }, [samples.buffer]);
    }
  } catch (err) {
    post({ id: m.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
