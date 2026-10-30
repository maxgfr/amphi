// Cursus course packages (.cursus-course, format cursus-course/1): a zip
// with course.json and the stored files under media/<sha-256>. A course
// becomes a Cursus course, its lessons subsets, its text sources notes, its
// PDFs pdf sources (with their file), its reports fiches and its flashcards
// cards. Cursus mints fresh ids on import, so the package uses local refs.

import { citationsIn, passagesOf, resolveLabel } from "../ai/context.ts";
import { get, getBlob, list } from "../data/db.ts";
import type { Artifact, Course, Id, Lesson, Source } from "../data/schema.ts";
import type { FlashcardsData } from "../studio/cards.ts";
import type { ReportData } from "../studio/report.tsx";
import { keysOf } from "../ui/cite.ts";
import { slug } from "../ui/kit.tsx";
import { ankiTag } from "./anki.ts";

export const CURSUS_EXT = ".cursus-course";
const FORMAT = "cursus-course/1";

export interface CursusPackage {
  format: typeof FORMAT;
  course: { title: string; emoji?: string; language?: string; examDate?: string };
  sections: { ref: string; name: string; examDate?: string }[];
  sources: { ref: string; sectionRef?: string; kind: "note" | "pdf"; title: string; body: string; blob?: string }[];
  fiches: {
    ref: string;
    sectionRef?: string;
    title: string;
    sourceRefs: string[];
    keyPoints: { text: string; sourceRef?: { sourceId: string; page?: number } }[];
    body: string;
  }[];
  cards: { kind: "basic" | "cloze"; sectionRef?: string; sourceRef?: string; front: string; back: string; tags?: string[]; origin: "ai" }[];
  media: { id: string; mime: string }[];
}

export interface CursusFile {
  /** sha-256 hex: amphi's blob ids are Cursus's file ids. */
  id: string;
  mime: string;
  bytes: Uint8Array;
}

export interface CursusInput {
  course: Course;
  lessons: Lesson[];
  sources: Source[];
  /** Reports and flashcards; other types are left out. */
  artifacts: Artifact[];
  files: CursusFile[];
}

const H64 = /^[0-9a-f]{64}$/;

/** A source's text as Cursus keeps it: a note's Markdown, a PDF's pages, a transcript by the minute. */
export function sourceBody(s: Source): string {
  if (s.pages?.length) return s.pages.map((p) => p.text.trim()).filter(Boolean).join("\n\n");
  if (s.transcript?.segments.length) return passagesOf(s, "S").map((p) => `**${p.label.slice(2)}** ${p.text}`).join("\n\n");
  const text = s.text?.trim() ?? "";
  return s.url ? `<${s.url}>\n\n${text}` : text;
}

const exportable = (s: Source) => Boolean(sourceBody(s).trim()) || (s.kind === "pdf" && Boolean(s.blobId));

/** Citation labels ("[S1 p.3]") read as the source's title, since the labels mean nothing outside amphi. */
function readableCitations(md: string, sourceIds: Id[], sources: Map<Id, Source>): string {
  const keys = keysOf(sourceIds);
  return md.replace(/\[(S\d+(?: (?:p\.\d+|§\d+|\d+:\d{2}(?::\d{2})?))?)\]/g, (all, label: string) => {
    const r = resolveLabel(label, keys);
    const title = r && sources.get(r.sourceId)?.title;
    if (!title) return all;
    const where = label.split(" ")[1];
    return `(${title}${where ? `, ${where}` : ""})`;
  });
}

/** Top-level list items of a report, as a fiche's key points (the first citation of each becomes its source). */
function keyPointsOf(md: string, cite: (label: string) => { sourceId: string; page?: number } | undefined): CursusPackage["fiches"][number]["keyPoints"] {
  const out: CursusPackage["fiches"][number]["keyPoints"] = [];
  for (const line of md.split("\n")) {
    const m = /^(?:[-*+]|\d+\.) +(.+)$/.exec(line);
    if (!m) continue;
    const text = m[1]!
      .replace(/\s*\[S\d+[^\]]*\]/g, "")
      .replace(/\*\*|__/g, "")
      .trim();
    if (!text) continue;
    const label = citationsIn(m[1]!)[0];
    const sourceRef = label ? cite(label) : undefined;
    out.push(sourceRef ? { text, sourceRef } : { text });
    if (out.length >= 30) break;
  }
  return out;
}

