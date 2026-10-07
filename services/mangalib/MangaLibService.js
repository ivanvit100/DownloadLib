/**
 * DownloadLib service module
 * Module to interact with the MangaLib manga service
 * @module services/mangalib/MangaLibService
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { fetchPageImage, loadImageOrDefer } from '../../core/DownloadManager.js';
import { BaseService } from '../BaseService.js';
import { ImageCompressor } from '../../core/ImageCompressor.js';
import { mangalibConfig } from './config.js';
import { NoServiceTabError } from '../../core/BrowserApi.js';

console.log('[MangaLibService] Loading...');

/**
 * Сервис-парсер сайта MangaLib: изображения страниц отдаются одним "сжатым"
 * сервером, но могут быть аномально длинными — при необходимости
 * разбиваются на части по соотношению сторон A4 перед сжатием.
 */
export class MangaLibService extends BaseService {
    /**
     * Создаёт сервис с конфигурацией MangaLib и пустым кэшем загруженных изображений.
     */
    constructor() {
        super(mangalibConfig);
        this._imageCache = new Map();
        console.log('[MangaLibService] Instance created');
    }

    /**
     * Проверяет, относится ли URL к хостам MangaLib.
     * @param {string} url - Проверяемый URL.
     * @returns {boolean} true, если хост URL принадлежит MangaLib.
     */
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

    /**
     * Извлекает список страниц главы в унифицированном текстовом формате.
     * @param {object} content - Сырое содержимое главы от API.
     * @returns {{type: 'image', src: string}[]} Список страниц как изображений.
     */
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

    /**
     * Возвращает конфигурацию сервера изображений.
     * @returns {{domain: string, compress: boolean, apiParam: string}} Конфигурация сервера.
     */
    _getActiveServer() {
        return { domain: this.config.imagesDomain, compress: true, apiParam: 'compress' };
    }

    /**
     * Загружает данные главы, всегда запрашивая изображения со "сжатого" сервера.
     * @param {string} slug - Slug тайтла.
     * @param {*} number - Номер главы.
     * @param {*} [volume='1'] - Номер тома.
     * @param {?number} [branchId] - id ветки перевода.
     * @returns {Promise<?object>} Данные главы от API.
     */
    fetchChapter(slug, number, volume = '1', branchId = null) {
        return super.fetchChapter(slug, number, volume, branchId, { server: 'compress' });
    }

    /**
     * Строит абсолютный URL страницы главы из ссылки (строка, либо объект
     * с полем filename/url/src) на домене активного сервера изображений.
     * @param {*} filename - Ссылка на страницу.
     * @returns {?string} Абсолютный URL страницы, либо null, если filename пуст.
     */
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

    /**
     * Разбивает аномально длинное изображение на несколько
     * частей по соотношению сторон, близкому к A4, чтобы каждая часть нормально
     * помещалась на страницу файла; изображения с обычным соотношением сторон
     * возвращаются без изменений.
     * @param {string} base64Data - Исходное изображение в base64.
     * @param {string} contentType - MIME-тип исходного изображения.
     * @param {{format?: string, quality?: number}} [compressOpts] - Формат и качество
     * для перекодирования частей через canvas.
     * @returns {Promise<{base64: string, contentType: string}[]>} Список частей
     * изображения (один элемент, если разбиение не потребовалось).
     */
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

    /**
     * Извлекает и разрешает абсолютный URL страницы из ссылки произвольной формы.
     * @param {*} ref - Ссылка на страницу.
     * @returns {?string} Абсолютный URL страницы, либо null, если формат не распознан.
     */
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

    /**
     * Обрабатывает изображение страницы.
     * @param {string} base64Data - Исходное изображение в base64.
     * @param {string} contentType - MIME-тип исходного изображения.
     * @param {object} compressOpts - Опции сжатия.
     * @param {boolean} splitLongImages - Нужно ли разбивать длинные изображения на части.
     * @returns {Promise<{base64: string, contentType: string}|{base64: string, contentType: string}[]>}
     * Обработанное изображение, либо массив частей, если было выполнено разбиение.
     */
    async _processImage(base64Data, contentType, compressOpts, splitLongImages) {
        if (splitLongImages) {
            const parts = await this.splitLongImage(base64Data, contentType, compressOpts);
            if (parts.length > 1) {
                if (!compressOpts.maxWidth) return parts;
                return Promise.all(parts.map(part =>
                    ImageCompressor.compress(part.base64, part.contentType, compressOpts)));
            }
            const [raw] = parts;
            return ImageCompressor.compress(raw.base64, raw.contentType, compressOpts);
        }
        return ImageCompressor.compress(base64Data, contentType, compressOpts);
    }

