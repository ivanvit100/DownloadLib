'use strict';

if (!window.libParser)
    console.warn('libParser is not loaded. Make sure ./lib/lib_parser.js is included before popup.js in popup.html');

if (!window.ranobelib)
    console.warn('ranobelib is not loaded. Make sure ./lib/ranobelib.js is included before popup.js in popup.html');

if (!window.mangalib)
    console.warn('mangalib is not loaded. Make sure ./lib/mangalib.js is included before popup.js in popup.html');

const serviceRegistry = [
    { key: 'ranobelib', match: (host) => /(^|\.)ranobelib\.me$/i.test(host) },
    { key: 'mangalib', match: (host) => /(^|\.)mangalib\.me$/i.test(host) || /(^|\.)imgslib\.link$/i.test(host) }
];

window._serviceRegistry = window._serviceRegistry || [];
window._serviceRegistry.push(...serviceRegistry);

function detectServiceKeyByHost(hostname) {
    if (!hostname) return null;
    hostname = String(hostname).toLowerCase();
    for (const entry of (window._serviceRegistry || [])) {
        try {
            if (typeof entry.match === 'function' && entry.match(hostname)) return entry.key;
            if (typeof entry.match === 'string' && hostname.includes(entry.match)) return entry.key;
        } catch (e) { /* ignore */ }
    }
    return null;
}

function safeText(v) { return v == null ? null : String(v).trim() || null; }

function pickMetaFromRaw(rawResp) {
    if (!rawResp) return null;
    if (rawResp.data && typeof rawResp.data === 'object') return rawResp.data;
    if (typeof rawResp === 'object') return rawResp;
    return null;
}

function countFromChaptersResponse(resp) {
    if (!resp) return null;
    const cand = resp.data ? resp.data : (Array.isArray(resp) ? resp : resp);
    if (Array.isArray(cand)) return cand.length;
    if (cand && typeof cand === 'object') {
        try {
            const keys = Object.keys(cand).filter(k => !isNaN(parseInt(k)));
            if (keys.length) return keys.length;
            return Object.keys(cand).length || null;
        } catch (e) { return null; }
    }
    return null;
}

