// Short messages at the bottom of the screen, each with at most one action
// (Undo). A toast leaves on its own after a while, but never while the pointer
// or the keyboard focus is on it, so it can always be reached (WCAG 2.2.1).

import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => unknown };
  ms: number;
}

let toasts: readonly Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function set(value: readonly Toast[]) {
  toasts = value;
  for (const fn of listeners) fn();
}

/** Show a message; the three latest stay on screen. */
export function toast(o: { text: string; action?: Toast["action"]; ms?: number }): number {
  const t: Toast = { id: next++, ms: 8000, ...o };
  set([...toasts, t].slice(-3));
  resume(t.id);
  return t.id;
}

export function dismiss(id: number) {
  hold(id);
  set(toasts.filter((t) => t.id !== id));
}

/** Keep a toast while the student reads or reaches it. */
export function hold(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

export function resume(id: number) {
  const t = toasts.find((x) => x.id === id);
  if (!t) return;
  hold(id);
  timers.set(id, setTimeout(() => dismiss(id), t.ms));
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => toasts,
    () => toasts,
  );
}
