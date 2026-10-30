import { expect, test } from "bun:test";
import { courseHue, freeHue, HUES } from "./hue.ts";

test("a course keeps the colour it was given, else one from its id", () => {
  expect(courseHue({ id: "x", hue: 3 })).toBe(3);
  expect(courseHue({ id: "x", hue: 9 })).toBe(courseHue({ id: "x" }));
  expect(courseHue({ id: "abc" })).toBe(courseHue({ id: "abc" }));
  expect(courseHue({ id: "abc" })).toBeLessThan(HUES);
});

test("a new course takes the colour the fewest courses use", () => {
  expect(freeHue([])).toBe(0);
  expect(freeHue([{ id: "a", hue: 0 }, { id: "b", hue: 1 }])).toBe(2);
  const all = Array.from({ length: HUES }, (_, i) => ({ id: String(i), hue: i }));
  expect(freeHue([...all, { id: "z", hue: 0 }])).toBe(1);
  expect(freeHue([{ id: "a", hue: 0, deletedAt: 1 }])).toBe(0);
});
