// Speech for the Studio (audio summaries, podcasts, video narration): lines
// read by one or two voices, mixed with short pauses into one encoded file,
// with a cue per line. Which voices read a language is the user's choice in
// Settings → Voices: on this device (nothing leaves it) or the provider's
// speech model (the text goes to the provider).

import { loadLlm, recipient, savedSettings } from "../ai/llm.ts";
import { bytes, type T, tr } from "../i18n.ts";
import type { Progress } from "../studio/types.ts";
import { filesFor, totalBytes, voiceById } from "./catalog.ts";
import { deviceSpeak, downloadFiles } from "./device.ts";
import { openWriter } from "./encode.ts";
import { type Clip, type Cue, join, type Line, layout, MIX_RATE, PAUSE_SENTENCE, pauseBefore, resample, sentences, silence, trimSilence } from "./mix.ts";
import { missing, planFor, voicePrefs } from "./prefs.ts";
import { PROVIDER_VOICES, providerSpeak, speechTarget } from "./provider.ts";

export type { Cue, Line } from "./mix.ts";

export interface Spoken {
  audio: Blob;
  mime: string;
  /** Seconds. */
  duration: number;
  /** One per non-empty line, in order. */
  cues: Cue[];
}

export interface SpeakOptions {
  /** The language of the text ("fr"): it decides the voices. */
  language: string;
  signal?: AbortSignal;
  progress?: (p: Progress) => void;
}

/** What reading `speakers` voices in this language involves, for the notice shown before it starts; null when nothing leaves the device and nothing downloads. */
export function speechNotice(t: T, language: string, speakers = 1): string | null {
  const plan = planFor(language);
  if (plan.engine === "provider") {
    const to = recipient();
    return to ? t(`The script is read by ${to}'s voice model, which receives its text.`, `Le script est lu par le modèle de voix de ${to}, qui en reçoit le texte.`, `Das Skript wird vom Sprachmodell von ${to} gelesen, das seinen Text erhält.`) : null;
  }
  const need = missing(filesFor(plan.voices.slice(0, speakers)));
  if (!need.length) return t("The voices run on this device: the script does not leave it.", "Les voix tournent sur cet appareil : le script ne le quitte pas.", "Die Stimmen laufen auf diesem Gerät: Das Skript verlässt es nicht.");
  const size = bytes(totalBytes(need));
  return t(
    `The voices run on this device; they download once from Hugging Face (${size}).`,
    `Les voix tournent sur cet appareil ; elles se téléchargent une fois depuis Hugging Face (${size}).`,
    `Die Stimmen laufen auf diesem Gerät; sie werden einmalig von Hugging Face geladen (${size}).`,
  );
}

/** Why this language cannot be read now, or null. */
export function speechProblem(language: string): string | null {
  if (planFor(language).engine === "device") return null;
  const r = speechTarget(savedSettings(), voicePrefs().providerModel);
  return "problem" in r ? r.problem : null;
}

type Reader = (text: string, speaker: number, signal?: AbortSignal) => Promise<Clip>;

async function readerFor(o: SpeakOptions, speakers: number[]): Promise<Reader> {
  const prefs = voicePrefs();
  const plan = planFor(o.language, prefs);
  if (plan.engine === "device") {
    const voices = plan.voices.map((id) => voiceById(id)!);
    const used = [...new Set(speakers.map((s) => plan.voices[Math.min(s, 1)]!))];
    const need = missing(filesFor(used));
    if (need.length) {
      const total = totalBytes(need);
      await downloadFiles(need, {
        signal: o.signal,
        progress: (loaded) =>
          o.progress?.({
            ratio: loaded / total,
            label: tr(`Downloading the voices… ${bytes(loaded)} of ${bytes(total)}`, `Téléchargement des voix… ${bytes(loaded)} sur ${bytes(total)}`, `Stimmen werden geladen… ${bytes(loaded)} von ${bytes(total)}`),
          }),
      });
    }
    // One sentence at a time: Kokoro reads at most 510 phonemes, and short inputs keep the voices steady.
    return async (text, speaker, signal) => {
      const v = voices[Math.min(speaker, 1)]!;
      const clips: Clip[] = [];
      for (const s of sentences(text)) clips.push(trimSilence(await deviceSpeak(v, s, prefs.speed, signal)));
      return { samples: join(clips, MIX_RATE, PAUSE_SENTENCE), sampleRate: MIX_RATE };
    };
  }
  await loadLlm();
  const s = savedSettings();
  const r = speechTarget(s, prefs.providerModel);
  if ("problem" in r) throw new Error(r.problem);
  const defaults = PROVIDER_VOICES[r.target.sdk];
  const voices = [prefs.providerVoices[0] || defaults[0]!, prefs.providerVoices[1] || defaults[1]!];
  return async (text, speaker, signal) => trimSilence(await providerSpeak(s!, r.target, text, { voice: voices[Math.min(speaker, 1)]!, speed: prefs.speed, language: o.language, signal }));
}

/**
 * Read the lines aloud and mix them into one file: speaker 0 is the narrator
 * or first host, speaker 1 the second host. Pauses are short within a voice
 * and longer at a change of voice. The file is Opus in WebM, else AAC in M4A,
 * else WAV, whichever the browser can encode.
 */
export async function speak(lines: Line[], o: SpeakOptions): Promise<Spoken> {
  const todo = lines.map((l) => ({ speaker: l.speaker, text: l.text.trim() })).filter((l) => l.text);
  if (!todo.length) throw new Error(tr("There is nothing to read.", "Il n'y a rien à lire.", "Es gibt nichts zu lesen."));
  const read = await readerFor(o, todo.map((l) => l.speaker));
  const writer = await openWriter(MIX_RATE);
  const placed: { speaker: number; text: string; frames: number }[] = [];
  try {
    let previous: number | undefined;
    for (const [i, l] of todo.entries()) {
      o.signal?.throwIfAborted();
      o.progress?.({ ratio: i / todo.length, label: tr(`Reading line ${i + 1} of ${todo.length}…`, `Lecture de la ligne ${i + 1} sur ${todo.length}…`, `Zeile ${i + 1} von ${todo.length} wird gelesen…`) });
      const clip = await read(l.text, l.speaker, o.signal);
      const samples = resample(clip.samples, clip.sampleRate, MIX_RATE);
      const pause = pauseBefore(previous, l.speaker);
      if (pause) await writer.add(silence(pause));
      await writer.add(samples);
      placed.push({ ...l, frames: samples.length });
      previous = l.speaker;
    }
    o.progress?.({ ratio: 1, label: tr("Encoding…", "Encodage…", "Kodierung…") });
    const { blob, mime } = await writer.finish();
    const cues = layout(placed, MIX_RATE);
    return { audio: blob, mime, duration: cues.at(-1)?.end ?? 0, cues };
  } catch (e) {
    await writer.cancel().catch(() => {});
    throw e;
  }
}
