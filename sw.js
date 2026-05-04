// sw.js — Service Worker for AR Safety PWA
// Provides offline capability by caching all static assets

const CACHE_NAME = 'ar-safety-v2';

const PRECACHE_URLS = [
  './index.html',
  './manager.html',
  './worker.html',
  './css/style.css',
  './js/camera.js',
  './js/compass.js',
  './js/gps.js',
  './js/db.js',
  './js/manager.js',
  './js/worker.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ── Install: pre-cache all static assets ─────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[SW] Pre-cache failed (ok on first load):', err);
        return self.skipWaiting();
      })
  );
});

// ── Activate: clean up old caches ────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch strategy ───────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1) Always bypass: Firebase, Google APIs, Chrome extensions
  if (
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.protocol === 'chrome-extension:'
  ) {
    return; // let browser handle it natively
  }

  // 2) HTML navigation → Network-first (avoids ERR_FAILED on empty cache)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // 3) All other assets → Cache-first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback
      if (event.request.destination === 'document') {
        return caches.match('./index.html');
      }
    })
  );
});
