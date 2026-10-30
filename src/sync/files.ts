// The one file format of sync: the records and files as a tree of readable
// files, written the same way to a GitHub repository, a local folder and a zip.
//
//   amphi.json                                   format, mode (plain or encrypted), creation time
//   courses/<title>-<id8>/course.json
//   courses/<c>/lessons/<title>-<id8>/lesson.json
//   courses/<c>[/lessons/<l>]/sources/<title>-<id8>/source.json
//                                    …/text.md        the note's or web page's text, exactly
//                                    …/pages.md       a PDF's text, one `<!-- amphi:page n -->` block per page
//                                    …/transcript.json + transcript.md (a readable copy)
//   courses/<c>[/lessons/<l>]/chats/<title>-<id8>.json + .md (a readable copy)
//   courses/<c>[/lessons/<l>]/studio/<type>/<title>-<id8>.json + .md when it has Markdown or a script
//   courses/<c>/<table>.jsonl                    every other table (concepts, events, tables added later): one record per line
//   deleted/<table>.jsonl                        tombstones, reduced to id and times, so deletions reach every device
//   blobs/<sha256>.<ext>                         the original files (PDF, audio, video), named by their hash
//
// Files live in blobs/ rather than beside their source: one file can belong
// to several records (the hash dedupes it), and renaming a course moves only
// small JSON files, never a 90 MB recording.
//
// Output is deterministic (keys sorted, records in id order, dates in UTC), so
// an unchanged record gives byte-identical files and the same Git blob.
// Readable copies (*.md beside a .json) are written but never read back.

import { z } from "zod";
import type { Base, Table } from "../data/schema.ts";
import { TABLES } from "../data/schema.ts";

export const FORMAT = "amphi/1";
export const HEADER = "amphi.json";

export type RecordsByTable = Partial<Record<Table, Base[]>>;
export interface FileBlob {
  id: string;
  mime: string;
  bytes: Uint8Array;
}
export interface Snapshot {
  records: RecordsByTable;
  blobs: FileBlob[];
}

export const headerSchema = z.object({
  format: z.string(),
  mode: z.enum(["plain", "encrypted"]),
  created: z.number(),
  kdf: z.object({ name: z.literal("PBKDF2"), hash: z.literal("SHA-256"), iterations: z.number().int().min(1), salt: z.string() }).optional(),
  check: z.string().optional(),
});
export type Header = z.infer<typeof headerSchema>;

type Rec = Base & Record<string, unknown>;

// ---- JSON, deterministic

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

/** Pretty JSON with sorted keys and a final newline. */
export const stableJson = (v: unknown): string => `${JSON.stringify(sortKeys(v), null, 2)}\n`;
const line = (v: unknown): string => JSON.stringify(sortKeys(v));

// ---- names

const SAFE_ID = /[^A-Za-z0-9_-]/g;
const safeId = (id: string) => id.replace(SAFE_ID, "_") || "_";
const short = (id: string) => id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase() || "_";

function slug(s: unknown): string {
  const out = String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return out || "untitled";
}

const byId = (a: Base, b: Base) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ---- blobs

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/html": "html",
  "text/csv": "csv",
  "application/json": "json",
  "application/zip": "zip",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/epub+zip": "epub",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/ogg": "ogv",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/octet-stream": "bin",
};
const MIME = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));

/** The type without parameters ("audio/webm;codecs=opus" → "audio/webm"): what an extension can say. */
export const baseMime = (mime: string) => mime.split(";")[0]?.trim().toLowerCase() ?? "";

/** Where a file goes: its hash, and an extension so it opens with a double click. Unknown types become .bin. */
export const blobPath = (id: string, mime: string) => `blobs/${id}.${EXT[baseMime(mime)] ?? "bin"}`;

// ---- what a path holds

export type PathKind =
  | { kind: "record"; table: Table }
  | { kind: "lines"; table: Table }
  | { kind: "part" }
  | { kind: "copy" }
  | { kind: "blob"; id: string; mime: string }
  | { kind: "header" };

