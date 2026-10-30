// When sync runs and what it says. Light on purpose (the shell imports it for
// its status icon): the engine, GitHub client and crypto load on first sync.
//
// Automatic sync, when on: at start, ~30 s after the last change, when the
// page is hidden (the user leaves), when the network comes back, and after a
// rate limit's wait. One sync at a time across tabs (Web Locks).

import { useSyncExternalStore } from "react";
import { getMeta, onChange, setMeta } from "../data/db.ts";
import { getSecret } from "../secrets.ts";
import type { Mode, SyncResult } from "./engine.ts";
import type { SyncErrorKind } from "./github.ts";

export interface SyncConfig {
  owner: string;
  repo: string;
  /** "" for the repository's default branch. */
  branch: string;
  folder: string;
  /** For a repository amphi has not written to yet; the repository's amphi.json decides otherwise. */
  mode: Mode;
  media: boolean;
  auto: boolean;
}

export const TOKEN_SECRET = "github-token";
export const PASSPHRASE_SECRET = "sync-passphrase";
const CONFIG_KEY = "sync-config";
const LAST_KEY = "sync-last";
export const DEBOUNCE_MS = 30_000;

interface Last {
  at?: number;
  mode?: Mode;
  skipped?: { id: string; size: number }[];
  error?: { kind: SyncErrorKind | "other"; message: string; retryAfterMs?: number; at: number };
}

export interface SyncStatus extends Last {
  loaded: boolean;
  config: SyncConfig | null;
  running: boolean;
  /** Records changed here since the last sync. */
  pending: number;
}

let status: SyncStatus = { loaded: false, config: null, running: false, pending: 0 };
const listeners = new Set<() => void>();
function set(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const fn of listeners) fn();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => status,
    () => status,
  );
}

export const stateKeyOf = (c: Pick<SyncConfig, "owner" | "repo" | "branch" | "folder">) => `sync-state:${c.owner.toLowerCase()}/${c.repo.toLowerCase()}#${c.branch}:${c.folder}`;

async function refreshPending() {
  const c = status.config;
  if (!c) return set({ pending: 0 });
  const [{ pendingChanges }, { dbStore }] = await Promise.all([import("./engine.ts"), import("./store.ts")]);
  set({ pending: await pendingChanges(dbStore, stateKeyOf(c)) });
}

let loading: Promise<void> | null = null;
export function loadSync(): Promise<void> {
  loading ??= (async () => {
    const config = (await getMeta<SyncConfig>(CONFIG_KEY)) ?? null;
    const last = (await getMeta<Last>(LAST_KEY)) ?? {};
    set({ loaded: true, config, ...last });
    await refreshPending();
  })();
  return loading;
}

export async function saveConfig(config: SyncConfig | null): Promise<void> {
  await setMeta(CONFIG_KEY, config);
  if (!config) await setMeta(LAST_KEY, {});
  set({ config, ...(config ? {} : { at: undefined, mode: undefined, skipped: undefined, error: undefined }) });
  await refreshPending();
}

let running: Promise<SyncResult | null> | null = null;
let applying = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let changeTimer: ReturnType<typeof setTimeout> | null = null;

function later(ms: number) {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => void syncNow(), ms);
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  return locks ? locks.request("amphi-sync", fn) : fn();
}

async function runOnce(): Promise<SyncResult | null> {
  const c = status.config;
  if (!c) return null;
  set({ running: true });
  try {
    const result = await withLock(async () => {
      let token: string | null;
      let passphrase: string | null;
      try {
        token = await getSecret(TOKEN_SECRET);
        passphrase = await getSecret(PASSPHRASE_SECRET);
      } catch {
        const { SyncError } = await import("./github.ts");
        throw new SyncError("locked", "The key vault is locked");
      }
      const [{ sync }, { github, SyncError }, { dbStore }] = await Promise.all([import("./engine.ts"), import("./github.ts"), import("./store.ts")]);
      if (!token) throw new SyncError("auth", "No GitHub token on this device");
      applying = true;
      try {
        return await sync({
          gh: github({ owner: c.owner, repo: c.repo, branch: c.branch, folder: c.folder, token }),
          store: dbStore,
          stateKey: stateKeyOf(c),
          mode: c.mode,
          passphrase: passphrase ?? undefined,
          media: c.media,
        });
      } finally {
        applying = false;
      }
    });
    const last: Last = { at: Date.now(), mode: result.mode, skipped: result.skipped };
    await setMeta(LAST_KEY, last);
    set({ ...last, error: undefined });
    // Edits made during the sync go with the next one.
    await refreshPending().catch(() => {});
    if (status.config?.auto && status.pending > 0) later(DEBOUNCE_MS);
    return result;
  } catch (e) {
    const err = e as { name?: string; kind?: SyncErrorKind; message?: string; retryAfterMs?: number };
    const error: Last["error"] = { kind: err.name === "SyncError" && err.kind ? err.kind : "other", message: String(err.message ?? e), retryAfterMs: err.retryAfterMs, at: Date.now() };
    await setMeta(LAST_KEY, { at: status.at, mode: status.mode, skipped: status.skipped, error } satisfies Last);
    set({ error });
    if (status.config?.auto && (error.kind === "rate-limited" || error.kind === "network")) {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => void syncNow(), Math.min(Math.max(error.retryAfterMs ?? 60_000, 5_000), 3_600_000));
    }
    return null;
  } finally {
    set({ running: false });
    await refreshPending().catch(() => {});
  }
}

/** Syncs now; while a sync runs, waits for it and runs once more. */
export function syncNow(): Promise<SyncResult | null> {
  const p = (running ?? Promise.resolve(null)).catch(() => null).then(runOnce);
  running = p;
  void p.finally(() => {
    if (running === p) running = null;
  });
  return p;
}

let started = false;
/** Called once by the shell. */
export function startAutoSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const auto = () => Boolean(status.config?.auto);
  void loadSync().then(() => {
    if (auto()) void syncNow();
  });
  onChange(() => {
    if (applying) return;
    void refreshPending().catch(() => {});
    if (auto()) later(DEBOUNCE_MS);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && auto() && status.pending > 0) void syncNow();
  });
  window.addEventListener("online", () => {
    if (auto()) void syncNow();
  });
}
