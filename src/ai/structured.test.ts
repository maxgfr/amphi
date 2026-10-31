import { expect, test } from "bun:test";
import { z } from "zod";
import { extractJson, issuesOf } from "./structured.ts";

test("finds JSON in fences, after prose and with nested values", () => {
  expect(extractJson('```json\n{"a": [1, {"b": "x}"}]}\n```')).toEqual({ a: [1, { b: "x}" }] });
  expect(extractJson('Here it is: [{"q": "why?"}] Hope it helps.')).toEqual([{ q: "why?" }]);
  expect(extractJson('{"s": "quote \\" and ] inside"}')).toEqual({ s: 'quote " and ] inside' });
  expect(extractJson("no json here")).toBeNull();
  expect(extractJson('{"broken": ')).toBeNull();
});

test("issues are short and say where", () => {
  const r = z.object({ items: z.array(z.string()) }).safeParse({ items: [1] });
  expect(r.success).toBe(false);
  if (!r.success) expect(issuesOf(r.error)).toContain("items.0");
});

test("a reasoning model gets room to think on top of the answer, within its cap", async () => {
  const { outputCap, THINKING_ROOM } = await import("./llm.ts");
  expect(outputCap(4500, { reasoning: true, maxOutput: 64_000 })).toBe(4500 + THINKING_ROOM);
  expect(outputCap(4500, { reasoning: false, maxOutput: 64_000 })).toBe(4500);
  expect(outputCap(9000, { reasoning: true, maxOutput: 16_000 })).toBe(16_000);
  expect(outputCap(4500, { reasoning: true, maxOutput: 0 })).toBe(4500 + THINKING_ROOM);
  expect(outputCap(undefined, { reasoning: true, maxOutput: 64_000 })).toBeUndefined();
});
