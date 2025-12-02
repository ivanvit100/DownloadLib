'use strict';

if (!window.libParser)
    console.warn('libParser is not loaded. Make sure ./lib/lib_parser.js is included before popup.js in popup.html');

if (!window.ranobelib) 
    console.warn('ranobelib is not loaded. Make sure ./lib/ranobelib.js is included before popup.js in popup.html');

if (!window.mangalib)
    console.warn('mangalib is not loaded. Make sure ./lib/mangalib.js is included before popup.js in popup.html');

const serviceRegistry = [
    {
        key: 'ranobelib',
        match: (host) => /(^|\.)ranobelib\.me$/i.test(host),
        adapter: null
    },
    {
        key: 'mangalib',
        match: (host) => /(^|\.)mangalib\.me$/i.test(host) || /(^|\.)imgslib\.link$/i.test(host),
        adapter: null
    }
];

window._serviceRegistry = window._serviceRegistry || [];
window._serviceRegistry.push(...serviceRegistry);

function detectServiceKeyByHost(hostname) {
    const registry = (window._serviceRegistry || []).slice();
    for (const entry of registry) {
        try {
            const matched = (typeof entry.match === 'function') ? entry.match(hostname) : (typeof entry.match === 'string' ? hostname.includes(entry.match) : false);
            if (matched) return entry.key;
        } catch (e) { /* ignore */ }
    }
    return null;
}

document.getElementById('downloadBtn').addEventListener('click', async () => {
    const btn = document.getElementById('downloadBtn');
    const status = document.getElementById('status');
    const progress = document.getElementById('progress');

    btn.disabled = true;
    progress.style.display = 'block';
    status.textContent = 'Получаем информацию...';

    try {
        if (!window.libParser) throw new Error('Вспомогательная библиотека не загружена');

        const tabs = await window.libParser.queryTabs({ active: true, currentWindow: true });
        const tab = tabs && tabs[0];
        const url = tab?.url || '';

        const slugMatch = url.match(/\/(manga|book)\/([^\/\?]+)/);
        if (!slugMatch) throw new Error('Не удалось определить ID манги из URL');

        const contentType = slugMatch[1];
        const mangaSlug = slugMatch[2];

        let serviceKey = null;
        try {
            const hostname = (new URL(url)).hostname || '';
            serviceKey = detectServiceKeyByHost(hostname);
        } catch (e) {
            serviceKey = null;
        }

        if (!serviceKey) serviceKey = 'ranobelib';

        let service = null;
        if (serviceKey === 'mangalib' && window.mangalib) {
            service = window.mangalib;
        } else if (window.ranobelib) {
            service = window.ranobelib;
        } else {
            throw new Error('No service library loaded');
        }

        await window.libParser.downloadManga(mangaSlug, contentType, status, progress, service);

        status.textContent = 'Готово!';
        btn.disabled = false;
    } catch (error) {
        const esc = (window.libParser && window.libParser.escapeHtml) ? window.libParser.escapeHtml : (t => {
            const d = document.createElement('div'); d.textContent = t; return d.innerHTML;
        });
        status.innerHTML = `<strong>Ошибка:</strong><br>${esc(error && error.message ? error.message : String(error))}`;
        btn.disabled = false;
        progress.style.display = 'none';
    }
});