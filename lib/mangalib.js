'use strict';

/* ==========================
   MangaLib adapter
   Парсит JSON API аналогично ranobelib.js
   ========================== */

(function (global) {
    const mangalib = {};

    let _imageServers = null;
    let _mangaIdCache = null;
    const _resolvedCache = new Map();

    const IMAGE_DOMAIN = 'https://img3.mixlib.me';

    function _curlLikeHeaders(extra = {}) {
        return Object.assign({
            'Accept': '*/*',
            'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
            'Site-Id': '1',
            'Content-Type': 'application/json',
            'Client-Time-Zone': 'Europe/Moscow',
            'Referer': 'https://mangalib.me/',
            'Origin': 'https://mangalib.me',
            'Sec-GPC': '1'
        }, extra);
    }

    mangalib.fetchMangaMetadata = async function (mangaSlug, opts = {}) {
        if (!mangaSlug) throw new Error('mangaSlug required');
        const fields = [
            'background', 'eng_name', 'otherNames', 'summary', 'releaseDate', 'type_id',
            'caution', 'views', 'close_view', 'rate_avg', 'rate', 'genres',
            'tags', 'teams', 'user', 'franchise', 'authors', 'publisher',
            'userRating', 'moderated', 'metadata', 'metadata.count',
            'metadata.close_comments', 'manga_status_id', 'chap_count',
            'status_id', 'artists', 'format'
        ];
        const query = fields.map(f => `fields[]=${f}`).join('&');
        const url = `https://api.cdnlibs.org/api/manga/${mangaSlug}?${query}`;
        const headers = _curlLikeHeaders();

        const resp = await fetch(url, {
            method: 'GET',
            headers,
            mode: 'cors',
            credentials: 'include',
            cache: 'no-store'
        });

        const text = await resp.text().catch(() => '');
        if (!resp.ok) {
            const err = new Error(`Ошибка загрузки: ${resp.status}. Ответ: ${text?.substring(0, 300) || ''}`);
            err.status = resp.status;
            throw err;
        }
        const result = text ? JSON.parse(text) : null;
        if (result && result.data && result.data.id) _mangaIdCache = result.data.id;
        return result;
    };

    mangalib.fetchChaptersList = async function (mangaSlug, opts = {}) {
        if (!mangaSlug) throw new Error('mangaSlug required');
        const url = `https://api.cdnlibs.org/api/manga/${mangaSlug}/chapters`;
        const headers = _curlLikeHeaders();

        const resp = await fetch(url, {
            method: 'GET',
            headers,
            mode: 'cors',
            credentials: 'include',
            cache: 'no-store'
        });

        const text = await resp.text().catch(() => '');
        if (!resp.ok) {
            const err = new Error(`Ошибка загрузки глав: ${resp.status}`);
            err.status = resp.status;
            throw err;
        }
        return text ? JSON.parse(text) : null;
    };

    mangalib.fetchChapter = async function (mangaSlug, number, volume = '1', opts = {}) {
        if (!mangaSlug) throw new Error('mangaSlug required');
        const params = new URLSearchParams();
        if (number !== undefined && number !== null) params.set('number', String(number));
        if (volume !== undefined && volume !== null) params.set('volume', String(volume));
        const url = `https://api.cdnlibs.org/api/manga/${mangaSlug}/chapter?${params.toString()}`;
        const headers = _curlLikeHeaders();

        const resp = await fetch(url, {
            method: 'GET',
            headers,
            mode: 'cors',
            credentials: 'include',
            cache: 'no-store'
        });

        const text = await resp.text().catch(() => '');
        if (!resp.ok) {
            const err = new Error(`Ошибка загрузки главы ${number}: ${resp.status}`);
            err.status = resp.status;
            throw err;
        }
        return text ? JSON.parse(text) : null;
    };

    mangalib.fetchImageServers = async function () {
        if (_imageServers) return _imageServers;
        try {
            const url = 'https://api.cdnlibs.org/api/constants?fields[]=imageServers';
            const headers = _curlLikeHeaders();
            const resp = await fetch(url, {
                method: 'GET',
                headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });
            if (!resp.ok) return [];
            const json = await resp.json().catch(() => null);
            _imageServers = (json && json.data && json.data.imageServers) ? json.data.imageServers : [];
            return _imageServers;
        } catch (e) {
            console.warn('fetchImageServers failed', e);
            return [];
        }
    };

    mangalib.extractPages = function (chapterData) {
        if (!chapterData) return [];
        if (Array.isArray(chapterData.pages) && chapterData.pages.length) return chapterData.pages.slice();
        if (Array.isArray(chapterData.images) && chapterData.images.length) return chapterData.images.slice();
        if (Array.isArray(chapterData.pages_list) && chapterData.pages_list.length) return chapterData.pages_list.slice();
        if (Array.isArray(chapterData.content) && chapterData.content.length && typeof chapterData.content[0] === 'string') return chapterData.content.slice();
        return [];
    };

    mangalib.resolvePageUrl = function (filename) {
        if (!filename) return null;
        
        if (/^https?:\/\//i.test(filename)) {
            return filename;
        }
    
        if (filename.startsWith('/')) {
            return `${IMAGE_DOMAIN}${filename}`;
        }
    
        return `${IMAGE_DOMAIN}/${filename}`;
    };

    mangalib.loadPageAsBase64 = async function (ref, opts = {}) {
        try {
            if (!ref) return null;
            
            let url = null;
            
            if (typeof ref === 'string') {
                url = mangalib.resolvePageUrl(ref);
            } else if (ref.filename) {
                url = mangalib.resolvePageUrl(ref.filename);
            } else if (ref.url) {
                url = ref.url;
                if (!/^https?:\/\//i.test(url)) {
                    url = mangalib.resolvePageUrl(url);
                }
            } else if (ref.src) {
                url = mangalib.resolvePageUrl(ref.src);
            }

            if (!url) {
                console.warn('mangalib: could not resolve page url for', ref);
                return null;
            }

            console.log('Loading image:', url);

            const headers = {
                'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
                'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
                'Referer': 'https://mangalib.me/',
                'Sec-GPC': '1',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site'
            };

            const resp = await fetch(url, {
                method: 'GET',
                headers,
                mode: 'cors',
                credentials: 'include'
            });

            if (!resp.ok) {
                console.warn(`mangalib: image fetch failed ${resp.status} ${url}`);
                return null;
            }

            const blob = await resp.blob();
            const reader = new FileReader();
            const base64 = await new Promise((resolve, reject) => {
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            return { base64: base64.split(',')[1] || base64, contentType: blob.type || 'image/jpeg' };
        } catch (e) {
            console.warn('mangalib.loadPageAsBase64 error', e);
            return null;
        }
    };

    mangalib.processChapterPages = async function (pages, opts = {}, onProgress) {
        if (!Array.isArray(pages)) return [];
        
        const concurrency = opts.concurrency || 5;
        const result = new Array(pages.length);
        let completed = 0;
        
        const loadPage = async (page, index) => {
            try {
                const img = await mangalib.loadPageAsBase64(page, opts);
                if (img) {
                    result[index] = {
                        type: 'image',
                        id: `manga_img_${Date.now()}_${index}`,
                        data: img
                    };
                } else {
                    result[index] = { type: 'text', text: `[image ${index + 1} failed to load]` };
                }
            } catch (e) {
                console.warn('processChapterPages load error', e);
                result[index] = { type: 'text', text: `[image ${index + 1} error]` };
            }
            
            completed++;
            if (typeof onProgress === 'function') {
                try { onProgress(completed, pages.length); } catch (e) {}
            }
        };
        
        const batches = [];
        for (let i = 0; i < pages.length; i += concurrency) {
            const batch = pages.slice(i, i + concurrency).map((page, batchIndex) => 
                loadPage(page, i + batchIndex)
            );
            batches.push(Promise.all(batch));
        }
        
        await Promise.all(batches);
        
        return result;
    };

    mangalib.extractText = function (content) {
        if (Array.isArray(content) && content.length && typeof content[0] === 'string')
            return content.map(fn => ({ type: 'image', src: fn }));
        return [];
    };

    mangalib.processChapterContent = async function (extracted, status, opts = {}) {
        const chapterMeta = opts.chapterMeta || {};
        const chapterObj = opts.chapterObj || {};
        const mangaSlug = opts.mangaSlug || '';
        
        let pages = [];
        try {
            pages = mangalib.extractPages(chapterMeta) || mangalib.extractPages(chapterObj) || [];
            if ((!pages || pages.length === 0) && Array.isArray(extracted) && extracted.length)
                pages = extracted.filter(b => b && b.src).map(b => b.src);
        } catch (e) {
            pages = [];
        }

        const chapterId = chapterMeta.id || chapterMeta.chapter_id || chapterObj.id || '';

        const loadOpts = {
            mangaSlug,
            chapterId,
            referer: 'https://mangalib.me',
            concurrency: opts.concurrency || 5
        };

        return await mangalib.processChapterPages(pages, loadOpts, (done, total) => {
            try {
                if (status) status.textContent = `Загружено страниц: ${done}/${total}`;
            } catch (e) { }
        });
    };

    mangalib.fetchManga = mangalib.fetchMangaMetadata;
    mangalib.fetchChapters = mangalib.fetchChaptersList;
    mangalib.fetchChapterByNumber = mangalib.fetchChapter;

    global.mangalib = mangalib;
})(window);