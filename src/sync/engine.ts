// Two-way sync of this device with a repository, by Git blob sha.
//
// Each device keeps, per repository, a manifest (path → sha of the file last
// seen or written there, and the hash of its plain text) and the `updatedAt`
// of every record as last synced (its base). A round:
//   1. reads the branch's tree; files whose sha moved since the manifest were
//      changed by another device: they are fetched (decrypted) and read;
//   2. their records are merged into this device (below);
//   3. every record is written out again as files (src/sync/files.ts); a file
//      whose text is the one the repository holds is left alone, the others go
//      into ONE commit, with the files of records that moved or disappeared
//      removed. Media files are pushed and fetched once (they never change).
// When another device pushed meanwhile, the round starts again from its head.
//
// Merging a record known on both sides:
//   - only one side changed since the base: that side's version is kept;
//   - both changed (a conflict): the later `updatedAt` wins the whole record
//     (last writer wins), except that text bodies are never lost: a note's text
//     or a report's Markdown that loses is kept as a "conflict copy" beside the
//     winner, and a chat keeps the messages of both sides. A deletion and an
//     edit at once: the later wins, and a losing edited note survives as a copy.
// A file deleted by hand in the repository is written again (a deletion is a
// tombstone, made in amphi); files amphi does not know are left untouched.

import type { Base, Table } from "../data/schema.ts";
import { TABLES } from "../data/schema.ts";
import { tr } from "../i18n.ts";
import { type Keys, checkValue, decryptFile, deriveKeys, encryptFile, fromBase64, newSalt, objectName, PBKDF2_ITERATIONS, toBase64 } from "./crypto.ts";
import { blobPath, blobRefs, classify, decode, encodeRecords, FORMAT, HEADER, type Header, headerSchema, partsOf, type RecordsByTable, stableJson } from "./files.ts";
import { type Change, type GitHub, gitBlobSha, type Head, MAX_FILE_BYTES, SyncError } from "./github.ts";

export type Mode = "plain" | "encrypted";

/** What sync needs from this device's storage (src/sync/store.ts for IndexedDB). */
export interface LocalStore {
  all(table: Table): Promise<Base[]>;
  putRaw(table: Table, record: Base): Promise<void>;
  blobIds(): Promise<string[]>;
  blobInfo(id: string): Promise<{ mime: string; size: number } | undefined>;
  blobBytes(id: string): Promise<Uint8Array | undefined>;
  /** Stores bytes and returns their sha-256. */
  putBlob(bytes: Uint8Array, mime: string): Promise<string>;
  getMeta<V>(key: string): Promise<V | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  newId(): string;
  now(): number;
}

interface Entry {
  /** Git blob sha of the file as stored. */
  sha: string;
  /** Git blob sha of its plain text (the same as `sha` in plain mode). */
  plain: string;
  /** Encrypted mode: the object's name. */
  name?: string;
}

export interface SyncState {
  /** amphi.json's creation time: another value means another repository's history, and a fresh start. */
  created: number;
  header: Header;
  headerSha: string;
  manifest: Record<string, Entry>;
  /** `table/id` → updatedAt as last synced. */
  base: Record<string, number>;
  commit?: string;
}

export interface SyncOptions {
  gh: GitHub;
  store: LocalStore;
  /** Meta key of this repository's state on this device. */
  stateKey: string;
  /** For a repository amphi has not written to yet; an existing one says its own mode. */
  mode?: Mode;
  passphrase?: string;
  /** Push and fetch media files (PDF, audio, video). */
  media: boolean;
  iterations?: number;
  maxAttempts?: number;
  maxFileBytes?: number;
}

export interface SyncResult {
  mode: Mode;
  /** Records taken from the repository. */
  pulled: number;
  /** Files written to the repository. */
  pushed: number;
  conflicts: number;
  /** Media files too large for GitHub, kept on this device only. */
  skipped: { id: string; size: number }[];
  /** Files of the repository that could not be read. */
  problems: string[];
  commit?: string;
}

const enc = new TextEncoder();
const keyOf = (table: Table, id: string) => `${table}/${id}`;

// ---- merging

type Rec = Base & Record<string, unknown>;

