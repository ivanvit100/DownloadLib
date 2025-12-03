'use strict';

/* ==========================
   RanobeLib adapter
   Парсит JSON API аналогично mangalib.js
   ========================== */

(function (global) {
    const ranobelib = {};
    const IMAGE_DOMAIN = 'https://cover.imglib.info';

    let _mangaIdCache = null;
    let _chapterIdCache = null;

    function _curlLikeHeaders(extra = {}) {
        return Object.assign({
            'Accept': '*/*',
            'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
            'Site-Id': '3',
            'Content-Type': 'application/json',
            'Client-Time-Zone': 'Europe/Moscow',
            'Referer': 'https://ranobelib.me/',
            'Origin': 'https://ranobelib.me',
            'Sec-GPC': '1'
        }, extra);
    }

    ranobelib.fetchMangaMetadata = async function (mangaSlug, opts = {}) {
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
        
        if (result && result.data) {
            console.debug(result.data.ageRestriction);
            if (result.data.ageRestriction && typeof result.data.ageRestriction === 'object' && result.data.ageRestriction.label) {
            } else if (result.ageRestriction && typeof result.ageRestriction === 'object' && result.ageRestriction.label)
                result.data.ageRestriction = { label: result.ageRestriction.label };
            else if (!result.data.ageRestriction)
                result.data.ageRestriction = null;
        }
        
        return result;
    };

    ranobelib.fetchChaptersList = async function (mangaSlug, opts = {}) {
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

    ranobelib.fetchChapter = async function (mangaSlug, number, volume = '1', opts = {}) {
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

    ranobelib.extractPages = function (chapterData) {
        if (!chapterData) return [];
        if (Array.isArray(chapterData.pages) && chapterData.pages.length) return chapterData.pages.slice();
        if (Array.isArray(chapterData.images) && chapterData.images.length) return chapterData.images.slice();
        if (Array.isArray(chapterData.pages_list) && chapterData.pages_list.length) return chapterData.pages_list.slice();
        if (Array.isArray(chapterData.content) && chapterData.content.length && typeof chapterData.content[0] === 'string') return chapterData.content.slice();
        return [];
    };

    ranobelib.resolvePageUrl = function (filename) {
        if (!filename) return null;
        if (/^https?:\/\//i.test(filename)) return filename;
        if (filename.startsWith('/')) return `${IMAGE_DOMAIN}${filename}`;
        return `${IMAGE_DOMAIN}/${filename}`;
    };

    ranobelib.loadPageAsBase64 = async function (ref, opts = {}) {
        try {
            if (!ref) return null;
            let url = null;
            if (typeof ref === 'string') url = ranobelib.resolvePageUrl(ref);
            else if (ref.filename) url = ranobelib.resolvePageUrl(ref.filename);
            else if (ref.url) url = /^https?:\/\//i.test(ref.url) ? ref.url : ranobelib.resolvePageUrl(ref.url);
            else if (ref.src) url = ranobelib.resolvePageUrl(ref.src);

            if (!url) return null;

            const headers = {
                'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
                'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
                'Referer': 'https://ranobelib.me/',
                'Sec-GPC': '1'
            };

            const resp = await fetch(url, { method: 'GET', headers, mode: 'cors', credentials: 'include' });
            if (!resp.ok) return null;

            const blob = await resp.blob();
            const reader = new FileReader();
            const base64 = await new Promise((resolve, reject) => {
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            return { base64: base64.split(',')[1] || base64, contentType: blob.type || 'image/jpeg' };
        } catch (e) {
            console.warn('ranobelib.loadPageAsBase64 error', e);
            return null;
        }
    };

    ranobelib.processChapterPages = async function (pages, opts = {}, onProgress) {
        if (!Array.isArray(pages)) return [];
        const result = [];
        let i = 0;
        for (const p of pages) {
            i++;
            try {
                const img = await ranobelib.loadPageAsBase64(p, opts);
                if (img) result.push({ type: 'image', id: `ranobe_img_${Date.now()}_${i}`, data: img });
                else result.push({ type: 'text', text: `[image ${i} failed to load]` });
            } catch (e) {
                result.push({ type: 'text', text: `[image ${i} error]` });
            }
            if (typeof onProgress === 'function') {
                try { onProgress(i, pages.length); } catch (e) {}
            }
        }
        return result;
    };

    ranobelib.extractText = function (content) {
        if (Array.isArray(content) && content.length && typeof content[0] === 'string')
            return content.map(fn => ({ type: 'image', src: fn }));
        return [];
    };

    ranobelib.processChapterContent = async function (extracted, status, opts = {}) {
        const chapterMeta = opts.chapterMeta || {};
        const chapterObj = opts.chapterObj || {};
        const mangaSlug = opts.mangaSlug || '';

        let pages = [];
        try {
            pages = ranobelib.extractPages(chapterMeta) || ranobelib.extractPages(chapterObj) || [];
            if ((!pages || pages.length === 0) && Array.isArray(extracted) && extracted.length)
                pages = extracted.filter(b => b && b.src).map(b => b.src);
        } catch (e) { pages = []; }

        const chapterId = chapterMeta.id || chapterMeta.chapter_id || chapterObj.id || '';
        const loadOpts = { mangaSlug, chapterId, referer: 'https://ranobelib.me' };

        return await ranobelib.processChapterPages(pages, loadOpts, (done, total) => {
            try {
                if (status) status.textContent = `Загружено страниц: ${done}/${total}`;
            } catch (e) {}
        });
    };

    ranobelib.fetchManga = ranobelib.fetchMangaMetadata;
    ranobelib.fetchChapters = ranobelib.fetchChaptersList;
    ranobelib.fetchChapterByNumber = ranobelib.fetchChapter;

    global.ranobelib = ranobelib;
})(window);