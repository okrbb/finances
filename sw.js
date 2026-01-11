const CACHE_NAME = 'danova-evidencia-v6';

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
    // NEPOUŽÍVAME skipWaiting() automaticky - počkáme na potvrdenie od používateľa
});

// Počúvanie správy od klienta na okamžitú aktiváciu
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
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
    // Vynechať Firebase API volania
    if (event.request.url.includes('firestore.googleapis.com') || 
        event.request.url.includes('identitytoolkit.googleapis.com')) {
        return;
    }
    
    // Vynechať neštandardné URL schémy (chrome-extension, etc.)
    const url = new URL(event.request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return;
    }

    event.respondWith(
        // ZMENA: Skúsime najprv sieť, ak zlyhá (offline), použijeme cache
        fetch(event.request)
            .then((networkResponse) => {
                // Cachovať len GET requesty s OK status
                if (event.request.method === 'GET' && networkResponse.status === 200) {
                    return caches.open(CACHE_NAME).then((cache) => {
                        // Uložíme čerstvú kópiu do cache pre nabudúce
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // Ak sme offline, skúsime nájsť v cache
                return caches.match(event.request);
            })
    );
});