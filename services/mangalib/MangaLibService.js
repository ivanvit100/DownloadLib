/**
 * DownloadLib service module
 * Module to interact with the MangaLib manga service
 * @module services/mangalib/MangaLibService
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { CdnLibsService } from '../CdnLibsService.js';
import { mangalibConfig } from './config.js';

console.log('[MangaLibService] Loading...');

/**
 * Сервис-парсер сайта MangaLib: страницы глав — изображения с CDN cdnlibs.org.
 * Загрузка, нарезка длинных страниц и сборка блоков главы — в CdnLibsService;
 * здесь только конфиг и запрос главы со «сжатого» сервера изображений.
 */
export class MangaLibService extends CdnLibsService {
    /** Конфиг сервиса; по его `hosts` работает унаследованный `matches`. */
    static config = mangalibConfig;

    /**
     * Создаёт сервис с конфигурацией MangaLib.
     */
    constructor() {
        super(mangalibConfig);
        console.log('[MangaLibService] Instance created');
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
}

console.log('[MangaLibService] Loaded');
