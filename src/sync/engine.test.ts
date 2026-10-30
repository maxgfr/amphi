import { describe, expect, test } from "bun:test";
import type { Chat, Course, Lesson, Source } from "../data/schema.ts";
import { mergeRecords, pendingChanges, type SyncOptions, sync } from "./engine.ts";
import { FakeGitHub } from "./fake-github.ts";
import { github, SyncError } from "./github.ts";
import { Device } from "./test-device.ts";

const T = 1_700_000_000_000;

function setup(o: { empty?: boolean } = {}) {
  const fake = new FakeGitHub(o);
  const sleeps: number[] = [];
  const run = (store: Device, extra: Partial<SyncOptions> = {}) =>
    sync({
      gh: github({ owner: fake.owner, repo: fake.repo, token: fake.token, folder: "amphi", fetch: fake.fetch, sleep: async (ms) => void sleeps.push(ms) }),
      store,
      stateKey: "sync",
      mode: "plain",
      media: true,
      iterations: 1000,
      ...extra,
    });
  return { fake, run, sleeps };
}

const course = (title = "Thermodynamics"): Course => ({ id: crypto.randomUUID(), createdAt: T, updatedAt: T, kind: "course", title });
const lesson = (c: Course, title = "Entropy"): Lesson => ({ id: crypto.randomUUID(), createdAt: T, updatedAt: T, courseId: c.id, title, order: 0 });
const note = (c: Course, text: string, extra: Partial<Source> = {}): Source => ({ id: crypto.randomUUID(), createdAt: T, updatedAt: T, courseId: c.id, kind: "text", title: "Notes", text, status: "ready", ...extra });

const paths = (fake: FakeGitHub) => [...fake.files().keys()].sort();

