// What the audio summary and the podcast share: the audio they keep, its
// synthesis from the artifact's screen (it goes on when the screen is left),
// and the player whose text follows the voice.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { get, getBlob, putBlob, update } from "../data/db.ts";
import { useBlobUrl } from "../data/hooks.ts";
import type { Artifact, Id } from "../data/schema.ts";
import { clock, tr, useLang } from "../i18n.ts";
import type { ExportFile, Progress } from "../studio/types.ts";
import { Icon } from "../ui/icons.tsx";
import { Notice, ProgressBar, slug } from "../ui/kit.tsx";
import { extensionOf } from "./encode.ts";
import { type Cue, fingerprint, type Line, toVtt } from "./mix.ts";
import { speak, speechNotice, speechProblem } from "./speak.ts";

/** The audio of an artifact: the file is `artifact.media.audio`. */
export interface SpokenAudio {
  mime: string;
  duration: number;
  cues: Cue[];
  /** Fingerprint of the lines it was read from: when the script changes, the audio is out of date. */
  of: string;
}

export const isCurrent = (audio: SpokenAudio | undefined, lines: Line[]) => Boolean(audio && audio.of === fingerprint(lines.filter((l) => l.text.trim())));

/** Read the lines; the result to keep in the artifact. */
export async function synthesize(lines: Line[], o: { language: string; signal?: AbortSignal; progress?: (p: Progress) => void }): Promise<{ audio: SpokenAudio; blob: Blob }> {
  const spoken = await speak(lines, o);
  return { audio: { mime: spoken.mime, duration: spoken.duration, cues: spoken.cues, of: fingerprint(lines.filter((l) => l.text.trim())) }, blob: spoken.audio };
}

// Synthesis started from an artifact's screen, kept here so it survives leaving it.
interface Job {
  progress: Progress;
  abort: AbortController;
  error?: string;
}
const jobs = new Map<Id, Job>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const fn of listeners) fn();
};

export function useSynthesis(id: Id): Job | undefined {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return jobs.get(id);
}

/** Read the artifact's lines in the background and store the audio with it. */
export function startSynthesis(artifact: Artifact<{ audio?: SpokenAudio }>, lines: Line[]) {
  const running = jobs.get(artifact.id);
  if (running && !running.error) return;
  const job: Job = { progress: {}, abort: new AbortController() };
  jobs.set(artifact.id, job);
  emit();
  void (async () => {
    try {
      const { audio, blob } = await synthesize(lines, {
        language: artifact.language ?? "en",
        signal: job.abort.signal,
        progress: (p) => {
          job.progress = p;
          emit();
        },
      });
      const blobId = await putBlob(blob, audio.mime);
      const cur = (await get("artifacts", artifact.id)) as Artifact<{ audio?: SpokenAudio }> | undefined;
      if (cur) await update("artifacts", artifact.id, { data: { ...cur.data, audio }, media: { ...cur.media, audio: blobId } });
      jobs.delete(artifact.id);
    } catch (e) {
      if (job.abort.signal.aborted) jobs.delete(artifact.id);
      else job.error = e instanceof Error ? e.message : String(e);
    }
    emit();
  })();
}

/** The notice, the button and the progress of a synthesis. */
export function SynthesizeBar({ artifact, lines, speakers, onBefore }: { artifact: Artifact<{ audio?: SpokenAudio }>; lines: Line[]; speakers: number; onBefore?: () => void }) {
  const { t } = useLang();
  const job = useSynthesis(artifact.id);
  const language = artifact.language ?? "en";
  const problem = speechProblem(language);
  const notice = speechNotice(t, language, speakers);
  if (job && !job.error)
    return (
      <div className="stack no-print">
        <ProgressBar ratio={job.progress.ratio} label={job.progress.label || t("Synthesizing…", "Synthèse…", "Synthese…")} />
        <p className="meta" role="status">
          {job.progress.label || t("Synthesizing…", "Synthèse…", "Synthese…")}
        </p>
        <div className="row">
          <button type="button" className="secondary" onClick={() => job.abort.abort()}>
            {t("Cancel", "Annuler", "Abbrechen")}
          </button>
        </div>
      </div>
    );
  return (
    <div className="stack no-print">
      {notice ? <Notice>{notice}</Notice> : null}
      {problem ? <Notice kind="error">{problem}</Notice> : null}
      {job?.error ? <Notice kind="error">{job.error}</Notice> : null}
      <div className="row">
        <button
          type="button"
          className="primary"
          disabled={Boolean(problem) || !lines.some((l) => l.text.trim())}
          onClick={() => {
            onBefore?.();
            startSynthesis(artifact, lines);
          }}
        >
          <Icon name="headphones" size={18} /> {artifact.data.audio ? t("Synthesize again", "Synthétiser à nouveau", "Neu synthetisieren") : t("Synthesize", "Synthétiser", "Synthetisieren")}
        </button>
      </div>
    </div>
  );
}

