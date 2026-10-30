// Voice settings, kept on this device (the models they point to are
// downloaded here): for each language, on-device voices or the provider's
// speech model; the two voices of a dialogue; the speed. Also which model
// files are already in the cache, so the size to download can be shown
// before anything is fetched.

import { useSyncExternalStore } from "react";
import { DEFAULT_VOICES, type ModelFile, VOICE_LANGS, type VoiceLang, voiceById, voiceLangOf } from "./catalog.ts";

export type Engine = "device" | "provider";

export interface VoicePrefs {
  engine: Record<VoiceLang, Engine>;
  /** On-device voices of each language: the narrator or first host, then the second host. */
  voices: Record<VoiceLang, [string, string]>;
  /** The provider's voices for the two hosts (the narrator is the first). Empty: its defaults. */
  providerVoices: [string, string];
  /** The provider's speech model; empty for its default. */
  providerModel: string;
  /** 0.7 to 1.3. */
  speed: number;
}

const KEY = "amphi-voices";
export const VOICE_CACHE = "amphi-voices";

export const DEFAULT_PREFS: VoicePrefs = {
  engine: { en: "device", fr: "device", de: "device" },
  voices: { ...DEFAULT_VOICES },
  providerVoices: ["", ""],
  providerModel: "",
  speed: 1,
};

const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const fn of listeners) fn();
};

function read(): VoicePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<VoicePrefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const voices = { ...DEFAULT_VOICES };
    for (const l of VOICE_LANGS) {
      const pair = raw.voices?.[l];
      if (pair?.every((id) => voiceById(id)?.lang === l)) voices[l] = [pair[0], pair[1]];
    }
    return {
      engine: { ...DEFAULT_PREFS.engine, ...raw.engine },
      voices,
      providerVoices: [raw.providerVoices?.[0] ?? "", raw.providerVoices?.[1] ?? ""],
      providerModel: typeof raw.providerModel === "string" ? raw.providerModel : "",
      speed: typeof raw.speed === "number" ? Math.min(1.3, Math.max(0.7, raw.speed)) : 1,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

let prefs: VoicePrefs | null = null;
export const voicePrefs = (): VoicePrefs => (prefs ??= read());

export function setVoicePrefs(next: VoicePrefs) {
  prefs = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  emit();
}

/** How a language is spoken: on this device with these two voices, or by the provider. */
export function planFor(language: string, p: VoicePrefs = voicePrefs()): { engine: "device"; lang: VoiceLang; voices: [string, string] } | { engine: "provider" } {
  const lang = voiceLangOf(language);
  if (!lang || p.engine[lang] === "provider") return { engine: "provider" };
  return { engine: "device", lang, voices: p.voices[lang] };
}

// Which model files the cache holds, read once and kept up to date by downloads and removals.
let cached = new Set<string>();
let loaded = false;
export async function refreshCached(): Promise<void> {
  try {
    const cache = await caches.open(VOICE_CACHE);
    cached = new Set((await cache.keys()).map((r) => r.url));
  } catch {
    cached = new Set();
  }
  loaded = true;
  emit();
}
if (typeof caches !== "undefined") void refreshCached();

export const isCached = (f: ModelFile) => cached.has(f.url);
export const missing = (files: ModelFile[]) => files.filter((f) => !cached.has(f.url));
export const cacheKnown = () => loaded;

/** Re-renders when the settings or the cache change. */
export function useVoicePrefs(): VoicePrefs {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return voicePrefs();
}
