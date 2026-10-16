/**
 * DownloadLib service module
 * Common base of manga services on the cdnlibs.org API whose chapters are page images
 * @module services/CdnLibsService
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { ImageCompressor, PAGE_ASPECT } from '../core/ImageCompressor.js';
import { createLogger } from '../core/logger.js';
import { NoServiceTabError } from '../core/TabNetwork.js';
import { BaseService } from './BaseService.js';

/** Сколько страниц главы загружается одновременно. */
const PAGE_CONCURRENCY = 5;

/**
 * Возвращает путь или URL страницы из ссылки любой формы: строки либо объекта
 * страницы из API с полем filename, url, image или src.
 * @param {*} ref - Ссылка на страницу.
 * @returns {?string} Путь или URL страницы, либо null, если ссылки нет.
 */
function pageRef(ref) {
    if (ref == null || ref === '') return null;
    if (typeof ref !== 'object') return String(ref);
    const value = ref.filename || ref.url || ref.image || ref.src;
    return value ? String(value) : null;
}

/**
 * Проверяет, что ошибку нельзя превращать в «страница не загрузилась»: без вкладки
 * сервиса не загрузится ни одна страница, а остановленную загрузку не продолжают.
 * @param {*} error - Ошибка.
 * @returns {boolean}
 */
function isFatal(error) {
    return error instanceof NoServiceTabError || !!error?.aborted;
}

/**
 * Общая база сервисов манги на API cdnlibs.org (MangaLib и сервисные плагины
 * с @dl-service-config): страницы глав — изображения на CDN сервиса.
 * Смысл полей конфига: imagesDomain, imageServers {domain, label, compress},
 * defaultImageServer, splitLongImages, maxImageHeight.
 */
export class CdnLibsService extends BaseService {
    /**
     * Извлекает страницы главы в унифицированном виде.
     * @param {object} content - Сырое содержимое главы от API.
     * @returns {{type: 'image', src: string}[]} Страницы как изображения.
     */
    extractText(content) {
        return this.extractPages(content)
            .map(page => ({ type: 'image', src: pageRef(page) ?? String(page) }));
    }

    /**
     * Возвращает сервер изображений: выбранный пользователем
     * (localStorage['<name>_image_server']), иначе defaultImageServer, иначе
     * 'compression' из imageServers конфига; без imageServers — imagesDomain
     * со сжатием.
     * @returns {{domain: string, compress?: boolean, label?: string}} Сервер изображений.
     */
    _activeServer() {
        const { imageServers, imagesDomain, defaultImageServer } = this.config;
        const fallback = { domain: imagesDomain || '', compress: true };
        if (!imageServers) return fallback;
        let selected = null;
        try {
            selected = localStorage.getItem(`${this.name}_image_server`);
        } catch (e) {
            createLogger(this.name).debug('localStorage is not available, using the default image server:', e);
            selected = null;
        }
        return imageServers[selected || defaultImageServer || 'compression'] || imageServers.compression || fallback;
    }

