/**
 * DownloadLib service module
 * Base class for manga services
 * @module services/BaseService
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { AuthManager } from '../core/AuthManager.js';
import { extensionApi } from '../core/BrowserApi.js';
import { sortChapters } from '../core/chapters.js';
import { blobToDataUrl } from '../core/encoding.js';
import { createLogger } from '../core/logger.js';
import { RateLimitClient } from '../core/RateLimitClient.js';
import { fetchViaTab, NoServiceTabError, requestViaTab } from '../core/TabNetwork.js';
import { matchesHosts } from './hosts.js';

/** Сколько всего попыток даётся запросу при сетевой ошибке или ответе 5xx. */
const MAX_ATTEMPTS = 3;

/** Сколько всего попыток даётся запросу, на который сервер отвечает 429. */
const MAX_RATE_LIMIT_ATTEMPTS = 5;

/** Пауза после ответа 429, если сервер не прислал корректный Retry-After. */
const DEFAULT_RETRY_AFTER_MS = 30000;

/** Шаг нарастающей паузы между повторами после сетевой ошибки или ответа 5xx. */
const RETRY_STEP_MS = 1000;

/**
 * Разбирает заголовок Retry-After: число секунд или HTTP-дата.
 * @param {?string} value - Значение заголовка.
 * @param {number} [now=Date.now()] - Текущее время.
 * @returns {?number} Пауза в миллисекундах, либо null, если значения нет,
 * оно некорректно или не задаёт положительную паузу.
 */
export function parseRetryAfter(value, now = Date.now()) {
    if (value == null) return null;
    const text = String(value).trim();
    const ms = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
    return ms > 0 ? ms : null;
}

/**
 * Возвращает поле data ответа API, а ответ без него — как есть.
 * @param {*} response - Разобранный ответ API.
 * @returns {*} Содержимое ответа.
 */
function unwrapData(response) {
    return response?.data ?? response;
}

/**
 * Проверяет, стоит ли повторить запрос: ответа нет (сетевая ошибка) или ошибка сервера.
 * @param {number} status - HTTP-статус (0 — ответа нет).
 * @returns {boolean}
 */
function isTransient(status) {
    return status === 0 || status >= 500;
}

/**
 * Переводит результат запроса во вкладке в Response-подобный объект прежнего
 * формата fetchWithRetry/fetchWithRateLimitRetry.
 * @param {{ok: boolean, status: number, text?: string, retryAfter?: ?string, error?: string}} result
 * Результат requestViaTab.
 * @returns {{ok: boolean, status: number, error?: string, headers: {get: function(string): ?string},
 * text: function(): string}} Response-подобный объект.
 */
function toResponse(result) {
    return {
        ok: result.ok,
        status: result.status,
        error: result.error,
        headers: { get: name => (name.toLowerCase() === 'retry-after' ? (result.retryAfter || null) : null) },
        text: () => result.text || ''
    };
}

/**
 * Базовый класс сервиса-парсера сайта: реализует общий контракт получения
 * метаданных, списка глав и содержимого главы через REST API cdnlibs.org-совместимых
 * сервисов. Все запросы выполняются во вкладке сервиса через один метод _request
 * с повторами при сетевых сбоях и ответах 5xx и с ожиданием при ответе 429.
 * Специфичные для сервиса детали (извлечение текста/страниц, URL изображений,
 * сжатие) переопределяются в подклассах.
 */
export class BaseService {
    /**
     * Создаёт сервис на основе конфигурации (имя, базовый URL, заголовки и т.д.).
     * Конфиг и его заголовки копируются, поэтому токен авторизации одного экземпляра
     * не попадает в общий объект конфига и в другие экземпляры. Остальные поля
     * конфига остаются теми же объектами.
     * @param {object} config - Конфигурация сервиса.
     */
    constructor(config) {
        this.config = config.headers ? { ...config, headers: { ...config.headers } } : { ...config };
        this.name = config.name;
        this.baseUrl = config.baseUrl;
        this.ctx = null;
        createLogger('BaseService').debug(`Created service: ${this.name}`);
    }

