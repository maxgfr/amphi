// What amphi keeps. IndexedDB is the source of truth on each device; sync
// (src/sync) writes the same records to the user's repository. Every record
// carries its own times, and a deletion is a tombstone (`deletedAt`) so it
// reaches the other devices.

export type Id = string;

export interface Base {
  id: Id;
  createdAt: number;
  updatedAt: number;
  /** Set when deleted: the record stays as a tombstone so the deletion syncs. */
  deletedAt?: number;
}

/** A course the student follows, or a topic they discover on their own: both hold lessons, sources and the Studio. */
export interface Course extends Base {
  kind: "course" | "topic";
  title: string;
  emoji?: string;
  /** Spoken and written language of the material (BCP 47, "fr"); the interface's when unset. */
  language?: string;
  /** YYYY-MM-DD. */
  examDate?: string;
  /** Topics: what the student wants (exam, general knowledge, project) and their level. */
  goal?: string;
  level?: string;
}

export interface Lesson extends Base {
  courseId: Id;
  title: string;
  /** YYYY-MM-DD. */
  date?: string;
  order: number;
}

export interface SourcePage {
  /** 1-based page number. */
  n: number;
  text: string;
}

export interface Segment {
  /** Seconds. */
  start: number;
  end: number;
  text: string;
}

export interface TranscriptData {
  language?: string;
  duration?: number;
  engine?: string;
  segments: Segment[];
}

export interface Marker {
  /** Seconds into the recording. */
  t: number;
  label?: string;
}

export type SourceKind = "pdf" | "text" | "audio" | "video" | "recording" | "web";
export type SourceStatus = "ready" | "pending" | "transcribing" | "error";

export interface Source extends Base {
  courseId: Id;
  lessonId?: Id;
  kind: SourceKind;
  title: string;
  mime?: string;
  size?: number;
  /** The original file (PDF, audio, video), in the blob store. */
  blobId?: Id;
  /** Where a web source came from (Discover). */
  url?: string;
  /** PDF text, page by page. */
  pages?: SourcePage[];
  /** Markdown text (notes, pasted text, web sources). */
  text?: string;
  /** Audio, video and recordings, once transcribed. */
  transcript?: TranscriptData;
  /** Moments marked as important while recording. */
  markers?: Marker[];
  /** Seconds, for media. */
  duration?: number;
  status: SourceStatus;
  error?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at: number;
  /** Answers: the sources in the order their labels number them (S1 = the first). */
  sourceIds?: Id[];
}

export interface Chat extends Base {
  courseId: Id;
  lessonId?: Id;
  /** "tutor": a Socratic session on one concept (Progress). */
  mode: "chat" | "tutor";
  conceptId?: Id;
  title: string;
  messages: ChatMessage[];
  /** The exchange's summary (Markdown), kept as a note. */
  summary?: string;
  summarizedAt?: number;
}

export const ARTIFACT_TYPES = ["report", "mindmap", "quiz", "flashcards", "infographic", "slides", "audio", "podcast", "video"] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** Something the Studio produced from sources: its data is the type's own JSON (see src/studio/<type>.ts). */
export interface Artifact<D = unknown> extends Base {
  courseId: Id;
  lessonId?: Id;
  type: ArtifactType;
  title: string;
  /** The sources it was made from. */
  sourceIds: Id[];
  /** The generation settings (length, tone, level…), per type. */
  options: Record<string, unknown>;
  language?: string;
  data: D;
  /** Rendered media (audio, video…), name → blob id. */
  media?: Record<string, Id>;
  status: "working" | "ready" | "error";
  error?: string;
  /** Bumped on each regeneration. */
  version: number;
}

/** A notion to master, in the order to learn it (Progress). */
export interface Concept extends Base {
  courseId: Id;
  title: string;
  summary: string;
  order: number;
  prerequisites: Id[];
  /** Citation labels into the sources ("S1 p.3"). */
  refs: string[];
}

/** One sign of how well a concept is known: a quiz answer, a flashcard, a self-assessment, a tutor session. */
export interface StudyEvent extends Base {
  courseId: Id;
  conceptId?: Id;
  artifactId?: Id;
  kind: "quiz" | "card" | "self" | "tutor";
  /** 0 (not known) to 1 (known). */
  score: number;
  at: number;
}

export interface BlobRecord {
  /** sha-256 of the bytes, hex: the same file is stored once. */
  id: Id;
  mime: string;
  size: number;
  data: Blob;
  createdAt: number;
}

export interface Tables {
  courses: Course;
  lessons: Lesson;
  sources: Source;
  chats: Chat;
  artifacts: Artifact;
  concepts: Concept;
  events: StudyEvent;
}
export type Table = keyof Tables;
export const TABLES: readonly Table[] = ["courses", "lessons", "sources", "chats", "artifacts", "concepts", "events"];
