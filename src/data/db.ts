// IndexedDB through idb: one store per table, a blob store keyed by content
// hash, and change notifications (this tab and the others) so screens re-read
// what they show.

import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Base, BlobRecord, Id, Table, Tables } from "./schema.ts";
import { TABLES, TRASH_DAYS } from "./schema.ts";

const NAME = "amphi";
const VERSION = 1;

interface AmphiDB extends DBSchema {
  courses: { key: string; value: Tables["courses"] };
  lessons: { key: string; value: Tables["lessons"]; indexes: { courseId: string } };
  sources: { key: string; value: Tables["sources"]; indexes: { courseId: string; lessonId: string } };
  chats: { key: string; value: Tables["chats"]; indexes: { courseId: string; lessonId: string } };
  artifacts: { key: string; value: Tables["artifacts"]; indexes: { courseId: string; lessonId: string } };
  concepts: { key: string; value: Tables["concepts"]; indexes: { courseId: string } };
  events: { key: string; value: Tables["events"]; indexes: { courseId: string } };
  blobs: { key: string; value: BlobRecord };
  meta: { key: string; value: unknown };
}

let opened: Promise<IDBPDatabase<AmphiDB>> | null = null;

export function db(): Promise<IDBPDatabase<AmphiDB>> {
  opened ??= openDB<AmphiDB>(NAME, VERSION, {
    upgrade(d) {
      d.createObjectStore("courses", { keyPath: "id" });
      d.createObjectStore("lessons", { keyPath: "id" }).createIndex("courseId", "courseId");
      for (const name of ["sources", "chats", "artifacts"] as const) {
        const s = d.createObjectStore(name, { keyPath: "id" });
        s.createIndex("courseId", "courseId");
        s.createIndex("lessonId", "lessonId");
      }
      d.createObjectStore("concepts", { keyPath: "id" }).createIndex("courseId", "courseId");
      d.createObjectStore("events", { keyPath: "id" }).createIndex("courseId", "courseId");
      d.createObjectStore("blobs", { keyPath: "id" });
      d.createObjectStore("meta");
    },
    blocking() {
      // A newer version opened in another tab: let it upgrade.
      void opened?.then((x) => x.close());
      opened = null;
    },
  });
  return opened;
}

/** For tests: forget the open connection (fake-indexeddb is reset between files). */
export function resetDbForTests() {
  opened = null;
}

// Change notifications. `changes` counts per table so hooks can tell what moved.
type Listener = (table: Table | "blobs") => void;
const listeners = new Set<Listener>();
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("amphi-db");
channel?.addEventListener("message", (e: MessageEvent<Table | "blobs">) => {
  for (const fn of listeners) fn(e.data);
});

export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(table: Table | "blobs") {
  for (const fn of listeners) fn(table);
  channel?.postMessage(table);
}

export const newId = (): Id => crypto.randomUUID();

/** A new record's base fields. */
export function fresh(now = Date.now()): Base {
  return { id: newId(), createdAt: now, updatedAt: now };
}

const live = (r: Base) => !r.deletedAt && !r.trashedAt;

export async function get<T extends Table>(table: T, id: Id): Promise<Tables[T] | undefined> {
  const r = await peek(table, id);
  return r && !r.trashedAt ? r : undefined;
}

/** A record, even in the trash (restoring it, a job finishing on it). */
export async function peek<T extends Table>(table: T, id: Id): Promise<Tables[T] | undefined> {
  const r = (await (await db()).get(table, id)) as Tables[T] | undefined;
  return r && !r.deletedAt ? r : undefined;
}

type Index = "courseId" | "lessonId";

/** Records of a table, optionally through an index; tombstones never, the trash only when asked. */
async function read<T extends Table>(table: T, index: Index | undefined, value: Id | undefined, trashed: boolean): Promise<Tables[T][]> {
  const d = await db();
  const rows = (index && value !== undefined ? await d.getAllFromIndex(table as "sources", index as "courseId", value) : await d.getAll(table)) as Tables[T][];
  return rows.filter((r) => (trashed ? !r.deletedAt : live(r)));
}

/** Live records of a table, optionally through an index. */
export function list<T extends Table>(table: T, index?: Index, value?: Id): Promise<Tables[T][]> {
  return read(table, index, value, false);
}

/** Every record, tombstones included (sync, export). */
export async function listAll<T extends Table>(table: T): Promise<Tables[T][]> {
  return (await (await db()).getAll(table)) as Tables[T][];
}

/** Write a record, stamping `updatedAt`. */
export async function put<T extends Table>(table: T, record: Tables[T]): Promise<Tables[T]> {
  const r = { ...record, updatedAt: Math.max(Date.now(), record.updatedAt + 1) } as Tables[T];
  await (await db()).put(table, r as never);
  changed(table);
  return r;
}

/** Change some fields of a record. */
export async function update<T extends Table>(table: T, id: Id, patch: Partial<Tables[T]>): Promise<Tables[T] | undefined> {
  const cur = await get(table, id);
  if (!cur) return undefined;
  return put(table, { ...cur, ...patch });
}

/** Write a record as it came from elsewhere (sync, import), keeping its times. */
export async function putRaw<T extends Table>(table: T, record: Tables[T]): Promise<void> {
  await (await db()).put(table, record as never);
  changed(table);
}

/** Delete as a tombstone, so the deletion syncs. */
export async function remove(table: Table, id: Id): Promise<void> {
  const d = await db();
  const cur = (await d.get(table, id)) as Base | undefined;
  if (!cur || cur.deletedAt) return;
  const now = Date.now();
  await d.put(table, { ...cur, deletedAt: now, updatedAt: Math.max(now, cur.updatedAt + 1) } as never);
  changed(table);
}

