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

let isDownloading = false;
let isPaused = false;
let shouldStop = false;
let downloadController = null;

window.addEventListener('beforeunload', (e) => {
    if (isDownloading && !shouldStop) {
        e.preventDefault();
        e.returnValue = 'Загрузка не завершена. Вы уверены?';
        return e.returnValue;
    }
});

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

    let formatSelector = document.getElementById('formatSelector');
    if (!formatSelector) {
        const formatContainer = document.createElement('div');
        formatContainer.style.textAlign = 'center';
        formatContainer.style.marginTop = '10px';
        formatContainer.style.marginBottom = '10px';

        formatSelector = document.createElement('select');
        formatSelector.id = 'formatSelector';
        formatSelector.style.padding = '6px 12px';
        formatSelector.style.fontSize = '14px';
        formatSelector.style.marginLeft = '8px';
        formatSelector.style.marginRight = '8px';

        const optionFb2 = document.createElement('option');
        optionFb2.value = 'fb2';
        optionFb2.textContent = 'FB2';

        const optionEpub = document.createElement('option');
        optionEpub.value = 'epub';
        optionEpub.textContent = 'EPUB';

        const optionPdf = document.createElement('option');
        optionPdf.value = 'pdf';
        optionPdf.textContent = 'PDF';

        formatSelector.appendChild(optionFb2);
        formatSelector.appendChild(optionEpub);
        formatSelector.appendChild(optionPdf);

        const label = document.createElement('label');
        label.textContent = 'Формат: ';
        label.style.color = '#bdbdbd';
        label.style.fontSize = '14px';
        label.htmlFor = 'formatSelector';

        formatContainer.appendChild(label);
        formatContainer.appendChild(formatSelector);
        btn.parentNode.insertBefore(formatContainer, btn);
    }

    const FORMAT_STORAGE_KEY = 'manga_parser_selected_format';
    if (formatSelector && localStorage.getItem(FORMAT_STORAGE_KEY))
        formatSelector.value = localStorage.getItem(FORMAT_STORAGE_KEY);
    if (formatSelector)
        formatSelector.addEventListener('change', () => {
            localStorage.setItem(FORMAT_STORAGE_KEY, formatSelector.value);
        });

    let rateLimitInput = document.getElementById('rateLimitInput');
    if (!rateLimitInput) {
        const rateLimitContainer = document.createElement('div');
        rateLimitContainer.style.textAlign = 'center';
        rateLimitContainer.style.marginTop = '10px';
        rateLimitContainer.style.marginBottom = '10px';
        
        const label = document.createElement('label');
        label.textContent = 'Запросов в минуту: ';
        label.style.color = '#bdbdbd';
        label.style.fontSize = '14px';
        
        rateLimitInput = document.createElement('input');
        rateLimitInput.id = 'rateLimitInput';
        rateLimitInput.type = 'number';
        rateLimitInput.min = '2';
        rateLimitInput.max = '200';
        rateLimitInput.step = '1';
        rateLimitInput.value = '100';
        
        rateLimitInput.addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (isNaN(val) || val < 2) val = 2;
            if (val > 200) val = 200;
            e.target.value = Math.floor(val);
        });
        
        rateLimitContainer.appendChild(label);
        rateLimitContainer.appendChild(rateLimitInput);
        btn.parentNode.insertBefore(rateLimitContainer, btn);
    }

    let controlsContainer = document.getElementById('downloadControls');
    if (!controlsContainer) {
        controlsContainer = document.createElement('div');
        controlsContainer.id = 'downloadControls';
        controlsContainer.style.display = 'none';
        controlsContainer.style.textAlign = 'center';
        controlsContainer.style.marginTop = '10px';
        
        const pauseBtn = document.createElement('button');
        pauseBtn.id = 'pauseBtn';
        pauseBtn.textContent = 'Пауза';
        pauseBtn.style.padding = '8px 16px';
        pauseBtn.style.cursor = 'pointer';
        pauseBtn.style.width = 'calc(50% - 8px)';
        pauseBtn.style.transition = 'all 0.3s ease';
        
        const backgroundBtn = document.createElement('button');
        backgroundBtn.id = 'backgroundBtn';
        backgroundBtn.textContent = 'Фоном';
        backgroundBtn.style.padding = '8px 16px';
        backgroundBtn.style.cursor = 'pointer';
        backgroundBtn.style.width = 'calc(50% - 8px)';
        backgroundBtn.style.transition = 'all 0.3s ease';

        if (!document.getElementById('control-buttons-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'control-buttons-styles';
            styleEl.textContent = `
                #pauseBtn, #backgroundBtn {
                    border: 2px solid var(--primary-color) !important;
                    background: #252527 !important;
                }
                #pauseBtn:hover, #backgroundBtn:hover {
                    border: 2px solid var(--secondary-color) !important;
                    background: #252527 !important;
                }
            `;
            document.head.appendChild(styleEl);
        }

        const stopBtn = document.createElement('button');
        stopBtn.id = 'stopBtn';
        stopBtn.textContent = 'Завершить';
        stopBtn.style.marginTop = '12px';
        stopBtn.style.padding = '8px 16px';
        stopBtn.style.cursor = 'pointer';
        stopBtn.style.display = 'block';
        stopBtn.style.width = '100%';
        stopBtn.style.transition = 'all 0.3s ease';
        
        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.justifyContent = 'space-between';
        btnRow.appendChild(pauseBtn);
        btnRow.appendChild(backgroundBtn);
        
        controlsContainer.appendChild(btnRow);
        controlsContainer.appendChild(stopBtn);
        btn.parentNode.insertBefore(controlsContainer, btn.nextSibling);
    }

    if (progress) progress.style.display = 'none';

    (async function loadInfo() {
        const urlParams = new URLSearchParams(window.location.search);
        const autoDownload = urlParams.get('download') === 'true';
        const slugFromUrl = urlParams.get('slug');
        const serviceFromUrl = urlParams.get('service');
        const formatFromUrl = urlParams.get('format');
        if (formatFromUrl && formatSelector) {
            formatSelector.value = formatFromUrl;
            localStorage.setItem(FORMAT_STORAGE_KEY, formatFromUrl);
        }

        btn.disabled = true;
        if (status) status.textContent = 'Получаем информацию...';

        try {
            if (!window.libParser) throw new Error('libParser is not loaded');

            let url, hostname, mangaSlug, serviceKey;

            if (autoDownload && slugFromUrl && serviceFromUrl) {
                mangaSlug = slugFromUrl;
                serviceKey = serviceFromUrl;
                hostname = serviceKey === 'ranobelib' ? 'ranobelib.me' : 'mangalib.me';
            } else {
                const tabs = await (window.libParser.queryTabs ? window.libParser.queryTabs({ active: true, currentWindow: true }) : Promise.resolve([{ url: window.location.href }]));
                const tab = tabs && tabs[0];
                url = tab?.url || window.location.href;

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

                serviceKey = detectServiceKeyByHost(hostname);
            }

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
                const minimalFields = ['rus_name', 'name', 'summary', 'cover', 'authors', 'releaseDate', 'chap_count', 'ageRestriction'];
                const query = minimalFields.map(f => `fields[]=${f}`).join('&');
                const apiUrl = `https://api.cdnlibs.org/api/manga/${mangaSlug}?${query}`;
                
                const headers = {
                    'Accept': '*/*',
                    'Site-Id': serviceKey === 'ranobelib' ? '3' : '1',
                    'Content-Type': 'application/json'
                };
                
                const response = await fetch(apiUrl, { method: 'GET', headers });
                if (response.ok) rawResp = await response.json();
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
            if (status) status.textContent = 'Нажмите "Скачать" для загрузки книги';

            const pauseBtn = document.getElementById('pauseBtn');
            const stopBtn = document.getElementById('stopBtn');
            const backgroundBtn = document.getElementById('backgroundBtn');

            if (pauseBtn) {
                pauseBtn.onclick = () => {
                    isPaused = !isPaused;
                    pauseBtn.textContent = isPaused ? 'Продолжить' : 'Пауза';
                    if (status) status.textContent = isPaused ? 'Пауза...' : 'Загрузка...';
                };
            }

            if (stopBtn) {
                stopBtn.onclick = () => {
                    shouldStop = true;
                    if (status) status.textContent = 'Досрочное завершение...';
                };
            }

            if (backgroundBtn) {
                backgroundBtn.onclick = async () => {
                    try {
                        if (status) status.textContent = 'Переход в фоновый режим...';
                        
                        const downloadId = `download_${Date.now()}`;
                        const rateLimit = parseInt(document.getElementById('rateLimitInput').value) || 80;
                        const format = formatSelector ? formatSelector.value : 'fb2';
                        
                        const msg = {
                            action: 'startBackgroundDownload',
                            downloadId,
                            mangaSlug,
                            serviceKey,
                            rateLimit,
                            format,
                            serviceConfig: {
                                fields: [
                                    'background', 'eng_name', 'otherNames', 'summary', 'releaseDate', 'type_id',
                                    'caution', 'views', 'close_view', 'rate_avg', 'rate', 'genres',
                                    'tags', 'teams', 'user', 'franchise', 'authors', 'publisher',
                                    'userRating', 'moderated', 'metadata', 'metadata.count',
                                    'metadata.close_comments', 'manga_status_id', 'chap_count',
                                    'status_id', 'artists', 'format'
                                ],
                                headers: {
                                    'Accept': '*/*',
                                    'Site-Id': serviceKey === 'ranobelib' ? '3' : '1',
                                    'Content-Type': 'application/json',
                                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0'
                                },
                                referer: serviceKey === 'ranobelib' ? 'https://ranobelib.me/' : 'https://mangalib.me/'
                            }
                        };
                        
                        console.log('[popup] Sending background download request:', msg);
                        
                        const result = await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => reject(new Error('Timeout waiting for response')), 10000);
                            
                            if (typeof chrome !== 'undefined' && chrome.runtime) {
                                chrome.runtime.sendMessage(msg, response => {
                                    clearTimeout(timeout);
                                    if (chrome.runtime.lastError) {
                                        console.error('[popup] Chrome runtime error:', chrome.runtime.lastError);
                                        return reject(chrome.runtime.lastError);
                                    }
                                    console.log('[popup] Received response:', response);
                                    resolve(response);
                                });
                            } else if (typeof browser !== 'undefined' && browser.runtime) {
                                browser.runtime.sendMessage(msg)
                                    .then(response => {
                                        clearTimeout(timeout);
                                        console.log('[popup] Received response:', response);
                                        resolve(response);
                                    })
                                    .catch(err => {
                                        clearTimeout(timeout);
                                        console.error('[popup] Browser runtime error:', err);
                                        reject(err);
                                    });
                            } else {
                                clearTimeout(timeout);
                                reject(new Error('No runtime API available'));
                            }
                        });
                        
                        if (result && result.ok) {
                            if (status) status.textContent = 'Загрузка переведена в фоновый режим';
                            setTimeout(() => window.close(), 1000);
                        } else {
                            throw new Error(result?.error || 'Failed to start background download');
                        }
                    } catch (e) {
                        console.error('[popup] Background download failed:', e);
                        if (status) status.textContent = `Ошибка фона: ${e.message}`;
                    }
                };
            }

            const downloadHandler = async () => {
                if (!autoDownload) {
                    try {
                        const format = formatSelector ? formatSelector.value : 'fb2';
                        chrome.windows.create({
                            url: chrome.runtime.getURL('popup.html') + 
                                 '?download=true&slug=' + encodeURIComponent(mangaSlug) + 
                                 '&service=' + encodeURIComponent(serviceKey) +
                                 '&format=' + encodeURIComponent(format),
                            type: 'popup',
                            width: 420,
                            height: 650,
                            focused: true,
                            state: 'normal'
                        });
                    } catch (e) {
                        console.error('Failed to create window:', e);
                        await performDownload();
                    }
                } else {
                    await performDownload();
                }
            };

            const performDownload = async () => {
                btn.disabled = true;
                btn.style.display = 'none';
                isDownloading = true;
                isPaused = false;
                shouldStop = false;
                if (formatSelector) formatSelector.disabled = true;
                
                const rateLimit = parseInt(document.getElementById('rateLimitInput').value) || 80;
                if (service && typeof service.setRateLimit === 'function') {
                    service.setRateLimit(rateLimit);
                    console.log(`[popup] Rate limit set to ${rateLimit} requests/minute`);
                }
                
                if (progress) progress.style.display = 'block';
                if (controlsContainer) controlsContainer.style.display = 'block';
                if (status) status.textContent = 'Запуск скачивания...';

                const format = formatSelector ? formatSelector.value : 'fb2';
                
                try {
                    downloadController = {
                        isPaused: () => isPaused,
                        shouldStop: () => shouldStop,
                        waitIfPaused: async () => {
                            while (isPaused && !shouldStop) {
                                await new Promise(resolve => setTimeout(resolve, 100));
                            }
                        }
                    };
                    
                    await window.libParser.downloadManga(mangaSlug, null, status, progress, service, downloadController, format);
                    if (status) status.textContent = shouldStop ? 'Загрузка завершена досрочно' : 'Готово!';
                } catch (err) {
                    if (status) status.innerHTML = `<strong>Ошибка:</strong><br>${(window.libParser && window.libParser.escapeHtml) ? window.libParser.escapeHtml(err.message || String(err)) : String(err)}`;
                    console.error(err);
                } finally {
                    isDownloading = false;
                    if (progress) progress.style.display = 'none';
                    if (controlsContainer) controlsContainer.style.display = 'none';
                    btn.style.display = 'block';
                    btn.disabled = false;
                    if (formatSelector) formatSelector.disabled = false;
                }
            };

            btn.onclick = downloadHandler;

            if (autoDownload) setTimeout(() => downloadHandler(), 500);
        } catch (error) {
            if (status) status.innerHTML = `<strong>Ошибка:</strong><br>${error && error.message ? error.message : String(error)}`;
            console.error('Полная ошибка:', error);
            btn.disabled = true;
            if (progress) progress.style.display = 'none';
            if (formatSelector) formatSelector.disabled = false;
        }
    })();
});