    /**
     * Возвращает promise-based API расширения (общий экземпляр из BrowserApi).
     * @returns {?object} API расширения, либо null, если он недоступен.
     */
    get extensionApi() {
        return extensionApi;
    }

    /**
     * Подставляет токен авторизации в заголовки запросов этого экземпляра
     * (Authorization: Bearer …) или убирает его, если токена нет.
     * @param {?string} token - Токен авторизации.
     * @returns {void}
     */
    setAuthToken(token) {
        const headers = { ...this.config.headers };
        if (token) headers.Authorization = `Bearer ${token}`;
        else delete headers.Authorization;
        this.config.headers = headers;
    }

    /**
     * Привязывает сервис к загрузке: пауза, остановка, отложенная загрузка
     * изображений и колбэки прогресса берутся из её контекста.
     * @param {?import('../core/DownloadContext.js').DownloadContext} ctx - Контекст
     * загрузки, либо null, чтобы отвязать.
     * @returns {BaseService} Этот же сервис.
     */
    attach(ctx) {
        this.ctx = ctx || null;
        return this;
    }

    /**
     * Опции fetch для запросов к API сервиса.
     * @returns {{method: string, headers: object, mode: string, credentials: string, cache: string}}
     */
    _apiInit() {
        return { method: 'GET', headers: this.config.headers, mode: 'cors', credentials: 'include', cache: 'no-store' };
    }

