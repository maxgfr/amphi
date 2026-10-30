import { describe, expect, test } from "bun:test";
import { keepEspeakFile, trimEspeak } from "./espeak.ts";

const glueOf = (files: { filename: string; start: number; end: number }[], size: number) => `var x=1;loadPackage(${JSON.stringify({ files, remote_package_size: size })})})();var y=2;`;

describe("trimEspeak", () => {
  test("keeps the chosen files, packed, with offsets rewritten", () => {
    const data = new Uint8Array([1, 1, 2, 2, 2, 3]);
    const glue = glueOf(
      [
        { filename: "/espeak-ng-data/ru_dict", start: 0, end: 2 },
        { filename: "/espeak-ng-data/fr_dict", start: 2, end: 5 },
        { filename: "/espeak-ng-data/phontab", start: 5, end: 6 },
      ],
      6,
    );
    const out = trimEspeak(glue, data);
    expect([...out.data]).toEqual([2, 2, 2, 3]);
    const meta = JSON.parse(/loadPackage\((.*)\)\}\)\(\);/.exec(out.glue)![1]!);
    expect(meta).toEqual({
      files: [
        { filename: "/espeak-ng-data/fr_dict", start: 0, end: 3 },
        { filename: "/espeak-ng-data/phontab", start: 3, end: 4 },
      ],
      remote_package_size: 4,
    });
    expect(out.glue.startsWith("var x=1;")).toBe(true);
    expect(out.glue.endsWith("var y=2;")).toBe(true);
  });

  test("refuses a data package that does not match its loader", () => {
    expect(() => trimEspeak(glueOf([], 10), new Uint8Array(3))).toThrow("does not match");
    expect(() => trimEspeak("no loader here", new Uint8Array(0))).toThrow("not found");
  });

  test("keeps English, French and German, the shared tables and the languages", () => {
    expect(keepEspeakFile("/espeak-ng-data/en_dict")).toBe(true);
    expect(keepEspeakFile("/espeak-ng-data/de_dict")).toBe(true);
    expect(keepEspeakFile("/espeak-ng-data/cmn_dict")).toBe(false);
    expect(keepEspeakFile("/espeak-ng-data/phondata")).toBe(true);
    expect(keepEspeakFile("/espeak-ng-data/lang/roa/fr")).toBe(true);
    expect(keepEspeakFile("/espeak-ng-data/voices/!v/Demonic")).toBe(false);
  });
});

test("the shipped package trims to the three languages", async () => {
  const dir = new URL("../node_modules/@diffusionstudio/piper-wasm/build/", import.meta.url).pathname;
  const glue = await Bun.file(`${dir}piper_phonemize.js`).text();
  const data = new Uint8Array(await Bun.file(`${dir}piper_phonemize.data`).arrayBuffer());
  const out = trimEspeak(glue, data);
  expect(out.data.byteLength).toBeLessThan(2_000_000);
  expect(out.glue).toContain('"/espeak-ng-data/fr_dict"');
  expect(out.glue).not.toContain('"/espeak-ng-data/ru_dict"');
});
