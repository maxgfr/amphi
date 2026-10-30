// Every course is a coloured divider in the student's binder. Its colour is
// chosen when it is made (or later in its settings) and synced with it; older
// courses take one from their id, the same on every device.

import { useEffect, useSyncExternalStore } from "react";

/** The seven divider colours, styled as `[data-hue="0"]`…`[data-hue="6"]` in styles.css. */
export const HUES = 7;

export function courseHue(course: { id: string; hue?: number }): number {
  if (course.hue !== undefined && course.hue >= 0 && course.hue < HUES) return course.hue;
  let h = 0;
  for (let i = 0; i < course.id.length; i++) h = (h * 31 + course.id.charCodeAt(i)) | 0;
  return Math.abs(h) % HUES;
}

/** The colour for a new course: the one the fewest courses already use, so neighbouring dividers differ. */
export function freeHue(courses: readonly { id: string; hue?: number; deletedAt?: number }[]): number {
  const used = Array.from({ length: HUES }, () => 0);
  for (const c of courses) if (!c.deletedAt) used[courseHue(c)]! += 1;
  return used.indexOf(Math.min(...used));
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
