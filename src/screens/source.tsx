// One source: a PDF's text page by page, a note to read or edit, or a
// recording with its transcript (click a line to hear it). A citation opens
// this screen at the page or the moment it points to.

import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { get, update } from "../data/db.ts";
import { useBlobUrl, useLive } from "../data/hooks.ts";
import type { Source } from "../data/schema.ts";
import { clock, useLang } from "../i18n.ts";
import { href } from "../router.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty, Notice } from "../ui/kit.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { SOURCE_ICON, sourceMeta } from "./sources.tsx";

const Transcribe = lazy(() => import("../speech/transcribe-panel.tsx").then((m) => ({ default: m.TranscribePanel })));

export function SourceScreen({ id, at }: { id: string; at?: { page?: number; t?: number } }) {
  const { t } = useLang();
  const data = useLive(
    async () => {
      const source = await get("sources", id);
      if (!source) return null;
      const [course, lesson] = await Promise.all([get("courses", source.courseId), source.lessonId ? get("lessons", source.lessonId) : undefined]);
      return { source, course, lesson };
    },
    ["sources"],
    [id],
  );
  if (data === undefined) return <div className="page" aria-busy="true" />;
  if (data === null)
    return (
      <div className="page">
        <Empty icon="file" title={t("This source no longer exists.", "Cette source n'existe plus.", "Diese Quelle existiert nicht mehr.")} />
      </div>
    );
  const { source, course, lesson } = data;
  return (
    <div className="page">
      <nav className="crumbs" aria-label={t("Breadcrumb", "Fil d'Ariane", "Brotkrumen")}>
        {course ? <a href={href.course(course.id, "sources")}>{course.title}</a> : null}
        {lesson ? <a href={href.lesson(lesson.id)}>{lesson.title}</a> : null}
      </nav>
      <div className="page-head">
        <h1>
          <Icon name={SOURCE_ICON[source.kind]} size={24} /> {source.title}
        </h1>
        {source.url ? (
          <a className="button secondary" href={source.url} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={18} /> {t("Open the page", "Ouvrir la page", "Seite öffnen")}
          </a>
        ) : null}
      </div>
      <p className="meta">{sourceMeta(source, t)}</p>
      {source.status === "error" ? <Notice kind="error">{source.error}</Notice> : null}
      {source.kind === "pdf" ? <PdfText source={source} page={at?.page} /> : null}
      {source.kind === "text" || source.kind === "web" ? <NoteView source={source} /> : null}
      {source.kind === "audio" || source.kind === "video" || source.kind === "recording" ? (
        <MediaView source={source} t0={at?.t}>
          {source.status === "pending" || source.status === "transcribing" || (source.status === "error" && !source.transcript) ? (
            <Suspense fallback={null}>
              <Transcribe source={source} />
            </Suspense>
          ) : null}
        </MediaView>
      ) : null}
    </div>
  );
}

function PdfText({ source, page }: { source: Source; page?: number }) {
  const { t } = useLang();
  const url = useBlobUrl(source.blobId);
  useEffect(() => {
    if (page) document.getElementById(`page-${page}`)?.scrollIntoView({ block: "start" });
  }, [page]);
  return (
    <>
      {url ? (
        <a className="button secondary" href={url} target="_blank" rel="noopener noreferrer">
          <Icon name="external" size={18} /> {t("Open the PDF", "Ouvrir le PDF", "PDF öffnen")}
        </a>
      ) : null}
      <div className="pages">
        {source.pages?.map((p) => (
          <section key={p.n} id={`page-${p.n}`} className={`page-text${p.n === page ? " highlight" : ""}`} aria-label={t(`Page ${p.n}`, `Page ${p.n}`, `Seite ${p.n}`)}>
            <h2 className="page-number">p. {p.n}</h2>
            <p>{p.text || "—"}</p>
          </section>
        ))}
      </div>
    </>
  );
}

function NoteView({ source }: { source: Source }) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(source.text ?? "");
  if (editing)
    return (
      <div className="stack">
        <textarea rows={20} value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label={t("Text", "Texte", "Text")} />
        <div className="row end">
          <button type="button" className="secondary" onClick={() => setEditing(false)}>
            {t("Cancel", "Annuler", "Abbrechen")}
          </button>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              await update("sources", source.id, { text });
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
      <div className="row">
        <button type="button" className="secondary" onClick={() => setEditing(true)}>
          <Icon name="edit" size={18} /> {t("Edit", "Modifier", "Bearbeiten")}
        </button>
      </div>
      <Markdown text={source.text ?? ""} />
    </div>
  );
}

function MediaView({ source, t0, children }: { source: Source; t0?: number; children?: ReactNode }) {
  const { t } = useLang();
  const url = useBlobUrl(source.blobId);
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const m = media.current;
    if (!m || t0 === undefined) return;
    const seek = () => {
      m.currentTime = t0;
    };
    if (m.readyState >= 1) seek();
    else m.addEventListener("loadedmetadata", seek, { once: true });
  }, [t0, url]);
  const segments = source.transcript?.segments ?? [];
  const markers = source.markers ?? [];
  return (
    <div className="stack">
      {url ? (
        source.kind === "video" ? (
          <video ref={media} className="player video" src={url} controls preload="metadata" onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
        ) : (
          <audio ref={media} className="player" src={url} controls preload="metadata" onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
        )
      ) : null}
      {children}
      {markers.length ? (
        <div className="row wrap" aria-label={t("Marked moments", "Moments marqués", "Markierte Stellen")}>
          {markers.map((m) => (
            <button key={m.t} type="button" className="chip" onClick={() => media.current && (media.current.currentTime = m.t)}>
              <Icon name="flag" size={16} /> {clock(m.t)} {m.label ?? ""}
            </button>
          ))}
        </div>
      ) : null}
      {segments.length ? (
        <ol className="transcript">
          {segments.map((s) => {
            const active = now >= s.start && now < s.end;
            const marked = markers.some((m) => m.t >= s.start - 2 && m.t <= s.end + 2);
            return (
              <li key={`${s.start}-${s.end}`} className={`${active ? "active" : ""}${marked ? " marked" : ""}`} id={`t-${Math.floor(s.start)}`}>
                <button type="button" className="time" onClick={() => media.current && ((media.current.currentTime = s.start), void media.current.play())}>
                  {clock(s.start)}
                </button>
                <span>{s.text}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
