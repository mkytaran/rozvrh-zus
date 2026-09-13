const CACHE_NAME = 'zus-rozvrh-dynamic-cache';

// Základní soubory pro offline instalaci
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './apple-touch-icon.png'
];

// 1. Instalace: přednačte soubory a okamžitě se aktivuje
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// 2. Aktivace: okamžité převzetí kontroly nad všemi otevřenými okny
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 3. Obsluha síťových požadavků
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Požadavky na Google Apps Script API NIKDY nekešujeme přes Service Worker
  if (url.includes('script.google.com') || event.request.method !== 'GET') {
    return;
  }

  // A) Pro HTML stránku: Network-First (při online režimu stáhne vždy čerstvý HTML)
  if (event.request.mode === 'navigate' || url.endsWith('.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return networkResponse;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // B) Pro CSS, JS, ikony: Stale-While-Revalidate
  // Okamžitě vrátí verzi z mezipaměti a na pozadí tiše aktualizuje soubory z GitHubu
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => {
            // V offline režimu ignorujeme chybu sítě
          });

        return cachedResponse || fetchPromise;
      });
    })
  );
});