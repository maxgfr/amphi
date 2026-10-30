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
