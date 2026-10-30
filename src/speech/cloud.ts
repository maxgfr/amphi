// Transcription with the user's own provider (its speech-to-text model, the
// same key): only after the panel has said what is sent and to whom. A file
// over the providers' upload cap is decoded and sent as WAV pieces cut at
// quiet moments, and the pieces' times are put back on the recording's clock.

import { decodeAudio, SPEECH_SAMPLE_RATE } from "llm-connect/nemo";
import { describeError, type LlmSettings, transcribe, transcriptionProblem, transcriptionTargetOf } from "llm-connect";
import { loadLlm, recipient, savedSettings } from "../ai/llm.ts";
import type { Segment } from "../data/schema.ts";
import { tr } from "../i18n.ts";
import { MAX_UPLOAD, maxSecondsFor, mergeParts, planCuts, wav } from "./chunks.ts";

export interface CloudTarget {
  /** Who receives the audio ("OpenAI", "127.0.0.1:9"); empty without a provider. */
  recipient: string;
  /** The transcription model called, when it can be. */
  model?: string;
  /** Why it cannot run, or null. */
  problem: string | null;
  /** The server needs the user to name its transcription model. */
  needsModel: boolean;
}

function problemText(s: LlmSettings | null, model?: string): { text: string | null; needsModel: boolean } {
  if (!s) return { text: tr("No AI provider is set up (Settings → AI).", "Aucun fournisseur d'IA n'est configuré (Réglages → IA).", "Kein KI-Anbieter eingerichtet (Einstellungen → KI)."), needsModel: false };
  const p = transcriptionProblem(s, model || undefined);
  if (!p) return { text: null, needsModel: false };
  switch (p.code) {
    case "no-key":
      return { text: tr("Your provider needs an API key to transcribe (Settings → AI).", "Votre fournisseur a besoin d'une clé d'API pour transcrire (Réglages → IA).", "Ihr Anbieter braucht einen API-Schlüssel zum Transkribieren (Einstellungen → KI)."), needsModel: false };
    case "no-model":
      return { text: tr("Name the transcription model your server serves (a Whisper model, for instance).", "Indiquez le modèle de transcription que sert votre serveur (un modèle Whisper, par exemple).", "Nennen Sie das Transkriptionsmodell Ihres Servers (zum Beispiel ein Whisper-Modell)."), needsModel: true };
    default:
      return {
        text: tr("Your provider has no speech-to-text model: use OpenAI, Gemini, Mistral or Groq, or a model on this device.", "Votre fournisseur n'a pas de modèle de transcription : utilisez OpenAI, Gemini, Mistral ou Groq, ou un modèle sur cet appareil.", "Ihr Anbieter hat kein Sprache-zu-Text-Modell: Nutzen Sie OpenAI, Gemini, Mistral oder Groq oder ein Modell auf diesem Gerät."),
        needsModel: false,
      };
  }
}

/** Where cloud transcription would go with the saved settings, for the notice shown before sending. */
export function cloudTarget(model?: string): CloudTarget {
  const s = savedSettings();
  const { text, needsModel } = problemText(s, model);
  return { recipient: recipient(s), model: s ? transcriptionTargetOf(s, model || undefined)?.model : undefined, problem: text, needsModel };
}

/** How many uploads a file of this size takes (an estimate before decoding: WAV pieces are bigger than the recording). */
export const uploadsFor = (size: number, duration?: number) => (size <= MAX_UPLOAD ? 1 : Math.ceil((duration ?? size / 4000) / maxSecondsFor(MAX_UPLOAD, SPEECH_SAMPLE_RATE)));

export interface CloudResult {
  segments: Segment[];
  language?: string;
  duration?: number;
  /** "OpenAI · whisper-1": who transcribed it. */
  engine: string;
}

export async function cloudTranscribe(
  audio: Blob,
  o: { language?: string; model?: string; signal?: AbortSignal; onPart?: (done: number, parts: number) => void; onDecode?: () => void },
): Promise<CloudResult> {
  await loadLlm();
  const s = savedSettings();
  const { text } = problemText(s, o.model);
  if (!s || text) throw new Error(text ?? "");
  const engine = [recipient(s), transcriptionTargetOf(s, o.model || undefined)?.model].filter(Boolean).join(" · ");
  const call = async (piece: Blob) => {
    try {
      return await transcribe(s, piece, { language: o.language, model: o.model || undefined, abortSignal: o.signal, maxRetries: 1 });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      throw new Error(describeError(e, s.apiKey).message);
    }
  };
  if (audio.size <= MAX_UPLOAD) {
    o.onPart?.(0, 1);
    const t = await call(audio);
    o.onPart?.(1, 1);
    return { segments: t.segments.map(({ start, end, text }) => ({ start, end, text })), language: t.language, duration: t.duration, engine };
  }
  o.onDecode?.();
  const samples = await decodeAudio(audio);
  const rate = SPEECH_SAMPLE_RATE;
  const cuts = planCuts(samples, rate, maxSecondsFor(MAX_UPLOAD, rate));
  const parts: { offset: number; segments: Segment[] }[] = [];
  let language: string | undefined;
  for (const [i, [a, b]] of cuts.entries()) {
    o.onPart?.(i, cuts.length);
    if (o.signal?.aborted) throw new DOMException("cancelled", "AbortError");
    const t = await call(new Blob([wav(samples.subarray(a, b), rate)], { type: "audio/wav" }));
    language ??= t.language;
    parts.push({ offset: a / rate, segments: t.segments });
  }
  o.onPart?.(cuts.length, cuts.length);
  return { segments: mergeParts(parts), language, duration: samples.length / rate, engine };
}
