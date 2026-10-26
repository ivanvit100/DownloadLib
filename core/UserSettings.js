/**
 * DownloadLib core module
 * Keys, defaults and storage of the user settings of extension pages
 * @module core/UserSettings
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { SafeStorage } from './Storage.js';

/** Формат экспорта, выбранный в попапе (копия в storage.local нужна кнопке на сайте). */
export const FORMAT_STORAGE_KEY = 'manga_parser_selected_format';

/** Галочка «Разделять страницы» в попапе. */
export const SPLIT_PAGES_KEY = 'manga_parser_split_pages';

/** Режим ограничения части файла: PART_LIMIT_SIZE или PART_LIMIT_CHAPTERS. */
export const PART_LIMIT_MODE_KEY = 'manga_parser_part_limit_mode';

/** Максимальный размер части файла в мегабайтах. */
export const MAX_SIZE_KEY = 'manga_parser_max_size_mb';

/** Максимальное число глав в части файла. */
export const MAX_CHAPTERS_KEY = 'manga_parser_max_chapters';

/** Режим выбора диапазона: RANGE_MODE_CHAPTERS или RANGE_MODE_VOLUMES. */
export const RANGE_MODE_KEY = 'manga_parser_range_mode';

/** Вписывание изображений FB2 в страницу. */
export const FIT_FB2_IMAGES_KEY = 'manga_parser_fit_fb2_images';

/** Часть файла ограничивается оценочным размером. */
export const PART_LIMIT_SIZE = 'size';

/** Часть файла ограничивается числом глав. */
export const PART_LIMIT_CHAPTERS = 'chapters';

/** Диапазон выбирается по главам. */
export const RANGE_MODE_CHAPTERS = 'chapters';

/** Диапазон выбирается по томам. */
export const RANGE_MODE_VOLUMES = 'volumes';

/** Максимальный размер части файла по умолчанию, МБ. */
export const DEFAULT_MAX_SIZE_MB = 200;

/** Максимальное число глав в части файла по умолчанию. */
export const DEFAULT_MAX_CHAPTERS = 50;

/** Хранилище настроек страниц расширения: localStorage через SafeStorage. */
export const settingsStorage = new SafeStorage();

/**
 * Читает режим ограничения части файла.
 * @returns {'size'|'chapters'} PART_LIMIT_CHAPTERS, если он сохранён, иначе PART_LIMIT_SIZE.
 */
export function readPartLimitMode() {
    return settingsStorage.get(PART_LIMIT_MODE_KEY) === PART_LIMIT_CHAPTERS ? PART_LIMIT_CHAPTERS : PART_LIMIT_SIZE;
}

/**
 * Читает режим выбора диапазона глав.
 * @returns {'chapters'|'volumes'} RANGE_MODE_VOLUMES, если он сохранён, иначе RANGE_MODE_CHAPTERS.
 */
export function readRangeMode() {
    return settingsStorage.get(RANGE_MODE_KEY) === RANGE_MODE_VOLUMES ? RANGE_MODE_VOLUMES : RANGE_MODE_CHAPTERS;
}

/**
 * Читает лимит части файла: по размеру или по числу глав.
 * @returns {{maxSizeMB: number, maxChapters: number}} Лимит размера в мегабайтах и
 * лимит числа глав; maxChapters равен 0, если части ограничиваются по размеру.
 */
export function readPartLimit() {
    const maxSizeMB = parseInt(settingsStorage.get(MAX_SIZE_KEY)) || DEFAULT_MAX_SIZE_MB;
    const maxChapters = readPartLimitMode() === PART_LIMIT_CHAPTERS
        ? parseInt(settingsStorage.get(MAX_CHAPTERS_KEY)) || DEFAULT_MAX_CHAPTERS
        : 0;
    return { maxSizeMB, maxChapters };
}
