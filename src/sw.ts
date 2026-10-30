/// <reference lib="webworker" />
// Offline support. The build replaces __MANIFEST__ with the hashed list of
// files: the app shell is cached at install; the rest of the app's own code
// (`warm`) right after, once the page asks; ONNX Runtime and the workers the
// first time they are used. Speech and voice models are not handled here:
// llm-connect and transformers.js keep them in their own caches.

const sw = self as unknown as ServiceWorkerGlobalScope;
declare const __MANIFEST__: { version: string; precache: string[]; lazy: string[]; warm: string[] };

const { version, precache, lazy, warm } = __MANIFEST__;
const CACHE = `amphi-${version}`;
const scope = new URL(sw.registration.scope);
const abs = (p: string) => new URL(p, scope).href;
const lazySet = new Set(lazy.map(abs));

sw.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(precache.map(abs)))
      // The first install takes over at once; an update waits until the
      // student chooses to reload (the page offers it), so a screen never
      // changes under them mid-task.
      .then(() => (sw.registration.active ? undefined : sw.skipWaiting())),
  );
});

/** Fetches what the app may load later, so it opens offline; what is cached already is skipped. */
async function warmUp(): Promise<boolean> {
  const cache = await caches.open(CACHE);
  for (const url of warm.map(abs)) {
    if (await cache.match(url)) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      await cache.put(url, res);
    } catch {
      return false; // offline again: the next visit finishes it
    }
  }
  return true;
}

sw.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (event.data === "skip-waiting") void sw.skipWaiting();
  // The page learns when everything it may need is on the device.
  else if (event.data === "warm") event.waitUntil(warmUp().then((done) => (done ? event.source?.postMessage("warmed") : undefined)));
});

// The previous version's files stay cached: a tab still open on it keeps
// finding its own code (hashed names the new deploy no longer has) until it
// reloads. Older versions are deleted.
const META = "amphi-meta";
const KEEP_VERSIONS = 2;

sw.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const meta = await caches.open(META);
      const res = await meta.match(abs("./__versions"));
      const versions = ((res ? await res.json() : []) as string[]).filter((v) => v !== CACHE);
      versions.push(CACHE);
      const keep = new Set([...versions.slice(-KEEP_VERSIONS), META]);
      await meta.put(abs("./__versions"), new Response(JSON.stringify(versions.slice(-KEEP_VERSIONS))));
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("amphi-") && !keep.has(k)).map((k) => caches.delete(k)));
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event: FetchEvent) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // Navigations always get the app shell: routing lives in the hash.
  const key = req.mode === "navigate" ? abs("./") : url.origin + url.pathname;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // This version first, then the previous one (for tabs still running it).
      const hit = (await cache.match(key)) ?? (req.mode === "navigate" ? undefined : await caches.match(key));
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && (lazySet.has(key) || key === abs("./"))) await cache.put(key, res.clone());
      return res;
    })(),
  );
});
