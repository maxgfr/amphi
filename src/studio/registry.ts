// Every Studio artifact type, in the order the Studio shows them. A new type
// is one module and one line here.

import type { ArtifactType } from "../data/schema.ts";
import { infographic } from "./infographic.tsx";
import { mindmap } from "./mindmap.tsx";
import { quiz } from "./quiz.tsx";
import { report } from "./report.tsx";
import type { StudioKind } from "./types.ts";

export const STUDIO: StudioKind[] = [report, mindmap, quiz, infographic];

export const studioKind = (type: ArtifactType): StudioKind | undefined => STUDIO.find((k) => k.type === type);