const L = "courses/[^/]+(?:/lessons/[^/]+)?";
const PATTERNS: [RegExp, (m: RegExpExecArray) => PathKind | null][] = [
  [/^amphi\.json$/, () => ({ kind: "header" })],
  [/^courses\/[^/]+\/course\.json$/, () => ({ kind: "record", table: "courses" })],
  [/^courses\/[^/]+\/lessons\/[^/]+\/lesson\.json$/, () => ({ kind: "record", table: "lessons" })],
  [new RegExp(`^${L}/sources/[^/]+/source\\.json$`), () => ({ kind: "record", table: "sources" })],
  [new RegExp(`^${L}/sources/[^/]+/(?:text\\.md|pages\\.md|transcript\\.json)$`), () => ({ kind: "part" })],
  [new RegExp(`^${L}/sources/[^/]+/transcript\\.md$`), () => ({ kind: "copy" })],
  [new RegExp(`^${L}/chats/[^/]+\\.json$`), () => ({ kind: "record", table: "chats" })],
  [new RegExp(`^${L}/chats/[^/]+\\.md$`), () => ({ kind: "copy" })],
  [new RegExp(`^${L}/studio/[^/]+/[^/]+\\.json$`), () => ({ kind: "record", table: "artifacts" })],
  [new RegExp(`^${L}/studio/[^/]+/[^/]+\\.md$`), () => ({ kind: "copy" })],
  [/^(?:courses\/[^/]+\/|deleted\/)?([a-z][a-z0-9_]*)\.jsonl$/, (m) => ((TABLES as readonly string[]).includes(m[1] ?? "") ? { kind: "lines", table: m[1] as Table } : null)],
  [/^blobs\/([0-9a-f]{64})(?:\.([a-z0-9]{1,8}))?$/, (m) => ({ kind: "blob", id: m[1] ?? "", mime: MIME[m[2] ?? ""] ?? "application/octet-stream" })],
];

/** What a file of the tree is, or null for a file amphi does not know (left alone). */
export function classify(path: string): PathKind | null {
  for (const [re, f] of PATTERNS) {
    const m = re.exec(path);
    if (m) return f(m);
  }
  return null;
}

const SOURCE_PARTS = ["text.md", "pages.md", "transcript.json"];

/** The other files a record file needs to be read (a source's text, pages and transcript). */
export function partsOf(path: string): string[] {
  if (!path.endsWith("/source.json")) return [];
  const dir = path.slice(0, -"source.json".length);
  return SOURCE_PARTS.map((p) => dir + p);
}

// ---- readable copies

const PAGE = /^<!-- amphi:page (\d+) -->$/m;
const pageMark = (n: number) => `<!-- amphi:page ${n} -->`;

/** Pages go to pages.md only when it reads back exactly. */
function pagesFit(pages: unknown): pages is { n: number; text: string }[] {
  return (
    Array.isArray(pages) &&
    pages.every((p) => p && typeof p === "object" && Object.keys(p).length === 2 && Number.isInteger((p as { n: unknown }).n) && (p as { n: number }).n >= 0 && typeof (p as { text: unknown }).text === "string" && !PAGE.test((p as { text: string }).text))
  );
}
const pagesMd = (pages: { n: number; text: string }[]) => pages.map((p) => `${pageMark(p.n)}\n${p.text}\n`).join("");

function readPages(md: string): { n: number; text: string }[] {
  const re = new RegExp(PAGE.source, "gm");
  const marks: { n: number; at: number; end: number }[] = [];
  for (let m = re.exec(md); m; m = re.exec(md)) marks.push({ n: Number(m[1]), at: m.index, end: m.index + m[0].length + 1 });
  return marks.map((m, i) => ({ n: m.n, text: md.slice(m.end, (marks[i + 1]?.at ?? md.length) - 1) }));
}

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const iso = (ms: unknown) => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : "");

function transcriptMd(title: unknown, t: { segments?: { start: number; text: string }[] }): string {
  const lines = (t.segments ?? []).map((s) => `[${clock(s.start)}] ${s.text.trim()}`);
  return `# ${String(title ?? "")}\n\n${lines.join("\n")}\n`;
}

function chatMd(c: Rec): string {
  const parts = [`# ${String(c.title ?? "")}`];
  if (typeof c.summary === "string" && c.summary) parts.push(`## Summary\n\n${c.summary.trim()}`);
  for (const m of (c.messages as { role: string; content: string; at: number }[] | undefined) ?? []) {
    parts.push(`**${m.role === "user" ? "You" : "amphi"}** · ${iso(m.at)}\n\n${String(m.content ?? "").trim()}`);
  }
  return `${parts.join("\n\n")}\n`;
}

