// IndexedDB through idb: one store per table, a blob store keyed by content
// hash, and change notifications (this tab and the others) so screens re-read
// what they show.

import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { Base, BlobRecord, Id, Table, Tables } from "./schema.ts";
import { TABLES } from "./schema.ts";

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

export async function get<T extends Table>(table: T, id: Id): Promise<Tables[T] | undefined> {
  const r = (await (await db()).get(table, id)) as Tables[T] | undefined;
  return r && !r.deletedAt ? r : undefined;
}

/** Live records of a table, optionally through an index. */
export async function list<T extends Table>(table: T, index?: "courseId" | "lessonId", value?: Id): Promise<Tables[T][]> {
  const d = await db();
  const rows = (index && value !== undefined ? await d.getAllFromIndex(table as "sources", index as "courseId", value) : await d.getAll(table)) as Tables[T][];
  return rows.filter((r) => !r.deletedAt);
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

/** Delete a course or a topic and everything in it. */
export async function removeCourse(courseId: Id): Promise<void> {
  for (const table of TABLES) {
    if (table === "courses") continue;
    for (const r of await list(table, "courseId", courseId)) await remove(table, r.id);
  }
  await remove("courses", courseId);
}

/** Delete a lesson and what belongs to it alone. */
export async function removeLesson(lessonId: Id): Promise<void> {
  for (const table of ["sources", "chats", "artifacts"] as const) {
    for (const r of await list(table, "lessonId", lessonId)) await remove(table, r.id);
  }
  await remove("lessons", lessonId);
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

/** Ask the browser not to evict our data under storage pressure. */
export async function persist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false);
  } catch {
    return false;
  }
}
