/**
 * DownloadLib service module
 * Module to interact with RanobeLib service
 * @module services/ranobelib/RanobeLibService
 * @license MIT
 * @author ivanvit
 * @version 1.0.4
 */

'use strict';

(function(global) {
    console.log('[RanobeLibService] Loading...');

    /* istanbul ignore next */
    const extensionApi = typeof global.getExtensionApi === 'function'
        ? global.getExtensionApi()
        : ((typeof global.browser !== 'undefined' && global.browser) || (typeof global.chrome !== 'undefined' && global.chrome) || null);

    class RanobeLibService extends global.BaseService {
        constructor() {
            super(global.ranolibConfig);
            this._mangaIdCache = null;
            console.log('[RanobeLibService] Instance created');
        }

        static matches(url) {
            try {
                const hostname = new URL(url).hostname;
                return /ranobelib\.me$/i.test(hostname);
            } catch {
                return false;
            }
        }

        async fetchMangaMetadata(slug) {
            const fields = this.config.fields;
            const query = Array.isArray(fields) && fields.length
                ? fields.map(f => `fields[]=${f}`).join('&')
                : '';
            const urls = [];

            if (query) urls.push(`${this.baseUrl}/api/manga/${slug}?${query}`);
            urls.push(`${this.baseUrl}/api/manga/${slug}`);

            let result = null;

            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                console.log('[RanobeLibService] Fetching metadata:', url);

                const response = await this.fetchWithRateLimitRetry(url, {
                    method: 'GET',
                    headers: this.config.headers,
                    mode: 'cors',
                    credentials: 'include',
                    cache: 'no-store'
                });

                if (!response.ok) {
                    const text = await response.text().catch(() => '');
                    if (response.status === 403 && i < urls.length - 1) {
                        console.warn('[RanobeLibService] Metadata endpoint rejected, retrying with fallback URL');
                        continue;
                    }
                    console.error('[RanobeLibService] Error response:', text);
                    throw new Error(`Failed to fetch manga: ${response.status}`);
                }

                const text = await response.text().catch(() => '');
                result = text ? JSON.parse(text) : null;
                break;
            }

            if (result && result.data && result.data.id)
                this._mangaIdCache = result.data.id;

            return result;
        }

        async fetchChaptersList(slug) {
            const url = `${this.baseUrl}/api/manga/${slug}/chapters`;
            console.log('[RanobeLibService] Fetching chapters:', url);

            const response = await this.fetchWithRateLimitRetry(url, {
                method: 'GET',
                headers: this.config.headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });

            if (!response.ok)
                throw new Error(`Failed to fetch chapters: ${response.status}`);

            const text = await response.text().catch(() => '');
            return text ? JSON.parse(text) : null;
        }

        async fetchChapter(slug, number, volume = '1') {
            const params = new URLSearchParams();
            if (number !== undefined && number !== null) params.set('number', String(number));
            else params.set('number', '1');
            params.set('volume', String(volume));
            const url = `${this.baseUrl}/api/manga/${slug}/chapter?${params.toString()}`;

            const response = await this.fetchWithRateLimitRetry(url, {
                method: 'GET',
                headers: this.config.headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });

            if (!response.ok)
                throw new Error(`Failed to fetch chapter: ${response.status}`);

            const text = await response.text().catch(() => '');
            return text ? JSON.parse(text) : null;
        }

        stripHtml(str) {
            if (!str) return '';
            return str
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p>/gi, '\n')
                .replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/gi, ' ')
                .replace(/&amp;/gi, '&')
                .replace(/&lt;/gi, '<')
                .replace(/&gt;/gi, '>')
                .replace(/&quot;/gi, '"')
                .replace(/&#039;/gi, "'")
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        extractText(content) {
            if (typeof content === 'string') {
                try {
                    content = JSON.parse(content);
                } catch (e) {
                    const result = [];
                    const parts = content.split(/(<img\s[^>]*>)/i);
                    for (const part of parts) {
                        const imgMatch = part.match(/^<img\s[^>]*src=["']([^"']+)["'][^>]*>$/i);
                        if (imgMatch) {
                            result.push({ type: 'image', src: imgMatch[1] });
                        } else {
                            const stripped = this.stripHtml(part);
                            if (stripped.trim()) result.push({ type: 'text', text: stripped });
                        }
                    }
                    return result;
                }
            }

            if (content && content.type === 'doc' && Array.isArray(content.content))
                content = content.content;

            if (!Array.isArray(content)) return [];

            const result = [];

            const extractTextFromNode = (node) => {
                if (!node) return '';
                if (typeof node === 'string') return this.stripHtml(node);
                if (node.type === 'text' && node.text) return this.stripHtml(node.text);
                if (node.type === 'hardBreak') return '\n';
                if (Array.isArray(node.content))
                    return node.content.map(extractTextFromNode).filter(t => t !== '').join('');
                else return '';
            };

            for (const item of content) {
                if (!item || typeof item !== 'object') continue;

                if (item.type === 'paragraph') {
                    if (Array.isArray(item.content)) {
                        let hasImage = false;
                        for (const child of item.content) {
                            if (child && child.type === 'image') {
                                hasImage = true;
                                if (child.attrs && Array.isArray(child.attrs.images)) {
                                    for (const img of child.attrs.images) {
                                        if (img.image) {
                                            result.push({
                                                type: 'image',
                                                src: img.image
                                            });
                                        } else console.warn('[RanobeLibService] Image node missing image attribute:', img);
                                    }
                                }
                            }
                        }

                        if (!hasImage) {
                            const text = extractTextFromNode(item);
                            if (text.trim()) result.push({ type: 'text', text: text });
                        }
                    } else if (typeof item.content === 'string') {
                        const text = this.stripHtml(item.content);
                        if (text.trim()) result.push({ type: 'text', text: text });
                    } else {
                        console.warn('[RanobeLibService] Unexpected paragraph content:', item);
                        const text = extractTextFromNode(item);
                        /* istanbul ignore next */
                        if (text && text.trim()) result.push({ type: 'text', text: text });
                    }
                } else if (item.type === 'image' && item.attrs && Array.isArray(item.attrs.images)) {
                    for (const img of item.attrs.images) {
                        if (img.image) {
                            result.push({
                                type: 'image',
                                src: img.image
                            });
                        } else console.warn('[RanobeLibService] Image node missing image attribute:', img);
                    }
                } else if (item.type === 'horizontalRule') {
                    result.push({ type: 'text', text: '\n---\n' });
                } else if (item.type === 'heading') {
                    const text = extractTextFromNode(item);
                    text.trim() && result.push({ type: 'text', text: text });
                } else if (item.type === 'blockquote') {
                    const text = extractTextFromNode(item);
                    text.trim() && result.push({ type: 'text', text: text });
                } else if (item.type === 'bulletList' || item.type === 'orderedList') {
                    const text = extractTextFromNode(item);
                    text.trim() && result.push({ type: 'text', text: text });
                } else if (item.type === 'listItem') {
                    const text = extractTextFromNode(item);
                    text.trim() && result.push({ type: 'text', text: text });
                } else console.warn('[RanobeLibService] Unknown content node type:', item);
            }

            return result;
        }

        async processChapterContent(extracted, status, opts = {}) {
            const chapterMeta = opts.chapterMeta || {};
            const mangaId = this._mangaIdCache || chapterMeta.manga_id;
            const chapterId = chapterMeta.id;

            const result = [];

            for (const block of extracted) {
                if (block.type === 'text') {
                    if (block.text && block.text.trim())
                        result.push(block);
                    else console.warn('[RanobeLibService] Skipping empty text block');
                } else if (block.type === 'image' && block.src) {
                    const originalExt = (block.src.match(/\.(jpg|jpeg|png|webp)$/i) || [])[1] || 'jpg';
                    const fallbacks = ['jpg', 'jpeg', 'png', 'webp'].filter(e => e !== originalExt);
                    const extensions = [originalExt, ...fallbacks];

                    const srcWithoutExt = block.src.replace(/\.(jpg|jpeg|png|webp)$/i, '');
                    const isFullUrl = /^https?:\/\//i.test(block.src);
                    const isAbsolutePath = /^(\/\/|\/)/.test(block.src);
                    const baseUrl = isFullUrl
                        ? srcWithoutExt
                        : isAbsolutePath
                            ? new URL(srcWithoutExt, 'https://ranobelib.me').toString()
                            : (() => {
                                const imageUuid = srcWithoutExt;
                                return `https://ranobelib.me/uploads/ranobe/${mangaId}/chapters/${chapterId}/${imageUuid}`;
                            })();

                    let loaded = false;

                    for (const ext of extensions) {
                        const url = `${baseUrl}.${ext}`;

                        try {
                            if (!extensionApi || !extensionApi.runtime || !extensionApi.runtime.sendMessage) {
                                console.error('[RanobeLibService] browser.runtime not available!');
                                continue;
                            }

                            const response = await new Promise((resolve, reject) => {
                                extensionApi.runtime.sendMessage({
                                    action: 'fetchImage',
                                    url: url,
                                    referer: 'https://ranobelib.me/'
                                }).then(resolve).catch(reject);
                            });

                            if (!response || !response.ok) {
                                console.warn(`[RanobeLibService] Failed to fetch ${url}:`, response?.error);
                                continue;
                            }

                            result.push({
                                type: 'image',
                                data: { base64: response.base64, contentType: response.contentType || 'image/png' }
                            });

                            loaded = true;
                            break;
                        } catch (e) {
                            console.warn('[RanobeLibService] Failed ext:', ext, e);
                        }
                    }

                    if (!loaded) console.error('[RanobeLibService] Failed to load image:', block.src);
                } else console.warn('[RanobeLibService] Unknown block type:', block);
            }

            return result;
        }
    }

    global.RanobeLibService = RanobeLibService;
    console.log('[RanobeLibService] Loaded');
})(typeof window !== 'undefined' ? window : self);