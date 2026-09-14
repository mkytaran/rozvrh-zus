const CACHE_NAME = 'zus-app-cache';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './apple-touch-icon.png'
];

// 1. Instalace - přednačte soubory přímo ze sítě bez použití HTTP mezipaměti
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        PRECACHE_ASSETS.map((url) => {
          return fetch(url, { cache: 'no-cache' }).then((response) => {
            if (response.ok) return cache.put(url, response);
          }).catch(() => {});
        })
      );
    })
  );
});

// 2. Aktivace - převezme okamžitě kontrolu nad všemi klienty
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => {
        return Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      }),
      self.clients.claim()
    ])
  );
});

// 3. Síťové dotazy - Network-First pro zdrojové soubory aplikace
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Google Apps Script API NIKDY nekešujeme
  if (url.includes('script.google.com') || event.request.method !== 'GET') {
    return;
  }

  // Pro všechny interní soubory aplikace (HTML, CSS, JS, manifest):
  // Zkusíme nejdřív SÍŤ (čerstvý kód z GitHubu bez diskové keše).
  // Pokud síť selže (offline), vrátíme verzi z Cache Storage.
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') return caches.match('./index.html');
        });
      })
  );
});