    /**
     * Строит абсолютный URL страницы: готовый URL возвращается как есть, путь
     * (в том числе «//путь» из ответа API) дополняется доменом сервера изображений.
     * @param {*} ref - Ссылка на страницу (строка или объект страницы).
     * @returns {?string} Абсолютный URL, либо null, если ссылки нет.
     */
    resolvePageUrl(ref) {
        let path = pageRef(ref);
        if (!path) return null;
        if (/^https?:\/\//i.test(path)) return path;
        if (path.startsWith('//')) path = path.slice(1);
        const { domain } = this._activeServer();
        return path.startsWith('/') ? `${domain}${path}` : `${domain}/${path}`;
    }

    /**
     * Загружает страницу и обрабатывает её: вписывает в габариты, перекодирует и,
     * если включено и в конфиге, и в настройке загрузки, режет длинное изображение
     * на части (не выше страницы A4 и maxImageHeight). Сервер с compress:false
     * отдаёт страницу без обработки.
     * @param {*} ref - Ссылка на страницу.
     * @param {{compressionFormat?: string, compressionQuality?: number, imageFit?: ?object,
     * splitLongImages?: boolean}} [options] - Параметры обработки.
     * @param {?Map<string, object[]>} [cache] - Кэш уже загруженных страниц главы.
     * @returns {Promise<?{base64: string, contentType: string}[]>} Части страницы,
     * либо null, если её не удалось загрузить.
     * @throws {NoServiceTabError} Если открытой вкладки сервиса нет.
     */
    async loadPage(ref, {
        compressionFormat = 'image/jpeg', compressionQuality = 0.92, imageFit = null, splitLongImages = false
    } = {}, cache = null) {
        const url = this.resolvePageUrl(ref);
        if (!url) {
            createLogger(this.name).warn('Could not resolve page url for', ref);
            return null;
        }
        if (cache?.has(url)) return cache.get(url);

        const response = await this.fetchImage(url);
        if (!response.ok) {
            createLogger(this.name).warn(`Failed to fetch ${url}:`, response.error);
            return null;
        }

        const contentType = response.contentType || 'image/jpeg';
        const split = splitLongImages && this.config.splitLongImages;
        const parts = this._activeServer().compress === false
            ? [{ base64: response.base64, contentType }]
            : await ImageCompressor.process(response.base64, contentType, {
                format: compressionFormat,
                quality: compressionQuality,
                ...imageFit,
                ...(split ? { splitAspect: PAGE_ASPECT, maxPartHeight: this.config.maxImageHeight || Infinity } : {})
            });
        cache?.set(url, parts);
        return parts;
    }

    /**
     * Загружает одну страницу (прежний интерфейс): изображение, массив частей,
     * если страницу пришлось разрезать, либо null при ошибке. Нарезка включена,
     * если opts.splitLongImages не равно false и конфиг её разрешает.
     * @param {*} ref - Ссылка на страницу.
     * @param {object} [opts] - Параметры обработки (см. loadPage).
     * @returns {Promise<?({base64: string, contentType: string}|{base64: string, contentType: string}[])>}
     * Изображение, части изображения, либо null.
     * @throws {NoServiceTabError} Если открытой вкладки сервиса нет.
     */
    async loadPageAsBase64(ref, opts = {}) {
        try {
            const parts = await this.loadPage(ref, { ...opts, splitLongImages: opts.splitLongImages !== false });
            if (!parts) return null;
            return parts.length === 1 ? parts[0] : parts;
        } catch (e) {
            if (isFatal(e)) throw e;
            createLogger(this.name).error('loadPageAsBase64 error', e);
            return null;
        }
    }

    /**
     * Превращает загруженную страницу (одну или несколько частей) в блоки главы.
     * @param {{base64: string, contentType: string}[]} parts - Части страницы.
     * @param {number} index - Индекс страницы в главе.
     * @returns {object[]} Блоки изображения.
     */
    _toImageBlocks(parts, index) {
        const stamp = Date.now();
        if (parts.length === 1)
            return [{ type: 'image', id: `manga_img_${stamp}_${index}`, data: parts[0], originalIndex: index }];
        return parts.map((part, partIndex) => ({
            type: 'image',
            id: `manga_img_${stamp}_${index}_part${partIndex}`,
            data: part,
            originalIndex: index,
            partIndex,
            totalParts: parts.length
        }));
    }

    /**
     * Загружает все страницы главы (по PAGE_CONCURRENCY одновременно) и приводит
     * их к блокам главы. Страница, не успевшая загрузиться за срок отложенной
     * загрузки, заменяется меткой и догружается в фоне; страница с ошибкой —
     * текстом ошибки. Кэш страниц живёт только в пределах главы. Прогресс
     * сообщается в контекст загрузки (onPageProgress).
     * @param {Array} extracted - Страницы из extractText (используются, если в данных
     * главы нет списка страниц).
     * @param {?{textContent: string}} status - Элемент статуса (устаревший параметр).
     * @param {{chapterMeta?: object, splitLongImages?: boolean, compressionFormat?: string,
     * compressionQuality?: number, imageFit?: ?object}} [opts] - Данные главы и параметры обработки.
     * @returns {Promise<object[]>} Блоки содержимого главы.
     * @throws {NoServiceTabError} Если открытой вкладки сервиса нет.
     */
    async processChapterContent(extracted, status, opts = {}) {
        const fromExtracted = Array.isArray(extracted)
            ? extracted.filter(block => block?.src).map(block => block.src)
            : [];
        const fromMeta = this.extractPages(opts.chapterMeta);
        const pages = fromMeta.length > 0 ? fromMeta : fromExtracted;
        const loadOpts = {
            compressionFormat: opts.compressionFormat || 'image/jpeg',
            compressionQuality: opts.compressionQuality || 0.92,
            imageFit: opts.imageFit || null,
            splitLongImages: opts.splitLongImages !== false
        };

        const cache = new Map();
        const slots = new Array(pages.length);
        let next = 0;
        let done = 0;
        const worker = async () => {
            while (next < pages.length) {
                const index = next;
                next += 1;
                const load = async () => {
                    const parts = await this.loadPage(pages[index], loadOpts, cache);
                    return parts ? this._toImageBlocks(parts, index) : null;
                };
                let blocks = null;
                try {
                    blocks = await this.loadImageOrDefer(index + 1, load);
                } catch (e) {
                    if (isFatal(e)) throw e;
                    createLogger(this.name).warn(`Failed to load page ${index + 1}:`, e);
                }
                slots[index] = blocks || [{ type: 'text', text: `[Ошибка загрузки изображения ${index + 1}]` }];
                done += 1;
                this._reportPages(done, pages.length, status);
            }
        };
        await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, pages.length) }, worker));
        return slots.flat();
    }
}