function truncateText(text, maxLength = 128) {
    if (!text) return text;
    const str = String(text).trim();
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '...';
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('downloadBtn');
    const status = document.getElementById('status');
    const progress = document.getElementById('progress');
    const siteLogo = document.getElementById('siteLogo');
    const logoInfo = document.getElementById('logoInfo');
    const coverImg = document.getElementById('cover');
    const desc = document.getElementById('description');

    if (!btn) { console.error('downloadBtn not found in DOM'); return; }

    let releaseEl = document.getElementById('releaseDate');
    if (!releaseEl) {
        releaseEl = document.createElement('div');
        releaseEl.id = 'releaseDate';
        releaseEl.style.textAlign = 'center';
        releaseEl.style.color = '#bdbdbd';
        releaseEl.style.fontSize = '12px';
        releaseEl.style.marginTop = '8px';
        releaseEl.style.marginBottom = '8px';
        btn.parentNode.insertBefore(releaseEl, btn);
    }

    if (progress) progress.style.display = 'none';

    (async function loadInfo() {
        btn.disabled = true;
        if (status) status.textContent = 'Получаем информацию...';

        try {
            if (!window.libParser) throw new Error('libParser is not loaded');

            const tabs = await (window.libParser.queryTabs ? window.libParser.queryTabs({ active: true, currentWindow: true }) : Promise.resolve([{ url: window.location.href }]));
            const tab = tabs && tabs[0];
            const url = tab?.url || window.location.href;

            let hostname = '';
            let mangaSlug = null;
            try {
                const u = new URL(url);
                hostname = u.hostname || '';
                const parts = u.pathname.split('/').filter(Boolean);
                const idx = parts.findIndex(p => p === 'manga' || p === 'book');
                if (idx >= 0 && parts.length > idx + 1) {
                    mangaSlug = parts[idx + 1];
                } else {
                    const m = url.match(/\/(manga|book)\/([^\/\?]+)/);
                    if (m) mangaSlug = m[2];
                }
            } catch (e) { console.warn('[popup] failed parse url:', e); }

            const serviceKey = detectServiceKeyByHost(hostname);

            try {
                if (serviceKey === 'ranobelib') {
                    document.body.style.setProperty('--primary-color', '#2196f3');
                    document.body.style.setProperty('--secondary-color', '#1f82d3ff');
                    if (siteLogo) siteLogo.src = 'icons/logo3.png';
                } else {
                    document.body.style.setProperty('--primary-color', '#ff9100');
                    document.body.style.setProperty('--secondary-color', '#c77101');
                    if (siteLogo) siteLogo.src = 'icons/logo1.png';
                }
            } catch (e) { /* ignore */ }

            if (!serviceKey) {
                logoInfo.textContent = '';
                if (coverImg) coverImg.style.display = 'none';
                if (desc) desc.textContent = 'Сперва откройте один из сайтов проекта MangaLib';
                releaseEl.textContent = '';
                btn.disabled = true;
                return;
            }

            if (!mangaSlug) {
                logoInfo.textContent = '';
                if (coverImg) coverImg.style.display = 'none';
                if (desc) desc.textContent = 'Сперва откройте соответствующий тайтл';
                releaseEl.textContent = '';
                btn.disabled = true;
                return;
            }

            let service = null;
            if (serviceKey === 'mangalib' && window.mangalib) service = window.mangalib;
            else if (serviceKey === 'ranobelib' && window.ranobelib) service = window.ranobelib;
            else if (window.ranobelib) service = window.ranobelib;

            if (!service) {
                desc.textContent = 'Сервис не загружен в окружении.';
                btn.disabled = true;
                return;
            }

            let rawResp = null;
            try {
                if (typeof service.fetchMangaMetadata === 'function') {
                    rawResp = await service.fetchMangaMetadata(mangaSlug);
                }
            } catch (e) {
                if (e && e.message) desc.textContent = `Не удалось получить данные: ${e.message}`;
            }

            if (!rawResp && typeof service.fetchManga === 'function') {
                try {
                    rawResp = await service.fetchManga(mangaSlug);
                } catch (e) { console.warn('[popup] fetchManga failed:', e); }
            }

            const meta = pickMetaFromRaw(rawResp);

            let chaptersCount = meta && (meta.items_count?.uploaded || meta.items_count?.total || meta.chap_count || meta.chapters_count || meta.count || null);
            if ((chaptersCount === null || typeof chaptersCount === 'undefined') && typeof service.fetchChaptersList === 'function') {
                try {
                    const chResp = await service.fetchChaptersList(mangaSlug);
                    const derived = countFromChaptersResponse(chResp);
                    if (derived !== null) chaptersCount = derived;
                } catch (e) { console.warn('[popup] fetchChaptersList failed:', e); }
            }

            const title = safeText((meta && (meta.rus_name || meta.name)) || mangaSlug) || mangaSlug;
            const fullSummary = safeText((meta && (meta.summary || meta.description)) || null) || 'Описание отсутствует.';
            const summary = truncateText(fullSummary, 100);
            
            let cover = null;
            if (meta && meta.cover) {
                if (typeof meta.cover === 'string') cover = meta.cover;
                else if (meta.cover.default) cover = meta.cover.default;
                else if (meta.cover.thumbnail) cover = meta.cover.thumbnail;
                else if (meta.cover.md) cover = meta.cover.md;
                else if (meta.cover.url) cover = meta.cover.url;
            } else if (meta && meta.image) cover = meta.image;

            const authors = (meta && meta.authors && Array.isArray(meta.authors)) ? meta.authors.map(a => {
                if (!a) return null;
                if (typeof a === 'string') return a;
                return a.name || a.rus_name || a.title || null;
            }).filter(Boolean) : null;

            const release = safeText(meta && (meta.releaseDate || meta.releaseDateString || meta.release_date || meta.published || meta.year || meta.date)) || '';
            const pagesCount = meta && (meta.pages || meta.pages_count || meta.page_count) || null;
            
            let rating = null;
            if (meta) {
                if (meta.ageRestriction && meta.ageRestriction.label)
                    rating = String(meta.ageRestriction.label);
                if (!rating && (meta.adult === true || String(meta.adult) === '1')) rating = '18+';
            }

            const firstLineParts = [];
            if (chaptersCount !== null) firstLineParts.push('Глав: ' + chaptersCount);
            if (rating) firstLineParts.push('Рейтинг: ' + rating);

            const secondLine = (authors && authors.length) ? ('Авторы: ' + authors.join(', ')) : '';

            let logoText = '';
            if (firstLineParts.length) logoText += firstLineParts.join(' · ');
            if (secondLine) logoText += (logoText ? '\n' : '') + secondLine;
            logoInfo.textContent = logoText;

            if (cover) {
                coverImg.style.display = 'block';
                coverImg.src = cover;
                coverImg.setAttribute('style', 'display:block; float:left; width:80px; height:auto; margin-right:10px;');
            } else {
                coverImg.style.display = 'none';
            }

            desc.innerHTML = `<strong>${title}</strong><br><small>${summary}</small>`;
            releaseEl.textContent = release ? ('Дата выхода: ' + release) : '';

            if (pagesCount !== null)
                logoInfo.textContent += (logoInfo.textContent ? ' · ' : '') + 'Страниц: ' + pagesCount;

            btn.disabled = false;
            if (status) status.textContent = 'Нажмите "Скачать" для загрузки в fb2';

            btn.onclick = async () => {
                btn.disabled = true;
                if (progress) progress.style.display = 'block';
                if (status) status.textContent = 'Запуск скачивания...';
                try {
                    await window.libParser.downloadManga(mangaSlug, null, status, progress, service);
                    if (status) status.textContent = 'Готово!';
                } catch (err) {
                    if (status) status.innerHTML = `<strong>Ошибка:</strong><br>${(window.libParser && window.libParser.escapeHtml) ? window.libParser.escapeHtml(err.message || String(err)) : String(err)}`;
                    console.error(err);
                } finally {
                    btn.disabled = false;
                    if (progress) progress.style.display = 'none';
                }
            };

        } catch (error) {
            if (status) status.innerHTML = `<strong>Ошибка:</strong><br>${error && error.message ? error.message : String(error)}`;
            console.error('Полная ошибка:', error);
            btn.disabled = true;
            if (progress) progress.style.display = 'none';
        }
    })();
});