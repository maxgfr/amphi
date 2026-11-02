// Discover's maps as jobs that outlive the screen: several can run at once
// (three at a time, the rest wait their turn), each says where it is, and the
// student can go elsewhere in the app meanwhile. Finished maps are kept on
// this device until they become a topic or are set aside, so a map already
// paid for is never lost; one cut short by a reload says so and can run again.

import { useSyncExternalStore } from "react";
import { type DiscoverInput, type DiscoverStage, type DiscoverTarget, discover, type TopicMap } from "./discover.ts";

export type JobStatus = "queued" | DiscoverStage | "ready" | "error" | "interrupted";

export interface DiscoverJob {
  id: string;
  /** What the list shows while there is no map title yet. */
  label: string;
  input: DiscoverInput;
  target: DiscoverTarget;
  status: JobStatus;
  map?: TopicMap;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  /** Ticked proposals and concepts, kept as the student chooses. */
  chosen?: number[];
  concepts?: number[];
}

const KEY = "amphi-discover-jobs";
const MAX_RUNNING = 3;
const MAX_KEPT = 20;

const running = new Map<string, AbortController>();
let runner: typeof discover = discover;
const listeners = new Set<() => void>();

function read(): DiscoverJob[] {
  try {
    const jobs = JSON.parse(localStorage.getItem(KEY) ?? "[]") as DiscoverJob[];
    if (!Array.isArray(jobs)) return [];
    // Whatever was running when the page went away did not finish.
    return jobs.map((j) => (j.status === "ready" || j.status === "error" || j.status === "interrupted" ? j : { ...j, status: "interrupted" }));
  } catch {
    return [];
  }
}

let jobs: readonly DiscoverJob[] = typeof localStorage === "undefined" ? [] : read();

function set(next: readonly DiscoverJob[]) {
  jobs = next.slice(-MAX_KEPT);
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs));
  } catch {
    // Storage full or blocked: the jobs still live in this tab.
  }
  for (const fn of listeners) fn();
}

const patch = (id: string, p: Partial<DiscoverJob>) => set(jobs.map((j) => (j.id === id ? { ...j, ...p } : j)));

export const getJob = (id: string | undefined) => jobs.find((j) => j.id === id);
export const isActive = (j: DiscoverJob) => j.status === "queued" || j.status === "searching" || j.status === "mapping";

/** A reload while maps are being made would lose them: the browser asks first. */
if (typeof window !== "undefined") {
  addEventListener("beforeunload", (e) => {
    if (running.size) e.preventDefault();
  });
}

function pump() {
  for (const j of jobs) {
    if (running.size >= MAX_RUNNING) return;
    if (j.status !== "queued" || running.has(j.id)) continue;
    const abort = new AbortController();
    running.set(j.id, abort);
    void runner(j.input, j.target, { signal: abort.signal, stage: (status) => patch(j.id, { status }) })
      .then((map) =>
        patch(j.id, {
          status: "ready",
          map,
          finishedAt: Date.now(),
          chosen: map.proposals.flatMap((p, i) => (p.suggested ? [i] : [])),
          concepts: map.concepts.flatMap((c, i) => (c.match ? [] : [i])),
        }),
      )
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") set(jobs.filter((x) => x.id !== j.id));
        else patch(j.id, { status: "error", error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() });
      })
      .finally(() => {
        running.delete(j.id);
        pump();
      });
  }
}

/** Queue a map; it starts as soon as fewer than three run. */
export function startJob(input: DiscoverInput, target: DiscoverTarget = {}, label = input.topic.trim()): string {
  const id = crypto.randomUUID();
  set([...jobs, { id, label, input, target, status: "queued", startedAt: Date.now() }]);
  pump();
  return id;
}

/** A map made before maps were jobs (an old draft), kept as a finished one. */
export function adoptJob(input: DiscoverInput, target: DiscoverTarget, map: TopicMap, chosen: number[] = [], concepts: number[] = []): string {
  const id = crypto.randomUUID();
  set([...jobs, { id, label: map.title, input, target, status: "ready", map, chosen, concepts, startedAt: Date.now(), finishedAt: Date.now() }]);
  return id;
}

export const sameTarget = (a: DiscoverTarget, b: DiscoverTarget) => (a.courseId ?? "") === (b.courseId ?? "") && (a.conceptId ?? "") === (b.conceptId ?? "") && Boolean(a.refresh) === Boolean(b.refresh);

/** Run a failed or interrupted map again, in place. */
export function retryJob(id: string) {
  patch(id, { status: "queued", error: undefined, map: undefined, startedAt: Date.now(), finishedAt: undefined });
  pump();
}

/** Stop a map, or set a finished one aside. */
export function removeJob(id: string) {
  running.get(id)?.abort();
  running.delete(id);
  set(jobs.filter((j) => j.id !== id));
}

export function chooseInJob(id: string, p: Pick<DiscoverJob, "chosen" | "concepts">) {
  patch(id, p);
}

/** The jobs as they are now, outside React. */
export const allJobs = (): readonly DiscoverJob[] => jobs;

export function useDiscoverJobs(): readonly DiscoverJob[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => jobs,
    () => jobs,
  );
}

/** For tests: forget every job, and map with `run` instead of the model. */
export function resetJobsForTests(run: typeof discover = discover) {
  runner = run;
  for (const a of running.values()) a.abort();
  running.clear();
  jobs = [];
}
