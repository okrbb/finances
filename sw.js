const APP_VERSION = 'v12';
const STATIC_CACHE = `danova-evidencia-static-${APP_VERSION}`;
const DYNAMIC_CACHE = `danova-evidencia-dynamic-${APP_VERSION}`;
const OFFLINE_FALLBACK_URL = './index.html';
const MAX_DYNAMIC_CACHE_ITEMS = 120;

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/styles.css',
    './css/favicon.ico',
    './css/icon-192.png',
    './css/icon-512.png',
    './js/app.js',
    './js/config.js',
    './js/utils.js',
    './js/notifications.js',
    './js/yearManager.js',
    './js/audit.js',
    './js/importRules.js',
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

function isHttpRequest(requestUrl) {
    return requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:';
}

function isSameOriginRequest(requestUrl) {
    return requestUrl.origin === self.location.origin;
}

function isFirebaseApiRequest(requestUrl) {
    return requestUrl.hostname === 'firestore.googleapis.com' || requestUrl.hostname === 'identitytoolkit.googleapis.com';
}

async function trimDynamicCache(maxItems = MAX_DYNAMIC_CACHE_ITEMS) {
    const cache = await caches.open(DYNAMIC_CACHE);
    const keys = await cache.keys();

    if (keys.length <= maxItems) {
        return;
    }

    const excessItems = keys.length - maxItems;
    for (let i = 0; i < excessItems; i += 1) {
        await cache.delete(keys[i]);
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
                            return caches.delete(cacheName);
                        }
                        return Promise.resolve();
                    })
                );
            }),
            self.clients.claim()
        ])
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const requestUrl = new URL(request.url);

    if (!isHttpRequest(requestUrl)) {
        return;
    }

    // Firebase API nechavame vzdy na siet bez cache, aby app logika mala jednu online/offline frontu.
    if (isFirebaseApiRequest(requestUrl)) {
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response && response.ok) {
                        const responseClone = response.clone();
                        caches.open(DYNAMIC_CACHE).then((cache) => {
                            cache.put(request, responseClone).then(() => trimDynamicCache());
                        });
                    }
                    return response;
                })
                .catch(async () => {
                    const cachedNavigation = await caches.match(request);
                    if (cachedNavigation) {
                        return cachedNavigation;
                    }

                    const offlineFallback = await caches.match(OFFLINE_FALLBACK_URL);
                    if (offlineFallback) {
                        return offlineFallback;
                    }

                    return new Response('Offline', {
                        status: 503,
                        statusText: 'Offline'
                    });
                })
        );
        return;
    }

    if (request.method !== 'GET') {
        return;
    }

    const isSameOrigin = isSameOriginRequest(requestUrl);
    const isStaticAsset = isSameOrigin && ASSETS_TO_CACHE.some((asset) => requestUrl.pathname.endsWith(asset.replace('./', '/')) || requestUrl.pathname === '/');

    if (isStaticAsset) {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                if (cachedResponse) {
                    return cachedResponse;
                }

                return fetch(request).then((networkResponse) => {
                    if (networkResponse && networkResponse.ok) {
                        caches.open(STATIC_CACHE).then((cache) => {
                            cache.put(request, networkResponse.clone());
                        });
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    event.respondWith(
        fetch(request)
            .then(async (networkResponse) => {
                const canCacheResponse =
                    networkResponse &&
                    networkResponse.ok &&
                    isSameOrigin &&
                    networkResponse.type === 'basic';

                if (canCacheResponse) {
                    const cache = await caches.open(DYNAMIC_CACHE);
                    await cache.put(request, networkResponse.clone());
                    await trimDynamicCache();
                }

                return networkResponse;
            })
            .catch(async () => {
                const cachedResponse = await caches.match(request);
                if (cachedResponse) {
                    return cachedResponse;
                }

                return new Response('Offline resource not available.', {
                    status: 503,
                    statusText: 'Offline'
                });
            })
    );
});