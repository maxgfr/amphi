// Podcasts: two hosts talk the sources through, as a lecture, a debate or a
// quick review. Made in two steps: the script is written first and shown for
// review (the artifact is ready with its script and no audio), then the
// student synthesizes it from the artifact's screen, and again after editing
// it. Splitting the work this way keeps the Studio's one-shot generation
// contract: the slow, possibly downloading step only runs on a script the
// student accepted. Chapters are the script's sections.

import { useEffect, useState } from "react";
import { z } from "zod";
import { budgetFor, buildContext } from "../ai/context.ts";
import { capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { type T, trIn, useLang } from "../i18n.ts";
import { Icon } from "../ui/icons.tsx";
import { Field, Notice, slug } from "../ui/kit.tsx";
import type { Line } from "../voice/mix.ts";
import { audioExport, type Chapter, isCurrent, type SpokenAudio, SpokenPlayer, SynthesizeBar, useSynthesis, vttExport } from "../voice/spoken.tsx";
import { kind, type OptionsProps, type ViewProps } from "./types.ts";

export const TONES = ["lecture", "debate", "review"] as const;
export type Tone = (typeof TONES)[number];
export const MINUTES = [5, 10, 20] as const;
export type Minutes = (typeof MINUTES)[number];

export interface PodcastOptions extends Record<string, unknown> {
  tone: Tone;
  minutes: Minutes;
  focus: string;
}

export interface Turn {
  /** 0 for the first host, 1 for the second. */
  speaker: number;
  text: string;
}

export interface Section {
  title: string;
  turns: Turn[];
}

export interface PodcastData {
  tone: Tone;
  minutes: Minutes;
  hosts: [string, string];
  sections: Section[];
  audio?: SpokenAudio;
}

export const toneLabel = (tone: Tone, t: T) =>
  ({
    lecture: t("Lecture: one explains, the other asks", "Cours : l'un explique, l'autre questionne", "Vorlesung: einer erklärt, der andere fragt"),
    debate: t("Debate: two points of view", "Débat : deux points de vue", "Debatte: zwei Standpunkte"),
    review: t("Quick review before the exam", "Révision express avant l'examen", "Schnelle Wiederholung vor der Prüfung"),
  })[tone];

const TONE_PROMPT: Record<Tone, string> = {
  lecture: "Host 1 knows the material and explains it; host 2 is a curious student who asks the questions a learner would, rephrases, and asks for examples.",
  debate: "The hosts discuss the material from two points of view, weigh the arguments and the evidence in the sources, push back on each other politely, and end on what is settled and what is open.",
  review: "A brisk review before an exam: the hosts go through the key points, definitions and classic pitfalls, quizzing each other with short questions and quick answers.",
};

const spokenText = (s: string) =>
  s
    .replace(/\s*\[S\d+[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** What the model answers: hosts numbered 1 and 2, as people read them; empty turns and sections dropped. */
export const podcastScript = z
  .object({
    title: z.string().trim().min(1).max(160),
    hosts: z.tuple([z.string().trim().min(1).max(40), z.string().trim().min(1).max(40)]),
    sections: z.array(
      z.object({
        title: z.string().trim().max(120),
        turns: z.array(z.object({ host: z.union([z.literal(1), z.literal(2), z.literal("1"), z.literal("2")]), text: z.string() })),
      }),
    ),
  })
  .transform((s) => ({
    title: s.title,
    hosts: s.hosts,
    sections: s.sections.map((x) => ({ title: x.title, turns: x.turns.map((u) => ({ speaker: Number(u.host) - 1, text: spokenText(u.text) })).filter((u) => u.text) })).filter((x) => x.turns.length),
  }))
  .refine((s) => s.sections.length > 0, { message: "the script needs at least one section with turns" });

/** The script as lines to read, and where each section starts among them. */
export function podcastLines(d: Pick<PodcastData, "sections">): { lines: Line[]; chapters: Chapter[] } {
  const lines: Line[] = [];
  const chapters: Chapter[] = [];
  for (const s of d.sections) {
    const first = lines.length;
    for (const u of s.turns) if (u.text.trim()) lines.push({ speaker: u.speaker, text: u.text });
    if (lines.length > first) chapters.push({ title: s.title, cue: first });
  }
  return { lines, chapters };
}

export function podcastMarkdown(title: string, d: PodcastData): string {
  const body = d.sections.map((s) => `## ${s.title}\n\n${s.turns.map((u) => `**${d.hosts[u.speaker] ?? d.hosts[0]}:** ${u.text}`).join("\n\n")}`).join("\n\n");
  return `# ${title}\n\n${body}\n`;
}

function Options({ value, onChange }: OptionsProps<PodcastOptions>) {
  const { t } = useLang();
  return (
    <div className="stack">
      <Field label={t("Tone", "Ton", "Ton")}>
        <select value={value.tone} onChange={(e) => onChange({ ...value, tone: e.currentTarget.value as Tone })}>
          {TONES.map((x) => (
            <option key={x} value={x}>
              {toneLabel(x, t)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Length", "Durée", "Länge")}>
        <select value={value.minutes} onChange={(e) => onChange({ ...value, minutes: Number(e.currentTarget.value) as Minutes })}>
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {t(`About ${m} minutes`, `Environ ${m} minutes`, `Etwa ${m} Minuten`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("Focus (optional)", "Angle (facultatif)", "Schwerpunkt (optional)")}>
        <input value={value.focus} onChange={(e) => onChange({ ...value, focus: e.currentTarget.value })} placeholder={t("e.g. the second law", "ex. le deuxième principe", "z. B. der zweite Hauptsatz")} />
      </Field>
    </div>
  );
}

/** The script, editable turn by turn; saved when a field is left. */
function ScriptEditor({ draft, setDraft, save }: { draft: PodcastData; setDraft: (d: PodcastData) => void; save: (d: PodcastData) => void }) {
  const { t } = useLang();
  const setTurn = (si: number, ti: number, patch: Partial<Turn> | null) => {
    const sections = draft.sections.map((s, i) => (i !== si ? s : { ...s, turns: patch ? s.turns.map((u, j) => (j === ti ? { ...u, ...patch } : u)) : s.turns.filter((_, j) => j !== ti) }));
    return { ...draft, sections };
  };
  return (
    <div className="stack">
      <div className="row wrap">
        {draft.hosts.map((h, i) => (
          <Field key={i} label={i === 0 ? t("First host", "Premier animateur", "Erster Moderator") : t("Second host", "Second animateur", "Zweiter Moderator")}>
            <input value={h} onChange={(e) => setDraft({ ...draft, hosts: (i === 0 ? [e.currentTarget.value, draft.hosts[1]] : [draft.hosts[0], e.currentTarget.value]) as [string, string] })} onBlur={() => save(draft)} />
          </Field>
        ))}
      </div>
      {draft.sections.map((s, si) => (
        <section key={si} className="stack script-section">
          <input
            className="script-title"
            aria-label={t(`Section ${si + 1} title`, `Titre de la section ${si + 1}`, `Titel von Abschnitt ${si + 1}`)}
            value={s.title}
            onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((x, i) => (i === si ? { ...x, title: e.currentTarget.value } : x)) })}
            onBlur={() => save(draft)}
          />
          {s.turns.map((u, ti) => (
            <div key={ti} className="script-turn">
              <select aria-label={t("Who speaks", "Qui parle", "Wer spricht")} value={u.speaker} onChange={(e) => save(setTurn(si, ti, { speaker: Number(e.currentTarget.value) }))}>
                <option value={0}>{draft.hosts[0]}</option>
                <option value={1}>{draft.hosts[1]}</option>
              </select>
              <textarea rows={Math.min(8, Math.max(2, Math.ceil(u.text.length / 90)))} aria-label={t(`Line by ${draft.hosts[u.speaker]}`, `Réplique de ${draft.hosts[u.speaker]}`, `Beitrag von ${draft.hosts[u.speaker]}`)} value={u.text} onChange={(e) => setDraft(setTurn(si, ti, { text: e.currentTarget.value }))} onBlur={() => save(draft)} />
              <button type="button" className="icon-button" aria-label={t("Remove this line", "Supprimer cette réplique", "Diesen Beitrag entfernen")} onClick={() => save(setTurn(si, ti, null))}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function View({ artifact, onChange }: ViewProps<PodcastData>) {
  const { t } = useLang();
  const data = artifact.data;
  // Edits are kept here until a field is left, and synthesis reads them even if not saved yet.
  const [draft, setDraft] = useState(data);
  useEffect(() => {
    setDraft(data);
  }, [data]);
  const save = (d: PodcastData) => {
    setDraft(d);
    onChange(d);
  };
  const { lines, chapters } = podcastLines(draft);
  const current = isCurrent(data.audio, lines);
  const job = useSynthesis(artifact.id);
  const [editing, setEditing] = useState(!data.audio);
  useEffect(() => {
    // A fresh audio opens on the player.
    if (current && !job) setEditing(false);
  }, [current, job]);
  const names = draft.hosts;
  return (
    <div className="stack">
      <p className="meta">
        {toneLabel(data.tone, t)} · {t(`about ${data.minutes} minutes`, `environ ${data.minutes} minutes`, `etwa ${data.minutes} Minuten`)} · {names.join(" & ")}
      </p>
      {!data.audio ? <Notice>{t("Read the script through and change what you like, then synthesize it.", "Relisez le script et modifiez ce que vous voulez, puis synthétisez-le.", "Lesen Sie das Skript, ändern Sie, was Sie möchten, und synthetisieren Sie es dann.")}</Notice> : null}
      {data.audio && !current ? <Notice>{t("The script changed since the audio was made.", "Le script a changé depuis la création de l'audio.", "Das Skript wurde seit der Erstellung des Audios geändert.")}</Notice> : null}
      {!current ? <SynthesizeBar artifact={artifact} lines={lines} speakers={2} onBefore={() => save(draft)} /> : null}
      {data.audio ? (
        <div className="row no-print">
          <button type="button" className="secondary" aria-pressed={editing} onClick={() => setEditing(!editing)}>
            <Icon name={editing ? "headphones" : "edit"} size={18} /> {editing ? t("Back to the player", "Revenir au lecteur", "Zurück zum Player") : t("Edit the script", "Modifier le script", "Skript bearbeiten")}
          </button>
        </div>
      ) : null}
      {editing || !data.audio ? <ScriptEditor draft={draft} setDraft={setDraft} save={save} /> : <SpokenPlayer blobId={artifact.media?.audio} audio={data.audio} names={names} chapters={current ? chapters : undefined} />}
    </div>
  );
}

const WORDS_PER_MINUTE = 150;

export const podcast = kind<PodcastData, PodcastOptions>({
  type: "podcast",
  icon: "podcast",
  label: (t) => t("Podcast", "Podcast", "Podcast"),
  blurb: (t) => t("Two hosts talk your course through: lecture, debate or quick review", "Deux voix discutent de votre cours : cours, débat ou révision express", "Zwei Stimmen besprechen Ihren Kurs: Vorlesung, Debatte oder schnelle Wiederholung"),
  defaults: { tone: "lecture", minutes: 10, focus: "" },
  Options,
  sends: (t) => t("The script is shown to you before any voice reads it.", "Le script vous est montré avant qu'une voix ne le lise.", "Das Skript wird Ihnen gezeigt, bevor eine Stimme es liest."),
  async generate(ctx, o) {
    ctx.progress({ label: trIn(ctx.language)("Writing the script…", "Écriture du script…", "Das Skript wird geschrieben…") });
    const context = buildContext(ctx.sources, { query: o.focus || undefined, budget: budgetFor(capabilities().contextWindow) });
    const words = o.minutes * WORDS_PER_MINUTE;
    const script = await askJson(podcastScript, {
      system: `You write the script of a podcast in which two hosts talk through a university student's course, from the student's own sources. ${TONE_PROMPT[o.tone]} Give the hosts first names that suit ${writeIn(ctx.language)} speakers. Write in ${writeIn(ctx.language)}, as people speak: short sentences, natural reactions, no lists, no Markdown, no citation labels, no symbols or formulas a voice cannot read (say them in words). Turns are one to four sentences and alternate between the hosts. Organise the episode in three to eight sections with short titles (an opening, the topics, a closing recap). About ${words} words in all. Only what the sources support.`,
      prompt: `${o.focus ? `Focus on: ${o.focus}\n\n` : ""}${context.text}`,
      shape: '{ "title": "episode title", "hosts": ["first host name", "second host name"], "sections": [{ "title": "section title", "turns": [{ "host": 1, "text": "what host 1 says" }, { "host": 2, "text": "..." }] }] }',
      maxOutputTokens: Math.max(4000, Math.round(words * 3)),
      signal: ctx.signal,
    });
    return { title: script.title, data: { tone: o.tone, minutes: o.minutes, hosts: script.hosts, sections: script.sections } };
  },
  View,
  exports: [
    { id: "audio", label: (t) => t("Audio file", "Fichier audio", "Audiodatei"), run: (a) => audioExport(a) },
    {
      id: "md",
      label: (t) => t("Script (Markdown)", "Script (Markdown)", "Skript (Markdown)"),
      run: async (a) => ({ blob: new Blob([podcastMarkdown(a.title, a.data)], { type: "text/markdown" }), filename: `${slug(a.title)}.md` }),
    },
    { id: "vtt", label: (t) => t("Subtitles (VTT)", "Sous-titres (VTT)", "Untertitel (VTT)"), run: async (a) => vttExport(a, a.data.hosts) },
  ],
});
