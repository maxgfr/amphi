// A recording in progress lives in IndexedDB as it is made: a draft record in
// `meta` and each 10-second chunk beside it, so a closed or crashed tab loses
// at most the last chunk. Stopping (or recovering) turns the chunks into one
// file in the blob store and a source waiting for transcription.

import { dateTime, tr } from "../i18n.ts";
import { deleteMeta, fresh, get, getMeta, list, put, putBlob, setMeta } from "../data/db.ts";
import type { Id, Marker, Source } from "../data/schema.ts";

export interface Draft {
  id: Id;
  courseId: Id;
  /** The lesson it goes to; none with `newLesson` means a lesson dated the day it was recorded. */
  lessonId?: Id;
  newLesson?: boolean;
  mime: string;
  startedAt: number;
  /** Seconds recorded so far (pauses excluded), as of `updatedAt`. */
  elapsed: number;
  markers: Marker[];
  /** Chunks written so far. */
  chunks: number;
  updatedAt: number;
}

const DRAFT = "recording";
const chunkKey = (id: Id, n: number) => `recording:${id}:${n}`;

export const loadDraft = () => getMeta<Draft>(DRAFT);

export async function saveDraft(d: Draft): Promise<void> {
  await setMeta(DRAFT, { ...d, updatedAt: Date.now() });
}

/** Chunk `n` first, then the draft that counts it: a crash between the two loses nothing (see draftChunks). */
export async function saveChunk(d: Draft, n: number, data: Blob): Promise<Draft> {
  await setMeta(chunkKey(d.id, n), data);
  const next = { ...d, chunks: Math.max(d.chunks, n + 1) };
  await saveDraft(next);
  return next;
}

/** Every chunk on disk, in order: those the draft counts and any written just before a crash. */
export async function draftChunks(d: Draft): Promise<Blob[]> {
  const out: Blob[] = [];
  for (let n = 0; ; n++) {
    const b = await getMeta<Blob>(chunkKey(d.id, n));
    if (!b) break;
    out.push(b);
  }
  return out;
}

export async function discardDraft(d: Draft): Promise<void> {
  for (let n = 0; ; n++) {
    const key = chunkKey(d.id, n);
    if (!(await getMeta(key))) break;
    await deleteMeta(key);
  }
  const cur = await loadDraft();
  if (cur?.id === d.id) await deleteMeta(DRAFT);
}

export type Recovery = "none" | "busy" | "empty" | "interrupted";

/**
 * What to do with a draft found when the record screen opens: nothing without one; leave it when
 * another tab is still recording it; drop it when it holds no audio; otherwise offer to recover it.
 */
export function recoveryState(d: Draft | undefined, recordingElsewhere: boolean): Recovery {
  if (!d) return "none";
  if (recordingElsewhere) return "busy";
  return d.chunks > 0 ? "interrupted" : "empty";
}

/** Whether a tab holds the recording lock (Web Locks; released when that tab closes or crashes). */
export const LOCK = "amphi-recording";
export async function recordingElsewhere(): Promise<boolean> {
  const locks = (navigator as { locks?: LockManager }).locks;
  if (!locks?.query) return false;
  const q = await locks.query();
  return (q.held ?? []).some((l) => l.name === LOCK);
}

/** The container a browser records in: Opus in WebM where it can (Chrome, Firefox), else MP4 (Safari). */
export function pickMime(isTypeSupported: (t: string) => boolean): string {
  for (const t of ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm"]) if (isTypeSupported(t)) return t;
  return "";
}

/** YYYY-MM-DD in local time. */
export const isoDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** The lesson a finished recording goes to, created (dated the recording's day) when asked for. */
async function lessonFor(d: Pick<Draft, "courseId" | "lessonId" | "newLesson" | "startedAt">): Promise<Id | undefined> {
  if (d.lessonId && (await get("lessons", d.lessonId))) return d.lessonId;
  if (!d.newLesson) return undefined;
  const n = (await list("lessons", "courseId", d.courseId)).length + 1;
  const lesson = await put("lessons", { ...fresh(), courseId: d.courseId, title: tr(`Lesson ${n}`, `Séance ${n}`, `Sitzung ${n}`), date: isoDay(d.startedAt), order: n });
  return lesson.id;
}

/** The recording as a source waiting for transcription; the draft is then dropped. */
export async function finishDraft(d: Draft, chunks: Blob[], duration: number): Promise<Source> {
  const mime = d.mime.split(";")[0] || chunks[0]?.type.split(";")[0] || "audio/webm";
  const file = new Blob(chunks, { type: mime });
  const blobId = await putBlob(file, mime);
  const lessonId = await lessonFor(d);
  const source = await put("sources", {
    ...fresh(),
    courseId: d.courseId,
    lessonId,
    kind: "recording",
    title: tr(`Recording of ${dateTime(d.startedAt)}`, `Enregistrement du ${dateTime(d.startedAt)}`, `Aufnahme vom ${dateTime(d.startedAt)}`),
    mime,
    size: file.size,
    blobId,
    duration: Math.round(duration * 10) / 10,
    markers: d.markers.filter((m) => m.t <= duration + 1),
    status: "pending",
  });
  await discardDraft(d);
  return source;
}

/** An interrupted recording, from what reached the disk. */
export async function recoverDraft(d: Draft): Promise<Source> {
  const chunks = await draftChunks(d);
  // The draft's clock is at most a heartbeat behind; a chunk is ten seconds.
  return finishDraft(d, chunks, Math.max(d.elapsed, Math.min(chunks.length * 10, d.elapsed + 10)));
}

export const newDraftId = (): Id => crypto.randomUUID();
