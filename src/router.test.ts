import { expect, test } from "bun:test";
import { href, parse } from "./router.ts";

test("routes round-trip through their links", () => {
  expect(parse(href.today())).toEqual({ page: "today" });
  expect(parse(href.course("c1", "studio"))).toEqual({ page: "course", id: "c1", tab: "studio" });
  expect(parse(href.lesson("l1"))).toEqual({ page: "lesson", id: "l1", tab: undefined });
  expect(parse(href.source("s1", { page: 3 }))).toEqual({ page: "source", id: "s1", at: { page: 3, t: undefined } });
  expect(parse(href.source("s1", { t: 65.4 }))).toEqual({ page: "source", id: "s1", at: { page: undefined, t: 65 } });
  expect(parse(href.record("c1", "l1"))).toEqual({ page: "record", courseId: "c1", lessonId: "l1" });
  expect(parse(href.settings("sync"))).toEqual({ page: "settings", section: "sync" });
  expect(parse("#/nowhere")).toEqual({ page: "today" });
});
