// A citation label ("S1 p.3", "S2 12:34") back to its source: labels number
// the sources in the order they were given to the model.

import { resolveLabel } from "../ai/context.ts";
import type { Id } from "../data/schema.ts";
import { go, href } from "../router.ts";

export const keysOf = (sourceIds: readonly Id[]) => new Map(sourceIds.map((id, i) => [id, `S${i + 1}`]));

/** Opens the passage a label points to; false when it points nowhere. */
export function openCitation(label: string, sourceIds: readonly Id[]): boolean {
  const r = resolveLabel(label, keysOf(sourceIds));
  if (!r) return false;
  go(href.source(r.sourceId, { page: r.page, t: r.t }));
  return true;
}
