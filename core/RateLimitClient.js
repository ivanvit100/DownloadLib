/**
 * DownloadLib core module
 * Client of the background rate limiter for extension pages
 * @module core/RateLimitClient
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from './BrowserApi.js';
import { MSG } from './messages.js';
import { DEFAULT_RATE_LIMIT, normalizeRateLimit, RATE_LIMIT_STORAGE_KEY } from './RateLimiter.js';

let pending = 0;
let blockedUntil = 0;
let knownLimit = DEFAULT_RATE_LIMIT;

/**
 * Читает значение из localStorage, не падая там, где он недоступен.
 * @param {string} key - Ключ.
 * @returns {?string} Значение, либо null.
 */
function readLocalStorage(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

/**
 * Клиент единственного ограничителя запросов, который живёт в фоне. Каждое окно
 * расширения запрашивает разрешение через него, поэтому лимит общий для всех окон.
 * @namespace RateLimitClient
 */
export const RateLimitClient = {
    /**
     * Ждёт у фона разрешения на запрос к сервису. Если фон недоступен,
     * запрос пропускается без ожидания, чтобы загрузка не зависла.
     * @param {string} [serviceKey='default'] - Ключ сервиса (для статистики фона).
     * @returns {Promise<void>}
     */
    async acquire(serviceKey = 'default') {
        pending += 1;
        try {
            const reply = await extensionApi.runtime.sendMessage({ action: MSG.RATE_ACQUIRE, serviceKey });
            if (!reply?.ok) console.warn('[RateLimitClient] Rate limiter refused the request:', reply?.error);
        } catch (e) {
            console.warn('[RateLimitClient] Background rate limiter unavailable:', e?.message || e);
        } finally {
            pending -= 1;
        }
    },

    /**
     * Блокирует запросы всех окон на заданное время (реакция на HTTP 429).
     * @param {number} [ms=30000] - Длительность блокировки.
     * @returns {void}
     */
    throttle(ms = 30000) {
        blockedUntil = Math.max(blockedUntil, Date.now() + ms);
        Promise.resolve()
            .then(() => extensionApi.runtime.sendMessage({ action: MSG.RATE_THROTTLE, ms }))
            .then(reply => {
                const { blockedUntil: backgroundBlockedUntil = 0 } = reply || {};
                blockedUntil = Math.max(blockedUntil, backgroundBlockedUntil);
            })
            .catch(e => console.warn('[RateLimitClient] Failed to report throttling:', e?.message || e));
    },

    /**
     * Проверяет, придержаны ли сейчас запросы этого окна: есть ожидающие
     * разрешения или действует блокировка после 429.
     * @returns {boolean}
     */
    isHeldBack() {
        return pending > 0 || Date.now() < blockedUntil;
    },

    /**
     * Возвращает статистику этого окна в прежнем формате getStats ограничителя.
     * Общий счётчик запросов хранится в фоне, поэтому здесь он не известен.
     * @returns {{requestsInLastMinute: number, maxRequestsPerMinute: number, queueSize: number,
     * throttled: boolean, timestamps: number[]}} Статистика.
     */
    getStats() {
        return {
            requestsInLastMinute: 0,
            maxRequestsPerMinute: knownLimit,
            queueSize: pending,
            throttled: Date.now() < blockedUntil,
            timestamps: []
        };
    },

    /**
     * Снимает локальную блокировку этого окна.
     * @returns {void}
     */
    reset() {
        blockedUntil = 0;
    },

    /**
     * Возвращает лимит запросов в минуту из настроек (storage.local). Значение,
     * сохранённое прежними версиями в localStorage, при первом чтении переносится
     * в storage.local, чтобы его видел фон.
     * @returns {Promise<number>} Лимит запросов в минуту.
     */
    async getLimit() {
        const storage = extensionApi?.storage?.local;
        let stored = null;
        try {
            stored = (await storage?.get(RATE_LIMIT_STORAGE_KEY))?.[RATE_LIMIT_STORAGE_KEY] ?? null;
        } catch (e) {
            console.warn('[RateLimitClient] Failed to read rate limit:', e?.message || e);
        }

        if (stored == null) {
            const legacy = readLocalStorage(RATE_LIMIT_STORAGE_KEY);
            if (legacy != null) stored = await this.setLimit(legacy);
        }

        knownLimit = normalizeRateLimit(stored ?? DEFAULT_RATE_LIMIT);
        return knownLimit;
    },

    /**
     * Сохраняет лимит запросов в минуту в настройки (storage.local); фон
     * применяет его сразу. Значение из localStorage прежних версий удаляется.
     * @param {number|string} value - Новый лимит.
     * @returns {Promise<number>} Сохранённый лимит (2..200).
     */
    async setLimit(value) {
        const limit = normalizeRateLimit(value);
        knownLimit = limit;
        const storage = extensionApi?.storage?.local;
        if (!storage) return limit;
        try {
            await storage.set({ [RATE_LIMIT_STORAGE_KEY]: limit });
            localStorage.removeItem(RATE_LIMIT_STORAGE_KEY);
        } catch (e) {
            console.warn('[RateLimitClient] Failed to save rate limit:', e?.message || e);
        }
        return limit;
    }
};
