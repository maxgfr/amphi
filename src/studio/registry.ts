// Every Studio artifact type, in the order the Studio shows them. A new type
// is one module and one line here.

import type { ArtifactType } from "../data/schema.ts";
import { audio } from "./audio.tsx";
import { flashcards } from "./flashcards.tsx";
import { infographic } from "./infographic.tsx";
import { mindmap } from "./mindmap.tsx";
import { podcast } from "./podcast.tsx";
import { quiz } from "./quiz.tsx";
import { report } from "./report.tsx";
import { slides } from "./slides.tsx";
import type { StudioKind } from "./types.ts";
import { video } from "./video.tsx";

export const STUDIO: StudioKind[] = [report, mindmap, quiz, flashcards, infographic, slides, audio, podcast, video];

export const studioKind = (type: ArtifactType): StudioKind | undefined => STUDIO.find((k) => k.type === type);
