// The sources of a course or a lesson: import by drop or picker, write a
// note, start a recording, and the list with each source's state.

import { useRef, useState } from "react";
import { remove } from "../data/db.ts";
import { ACCEPT, addNote, importFile } from "../data/importers.ts";
import type { Id, Source } from "../data/schema.ts";
import { bytes, clock, count, useLang } from "../i18n.ts";
import { href } from "../router.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Empty, Field, Notice, Sheet } from "../ui/kit.tsx";

export const SOURCE_ICON: Record<Source["kind"], IconName> = { pdf: "file", text: "note", audio: "headphones", video: "video", recording: "mic", web: "globe" };

export function sourceMeta(s: Source, t: (en: string, fr: string, de: string) => string): string {
  const parts: string[] = [];
  if (s.pages) parts.push(count(s.pages.length, ["page", "pages"], ["page", "pages"], ["Seite", "Seiten"]));
  if (s.duration ?? s.transcript?.duration) parts.push(clock(s.duration ?? s.transcript?.duration ?? 0));
  if (s.size) parts.push(bytes(s.size));
  if (s.status === "pending") parts.push(t("waiting for transcription", "en attente de transcription", "wartet auf Transkription"));
  if (s.status === "transcribing") parts.push(t("transcribing…", "transcription…", "wird transkribiert…"));
  return parts.join(" · ");
}

export function SourceList({ sources, courseId, lessonId }: { sources: Source[]; courseId: Id; lessonId?: Id }) {
  const { t } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [noting, setNoting] = useState(false);

  const add = async (files: FileList | File[]) => {
    const errs: string[] = [];
    setBusy((n) => n + files.length);
    for (const f of files) {
      try {
        await importFile(f, { courseId, lessonId });
      } catch (e) {
        errs.push(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy((n) => n - 1);
      }
    }
    setErrors(errs);
  };

  return (
    <section
      className={`sources${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void add(e.dataTransfer.files);
      }}
    >
      <div className="row">
        <a className="button primary" href={href.record(courseId, lessonId)}>
          <Icon name="mic" /> {t("Record", "Enregistrer", "Aufnehmen")}
        </a>
        <button type="button" className="secondary" onClick={() => input.current?.click()}>
          <Icon name="upload" /> {t("Import files", "Importer des fichiers", "Dateien importieren")}
        </button>
        <button type="button" className="secondary" onClick={() => setNoting(true)}>
          <Icon name="note" /> {t("Write a note", "Écrire une note", "Notiz schreiben")}
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.currentTarget.files && void add(e.currentTarget.files)} />
      </div>
      {busy > 0 ? <p className="meta" role="status">{t("Importing…", "Import…", "Import…")}</p> : null}
      {errors.map((e) => (
        <Notice key={e} kind="error">
          {e}
        </Notice>
      ))}
      {sources.length ? (
        <ul className="list">
          {sources.map((s) => (
            <li key={s.id} className="list-item">
              <a href={href.source(s.id)} className="list-link">
                <Icon name={SOURCE_ICON[s.kind]} />
                <span className="list-main">
                  <span className="list-title">{s.title}</span>
                  <span className="meta">{sourceMeta(s, t)}</span>
                  {s.status === "error" ? <span className="error-text">{s.error}</span> : null}
                </span>
              </a>
              <button type="button" className="icon-button" aria-label={t(`Delete ${s.title}`, `Supprimer ${s.title}`, `${s.title} löschen`)} onClick={() => void remove("sources", s.id)}>
                <Icon name="trash" size={18} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="upload" title={t("Drop your course material here", "Déposez vos supports ici", "Legen Sie Ihre Unterlagen hier ab")}>
          <p>{t("PDF, Markdown, text, audio or video. Or record the lecture.", "PDF, Markdown, texte, audio ou vidéo. Ou enregistrez le cours.", "PDF, Markdown, Text, Audio oder Video. Oder nehmen Sie die Vorlesung auf.")}</p>
        </Empty>
      )}
      {noting ? <NoteSheet onClose={() => setNoting(false)} onSave={(title, text) => addNote({ courseId, lessonId }, title, text)} /> : null}
    </section>
  );
}

function NoteSheet({ onClose, onSave }: { onClose: () => void; onSave: (title: string, text: string) => Promise<unknown> }) {
  const { t } = useLang();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return (
    <Sheet open onClose={onClose} title={t("New note", "Nouvelle note", "Neue Notiz")} wide>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          await onSave(title.trim() || t("Note", "Note", "Notiz"), text);
          onClose();
        }}
      >
        <Field label={t("Title", "Titre", "Titel")}>
          <input value={title} onChange={(e) => setTitle(e.currentTarget.value)} autoFocus />
        </Field>
        <Field label={t("Text (Markdown)", "Texte (Markdown)", "Text (Markdown)")}>
          <textarea rows={14} value={text} onChange={(e) => setText(e.currentTarget.value)} required />
        </Field>
        <div className="row end">
          <button type="submit" className="primary" disabled={!text.trim()}>
            {t("Add", "Ajouter", "Hinzufügen")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
