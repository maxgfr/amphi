// For tests only: one device's storage, in memory, as sync sees it.

import type { Base, Table } from "../data/schema.ts";
import { hex } from "./crypto.ts";
import type { LocalStore } from "./engine.ts";

/** One device's storage, in memory. */
export class Device implements LocalStore {
  readonly rows = new Map<Table, Map<string, Base>>();
  readonly blobs = new Map<string, { mime: string; bytes: Uint8Array }>();
  readonly meta = new Map<string, unknown>();
  async all(table: Table) {
    return [...(this.rows.get(table)?.values() ?? [])].map((r) => structuredClone(r));
  }
  async putRaw(table: Table, r: Base) {
    if (!this.rows.has(table)) this.rows.set(table, new Map());
    this.rows.get(table)?.set(r.id, structuredClone(r));
  }
  async blobIds() {
    return [...this.blobs.keys()];
  }
  async blobInfo(id: string) {
    const b = this.blobs.get(id);
    return b ? { mime: b.mime, size: b.bytes.length } : undefined;
  }
  async blobBytes(id: string) {
    return this.blobs.get(id)?.bytes;
  }
  async putBlob(bytes: Uint8Array, mime: string) {
    const id = hex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
    if (!this.blobs.has(id)) this.blobs.set(id, { mime, bytes });
    return id;
  }
  async getMeta<V>(key: string) {
    return this.meta.get(key) as V | undefined;
  }
  async setMeta(key: string, v: unknown) {
    this.meta.set(key, structuredClone(v));
  }
  newId = () => crypto.randomUUID();
  now = () => Date.now();
  /** An edit made in the app: `updatedAt` moves on. */
  edit<R extends Base>(table: Table, r: R): R {
    const cur = this.rows.get(table)?.get(r.id);
    const next = { ...r, updatedAt: Math.max(Date.now(), (cur?.updatedAt ?? 0) + 1) };
    void this.putRaw(table, next);
    return next;
  }
  get<R extends Base>(table: Table, id: string): R | undefined {
    return this.rows.get(table)?.get(id) as R | undefined;
  }
  live(table: Table) {
    return [...(this.rows.get(table)?.values() ?? [])].filter((r) => !r.deletedAt);
  }
}
