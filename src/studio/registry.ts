// Every Studio artifact type, in the groups and order the Studio shows them.
// A new type is one module and one entry here.

import type { ArtifactType } from "../data/schema.ts";
import type { T } from "../i18n.ts";
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

/** What a student does with what is made: read it, practise with it, listen to or watch it. */
export const STUDIO_GROUPS: { id: string; label: (t: T) => string; kinds: StudioKind[] }[] = [
  { id: "read", label: (t) => t("Read", "Lire", "Lesen"), kinds: [report, mindmap, infographic, slides] },
  { id: "practise", label: (t) => t("Practise", "S'entraîner", "Üben"), kinds: [quiz, flashcards] },
  { id: "listen", label: (t) => t("Listen and watch", "Écouter et regarder", "Hören und sehen"), kinds: [audio, podcast, video] },
];

export const STUDIO: StudioKind[] = STUDIO_GROUPS.flatMap((g) => g.kinds);

export const studioKind = (type: ArtifactType): StudioKind | undefined => STUDIO.find((k) => k.type === type);
