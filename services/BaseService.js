/**
 * DownloadLib service module
 * Base class for manga services
 * @module services/BaseService
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi, requestViaTab } from '../core/BrowserApi.js';
import { globalRateLimiter } from '../core/RateLimiter.js';

/**
 * Базовый класс сервиса-парсера сайта: реализует общий контракт получения
 * метаданных, списка глав и содержимого главы через REST API cdnlibs.org-совместимых
 * сервисов, с retry-логикой при сетевых сбоях и лимите запросов (429).
 * Специфичные для сервиса детали (извлечение текста/страниц, URL изображений,
 * сжатие) переопределяются в подклассах.
 */
export class BaseService {
    /**
     * Создаёт сервис на основе конфигурации (имя, базовый URL, заголовки и т.д.).
     * @param {object} config - Конфигурация сервиса.
     */
    constructor(config) {
        this.config = config;
        this.name = config.name;
        this.baseUrl = config.baseUrl;
        console.log(`[BaseService] Created service: ${this.name}`);
    }

    /**
     * Возвращает promise-based API расширения (общий экземпляр из BrowserApi).
     * @returns {?object} API расширения, либо null, если он недоступен.
     */
    get extensionApi() {
        return extensionApi;
    }

    /**
     * Загружает метаданные тайтла по slug, пробуя последовательно несколько URL
     * (с полями fields из конфигурации, без них, и по числовому id, извлечённому
     * из slug), переходя к следующему при ошибке 403/404.
     * @param {string} slug - Slug тайтла.
     * @returns {Promise<?object>} Разобранный JSON-ответ API, либо null при пустом ответе.
     * @throws {Error} Если все варианты URL вернули ошибку.
     */
    async fetchMangaMetadata(slug) {
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
            console.log(`[${this.name}] Fetching metadata:`, url);
            const response = await this.fetchWithRateLimitRetry(url, {
                method: 'GET',
                headers: this.config.headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });
            if (!response.ok) {
                const text = await response.text();
                if ((response.status === 403 || response.status === 404) && i < urls.length - 1) {
                    console.warn(`[${this.name}] Metadata endpoint rejected (${response.status}), retrying with fallback URL`);
                    continue;
                }
                console.error(`[${this.name}] Error response:`, text);
                throw new Error(`Failed to fetch manga: ${response.status}`);
            }
            const text = await response.text();
            return text ? JSON.parse(text) : null;
        }
        return null;
    }

    /**
     * Загружает список глав тайтла по slug.
     * @param {string} slug - Slug тайтла.
     * @returns {Promise<?object>} Разобранный JSON-ответ API, либо null при пустом ответе.
     * @throws {Error} Если запрос завершился ошибкой.
     */
    async fetchChaptersList(slug) {
        const url = `${this.baseUrl}/api/manga/${slug}/chapters`;
        console.log(`[${this.name}] Fetching chapters:`, url);
        const response = await this.fetchWithRateLimitRetry(url, {
            method: 'GET',
            headers: this.config.headers,
            mode: 'cors',
            credentials: 'include',
            cache: 'no-store'
        });
        if (!response.ok)
            throw new Error(`Failed to fetch chapters: ${response.status}`);
        const text = await response.text();
        return text ? JSON.parse(text) : null;
    }

    /**
     * Загружает данные одной главы тайтла по номеру тома/главы.
     * @param {string} slug - Slug тайтла.
     * @param {*} number - Номер главы.
     * @param {*} [volume='1'] - Номер тома.
     * @param {?number} [branchId] - id ветки перевода.
     * @param {object} [extraParams] - Дополнительные query-параметры запроса.
     * @returns {Promise<?object>} Разобранный JSON-ответ API, либо null при пустом ответе.
     * @throws {Error} Если запрос завершился ошибкой.
     */
    async fetchChapter(slug, number, volume = '1', branchId = null, extraParams = {}) {
        const params = new URLSearchParams();
        if (number != null) params.set('number', String(number));
        else params.set('number', '1');
        params.set('volume', String(volume));
        if (branchId != null) params.set('branch_id', String(branchId));
        for (const [k, v] of Object.entries(extraParams)) params.set(k, String(v));
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
        const text = await response.text();
        return text ? JSON.parse(text) : null;
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
     * Загружает страницу по URL и кодирует её в base64 (базовая реализация без
     * сжатия/подбора сервера — переопределяется подклассами при необходимости).
     * @param {string} url - URL страницы.
     * @param {object} [opts] - Опции fetch.
     * @returns {Promise<string>} data-URL с base64-содержимым страницы.
     */
    async loadPageAsBase64(url, opts = {}) {
        const response = await this.fetchWithRetry(url, opts);
        const blob = await response.blob();
        return this.blobToBase64(blob);
    }

    /**
     * Проверяет контрольную точку прерывания загрузки (пауза/остановка),
     * если сервис привязан к активной загрузке через _gate.
     * @returns {Promise<void>}
     * @throws {Error} С полем aborted=true, если загрузка была остановлена.
     */
    async checkpoint() {
        if (this._gate) await this._gate.checkpoint();
    }

    /**
     * Пауза на заданное время, прерываемая досрочно при остановке загрузки
     * (проверяется каждые 250мс), с финальной проверкой контрольной точки.
     * @param {number} ms - Желаемая длительность паузы в миллисекундах.
     * @returns {Promise<void>}
     * @throws {Error} С полем aborted=true, если загрузка была остановлена во время паузы.
     */
    async interruptibleDelay(ms) {
        if (!this._gate) return this.delay(ms);
        const end = Date.now() + ms;
        while (Date.now() < end) {
            if (this._gate.controller.shouldStop()) break;
            await this.delay(Math.min(250, end - Date.now()));
        }
        await this.checkpoint();
    }

    /**
     * Выполняет запрос в контексте вкладки сервиса (через requestViaTab) —
     * единая точка сетевых запросов для fetchWithRetry/fetchWithRateLimitRetry.
     * Вместо тихого отката на fetch() из контекста расширения с подделанными
     * заголовками, бросает понятную ошибку, если подходящей вкладки сервиса не найдено.
     * @param {string} url - URL запроса.
     * @param {object} opts - Опции fetch (method, headers, body, credentials, mode, cache).
     * @returns {Promise<{ok: boolean, status: number, headers: {get: function(string): ?string},
     * text: function(): Promise<string>}>} Response-подобный объект.
     * @throws {Error} Если подходящей вкладки сервиса не найдено.
     */
    async _doFetch(url, opts) {
        const result = await requestViaTab(url, opts, this.name);
        if (result.noTab)
            throw new Error(`Откройте страницу тайтла на ${this.config.siteUrl}, чтобы продолжить загрузку`);

        return {
            ok: result.ok,
            status: result.status,
            headers: { get: (name) => name.toLowerCase() === 'retry-after' ? (result.retryAfter || null) : null },
            text: () => result.text || ''
        };
    }

    /**
     * Выполняет fetch с повторными попытками при сетевой ошибке (не HTTP-статусе),
     * с линейно растущей задержкой между попытками.
     * @param {string} url - URL запроса.
     * @param {object} opts - Опции fetch.
     * @param {number} [retries=3] - Максимальное число попыток.
     * @returns {Promise<Response>} Ответ fetch.
     * @throws {Error} Если все попытки завершились ошибкой (последняя ошибка пробрасывается).
     */
    async fetchWithRetry(url, opts, retries = 3) {
        for (let i = 0; i < retries; i++) {
            await this.checkpoint();
            try {
                return await this._doFetch(url, opts);
            } catch (e) {
                if (i === retries - 1) throw e;
                await this.interruptibleDelay(1000 * (i + 1));
            }
        }
    }

    /**
     * Выполняет fetch с обработкой HTTP 429: ждёт время из заголовка Retry-After
     * (или 30с по умолчанию), throttle'ит общий rate limiter и уведомляет
     * подписчика _on429, прежде чем повторить запрос.
     * @param {string} url - URL запроса.
     * @param {object} opts - Опции fetch.
     * @param {number} [maxRetries=5] - Максимальное число попыток при 429.
     * @returns {Promise<Response>} Успешный ответ fetch (статус не 429).
     * @throws {Error} Если лимит повторов исчерпан, а сервер всё ещё отвечает 429.
     */
    async fetchWithRateLimitRetry(url, opts, maxRetries = 5) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            await this.checkpoint();
            const response = await this._doFetch(url, opts);
            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('Retry-After'), 10);
                const waitMs = (retryAfter && retryAfter > 0) ? retryAfter * 1000 : 30000;
                console.warn(`[${this.name}] 429 Too Many Requests (attempt ${attempt + 1}/${maxRetries}), waiting ${waitMs}ms...`);
                if (this._on429) this._on429(waitMs);
                globalRateLimiter.throttle(waitMs);
                await this.interruptibleDelay(waitMs);
                continue;
            }
            return response;
        }
        throw new Error(`Rate limited after ${maxRetries} retries (429)`);
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
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Проверяет, относится ли URL к этому сервису. Должен быть переопределён в подклассе.
     * @param {string} _url - Проверяемый URL.
     * @throws {Error} Всегда — метод абстрактный.
     * @returns {boolean}
     */
    static matches(_url) {
        throw new Error(`matches must be implemented for check ${_url}`);
    }
}
