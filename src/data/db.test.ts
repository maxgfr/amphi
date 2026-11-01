import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { emptyTrash, fresh, get, list, listAll, listTrash, purgeTrash, put, putBlob, remove, removeCourse, resetDbForTests, restore, trash, update } from "./db.ts";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

test("records are written, read, updated and deleted as tombstones", async () => {
  const c = await put("courses", { ...fresh(1), kind: "course", title: "Physics" });
  expect(c.updatedAt).toBeGreaterThan(1);
  await update("courses", c.id, { title: "Physics II" });
  expect((await get("courses", c.id))?.title).toBe("Physics II");
  await remove("courses", c.id);
  expect(await get("courses", c.id)).toBeUndefined();
  expect(await list("courses")).toEqual([]);
  const all = await listAll("courses");
  expect(all[0]?.deletedAt).toBeNumber();
});

test("deleting a course deletes what is in it", async () => {
  const c = await put("courses", { ...fresh(), kind: "course", title: "Law" });
  const l = await put("lessons", { ...fresh(), courseId: c.id, title: "1", order: 1 });
  await put("sources", { ...fresh(), courseId: c.id, lessonId: l.id, kind: "text", title: "n", text: "x", status: "ready" });
  await removeCourse(c.id);
  expect(await list("lessons")).toEqual([]);
  expect(await list("sources")).toEqual([]);
  expect((await listAll("sources")).length).toBe(1);
});

test("the same file is stored once", async () => {
  const a = await putBlob(new Blob(["hello"], { type: "text/plain" }));
  const b = await putBlob(new Blob(["hello"], { type: "text/plain" }));
  expect(a).toBe(b);
  expect(a).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

const DAY = 86_400_000;

async function lawCourse() {
  const c = await put("courses", { ...fresh(), kind: "course", title: "Law" });
  const l = await put("lessons", { ...fresh(), courseId: c.id, title: "1", order: 1 });
  const s = await put("sources", { ...fresh(), courseId: c.id, lessonId: l.id, kind: "text", title: "n", text: "x", status: "ready" });
  return { c, l, s };
}

test("a course goes to the trash with what is in it, and comes back the same", async () => {
  const { c, l, s } = await lawCourse();
  expect(await trash("courses", c.id)).toBe(true);
  expect(await get("courses", c.id)).toBeUndefined();
  expect(await list("sources")).toEqual([]);
  expect((await listAll("sources"))[0]).toMatchObject({ trashedWith: c.id });
  expect(await update("lessons", l.id, { title: "2" })).toBeUndefined();
  const [entry, ...others] = await listTrash();
  expect(others).toEqual([]);
  expect(entry).toMatchObject({ table: "courses", items: 2 });
  await restore("sources", s.id);
  expect((await get("courses", c.id))?.title).toBe("Law");
  expect((await get("sources", s.id))?.trashedWith).toBeUndefined();
  expect(await listTrash()).toEqual([]);
});

test("what was thrown away before its course stays in the trash when the course comes back", async () => {
  const { c, l, s } = await lawCourse();
  await trash("lessons", l.id);
  await trash("courses", c.id);
  expect((await listTrash()).map((e) => e.table)).toEqual(["courses", "lessons"]);
  await restore("courses", c.id);
  expect(await get("lessons", l.id)).toBeUndefined();
  await trash("courses", c.id);
  // Restoring the lesson brings back the course it sits in.
  await restore("lessons", l.id);
  expect(await get("courses", c.id)).toBeDefined();
  expect(await get("sources", s.id)).toBeDefined();
});

test("the trash is purged after 30 days, and deleting a course takes its trash with it", async () => {
  const { c, l, s } = await lawCourse();
  await trash("sources", s.id, Date.now() - 31 * DAY);
  const fresher = await put("sources", { ...fresh(), courseId: c.id, kind: "text", title: "m", text: "y", status: "ready" });
  await trash("sources", fresher.id);
  await purgeTrash();
  expect((await listAll("sources")).find((r) => r.id === s.id)?.deletedAt).toBeNumber();
  expect((await listTrash()).map((e) => e.record.id)).toEqual([fresher.id]);
  await removeCourse(c.id);
  expect((await listAll("sources")).every((r) => r.deletedAt)).toBe(true);
  expect((await listAll("lessons")).find((r) => r.id === l.id)?.deletedAt).toBeNumber();
  await emptyTrash();
  expect(await listTrash()).toEqual([]);
});