function conflictCopy(table: Table, winner: Rec, loser: Rec, store: LocalStore): Rec | null {
  if (loser.deletedAt) return null;
  const textOf = (r: Rec) => (table === "sources" ? r.text : table === "artifacts" ? (r.data as { markdown?: unknown } | undefined)?.markdown : undefined);
  const lost = textOf(loser);
  if (typeof lost !== "string" || !lost.trim() || (!winner.deletedAt && lost === textOf(winner))) return null;
  const now = store.now();
  const copy: Rec = { ...loser, id: store.newId(), title: `${String(loser.title ?? "")} (${tr("conflict copy", "copie en conflit", "Konfliktkopie")})`, createdAt: now, updatedAt: now };
  delete copy.deletedAt;
  return copy;
}

type Message = { role: string; content: string; at: number };
function mergeMessages(a: Message[], b: Message[]): Message[] {
  const seen = new Map<string, Message>();
  for (const m of [...a, ...b]) seen.set(`${m.at}|${m.role}|${m.content}`, m);
  return [...seen.values()].sort((x, y) => x.at - y.at);
}

/**
 * Merges records from elsewhere into this device. With `base` (sync), a record changed on both sides is a conflict
 * (see the top of this file); without it (an import), the later `updatedAt` simply wins.
 */
export async function mergeRecords(store: LocalStore, incoming: RecordsByTable, base?: Record<string, number>): Promise<{ applied: number; conflicts: number }> {
  let applied = 0;
  let conflicts = 0;
  for (const table of TABLES) {
    const rows = incoming[table];
    if (!rows?.length) continue;
    const local = new Map((await store.all(table)).map((r) => [r.id, r as Rec]));
    for (const r of rows as Rec[]) {
      const cur = local.get(r.id);
      if (!cur) {
        await store.putRaw(table, r);
        applied++;
        continue;
      }
      if (cur.updatedAt === r.updatedAt) continue;
      const remoteWins = r.updatedAt > cur.updatedAt;
      const winner = remoteWins ? r : cur;
      const loser = remoteWins ? cur : r;
      let out = winner;
      const b = base?.[keyOf(table, r.id)];
      if (base && cur.updatedAt !== b && r.updatedAt !== b) {
        if (table === "chats" && !winner.deletedAt && !loser.deletedAt) {
          const messages = mergeMessages(winner.messages as Message[], loser.messages as Message[]);
          if (messages.length !== (winner.messages as Message[]).length) out = { ...winner, messages, updatedAt: Math.max(r.updatedAt, cur.updatedAt) + 1 };
        }
        const copy = conflictCopy(table, winner, loser, store);
        if (copy) {
          await store.putRaw(table, copy);
          conflicts++;
        } else if (out !== winner) conflicts++;
      }
      if (out !== cur) {
        await store.putRaw(table, out);
        applied++;
      }
    }
  }
  return { applied, conflicts };
}

// ---- keys

const keyCache = new Map<string, Promise<Keys>>();
async function keysFor(header: Header, passphrase: string | undefined): Promise<Keys> {
  if (!header.kdf || !header.check) throw new SyncError("format", "amphi.json has no key parameters");
  if (!passphrase) throw new SyncError("passphrase", "This repository is encrypted: its passphrase is needed");
  const id = `${header.kdf.salt}|${header.kdf.iterations}|${passphrase}`;
  let p = keyCache.get(id);
  if (!p) {
    p = deriveKeys(passphrase, fromBase64(header.kdf.salt), header.kdf.iterations);
    keyCache.set(id, p);
  }
  const keys = await p;
  if ((await checkValue(keys)) !== header.check) {
    keyCache.delete(id);
    throw new SyncError("passphrase", "Wrong passphrase for this repository");
  }
  return keys;
}

/** Whether a passphrase opens a repository (its amphi.json). */
export async function verifyPassphrase(header: Header, passphrase: string): Promise<boolean> {
  try {
    await keysFor(header, passphrase);
    return true;
  } catch (e) {
    if (e instanceof SyncError && e.kind === "passphrase") return false;
    throw e;
  }
}

/** A new amphi.json, with fresh key parameters in encrypted mode. */
export async function newHeader(mode: Mode, passphrase: string | undefined, now: number, iterations = PBKDF2_ITERATIONS): Promise<Header> {
  if (mode === "plain") return { format: FORMAT, mode, created: now };
  if (!passphrase) throw new SyncError("passphrase", "A passphrase is needed to encrypt");
  const salt = newSalt();
  const keys = await deriveKeys(passphrase, salt, iterations);
  const kdf = { name: "PBKDF2", hash: "SHA-256", iterations, salt: toBase64(salt) } as const;
  keyCache.set(`${kdf.salt}|${iterations}|${passphrase}`, Promise.resolve(keys));
  return { format: FORMAT, mode, created: now, kdf, check: await checkValue(keys) };
}

