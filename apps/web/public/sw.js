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

self.addEventListener("push", (event) => {
  const notification = readPushNotification(event.data);
  if (!notification) return;
  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: `${notification.kind}:${notification.data.eventId}`,
      data: notification.data,
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  if (!isNotificationData(data)) return;
  const target = `/hosts?hostId=${encodeURIComponent(data.hostId)}&eventId=${encodeURIComponent(data.eventId)}`;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((client) => "focus" in client);
        if (existing) {
          void existing.navigate(target);
          return existing.focus();
        }
        return self.clients.openWindow(target);
      }),
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
          void caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, response.clone()));
        }
        return response;
      });
      return cached || fresh;
    }),
  );
});

function readPushNotification(data) {
  if (!data) return null;
  try {
    const value = data.json();
    if (
      !value ||
      !["approval", "completed", "failed"].includes(value.kind) ||
      typeof value.title !== "string" ||
      typeof value.body !== "string" ||
      value.title.length > 80 ||
      value.body.length > 160 ||
      !isNotificationData(value.data)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function isNotificationData(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.hostId === "string" &&
    value.hostId.length <= 100 &&
    typeof value.eventId === "string" &&
    value.eventId.length <= 200
  );
}