describe("sync engine (plain)", () => {
  test("a fresh repository: amphi.json and readable files; a second device gets everything, media included", async () => {
    const { fake, run } = setup({ empty: true });
    const a = new Device();
    const c = a.edit("courses", course());
    const pdf = await a.putBlob(new Uint8Array([37, 80, 68, 70]), "application/pdf");
    a.edit("sources", note(c, "Entropy never decreases.", { kind: "pdf", blobId: pdf, mime: "application/pdf", text: undefined, pages: [{ n: 1, text: "Page one" }] }));
    expect(await pendingChanges(a, "sync")).toBe(2);
    const r = await run(a);
    expect(r.mode).toBe("plain");
    expect(await pendingChanges(a, "sync")).toBe(0);
    const files = paths(fake);
    expect(files).toContain("amphi/amphi.json");
    expect(files).toContain(`amphi/blobs/${pdf}.pdf`);
    expect(files.some((p) => /^amphi\/courses\/thermodynamics-[0-9a-f]{8}\/course\.json$/.test(p))).toBe(true);
    expect(JSON.parse(fake.text("amphi/amphi.json") ?? "")).toMatchObject({ format: "amphi/1", mode: "plain" });
    // The first sync of an empty repository: its first commit (amphi.json), then one commit with the rest.
    expect(fake.messages).toEqual(["amphi: start sync", "amphi: 4 files"]);

    const b = new Device();
    await run(b, { mode: undefined });
    expect(b.get<Course>("courses", c.id)?.title).toBe("Thermodynamics");
    expect(b.live("sources")).toHaveLength(1);
    expect(b.blobs.get(pdf)?.mime).toBe("application/pdf");
    // Nothing changed: nothing is written.
    const commits = fake.count("POST /git/commits");
    await run(a);
    await run(b);
    expect(fake.count("POST /git/commits")).toBe(commits);
  });

  test("no mode for a repository amphi has not written to yet: setup is asked", async () => {
    const { run } = setup();
    let err: unknown;
    await run(new Device(), { mode: undefined }).catch((e) => (err = e));
    expect((err as SyncError).kind).toBe("setup");
  });

  test("edits on both devices to different records merge; a rename moves the files", async () => {
    const { fake, run } = setup();
    const a = new Device();
    const b = new Device();
    const c = a.edit("courses", course());
    await run(a);
    await run(b);
    a.edit("lessons", lesson(c, "From A"));
    b.edit("lessons", lesson(c, "From B"));
    const renamed = b.edit("courses", { ...b.get<Course>("courses", c.id), title: "Heat" } as Course);
    await run(a);
    await run(b);
    await run(a);
    expect(a.live("lessons").map((l) => (l as Lesson).title).sort()).toEqual(["From A", "From B"]);
    expect(b.live("lessons")).toHaveLength(2);
    expect(a.get<Course>("courses", c.id)).toEqual(renamed);
    const files = paths(fake);
    expect(files.some((p) => p.includes("/thermodynamics-"))).toBe(false);
    expect(files.filter((p) => p.endsWith("/lesson.json")).every((p) => p.includes("/heat-"))).toBe(true);
  });

  test("a concurrent edit of one note: the later wins, the other text is kept as a conflict copy", async () => {
    const { run } = setup();
    const a = new Device();
    const b = new Device();
    const c = a.edit("courses", course());
    const n = a.edit("sources", note(c, "v1"));
    await run(a);
    await run(b);
    a.edit("sources", { ...n, text: "edited on A" });
    await Bun.sleep(2);
    b.edit("sources", { ...b.get<Source>("sources", n.id), text: "edited on B" } as Source);
    await run(a);
    const r = await run(b);
    expect(r.conflicts).toBe(1);
    await run(a);
    for (const d of [a, b]) {
      const texts = d.live("sources").map((s) => (s as Source).text).sort();
      expect(texts).toEqual(["edited on A", "edited on B"]);
      expect(d.get<Source>("sources", n.id)?.text).toBe("edited on B");
    }
    expect((a.live("sources") as Source[]).find((s) => s.id !== n.id)?.title).toBe("Notes (conflict copy)");
  });

  test("a chat continued on both devices keeps every message", async () => {
    const { run } = setup();
    const a = new Device();
    const b = new Device();
    const c = a.edit("courses", course());
    const chat: Chat = { id: crypto.randomUUID(), createdAt: T, updatedAt: T, courseId: c.id, mode: "chat", title: "Q", messages: [{ role: "user", content: "hi", at: T }] };
    a.edit("chats", chat);
    await run(a);
    await run(b);
    a.edit("chats", { ...chat, messages: [...chat.messages, { role: "user", content: "from A", at: T + 10 }] });
    await Bun.sleep(2);
    b.edit("chats", { ...chat, messages: [...chat.messages, { role: "user", content: "from B", at: T + 20 }] });
    await run(a);
    await run(b);
    await run(a);
    for (const d of [a, b]) expect(d.get<Chat>("chats", chat.id)?.messages.map((m) => m.content)).toEqual(["hi", "from A", "from B"]);
  });

  test("a deletion reaches the other device and the record's files leave the repository", async () => {
    const { fake, run } = setup();
    const a = new Device();
    const b = new Device();
    const c = a.edit("courses", course());
    const l = a.edit("lessons", lesson(c));
    await run(a);
    await run(b);
    expect(paths(fake).some((p) => p.endsWith("/lesson.json"))).toBe(true);
    b.edit("lessons", { ...l, deletedAt: Date.now() });
    await run(b);
    await run(a);
    expect(a.get<Lesson>("lessons", l.id)?.deletedAt).toBeNumber();
    expect(a.live("lessons")).toHaveLength(0);
    expect(paths(fake).some((p) => p.endsWith("/lesson.json"))).toBe(false);
    expect(fake.text("amphi/deleted/lessons.jsonl")).toContain(l.id);
  });

  test("another device pushing during the round: read again, merged, nothing lost", async () => {
    const { fake, run } = setup();
    const a = new Device();
    const b = new Device();
    const c = a.edit("courses", course());
    await run(a);
    await run(b);
    a.edit("lessons", lesson(c, "From A"));
    b.edit("lessons", lesson(c, "From B"));
    let once = true;
    fake.beforeRefUpdate = async () => {
      if (!once) return;
      once = false;
      await run(b);
    };
    await run(a);
    fake.beforeRefUpdate = null;
    await run(b);
    expect(a.live("lessons")).toHaveLength(2);
    expect(b.live("lessons")).toHaveLength(2);
    expect(fake.count("PATCH ")).toBeGreaterThanOrEqual(4);
  });

  test("a branch that keeps moving fails after a few attempts", async () => {
    const { fake, run } = setup();
    const a = new Device();
    a.edit("courses", course());
    fake.racePushes = 10;
    let err: unknown;
    await run(a, { maxAttempts: 2 }).catch((e) => (err = e));
    expect((err as SyncError).kind).toBe("conflict");
    // Files written by others are kept.
    expect(paths(fake)).toContain("elsewhere/1.txt");
  });

  test("a short rate limit is waited out; a long one is reported", async () => {
    const { fake, run, sleeps } = setup();
    const a = new Device();
    a.edit("courses", course());
    fake.rateLimit = { remaining: 1, status: 403, headers: { "retry-after": "2" } };
    await run(a);
    expect(sleeps).toEqual([2250]);
    a.edit("courses", course("Other"));
    fake.rateLimit = { remaining: 1, status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600) } };
    let err: unknown;
    await run(a).catch((e) => (err = e));
    expect((err as SyncError).kind).toBe("rate-limited");
    expect((err as SyncError).retryAfterMs).toBeGreaterThan(3_000_000);
  });

  test("media over the size limit stay on the device, and say so; media sync can be off", async () => {
    const { fake, run } = setup();
    const a = new Device();
    const c = a.edit("courses", course());
    const big = await a.putBlob(new Uint8Array(2000), "video/mp4");
    a.edit("sources", note(c, "", { kind: "video", blobId: big, text: undefined }));
    const r = await run(a, { maxFileBytes: 1000 });
    expect(r.skipped).toEqual([{ id: big, size: 2000 }]);
    expect(paths(fake).some((p) => p.includes("/blobs/"))).toBe(false);
    const small = await a.putBlob(new Uint8Array(10), "audio/mpeg");
    a.edit("sources", note(c, "", { kind: "audio", blobId: small, text: undefined }));
    await run(a, { media: false });
    expect(paths(fake).some((p) => p.includes("/blobs/"))).toBe(false);
    await run(a);
    expect(paths(fake)).toContain(`amphi/blobs/${small}.mp3`);
  });

  test("an import merges by updatedAt", async () => {
    const a = new Device();
    const c = a.edit("courses", course());
    const older = { ...c, title: "Old", updatedAt: c.updatedAt - 10 };
    const newer = { ...c, title: "New", updatedAt: c.updatedAt + 10 };
    expect(await mergeRecords(a, { courses: [older] })).toEqual({ applied: 0, conflicts: 0 });
    expect(await mergeRecords(a, { courses: [newer] })).toEqual({ applied: 1, conflicts: 0 });
    expect(a.get<Course>("courses", c.id)?.title).toBe("New");
  });
});

