// Sync's view of this device's IndexedDB (src/data/db.ts).

import { getBlob, getMeta, listAll, listBlobIds, newId, putBlob, putRaw, setMeta } from "../data/db.ts";
import type { LocalStore } from "./engine.ts";

export const dbStore: LocalStore = {
  all: (table) => listAll(table),
  putRaw: (table, record) => putRaw(table, record as never),
  blobIds: () => listBlobIds(),
  async blobInfo(id) {
    const b = await getBlob(id);
    return b ? { mime: b.mime, size: b.size } : undefined;
  },
  async blobBytes(id) {
    const b = await getBlob(id);
    return b ? new Uint8Array(await b.data.arrayBuffer()) : undefined;
  },
  putBlob: (bytes, mime) => putBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }), mime),
  getMeta,
  setMeta,
  newId,
  now: () => Date.now(),
};