/** The text an artifact can be read as, when it has one. */
function artifactText(a: Rec): string | null {
  const d = a.data as Record<string, unknown> | null | undefined;
  if (!d || typeof d !== "object") return null;
  for (const k of ["markdown", "script", "text"]) if (typeof d[k] === "string" && d[k]) return d[k] as string;
  return null;
}

// ---- model → files

const tombstone = (r: Base): Base => ({ id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, deletedAt: r.deletedAt });

/** Every record as files (text), blobs aside. */
export function encodeRecords(records: RecordsByTable): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  /** A folder or file name of its own: on the rare clash of title and 8-character id, the full id. */
  const unique = (path: string, id: string, full: () => string) => {
    const p = taken.has(path) ? full() : path;
    taken.add(p);
    return p;
  };
  const all = (t: Table) => [...((records[t] ?? []) as Rec[])].sort(byId);
  const live = (t: Table) => all(t).filter((r) => !r.deletedAt);

  const courseDirs = new Map<string, string>();
  for (const c of live("courses")) {
    const name = slug(c.title);
    const dir = unique(`courses/${name}-${short(c.id)}`, c.id, () => `courses/${name}-${safeId(c.id)}`);
    courseDirs.set(c.id, dir);
    out.set(`${dir}/course.json`, stableJson(c));
  }
  const courseDir = (id: unknown) => courseDirs.get(String(id)) ?? `courses/${short(String(id))}`;

  const lessonDirs = new Map<string, string>();
  for (const l of live("lessons")) {
    const name = slug(l.title);
    const base = `${courseDir(l.courseId)}/lessons`;
    const dir = unique(`${base}/${name}-${short(l.id)}`, l.id, () => `${base}/${name}-${safeId(l.id)}`);
    lessonDirs.set(l.id, dir);
    out.set(`${dir}/lesson.json`, stableJson(l));
  }
  const parentDir = (r: Rec) => {
    if (typeof r.lessonId !== "string" || !r.lessonId) return courseDir(r.courseId);
    return lessonDirs.get(r.lessonId) ?? `${courseDir(r.courseId)}/lessons/${short(r.lessonId)}`;
  };

  for (const s of live("sources")) {
    const name = slug(s.title);
    const base = `${parentDir(s)}/sources`;
    const dir = unique(`${base}/${name}-${short(s.id)}`, s.id, () => `${base}/${name}-${safeId(s.id)}`);
    const { text, pages, transcript, ...rest } = s;
    const json: Record<string, unknown> = rest;
    if (typeof text === "string") out.set(`${dir}/text.md`, text);
    else if (text !== undefined) json.text = text;
    if (pages !== undefined) {
      if (pagesFit(pages)) out.set(`${dir}/pages.md`, pagesMd(pages));
      else json.pages = pages;
    }
    if (transcript !== undefined && transcript !== null && typeof transcript === "object") {
      out.set(`${dir}/transcript.json`, stableJson(transcript));
      out.set(`${dir}/transcript.md`, transcriptMd(s.title, transcript as { segments?: { start: number; text: string }[] }));
    } else if (transcript !== undefined) json.transcript = transcript;
    out.set(`${dir}/source.json`, stableJson(json));
  }

  for (const c of live("chats")) {
    const name = slug(c.title);
    const base = `${parentDir(c)}/chats`;
    const file = unique(`${base}/${name}-${short(c.id)}`, c.id, () => `${base}/${name}-${safeId(c.id)}`);
    out.set(`${file}.json`, stableJson(c));
    out.set(`${file}.md`, chatMd(c));
  }

  for (const a of live("artifacts")) {
    const name = slug(a.title);
    const base = `${parentDir(a)}/studio/${slug(a.type)}`;
    const file = unique(`${base}/${name}-${short(a.id)}`, a.id, () => `${base}/${name}-${safeId(a.id)}`);
    out.set(`${file}.json`, stableJson(a));
    const text = artifactText(a);
    if (text) out.set(`${file}.md`, `# ${String(a.title ?? "")}\n\n${text.trim()}\n`);
  }

  // Every other table, the ones added later included: JSON lines per course.
  const dedicated = new Set<Table>(["courses", "lessons", "sources", "chats", "artifacts"]);
  for (const t of TABLES) {
    const lines = new Map<string, string[]>();
    const add = (path: string, r: unknown) => {
      const ls = lines.get(path) ?? [];
      ls.push(line(r));
      lines.set(path, ls);
    };
    for (const r of all(t)) {
      if (r.deletedAt) add(`deleted/${t}.jsonl`, tombstone(r));
      else if (!dedicated.has(t)) add(typeof r.courseId === "string" ? `${courseDir(r.courseId)}/${t}.jsonl` : `${t}.jsonl`, r);
    }
    for (const [path, ls] of lines) out.set(path, `${ls.join("\n")}\n`);
  }
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

