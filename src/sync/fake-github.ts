// For tests only (unit and end to end), never imported by the app: an
// in-memory GitHub REST API for one repository, speaking HTTP. The repository
// and user endpoints, the Git Data API (refs, trees with recursive and
// truncated listings, blobs, commits) and the Contents API PUT that makes the
// first commit of an empty repository. Blob ids are real Git blob ids.

import { sha1 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";

type TreeEntry = { type: "blob" | "tree"; sha: string; mode: string };
type Obj = { type: "blob"; bytes: Uint8Array } | { type: "tree"; entries: Map<string, TreeEntry> } | { type: "commit"; tree: string; parents: string[]; message: string };

interface TreeItemIn {
  path: string;
  sha?: string | null;
  content?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function blobSha(bytes: Uint8Array): string {
  const head = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  return bytesToHex(sha1(all));
}
const hashOf = (s: string) => bytesToHex(sha1(enc.encode(s)));

function b64encode(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64decode = (s: string) => Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0));

function json(v: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export class FakeGitHub {
  owner = "ada";
  repo = "notes";
  defaultBranch = "main";
  token = "github_pat_test";
  accessible = true;
  permissions = { admin: false, push: true, pull: true };
  offline = false;
  truncateAt = Number.POSITIVE_INFINITY;
  /** The next `remaining` calls are refused with this status and headers. */
  rateLimit: { remaining: number; status: number; headers: Record<string, string> } = { remaining: 0, status: 403, headers: {} };
  /** Before each of the next N ref updates, another device pushes a commit. */
  racePushes = 0;
  /** Called before a ref update is applied (to make another device push in between). */
  beforeRefUpdate: (() => Promise<void> | void) | null = null;
  readonly objects = new Map<string, Obj>();
  readonly refs = new Map<string, string>();
  readonly calls: string[] = [];
  readonly messages: string[] = [];
  private races = 0;

  constructor(o: { empty?: boolean } = {}) {
    if (!o.empty) this.commitFiles({ "README.md": "# notes\n" }, this.defaultBranch, "Initial commit");
  }

  readonly fetch = (url: string, init: RequestInit): Promise<Response> => this.handle(new Request(url, init));

  count(prefix: string): number {
    return this.calls.filter((c) => c.startsWith(prefix)).length;
  }

  files(branch = this.defaultBranch): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>();
    const head = this.refs.get(branch);
    if (!head) return out;
    for (const [path, sha] of this.flatten(this.commit(head).tree)) out.set(path, this.blob(sha));
    return out;
  }

  text(path: string, branch = this.defaultBranch): string | undefined {
    const b = this.files(branch).get(path);
    return b ? dec.decode(b) : undefined;
  }

  /** Pushes a commit as another client would; `null` deletes a path. */
  commitFiles(files: Record<string, string | Uint8Array | null>, branch = this.defaultBranch, message = "Elsewhere"): string {
    const head = this.refs.get(branch);
    const flat = head ? this.flatten(this.commit(head).tree) : new Map<string, string>();
    for (const [path, body] of Object.entries(files)) {
      if (body === null) flat.delete(path);
      else flat.set(path, this.putBlob(typeof body === "string" ? enc.encode(body) : body));
    }
    const sha = this.putCommit(this.buildTree(flat), head ? [head] : [], message);
    this.refs.set(branch, sha);
    return sha;
  }

  async handle(req: Request): Promise<Response> {
    if (this.offline) throw new TypeError("Failed to fetch");
    const url = new URL(req.url);
    const prefix = `/repos/${this.owner}/${this.repo}`;
    const p = decodeURIComponent(url.pathname);
    const inRepo = p.toLowerCase() === prefix.toLowerCase() || p.toLowerCase().startsWith(`${prefix.toLowerCase()}/`);
    const route = inRepo ? p.slice(prefix.length) : p;
    this.calls.push(`${req.method} ${route}`);
    if (this.rateLimit.remaining > 0) {
      this.rateLimit.remaining--;
      return json({ message: "API rate limit exceeded" }, this.rateLimit.status, this.rateLimit.headers);
    }
    if (req.headers.get("Authorization") !== `Bearer ${this.token}`) return json({ message: "Bad credentials" }, 401);
    if (p.startsWith("/users/")) return p.slice(7) === this.owner ? json({ login: this.owner }) : json({ message: "Not Found" }, 404);
    if (!inRepo || !this.accessible) return json({ message: "Not Found" }, 404);
    const body = req.method === "GET" ? undefined : ((await req.json()) as Record<string, unknown>);
    if (route === "" && req.method === "GET") return json({ full_name: `${this.owner}/${this.repo}`, default_branch: this.defaultBranch, private: true, archived: false, permissions: this.permissions });
    if (route.startsWith("/contents/") && req.method === "PUT") return this.putContents(route.slice("/contents/".length), body ?? {});
    if (!route.startsWith("/git/")) return json({ message: "Not Found" }, 404);
    if (this.refs.size === 0) return json({ message: "Git Repository is empty." }, 409);
    const git = route.slice("/git/".length);
    if (req.method === "GET" && git.startsWith("ref/heads/")) {
      const sha = this.refs.get(git.slice("ref/heads/".length));
      return sha ? json({ ref: `refs/${git.slice(4)}`, object: { sha, type: "commit" } }) : json({ message: "Not Found" }, 404);
    }
    if (req.method === "GET" && git.startsWith("trees/")) return this.getTree(git.slice("trees/".length), url.searchParams.has("recursive"));
    if (req.method === "GET" && git.startsWith("blobs/")) return this.getBlob(git.slice("blobs/".length), req);
    if (req.method === "POST" && git === "trees") return this.postTree(body ?? {});
    if (req.method === "POST" && git === "blobs") {
      const content = String(body?.content ?? "");
      return json({ sha: this.putBlob(body?.encoding === "base64" ? b64decode(content) : enc.encode(content)) }, 201);
    }
    if (req.method === "POST" && git === "commits") {
      const tree = String(body?.tree ?? "");
      const parents = ((body?.parents ?? []) as string[]).map(String);
      if (this.objects.get(tree)?.type !== "tree") return json({ message: "Tree not found" }, 422);
      const message = String(body?.message ?? "");
      this.messages.push(message);
      return json({ sha: this.putCommit(tree, parents, message) }, 201);
    }
    if (req.method === "POST" && git === "refs") {
      const name = String(body?.ref ?? "").replace(/^refs\/heads\//, "");
      if (this.refs.has(name)) return json({ message: "Reference already exists" }, 422);
      this.refs.set(name, String(body?.sha ?? ""));
      return json({ ref: body?.ref, object: { sha: body?.sha } }, 201);
    }
    if (req.method === "PATCH" && git.startsWith("refs/heads/")) return this.patchRef(git.slice("refs/heads/".length), body ?? {});
    return json({ message: "Not Found" }, 404);
  }

  private putContents(path: string, body: Record<string, unknown>): Response {
    const branch = typeof body.branch === "string" ? body.branch : this.defaultBranch;
    const head = this.refs.get(branch);
    if (head && this.flatten(this.commit(head).tree).has(path) && !body.sha) return json({ message: '"sha" wasn\'t supplied.' }, 422);
    const sha = this.commitFiles({ [path]: b64decode(String(body.content ?? "")) }, branch, String(body.message ?? ""));
    this.messages.push(String(body.message ?? ""));
    return json({ commit: { sha } }, 201);
  }

  private getTree(ref: string, recursive: boolean): Response {
    let sha = ref;
    const o = this.objects.get(sha);
    if (o?.type === "commit") sha = o.tree;
    else if (o?.type !== "tree") return json({ message: "Not Found" }, 404);
    const out: { path: string; mode: string; type: string; sha: string; size?: number }[] = [];
    const visit = (tree: string, base: string) => {
      for (const [name, e] of this.tree(tree)) {
        out.push({ path: base + name, mode: e.mode, type: e.type, sha: e.sha, ...(e.type === "blob" ? { size: this.blob(e.sha).length } : {}) });
        if (recursive && e.type === "tree") visit(e.sha, `${base}${name}/`);
      }
    };
    visit(sha, "");
    const truncated = recursive && out.length > this.truncateAt;
    return json({ sha, tree: truncated ? out.slice(0, this.truncateAt) : out, truncated });
  }

  private getBlob(sha: string, req: Request): Response {
    const o = this.objects.get(sha);
    if (o?.type !== "blob") return json({ message: "Not Found" }, 404);
    if (req.headers.get("Accept") === "application/vnd.github.raw+json") return new Response(o.bytes as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": "application/vnd.github.raw" } });
    return json({ sha, size: o.bytes.length, content: b64encode(o.bytes), encoding: "base64" });
  }

  private postTree(body: Record<string, unknown>): Response {
    const base = body.base_tree === undefined ? undefined : String(body.base_tree);
    if (base !== undefined && this.objects.get(base)?.type !== "tree") return json({ message: "Invalid base_tree" }, 422);
    const flat = base ? this.flatten(base) : new Map<string, string>();
    for (const item of (body.tree ?? []) as TreeItemIn[]) {
      if (item.sha === null) flat.delete(item.path);
      else if (typeof item.content === "string") flat.set(item.path, this.putBlob(enc.encode(item.content)));
      else if (item.sha && this.objects.get(item.sha)?.type === "blob") flat.set(item.path, item.sha);
      else return json({ message: `Invalid tree item ${item.path}` }, 422);
    }
    return json({ sha: this.buildTree(flat) }, 201);
  }

  private async patchRef(branch: string, body: Record<string, unknown>): Promise<Response> {
    if (!this.refs.get(branch)) return json({ message: "Reference does not exist" }, 422);
    if (this.racePushes > 0) {
      this.racePushes--;
      this.commitFiles({ [`elsewhere/${++this.races}.txt`]: `push ${this.races}` }, branch);
    }
    await this.beforeRefUpdate?.();
    const sha = String(body.sha ?? "");
    if (this.objects.get(sha)?.type !== "commit") return json({ message: "Object does not exist" }, 422);
    if (!this.isAncestor(this.refs.get(branch) as string, sha) && body.force !== true) return json({ message: "Update is not a fast forward" }, 422);
    this.refs.set(branch, sha);
    return json({ ref: `refs/heads/${branch}`, object: { sha, type: "commit" } });
  }

  private isAncestor(ancestor: string, of: string): boolean {
    const todo = [of];
    while (todo.length > 0) {
      const c = todo.pop() as string;
      if (c === ancestor) return true;
      todo.push(...this.commit(c).parents);
    }
    return false;
  }

  private putBlob(bytes: Uint8Array): string {
    const sha = blobSha(bytes);
    this.objects.set(sha, { type: "blob", bytes });
    return sha;
  }

  private putCommit(tree: string, parents: string[], message: string): string {
    const sha = hashOf(JSON.stringify(["commit", tree, parents, message, this.objects.size]));
    this.objects.set(sha, { type: "commit", tree, parents, message });
    return sha;
  }

  private buildTree(flat: Map<string, string>): string {
    const entries = new Map<string, TreeEntry>();
    const sub = new Map<string, Map<string, string>>();
    for (const [path, sha] of flat) {
      const slash = path.indexOf("/");
      if (slash < 0) entries.set(path, { type: "blob", sha, mode: "100644" });
      else {
        const dir = path.slice(0, slash);
        const m = sub.get(dir) ?? new Map<string, string>();
        m.set(path.slice(slash + 1), sha);
        sub.set(dir, m);
      }
    }
    for (const [dir, m] of sub) entries.set(dir, { type: "tree", sha: this.buildTree(m), mode: "040000" });
    const sorted = new Map([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    const sha = hashOf(JSON.stringify(["tree", [...sorted]]));
    this.objects.set(sha, { type: "tree", entries: sorted });
    return sha;
  }

  private flatten(tree: string, base = ""): Map<string, string> {
    const out = new Map<string, string>();
    for (const [name, e] of this.tree(tree)) {
      if (e.type === "blob") out.set(base + name, e.sha);
      else for (const [p, s] of this.flatten(e.sha, `${base}${name}/`)) out.set(p, s);
    }
    return out;
  }

  private tree(sha: string): Map<string, TreeEntry> {
    const o = this.objects.get(sha);
    if (o?.type !== "tree") throw new Error(`no tree ${sha}`);
    return o.entries;
  }

  private commit(sha: string): { tree: string; parents: string[] } {
    const o = this.objects.get(sha);
    if (o?.type !== "commit") throw new Error(`no commit ${sha}`);
    return o;
  }

  private blob(sha: string): Uint8Array {
    const o = this.objects.get(sha);
    if (o?.type !== "blob") throw new Error(`no blob ${sha}`);
    return o.bytes;
  }
}
