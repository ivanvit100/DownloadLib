'use strict';

console.log('[ServiceWorker] Loading scripts...');

try {
    importScripts('/core/BrowserApi.js',
        '/core/RateLimiter.js',
        '/core/EventBus.js',
        '/services/ServiceRegistry.js',
        '/lib/jszip.min.js',
        '/exporters/ExporterRegistry.js',
        '/core/MangaPatcher.js',
        '/background/RequestInterceptor.js',
        '/background/MessageRouter.js');
} catch (e) {
    console.error('[ServiceWorker] Failed to load scripts:', e.message, e.stack);
    throw e;
}

self.addEventListener('install', () => {
    console.log('[ServiceWorker] Installing...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[ServiceWorker] Activating...');
    event.waitUntil(self.clients.claim());
});

const PLUGIN_CACHE = 'dl-plugins-v1';

self.addEventListener('message', async e => {
    if (e.data?.type !== 'CACHE_PLUGIN') return;
    const { format, code } = e.data;
    try {
        const cache = await caches.open(PLUGIN_CACHE);
        await cache.put(
            new Request(`/plugin-runtime/${format}.js`),
            new Response(code, { headers: { 'Content-Type': 'text/javascript' } })
        );
        e.ports[0]?.postMessage({ ok: true });
    } catch (err) {
        console.error('[ServiceWorker] Failed to cache plugin:', err);
        e.ports[0]?.postMessage({ ok: false });
    }
});

self.addEventListener('fetch', e => {
    const { pathname } = new URL(e.request.url);
    if (!pathname.startsWith('/plugin-runtime/')) return;
    e.respondWith(
        caches.open(PLUGIN_CACHE)
            .then(cache => cache.match(e.request))
            .then(resp => resp || new Response('// plugin not found', {
                status: 404,
                headers: { 'Content-Type': 'text/javascript' }
            }))
    );
});

console.log('[ServiceWorker] Ready');
