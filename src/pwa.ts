// The service worker from the page's side: register it, have it fetch the
// rest of the app for offline use, and offer a new version when one is
// waiting (it takes over only when the student reloads, see src/sw.ts).

import { useSyncExternalStore } from "react";
import { scriptURL } from "./trusted.ts";

let waiting: ServiceWorker | null = null;
/** "ready" once the whole app (but the speech and voice runtimes) is cached. */
let offline: "unsupported" | "preparing" | "ready" = "unsupported";
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of listeners) fn();
};
const set = (w: ServiceWorker | null) => {
  waiting = w;
  notify();
};

const useStore = <V>(read: () => V, server: V): V =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => server,
  );

export const useWaitingUpdate = (): boolean => useStore(() => waiting !== null, false);
export const useOfflineReady = () => useStore(() => offline, "unsupported" as typeof offline);

/** Switch to the waiting version and reload once it is in control. */
export function applyUpdate() {
  const w = waiting;
  if (!w) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  w.postMessage("skip-waiting");
}

export const dismissUpdate = () => set(null);

const HOUR = 3_600_000;

export async function registerServiceWorker() {
  offline = "preparing";
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data !== "warmed") return;
    offline = "ready";
    notify();
  });
  const reg = await navigator.serviceWorker.register(scriptURL("./sw.js"), { scope: "./" });
  // Only an update waits: the first install has no controller to replace.
  const offer = (w: ServiceWorker | null) => {
    if (w && navigator.serviceWorker.controller) set(w);
  };
  offer(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const w = reg.installing;
    w?.addEventListener("statechange", () => {
      if (w.state === "installed") offer(w);
    });
  });
  // An installed app on a tablet stays open for days: look for a new version when it comes back to the front.
  let checked = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || Date.now() - checked < HOUR) return;
    checked = Date.now();
    void reg.update().catch(() => {});
  });
  (await navigator.serviceWorker.ready).active?.postMessage("warm");
}
