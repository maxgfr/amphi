import { describe, expect, test } from "bun:test";
import type { Artifact, Base, Chat, Concept, Course, Lesson, Source, StudyEvent } from "../data/schema.ts";
import { blobPath, blobRefs, classify, decode, encode, encodeRecords, normalize, partsOf, type Snapshot } from "./files.ts";

const T = 1_700_000_000_000;
const course: Course = { id: "c0ffee00-1111-4222-8333-444455556666", createdAt: T, updatedAt: T + 5, kind: "course", title: "Thermodynamique générale", language: "fr" };
const lesson: Lesson = { id: "1e550000-aaaa-4bbb-8ccc-dddd00000001", createdAt: T, updatedAt: T, courseId: course.id, title: "Entropy", order: 0, date: "2026-10-01" };
const pdfId = "a".repeat(64);
const note: Source = { id: "5a000000-0000-4000-8000-000000000001", createdAt: T, updatedAt: T + 1, courseId: course.id, lessonId: lesson.id, kind: "text", title: "Notes", text: "# Entropy\n\nIt never decreases.\n\n", status: "ready" };
const pdf: Source = {
  id: "5a000000-0000-4000-8000-000000000002",
  createdAt: T,
  updatedAt: T,
  courseId: course.id,
  kind: "pdf",
  title: "Slides",
  mime: "application/pdf",
  size: 3,
  blobId: pdfId,
  pages: [
    { n: 1, text: "First page" },
    { n: 2, text: "" },
    { n: 3, text: "Third\n\nwith lines\n" },
  ],
  status: "ready",
};
const rec: Source = {
  id: "5a000000-0000-4000-8000-000000000003",
  createdAt: T,
  updatedAt: T,
  courseId: course.id,
  lessonId: lesson.id,
  kind: "recording",
  title: "Lecture",
  transcript: { language: "en", segments: [{ start: 0, end: 2.5, text: "Hello" }, { start: 65, end: 70, text: "Entropy" }] },
  markers: [{ t: 12 }],
  status: "ready",
};
// A page that holds the page marker cannot go to pages.md: it stays in source.json.
const tricky: Source = { ...pdf, id: "5a000000-0000-4000-8000-000000000004", blobId: undefined, pages: [{ n: 1, text: "a\n<!-- amphi:page 2 -->\nb" }] };
const chat: Chat = { id: "c4a70000-0000-4000-8000-000000000001", createdAt: T, updatedAt: T, courseId: course.id, mode: "chat", title: "Questions", messages: [{ role: "user", content: "Why?", at: T }, { role: "assistant", content: "Because.", at: T + 1, sourceIds: [note.id] }], summary: "A short talk." };
const report: Artifact = { id: "a7000000-0000-4000-8000-000000000001", createdAt: T, updatedAt: T, courseId: course.id, lessonId: lesson.id, type: "report", title: "Summary", sourceIds: [note.id], options: { length: "short" }, data: { format: "summary", markdown: "## Key points\n\n- one" }, status: "ready", version: 1 };
const futureType = { ...report, id: "a7000000-0000-4000-8000-000000000002", type: "timeline", data: { events: [1, 2] } } as unknown as Artifact;
const concept: Concept = { id: "cc000000-0000-4000-8000-000000000001", createdAt: T, updatedAt: T, courseId: course.id, title: "Entropy", summary: "Disorder", order: 0, prerequisites: [], refs: ["S1 p.3"] };
const event: StudyEvent = { id: "e0000000-0000-4000-8000-000000000001", createdAt: T, updatedAt: T, courseId: course.id, conceptId: concept.id, kind: "quiz", score: 1, at: T };
const deletedLesson: Lesson = { id: "1e550000-aaaa-4bbb-8ccc-dddd00000002", createdAt: T, updatedAt: T + 9, deletedAt: T + 9, courseId: course.id, title: "Gone", order: 1 };
const deletedEvent: StudyEvent = { ...event, id: "e0000000-0000-4000-8000-000000000002", deletedAt: T + 3, updatedAt: T + 3 };

const snapshot: Snapshot = {
  records: { courses: [course], lessons: [lesson, deletedLesson], sources: [note, pdf, rec, tricky], chats: [chat], artifacts: [report, futureType], concepts: [concept], events: [event, deletedEvent] },
  blobs: [{ id: pdfId, mime: "application/pdf", bytes: new Uint8Array([1, 2, 3]) }],
};

const sortRecords = (rs: Base[] = []) => [...rs].map(normalize).sort((a, b) => (a.id < b.id ? -1 : 1));

