// Audio summaries: a script written for the ear from the sources, read by one
// voice (Settings → Voices), with the text following the voice. Exported as
// the audio file, the transcript in Markdown, and WebVTT subtitles.

import { useState } from "react";
import { z } from "zod";
import { budgetFor, buildContext } from "../ai/context.ts";
import { capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { trIn, useLang } from "../i18n.ts";
import { Icon } from "../ui/icons.tsx";
import { Field, Notice, slug } from "../ui/kit.tsx";
import type { Line } from "../voice/mix.ts";
import { speechNotice, speechProblem } from "../voice/speak.ts";
import { audioExport, isCurrent, type SpokenAudio, SpokenPlayer, SynthesizeBar, synthesize, vttExport } from "../voice/spoken.tsx";
import { kind, type OptionsProps, type ViewProps } from "./types.ts";

export type AudioLength = "short" | "medium" | "long";

export interface AudioOptions extends Record<string, unknown> {
  length: AudioLength;
  /** What to focus on, in the student's words. */
  focus: string;
}

export interface AudioData {
  paragraphs: string[];
  audio?: SpokenAudio;
}

/** About 150 spoken words a minute. */
export const AUDIO_WORDS: Record<AudioLength, number> = { short: 300, medium: 500, long: 750 };

export const audioScript = z.object({
  title: z.string().trim().min(1).max(160),
  paragraphs: z
    .array(z.string())
    .transform((ps) => ps.map((p) => p.replace(/\s*\[S\d+[^\]]*\]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean))
    .pipe(z.array(z.string()).min(1)),
});

export const audioLines = (d: AudioData): Line[] => d.paragraphs.map((text) => ({ speaker: 0, text }));

function Options({ value, onChange }: OptionsProps<AudioOptions>) {
  const { t } = useLang();
  return (
    <div className="stack">
      <Field label={t("Length", "Durée", "Länge")}>
        <select value={value.length} onChange={(e) => onChange({ ...value, length: e.currentTarget.value as AudioLength })}>
          <option value="short">{t("About 2 minutes", "Environ 2 minutes", "Etwa 2 Minuten")}</option>
          <option value="medium">{t("About 3 to 4 minutes", "Environ 3 à 4 minutes", "Etwa 3 bis 4 Minuten")}</option>
          <option value="long">{t("About 5 minutes", "Environ 5 minutes", "Etwa 5 Minuten")}</option>
        </select>
      </Field>
      <Field label={t("Focus (optional)", "Angle (facultatif)", "Schwerpunkt (optional)")}>
        <input value={value.focus} onChange={(e) => onChange({ ...value, focus: e.currentTarget.value })} placeholder={t("e.g. what to know for the exam", "ex. ce qu'il faut savoir pour l'examen", "z. B. was man für die Prüfung wissen muss")} />
      </Field>
    </div>
  );
}

function View({ artifact, onChange }: ViewProps<AudioData>) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(artifact.data.paragraphs.join("\n\n"));
  const lines = audioLines(artifact.data);
  const current = isCurrent(artifact.data.audio, lines);
  if (editing)
    return (
      <div className="stack">
        <textarea rows={20} value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label={t("Script", "Script", "Skript")} />
        <p className="meta">{t("One paragraph per block, separated by a blank line. Save, then synthesize again.", "Un paragraphe par bloc, séparés par une ligne vide. Enregistrez, puis synthétisez à nouveau.", "Ein Absatz pro Block, durch eine Leerzeile getrennt. Speichern Sie und synthetisieren Sie dann neu.")}</p>
        <div className="row end">
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            {t("Cancel", "Annuler", "Abbrechen")}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onChange({ ...artifact.data, paragraphs: text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean) });
              setEditing(false);
            }}
          >
            {t("Save", "Enregistrer", "Speichern")}
          </button>
        </div>
      </div>
    );
  return (
    <div className="stack">
      <div className="row no-print">
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setText(artifact.data.paragraphs.join("\n\n"));
            setEditing(true);
          }}
        >
          <Icon name="edit" size={18} /> {t("Edit the script", "Modifier le script", "Skript bearbeiten")}
        </button>
      </div>
      {artifact.data.audio && !current ? <Notice>{t("The script changed since the audio was made.", "Le script a changé depuis la création de l'audio.", "Das Skript wurde seit der Erstellung des Audios geändert.")}</Notice> : null}
      {!current ? <SynthesizeBar artifact={artifact} lines={lines} speakers={1} /> : null}
      {artifact.data.audio && current ? (
        <SpokenPlayer blobId={artifact.media?.audio} audio={artifact.data.audio} />
      ) : (
        <div className="prose">
          {artifact.data.paragraphs.map((p, i) => (
            <p key={`${i}-${p.slice(0, 16)}`}>{p}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export const audio = kind<AudioData, AudioOptions>({
  type: "audio",
  icon: "headphones",
  label: (t) => t("Audio summary", "Résumé audio", "Audio-Zusammenfassung"),
  blurb: (t) => t("A spoken summary of 2 to 5 minutes, to listen to anywhere", "Un résumé parlé de 2 à 5 minutes, à écouter partout", "Eine gesprochene Zusammenfassung von 2 bis 5 Minuten, überall zu hören"),
  defaults: { length: "medium", focus: "" },
  Options,
  problem: (_t, language) => speechProblem(language),
  sends: (t, _o, language) => speechNotice(t, language, 1),
  async generate(ctx, o) {
    ctx.progress({ label: trIn(ctx.language)("Writing the script…", "Écriture du script…", "Das Skript wird geschrieben…") });
    const context = buildContext(ctx.sources, { query: o.focus || undefined, budget: budgetFor(capabilities().contextWindow) });
    const script = await askJson(audioScript, {
      system: `You write the script of a spoken summary of a university student's course, from their own sources, to be read aloud by one voice. Write for the ear: short sentences, plain spoken ${writeIn(ctx.language)}, no lists, no headings, no Markdown, no citation labels, no symbols or formulas a voice cannot read (say them in words). Open with what it is about in one or two sentences, go through the key ideas in a clear order with a transition between them, and end with a short recap of what to remember. About ${AUDIO_WORDS[o.length]} words in all, in paragraphs of two to five sentences. Only what the sources support.`,
      prompt: `${o.focus ? `Focus on: ${o.focus}\n\n` : ""}${context.text}`,
      shape: '{ "title": "a short title", "paragraphs": ["paragraph read aloud", "..."] }',
      signal: ctx.signal,
    });
    const data: AudioData = { paragraphs: script.paragraphs };
    const { audio, blob } = await synthesize(audioLines(data), { language: ctx.language, signal: ctx.signal, progress: ctx.progress });
    return { title: script.title, data: { ...data, audio }, media: { audio: blob } };
  },
  View,
  exports: [
    { id: "audio", label: (t) => t("Audio file", "Fichier audio", "Audiodatei"), run: (a) => audioExport(a) },
    {
      id: "md",
      label: (t) => t("Transcript (Markdown)", "Transcription (Markdown)", "Transkript (Markdown)"),
      run: async (a) => ({ blob: new Blob([`# ${a.title}\n\n${a.data.paragraphs.join("\n\n")}\n`], { type: "text/markdown" }), filename: `${slug(a.title)}.md` }),
    },
    { id: "vtt", label: (t) => t("Subtitles (VTT)", "Sous-titres (VTT)", "Untertitel (VTT)"), run: async (a) => vttExport(a) },
  ],
});
