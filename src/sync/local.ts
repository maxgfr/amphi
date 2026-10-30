// The same file tree as GitHub (src/sync/files.ts), on this computer: a zip
// to download and import anywhere, and a mirror in a folder through the File
// System Access API (Chromium browsers only). Both are plain, never encrypted:
// they stay on the user's own disk.
//
// What comes back in (a zip, a folder) is untrusted: paths are checked, sizes
// capped before unpacking, every record checked by its schema (files.ts) and
// every file by its hash, then merged by `updatedAt`.

import type { Table } from "../data/schema.ts";
import { TABLES } from "../data/schema.ts";
import { mergeRecords, type LocalStore } from "./engine.ts";
import { blobPath, blobRefs, classify, decode, encode, encodeRecords, FORMAT, HEADER, type Header, headerSchema, type RecordsByTable, type Snapshot } from "./files.ts";

/** Biggest backup read back, unpacked. */
export const MAX_IMPORT_BYTES = 4 * 1000 * 1000 * 1000;

export interface ImportReport {
  records: number;
  files: number;
  /** Entries left out: unreadable, invalid or with a wrong hash. */
  problems: string[];
}

export class ImportError extends Error {
  override name = "ImportError";
}

async function recordsOf(store: LocalStore): Promise<RecordsByTable> {
  const out: RecordsByTable = {};
  for (const t of TABLES) out[t as Table] = await store.all(t);
  return out;
}

/** Blob ids live records point to, that this device has. */
async function liveBlobs(store: LocalStore, records: RecordsByTable): Promise<string[]> {
  const refs = new Set<string>();
  for (const t of TABLES) for (const r of records[t] ?? []) if (!r.deletedAt) blobRefs(r, refs);
  const have = new Set(await store.blobIds());
  return [...refs].filter((id) => have.has(id)).sort();
}

const header = (now: number): Header => ({ format: FORMAT, mode: "plain", created: now });

/** Everything, files included, as one zip. */
export async function exportZip(store: LocalStore): Promise<Blob> {
  const { zipSync } = await import("fflate");
  const records = await recordsOf(store);
  const snapshot: Snapshot = { records, blobs: [] };
  for (const id of await liveBlobs(store, records)) {
    const [info, bytes] = await Promise.all([store.blobInfo(id), store.blobBytes(id)]);
    if (info && bytes) snapshot.blobs.push({ id, mime: info.mime, bytes });
  }
  const files = encode(snapshot, header(store.now()));
  // Media are compressed already: stored as they are.
  const tree = Object.fromEntries([...files].map(([p, b]) => [p, [b, { level: p.startsWith("blobs/") ? 0 : 6 }] as const]));
  return new Blob([zipSync(tree as never) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
}

const safePath = (p: string) => p.length <= 400 && !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((s) => s === ".." || s === ".") && !p.includes("\0");

/** The tree may sit at the zip's root or inside one top folder (a zip made by hand). */
function rooted(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  if (files.has(HEADER)) return files;
  const top = [...files.keys()].find((p) => p.endsWith(`/${HEADER}`) && p.split("/").length === 2);
  if (!top) throw new ImportError("This is not an amphi backup: amphi.json is missing");
  const prefix = top.slice(0, -HEADER.length);
  return new Map([...files].filter(([p]) => p.startsWith(prefix)).map(([p, b]) => [p.slice(prefix.length), b]));
}

/** Merges a tree of files into this device. */
export async function importTree(store: LocalStore, raw: Map<string, Uint8Array>): Promise<ImportReport> {
  const files = rooted(raw);
  let h: unknown;
  try {
    h = JSON.parse(new TextDecoder().decode(files.get(HEADER)));
  } catch {
    throw new ImportError("amphi.json cannot be read");
  }
  const parsed = headerSchema.safeParse(h);
  if (!parsed.success) throw new ImportError("amphi.json is not an amphi header");
  if (parsed.data.format !== FORMAT) throw new ImportError(`This backup was made by a newer amphi (${parsed.data.format})`);
  if (parsed.data.mode !== "plain") throw new ImportError("This folder is encrypted: connect it as a GitHub repository instead");
  const decoded = decode(files);
  const problems = [...decoded.problems];
  let n = 0;
  for (const b of decoded.blobs) {
    if ((await store.putBlob(b.bytes, b.mime)) === b.id) n++;
    else problems.push(blobPath(b.id, b.mime));
  }
  const { applied } = await mergeRecords(store, decoded.records);
  return { records: applied, files: n, problems };
}

export async function importZip(store: LocalStore, file: Blob): Promise<ImportReport> {
  if (file.size > MAX_IMPORT_BYTES) throw new ImportError("This file is too large");
  const { unzipSync } = await import("fflate");
  let total = 0;
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        if (!safePath(f.name)) throw new ImportError(`Unsafe path in the zip: ${f.name.slice(0, 80)}`);
        total += f.originalSize;
        if (total > MAX_IMPORT_BYTES) throw new ImportError("This backup is too large once unpacked");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError("This file is not a zip");
  }
  return importTree(store, new Map(Object.entries(out)));
}

// ---- a folder on this computer (Chromium)

type Dir = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "readwrite" }): Promise<PermissionState>;
};

