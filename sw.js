'use strict';

/**
 * Обработчик события 'install': пропускает ожидание и активирует новую версию
 * service worker'а немедленно.
 * @returns {void}
 */
self.addEventListener('install', () => self.skipWaiting());

/**
 * Обработчик события 'activate': сразу берёт под контроль все открытые страницы.
 * @param {ExtendableEvent} e - Событие активации service worker'а.
 * @returns {void}
 */
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

/**
 * Читает ранее сохранённый код плагина из IndexedDB по ключу формата.
 * @param {string} format - Ключ формата плагина.
 * @returns {Promise<?string>} Исходный код плагина, либо null, если он не найден
 * или произошла ошибка чтения.
 */
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

/**
 * Обработчик события 'fetch': перехватывает запросы к виртуальному пути
 * /plugin-runtime/*, отдавая закэшированный в IndexedDB код плагина
 * или заглушку 404, если плагин с таким именем не был сохранён.
 * @param {FetchEvent} e - Событие сетевого запроса.
 * @returns {void}
 */
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
