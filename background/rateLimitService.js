/**
 * DownloadLib background module
 * The single rate limiter for all extension requests to the services
 * @module background/rateLimitService
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from '../core/BrowserApi.js';
import { DEFAULT_RATE_LIMIT, RATE_LIMIT_STORAGE_KEY, RateLimiter } from '../core/RateLimiter.js';

const SESSION_KEY = 'downloadlib_rate_limiter_state';
const PERSIST_DELAY_MS = 1000;

let persistTimer = null;

/**
 * Единственный ограничитель запросов расширения к сервисам. Окна расширения
 * получают разрешения через сообщения RATE_ACQUIRE (core/RateLimitClient).
 */
const limiter = new RateLimiter({ maxRequestsPerMinute: DEFAULT_RATE_LIMIT, onChange: () => persistSoon() });

/**
 * Откладывает сохранение снимка ограничителя в storage.session, объединяя
 * частые изменения в одну запись.
 * @returns {void}
 */
function persistSoon() {
    if (persistTimer || !extensionApi?.storage?.session) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        Promise.resolve()
            .then(() => extensionApi.storage.session.set({ [SESSION_KEY]: limiter.snapshot() }))
            .catch(e => console.warn('[rateLimitService] Failed to save limiter state:', e?.message || e));
    }, PERSIST_DELAY_MS);
}

/**
 * Восстанавливает состояние ограничителя после перезапуска service worker'а
 * и применяет лимит из настроек.
 * @returns {Promise<void>}
 */
async function init() {
    try {
        const saved = await extensionApi?.storage?.session?.get(SESSION_KEY);
        if (saved?.[SESSION_KEY]) limiter.restore(saved[SESSION_KEY]);
    } catch (e) {
        console.warn('[rateLimitService] Failed to restore limiter state:', e?.message || e);
    }

    try {
        const settings = await extensionApi?.storage?.local?.get(RATE_LIMIT_STORAGE_KEY);
        if (settings?.[RATE_LIMIT_STORAGE_KEY] != null) limiter.setLimit(settings[RATE_LIMIT_STORAGE_KEY]);
    } catch (e) {
        console.warn('[rateLimitService] Failed to read rate limit:', e?.message || e);
    }
}

const ready = init();

if (extensionApi?.storage?.onChanged) {
    extensionApi.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[RATE_LIMIT_STORAGE_KEY])
            limiter.setLimit(changes[RATE_LIMIT_STORAGE_KEY].newValue ?? DEFAULT_RATE_LIMIT);
    });
}

/**
 * Ждёт разрешения на запрос к сервису.
 * @param {string} [serviceKey] - Ключ сервиса.
 * @returns {Promise<void>}
 */
export async function acquire(serviceKey) {
    await ready;
    await limiter.acquire(serviceKey);
}

/**
 * Блокирует запросы всех окон на заданное время (после HTTP 429).
 * @param {number} ms - Длительность блокировки.
 * @returns {Promise<{blockedUntil: number}>} Момент окончания блокировки.
 */
export async function throttle(ms) {
    await ready;
    return { blockedUntil: limiter.throttle(ms) };
}

/**
 * Возвращает статистику ограничителя.
 * @returns {Promise<object>} Результат RateLimiter.getStats().
 */
export async function getStats() {
    await ready;
    return limiter.getStats();
}
