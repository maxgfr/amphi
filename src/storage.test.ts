import { afterEach, describe, expect, test } from "bun:test";
import { readLocal, writeLocal } from "./storage.ts";

const original = globalThis.localStorage;
afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true, writable: true });
});

function install(storage: Partial<Storage> | undefined) {
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
}

describe("storage on a shared origin", () => {
  test("a full storage makes writes report false instead of throwing", () => {
    install({
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    expect(writeLocal("amphi-theme", "dark")).toBe(false);
  });

  test("a blocked storage reads as empty", () => {
    install({
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
    expect(readLocal("amphi-theme")).toBeNull();
    install(undefined);
    expect(readLocal("amphi-theme")).toBeNull();
    expect(writeLocal("amphi-theme", "dark")).toBe(false);
  });

  test("a working storage keeps the value", () => {
    const m = new Map<string, string>();
    install({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
    expect(writeLocal("amphi-theme", "dark")).toBe(true);
    expect(readLocal("amphi-theme")).toBe("dark");
  });
});
