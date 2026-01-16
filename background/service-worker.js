'use strict';

console.log('[ServiceWorker] Loading scripts...');

try {
    importScripts('/core/RateLimiter.js',
        '/core/EventBus.js',
        '/services/mangalib/config.js',
        '/services/ranobelib/config.js',
        '/services/BaseService.js',
        '/services/mangalib/MangaLibService.js',
        '/services/ranobelib/RanobeLibService.js',
        '/core/ServiceRegistry.js',
        '/exporters/BaseExporter.js',
        '/exporters/FB2Exporter.js',
        '/exporters/EPUBExporter.js',
        '/exporters/ExporterFactory.js',
        '/lib/jszip.min.js',
        '/background/BackgroundDownload.js',
        '/background/Background.js');
} catch (e) {
    console.error('[ServiceWorker] Failed to load scripts:', e.message, e.stack);
    throw e;
}

self.addEventListener('install', (event) => {
    console.log('[ServiceWorker] Installing...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[ServiceWorker] Activating...');
    event.waitUntil(self.clients.claim());
});

console.log('[ServiceWorker] Ready');