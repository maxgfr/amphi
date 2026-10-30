// The provider's speech model, with the key and provider of the saved AI
// settings: OpenAI (and OpenAI-compatible servers that implement
// /audio/speech) or Gemini, through the AI SDK's generateSpeech. Every request
// goes through llm-connect's guarded fetch, as chat requests do.

import { baseUrlOf, guardedFetch, type LlmSettings, providerKindOf } from "llm-connect";
import { tr } from "../i18n.ts";
import { type Clip, decodeWav } from "./mix.ts";

export type SpeechSdk = "openai" | "google";

export const DEFAULT_SPEECH_MODELS: Record<SpeechSdk, string> = { openai: "gpt-4o-mini-tts", google: "gemini-2.5-flash-preview-tts" };
/** A local OpenAI-compatible server (Kokoro-FastAPI, openedai-speech, LocalAI) usually answers to OpenAI's first model name. */
const CUSTOM_DEFAULT = "tts-1";

/** Voices each SDK offers, the defaults first: a woman then a man, so two hosts sound apart. */
export const PROVIDER_VOICES: Record<SpeechSdk, string[]> = {
  openai: ["coral", "onyx", "alloy", "ash", "ballad", "echo", "fable", "nova", "sage", "shimmer", "verse"],
  google: ["Kore", "Puck", "Zephyr", "Charon", "Aoede", "Fenrir", "Leda", "Orus"],
};

export interface SpeechTarget {
  sdk: SpeechSdk;
  model: string;
  baseURL?: string;
}

/** The speech model the settings call, or why they cannot speak. */
export function speechTarget(s: LlmSettings | null, model = ""): { target: SpeechTarget } | { problem: string } {
  if (!s) return { problem: tr("Set up an AI provider first (Settings → AI).", "Configurez d'abord un fournisseur d'IA (Réglages → IA).", "Richten Sie zuerst einen KI-Anbieter ein (Einstellungen → KI).") };
  const kind = providerKindOf(s);
  const base = baseUrlOf(s);
  if (kind === "openai" || kind === "google") {
    const sdk: SpeechSdk = kind === "google" ? "google" : "openai";
    return { target: { sdk, model: model || DEFAULT_SPEECH_MODELS[sdk], ...(s.providerApi ? { baseURL: base } : {}) } };
  }
  if (kind === "openai-compatible" && (s.customEndpoint || model)) return { target: { sdk: "openai", model: model || CUSTOM_DEFAULT, baseURL: base } };
  if (kind === "openai-compatible")
    return { problem: tr("This provider has no known voice model: name one in Settings → Voices, or use the voices on this device.", "Ce fournisseur n'a pas de modèle de voix connu : nommez-en un dans Réglages → Voix, ou utilisez les voix de cet appareil.", "Dieser Anbieter hat kein bekanntes Sprachmodell: Nennen Sie eines unter Einstellungen → Stimmen, oder nutzen Sie die Stimmen dieses Geräts.") };
  return { problem: tr(`${s.providerName ?? kind} has no voice model. Use OpenAI or Gemini, or the voices on this device (Settings → Voices).`, `${s.providerName ?? kind} n'a pas de modèle de voix. Utilisez OpenAI ou Gemini, ou les voix de cet appareil (Réglages → Voix).`, `${s.providerName ?? kind} hat kein Sprachmodell. Nutzen Sie OpenAI oder Gemini oder die Stimmen dieses Geräts (Einstellungen → Stimmen).`) };
}

async function speechModel(s: LlmSettings, t: SpeechTarget) {
  const config = { apiKey: s.apiKey || "", ...(t.baseURL ? { baseURL: t.baseURL } : {}), ...(s.headers ? { headers: s.headers } : {}), fetch: guardedFetch(providerKindOf(s)) as typeof fetch };
  if (t.sdk === "google") return (await import("@ai-sdk/google")).createGoogle(config).speech(t.model);
  return (await import("@ai-sdk/openai")).createOpenAI(config).speech(t.model);
}

/** Decoded samples of any audio file: WAV here, anything else through the browser's decoder. */
export async function decodeAudio(bytes: Uint8Array): Promise<Clip> {
  const wav = decodeWav(bytes);
  if (wav) return wav;
  const ctx = new OfflineAudioContext(1, 1, 24_000);
  const buf = await ctx.decodeAudioData(bytes.slice().buffer);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i]! += ch[i]! / buf.numberOfChannels;
  }
  return { samples: out, sampleRate: buf.sampleRate };
}

export async function providerSpeak(s: LlmSettings, t: SpeechTarget, text: string, o: { voice: string; speed: number; language: string; signal?: AbortSignal }): Promise<Clip> {
  const { generateSpeech } = await import("ai");
  const res = await generateSpeech({
    model: await speechModel(s, t),
    text,
    voice: o.voice || PROVIDER_VOICES[t.sdk][0],
    outputFormat: "wav",
    // Gemini ignores speed and language and says so in warnings; OpenAI ignores language.
    ...(t.sdk === "openai" && o.speed !== 1 ? { speed: o.speed } : {}),
    maxRetries: 1,
    abortSignal: o.signal,
  });
  return decodeAudio(res.audio.uint8Array);
}
