'use strict';

/* ==========================
   RanobeLib-specific functions
   Экспортирует глобальный объект window.ranobelib.
   ========================== */

(function (global) {
    const ranobelib = {};

    function parseHtmlContent(html) {
        if (!html || typeof html !== 'string') return [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
        const container = doc.body.firstChild;
        const blocks = [];

        function resolveImgSrc(img) {
            return img.getAttribute('data-src') || img.getAttribute('data-original') || img.src || img.getAttribute('src');
        }

        function processNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                if (text) blocks.push({ type: 'text', text });
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toLowerCase();
                if (tag === 'p') {
                    const paragraphParts = [];
                    const images = [];
                    for (const child of node.childNodes) {
                        if (child.nodeType === Node.TEXT_NODE) {
                            const text = child.textContent.trim();
                            if (text) paragraphParts.push(text);
                        } else if (child.nodeType === Node.ELEMENT_NODE) {
                            if (child.tagName.toLowerCase() === 'img') {
                                const src = resolveImgSrc(child);
                                if (src) images.push({ src });
                            } else {
                                const text = child.textContent.trim();
                                if (text) paragraphParts.push(text);
                            }
                        }
                    }
                    if (paragraphParts.length > 0) blocks.push({ type: 'paragraph', text: paragraphParts.join(' '), images });
                    else if (images.length > 0) for (const img of images) blocks.push({ type: 'image', src: img.src });
                } else if (tag === 'img') {
                    const src = resolveImgSrc(node);
                    if (src) blocks.push({ type: 'image', src });
                } else {
                    for (const child of node.childNodes) processNode(child);
                }
            }
        }

        for (const child of container.childNodes) processNode(child);
        return blocks;
    }

    function extractText(content) {
        if (typeof content === 'string') return parseHtmlContent(content);

        if (content && content.type === 'doc' && content.content) {
            const blocks = [];
            for (const block of content.content) {
                if (block.type === 'paragraph' && block.content) {
                    let paragraphText = '';
                    const images = [];

                    for (const item of block.content) {
                        if (item.type === 'text' && item.text) {
                            paragraphText += item.text;
                        } else if (item.type === 'image' && item.attrs) {
                            if (item.attrs.src) {
                                images.push({ src: item.attrs.src });
                            } else if (Array.isArray(item.attrs.images)) {
                                for (const im of item.attrs.images) {
                                    if (im.image) images.push({ id: im.image });
                                    else if (im.src) images.push({ src: im.src });
                                }
                            }
                        }
                    }

                    if (paragraphText.trim() || images.length > 0) {
                        blocks.push({ type: 'paragraph', text: paragraphText, images });
                    }
                } else if (block.type === 'image' && block.attrs) {
                    if (block.attrs.src) blocks.push({ type: 'image', src: block.attrs.src });
                    else if (Array.isArray(block.attrs.images)) {
                        for (const im of block.attrs.images) {
                            if (im.image) blocks.push({ type: 'image', id: im.image });
                            else if (im.src) blocks.push({ type: 'image', src: im.src });
                        }
                    }
                }
            }
            return blocks;
        }
        return [];
    }

    async function tryFetchHead(url, options = {}) {
        try {
            const resp = await fetch(url, Object.assign({ method: 'HEAD', mode: 'cors', credentials: 'include' }, options));
            if (resp && resp.ok) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    async function resolveImageUrlForId(id, { chapterMeta, chapterObj, mangaSlug } = {}) {
        if (!id) return null;

        function extractNumericMangaId() {
            const candidates = [
                chapterMeta && (chapterMeta.manga_id || chapterMeta.mangaId || chapterMeta.book_id),
                chapterObj && (chapterObj.manga_id || chapterObj.mangaId || chapterObj.id),
                chapterMeta ? (String(chapterMeta.manga_id || chapterMeta.mangaId || '')).trim() : '',
                mangaSlug && /^\d+$/.test(mangaSlug) ? mangaSlug : ''
            ];
            for (const c of candidates) {
                if (!c) continue;
                const s = String(c);
                if (/^\d+$/.test(s)) return s;
            }
            try {
                if (chapterMeta) {
                    const s = JSON.stringify(chapterMeta);
                    const m = s.match(/"manga(?:_id|Id|Id)?"\s*:\s*(\d{4,7})/i) || s.match(/"book(?:_id)?"\s*:\s*(\d{4,7})/i);
                    if (m) return m[1];
                    const any = s.match(/\b(\d{5,7})\b/);
                    if (any) return any[1];
                }
            } catch (e) { /* ignore */ }
            return null;
        }

        const mangaId = extractNumericMangaId();
        const chapterId = (chapterMeta && (chapterMeta.id || chapterMeta.chapter_id || chapterMeta.chapterId || chapterMeta.number)) || (chapterObj && (chapterObj.id || chapterObj.chapter_id || chapterObj.number)) || '';

        const uuidLike = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
        if (uuidLike.test(id) && mangaId && chapterId) {
            const exts = ['jpg', 'png', 'webp', 'jpeg'];
            for (const ext of exts) {
                const candidate = `https://ranobelib.me/uploads/ranobe/${mangaId}/chapters/${chapterId}/${id}.${ext}`;
                if (await tryFetchHead(candidate)) return candidate;
            }
        }

        const tryUrls = [
            `https://api.cdnlibs.org/api/images/${id}`,
            `https://api.cdnlibs.org/api/image/${id}`,
            `https://api.cdnlibs.org/images/${id}`,
            `https://api.cdnlibs.org/image/${id}`
        ];
        for (const u of tryUrls) {
            try {
                const r = await fetch(u, { method: 'GET', mode: 'cors', credentials: 'omit' });
                if (!r.ok) continue;
                const ct = r.headers.get('content-type') || '';
                if (ct.includes('application/json')) {
                    const jd = await r.json();
                    if (jd && jd.url) return jd.url;
                    if (jd && jd.data && jd.data.url) return jd.data.url;
                    if (jd && jd.data && jd.data.original) return jd.data.original;
                } else {
                    return r.url || u;
                }
            } catch (e) { /* ignore */ }
        }

        try {
            if (chapterMeta) {
                const s = JSON.stringify(chapterMeta);
                const idx = s.indexOf(id);
                if (idx !== -1) {
                    const snippet = s.slice(Math.max(0, idx - 300), Math.min(s.length, idx + 300));
                    const urlMatch = snippet.match(/https?:\/\/[^\s"']{20,300}/);
                    if (urlMatch) return urlMatch[0];
                }
            }
        } catch (e) { /* ignore */ }

        const genericExts = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
        for (const ext of genericExts) {
            const candidate = `https://ranobelib.me/uploads/${id}.${ext}`;
            if (await tryFetchHead(candidate)) return candidate;
        }

        return null;
    }

    async function loadImageAsBase64(ref, opts = {}) {
        try {
            if (!ref) return null;
            let url = null;
            if (typeof ref === 'string') url = ref;
            else if (ref.src) url = ref.src;
            else if (ref.id) url = await resolveImageUrlForId(ref.id, opts);
            else if (ref.image) url = await resolveImageUrlForId(ref.image, opts);

            if (!url) {
                console.warn('Could not resolve image URL for ref', ref);
                return null;
            }

            if (url.startsWith('//')) url = 'https:' + url;
            else if (url.startsWith('/')) url = 'https://ranobelib.me' + url;
            else if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

            let referer = null;
            if (opts && opts.mangaSlug) {
                const maybeMangaId = (opts.chapterMeta && (opts.chapterMeta.manga_id || opts.chapterMeta.mangaId || '')) || (opts.chapterObj && (opts.chapterObj.manga_id || opts.chapterObj.mangaId || ''));
                if (maybeMangaId && /^\d+$/.test(String(maybeMangaId))) {
                    const slugPart = String(opts.mangaSlug).replace(/^\//, '').split('/').pop();
                    if (slugPart) referer = `https://ranobelib.me/ru/${maybeMangaId}--${slugPart}/read/`;
                }
            }
            if (!referer) {
                if (url.includes('ranobelib.me')) referer = 'https://ranobelib.me/';
                else if (url.includes('cover.imglib.info')) referer = 'https://ranobelib.me/';
            }

            const response = await fetch(url, {
                method: 'GET',
                headers: Object.assign({
                    'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5'
                }, referer ? { 'Referer': referer } : {}),
                mode: 'cors',
                credentials: 'include'
            });

            if (!response.ok) {
                console.warn(`Image load failed (${response.status}) for ${url}`);
                return null;
            }

            const blob = await response.blob();
            const reader = new FileReader();
            const base64 = await new Promise((resolve, reject) => {
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
            return { base64: base64.split(',')[1] || base64, contentType: blob.type || 'image/jpeg' };
        } catch (e) {
            console.warn('Error loading image:', ref, e);
            return null;
        }
    }

    async function processChapterContent(content, status, opts = {}) {
        if (typeof content === 'string') return [{ type: 'text', text: content }];
        if (!Array.isArray(content)) return [{ type: 'text', text: '' }];

        const processed = [];
        let imageCounter = 0;
        const { chapterMeta, chapterObj, mangaSlug } = opts;

        for (const block of content) {
            if (block.type === 'paragraph') {
                if (block.text && block.text.trim()) processed.push({ type: 'text', text: block.text });

                if (block.images && block.images.length > 0) {
                    for (const imgRef of block.images) {
                        imageCounter++;
                        try {
                            const imgData = await loadImageAsBase64(imgRef, { chapterMeta, chapterObj, mangaSlug });
                            if (imgData) {
                                processed.push({
                                    type: 'image',
                                    id: `img_${Date.now()}_${imageCounter}`,
                                    data: imgData
                                });
                            }
                        } catch (e) {
                            console.warn('Failed to load image ref:', imgRef, e);
                        }
                    }
                }
            } else if (block.type === 'image') {
                imageCounter++;
                try {
                    const ref = block.src ? { src: block.src } : (block.id ? { id: block.id } : block);
                    const imgData = await loadImageAsBase64(ref, { chapterMeta, chapterObj, mangaSlug });
                    if (imgData) {
                        processed.push({
                            type: 'image',
                            id: `img_${Date.now()}_${imageCounter}`,
                            data: imgData
                        });
                    }
                } catch (e) {
                    console.warn('Failed to load image block:', block, e);
                }
            } else if (block.type === 'text' && block.text) {
                processed.push({ type: 'text', text: block.text });
            }
        }

        return processed;
    }

    ranobelib.parseHtmlContent = parseHtmlContent;
    ranobelib.extractText = extractText;
    ranobelib.tryFetchHead = tryFetchHead;
    ranobelib.resolveImageUrlForId = resolveImageUrlForId;
    ranobelib.loadImageAsBase64 = loadImageAsBase64;
    ranobelib.processChapterContent = processChapterContent;

    global.ranobelib = ranobelib;
})(window);