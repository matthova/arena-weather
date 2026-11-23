/* Weather alerts service worker: offline shell + web push. Plain JS, no build step. */
const CACHE = "weather-alerts-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first for navigations (fall back to the cached shell when offline); never touch /api.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/").then((r) => r || Response.error())));
    return;
  }
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});

// Push payloads are the API's PushMessage: { title, body, url?, tag?, data? }
self.addEventListener("push", (event) => {
  let payload = { title: "Weather alert", body: "" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }
  const options = {
    body: payload.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    data: { url: payload.url || "/", ...(payload.data || {}) },
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// Clicking a notification focuses an open app window (navigating it) or opens a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === target.origin && "focus" in client) {
          if ("navigate" in client) client.navigate(target.href).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

// Browsers rotate subscriptions occasionally; the app re-registers on its next visit
// (see src/routes/notifications.tsx), so here we only log.
self.addEventListener("pushsubscriptionchange", () => {
  console.log("push subscription changed; re-register from the app");
});
