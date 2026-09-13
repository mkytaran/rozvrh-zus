const CACHE_NAME = 'zus-rozvrh-dynamic-cache';

// Základní kostra pro první offline instalaci
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './apple-touch-icon.png'
];

// 1. Instalace - přednačte základní soubory a okamžitě se aktivuje
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting(); // Vynutí okamžité převzetí bez čekání na zavření záložek
});

// 2. Aktivace - převezme kontrolu nad všemi klienty
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 3. Obsluha síťových požadavků
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Požadavky na Google Apps Script (API) NIKDY nekešujeme přes SW
  if (url.includes('script.google.com') || event.request.method !== 'GET') {
    return;
  }

  // A) Pro HTML stránku: Network-First (s rychlým timeoutem, fallback do keše)
  // Zajišťuje, že při dostupném internetu máš vždy čerstvou verzi aplikace
  if (event.request.mode === 'navigate' || url.endsWith('.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Uložíme čerstvý HTML do keše
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return networkResponse;
        })
        .catch(() => caches.match('./index.html')) // Pokud jsme offline, vrátíme uloženou verzi
    );
    return;
  }

  // B) Pro CSS, JS, ikony: Stale-While-Revalidate
  // Okamžitě vrátí verzi z keše (aplikace naběhne za 50ms) a na pozadí stáhne update z GitHubu
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        // Požadavek na síť pro tichou aktualizaci keše na pozadí
        const fetchPromise = fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => {
            // Offline - nevadí, použije se mezipaměť
          });

        // Pokud máme soubor v keši, vrátíme ho hned; jinak počkáme na síť
        return cachedResponse || fetchPromise;
      });
    })
  );
});