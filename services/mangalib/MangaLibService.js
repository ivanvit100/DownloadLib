/**
 * DownloadLib service module
 * Module to interact with the MangaLib manga service
 * @module services/mangalib/MangaLibService
 * @license MIT
 * @author ivanvit
 * @version 1.0.9
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
                const { hostname } = new URL(url);
                return /mangalib\.me$/i.test(hostname) ||
                    /imgslib\.link$/i.test(hostname) ||
                    /mangalib\.org$/i.test(hostname);
            } catch {
                return false;
            }
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

        _getActiveServer() {
            return { domain: this.config.imagesDomain, compress: true, apiParam: 'compress' };
        }

        fetchChapter(slug, number, volume = '1', branchId = null) {
            return super.fetchChapter(slug, number, volume, branchId, { server: 'compress' });
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
            const { domain } = this._getActiveServer();
            if (filenameStr.startsWith('/')) return `${domain}${filenameStr}`;
            return `${domain}/${filenameStr}`;
        }

        splitLongImage(base64Data, contentType, compressOpts = {}) {
            return new Promise((resolve) => {
                const img = new Image();
                const dataUrl = `data:${contentType};base64,${base64Data}`;
                const outputFormat = compressOpts.format || contentType || 'image/jpeg';
                const quality = compressOpts.quality || 0.92;

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
                        if (outputFormat === 'image/jpeg') {
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, canvas.width, h);
                        }
                        ctx.drawImage(img, 0, y, img.width, h, 0, 0, img.width, h);

                        const partDataUrl = canvas.toDataURL(outputFormat, quality);
                        const [, partBase64] = partDataUrl.split(',');

                        parts.push({ base64: partBase64, contentType: outputFormat });
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

        _resolveRefUrl(ref) {
            if (typeof ref === 'string') return this.resolvePageUrl(ref);
            if (ref.filename) return this.resolvePageUrl(ref.filename);
            if (ref.url) {
                const { url } = ref;
                if (/^https?:\/\//i.test(url)) return url;
                if (url.startsWith('//')) return this.resolvePageUrl(url.slice(1));
                return this.resolvePageUrl(url);
            }
            if (ref.image) return this.resolvePageUrl(ref.image);
            if (ref.src) return this.resolvePageUrl(ref.src);
            return null;
        }

        async _processImage(base64Data, contentType, compressOpts, splitLongImages) {
            if (splitLongImages) {
                const parts = await this.splitLongImage(base64Data, contentType, compressOpts);
                if (parts.length > 1) return parts;
                const [raw] = parts;
                return global.ImageCompressor
                    ? global.ImageCompressor.compress(raw.base64, raw.contentType, compressOpts)
                    : raw;
            }
            return global.ImageCompressor
                ? global.ImageCompressor.compress(base64Data, contentType, compressOpts)
                : { base64: base64Data, contentType };
        }

        async _fetchWithCompressionFallback(url) {
            const send = u => this.extensionApi.runtime.sendMessage({ action: 'fetchImage', url: u });
            const response = await send(url);
            if (response?.ok) return response;
            console.warn(`[MangaLibService] Failed to fetch ${url}:`, response?.error);
            return null;
        }

        async loadPageAsBase64(ref, opts = {}) {
            try {
                if (!ref) return null;

                const url = this._resolveRefUrl(ref);
                if (!url) {
                    console.warn('[MangaLibService] Could not resolve page url for', ref);
                    return null;
                }

                if (this._imageCache.has(url)) return this._imageCache.get(url);

                if (!this.extensionApi?.runtime?.sendMessage) {
                    console.error('[MangaLibService] browser.runtime not available!');
                    return null;
                }

                const response = await this._fetchWithCompressionFallback(url);
                if (!response) return null;

                const compressOpts = {
                    format: opts.compressionFormat || 'image/jpeg',
                    quality: opts.compressionQuality || 0.92
                };
                const result = await this._processImage(
                    response.base64,
                    response.contentType || 'image/jpeg',
                    compressOpts,
                    opts.splitLongImages !== false
                );

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
                splitLongImages: opts.splitLongImages !== false,
                compressionFormat: opts.compressionFormat || 'image/jpeg',
                compressionQuality: opts.compressionQuality || 0.92
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
                    if (!img)
                        result.push({ type: 'text', text: `[Ошибка загрузки изображения ${index + 1}]` });
                    else if (Array.isArray(img)) {
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

                    completed += 1;
                    if (status) status.textContent = `Загружено страниц: ${completed}/${pages.length}`;
                }
            }

            return result;
        }
    }

    global.MangaLibService = MangaLibService;
    if (global.serviceRegistry) global.serviceRegistry.register(MangaLibService);
    console.log('[MangaLibService] Loaded');
})(typeof window !== 'undefined' ? window : self);