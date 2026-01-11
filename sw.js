const CACHE_NAME = 'danova-evidencia-v5';

// Zoznam súborov na statické cachovanie
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/styles.css',
    './css/DE.png',
    './css/favicon.ico',
    './css/icon-192.png',
    './css/icon-512.png',
    './js/app.js',
    './js/config.js',
    './js/utils.js',
    './js/notifications.js',
    './js/yearManager.js',
    './js/views/dashboard.js',
    './js/views/budget.js',
    './js/views/transactions.js',
    './js/views/reports.js',
    './js/views/settings.js',
    './js/views/import.js',
    './js/views/salaryImport.js',
    './js/views/yearClosure.js',
    './manifest.json'
];

// 1. Inštalácia - uložíme základné súbory do cache
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('SW: Cachovanie statických assetov');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    // Vynúti prechod zo stavu "waiting" do "active"
    self.skipWaiting();
});

// 2. Aktivácia - vyčistenie starých cache a okamžité prevzatie kontroly
self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            // Odstránenie starých verzií cache
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cache) => {
                        if (cache !== CACHE_NAME) {
                            return caches.delete(cache);
                        }
                    })
                );
            }),
            // Kľúčové pre tvoj problém: SW začne ovládať stránku hneď, nie až po refreshi
            self.clients.claim()
        ])
    );
});

// 3. Fetch stratégia - Cache First, potom Network
self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('firestore.googleapis.com') || 
        event.request.url.includes('identitytoolkit.googleapis.com')) {
        return;
    }

    event.respondWith(
        // ZMENA: Skúsime najprv sieť, ak zlyhá (offline), použijeme cache
        fetch(event.request)
            .then((networkResponse) => {
                return caches.open(CACHE_NAME).then((cache) => {
                    // Uložíme čerstvú kópiu do cache pre nabudúce
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            })
            .catch(() => {
                // Ak sme offline, skúsime nájsť v cache
                return caches.match(event.request);
            })
    );
});