export const folderSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const pick = (window as unknown as { showDirectoryPicker(o: { mode: "readwrite"; id?: string }): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  return pick({ mode: "readwrite", id: "amphi" });
}

/** Asks again for access to a folder chosen in an earlier visit (needs a click). */
export async function allowed(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const d = dir as Dir;
  if ((await d.queryPermission?.({ mode: "readwrite" })) === "granted") return true;
  return (await d.requestPermission?.({ mode: "readwrite" })) === "granted";
}

async function walk(dir: Dir, base = "", out = new Map<string, FileSystemFileHandle>()): Promise<Map<string, FileSystemFileHandle>> {
  for await (const h of dir.values()) {
    if (h.name.startsWith(".")) continue;
    if (h.kind === "file") out.set(base + h.name, h as FileSystemFileHandle);
    else await walk(h as Dir, `${base}${h.name}/`, out);
  }
  return out;
}

async function fileAt(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
  const segs = path.split("/");
  let d = root;
  for (const s of segs.slice(0, -1)) d = await d.getDirectoryHandle(s, { create: true });
  return d.getFileHandle(segs.at(-1) ?? "", { create: true });
}

async function removeAt(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const segs = path.split("/");
  const dirs: FileSystemDirectoryHandle[] = [root];
  for (const s of segs.slice(0, -1)) dirs.push(await (dirs.at(-1) as FileSystemDirectoryHandle).getDirectoryHandle(s));
  await (dirs.at(-1) as FileSystemDirectoryHandle).removeEntry(segs.at(-1) ?? "");
  // Folders left empty go too.
  for (let i = segs.length - 2; i >= 0; i--) {
    const d = dirs[i + 1] as Dir;
    for await (const _ of d.values()) return;
    await (dirs[i] as FileSystemDirectoryHandle).removeEntry(segs[i] ?? "");
  }
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Makes the folder hold this device's data: changed files written, files of deleted or moved records removed. */
export async function writeFolder(store: LocalStore, dir: FileSystemDirectoryHandle): Promise<{ written: number; removed: number }> {
  const existing = await walk(dir as Dir);
  const records = await recordsOf(store);
  const enc = new TextEncoder();
  const want = new Map<string, Uint8Array>();
  const prev = existing.get(HEADER);
  want.set(HEADER, prev ? new Uint8Array(await (await prev.getFile()).arrayBuffer()) : enc.encode(`${JSON.stringify(header(store.now()), null, 2)}\n`));
  for (const [p, text] of encodeRecords(records)) want.set(p, enc.encode(text));
  let written = 0;
  let removed = 0;
  const write = async (path: string, bytes: Uint8Array) => {
    const w = await (await fileAt(dir, path)).createWritable();
    await w.write(bytes as Uint8Array<ArrayBuffer>);
    await w.close();
    written++;
  };
  for (const [p, bytes] of want) {
    const h = existing.get(p);
    if (h && same(new Uint8Array(await (await h.getFile()).arrayBuffer()), bytes)) continue;
    await write(p, bytes);
  }
  const blobs = new Set<string>();
  for (const id of await liveBlobs(store, records)) {
    const info = await store.blobInfo(id);
    if (!info) continue;
    const p = blobPath(id, info.mime);
    blobs.add(p);
    if (existing.has(p)) continue;
    const bytes = await store.blobBytes(id);
    if (bytes) await write(p, bytes);
  }
  for (const p of existing.keys()) {
    const k = classify(p);
    if (!k || k.kind === "header" || k.kind === "blob" || want.has(p)) continue;
    await removeAt(dir, p);
    removed++;
  }
  return { written, removed };
}

/** Merges what a folder holds into this device. */
export async function readFolder(store: LocalStore, dir: FileSystemDirectoryHandle): Promise<ImportReport> {
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const [p, h] of await walk(dir as Dir)) {
    if (!classify(p)) continue;
    const f = await h.getFile();
    total += f.size;
    if (total > MAX_IMPORT_BYTES) throw new ImportError("This folder is too large");
    files.set(p, new Uint8Array(await f.arrayBuffer()));
  }
  return importTree(store, files);
}