describe("sync engine (encrypted)", () => {
  test("the repository holds amphi.json and opaque objects only; the right passphrase reads it back", async () => {
    const { fake, run } = setup({ empty: true });
    const a = new Device();
    const c = a.edit("courses", course("Secret plans"));
    const pdf = await a.putBlob(new TextEncoder().encode("%PDF secret"), "application/pdf");
    a.edit("sources", note(c, "my private note", { blobId: pdf }));
    const pass = "a long enough passphrase";
    const r = await run(a, { mode: "encrypted", passphrase: pass });
    expect(r.mode).toBe("encrypted");
    const files = paths(fake);
    expect(files.every((p) => p === "amphi/amphi.json" || /^amphi\/(objects|media)\/[0-9a-f]{64}$/.test(p))).toBe(true);
    expect(files.filter((p) => p.includes("/media/"))).toHaveLength(1);
    for (const [, bytes] of fake.files()) {
      const s = new TextDecoder().decode(bytes);
      expect(s).not.toContain("Secret plans");
      expect(s).not.toContain("private note");
      expect(s).not.toContain(pdf);
    }
    const header = JSON.parse(fake.text("amphi/amphi.json") ?? "");
    expect(header).toMatchObject({ format: "amphi/1", mode: "encrypted", kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 1000 } });
    expect(header.check).toMatch(/^[0-9a-f]{64}$/);

    // A second device: the mode comes from amphi.json, whatever it asked for.
    const b = new Device();
    let err: unknown;
    await run(b, { mode: "plain", passphrase: "not the passphrase" }).catch((e) => (err = e));
    expect((err as SyncError).kind).toBe("passphrase");
    await run(b, { mode: undefined }).catch((e) => (err = e));
    expect((err as SyncError).kind).toBe("passphrase");
    await run(b, { mode: undefined, passphrase: pass });
    expect(b.get<Course>("courses", c.id)?.title).toBe("Secret plans");
    expect(b.live("sources").map((s) => (s as Source).text)).toEqual(["my private note"]);
    expect(b.blobs.get(pdf)?.mime).toBe("application/pdf");

    // Edits, deletions and a rename go through; unchanged objects are not rewritten.
    b.edit("courses", { ...b.get<Course>("courses", c.id), title: "Renamed" } as Course);
    const before = fake.count("POST /git/commits");
    await run(b, { passphrase: pass });
    await run(a, { passphrase: pass });
    expect(a.get<Course>("courses", c.id)?.title).toBe("Renamed");
    await run(a, { passphrase: pass });
    await run(b, { passphrase: pass });
    expect(fake.count("POST /git/commits")).toBe(before + 1);
  });

  test("a damaged object is reported and left alone", async () => {
    const { fake, run } = setup();
    const a = new Device();
    a.edit("courses", course());
    await run(a, { mode: "encrypted", passphrase: "a long enough passphrase" });
    fake.commitFiles({ [`amphi/objects/${"0".repeat(64)}`]: "garbage" });
    const r = await run(new Device(), { passphrase: "a long enough passphrase" });
    expect(r.problems).toEqual([`objects/${"0".repeat(64)}`]);
    expect(fake.text(`amphi/objects/${"0".repeat(64)}`)).toBe("garbage");
  });
});
