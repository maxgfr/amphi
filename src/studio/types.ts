// The contract every Studio artifact follows. A type lives in its own module
// (src/studio/<type>.tsx) and is listed once in src/studio/registry.ts: how
// it is described, its options, how it is generated from sources, how it is
// shown and edited, and what it exports to.

import type { FC } from "react";
import type { Artifact, ArtifactType, Course, Lesson, Source } from "../data/schema.ts";
import type { T } from "../i18n.ts";
import type { IconName } from "../ui/icons.tsx";

export interface Progress {
  /** 0..1 when known. */
  ratio?: number;
  /** What is happening, in the interface's language. */
  label?: string;
}

export interface StudioContext {
  course: Course;
  lesson?: Lesson;
  sources: Source[];
  /** Code of the language to write in ("fr"). */
  language: string;
  signal: AbortSignal;
  progress: (p: Progress) => void;
}

export interface Generated<D> {
  title: string;
  data: D;
  /** Rendered files (audio, video…), stored as blobs and kept under these names in `artifact.media`. */
  media?: Record<string, Blob>;
}

export interface ExportFile {
  blob: Blob;
  filename: string;
}

export interface StudioExport<D> {
  id: string;
  label: (t: T) => string;
  /** A file to download, or nothing when the export acts by itself (printing to PDF). */
  run: (artifact: Artifact<D>, ctx: { course: Course; lesson?: Lesson; sources: Source[] }) => Promise<ExportFile | void>;
}

export interface OptionsProps<O> {
  value: O;
  onChange: (value: O) => void;
}

export interface ViewProps<D> {
  artifact: Artifact<D>;
  course: Course;
  sources: Source[];
  /** Save edited data (the artifact keeps its version). */
  onChange: (data: D) => void;
}

export interface StudioKind<D = unknown, O extends Record<string, unknown> = Record<string, unknown>> {
  type: ArtifactType;
  icon: IconName;
  label: (t: T) => string;
  /** One line under the label: what it is for. */
  blurb: (t: T) => string;
  defaults: O;
  Options?: FC<OptionsProps<O>>;
  /** Why it cannot run now (missing capability, no browser support), or null. `language` is the course's. */
  problem?: (t: T, language: string) => string | null;
  /** What leaves the device besides the sources' text, or downloads, shown before generating ("the script goes to OpenAI for the voices"). */
  sends?: (t: T, options: O, language: string) => string | null;
  generate: (ctx: StudioContext, options: O) => Promise<Generated<D>>;
  View: FC<ViewProps<D>>;
  exports?: StudioExport<D>[];
}

/** Erases a kind's types for the registry. */
export const kind = <D, O extends Record<string, unknown>>(k: StudioKind<D, O>) => k as unknown as StudioKind;
