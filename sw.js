// Service Worker — caches the app shell so the tracker opens instantly
// and works offline (Firestore's own offline cache handles the data).
// Bump CACHE_VERSION whenever you deploy changes to force an update.
const CACHE_VERSION = "ftp-v2";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./meals.json",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) =>
        // Cache each file individually — cache.addAll() is atomic, so a single
        // missing file (e.g. a moved icon) would silently break the entire
        // install and the app would never work offline.
        Promise.allSettled(SHELL.map((url) => cache.add(url))).then((results) => {
          results.forEach((r, i) => {
            if (r.status === "rejected") console.warn("[SW] Failed to cache:", SHELL[i], r.reason);
          });
        })
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never intercept Firebase / Google API / CDN traffic — let the SDK manage it
  if (url.origin !== location.origin) return;
  if (e.request.method !== "GET") return;

  // Network-first for the shell so deploys show up quickly,
  // falling back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(e.request, { ignoreSearch: true });
        if (cached) return cached;
        // Offline navigation fallback: serve the app shell for page loads
        if (e.request.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