/** Records and blobs as one file tree (zip, local folder). */
export function encode(s: Snapshot, header?: Header): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (header) out.set(HEADER, enc.encode(stableJson(header)));
  for (const [p, text] of encodeRecords(s.records)) out.set(p, enc.encode(text));
  for (const b of s.blobs) out.set(blobPath(b.id, b.mime), b.bytes);
  return out;
}

// ---- files → model (untrusted: every record is checked)

const base = z.looseObject({ id: z.string().min(1).max(200), createdAt: z.number(), updatedAt: z.number(), deletedAt: z.number().optional() });
const inCourse = base.extend({ courseId: z.string().min(1) });
const SCHEMAS: Partial<Record<Table, z.ZodType>> = {
  courses: base.extend({ title: z.string() }),
  lessons: inCourse.extend({ title: z.string(), order: z.number() }),
  sources: inCourse.extend({ title: z.string(), kind: z.string(), status: z.string() }),
  chats: inCourse.extend({ title: z.string(), messages: z.array(z.looseObject({ role: z.string(), content: z.string(), at: z.number() })) }),
  artifacts: inCourse.extend({ title: z.string(), type: z.string(), sourceIds: z.array(z.string()) }),
};

/** A record as read from a file, or null when it is not one. Tombstones need only their id and times. */
export function checkRecord(table: Table, v: unknown): Base | null {
  const schema = (v as Base | null)?.deletedAt !== undefined ? base : (SCHEMAS[table] ?? base);
  const r = schema.safeParse(v);
  return r.success ? (r.data as Base) : null;
}

export interface Decoded extends Snapshot {
  /** Files that could not be read (bad JSON, invalid records), left out. */
  problems: string[];
}

/** A file tree back to records and blobs. Works on part of a tree too: a source.json is read with the parts present. */
export function decode(files: Map<string, Uint8Array>): Decoded {
  const records: RecordsByTable = {};
  const blobs: FileBlob[] = [];
  const problems: string[] = [];
  const text = (p: string) => {
    const b = files.get(p);
    return b === undefined ? undefined : dec.decode(b);
  };
  const add = (table: Table, v: unknown, path: string) => {
    const r = checkRecord(table, v);
    if (!r) return problems.push(path);
    (records[table] ??= []).push(r);
  };
  for (const [path, bytes] of files) {
    const k = classify(path);
    if (!k) continue;
    try {
      if (k.kind === "blob") blobs.push({ id: k.id, mime: k.mime, bytes });
      else if (k.kind === "lines") {
        for (const l of dec.decode(bytes).split("\n")) if (l.trim()) add(k.table, JSON.parse(l), path);
      } else if (k.kind === "record") {
        const v = JSON.parse(dec.decode(bytes)) as Record<string, unknown>;
        if (k.table === "sources" && v && typeof v === "object") {
          const dir = path.slice(0, -"source.json".length);
          const body = text(`${dir}text.md`);
          if (body !== undefined) v.text = body;
          const pages = text(`${dir}pages.md`);
          if (pages !== undefined) v.pages = readPages(pages);
          const tr = text(`${dir}transcript.json`);
          if (tr !== undefined) v.transcript = JSON.parse(tr);
        }
        add(k.table, v, path);
      }
    } catch {
      problems.push(path);
    }
  }
  for (const t of Object.keys(records) as Table[]) records[t]?.sort(byId);
  return { records, blobs, problems };
}

/** Blob ids a record points to (a source's file, an artifact's media…): any string that is a sha-256. */
export function blobRefs(r: unknown, out = new Set<string>()): Set<string> {
  if (typeof r === "string") {
    if (/^[0-9a-f]{64}$/.test(r)) out.add(r);
  } else if (Array.isArray(r)) for (const x of r) blobRefs(x, out);
  else if (r && typeof r === "object") for (const x of Object.values(r)) blobRefs(x, out);
  return out;
}

/** Tombstones as files keep only their id and times: the model a round trip gives back. */
export const normalize = (r: Base): Base => (r.deletedAt ? tombstone(r) : r);
