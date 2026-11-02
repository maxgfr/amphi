import { expect, test } from "bun:test";
import type { DiscoverInput, DiscoverStage, TopicMap } from "./discover.ts";
import { allJobs, removeJob, resetJobsForTests, startJob } from "./discover-jobs.ts";

const input = (topic: string): DiscoverInput => ({ kind: "topic", topic, level: "beginner", goal: "", language: "en" });
const map = (title: string): TopicMap => ({ title, overview: "", concepts: [{ title: "A", match: "k" }, { title: "B" }], proposals: [{ title: "P", why: "", excerpt: "", status: "found", suggested: true }], web: true });

test("maps run three at a time, say where they are, and keep their result with its ticks", async () => {
  const pending = new Map<string, { stage: (s: DiscoverStage) => void; done: (m: TopicMap) => void }>();
  resetJobsForTests(((i: DiscoverInput, _t: unknown, o: { stage?: (s: DiscoverStage) => void; signal?: AbortSignal }) =>
    new Promise<TopicMap>((done, fail) => {
      pending.set(i.topic, { stage: o.stage!, done });
      o.signal?.addEventListener("abort", () => fail(Object.assign(new Error("stopped"), { name: "AbortError" })));
    })) as never);
  const ids = ["One", "Two", "Three", "Four"].map((t) => startJob(input(t)));
  expect(allJobs().map((j) => j.status)).toEqual(["queued", "queued", "queued", "queued"]);
  expect([...pending.keys()]).toEqual(["One", "Two", "Three"]);
  pending.get("One")!.stage("searching");
  expect(allJobs()[0]!.status).toBe("searching");
  pending.get("One")!.done(map("One"));
  await Bun.sleep(0);
  expect(allJobs()[0]).toMatchObject({ status: "ready", chosen: [0], concepts: [1] });
  expect(pending.has("Four")).toBe(true);
  removeJob(ids[1]!);
  await Bun.sleep(0);
  expect(allJobs().map((j) => j.label)).toEqual(["One", "Three", "Four"]);
});