describe("files", () => {
  test("model → files → model gives the same records, tombstones and blobs", () => {
    const back = decode(encode(snapshot));
    expect(back.problems).toEqual([]);
    for (const [t, rows] of Object.entries(snapshot.records)) expect(sortRecords(back.records[t as keyof typeof back.records])).toEqual(sortRecords(rows));
    expect(back.blobs).toEqual(snapshot.blobs);
    // A tombstone keeps only its id and times.
    expect(back.records.lessons?.find((l) => l.id === deletedLesson.id)).toEqual({ id: deletedLesson.id, createdAt: T, updatedAt: T + 9, deletedAt: T + 9 });
  });

  test("a readable layout", () => {
    const files = [...encodeRecords(snapshot.records).keys()].sort();
    expect(files).toEqual([
      "courses/thermodynamique-generale-c0ffee00/concepts.jsonl",
      "courses/thermodynamique-generale-c0ffee00/course.json",
      "courses/thermodynamique-generale-c0ffee00/events.jsonl",
      "courses/thermodynamique-generale-c0ffee00/chats/questions-c4a70000.json",
      "courses/thermodynamique-generale-c0ffee00/chats/questions-c4a70000.md",
      "courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/lesson.json",
      "courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/sources/lecture-5a000000/source.json",
      "courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/sources/lecture-5a000000/transcript.json",
      "courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/sources/lecture-5a000000/transcript.md",
      "courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/sources/notes-5a000000/source.json",
      "courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/sources/notes-5a000000/text.md",
      "courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/studio/report/summary-a7000000.json",
      "courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/studio/report/summary-a7000000.md",
      "courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/studio/timeline/summary-a7000000.json",
      "courses/thermodynamique-generale-c0ffee00/sources/slides-5a000000/pages.md",
      "courses/thermodynamique-generale-c0ffee00/sources/slides-5a000000/source.json",
      "courses/thermodynamique-generale-c0ffee00/sources/slides-5a000000-0000-4000-8000-000000000004/source.json",
      "deleted/events.jsonl",
      "deleted/lessons.jsonl",
    ].sort());
    const files2 = encodeRecords(snapshot.records);
    expect(files2.get("courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/sources/notes-5a000000/text.md")).toBe(note.text);
    expect(files2.get("courses/thermodynamique-generale-c0ffee00/sources/slides-5a000000/pages.md")).toBe("<!-- amphi:page 1 -->\nFirst page\n<!-- amphi:page 2 -->\n\n<!-- amphi:page 3 -->\nThird\n\nwith lines\n\n");
    expect(files2.get("courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/sources/lecture-5a000000/transcript.md")).toBe("# Lecture\n\n[0:00] Hello\n[1:05] Entropy\n");
    expect(files2.get("courses/thermodynamique-generale-c0ffee00/lessons/entropy-1e550000/studio/report/summary-a7000000.md")).toBe("# Summary\n\n## Key points\n\n- one\n");
    expect(blobPath(pdfId, "application/pdf")).toBe(`blobs/${pdfId}.pdf`);
    expect(blobPath(pdfId, "audio/webm;codecs=opus")).toBe(`blobs/${pdfId}.weba`);
    expect(blobPath(pdfId, "x/unknown")).toBe(`blobs/${pdfId}.bin`);
  });

  test("deterministic: the same records in any order give the same bytes; key order does not matter", () => {
    const a = encodeRecords(snapshot.records);
    const shuffled = Object.fromEntries(Object.entries(snapshot.records).map(([t, rows]) => [t, [...rows].reverse().map((r) => Object.fromEntries(Object.entries(r).reverse()))]));
    const b = encodeRecords(shuffled);
    expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
    // A change to one record changes only its own files.
    const c = encodeRecords({ ...snapshot.records, chats: [{ ...chat, updatedAt: T + 50 } as Chat] });
    const changed = [...c.keys()].filter((k) => c.get(k) !== a.get(k));
    expect(changed).toEqual(["courses/thermodynamique-generale-c0ffee00/chats/questions-c4a70000.json"]);
  });

  test("classify, parts, blob references", () => {
    expect(classify("amphi.json")).toEqual({ kind: "header" });
    expect(classify("courses/x/course.json")).toEqual({ kind: "record", table: "courses" });
    expect(classify("courses/x/lessons/y/studio/quiz/q.json")).toEqual({ kind: "record", table: "artifacts" });
    expect(classify("deleted/sources.jsonl")).toEqual({ kind: "lines", table: "sources" });
    expect(classify("courses/x/unknown.jsonl")).toBeNull();
    expect(classify("README.md")).toBeNull();
    expect(classify(`blobs/${pdfId}.mp3`)).toEqual({ kind: "blob", id: pdfId, mime: "audio/mpeg" });
    expect(partsOf("courses/x/sources/s/source.json")).toEqual(["courses/x/sources/s/text.md", "courses/x/sources/s/pages.md", "courses/x/sources/s/transcript.json"]);
    expect([...blobRefs({ ...report, media: { audio: "b".repeat(64) }, blobId: pdfId })].sort()).toEqual([pdfId, "b".repeat(64)]);
  });

  test("untrusted files: bad JSON and invalid records are left out and reported", () => {
    const files = encode(snapshot);
    files.set("courses/evil/course.json", new TextEncoder().encode("{not json"));
    files.set("courses/evil2/course.json", new TextEncoder().encode(JSON.stringify({ id: 3, title: "x" })));
    files.set("deleted/courses.jsonl", new TextEncoder().encode('{"id":"z"}\n'));
    const back = decode(files);
    expect(back.problems.sort()).toEqual(["courses/evil/course.json", "courses/evil2/course.json", "deleted/courses.jsonl"]);
    expect(back.records.courses).toHaveLength(1);
  });
});