    /**
     * Загружает изображение страницы через общий fetchPageImage (background/вкладка).
     * @param {string} url - URL изображения.
     * @returns {Promise<?object>} Результат загрузки, либо null при ошибке.
     */
    async _fetchWithCompressionFallback(url) {
        const response = await fetchPageImage(url, 'mangalib');
        if (response?.ok) return response;
        console.warn(`[MangaLibService] Failed to fetch ${url}:`, response?.error);
        return null;
    }

    /**
     * Загружает и обрабатывает (при необходимости разбивает/сжимает) одну
     * страницу главы, кэшируя результат по разрешённому URL, чтобы не
     * загружать одно и то же изображение повторно.
     * @param {*} ref - Ссылка на страницу.
     * @param {{compressionFormat?: string, compressionQuality?: number,
     * splitLongImages?: boolean, imageFit?: object}} [opts] - Параметры обработки изображения.
     * @returns {Promise<?({base64: string, contentType: string}|
     * {base64: string, contentType: string}[])>} Обработанное изображение
     * (или массив частей), либо null при ошибке.
     */
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
                quality: opts.compressionQuality || 0.92,
                ...opts.imageFit
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
            if (e instanceof NoServiceTabError) throw e;
            console.error('[MangaLibService] loadPageAsBase64 error', e);
            return null;
        }
    }

    /**
     * Приводит загруженное изображение страницы (или его части после разбиения)
     * к блокам содержимого главы.
     * @param {{base64: string, contentType: string}|{base64: string, contentType: string}[]} img
     * Обработанное изображение, либо массив частей.
     * @param {number} index - Индекс страницы в главе.
     * @returns {object[]} Блоки изображения.
     */
    _toImageBlocks(img, index) {
        if (!Array.isArray(img)) {
            return [{
                type: 'image',
                id: `manga_img_${Date.now()}_${index}`,
                data: img,
                originalIndex: index
            }];
        }
        return img.map((part, partIndex) => ({
            type: 'image',
            id: `manga_img_${Date.now()}_${index}_part${partIndex}`,
            data: part,
            originalIndex: index,
            partIndex: partIndex,
            totalParts: img.length
        }));
    }

    /**
     * Загружает все страницы главы пакетами (по 5 одновременно), обновляя
     * статус прогресса, и приводит результат к унифицированному формату
     * содержимого главы. Страница, не успевшая загрузиться за отведённый срок,
     * заменяется меткой и догружается в фоне (см. loadImageOrDefer).
     * @param {Array} extracted - Список страниц, извлечённых extractText.
     * @param {?{textContent: string}} status - Элемент статуса для отображения прогресса.
     * @param {object} [opts] - Опции обработки (chapterMeta, chapterObj, splitLongImages,
     * compressionFormat, compressionQuality, imageFit).
     * @returns {Promise<object[]>} Список элементов содержимого главы.
     */
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
            compressionQuality: opts.compressionQuality || 0.92,
            imageFit: opts.imageFit
        };

        const result = [];
        let completed = 0;
        const concurrency = 5;

        for (let i = 0; i < pages.length; i += concurrency) {
            const batch = pages.slice(i, Math.min(i + concurrency, pages.length));
            const batchPromises = batch.map((page, batchIdx) => {
                const index = i + batchIdx;
                const load = async () => {
                    const img = await this.loadPageAsBase64(page, loadOpts);
                    return img ? this._toImageBlocks(img, index) : null;
                };
                return loadImageOrDefer(index + 1, load)
                    .then(blocks => ({ blocks, index }))
                    .catch(err => {
                        if (err instanceof NoServiceTabError) throw err;
                        console.warn(`[MangaLibService] Failed to load page ${index}:`, err);
                        return { blocks: null, index };
                    });
            });

            const batchResults = await Promise.all(batchPromises);

            for (const { blocks, index } of batchResults) {
                if (!blocks)
                    result.push({ type: 'text', text: `[Ошибка загрузки изображения ${index + 1}]` });
                else
                    result.push(...blocks);

                completed += 1;
                if (status) status.textContent = `Загружено страниц: ${completed}/${pages.length}`;
            }
        }

        return result;
    }
}

console.log('[MangaLibService] Loaded');
