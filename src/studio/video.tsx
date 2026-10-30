// Video summaries: a storyboard of scenes drawn like slides, each with what a
// narrator says over it. Made in two steps like the podcast: the storyboard
// is written first and shown for review and editing, then the student
// renders it from the artifact's screen: the narration is read by the voice
// chosen for the language, its cues time the scenes, and the scenes are
// drawn on a canvas and encoded with the narration into an MP4 or WebM file
// with subtitles. A browser that cannot encode video plays the same
// narrated slideshow live instead.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { budgetFor, buildContext, CITE_RULE } from "../ai/context.ts";
import { capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { get, getBlob, putBlob, update } from "../data/db.ts";
import { useBlobUrl } from "../data/hooks.ts";
import type { Artifact, Id } from "../data/schema.ts";
import { clock, tr, useLang } from "../i18n.ts";
import { openCitation } from "../ui/cite.ts";
import { Icon } from "../ui/icons.tsx";
import { Field, Notice, ProgressBar, slug } from "../ui/kit.tsx";
import { type Cue, toVtt } from "../voice/mix.ts";
import { speak, speechNotice, speechProblem } from "../voice/speak.ts";
import { emptySlide } from "./deck.ts";
import { SceneSvg } from "./render/scene.tsx";
import { revealed, slideScene } from "./render/slide-layout.ts";
import { SlideEditor, tidy } from "./slides.tsx";
import type { Progress } from "./types.ts";
import { kind, type OptionsProps, type ViewProps } from "./types.ts";
import { frameAt, MAX_SCENES, narrationLines, sceneTimeline, STORYBOARD_SHAPE, StoryboardAnswer, storyboardMarkdown, storyboardPrint, subtitleCues, type VideoScene, voiced } from "./video-core.ts";
import { encodeVideo, videoExtension, videoFormat } from "./video-render.ts";

export type VideoLength = "short" | "medium" | "long";

export interface VideoOptions extends Record<string, unknown> {
  length: VideoLength;
  focus: string;
}

/** What a render made: the narration is `artifact.media.audio`, the video (when the browser could encode one) `artifact.media.video`. */
export interface VideoRender {
  /** Fingerprint of the storyboard it was made from. */
  of: string;
  /** Seconds. */
  duration: number;
  /** One per voiced scene, in order. */
  cues: Cue[];
  audioMime: string;
  videoMime?: string;
  /** Why there is no video file (the browser cannot encode video). */
  problem?: string;
}

export interface VideoData {
  scenes: VideoScene[];
  render?: VideoRender;
}

const SCENES: Record<VideoLength, string> = { short: "5 or 6 scenes, about 2 minutes", medium: "7 to 9 scenes, about 3 to 4 minutes", long: "10 to 12 scenes, about 5 minutes" };

// Renders started from an artifact's screen, kept here so they go on when it is left.
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

function useRender(id: Id): Job | undefined {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
  return jobs.get(id);
}

/** Read the narration, encode the video when the browser can, and keep both with the artifact. */
export function startRender(artifact: Artifact<VideoData>, scenes: VideoScene[]) {
  const running = jobs.get(artifact.id);
  if (running && !running.error) return;
  const job: Job = { progress: {}, abort: new AbortController() };
  jobs.set(artifact.id, job);
  emit();
  const report = (base: number, share: number) => (p: Progress) => {
    job.progress = { ratio: base + (p.ratio ?? 0) * share, label: p.label };
    emit();
  };
  void (async () => {
    try {
      const shown = voiced(scenes).map(tidy);
      const spoken = await speak(narrationLines(scenes), { language: artifact.language ?? "en", signal: job.abort.signal, progress: report(0, 0.5) });
      const { spans, duration } = sceneTimeline(spoken.cues);
      const format = await videoFormat();
      const made =
        "problem" in format
          ? null
          : await encodeVideo({ scenes: shown.map((s) => slideScene(s, { number: false })), spans, duration, narration: spoken.audio, format, signal: job.abort.signal, progress: report(0.5, 0.5) });
      const audio = await putBlob(spoken.audio, spoken.mime);
      const video = made ? await putBlob(made.blob, made.mime) : undefined;
      const cur = (await get("artifacts", artifact.id)) as Artifact<VideoData> | undefined;
      if (cur) {
        const { video: _old, ...media } = cur.media ?? {};
        const render: VideoRender = { of: storyboardPrint(scenes), duration, cues: spoken.cues, audioMime: spoken.mime, ...(made ? { videoMime: made.mime } : { problem: "problem" in format ? format.problem : undefined }) };
        await update("artifacts", artifact.id, { data: { ...cur.data, render }, media: { ...media, audio, ...(video ? { video } : {}) } });
      }
      jobs.delete(artifact.id);
    } catch (e) {
      if (job.abort.signal.aborted) jobs.delete(artifact.id);
      else job.error = e instanceof Error ? e.message : String(e);
    }
    emit();
  })();
}

function RenderBar({ artifact, scenes, onBefore }: { artifact: Artifact<VideoData>; scenes: VideoScene[]; onBefore: () => void }) {
  const { t } = useLang();
  const job = useRender(artifact.id);
  const language = artifact.language ?? "en";
  const problem = speechProblem(language);
  const notice = speechNotice(t, language, 1);
  if (job && !job.error)
    return (
      <div className="stack no-print">
        <ProgressBar ratio={job.progress.ratio} label={job.progress.label || t("Rendering…", "Rendu…", "Wird gerendert…")} />
        <p className="meta" role="status">
          {job.progress.label || t("Rendering…", "Rendu…", "Wird gerendert…")}
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
          disabled={Boolean(problem) || !voiced(scenes).length}
          onClick={() => {
            onBefore();
            startRender(artifact, scenes);
          }}
        >
          <Icon name="video" size={18} /> {artifact.data.render ? t("Render again", "Refaire le rendu", "Neu rendern") : t("Render the video", "Faire le rendu de la vidéo", "Video rendern")}
        </button>
      </div>
    </div>
  );
}

/** Subtitles as a blob URL for the <track>, revoked when no longer shown. */
function useVttUrl(cues: Cue[] | undefined): string | undefined {
  const url = useMemo(() => (cues ? URL.createObjectURL(new Blob([toVtt(subtitleCues(cues))], { type: "text/vtt" })) : undefined), [cues]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);
  return url;
}

/** The scenes as chapters: where each starts, the one on screen marked. */
function Chapters({ scenes, starts, current, seek }: { scenes: VideoScene[]; starts: number[]; current: number; seek: (s: number) => void }) {
  const { t } = useLang();
  return (
    <ol className="transcript" aria-label={t("Scenes", "Scènes", "Szenen")}>
      {starts.map((s, i) => (
        <li key={`${i}-${s}`} className={i === current ? "active" : undefined} aria-current={i === current ? "true" : undefined}>
          <button type="button" className="time" onClick={() => seek(s)} aria-label={t(`Play from ${clock(s)}`, `Lire depuis ${clock(s)}`, `Ab ${clock(s)} abspielen`)}>
            {clock(s)}
          </button>
          <span>
            <strong>{scenes[i]?.title}</strong> {scenes[i]?.narration}
          </span>
        </li>
      ))}
    </ol>
  );
}

function VideoPlayer({ artifact, scenes }: { artifact: Artifact<VideoData>; scenes: VideoScene[] }) {
  const { t } = useLang();
  const render = artifact.data.render!;
  const url = useBlobUrl(artifact.media?.video);
  const vtt = useVttUrl(render.cues);
  const media = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const { spans } = useMemo(() => sceneTimeline(render.cues), [render.cues]);
  const seek = (s: number) => {
    const m = media.current;
    if (!m) return;
    m.currentTime = s;
    setNow(s);
    void m.play().catch(() => {});
  };
  return (
    <div className="stack">
      {url ? (
        <video ref={media} className="player video" src={url} controls preload="metadata" aria-label={t("Video", "Vidéo", "Video")} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} onSeeked={(e) => setNow(e.currentTarget.currentTime)}>
          {vtt ? <track kind="captions" src={vtt} srcLang={artifact.language ?? "en"} label={t("Subtitles", "Sous-titres", "Untertitel")} default /> : null}
        </video>
      ) : null}
      <p className="meta">
        {clock(render.duration)} · {render.videoMime?.split(";")[0]}
      </p>
      <Chapters scenes={voiced(scenes)} starts={spans.map((s) => s.start)} current={spans.findLastIndex((s) => now >= s.start)} seek={seek} />
    </div>
  );
}

