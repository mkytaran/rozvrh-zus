self.addEventListener('install', (e) => {
    console.log('[Service Worker] Nainstalován');
});

self.addEventListener('fetch', (e) => {
    // Projít testem instalace stačí i prázdný fetch event
});