export interface Chapter {
  title: string;
  /** Index of its first cue. */
  cue: number;
}

/** The audio, chapters to jump to, and the text with the line being read highlighted (click a line to hear it). */
export function SpokenPlayer({ blobId, audio, names, chapters }: { blobId?: Id; audio: SpokenAudio; names?: string[]; chapters?: Chapter[] }) {
  const { t } = useLang();
  const url = useBlobUrl(blobId);
  const media = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const current = audio.cues.findLastIndex((c) => now >= c.start);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = list.current?.querySelector(`[data-cue="${current}"]`);
    if (el && media.current && !media.current.paused) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current]);
  const seek = (s: number) => {
    const m = media.current;
    if (!m) return;
    m.currentTime = s;
    setNow(s);
    void m.play().catch(() => {});
  };
  return (
    <div className="stack">
      {url ? <audio ref={media} className="player" src={url} controls preload="metadata" aria-label={t("Audio", "Audio", "Audio")} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} onSeeked={(e) => setNow(e.currentTarget.currentTime)} /> : null}
      <p className="meta">
        {clock(audio.duration)} · {audio.mime.split(";")[0]}
      </p>
      {chapters?.length ? (
        <nav className="row wrap no-print" aria-label={t("Chapters", "Chapitres", "Kapitel")}>
          {chapters.map((c) => (
            <button key={c.cue} type="button" className="chip" onClick={() => seek(audio.cues[c.cue]?.start ?? 0)}>
              {clock(audio.cues[c.cue]?.start ?? 0)} {c.title}
            </button>
          ))}
        </nav>
      ) : null}
      <ol className="transcript" ref={list} aria-label={t("Text", "Texte", "Text")}>
        {audio.cues.map((c, i) => (
          <li key={`${i}-${c.start}`} data-cue={i} className={i === current ? "active" : undefined} aria-current={i === current ? "true" : undefined}>
            <button type="button" className="time" onClick={() => seek(c.start)} aria-label={t(`Play from ${clock(c.start)}`, `Lire depuis ${clock(c.start)}`, `Ab ${clock(c.start)} abspielen`)}>
              {clock(c.start)}
            </button>
            <span>
              {names?.[c.speaker] ? <strong>{names[c.speaker]}: </strong> : null}
              {c.text}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const noAudio = () => new Error(tr("Synthesize the audio first.", "Synthétisez d'abord l'audio.", "Synthetisieren Sie zuerst das Audio."));

/** The exports both types share: the audio file and WebVTT subtitles. */
export const audioExport = (artifact: Artifact<{ audio?: SpokenAudio }>): Promise<ExportFile> =>
  (async () => {
    const id = artifact.media?.audio;
    const blob = id ? (await getBlob(id))?.data : undefined;
    if (!blob || !artifact.data.audio) throw noAudio();
    return { blob, filename: `${slug(artifact.title)}.${extensionOf(artifact.data.audio.mime)}` };
  })();

export function vttExport(artifact: Artifact<{ audio?: SpokenAudio }>, names?: string[]): ExportFile {
  if (!artifact.data.audio) throw noAudio();
  return { blob: new Blob([toVtt(artifact.data.audio.cues, names)], { type: "text/vtt" }), filename: `${slug(artifact.title)}.vtt` };
}
