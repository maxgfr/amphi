// A GitHub repository through its REST API, with a fine-grained token limited
// to that repository (Contents: read and write). Reads list the branch's tree
// once and fetch blobs by sha; writes go through the Git Data API as ONE commit
// per sync: text files inline in one or a few trees, binary files as blobs, a
// commit, then a fast-forward update of the branch. When another device moved
// the branch meanwhile, the update is refused and `commit` throws a
// "conflict" SyncError: the engine reads the branch again and merges first.
// Rate limits: a short wait asked by GitHub (retry-after, x-ratelimit-reset)
// is waited out, a long one is reported.

import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { toBase64 } from "./crypto.ts";

export const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";
/** Inline content sent in one tree request at most; more is split into several trees. */
export const MAX_TREE_BYTES = 4 * 1024 * 1024;
/** Longest rate-limit wait sat through before giving up for this round. */
export const MAX_WAIT_MS = 60_000;
/** GitHub refuses blobs over 100 MB: bigger files stay on the device. */
export const MAX_FILE_BYTES = 95 * 1000 * 1000;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type SyncErrorKind = "auth" | "not-found" | "permission" | "rate-limited" | "network" | "conflict" | "format" | "passphrase" | "setup" | "locked";

export class SyncError extends Error {
  override name = "SyncError";
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface GitHubTarget {
  owner: string;
  repo: string;
  /** The repository's default branch when empty. */
  branch?: string;
  /** Folder inside the repository ("" for its root). */
  folder?: string;
}

export interface GitHubOptions extends GitHubTarget {
  token: string;
  apiBase?: string;
  fetch?: Fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxTreeBytes?: number;
  maxWaitMs?: number;
}

export interface RemoteFile {
  sha: string;
  size?: number;
}

export interface Head {
  commit: string;
  tree: string;
  /** Path inside the folder → blob. */
  files: Map<string, RemoteFile>;
}

export type Change = { path: string; text: string } | { path: string; bytes: Uint8Array } | { path: string; remove: true };

const enc = new TextEncoder();

/** The Git blob id of some bytes: sha1("blob <length>\0" + bytes). */
export function gitBlobSha(bytes: Uint8Array | string): string {
  const body = typeof bytes === "string" ? enc.encode(bytes) : bytes;
  const head = enc.encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  return bytesToHex(sha1(all));
}

const encPath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
export const normalizeFolder = (f?: string) =>
  (f ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");

/** `owner/repo` or a repository's address, as pasted; null when it is neither. */
export function parseRepo(text: string): { owner: string; repo: string } | null {
  const s = text
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const m = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/.exec(s);
  return m ? { owner: m[1] ?? "", repo: m[2] ?? "" } : null;
}

/** GitHub's form for a new fine-grained token, filled in: Contents read and write, for one repository the user picks. */
export function tokenUrl(owner?: string): string {
  const q = new URLSearchParams({ name: "amphi sync", description: "amphi: sync courses to one repository", contents: "write", expires_in: "366" });
  if (owner) q.set("target_name", owner);
  return `https://github.com/settings/personal-access-tokens/new?${q}`;
}

/** Wait asked by GitHub: `retry-after` (seconds), or until `x-ratelimit-reset` once `x-ratelimit-remaining` is 0. */
function rateLimitWait(h: Headers, now: number): number | undefined {
  const after = Number(h.get("retry-after") ?? Number.NaN);
  if (Number.isFinite(after)) return Math.max(0, after * 1000);
  if (h.get("x-ratelimit-remaining") === "0") {
    const reset = Number(h.get("x-ratelimit-reset") ?? Number.NaN);
    if (Number.isFinite(reset)) return Math.max(0, reset * 1000 - now);
  }
  return undefined;
}

async function failure(res: Response, what: string, now: number): Promise<SyncError> {
  const text = await res.text().catch(() => "");
  let message = text;
  try {
    message = String((JSON.parse(text) as { message?: string }).message ?? text);
  } catch {}
  const detail = `GitHub ${what}: HTTP ${res.status}${message ? ` ${message.slice(0, 200)}` : ""}`;
  const wait = rateLimitWait(res.headers, now);
  if (res.status === 401) return new SyncError("auth", detail);
  if (res.status === 429 || (res.status === 403 && (wait !== undefined || /rate limit/i.test(message)))) return new SyncError("rate-limited", detail, wait ?? 60_000);
  if (res.status === 404) return new SyncError("not-found", detail);
  if (res.status >= 500) return new SyncError("network", detail);
  return new SyncError("permission", detail);
}

interface TreeAnswer {
  sha: string;
  tree: { path: string; type: string; sha: string; size?: number }[];
  truncated?: boolean;
}

export interface GitHub {
  /** The branch's head and files; null for an empty repository or a branch not created yet. */
  head(): Promise<Head | null>;
  read(sha: string): Promise<Uint8Array>;
  /** One commit on top of `base` (null: the first one). Throws a "conflict" SyncError when the branch moved. */
  commit(base: Head | null, changes: Change[], message: (files: number) => string): Promise<string>;
}

export function github(o: GitHubOptions): GitHub {
  const doFetch: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  const now = o.now ?? (() => Date.now());
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const api = (o.apiBase ?? GITHUB_API).replace(/\/+$/, "");
  const repoUrl = `${api}/repos/${encodeURIComponent(o.owner.trim())}/${encodeURIComponent(o.repo.trim())}`;
  const folder = normalizeFolder(o.folder);
  const prefix = folder ? `${folder}/` : "";
  const maxTreeBytes = o.maxTreeBytes ?? MAX_TREE_BYTES;
  const maxWait = o.maxWaitMs ?? MAX_WAIT_MS;
  let branchName = o.branch?.trim() || null;
  let cached: Head | null = null;

  async function call(method: string, path: string, co: { body?: unknown; accept?: string; fresh?: boolean } = {}): Promise<Response> {
    const url = path.startsWith("/") ? `${api}${path}` : path ? `${repoUrl}/${path}` : repoUrl;
    const headers: Record<string, string> = { Authorization: `Bearer ${o.token}`, Accept: co.accept ?? "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION };
    if (co.body !== undefined) headers["Content-Type"] = "application/json";
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, {
          method,
          headers,
          ...(co.body !== undefined ? { body: JSON.stringify(co.body) } : {}),
          // A branch head must never come from the HTTP cache; objects by id never change.
          ...(co.fresh ? { cache: "no-store" as RequestCache } : {}),
        });
      } catch (e) {
        throw new SyncError("network", `GitHub ${method} ${path || "repository"}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if ((res.status === 403 || res.status === 429) && attempt < 3) {
        const wait = rateLimitWait(res.headers, now());
        if (wait !== undefined && wait <= maxWait) {
          await res.body?.cancel().catch(() => {});
          await sleep(wait + 250);
          continue;
        }
      }
      return res;
    }
  }

  async function json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw await failure(res, what, now());
    return (await res.json()) as T;
  }

  async function repoInfo(): Promise<{ default_branch: string }> {
    const res = await call("GET", "", { fresh: true });
    if (res.status === 404) throw new SyncError("not-found", `GitHub repository ${o.owner}/${o.repo} not found, or the token cannot access it`);
    return json(res, "repository");
  }

  async function branch(): Promise<string> {
    branchName ??= (await repoInfo()).default_branch;
    return branchName;
  }

  const getTree = async (sha: string, recursive: boolean): Promise<TreeAnswer> => json(await call("GET", `git/trees/${sha}${recursive ? "?recursive=1" : ""}`), "tree");

  /** Every blob under a tree: one recursive call, or a walk of its subtrees when GitHub truncates the answer. */
  async function walk(sha: string, base: string, out: Map<string, RemoteFile>): Promise<void> {
    const deep = await getTree(sha, true);
    if (!deep.truncated) {
      for (const e of deep.tree) if (e.type === "blob") out.set(base + e.path, { sha: e.sha, size: e.size });
      return;
    }
    for (const e of (await getTree(sha, false)).tree) {
      if (e.type === "blob") out.set(base + e.path, { sha: e.sha, size: e.size });
      else if (e.type === "tree") await walk(e.sha, `${base}${e.path}/`, out);
    }
  }

  async function readHead(commit: string): Promise<Head> {
    const top = await getTree(commit, true);
    const files = new Map<string, RemoteFile>();
    if (!top.truncated) {
      for (const e of top.tree) if (e.type === "blob" && e.path.startsWith(prefix)) files.set(e.path.slice(prefix.length), { sha: e.sha, size: e.size });
    } else {
      let sha: string | null = top.sha;
      for (const seg of folder ? folder.split("/") : []) {
        const t: TreeAnswer = await getTree(sha, false);
        sha = t.tree.find((e) => e.type === "tree" && e.path === seg)?.sha ?? null;
        if (sha === null) break;
      }
      if (sha !== null) await walk(sha, "", files);
    }
    return { commit, tree: top.sha, files };
  }

  async function head(): Promise<Head | null> {
    const b = await branch();
    const res = await call("GET", `git/ref/heads/${encPath(b)}`, { fresh: true });
    if (res.status === 409) return null; // empty repository
    if (res.status === 404) {
      await repoInfo();
      return null;
    }
    const ref = await json<{ object: { sha: string } }>(res, "branch");
    if (cached?.commit !== ref.object.sha) cached = await readHead(ref.object.sha);
    return cached;
  }

  async function read(sha: string): Promise<Uint8Array> {
    const res = await call("GET", `git/blobs/${sha}`, { accept: "application/vnd.github.raw+json" });
    if (!res.ok) throw await failure(res, "read file", now());
    const type = res.headers.get("content-type") ?? "";
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Some proxies ignore the raw media type and answer the JSON form.
    if (type.includes("json") && !type.includes("raw")) {
      const blob = JSON.parse(new TextDecoder().decode(bytes)) as { content: string; encoding: string };
      if (blob.encoding === "base64") {
        const bin = atob(blob.content.replace(/\s/g, ""));
        return Uint8Array.from(bin, (c) => c.charCodeAt(0));
      }
      return enc.encode(blob.content);
    }
    return bytes;
  }

  /** The first commit of an empty repository, through the Contents API (the Git Data API refuses empty ones). */
  async function bootstrap(b: string, first: { path: string; bytes: Uint8Array }): Promise<void> {
    const res = await call("PUT", `contents/${encPath(prefix + first.path)}`, { body: { message: "amphi: start sync", content: toBase64(first.bytes), branch: b } });
    if (!res.ok) {
      if (res.status === 409 || res.status === 422) throw new SyncError("conflict", "Another device started this repository first");
      throw await failure(res, "first commit", now());
    }
  }

  /** A branch that does not exist yet starts from the default branch. */
  async function createBranch(b: string): Promise<boolean> {
    const main = (await repoInfo()).default_branch;
    const res = await call("GET", `git/ref/heads/${encPath(main)}`, { fresh: true });
    if (res.status === 409) return false;
    const ref = await json<{ object: { sha: string } }>(res, "default branch");
    const made = await call("POST", "git/refs", { body: { ref: `refs/heads/${b}`, sha: ref.object.sha } });
    if (!made.ok && made.status !== 422) throw await failure(made, "create branch", now());
    return true;
  }

  async function commit(base: Head | null, changes: Change[], message: (files: number) => string): Promise<string> {
    const b = await branch();
    let parent = base;
    let todo = changes;
    if (!parent) {
      // An empty repository or a missing branch: make the branch exist, then commit on top of it.
      const current = await head();
      if (current) throw new SyncError("conflict", "The branch appeared meanwhile");
      if (!(await createBranch(b))) {
        const first = todo.find((c): c is { path: string; text: string } => "text" in c) ?? { path: "README.md", text: "amphi sync\n" };
        await bootstrap(b, { path: first.path, bytes: enc.encode(first.text) });
        todo = todo.filter((c) => c !== first);
      }
      parent = await head();
      if (!parent) throw new SyncError("network", `GitHub branch ${b} could not be created`);
      if (todo.length === 0) return parent.commit;
    }
    let tree = parent.tree;
    let items: unknown[] = [];
    let size = 0;
    const send = async () => {
      if (items.length === 0) return;
      tree = (await json<{ sha: string }>(await call("POST", "git/trees", { body: { base_tree: tree, tree: items } }), "write tree")).sha;
      items = [];
      size = 0;
    };
    for (const c of todo) {
      const path = prefix + c.path;
      if ("remove" in c) {
        items.push({ path, mode: "100644", type: "blob", sha: null });
        continue;
      }
      const isText = "text" in c;
      const length = isText ? c.text.length : c.bytes.length;
      if (!isText || length > maxTreeBytes) {
        const body = isText ? { content: c.text, encoding: "utf-8" } : { content: toBase64(c.bytes), encoding: "base64" };
        const blob = await json<{ sha: string }>(await call("POST", "git/blobs", { body }), "write file");
        items.push({ path, mode: "100644", type: "blob", sha: blob.sha });
        continue;
      }
      if (size + length > maxTreeBytes) await send();
      items.push({ path, mode: "100644", type: "blob", content: c.text });
      size += length;
    }
    await send();
    const made = await json<{ sha: string }>(await call("POST", "git/commits", { body: { message: message(todo.length), tree, parents: [parent.commit] } }), "write commit");
    const res = await call("PATCH", `git/refs/heads/${encPath(b)}`, { body: { sha: made.sha, force: false } });
    // 422: not a fast forward, another device pushed.
    if (res.status === 422) throw new SyncError("conflict", `GitHub branch ${b} moved during the sync`);
    if (!res.ok) throw await failure(res, "update branch", now());
    return made.sha;
  }

  return { head, read, commit };
}

export type GitHubProblem = "token" | "not-found" | "no-access" | "read-only" | "rate-limited" | "network";
export type GitHubCheck = { ok: true; defaultBranch: string; private: boolean } | { ok: false; problem: GitHubProblem; detail: string };

/**
 * Checks a token and repository with read-only calls. GitHub answers 404 both for a private repository that does
 * not exist and for one the token cannot see: `not-found` is certain only for an owner that does not exist.
 */
export async function checkGitHub(o: GitHubOptions): Promise<GitHubCheck> {
  const doFetch: Fetch = o.fetch ?? ((url, init) => fetch(url, init));
  const api = (o.apiBase ?? GITHUB_API).replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${o.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION };
  const get = async (path: string) => {
    try {
      return await doFetch(`${api}${path}`, { method: "GET", headers, cache: "no-store" });
    } catch (e) {
      throw new SyncError("network", e instanceof Error ? e.message : String(e));
    }
  };
  try {
    const res = await get(`/repos/${encodeURIComponent(o.owner.trim())}/${encodeURIComponent(o.repo.trim())}`);
    if (res.status === 404) {
      const user = await get(`/users/${encodeURIComponent(o.owner.trim())}`);
      if (user.status === 404) return { ok: false, problem: "not-found", detail: `No GitHub account ${o.owner}` };
      return { ok: false, problem: "no-access", detail: `Repository ${o.owner}/${o.repo} not found, or not among the repositories of this token` };
    }
    if (!res.ok) throw await failure(res, "repository", (o.now ?? Date.now)());
    const r = (await res.json()) as { default_branch: string; private?: boolean; archived?: boolean; permissions?: { push?: boolean } };
    if (r.archived) return { ok: false, problem: "read-only", detail: `Repository ${o.owner}/${o.repo} is archived` };
    if (r.permissions?.push === false) return { ok: false, problem: "read-only", detail: `No write access to ${o.owner}/${o.repo}` };
    return { ok: true, defaultBranch: r.default_branch, private: r.private === true };
  } catch (e) {
    if (!(e instanceof SyncError)) throw e;
    const problem: GitHubProblem = e.kind === "auth" ? "token" : e.kind === "rate-limited" ? "rate-limited" : e.kind === "network" ? "network" : "no-access";
    return { ok: false, problem, detail: e.message };
  }
}
