// Files dropped into a course or a lesson become sources: a PDF keeps its
// text page by page, Markdown and text files their text, audio and video wait
// for transcription (src/speech). The original file is kept in the blob store.

import { tr } from "../i18n.ts";
import { fresh, put, putBlob } from "./db.ts";
import type { Id, Source, SourceKind } from "./schema.ts";

export const ACCEPT = [".pdf", ".md", ".markdown", ".txt", "application/pdf", "text/plain", "text/markdown", "audio/*", "video/*"].join(",");

export function kindOf(file: File): SourceKind | null {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|opus|flac|aac|webm)$/.test(name)) return file.type.startsWith("video/") ? "video" : "audio";
  if (file.type.startsWith("video/") || /\.(mp4|mov|mkv|m4v)$/.test(name)) return "video";
  if (file.type.startsWith("text/") || /\.(md|markdown|txt)$/.test(name)) return "text";
  return null;
}

const titleOf = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || name;

/** Listeners for new media sources (transcription starts there). */
const mediaListeners = new Set<(source: Source) => void>();
export function onMediaImported(fn: (source: Source) => void): () => void {
  mediaListeners.add(fn);
  return () => mediaListeners.delete(fn);
}

export async function importFile(file: File, where: { courseId: Id; lessonId?: Id }): Promise<Source> {
  const kind = kindOf(file);
  if (!kind) throw new Error(tr(`${file.name}: this kind of file is not supported (PDF, Markdown, text, audio or video).`, `${file.name} : ce type de fichier n'est pas pris en charge (PDF, Markdown, texte, audio ou vidéo).`, `${file.name}: Dieser Dateityp wird nicht unterstützt (PDF, Markdown, Text, Audio oder Video).`));
  const base = { ...fresh(), ...where, kind, title: titleOf(file.name), mime: file.type || undefined, size: file.size };
  if (kind === "text") {
    return put("sources", { ...base, text: await file.text(), status: "ready" });
  }
  const blobId = await putBlob(file);
  if (kind === "pdf") {
    const { pdfPages } = await import("./pdf.ts");
    try {
      const { pages, title } = await pdfPages(await file.arrayBuffer());
      const empty = pages.every((p) => !p.text.trim());
      return put("sources", {
        ...base,
        title: title && title.length > 3 ? title : base.title,
        blobId,
        pages,
        status: empty ? "error" : "ready",
        error: empty ? tr("This PDF has no text layer (a scan?): its text cannot be read.", "Ce PDF n'a pas de couche texte (un scan ?) : son texte ne peut pas être lu.", "Dieses PDF hat keine Textebene (ein Scan?): Sein Text kann nicht gelesen werden.") : undefined,
      });
    } catch (e) {
      return put("sources", { ...base, blobId, status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }
  const source = await put("sources", { ...base, blobId, status: "pending" });
  for (const fn of mediaListeners) fn(source);
  return source;
}

/** A note typed or pasted by the student. */
export function addNote(where: { courseId: Id; lessonId?: Id }, title: string, text: string, extra: Partial<Source> = {}): Promise<Source> {
  return put("sources", { ...fresh(), ...where, kind: "text", title, text, status: "ready", ...extra });
}
