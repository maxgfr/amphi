// Routing lives in the hash (GitHub Pages serves one page): #/c/<course>/studio,
// #/l/<lesson>/chat, #/s/<source>?p=3, #/a/<artifact>, #/record/<course>/<lesson>.

import { useSyncExternalStore } from "react";

export type Route =
  | { page: "today" }
  | { page: "courses" }
  | { page: "discover" }
  | { page: "course"; id: string; tab?: string }
  | { page: "lesson"; id: string; tab?: string }
  | { page: "source"; id: string; at?: { page?: number; t?: number } }
  | { page: "artifact"; id: string }
  | { page: "record"; courseId: string; lessonId?: string }
  | { page: "settings"; section?: string };

export function parse(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [a, b, c] = path.split("/").map((x) => decodeURIComponent(x));
  const q = new URLSearchParams(query);
  switch (a) {
    case "courses":
    case "discover":
      return { page: a };
    case "c":
      return b ? { page: "course", id: b, tab: c } : { page: "courses" };
    case "l":
      return b ? { page: "lesson", id: b, tab: c } : { page: "courses" };
    case "s":
      if (!b) return { page: "courses" };
      return { page: "source", id: b, at: q.has("p") || q.has("t") ? { page: q.has("p") ? Number(q.get("p")) : undefined, t: q.has("t") ? Number(q.get("t")) : undefined } : undefined };
    case "a":
      return b ? { page: "artifact", id: b } : { page: "courses" };
    case "record":
      return b ? { page: "record", courseId: b, lessonId: c } : { page: "today" };
    case "settings":
      return { page: "settings", section: b };
    default:
      return { page: "today" };
  }
}

export const href = {
  today: () => "#/",
  courses: () => "#/courses",
  discover: () => "#/discover",
  course: (id: string, tab?: string) => `#/c/${encodeURIComponent(id)}${tab ? `/${tab}` : ""}`,
  lesson: (id: string, tab?: string) => `#/l/${encodeURIComponent(id)}${tab ? `/${tab}` : ""}`,
  source: (id: string, at?: { page?: number; t?: number }) => `#/s/${encodeURIComponent(id)}${at?.page ? `?p=${at.page}` : at?.t !== undefined ? `?t=${Math.floor(at.t)}` : ""}`,
  artifact: (id: string) => `#/a/${encodeURIComponent(id)}`,
  record: (courseId: string, lessonId?: string) => `#/record/${encodeURIComponent(courseId)}${lessonId ? `/${encodeURIComponent(lessonId)}` : ""}`,
  settings: (section?: string) => `#/settings${section ? `/${section}` : ""}`,
};

export const go = (h: string) => {
  location.hash = h.replace(/^#/, "");
};

// Each in-app step is numbered in its history entry, so a screen knows whether
// the browser's back would stay in amphi.
let depth = 0;
function number(next: number) {
  const state = history.state as { amphiDepth?: number } | null;
  if (typeof state?.amphiDepth === "number") depth = state.amphiDepth;
  else {
    depth = next;
    history.replaceState({ ...state, amphiDepth: depth }, "");
  }
}
if (typeof window !== "undefined") {
  number(0);
  addEventListener("hashchange", () => number(depth + 1));
}

/** Whether going back stays in the app (something was opened from here). */
export const canGoBack = () => depth > 0;

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    (fn) => {
      addEventListener("hashchange", fn);
      return () => removeEventListener("hashchange", fn);
    },
    () => location.hash,
    () => "",
  );
  return parse(hash);
}
