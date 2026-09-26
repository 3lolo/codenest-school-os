// Hero Tech Academy — dashboard service worker.
//
// Registered only from app.js, and only once someone is actually signed in
// (see registerDashboardServiceWorker() in src/app.js) — a visitor who only
// ever sees the public marketing/login screens never gets one, so this
// site never becomes "installable" for them. That's deliberate: the PWA
// install prompt is a dashboard feature for staff and students, not
// something we want to push on marketing traffic.
//
// Scope is intentionally narrow: this only makes the app shell (the static
// HTML/CSS/JS/icons) load instantly and work if the network briefly drops
// mid-session. It never touches Supabase (auth/rest/storage) or the /api/*
// serverless functions — those are always live network requests, so
// grades, attendance, chat, and every other real record always come from
// the server, never a stale cache. Bump CACHE_NAME when the shell's own
// files change shape in a way that needs a clean slate for returning
// installed users.

const CACHE_NAME = "hta-shell-v1";

const SHELL_URLS = [
  "/",
  "/manifest.json",
  "/src/styles.css",
  "/src/app.js",
  "/src/security.js",
  "/src/i18n.js",
  "/src/supabaseAuth.js",
  "/src/assets/logo-icon.png",
  "/src/assets/pwa-icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever intercept same-origin GETs for the app shell. Everything
  // else — Supabase (a different origin), the /api/* POST endpoints, any
  // other cross-origin asset — goes straight to the network untouched, so
  // this worker can never serve stale account data or break a write.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A full page load/reload: prefer a fresh copy so a signed-in user
  // always gets the latest app.js, falling back to the cached shell only
  // when the network is actually unavailable.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/", { ignoreSearch: true })),
    );
    return;
  }

  // Static shell assets: serve the cached copy immediately if there is
  // one (instant load, works offline), and refresh it from the network in
  // the background so the next load picks up any change.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
