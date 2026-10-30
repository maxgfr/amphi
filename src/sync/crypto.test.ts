import { describe, expect, test } from "bun:test";
import { checkValue, CryptoError, decryptFile, deriveKeys, encryptFile, newSalt, objectName, open, PBKDF2_ITERATIONS, seal, toBase64 } from "./crypto.ts";

const enc = new TextEncoder();
const salt = newSalt();
const keys = await deriveKeys("correct horse battery staple", salt, 1000);

async function rejects(p: Promise<unknown>) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(CryptoError);
}

describe("crypto", () => {
  test("a file round trip, as bytes and as base64 text; names are opaque and stable", async () => {
    const path = "courses/thermo-1234/course.json";
    const a = await encryptFile(keys, path, enc.encode('{"title":"Thermo"}'));
    const b = await encryptFile(keys, path, enc.encode('{"title":"Thermo"}'));
    expect(a.name).toBe(b.name);
    expect(a.name).toMatch(/^objects\/[0-9a-f]{64}$/);
    expect(a.bytes).not.toEqual(b.bytes); // fresh IVs
    expect(new TextDecoder().decode(a.bytes)).not.toContain("Thermo");
    const back = await decryptFile(keys, a.name, a.bytes);
    expect(back.path).toBe(path);
    expect(new TextDecoder().decode(back.bytes)).toBe('{"title":"Thermo"}');
    const text = await decryptFile(keys, a.name, enc.encode(toBase64(a.bytes)));
    expect(text.path).toBe(path);
    // Media are named by hash alone, apart from records.
    expect(await objectName(keys, `blobs/${"a".repeat(64)}.pdf`)).toBe(await objectName(keys, `blobs/${"a".repeat(64)}`));
    expect(await objectName(keys, `blobs/${"a".repeat(64)}.pdf`)).toMatch(/^media\//);
  });

  test("tampering, a wrong passphrase, a moved object and a wrong AAD are refused", async () => {
    const path = "courses/a/course.json";
    const f = await encryptFile(keys, path, enc.encode("secret"));
    const flipped = f.bytes.slice();
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 1;
    await rejects(decryptFile(keys, f.name, flipped));
    const other = await deriveKeys("wrong passphrase!", salt, 1000);
    await rejects(decryptFile(other, f.name, f.bytes));
    expect(await checkValue(other)).not.toBe(await checkValue(keys));
    expect(await checkValue(await deriveKeys("correct horse battery staple", salt, 1000))).toBe(await checkValue(keys));
    // Moved to another object's name.
    const g = await encryptFile(keys, "courses/b/course.json", enc.encode("other"));
    await rejects(decryptFile(keys, g.name, f.bytes));
    // AAD = the logical path.
    const sealed = await seal(keys, path, enc.encode("x"));
    expect(new TextDecoder().decode(await open(keys, path, sealed))).toBe("x");
    await rejects(open(keys, "courses/b/course.json", sealed));
    await rejects(decryptFile(keys, f.name, enc.encode("not an object")));
  });

  test("the real key derivation: PBKDF2-SHA256, 600 000 iterations", async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const k = await deriveKeys("passphrase", salt);
    const f = await encryptFile(k, "a.json", enc.encode("1"));
    expect((await decryptFile(k, f.name, f.bytes)).path).toBe("a.json");
  });
});
