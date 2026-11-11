// Service worker minimal : met en cache la coquille de l'app pour un chargement
// rapide et une installation sur mobile. Ne met JAMAIS en cache les appels /api/*
// pour que les données du CRM restent toujours a jour.
const CACHE_NAME = "crm-sinai-shell-v51";
const SHELL_FILES = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./app-views.js",
  "./app-tools.js",
  "./manifest.json",
  "./assets/logo-sinai.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Notifications push réelles : ce handler est ce qui permet à une notif de
// s'afficher même quand l'app/l'onglet est complètement fermé — c'est la
// différence fondamentale avec l'ancien rappel local (API Notification +
// setInterval dans app.js), qui ne pouvait fonctionner que pendant que la
// page était ouverte récemment dans le navigateur.
self.addEventListener("push", (event) => {
  let payload = { title: "Tâches à traiter", body: "" };
  try {
    if (event.data) payload = Object.assign(payload, event.data.json());
  } catch {
    try { payload.body = event.data ? event.data.text() : ""; } catch { /* rien d'exploitable */ }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Tâches à traiter", {
      body: payload.body || "",
      icon: "./assets/icon-192.png",
      badge: "./assets/icon-192.png",
      tag: payload.tag || "sinai-crm-tasks-reminder",
      renotify: true,
      data: { url: "./index.html" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "./index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// Fichiers de l'app : le réseau d'abord, le cache seulement en secours (hors
// ligne). Avant, le cache passait en premier : après une mise à jour, un
// appareil pouvait afficher une page récente avec un ancien script (ou
// l'inverse) le temps d'un rechargement.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // toujours reseau, jamais de cache pour les donnees
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error()))
  );
});
