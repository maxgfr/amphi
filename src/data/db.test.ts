import { beforeEach, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { fresh, get, list, listAll, put, putBlob, remove, removeCourse, resetDbForTests, update } from "./db.ts";

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