function parseHeader(bytes: Uint8Array): Header {
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SyncError("format", "amphi.json cannot be read");
  }
  const h = headerSchema.safeParse(v);
  if (!h.success) throw new SyncError("format", "amphi.json is not an amphi header");
  if (h.data.format !== FORMAT) throw new SyncError("format", `This repository was written by a newer amphi (${h.data.format})`);
  return h.data;
}

/** What a repository holds, read without changing anything: its mode, or null when amphi has not written there. */
export async function probe(gh: GitHub): Promise<Header | null> {
  const head = await gh.head();
  const f = head?.files.get(HEADER);
  return f ? parseHeader(await gh.read(f.sha)) : null;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++] as T);
    }),
  );
}

// ---- one round

async function round(o: SyncOptions): Promise<SyncResult> {
  const { gh, store } = o;
  const maxFile = o.maxFileBytes ?? MAX_FILE_BYTES;
  const head: Head | null = await gh.head();
  const remote = head?.files ?? new Map();
  let state = await store.getMeta<SyncState>(o.stateKey);
  const changes: Change[] = [];

  // amphi.json: the repository's mode, or a new one.
  let header: Header;
  let headerSha: string;
  const hf = remote.get(HEADER);
  if (hf) {
    header = state && state.headerSha === hf.sha ? state.header : parseHeader(await gh.read(hf.sha));
    headerSha = hf.sha;
  } else {
    if (!o.mode) throw new SyncError("setup", "Choose how to store your data in this repository");
    header = await newHeader(o.mode, o.passphrase, store.now(), o.iterations);
    const text = stableJson(header);
    headerSha = gitBlobSha(text);
    changes.push({ path: HEADER, text });
  }
  if (state && state.created !== header.created) state = undefined;
  const keys = header.mode === "encrypted" ? await keysFor(header, o.passphrase) : null;
  const manifest = state?.manifest ?? {};
  const base = state?.base ?? {};
  const byName = new Map<string, string>();
  if (keys) for (const [logical, e] of Object.entries(manifest)) if (e.name) byName.set(e.name, logical);

  // 1. The repository's files, as paths of the plain tree.
  const problems: string[] = [];
  const known = new Map<string, { stored: string; sha: string }>();
  const fetched = new Map<string, Uint8Array>();
  const remoteBlobs = new Map<string, string>(); // plain: blob id → path
  const toFetch: string[] = [];
  for (const [stored, f] of remote) {
    if (stored === HEADER) continue;
    if (keys) {
      if (stored.startsWith("media/")) continue;
      if (!stored.startsWith("objects/")) continue;
      const logical = byName.get(stored);
      if (logical && manifest[logical]?.sha === f.sha) known.set(logical, { stored, sha: f.sha });
      else toFetch.push(stored);
      continue;
    }
    const k = classify(stored);
    if (!k || k.kind === "header") continue;
    if (k.kind === "blob") {
      remoteBlobs.set(k.id, stored);
      continue;
    }
    known.set(stored, { stored, sha: f.sha });
    if (manifest[stored]?.sha !== f.sha) toFetch.push(stored);
  }
  const fetchOne = async (stored: string): Promise<void> => {
    const f = remote.get(stored);
    if (!f) return;
    const bytes = await gh.read(f.sha);
    if (!keys) {
      fetched.set(stored, bytes);
      return;
    }
    try {
      const { path, bytes: plain } = await decryptFile(keys, stored, bytes);
      known.set(path, { stored, sha: f.sha });
      fetched.set(path, plain);
    } catch {
      problems.push(stored);
    }
  };
  await pool(toFetch, 6, fetchOne);
  // A changed source.json is read with its text, pages and transcript, changed or not.
  const parts: string[] = [];
  for (const logical of fetched.keys()) {
    for (const p of partsOf(logical)) {
      if (fetched.has(p)) continue;
      const stored = keys ? (manifest[p]?.name ?? (await objectName(keys, p))) : p;
      if (remote.has(stored)) parts.push(stored);
    }
  }
  await pool(parts, 6, fetchOne);

  // 2. Merge.
  const incoming = decode(fetched);
  problems.push(...incoming.problems);
  const merged = await mergeRecords(store, incoming.records, base);
  let pulled = merged.applied;

  // 3. Everything as files again.
  const snapshot: RecordsByTable = {};
  for (const t of TABLES) snapshot[t] = await store.all(t);

  // Media: fetch what live records point to and this device lacks; push what the repository lacks.
  const skipped: { id: string; size: number }[] = [];
  const blobChanges: Change[] = [];
  if (o.media) {
    const refs = new Set<string>();
    for (const t of TABLES) for (const r of snapshot[t] ?? []) if (!r.deletedAt) blobRefs(r, refs);
    const local = new Set(await store.blobIds());
    const download: string[] = [];
    for (const id of refs) if (!local.has(id)) download.push(id);
    await pool(download, 3, async (id) => {
      const stored = keys ? await objectName(keys, `blobs/${id}`) : remoteBlobs.get(id);
      const f = stored ? remote.get(stored) : undefined;
      if (!stored || !f) return;
      let bytes = await gh.read(f.sha);
      let path = stored;
      if (keys) {
        try {
          ({ path, bytes } = await decryptFile(keys, stored, bytes));
        } catch {
          problems.push(stored);
          return;
        }
      }
      const k = classify(path);
      if (k?.kind !== "blob" || k.id !== id || (await store.putBlob(bytes, k.mime)) !== id) problems.push(stored);
      else pulled++;
    });
    for (const id of refs) {
      if (!local.has(id)) continue;
      const info = await store.blobInfo(id);
      if (!info) continue;
      const logical = blobPath(id, info.mime);
      const stored = keys ? await objectName(keys, logical) : (remoteBlobs.get(id) ?? logical);
      if (remote.has(stored)) continue;
      if (info.size > maxFile) {
        skipped.push({ id, size: info.size });
        continue;
      }
      const bytes = await store.blobBytes(id);
      if (!bytes) continue;
      blobChanges.push(keys ? { path: stored, bytes: (await encryptFile(keys, logical, bytes)).bytes } : { path: logical, bytes });
    }
  }

  const files = encodeRecords(snapshot);
  const next: Record<string, Entry> = {};
  for (const [logical, text] of files) {
    const plain = gitBlobSha(text);
    const name = keys ? (manifest[logical]?.name ?? (await objectName(keys, logical))) : undefined;
    const stored = name ?? logical;
    const r = remote.get(stored);
    const m = manifest[logical];
    const got = fetched.get(logical);
    if (r && ((m && m.plain === plain && m.sha === r.sha) || (got && gitBlobSha(got) === plain) || (!keys && r.sha === plain))) {
      next[logical] = { sha: r.sha, plain, ...(name ? { name } : {}) };
      continue;
    }
    if (keys && name) {
      const b64 = toBase64((await encryptFile(keys, logical, enc.encode(text))).bytes);
      changes.push({ path: name, text: b64 });
      next[logical] = { sha: gitBlobSha(b64), plain, name };
    } else {
      changes.push({ path: logical, text });
      next[logical] = { sha: plain, plain };
    }
  }
  // Files of records that moved (a renamed course) or became tombstones.
  for (const [logical, { stored }] of known) {
    const k = classify(logical);
    if (!k || k.kind === "blob" || k.kind === "header" || files.has(logical)) continue;
    changes.push({ path: stored, remove: true });
  }
  changes.push(...blobChanges);

  let commit = head?.commit;
  if (changes.length) {
    commit = await gh.commit(head, changes, (n) => `amphi: ${n} ${n === 1 ? "file" : "files"}`);
  }
  const nextBase: Record<string, number> = {};
  for (const t of TABLES) for (const r of snapshot[t] ?? []) nextBase[keyOf(t, r.id)] = r.updatedAt;
  await store.setMeta(o.stateKey, { created: header.created, header, headerSha, manifest: next, base: nextBase, commit } satisfies SyncState);
  return { mode: header.mode, pulled, pushed: changes.length, conflicts: merged.conflicts, skipped, problems, commit };
}

/** Syncs once; starts again (a few times) when another device pushed during the round. */
export async function sync(o: SyncOptions): Promise<SyncResult> {
  const max = o.maxAttempts ?? 5;
  for (let attempt = 1; ; attempt++) {
    try {
      return await round(o);
    } catch (e) {
      if (!(e instanceof SyncError) || e.kind !== "conflict" || attempt >= max) throw e;
    }
  }
}

/** Records changed on this device since its last sync with this repository. */
export async function pendingChanges(store: LocalStore, stateKey: string): Promise<number> {
  const state = await store.getMeta<SyncState>(stateKey);
  const base = state?.base ?? {};
  let n = 0;
  for (const t of TABLES) for (const r of await store.all(t)) if (base[keyOf(t, r.id)] !== r.updatedAt) n++;
  return n;
}