export function cursusPackage(input: CursusInput): CursusPackage {
  const { course } = input;
  const byId = new Map(input.sources.map((s) => [s.id, s]));
  const sources = input.sources.filter(exportable);
  const artifacts = input.artifacts.filter((a) => a.status === "ready" && (a.type === "report" || a.type === "flashcards"));
  // Only lessons that hold something become subsets.
  const used = new Set([...sources, ...artifacts].map((x) => x.lessonId).filter((id): id is Id => Boolean(id)));
  const lessons = input.lessons.filter((l) => used.has(l.id));
  const sectionRef = new Map(lessons.map((l, i) => [l.id, `t${i}`]));
  const placed = (lessonId?: Id) => (lessonId ? sectionRef.get(lessonId) : undefined);
  const sourceRef = new Map(sources.map((s, i) => [s.id, `s${i}`]));
  const lessonTitle = new Map(input.lessons.map((l) => [l.id, l.title]));
  /** A citation of an artifact as a package source ref and page. */
  const citeOf = (a: Artifact) => {
    const keys = keysOf(a.sourceIds);
    return (label: string) => {
      const r = resolveLabel(label, keys);
      const ref = r && sourceRef.get(r.sourceId);
      return ref ? { sourceId: ref, ...(r.page ? { page: r.page } : {}) } : undefined;
    };
  };

  const pkg: CursusPackage = {
    format: FORMAT,
    course: { title: course.title, emoji: course.emoji, language: course.language, examDate: course.examDate },
    sections: lessons.map((l) => ({ ref: sectionRef.get(l.id)!, name: l.title })),
    sources: sources.map((s) => ({
      ref: sourceRef.get(s.id)!,
      sectionRef: placed(s.lessonId),
      kind: s.kind === "pdf" ? "pdf" : "note",
      title: s.title,
      body: sourceBody(s),
      // Named even when not shipped, as Cursus does: the file may reach Cursus another way.
      blob: s.kind === "pdf" && s.blobId && H64.test(s.blobId) ? s.blobId : undefined,
    })),
    fiches: [],
    cards: [],
    media: input.files.filter((f) => H64.test(f.id)).map((f) => ({ id: f.id, mime: f.mime })),
  };
  let n = 0;
  for (const a of artifacts) {
    const sourceRefs = a.sourceIds.flatMap((id) => sourceRef.get(id) ?? []);
    if (a.type === "report") {
      const md = (a.data as ReportData).markdown;
      pkg.fiches.push({ ref: `f${n++}`, sectionRef: placed(a.lessonId), title: a.title, sourceRefs, keyPoints: keyPointsOf(md, citeOf(a)), body: readableCitations(md, a.sourceIds, byId) });
    } else {
      const cite = citeOf(a);
      const lesson = a.lessonId ? lessonTitle.get(a.lessonId) : undefined;
      for (const c of (a.data as FlashcardsData).cards) {
        const tags = [course.title, lesson, c.concept].filter((t): t is string => Boolean(t?.trim())).map(ankiTag);
        pkg.cards.push({ kind: c.kind, sectionRef: placed(a.lessonId), sourceRef: c.cite ? cite(c.cite)?.sourceId : undefined, front: c.front, back: c.back, tags, origin: "ai" });
      }
    }
  }
  return pkg;
}

/** The package as a .cursus-course zip. */
export async function zipCursus(input: CursusInput): Promise<Uint8Array> {
  const { zipSync } = await import("fflate");
  const pkg = cursusPackage(input);
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = { "course.json": new TextEncoder().encode(JSON.stringify(pkg)) };
  // PDFs are compressed already: stored as they are.
  for (const f of input.files) if (H64.test(f.id)) entries[`media/${f.id}`] = [f.bytes, { level: 0 }];
  return zipSync(entries, { mtime: new Date(Date.UTC(2000, 0, 1)) });
}

/** The stored files of the PDF sources, those this device still has. */
async function filesOf(sources: Source[]): Promise<CursusFile[]> {
  const out: CursusFile[] = [];
  for (const s of sources) {
    if (s.kind !== "pdf" || !s.blobId || out.some((f) => f.id === s.blobId)) continue;
    const b = await getBlob(s.blobId);
    if (b) out.push({ id: b.id, mime: b.mime || "application/pdf", bytes: new Uint8Array(await b.data.arrayBuffer()) });
  }
  return out;
}

const file = (bytes: Uint8Array, name: string) => ({ blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }), filename: `${slug(name)}${CURSUS_EXT}` });

/** A whole course for Cursus: every source with text or a PDF, every report as a fiche, every flashcard. */
export async function courseToCursus(courseId: Id): Promise<{ blob: Blob; filename: string }> {
  const course = await get("courses", courseId);
  if (!course) throw new Error("course not found");
  const [lessons, sources, artifacts] = await Promise.all([list("lessons", "courseId", courseId), list("sources", "courseId", courseId), list("artifacts", "courseId", courseId)]);
  lessons.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  sources.sort((a, b) => a.createdAt - b.createdAt);
  artifacts.sort((a, b) => a.createdAt - b.createdAt);
  const bytes = await zipCursus({ course, lessons, sources, artifacts, files: await filesOf(sources) });
  return file(bytes, course.title);
}

/** One artifact for Cursus, with the sources it was made from, in its lesson's subset. */
export async function artifactToCursus(a: Artifact, ctx: { course: Course; lesson?: Lesson; sources: Source[] }): Promise<{ blob: Blob; filename: string }> {
  const bytes = await zipCursus({ course: ctx.course, lessons: ctx.lesson ? [ctx.lesson] : [], sources: ctx.sources, artifacts: [a], files: await filesOf(ctx.sources) });
  return file(bytes, a.title);
}
