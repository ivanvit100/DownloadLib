/**
 * DownloadLib service module
 * Module to interact with the MangaLib manga service
 * @module services/mangalib/MangaLibService
 * @license MIT
 * @author ivanvit
 * @version 1.0.0
 */

'use strict';

(function(global) {
    console.log('[MangaLibService] Loading...');

    class MangaLibService extends global.BaseService {
        constructor() {
            super(global.mangalibConfig);
            this._imageCache = new Map();
            console.log('[MangaLibService] Instance created');
        }

        static matches(url) {
            try {
                const hostname = new URL(url).hostname;
                return /mangalib\.me$/i.test(hostname) || /imgslib\.link$/i.test(hostname);
            } catch {
                return false;
            }
        }

        async fetchMangaMetadata(slug) {
            const fields = this.config.fields;
            const query = fields.map(f => `fields[]=${f}`).join('&');
            const url = `${this.baseUrl}/api/manga/${slug}?${query}`;
            
            console.log('[MangaLibService] Fetching metadata:', url);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: this.config.headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });
            
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                console.error('[MangaLibService] Error response:', text);
                throw new Error(`Failed to fetch manga: ${response.status}`);
            }
            
            const text = await response.text().catch(() => '');
            return text ? JSON.parse(text) : null;
        }

        async fetchChaptersList(slug) {
            const url = `${this.baseUrl}/api/manga/${slug}/chapters`;
            console.log('[MangaLibService] Fetching chapters:', url);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: this.config.headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch chapters: ${response.status}`);
            }
            
            const text = await response.text().catch(() => '');
            return text ? JSON.parse(text) : null;
        }

        async fetchChapter(slug, chapterNumberOrId, volume = '1') {
            const params = new URLSearchParams();
            if (chapterNumberOrId !== undefined && chapterNumberOrId !== null)
                params.set('number', String(chapterNumberOrId));
            if (volume !== undefined && volume !== null)
                params.set('volume', String(volume));
            const url = `${this.baseUrl}/api/manga/${slug}/chapter?${params.toString()}`;
            
            const response = await fetch(url, {
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

        extractPages(chapterData) {
            if (!chapterData) return [];
            if (Array.isArray(chapterData.pages) && chapterData.pages.length) return chapterData.pages.slice();
            if (Array.isArray(chapterData.images) && chapterData.images.length) return chapterData.images.slice();
            if (Array.isArray(chapterData.pages_list) && chapterData.pages_list.length) return chapterData.pages_list.slice();
            if (Array.isArray(chapterData.content) && chapterData.content.length) return chapterData.content.slice();
            return [];
        }

        extractText(content) {
            const pages = this.extractPages(content);
            if (pages.length > 0) {
                return pages.map(page => {
                    if (typeof page === 'string')
                        return { type: 'image', src: page };
                    else if (page && page.filename)
                        return { type: 'image', src: page.filename };
                    else if (page && page.url)
                        return { type: 'image', src: page.url };
                    else if (page && page.src)
                        return { type: 'image', src: page.src };
                    return { type: 'image', src: String(page) };
                });
            }
            return [];
        }

        resolvePageUrl(filename) {
            if (!filename) return null;
            
            let filenameStr;
            if (typeof filename === 'string')
                filenameStr = filename;
            else if (filename && filename.filename)
                filenameStr = filename.filename;
            else if (filename && filename.url)
                filenameStr = filename.url;
            else if (filename && filename.src)
                filenameStr = filename.src;
            else
                filenameStr = String(filename);
            
            if (/^https?:\/\//i.test(filenameStr)) return filenameStr;
            if (filenameStr.startsWith('/')) return `${this.config.imagesDomain}${filenameStr}`;
            return `${this.config.imagesDomain}/${filenameStr}`;
        }

        async splitLongImage(base64Data, contentType) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                const dataUrl = `data:${contentType};base64,${base64Data}`;
                
                img.onload = () => {
                    const A4_RATIO = 297 / 210;
                    const imgRatio = img.height / img.width;
                    
                    if (imgRatio <= A4_RATIO * 1.1) {
                        resolve([{ base64: base64Data, contentType }]);
                        return;
                    }
                    
                    const numParts = Math.ceil(imgRatio / A4_RATIO);
                    const partHeight = Math.floor(img.height / numParts);
                    
                    const parts = [];
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = img.width;
                    
                    for (let i = 0; i < numParts; i++) {
                        const y = i * partHeight;
                        const h = (i === numParts - 1) ? (img.height - y) : partHeight;
                        
                        canvas.height = h;
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, y, img.width, h, 0, 0, img.width, h);
                        
                        const partDataUrl = canvas.toDataURL(contentType || 'image/jpeg', 0.95);
                        const partBase64 = partDataUrl.split(',')[1];
                        
                        parts.push({
                            base64: partBase64,
                            contentType: contentType || 'image/jpeg'
                        });
                    }
                    
                    console.log(`[MangaLibService] Split image into ${parts.length} parts (ratio: ${imgRatio.toFixed(2)})`);
                    resolve(parts);
                };
                
                img.onerror = () => {
                    console.warn('[MangaLibService] Error loading image for splitting');
                    resolve([{ base64: base64Data, contentType }]);
                };
                
                img.src = dataUrl;
            });
        }

        async loadPageAsBase64(ref, opts = {}) {
            try {
                if (!ref) return null;
                
                let url = null;
                
                if (typeof ref === 'string') {
                    url = this.resolvePageUrl(ref);
                } else if (ref.filename) {
                    url = this.resolvePageUrl(ref.filename);
                } else if (ref.url) {
                    url = ref.url;
                    if (!/^https?:\/\//i.test(url))
                        url = this.resolvePageUrl(url);
                } else if (ref.src) {
                    url = this.resolvePageUrl(ref.src);
                }

                if (!url) {
                    console.warn('[MangaLibService] Could not resolve page url for', ref);
                    return null;
                }

                if (this._imageCache.has(url))
                    return this._imageCache.get(url);

                if (typeof browser === 'undefined' || !browser.runtime) {
                    console.error('[MangaLibService] browser.runtime not available!');
                    return null;
                }

                const response = await new Promise((resolve, reject) => {
                    browser.runtime.sendMessage({
                        action: 'fetchImage',
                        url: url
                    }).then(resolve).catch(reject);
                });

                if (!response || !response.ok) {
                    console.warn(`[MangaLibService] Failed to fetch ${url}:`, response?.error);
                    return null;
                }

                const base64Data = response.base64;
                const contentType = response.contentType || 'image/jpeg';
                
                if (opts.splitLongImages !== false) {
                    const parts = await this.splitLongImage(base64Data, contentType);
                    if (parts.length > 1) {
                        this._imageCache.set(url, parts);
                        return parts;
                    }
                    const result = parts[0];
                    this._imageCache.set(url, result);
                    return result;
                }

                const result = { base64: base64Data, contentType };
                this._imageCache.set(url, result);
                return result;
            } catch (e) {
                console.error('[MangaLibService] loadPageAsBase64 error', e);
                return null;
            }
        }

        async processChapterContent(extracted, status, opts = {}) {
            const chapterMeta = opts.chapterMeta || {};
            const chapterObj = opts.chapterObj || {};
            
            let pages = [];
            try {
                pages = this.extractPages(chapterMeta) || this.extractPages(chapterObj) || [];
                if ((!pages || pages.length === 0) && Array.isArray(extracted) && extracted.length)
                    pages = extracted.filter(b => b && b.src).map(b => b.src);
            } catch (e) {
                pages = [];
            }

            const loadOpts = {
                splitLongImages: opts.splitLongImages !== false
            };

            const result = [];
            let completed = 0;
            const concurrency = 5;
            
            for (let i = 0; i < pages.length; i += concurrency) {
                const batch = pages.slice(i, Math.min(i + concurrency, pages.length));
                const batchPromises = batch.map((page, batchIdx) => 
                    this.loadPageAsBase64(page, loadOpts)
                        .then(img => ({ img, index: i + batchIdx }))
                        .catch(err => {
                            console.warn(`[MangaLibService] Failed to load page ${i + batchIdx}:`, err);
                            return { img: null, index: i + batchIdx };
                        })
                );

                const batchResults = await Promise.all(batchPromises);

                for (const { img, index } of batchResults) {
                    if (!img) {
                        result.push({ type: 'text', text: `[Ошибка загрузки изображения ${index + 1}]` });
                    } else if (Array.isArray(img)) {
                        img.forEach((part, partIndex) => {
                            result.push({
                                type: 'image',
                                id: `manga_img_${Date.now()}_${index}_part${partIndex}`,
                                data: part,
                                originalIndex: index,
                                partIndex: partIndex,
                                totalParts: img.length
                            });
                        });
                    } else {
                        result.push({
                            type: 'image',
                            id: `manga_img_${Date.now()}_${index}`,
                            data: img,
                            originalIndex: index
                        });
                    }

                    completed++;
                    if (status) status.textContent = `Загружено страниц: ${completed}/${pages.length}`;
                }
            }
            
            return result;
        }
    }

    global.MangaLibService = MangaLibService;
    console.log('[MangaLibService] Loaded');
})(typeof window !== 'undefined' ? window : self);