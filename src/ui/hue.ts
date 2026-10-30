// Every course is a coloured divider in the student's binder. Its colour comes
// from its id, so it is the same on every device without being stored or synced.

import { useEffect, useSyncExternalStore } from "react";

/** The seven divider colours, styled as `[data-hue="0"]`…`[data-hue="6"]` in styles.css. */
export const HUES = 7;

export function courseHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % HUES;
}

// The course the open screen belongs to, so the sidebar can light its divider.
let open: string | undefined;
const listeners = new Set<() => void>();
const set = (id: string | undefined) => {
  if (open === id) return;
  open = id;
  for (const l of listeners) l();
};

/** Marks `id` as the open course while the calling screen is shown. */
export function useOpenCourse(id: string | undefined) {
  useEffect(() => {
    set(id);
    return () => set(undefined);
  }, [id]);
}

export function useOpenCourseId(): string | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
}
