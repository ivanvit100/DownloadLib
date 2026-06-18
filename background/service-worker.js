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
        '/background/Background.js');
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

console.log('[ServiceWorker] Ready');
