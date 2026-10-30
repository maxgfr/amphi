// Runs Studio generations: the artifact is saved as "working" at once, its
// progress is kept here (so it survives leaving the screen), and it ends
// "ready" with its data and media, or "error" with the reason.

import { useSyncExternalStore } from "react";
import { fresh, get, list, put, putBlob } from "../data/db.ts";
import type { Artifact, ArtifactType, Id } from "../data/schema.ts";
import { currentLang } from "../i18n.ts";
import type { Progress, StudioKind } from "./types.ts";

export interface Job {
  artifactId: Id;
  type: ArtifactType;
  progress: Progress;
  abort: AbortController;
}

const jobs = new Map<Id, Job>();
const listeners = new Set<() => void>();
let snapshot: Job[] = [];
const emit = () => {
  snapshot = [...jobs.values()];
  for (const fn of listeners) fn();
};

export function useJobs(): Job[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}

export const cancelJob = (artifactId: Id) => jobs.get(artifactId)?.abort.abort();

export interface RunInput {
  courseId: Id;
  lessonId?: Id;
  sourceIds: Id[];
  options: Record<string, unknown>;
  /** Regenerate this artifact (a new version) instead of making a new one. */
  replace?: Artifact;
}

export async function runStudio(k: StudioKind, input: RunInput): Promise<Id> {
  const course = await get("courses", input.courseId);
  if (!course) throw new Error("course not found");
  const lesson = input.lessonId ? await get("lessons", input.lessonId) : undefined;
  const all = await list("sources", "courseId", input.courseId);
  const sources = input.sourceIds.map((id) => all.find((s) => s.id === id)).filter((s) => s !== undefined);
  const language = course.language || currentLang();
  const base: Artifact = input.replace
    ? { ...input.replace, status: "working", error: undefined, options: input.options, sourceIds: input.sourceIds, version: input.replace.version + 1 }
    : {
        ...fresh(),
        courseId: input.courseId,
        lessonId: input.lessonId,
        type: k.type,
        title: "",
        sourceIds: input.sourceIds,
        options: input.options,
        language,
        data: null,
        status: "working",
        version: 1,
      };
  const saved = await put("artifacts", base);
  const job: Job = { artifactId: saved.id, type: k.type, progress: {}, abort: new AbortController() };
  jobs.set(saved.id, job);
  emit();
  void (async () => {
    try {
      const out = await k.generate(
        {
          course,
          lesson,
          sources,
          language,
          signal: job.abort.signal,
          progress: (p) => {
            job.progress = p;
            emit();
          },
        },
        input.options,
      );
      const media: Record<string, Id> = {};
      for (const [name, blob] of Object.entries(out.media ?? {})) media[name] = await putBlob(blob);
      const cur = (await get("artifacts", saved.id)) ?? saved;
      await put("artifacts", { ...cur, title: out.title, data: out.data, media: out.media ? media : cur.media, status: "ready", error: undefined });
    } catch (e) {
      const cur = (await get("artifacts", saved.id)) ?? saved;
      const aborted = job.abort.signal.aborted;
      // A cancelled first version leaves nothing behind; a cancelled regeneration keeps the previous one.
      if (aborted && input.replace) await put("artifacts", { ...input.replace });
      else if (aborted) await put("artifacts", { ...cur, status: "error", error: "cancelled", deletedAt: Date.now() });
      else await put("artifacts", { ...cur, status: "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      jobs.delete(saved.id);
      emit();
    }
  })();
  return saved.id;
}
