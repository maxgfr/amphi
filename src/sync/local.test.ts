import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import type { Course, Source } from "../data/schema.ts";
import { exportZip, ImportError, importZip } from "./local.ts";
import { Device } from "./test-device.ts";

const T = 1_700_000_000_000;

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return (e as Error).message;
  }
  throw new Error("expected an ImportError");
}

describe("zip", () => {
  test("export → import on another device gives the same records and files; importing again changes nothing", async () => {
    const a = new Device();
    const c = a.edit<Course>("courses", { id: crypto.randomUUID(), createdAt: T, updatedAt: T, kind: "course", title: "Optics" });
    const pdf = await a.putBlob(new Uint8Array([1, 2, 3]), "application/pdf");
    const s = a.edit<Source>("sources", { id: crypto.randomUUID(), createdAt: T, updatedAt: T, courseId: c.id, kind: "pdf", title: "Slides", blobId: pdf, pages: [{ n: 1, text: "Light" }], status: "ready" });
    const zip = await exportZip(a);
    const b = new Device();
    const r = await importZip(b, zip);
    expect(r).toEqual({ records: 2, files: 1, problems: [] });
    expect(b.get("courses", c.id)).toEqual(c);
    expect(b.get("sources", s.id)).toEqual(s);
    expect(b.blobs.get(pdf)?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect((await importZip(b, zip)).records).toBe(0);
  });

  test("untrusted zips: not a zip, no amphi.json, unsafe paths, encrypted, bad records and files", async () => {
    const d = new Device();
    const zip = (files: Record<string, string | Uint8Array>) => new Blob([zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v]))) as Uint8Array<ArrayBuffer>]);
    const header = JSON.stringify({ format: "amphi/1", mode: "plain", created: T });
    expect(await failure(importZip(d, new Blob(["hello"])))).toBe("This file is not a zip");
    expect(await failure(importZip(d, zip({ "a.txt": "x" })))).toContain("amphi.json is missing");
    expect(await failure(importZip(d, zip({ "amphi.json": header, "../evil/course.json": "{}" })))).toContain("Unsafe path");
    expect(await failure(importZip(d, zip({ "amphi.json": JSON.stringify({ format: "amphi/1", mode: "encrypted", created: T }) })))).toContain("encrypted");
    expect(await failure(importZip(d, zip({ "amphi.json": JSON.stringify({ format: "amphi/9", mode: "plain", created: T }) })))).toContain("newer amphi");
    // Inside one top folder works; a bad record and a file whose hash does not match are left out.
    const r = await importZip(
      d,
      zip({
        "backup/amphi.json": header,
        "backup/courses/x-1/course.json": JSON.stringify({ id: "1", createdAt: T, updatedAt: T, kind: "course", title: "Ok" }),
        "backup/courses/y-2/course.json": JSON.stringify({ id: "2", title: "No times" }),
        [`backup/blobs/${"a".repeat(64)}.pdf`]: new Uint8Array([9]),
      }),
    );
    expect(r.records).toBe(1);
    expect(r.problems.sort()).toEqual([`blobs/${"a".repeat(64)}.pdf`, "courses/y-2/course.json"]);
  });
});
