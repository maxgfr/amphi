// A citation label ("S1 p.3", "S2 12:34") back to its source: labels number
// the sources in the order they were given to the model. Opening one shows
// the passage in a sheet over the current screen, so a chat or a report
// stays where it was.

import { useSyncExternalStore } from "react";
import { passagesOf, resolveLabel } from "../ai/context.ts";
import type { Id, Source } from "../data/schema.ts";

export const keysOf = (sourceIds: readonly Id[]) => new Map(sourceIds.map((id, i) => [id, `S${i + 1}`]));

export interface Shown {
  label: string;
  sourceId: Id;
  /** "S1": the key the label uses for its source. */
  key: string;
  page?: number;
  t?: number;
}

let shown: Shown | null = null;
const listeners = new Set<() => void>();
const set = (s: Shown | null) => {
  shown = s;
  for (const l of listeners) l();
};

/** Shows the passage a label points to; false when it points nowhere. */
export function openCitation(label: string, sourceIds: readonly Id[]): boolean {
  const r = resolveLabel(label, keysOf(sourceIds));
  if (!r) return false;
  set({ label, key: label.split(" ")[0]!, ...r });
  return true;
}

export const closeCitation = () => set(null);

export function useShownCitation(): Shown | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shown,
  );
}

/** The text a label points to: its passage, every passage of its page, the passage at its moment, or the start of the source. */
export function passageText(source: Source, key: string, label: string, t?: number): string {
  const all = passagesOf(source, key);
  const exact = all.filter((p) => p.label === label);
  if (exact.length) return exact.map((p) => p.text).join("\n\n");
  if (t !== undefined) {
    const before = all.filter((p) => p.t !== undefined && p.t <= t);
    const at = before[before.length - 1];
    if (at) return at.text;
  }
  return all[0]?.text ?? "";
}
