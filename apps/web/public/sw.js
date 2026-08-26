/* global self, caches, fetch, Response, URL */

const CACHE_NAME = "codex-remote-shell-v1";
const PRECACHE_URLS = [
  "/offline",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

// network-only: authenticated pages, Supabase, and encrypted remote payloads
const NETWORK_ONLY_PATHS = [
  "/hosts",
  "/login",
  "/pair",
  "/api",
  "/auth/v1",
  "/rest/v1",
  "/realtime/v1",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const networkOnly =
    url.origin !== self.location.origin ||
    NETWORK_ONLY_PATHS.some((path) => url.pathname.startsWith(path));
  if (networkOnly) {
    event.respondWith(
      fetch(request).catch(() =>
        request.mode === "navigate"
          ? caches.match("/offline")
          : Response.error(),
      ),
    );
    return;
  }
  const staticAsset =
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:css|woff2?|png|svg|ico)$/.test(url.pathname);
  if (!staticAsset) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request).then((response) => {
        if (response.ok) {
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      });
      return cached || fresh;
    }),
  );
});
