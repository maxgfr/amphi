import { expect, test } from "bun:test";
import { recycling } from "./recycle.ts";

test("an instance is renewed every few runs", async () => {
  let made = 0;
  const run = recycling(async () => ({ n: ++made }), 3);
  const seen: number[] = [];
  for (let i = 0; i < 7; i++) seen.push(await run((x) => x.n));
  expect(seen).toEqual([1, 1, 1, 2, 2, 2, 3]);
});

test("a run that aborts is tried once more on a fresh instance", async () => {
  let made = 0;
  const run = recycling(async () => ({ n: ++made }), 20);
  expect(
    await run((x) => {
      if (x.n === 1) throw new Error("Aborted()");
      return x.n;
    }),
  ).toBe(2);
  await expect(
    run(() => {
      throw new Error("Aborted()");
    }),
  ).rejects.toThrow("Aborted()");
  // Failing twice left nothing broken behind: the next run gets a new instance.
  expect(await run((x) => x.n)).toBe(4);
});

test("an instance that fails to load is not kept", async () => {
  let made = 0;
  const run = recycling(async () => {
    made++;
    if (made === 1) throw new Error("offline");
    return made;
  }, 20);
  await expect(run((x) => x)).rejects.toThrow("offline");
  expect(await run((x) => x)).toBe(2);
});