/** Delete a course or a topic and everything in it, the trash included. */
export async function removeCourse(courseId: Id): Promise<void> {
  for (const table of TABLES) {
    if (table === "courses") continue;
    for (const r of await read(table, "courseId", courseId, true)) await remove(table, r.id);
  }
  await remove("courses", courseId);
}

/** Delete a lesson and what belongs to it alone, the trash included. */
export async function removeLesson(lessonId: Id): Promise<void> {
  for (const table of LESSON_TABLES) {
    for (const r of await read(table, "lessonId", lessonId, true)) await remove(table, r.id);
  }
  await remove("lessons", lessonId);
}

// The trash. A course or a lesson goes with what is in it: each of those
// records carries the same `trashedAt` and the container's id, so restoring
// brings back exactly that batch, not what had been thrown away before.

const LESSON_TABLES = ["sources", "chats", "artifacts"] as const;
const DAY = 86_400_000;

function batchOf(table: Table): { tables: readonly Table[]; index: Index } | undefined {
  if (table === "courses") return { tables: TABLES.filter((t) => t !== "courses"), index: "courseId" };
  if (table === "lessons") return { tables: LESSON_TABLES, index: "lessonId" };
  return undefined;
}

function untrashed<R extends Base>(r: R): R {
  const copy = { ...r };
  delete copy.trashedAt;
  delete copy.trashedWith;
  return copy;
}

/** Move a record to the trash, with what is in it. False when there was nothing to move. */
export async function trash(table: Table, id: Id, now = Date.now()): Promise<boolean> {
  const cur = await get(table, id);
  if (!cur) return false;
  await put(table, { ...cur, trashedAt: now } as never);
  const batch = batchOf(table);
  if (batch) for (const t of batch.tables) for (const r of await list(t, batch.index, id)) await put(t, { ...r, trashedAt: now, trashedWith: id } as never);
  return true;
}

/** Take a record out of the trash with its batch; the course or lesson it sits in comes back first. */
export async function restore(table: Table, id: Id): Promise<void> {
  const cur = await peek(table, id);
  if (!cur?.trashedAt) return;
  if (cur.trashedWith) return restore((await peek("lessons", cur.trashedWith)) ? "lessons" : "courses", cur.trashedWith);
  const within = cur as Base & { courseId?: Id; lessonId?: Id };
  if (within.lessonId) await restore("lessons", within.lessonId);
  if (within.courseId && table !== "courses") await restore("courses", within.courseId);
  await put(table, untrashed(cur) as never);
  const batch = batchOf(table);
  if (!batch) return;
  for (const t of batch.tables) {
    for (const r of await read(t, batch.index, id, true)) if (r.trashedWith === id && r.trashedAt === cur.trashedAt) await put(t, untrashed(r) as never);
  }
}

export interface TrashEntry {
  table: Table;
  record: Tables[Table];
  /** Records that went with it. */
  items: number;
  /** When it is deleted for good. */
  purgeAt: number;
}

/** What the trash holds, newest first: the records thrown away, each with its batch counted. */
export async function listTrash(): Promise<TrashEntry[]> {
  const entries: TrashEntry[] = [];
  const items = new Map<Id, number>();
  for (const table of TABLES) {
    for (const r of await read(table, undefined, undefined, true)) {
      if (!r.trashedAt) continue;
      if (r.trashedWith) items.set(r.trashedWith, (items.get(r.trashedWith) ?? 0) + 1);
      else entries.push({ table, record: r, items: 0, purgeAt: r.trashedAt + TRASH_DAYS * DAY });
    }
  }
  for (const e of entries) e.items = items.get(e.record.id) ?? 0;
  return entries.sort((a, b) => b.record.trashedAt! - a.record.trashedAt!);
}

/** Delete for good something in the trash, with its batch. */
export async function purge(table: Table, id: Id): Promise<void> {
  if (!(await peek(table, id))?.trashedAt) return;
  if (table === "courses") return removeCourse(id);
  if (table === "lessons") return removeLesson(id);
  await remove(table, id);
}

/** Delete for good what has been in the trash for TRASH_DAYS, and what went with a container already gone. */
export async function purgeTrash(now = Date.now()): Promise<void> {
  for (const e of await listTrash()) if (e.purgeAt <= now) await purge(e.table, e.record.id);
  for (const table of TABLES) {
    for (const r of await read(table, undefined, undefined, true)) {
      if (r.trashedWith && !(await peek("courses", r.trashedWith)) && !(await peek("lessons", r.trashedWith))) await remove(table, r.id);
    }
  }
}

export async function emptyTrash(): Promise<void> {
  for (const e of await listTrash()) await purge(e.table, e.record.id);
}

async function sha256(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await data.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Keep a file; the same bytes are stored once. Returns its id. */
export async function putBlob(data: Blob, mime = data.type || "application/octet-stream"): Promise<Id> {
  const id = await sha256(data);
  const d = await db();
  if (!(await d.getKey("blobs", id))) {
    await d.put("blobs", { id, mime, size: data.size, data, createdAt: Date.now() });
    changed("blobs");
  }
  return id;
}

export async function getBlob(id: Id): Promise<BlobRecord | undefined> {
  return (await db()).get("blobs", id);
}

export async function listBlobIds(): Promise<Id[]> {
  return (await db()).getAllKeys("blobs");
}

export async function getMeta<V>(key: string): Promise<V | undefined> {
  return (await (await db()).get("meta", key)) as V | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put("meta", value, key);
}

export async function deleteMeta(key: string): Promise<void> {
  await (await db()).delete("meta", key);
}

/** Ask the browser not to evict our data under storage pressure. */
export async function persist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false);
  } catch {
    return false;
  }
}