    /**
     * Загружает метаданные тайтла по slug, пробуя последовательно несколько URL
     * (с полями fields из конфигурации, без них, и по числовому id, извлечённому
     * из slug), переходя к следующему при ошибке 403/404.
     * @param {string} slug - Slug тайтла.
     * @returns {Promise<?object>} Разобранный JSON-ответ API ({data: …}).
     * @throws {Error} Если все варианты URL вернули ошибку или ответ не разобрался.
     */
    async fetchMangaMetadata(slug) {
        const what = 'метаданные тайтла';
        const {fields} = this.config;
        const query = Array.isArray(fields) && fields.length
            ? fields.map(f => `fields[]=${f}`).join('&')
            : '';

        const numericIdMatch = /^\d+(?=--)/.exec(slug);
        const numericId = numericIdMatch ? numericIdMatch[0] : null;

        const urls = [];
        if (query) urls.push(`${this.baseUrl}/api/manga/${slug}?${query}`);
        urls.push(`${this.baseUrl}/api/manga/${slug}`);
        if (numericId) urls.push(`${this.baseUrl}/api/manga/${numericId}`);

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            createLogger(this.name).debug('Fetching metadata:', url);
            const response = await this._request(url, { as: 'response', what });
            if (!response.ok) {
                if ((response.status === 403 || response.status === 404) && i < urls.length - 1) {
                    createLogger(this.name)
                        .warn(`Metadata endpoint rejected (${response.status}), retrying with fallback URL`);
                    continue;
                }
                createLogger(this.name).error('Error response:', response.text());
                throw this._httpError(response, what);
            }
            return this._json(response.text(), what);
        }
        return null;
    }

    /**
     * Загружает список глав тайтла по slug.
     * @param {string} slug - Slug тайтла.
     * @returns {Promise<object>} Разобранный JSON-ответ API ({data: […]}).
     * @throws {Error} Если запрос завершился ошибкой или ответ не разобрался.
     */
    async fetchChaptersList(slug) {
        const url = `${this.baseUrl}/api/manga/${slug}/chapters`;
        createLogger(this.name).debug('Fetching chapters:', url);
        return await this._request(url, { what: 'список глав' });
    }

    /**
     * Загружает данные одной главы тайтла по номеру тома/главы.
     * @param {string} slug - Slug тайтла.
     * @param {*} number - Номер главы.
     * @param {*} [volume='1'] - Номер тома.
     * @param {?number} [branchId] - id ветки перевода.
     * @param {object} [extraParams] - Дополнительные query-параметры запроса.
     * @returns {Promise<object>} Разобранный JSON-ответ API ({data: …}).
     * @throws {Error} Если запрос завершился ошибкой или ответ не разобрался.
     */
    async fetchChapter(slug, number, volume = '1', branchId = null, extraParams = {}) {
        const params = new URLSearchParams();
        if (number != null) params.set('number', String(number));
        else params.set('number', '1');
        params.set('volume', String(volume));
        if (branchId != null) params.set('branch_id', String(branchId));
        for (const [k, v] of Object.entries(extraParams)) params.set(k, String(v));
        const url = `${this.baseUrl}/api/manga/${slug}/chapter?${params.toString()}`;
        return await this._request(url, { what: 'глава' });
    }

    /**
     * Метаданные тайтла без обёртки ответа API (содержимое поля data).
     * Вызывает fetchMangaMetadata, поэтому учитывает его переопределение в подклассе.
     * @param {string} slug - Slug тайтла.
     * @returns {Promise<object>} Метаданные тайтла.
     */
    async getManga(slug) {
        return unwrapData(await this.fetchMangaMetadata(slug));
    }

    /**
     * Список глав тайтла без обёртки ответа API. Вызывает fetchChaptersList,
     * поэтому учитывает его переопределение в подклассе.
     * @param {string} slug - Slug тайтла.
     * @returns {Promise<object[]>} Главы в порядке ответа API (пустой массив, если их нет).
     */
    async getChapterList(slug) {
        const chapters = unwrapData(await this.fetchChaptersList(slug));
        return Array.isArray(chapters) ? chapters : [];
    }

    /**
     * Данные главы без обёртки ответа API. Вызывает fetchChapter, поэтому
     * учитывает его переопределение в подклассе.
     * @param {string} slug - Slug тайтла.
     * @param {*} number - Номер главы.
     * @param {*} [volume] - Номер тома.
     * @param {?number} [branchId] - id ветки перевода.
     * @returns {Promise<object>} Данные главы.
     */
    async getChapter(slug, number, volume, branchId) {
        return unwrapData(await this.fetchChapter(slug, number, volume, branchId));
    }

    /**
     * Список глав тайтла в порядке чтения: по тому, затем по номеру главы.
     * Единственное место, где главы сортируются, — им пользуются и выбор
     * диапазона в попапе, и загрузка.
     * @param {string} slug - Slug тайтла.
     * @returns {Promise<object[]>} Отсортированные главы.
     */
    async fetchChapters(slug) {
        return sortChapters(await this.getChapterList(slug));
    }

    /**
     * Загружает главу и превращает её в блоки содержимого для экспортёра:
     * запрос главы, извлечение текста или страниц (extractText) и загрузка
     * изображений (processChapterContent), если сервис их поддерживает.
     * @param {{number: *, volume?: *, branchId?: ?number}} chapter - Глава из списка глав.
     * @param {{slug: string, mangaId?: ?number, splitLongImages?: boolean,
     * imageFit?: ?object}} opts - Slug и id тайтла и параметры обработки изображений.
     * @returns {Promise<Array>} Блоки содержимого главы.
     */
    async fetchChapterBlocks(chapter, { slug, mangaId = null, splitLongImages = false, imageFit = null }) {
        const raw = await this.getChapter(slug, chapter.number, chapter.volume || '1', chapter.branchId ?? null);
        const content = raw?.content || raw;
        const extracted = this.extractText ? this.extractText(content) : content;
        if (!this.processChapterContent) return extracted;
        return this.processChapterContent(extracted, null, {
            chapterMeta: raw,
            chapterObj: chapter,
            mangaSlug: slug,
            mangaId,
            splitLongImages,
            imageFit
        });
    }

    /**
     * Извлекает список страниц главы из первого непустого известного поля ответа API.
     * @param {?object} chapterData - Сырые данные главы от API.
     * @returns {Array} Список страниц, либо пустой массив, если ни одно из
     * известных полей не содержит данных.
     */
    extractPages(chapterData) {
        if (!chapterData) return [];
        const keys = ['pages', 'images', 'pages_list', 'content'];
        for (const key of keys) {
            if (Array.isArray(chapterData[key]) && chapterData[key].length)
                return chapterData[key].slice();
        }
        return [];
    }

    /**
     * Загружает страницу по URL во вкладке сервиса и возвращает её как data-URL
     * (базовая реализация без сжатия/подбора сервера — переопределяется подклассами
     * при необходимости).
     * @param {string} url - URL страницы.
     * @param {object} [opts] - Опции fetch.
     * @returns {Promise<string>} data-URL с base64-содержимым страницы.
     * @throws {NoServiceTabError} Если открытой вкладки сервиса нет.
     * @throws {Error} Если страницу загрузить не удалось.
     */
    async loadPageAsBase64(url, opts = {}) {
        const result = await this.fetchImage(url, { init: opts });
        if (!result.ok) throw new Error(`Не удалось загрузить страницу ${url}: ${result.error || `HTTP ${result.status}`}`);
        return `data:${result.contentType};base64,${result.base64}`;
    }

    /**
     * Загружает изображение во вкладке сервиса (с общим ограничителем частоты
     * запросов). Проверяет контрольную точку загрузки до запроса, после разрешения
     * ограничителя и после ответа, чтобы остановка срабатывала как можно быстрее.
     * @param {string} url - URL изображения.
     * @param {{init?: object}} [options] - Опции fetch.
     * @returns {Promise<{ok: boolean, status: number, base64?: string, contentType?: string,
     * error?: string}>} Результат загрузки; при неудаче — ok:false с причиной.
     * @throws {NoServiceTabError} Если открытой вкладки сервиса нет: без неё не
     * загрузится ни одно изображение, и загрузку нужно прервать целиком.
     */
    async fetchImage(url, { init } = {}) {
        await this.checkpoint();
        const result = await fetchViaTab(url, this.name, { init, beforeSend: () => this.checkpoint() });
        if (result.noTab) throw this._noTabError();
        await this.checkpoint();
        return result;
    }

    /**
     * Загружает изображение, не задерживая главу дольше срока отложенной загрузки
     * текущей загрузки (см. DownloadContext.loadImageOrDefer). Вне загрузки просто
     * выполняет load().
     * @param {string|number} label - Подпись изображения (обычно номер страницы).
     * @param {function(): Promise<?object[]>} load - Загрузка изображения: блоки, либо null.
     * @returns {Promise<?object[]>} Блоки изображения, null при ошибке, либо [метка].
     */
    loadImageOrDefer(label, load) {
        return this.ctx ? this.ctx.loadImageOrDefer(label, load) : Promise.resolve().then(load);
    }

    /**
     * Сообщает прогресс загрузки страниц главы: в контекст загрузки и, для старых
     * вызовов processChapterContent с элементом статуса, — в этот элемент.
     * @param {number} done - Загружено страниц.
     * @param {number} total - Всего страниц.
     * @param {?{textContent: string}} [status] - Элемент статуса (устаревший параметр).
     * @returns {void}
     */
    _reportPages(done, total, status) {
        this.ctx?.onPageProgress(done, total);
        if (status) status.textContent = `Загружено страниц: ${done}/${total}`;
    }

    /**
     * Проверяет контрольную точку прерывания загрузки (пауза/остановка),
     * если сервис привязан к загрузке (attach).
     * @returns {Promise<void>}
     * @throws {Error} С полем aborted=true, если загрузка была остановлена.
     */
    async checkpoint() {
        if (this.ctx) await this.ctx.checkpoint();
    }

    /**
     * Пауза на заданное время, прерываемая досрочно при остановке загрузки
     * (проверяется каждые 250мс), с финальной проверкой контрольной точки.
     * @param {number} ms - Желаемая длительность паузы в миллисекундах.
     * @returns {Promise<void>}
     * @throws {Error} С полем aborted=true, если загрузка была остановлена во время паузы.
     */
    async interruptibleDelay(ms) {
        if (!this.ctx) return this.delay(ms);
        const end = Date.now() + ms;
        while (Date.now() < end) {
            if (this.ctx.controller.shouldStop()) break;
            await this.delay(Math.min(250, end - Date.now()));
        }
        await this.checkpoint();
    }

    /**
     * Ошибка «нет открытой вкладки сервиса».
     * @returns {NoServiceTabError}
     */
    _noTabError() {
        return new NoServiceTabError(`Откройте страницу тайтла на ${this.config.siteUrl || 'сайте сервиса'}, чтобы продолжить загрузку`);
    }

    /**
     * Понятная ошибка неудачного ответа API.
     * @param {{status: number, error?: string}} response - Неудачный ответ.
     * @param {string} what - Что запрашивалось (для текста ошибки).
     * @returns {Error}
     */
    _httpError(response, what) {
        if (response.status === 0)
            return new Error(`Сетевая ошибка при запросе к API (${what}): ${response.error || 'нет ответа'}`);
        if (response.status === 401)
            return new Error(`Сервер отклонил авторизацию (${what}): войдите на ${this.config.siteUrl || 'сайт сервиса'} и повторите`);
        return new Error(`Ошибка API (${what}): HTTP ${response.status}`);
    }

    /**
     * Разбирает JSON-ответ API.
     * @param {string} text - Тело ответа.
     * @param {string} what - Что запрашивалось (для текста ошибки).
     * @returns {*} Разобранный ответ.
     * @throws {Error} Если тело пустое или это не JSON.
     */
    _json(text, what) {
        const message = `Ошибка разбора ответа API (${what})`;
        if (!text) throw new Error(message);
        try {
            return JSON.parse(text);
        } catch (e) {
            throw new Error(message, { cause: e });
        }
    }

    /**
     * Единая точка сетевых запросов сервиса. Выполняет запрос во вкладке сервиса
     * (с учётом общего ограничителя частоты запросов) и:
     * - при сетевой ошибке или ответе 5xx повторяет его с нарастающей паузой;
     * - при ответе 429 ждёт Retry-After (секунды или HTTP-дата, по умолчанию 30 с),
     *   останавливает запросы всех окон и повторяет;
     * - при ответе 401 убирает токен из заголовков этого экземпляра и удаляет
     *   сохранённый в фоне токен сервиса.
     * @param {string} url - URL запроса.
     * @param {{as?: 'json'|'text'|'response', what?: string, init?: object,
     * attempts?: number, rateLimitAttempts?: number}} [options] - Что вернуть
     * (разобранный JSON, текст или Response-подобный объект без проверки статуса),
     * что запрашивается (для текста ошибок), опции fetch и число попыток.
     * @returns {Promise<*>} Ответ в запрошенном виде.
     * @throws {NoServiceTabError} Если открытой вкладки сервиса нет.
     * @throws {Error} Если сервер так и не перестал отвечать 429; для 'json' и 'text' —
     * также при неудачном ответе и (для 'json') ошибке разбора.
     */
    async _request(url, {
        as = 'json', what = 'запрос', init = this._apiInit(),
        attempts = MAX_ATTEMPTS, rateLimitAttempts = MAX_RATE_LIMIT_ATTEMPTS
    } = {}) {
        let failures = 0;
        let rateLimited = 0;
        for (;;) {
            await this.checkpoint();
            const result = await requestViaTab(url, init, this.name, { beforeSend: () => this.checkpoint() });
            if (result.noTab) throw this._noTabError();

            if (result.status === 429) {
                rateLimited += 1;
                if (rateLimited >= rateLimitAttempts) throw new Error(`Rate limited after ${rateLimitAttempts} retries (429)`);
                const waitMs = parseRetryAfter(result.retryAfter) ?? DEFAULT_RETRY_AFTER_MS;
                createLogger(this.name)
                    .warn(`429 Too Many Requests (attempt ${rateLimited}/${rateLimitAttempts}), waiting ${waitMs}ms...`);
                this.ctx?.on429(waitMs);
                RateLimitClient.throttle(waitMs);
                await this.interruptibleDelay(waitMs);
                continue;
            }

            if (isTransient(result.status) && failures + 1 < attempts) {
                failures += 1;
                const waitMs = RETRY_STEP_MS * failures;
                createLogger(this.name)
                    .warn(`Request failed (${result.status || result.error}), retry ${failures}/${attempts - 1} in ${waitMs}ms`);
                await this.interruptibleDelay(waitMs);
                continue;
            }

            if (result.status === 401) {
                this.setAuthToken(null);
                await AuthManager.invalidate(this.name);
            }
            if (as === 'response') return toResponse(result);
            if (!result.ok) throw this._httpError(result, what);
            return as === 'text' ? result.text : this._json(result.text, what);
        }
    }

    /**
     * Выполняет запрос с повторами при сетевой ошибке и ответе 5xx и с ожиданием
     * при ответе 429. Обёртка над _request, сохранённая для плагинов.
     * @param {string} url - URL запроса.
     * @param {object} opts - Опции fetch.
     * @param {number} [retries=3] - Максимальное число попыток при сетевой ошибке и 5xx.
     * @returns {Promise<{ok: boolean, status: number, headers: {get: function(string): ?string},
     * text: function(): string}>} Response-подобный объект (статус не проверяется).
     */
    fetchWithRetry(url, opts, retries = MAX_ATTEMPTS) {
        return this._request(url, { as: 'response', init: opts, attempts: retries });
    }

    /**
     * Выполняет запрос с ожиданием при ответе 429 и повторами при сетевой ошибке
     * и ответе 5xx. Обёртка над _request, сохранённая для плагинов.
     * @param {string} url - URL запроса.
     * @param {object} opts - Опции fetch.
     * @param {number} [maxRetries=5] - Максимальное число попыток при ответе 429.
     * @returns {Promise<{ok: boolean, status: number, headers: {get: function(string): ?string},
     * text: function(): string}>} Response-подобный объект (статус не 429, не проверяется).
     * @throws {Error} Если лимит попыток исчерпан, а сервер всё ещё отвечает 429.
     */
    fetchWithRateLimitRetry(url, opts, maxRetries = MAX_RATE_LIMIT_ATTEMPTS) {
        return this._request(url, { as: 'response', init: opts, rateLimitAttempts: maxRetries });
    }

    /**
     * Пауза на заданное число миллисекунд.
     * @param {number} ms - Длительность паузы в миллисекундах.
     * @returns {Promise<void>}
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Кодирует Blob в data-URL с base64-содержимым.
     * @param {Blob} blob - Исходный Blob.
     * @returns {Promise<string>} data-URL с base64-содержимым.
     */
    blobToBase64(blob) {
        return blobToDataUrl(blob);
    }

    /**
     * Проверяет, относится ли URL к сайту сервиса: его хост совпадает с одним из
     * `hosts` статического конфига класса (`static config`) или является поддоменом.
     * Подкласс без статического конфига должен переопределить метод.
     * @param {string} url - Проверяемый URL.
     * @returns {boolean} true, если URL относится к сайту сервиса.
     */
    static matches(url) {
        return matchesHosts(url, this.config?.hosts);
    }
}
