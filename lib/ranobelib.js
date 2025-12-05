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

    ranobelib.resolvePageUrl = function (filename, opts = {}) {
        if (!filename) return null;
        if (/^https?:\/\//i.test(filename)) return filename;
        
        if (opts.mangaId && opts.chapterId) {
            const imageUuid = filename.replace(/^\/uploads\/ranobe\//, '').replace(/\.jpg$/, '');
            return `https://ranobelib.me/uploads/ranobe/${opts.mangaId}/chapters/${opts.chapterId}/${imageUuid}.jpg`;
        }
        
        if (filename.startsWith('/')) return `${IMAGE_DOMAIN}${filename}`;
        return `${IMAGE_DOMAIN}/${filename}`;
    };

    ranobelib.loadPageAsBase64 = async function (ref, opts = {}) {
        try {
            if (!ref) return null;
            let url = null;
            
            if (typeof ref === 'string') {
                url = ranobelib.resolvePageUrl(ref, opts);
            } else if (ref.filename) {
                url = ranobelib.resolvePageUrl(ref.filename, opts);
            } else if (ref.url) {
                url = /^https?:\/\//i.test(ref.url) ? ref.url : ranobelib.resolvePageUrl(ref.url, opts);
            } else if (ref.src) {
                url = ranobelib.resolvePageUrl(ref.src, opts);
            }

            if (!url) return null;

            const headers = {
                'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
                'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
                'Referer': 'https://ranobelib.me/',
                'Sec-GPC': '1',
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'same-origin'
            };

            const resp = await fetch(url, { 
                method: 'GET', 
                headers, 
                mode: 'cors', 
                credentials: 'include',
                cache: 'no-store'
            });
            
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
            return null;
        }
    };

    ranobelib.processChapterPages = async function (pages, opts = {}, onProgress) {
        if (!Array.isArray(pages)) return [];
        
        const concurrency = opts.concurrency || 5;
        const result = new Array(pages.length);
        let completed = 0;
        
        const loadPage = async (page, index) => {
            try {
                const img = await ranobelib.loadPageAsBase64(page, opts);
                if (img) {
                    result[index] = {
                        type: 'image',
                        id: `ranobe_img_${Date.now()}_${index}`,
                        data: img
                    };
                } else {
                    result[index] = { type: 'text', text: `[image ${index + 1} failed to load]` };
                }
            } catch (e) {
                console.warn('[ranobelib.processChapterPages] load error', e);
                result[index] = { type: 'text', text: `[image ${index + 1} error]` };
            }
            
            completed++;
            if (typeof onProgress === 'function')
                try { onProgress(completed, pages.length); } catch (e) {}
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

    function extractTextFromNode(node) {
        if (!node) return '';
        if (typeof node === 'string') return node;
        if (node.type === 'text' && node.text) return node.text;
        if (Array.isArray(node.content)) return node.content.map(extractTextFromNode).join('');
        return '';
    }

    ranobelib.extractText = function (content, opts = {}) {
        if (typeof content === 'string') return [{ type: 'text', text: content }];
        if (typeof content === 'object' && content.type === 'doc' && Array.isArray(content.content)) content = content.content;
        
        if (Array.isArray(content)) {
            const result = [];
            const mangaId = opts.mangaId || _mangaIdCache;
            const chapterId = opts.chapterId || _chapterIdCache;
            
            for (let i = 0; i < content.length; i++) {
                const item = content[i];
                if (!item || typeof item !== 'object') continue;
                
                if (item.type === 'paragraph' && Array.isArray(item.content)) {
                    const text = extractTextFromNode(item);
                    if (text.trim()) result.push({ type: 'text', text: text });
                } else if (item.type === 'image' && item.attrs && Array.isArray(item.attrs.images)) {
                    for (const img of item.attrs.images) {
                        if (img.image) {
                            result.push({ 
                                type: 'image', 
                                src: img.image,
                                mangaId: mangaId,
                                chapterId: chapterId
                            });
                        }
                    }
                } else if (item.type === 'horizontalRule') {
                    result.push({ type: 'text', text: '\n---\n' });
                }
            }
            return result;
        }
        return [];
    };

    ranobelib.processChapterContent = async function (extracted, status, opts = {}) {
        const chapterMeta = opts.chapterMeta || {};
        const chapterObj = opts.chapterObj || {};
        const mangaSlug = opts.mangaSlug || '';

        const textBlocks = extracted.filter(e => e.type === 'text');
        const imageBlocks = extracted.filter(e => e.type === 'image');
        const result = [];

        for (const block of textBlocks)
            if (block.text && block.text.trim()) result.push(block);

        if (imageBlocks.length > 0) {
            const mangaId = _mangaIdCache || chapterMeta.manga_id;
            const chapterId = chapterMeta.id || chapterObj.id;
            
            const loadOpts = {
                mangaId: mangaId,
                chapterId: chapterId,
                concurrency: opts.concurrency || 5
            };

            const loadedImages = await ranobelib.processChapterPages(imageBlocks, loadOpts, (done, total) => {
                try {
                    if (status) status.textContent = `Загружено изображений: ${done}/${total}`;
                } catch (e) {}
            });

            result.push(...loadedImages);
        }
        return result;
    };

    ranobelib.fetchManga = ranobelib.fetchMangaMetadata;
    ranobelib.fetchChapters = ranobelib.fetchChaptersList;
    ranobelib.fetchChapterByNumber = ranobelib.fetchChapter;

    global.ranobelib = ranobelib;
})(typeof window !== 'undefined' ? window : self);