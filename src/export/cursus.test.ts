// Reads the .cursus-course back as Cursus does: unzipped, course.json
// validated with Cursus's PackageSchema (src/core/export/coursePackage.ts,
// copied as is but for its CardOrigin type), the subset tree checked and the
// shipped files found under media/.
import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { unzipSync } from "fflate";
import { z } from "zod";
import { fresh, put, putBlob, resetDbForTests } from "../data/db.ts";
import type { Artifact, Course, Lesson, Source } from "../data/schema.ts";
import type { FlashcardsData } from "../studio/cards.ts";
import type { ReportData } from "../studio/report.tsx";
import { courseToCursus, zipCursus } from "./cursus.ts";

const FORMAT = "cursus-course/1";
const H64 = /^[0-9a-f]{64}$/;
const optStr = z.string().optional();
const PackageSchema = z.object({
  format: z.literal(FORMAT),
  course: z.object({ title: z.string(), color: optStr, emoji: optStr, language: optStr, examDate: optStr }),
  sections: z
    .array(
      z.object({
        ref: z.string(),
        parentRef: optStr,
        name: z.string(),
        examDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
    )
    .default([]),
  sources: z.array(
    z.object({
      ref: z.string(),
      sectionRef: optStr,
      kind: z.enum(["note", "pdf", "image"]),
      title: z.string(),
      body: z.string(),
      blob: z.string().regex(H64).optional(),
      caption: optStr,
      rotation: z.number().int().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      attachedRef: optStr,
    }),
  ),
  fiches: z.array(
    z.object({
      ref: z.string(),
      sectionRef: optStr,
      title: z.string(),
      subject: optStr,
      template: optStr,
      sourceRefs: z.array(z.string()),
      keyPoints: z.array(z.object({ text: z.string(), sourceRef: z.object({ sourceId: z.string(), page: z.number().optional(), quote: optStr }).optional() })),
      body: z.string(),
    }),
  ),
  cards: z.array(
    z.object({
      kind: z.enum(["basic", "cloze"]),
      sectionRef: optStr,
      ficheRef: optStr,
      sourceRef: optStr,
      front: z.string(),
      back: z.string(),
      tags: z.array(z.string()).optional(),
      origin: z.enum(["manual", "ai", "anki", "cloze"]).optional(),
    }),
  ),
  media: z.array(z.object({ id: z.string().regex(H64), mime: z.string() })).default([]),
});
type CoursePackage = z.infer<typeof PackageSchema>;

/** Cursus's checks before importing: every section known, every source and fiche ref it names exists. */
function read(bytes: Uint8Array): { pkg: CoursePackage; zip: Record<string, Uint8Array> } {
  const zip = unzipSync(bytes);
  const pkg = PackageSchema.parse(JSON.parse(new TextDecoder().decode(zip["course.json"])));
  const sections = new Set(pkg.sections.map((s) => s.ref));
  expect(sections.size).toBe(pkg.sections.length);
  for (const item of [...pkg.sources, ...pkg.fiches, ...pkg.cards]) if (item.sectionRef !== undefined) expect(sections.has(item.sectionRef)).toBe(true);
  const sources = new Set(pkg.sources.map((s) => s.ref));
  for (const f of pkg.fiches) {
    for (const r of f.sourceRefs) expect(sources.has(r)).toBe(true);
    for (const k of f.keyPoints) if (k.sourceRef) expect(sources.has(k.sourceRef.sourceId)).toBe(true);
  }
  for (const c of pkg.cards) if (c.sourceRef) expect(sources.has(c.sourceRef)).toBe(true);
  for (const m of pkg.media) expect(zip[`media/${m.id}`]).toBeDefined();
  return { pkg, zip };
}

const PDF = new TextEncoder().encode("%PDF-1.4 fake");
const pdfId = new Bun.CryptoHasher("sha256").update(PDF).digest("hex");

function sample() {
  const course: Course = { ...fresh(1), kind: "course", title: "Thermodynamics", emoji: "🔥", language: "en", examDate: "2026-12-15" };
  const l1: Lesson = { ...fresh(2), courseId: course.id, title: "Lesson 1", order: 1 };
  const l2: Lesson = { ...fresh(3), courseId: course.id, title: "Lesson 2 (empty)", order: 2 };
  const note: Source = { ...fresh(4), courseId: course.id, lessonId: l1.id, kind: "text", title: "Entropy", text: "Entropy measures disorder.\n\nIt never decreases.", status: "ready" };
  const pdf: Source = { ...fresh(5), courseId: course.id, lessonId: l1.id, kind: "pdf", title: "Slides", blobId: pdfId, pages: [{ n: 1, text: "Page one" }, { n: 2, text: "Page two" }], status: "ready" };
  const talk: Source = { ...fresh(6), courseId: course.id, kind: "recording", title: "Lecture", transcript: { segments: [{ start: 0, end: 5, text: "Hello." }, { start: 5, end: 62, text: "Heat flows." }, { start: 62, end: 70, text: "Bye." }] }, status: "ready" };
  const audio: Source = { ...fresh(7), courseId: course.id, kind: "audio", title: "Not transcribed", status: "pending" };
  const base = { courseId: course.id, lessonId: l1.id, options: {}, status: "ready" as const, version: 1 };
  const report: Artifact<ReportData> = {
    ...fresh(8),
    ...base,
    type: "report",
    title: "Summary · Lesson 1",
    sourceIds: [note.id, pdf.id],
    data: { format: "summary", markdown: "## Key ideas\n- **Entropy** measures disorder [S1 §1].\n- Slides recap [S2 p.2].\n  - nested, left out\n\nText [S1 §2]." },
  };
  const cards: Artifact<FlashcardsData> = {
    ...fresh(9),
    ...base,
    type: "flashcards",
    title: "Flashcards · Lesson 1",
    sourceIds: [pdf.id, note.id],
    data: {
      cards: [
        { id: "a", kind: "basic", front: "What does entropy measure?", back: "Disorder", concept: "entropy", cite: "S2 §1" },
        { id: "b", kind: "cloze", front: "Entropy never {{c1::decreases}}.", back: "", concept: "second law", cite: "S1 p.2" },
        { id: "c", kind: "basic", front: "Uncited", back: "Yes", concept: "" },
      ],
    },
  };
  const quiz = { ...cards, ...fresh(10), type: "quiz" as const, title: "Quiz" };
  return { course, lessons: [l1, l2], sources: [note, pdf, talk, audio], artifacts: [report, cards, quiz as Artifact] };
}

test("a course becomes a Cursus package: lessons as subsets, sources as notes and PDFs with their file, reports as fiches, flashcards as cards", async () => {
  const s = sample();
  const { pkg, zip } = read(await zipCursus({ ...s, files: [{ id: pdfId, mime: "application/pdf", bytes: PDF }] }));
  expect(pkg.course).toEqual({ title: "Thermodynamics", emoji: "🔥", language: "en", examDate: "2026-12-15" });
  // The empty lesson is left out.
  expect(pkg.sections).toEqual([{ ref: "t0", name: "Lesson 1" }]);
  expect(pkg.sources.map((x) => [x.ref, x.kind, x.title, x.sectionRef, x.blob])).toEqual([
    ["s0", "note", "Entropy", "t0", undefined],
    ["s1", "pdf", "Slides", "t0", pdfId],
    ["s2", "note", "Lecture", undefined, undefined],
  ]);
  expect(pkg.sources[0]!.body).toBe("Entropy measures disorder.\n\nIt never decreases.");
  expect(pkg.sources[1]!.body).toBe("Page one\n\nPage two");
  expect(pkg.sources[2]!.body).toBe("**0:00** Hello. Heat flows.\n\n**1:02** Bye.");
  expect(pkg.media).toEqual([{ id: pdfId, mime: "application/pdf" }]);
  expect(zip[`media/${pdfId}`]).toEqual(PDF);

  expect(pkg.fiches).toHaveLength(1);
  const fiche = pkg.fiches[0]!;
  expect(fiche).toMatchObject({ ref: "f0", sectionRef: "t0", title: "Summary · Lesson 1", sourceRefs: ["s0", "s1"] });
  expect(fiche.keyPoints).toEqual([
    { text: "Entropy measures disorder.", sourceRef: { sourceId: "s0" } },
    { text: "Slides recap.", sourceRef: { sourceId: "s1", page: 2 } },
  ]);
  // amphi's labels mean nothing in Cursus: they read as the source's title.
  expect(fiche.body).toContain("**Entropy** measures disorder (Entropy, §1).");
  expect(fiche.body).toContain("Slides recap (Slides, p.2).");

  // The labels of a flashcards artifact number its own sources (S1 = the PDF here).
  expect(pkg.cards).toEqual([
    { kind: "basic", sectionRef: "t0", sourceRef: "s0", front: "What does entropy measure?", back: "Disorder", tags: ["Thermodynamics", "Lesson_1", "entropy"], origin: "ai" },
    { kind: "cloze", sectionRef: "t0", sourceRef: "s1", front: "Entropy never {{c1::decreases}}.", back: "", tags: ["Thermodynamics", "Lesson_1", "second_law"], origin: "ai" },
    { kind: "basic", sectionRef: "t0", front: "Uncited", back: "Yes", tags: ["Thermodynamics", "Lesson_1"], origin: "ai" },
  ]);
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

test("Send to Cursus reads the whole course from the device, its PDF files included", async () => {
  const s = sample();
  expect(await putBlob(new Blob([PDF], { type: "application/pdf" }))).toBe(pdfId);
  await put("courses", s.course);
  for (const l of s.lessons) await put("lessons", l);
  for (const x of s.sources) await put("sources", x);
  for (const a of s.artifacts) await put("artifacts", a);
  const file = await courseToCursus(s.course.id);
  expect(file.filename).toBe("thermodynamics.cursus-course");
  const { pkg, zip } = read(new Uint8Array(await file.blob.arrayBuffer()));
  expect(pkg.sources).toHaveLength(3);
  expect(pkg.fiches).toHaveLength(1);
  expect(pkg.cards).toHaveLength(3);
  expect(zip[`media/${pdfId}`]).toEqual(PDF);
});