/** Without a video file: the narration plays and the scenes follow it, drawn in the page. */
function LiveShow({ artifact, scenes }: { artifact: Artifact<VideoData>; scenes: VideoScene[] }) {
  const { t } = useLang();
  const render = artifact.data.render!;
  const url = useBlobUrl(artifact.media?.audio);
  const media = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  const shown = useMemo(() => voiced(scenes).map((s) => slideScene(tidy(s), { number: false })), [scenes]);
  const { spans } = useMemo(() => sceneTimeline(render.cues), [render.cues]);
  const subtitles = useMemo(() => subtitleCues(render.cues), [render.cues]);
  useEffect(() => {
    // Time updates come four times a second; follow the voice more closely while it plays.
    let frame = 0;
    const tick = () => {
      const m = media.current;
      if (m && !m.paused) setNow(m.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const f = frameAt(now, spans, shown.map((s) => s.steps));
  const scene = shown[Math.min(f.scene, shown.length - 1)];
  const steps = scene ? Array.from({ length: scene.steps }, (_, k) => k + 1).filter((k) => f.reveal(k) > 0).length : 0;
  const caption = subtitles.findLast((c) => now >= c.start && now < c.end + 0.3)?.text ?? "";
  const seek = (s: number) => {
    const m = media.current;
    if (!m) return;
    m.currentTime = s;
    setNow(s);
    void m.play().catch(() => {});
  };
  return (
    <div className="stack">
      {render.problem ? <Notice>{render.problem}</Notice> : null}
      {scene ? (
        <div className="slide-frame live-show">
          <SceneSvg scene={revealed(scene, steps)} onCite={(l) => openCitation(l, artifact.sourceIds)} />
          <p className="live-caption">{caption}</p>
        </div>
      ) : null}
      {url ? <audio ref={media} className="player" src={url} controls preload="metadata" aria-label={t("Narration", "Narration", "Erzählung")} onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} onSeeked={(e) => setNow(e.currentTarget.currentTime)} /> : null}
      <Chapters scenes={voiced(scenes)} starts={spans.map((s) => s.start)} current={f.scene} seek={seek} />
    </div>
  );
}

function StoryboardEditor({ draft, setDraft, save }: { draft: VideoScene[]; setDraft: (d: VideoScene[]) => void; save: (d: VideoScene[]) => void }) {
  const { t } = useLang();
  const scenes = useMemo(() => draft.map((s) => slideScene(tidy(s), { number: false })), [draft]);
  const move = (from: number, to: number) => {
    const next = [...draft];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s!);
    save(next);
  };
  return (
    <div className="stack">
      {draft.map((s, i) => {
        const n = i + 1;
        const put = (x: VideoScene) => draft.map((y, j) => (j === i ? x : y));
        return (
          <section key={s.id} className="storyboard-scene" aria-label={t(`Scene ${n}`, `Scène ${n}`, `Szene ${n}`)}>
            <div className="stack">
              <h3 className="storyboard-head">{t(`Scene ${n}`, `Scène ${n}`, `Szene ${n}`)}</h3>
              <div className="slide-frame">
                <SceneSvg scene={scenes[i]!} />
              </div>
              <div className="row wrap">
                <button type="button" className="icon-button" aria-label={t(`Move scene ${n} up`, `Monter la scène ${n}`, `Szene ${n} nach oben`)} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  ↑
                </button>
                <button type="button" className="icon-button" aria-label={t(`Move scene ${n} down`, `Descendre la scène ${n}`, `Szene ${n} nach unten`)} disabled={i === draft.length - 1} onClick={() => move(i, i + 1)}>
                  ↓
                </button>
                <button type="button" className="icon-button" aria-label={t(`Remove scene ${n}`, `Supprimer la scène ${n}`, `Szene ${n} entfernen`)} onClick={() => save(draft.filter((_, j) => j !== i))}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </div>
            <div className="stack">
              <Field label={t(`Narration of scene ${n}`, `Narration de la scène ${n}`, `Erzähltext von Szene ${n}`)}>
                <textarea rows={Math.min(8, Math.max(3, Math.ceil(s.narration.length / 80)))} value={s.narration} onChange={(e) => setDraft(put({ ...s, narration: e.currentTarget.value }))} onBlur={() => save(draft)} />
              </Field>
              <SlideEditor slide={s} set={(x) => setDraft(put(x))} save={(x) => save(x ? put(x) : draft)} notes={false} />
            </div>
          </section>
        );
      })}
      {draft.length < MAX_SCENES ? (
        <div className="row">
          <button type="button" className="secondary" onClick={() => save([...draft, { ...emptySlide("bullets"), title: t("New scene", "Nouvelle scène", "Neue Szene"), narration: "" }])}>
            <Icon name="plus" size={18} /> {t("Add a scene", "Ajouter une scène", "Szene hinzufügen")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function View({ artifact, onChange }: ViewProps<VideoData>) {
  const { t } = useLang();
  const data = artifact.data;
  const [draft, setDraft] = useState(data.scenes);
  useEffect(() => {
    setDraft(data.scenes);
  }, [data]);
  const save = (scenes: VideoScene[]) => {
    const clean = scenes.map(tidy);
    setDraft(clean);
    onChange({ ...data, scenes: clean });
  };
  const current = Boolean(data.render && data.render.of === storyboardPrint(draft));
  const job = useRender(artifact.id);
  const [editing, setEditing] = useState(!data.render);
  useEffect(() => {
    // A fresh render opens on the player.
    if (current && !job) setEditing(false);
  }, [current, job]);
  const minutes = clock(data.render?.duration ?? 0);
  return (
    <div className="stack">
      <p className="meta">
        {t(`${draft.length} scenes`, `${draft.length} scènes`, `${draft.length} Szenen`)}
        {data.render ? ` · ${minutes}` : ""}
      </p>
      {!data.render ? <Notice>{t("Read the storyboard through and change what you like, then render the video.", "Relisez le storyboard et modifiez ce que vous voulez, puis faites le rendu de la vidéo.", "Lesen Sie das Storyboard, ändern Sie, was Sie möchten, und rendern Sie dann das Video.")}</Notice> : null}
      {data.render && !current ? <Notice>{t("The storyboard changed since the video was made.", "Le storyboard a changé depuis la création de la vidéo.", "Das Storyboard wurde seit der Erstellung des Videos geändert.")}</Notice> : null}
      {!current ? <RenderBar artifact={artifact} scenes={draft} onBefore={() => save(draft)} /> : null}
      {data.render ? (
        <div className="row no-print">
          <button type="button" className="secondary" aria-pressed={editing} onClick={() => setEditing(!editing)}>
            <Icon name={editing ? "video" : "edit"} size={18} /> {editing ? t("Back to the video", "Revenir à la vidéo", "Zurück zum Video") : t("Edit the storyboard", "Modifier le storyboard", "Storyboard bearbeiten")}
          </button>
        </div>
      ) : null}
      {editing || !data.render ? (
        <StoryboardEditor draft={draft} setDraft={setDraft} save={save} />
      ) : data.render.videoMime && artifact.media?.video ? (
        <VideoPlayer artifact={artifact} scenes={data.scenes} />
      ) : (
        <LiveShow artifact={artifact} scenes={data.scenes} />
      )}
    </div>
  );
}

const notRendered = () => new Error(tr("Render the video first.", "Faites d'abord le rendu de la vidéo.", "Rendern Sie zuerst das Video."));

export const video = kind<VideoData, VideoOptions>({
  type: "video",
  icon: "video",
  label: (t) => t("Video summary", "Résumé vidéo", "Video-Zusammenfassung"),
  blurb: (t) => t("Narrated scenes with diagrams and subtitles, 2 to 5 minutes", "Des scènes commentées avec schémas et sous-titres, de 2 à 5 minutes", "Kommentierte Szenen mit Diagrammen und Untertiteln, 2 bis 5 Minuten"),
  defaults: { length: "medium", focus: "" },
  Options({ value, onChange }: OptionsProps<VideoOptions>) {
    const { t } = useLang();
    return (
      <div className="stack">
        <Field label={t("Length", "Durée", "Länge")}>
          <select value={value.length} onChange={(e) => onChange({ ...value, length: e.currentTarget.value as VideoLength })}>
            <option value="short">{t("About 2 minutes", "Environ 2 minutes", "Etwa 2 Minuten")}</option>
            <option value="medium">{t("About 3 to 4 minutes", "Environ 3 à 4 minutes", "Etwa 3 bis 4 Minuten")}</option>
            <option value="long">{t("About 5 minutes", "Environ 5 minutes", "Etwa 5 Minuten")}</option>
          </select>
        </Field>
        <Field label={t("Focus (optional)", "Angle (facultatif)", "Schwerpunkt (optional)")}>
          <input value={value.focus} onChange={(e) => onChange({ ...value, focus: e.currentTarget.value })} placeholder={t("e.g. the main mechanism", "ex. le mécanisme principal", "z. B. der Hauptmechanismus")} />
        </Field>
      </div>
    );
  },
  problem: (_t, language) => speechProblem(language),
  sends: (t, _o, language) =>
    [t("The storyboard is shown to you before anything is rendered.", "Le storyboard vous est montré avant tout rendu.", "Das Storyboard wird Ihnen gezeigt, bevor etwas gerendert wird."), speechNotice(t, language, 1)].filter(Boolean).join(" "),
  async generate(ctx, o) {
    ctx.progress({ label: "" });
    const context = buildContext(ctx.sources, { query: o.focus || undefined, budget: budgetFor(capabilities().contextWindow) });
    const board = await askJson(StoryboardAnswer, {
      system: `You write the storyboard of a short narrated video summary of a university student's course, from their own sources: ${SCENES[o.length]}. Each scene has a visual drawn like a slide ("title" for the opening, "bullets" with 2 to 4 short points, "diagram" for steps, a cycle, a comparison or a hierarchy, "key-figure" for one number that matters, "quote" for a sentence the sources contain) and "narration": what the narrator says over it, two to five sentences written for the ear in plain spoken ${writeIn(ctx.language)} (no lists, no Markdown, no citation labels, no symbols or formulas a voice cannot read: say them in words). The visual's text is short and matches what is said. Open with what the video is about and end with a recap of what to remember. Put in "cites" the labels of the passages a scene comes from, exactly as in the sources (e.g. "S1 p.3"). Write in ${writeIn(ctx.language)}. ${CITE_RULE}`,
      prompt: `${o.focus ? `Focus on: ${o.focus}\n\n` : ""}${context.text}`,
      shape: STORYBOARD_SHAPE,
      maxOutputTokens: 6000,
      signal: ctx.signal,
    });
    return { title: board.title, data: { scenes: board.scenes } };
  },
  View,
  exports: [
    {
      id: "video",
      label: (t) => t("Video file", "Fichier vidéo", "Videodatei"),
      run: async (a) => {
        const r = a.data.render;
        if (!r) throw notRendered();
        const id = a.media?.video;
        const blob = id ? (await getBlob(id))?.data : undefined;
        if (!blob || !r.videoMime) throw new Error(r.problem ?? notRendered().message);
        return { blob, filename: `${slug(a.title)}.${videoExtension(r.videoMime)}` };
      },
    },
    {
      id: "vtt",
      label: (t) => t("Subtitles (VTT)", "Sous-titres (VTT)", "Untertitel (VTT)"),
      run: async (a) => {
        if (!a.data.render) throw notRendered();
        return { blob: new Blob([toVtt(subtitleCues(a.data.render.cues))], { type: "text/vtt" }), filename: `${slug(a.title)}.vtt` };
      },
    },
    {
      id: "md",
      label: (t) => t("Storyboard (Markdown)", "Storyboard (Markdown)", "Storyboard (Markdown)"),
      run: async (a) => ({ blob: new Blob([storyboardMarkdown(a.title, a.data.scenes, a.data.render ? sceneTimeline(a.data.render.cues).spans : undefined)], { type: "text/markdown" }), filename: `${slug(a.title)}.md` }),
    },
  ],
});
