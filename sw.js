'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function _getPluginFromIDB(format) {
    return new Promise(resolve => {
        const req = indexedDB.open('dl-plugins', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('plugins', { keyPath: 'format' });
        req.onsuccess = e => {
            const db = e.target.result;
            const tx = db.transaction('plugins', 'readonly');
            const get = tx.objectStore('plugins').get(format);
            get.onsuccess = ev => {
                db.close();
                resolve(ev.target.result?.code || null);
            };

            get.onerror  = ()  => {
                db.close();
                resolve(null);
            };
        };
        req.onerror = () => resolve(null);
    });
}

self.addEventListener('fetch', e => {
    const { pathname } = new URL(e.request.url);
    if (!pathname.startsWith('/plugin-runtime/')) return;
    const format = pathname.slice('/plugin-runtime/'.length).replace(/\.js$/, '');
    e.respondWith(
        _getPluginFromIDB(format).then(code =>
            code
                ? new Response(code, { headers: { 'Content-Type': 'text/javascript' } })
                : new Response('// plugin not found', { status: 404, headers: { 'Content-Type': 'text/javascript' } })
        )
    );
});
