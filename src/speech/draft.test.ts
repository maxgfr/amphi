import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { fresh, getBlob, getMeta, list, put, resetDbForTests } from "../data/db.ts";
import { type Draft, discardDraft, draftChunks, finishDraft, loadDraft, pickMime, recoverDraft, recoveryState, saveChunk, saveDraft } from "./draft.ts";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

const draft = (courseId: string, extra: Partial<Draft> = {}): Draft => ({ id: "r1", courseId, mime: "audio/webm;codecs=opus", startedAt: Date.UTC(2026, 9, 30, 9), elapsed: 0, markers: [], chunks: 0, updatedAt: 0, ...extra });

test("what to do with a draft found on opening", () => {
  expect(recoveryState(undefined, false)).toBe("none");
  expect(recoveryState(draft("c", { chunks: 3 }), true)).toBe("busy");
  expect(recoveryState(draft("c", { chunks: 0 }), false)).toBe("empty");
  expect(recoveryState(draft("c", { chunks: 2 }), false)).toBe("interrupted");
});

test("the container: Opus in WebM, else MP4", () => {
  expect(pickMime((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
  expect(pickMime((t) => t === "audio/mp4")).toBe("audio/mp4");
  expect(pickMime(() => false)).toBe("");
});

test("chunks reach the disk as they come, and an interrupted recording is recovered into a new lesson", async () => {
  const c = await put("courses", { ...fresh(), kind: "course", title: "Law" });
  let d = draft(c.id, { newLesson: true });
  await saveDraft(d);
  d = await saveChunk(d, 0, new Blob(["aaaa"], { type: "audio/webm" }));
  d = await saveChunk({ ...d, elapsed: 10, markers: [{ t: 4 }] }, 1, new Blob(["bb"], { type: "audio/webm" }));
  // A chunk written just before the tab died, the draft not yet updated.
  const { setMeta } = await import("../data/db.ts");
  await setMeta("recording:r1:2", new Blob(["c"]));
  const found = await loadDraft();
  expect(found?.chunks).toBe(2);
  expect(recoveryState(found, false)).toBe("interrupted");
  expect((await draftChunks(found!)).length).toBe(3);

  const source = await recoverDraft(found!);
  expect(source).toMatchObject({ kind: "recording", status: "pending", mime: "audio/webm", size: 7, markers: [{ t: 4 }] });
  expect(source.duration).toBeGreaterThanOrEqual(10);
  expect(await new Response((await getBlob(source.blobId!))!.data).text()).toBe("aaaabbc");
  const lessons = await list("lessons", "courseId", c.id);
  expect(lessons).toMatchObject([{ id: source.lessonId, title: "Lesson 1", date: "2026-10-30", order: 1 }]);
  expect(await loadDraft()).toBeUndefined();
  expect(await getMeta("recording:r1:0")).toBeUndefined();
});

test("a recording stopped in a lesson stays there; a discarded one leaves nothing", async () => {
  const c = await put("courses", { ...fresh(), kind: "course", title: "Law" });
  const l = await put("lessons", { ...fresh(), courseId: c.id, title: "Torts", order: 1 });
  const d = await saveChunk(draft(c.id, { lessonId: l.id, markers: [{ t: 2 }, { t: 99 }] }), 0, new Blob(["x"]));
  const s = await finishDraft(d, [new Blob(["x"])], 3.04);
  expect(s.lessonId).toBe(l.id);
  expect(s.duration).toBe(3);
  expect(s.markers).toEqual([{ t: 2 }]);
  expect(await list("lessons", "courseId", c.id)).toHaveLength(1);

  const other = await saveChunk(draft(c.id, { id: "r2" }), 0, new Blob(["y"]));
  await discardDraft(other);
  expect(await loadDraft()).toBeUndefined();
  expect(await getMeta("recording:r2:0")).toBeUndefined();
});
