/**
 * DownloadLib core module
 * Network requests made in the context of an open service tab
 * @module core/TabNetwork
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from './BrowserApi.js';
import { createLogger } from './ConsoleLogger.js';
import { RateLimitClient } from './RateLimitClient.js';
import { tabPatterns } from '../services/ServiceHosts.js';

const log = createLogger('TabNetwork');

/** Сколько помнить найденную вкладку сервиса. */
const TAB_CACHE_MS = 3600000;

/**
 * Бросается, когда для сервиса не найдено открытой вкладки, через которую можно
 * выполнить запрос в её контексте. В отличие от обычной ошибки одного запроса,
 * означает, что весь пакет запросов (например, все страницы главы) заведомо
 * провалится — вызывающий код должен прервать операцию, а не деградировать постранично.
 */
export class NoServiceTabError extends Error {}

let _serviceTabId = null;
let _serviceTabExpiry = 0;

/**
 * Запоминает id вкладки текущего сервиса на час — используется как приоритетный
 * кандидат для последующих запросов без повторного tabs.query.
 * @param {number} tabId - id вкладки сервиса.
 * @returns {void}
 */
export function setServiceTab(tabId) {
    _serviceTabId = tabId;
    _serviceTabExpiry = Date.now() + TAB_CACHE_MS;
}

/**
 * Забывает запомненную вкладку, если это указанная вкладка (например, она закрыта).
 * @param {number} tabId - id вкладки.
 * @returns {void}
 */
function forgetServiceTab(tabId) {
    if (_serviceTabId !== tabId) return;
    _serviceTabId = null;
    _serviceTabExpiry = 0;
}

/**
 * Ищет хосты кастомного плагина, зарегистрированного под указанным ключом сервиса.
 * @param {string} serviceKey - Ключ сервиса (или плагина).
 * @returns {Promise<string[]>} Список хостов плагина, либо пустой массив,
 * если плагин не найден, отключён или storage недоступен.
 */
async function _resolvePluginHosts(serviceKey) {
    if (!extensionApi?.storage?.local) return [];
    try {
        const result = await extensionApi.storage.local.get('custom_plugins');
        const plugin = (result?.custom_plugins || [])
            .find(p => p.service === serviceKey && p.enabled !== false);
        return plugin?.hosts || [];
    } catch (e) {
        log.debug(`Failed to read the hosts of plugin ${serviceKey}:`, e);
        return [];
    }
}

/**
 * Строит список match-паттернов вкладок для поиска открытой вкладки сервиса:
 * для встроенного сервиса — по его конфигу, для плагина — по хостам из storage.
 * @param {string} [serviceKey] - Ключ встроенного сервиса или плагина.
 * @returns {Promise<string[]>} Список match-паттернов вида '*://host/*'.
 */
async function _getTabPatterns(serviceKey) {
    const builtin = tabPatterns(serviceKey);
    if (builtin.length || !serviceKey) return builtin;
    return tabPatterns(serviceKey, { [serviceKey]: await _resolvePluginHosts(serviceKey) });
}

/**
 * Находит id вкладки сервиса для выполнения запроса в её контексте, кэшируя
 * результат на час между вызовами.
 * @param {string} [serviceKey] - Ключ сервиса, вкладку которого нужно найти.
 * @returns {Promise<?number>} id найденной вкладки, либо null, если не найдена.
 */
async function _resolveServiceTabId(serviceKey) {
    if (_serviceTabId && Date.now() <= _serviceTabExpiry) return _serviceTabId;

    const patterns = await _getTabPatterns(serviceKey);
    if (!patterns.length) return null;
    try {
        const tabs = await extensionApi.tabs.query({ url: patterns });
        const tabId = tabs?.[0]?.id ?? null;
        if (tabId) setServiceTab(tabId);
        return tabId;
    } catch (e) {
        log.warn('tabs.query failed:', e.message);
        return null;
    }
}

/**
 * Проверяет, есть ли открытая вкладка сервиса, через которую можно выполнить запрос.
 * @param {string} [serviceKey] - Ключ сервиса.
 * @returns {Promise<boolean>} true, если подходящая вкладка найдена.
 */
export async function hasServiceTab(serviceKey) {
    if (!extensionApi?.scripting?.executeScript) return false;
    return !!(await _resolveServiceTabId(serviceKey));
}

/**
 * Выполняет fetch и возвращает тело ответа текстом ('text') или в base64 ('base64').
 * Внедряется во вкладку сервиса через scripting.executeScript и выполняется там,
 * поэтому самодостаточна: не обращается ни к чему вне своего тела. Запрос уходит
 * со страницы сервиса, и браузер сам ставит её cookies, Referer и Origin.
 * @param {string} url - URL запроса.
 * @param {object} init - Опции fetch (method, headers, body, credentials, mode, cache).
 * @param {'text'|'base64'} mode - Как вернуть тело ответа.
 * @returns {Promise<{ok: boolean, status: number, retryAfter?: ?string, text?: string,
 * base64?: string, contentType?: string, error?: string}>} Результат запроса;
 * status 0 означает, что ответа нет (сетевая ошибка, CORS).
 */
export async function tabFetch(url, init, mode) {
    try {
        const response = await fetch(url, init);
        const head = { ok: response.ok, status: response.status, retryAfter: response.headers.get('Retry-After') };
        if (mode !== 'base64') return { ...head, text: await response.text() };
        if (!response.ok) return { ...head, error: `HTTP ${response.status}` };

        const blob = await response.blob();
        const contentType = blob.type || 'image/jpeg';
        return await new Promise(resolve => {
            const reader = new FileReader();
            const fail = reason => resolve({ ...head, ok: false, error: `FileReader: ${reason}` });
            reader.onload = () => resolve({ ...head, base64: String(reader.result).split(',')[1] || '', contentType });
            reader.onerror = () => fail(String(reader.error?.message || reader.error || 'read failed'));
            reader.onabort = () => fail('aborted');
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        return { ok: false, status: 0, error: String(e) };
    }
}

/**
 * Результат запроса, для которого не нашлось вкладки сервиса.
 * @returns {{ok: false, status: 0, noTab: true, error: string}}
 */
function noTabResult() {
    return { ok: false, status: 0, noTab: true, error: 'No service tab' };
}

/**
 * Выполняет запрос во вкладке сервиса. Перед отправкой ждёт разрешения общего
 * ограничителя частоты запросов, поэтому лимит действует на все запросы расширения
 * к сервису из любого окна. Если вкладка, через которую шёл запрос, закрыта,
 * забывает её и один раз повторяет запрос через другую открытую вкладку сервиса.
 * @param {string} url - URL запроса.
 * @param {object} init - Опции fetch.
 * @param {'text'|'base64'} mode - Как вернуть тело ответа (см. tabFetch).
 * @param {string} [serviceKey] - Ключ сервиса, вкладку которого нужно использовать.
 * @param {function(): Promise<void>} [beforeSend] - Вызывается после разрешения
 * ограничителя, прямо перед отправкой; может бросить ошибку, чтобы отменить запрос.
 * @returns {Promise<object>} Результат tabFetch с полем noTab.
 */
async function runInTab(url, init, mode, serviceKey, beforeSend) {
    if (!extensionApi?.scripting?.executeScript) return noTabResult();
    let tabId = await _resolveServiceTabId(serviceKey);
    if (!tabId) return noTabResult();

    await RateLimitClient.acquire(serviceKey);
    if (beforeSend) await beforeSend();

    for (let attempt = 0; ; attempt++) {
        try {
            const results = await extensionApi.scripting.executeScript({
                target: { tabId },
                func: tabFetch,
                args: [url, init || {}, mode]
            });
            const result = results?.[0]?.result;
            return result
                ? { ...result, noTab: false }
                : { ok: false, status: 0, noTab: false, error: 'No result from tab' };
        } catch (e) {
            forgetServiceTab(tabId);
            if (attempt === 0) {
                log.debug(`executeScript failed in tab ${tabId}, looking for another service tab:`, e);
                const nextTabId = await _resolveServiceTabId(serviceKey);
                if (!nextTabId) return noTabResult();
                if (nextTabId !== tabId) {
                    tabId = nextTabId;
                    continue;
                }
            }
            log.warn('executeScript failed:', e);
            return { ok: false, status: 0, noTab: false, error: String(e?.message || e) };
        }
    }
}

/**
 * Загружает ресурс (изображение, обложку) во вкладке сервиса и возвращает его в base64.
 * @param {string} url - URL ресурса.
 * @param {string} [serviceKey] - Ключ сервиса, вкладку которого нужно использовать.
 * @param {{init?: object, beforeSend?: function(): Promise<void>}} [options] - Опции
 * fetch и хук перед отправкой (см. runInTab).
 * @returns {Promise<{ok: boolean, status: number, noTab: boolean, base64?: string,
 * contentType?: string, error?: string}>} Результат; noTab=true означает, что
 * подходящая вкладка не найдена и запрос не выполнялся.
 */
export function fetchViaTab(url, serviceKey, { init, beforeSend } = {}) {
    return runInTab(url, init, 'base64', serviceKey, beforeSend);
}

/**
 * Выполняет запрос (JSON/текстовый API) во вкладке сервиса и возвращает тело текстом.
 * @param {string} url - URL запроса.
 * @param {object} [init] - Опции fetch (method, headers, body, credentials, mode, cache).
 * @param {string} [serviceKey] - Ключ сервиса, вкладку которого нужно использовать.
 * @param {{beforeSend?: function(): Promise<void>}} [options] - Хук перед отправкой (см. runInTab).
 * @returns {Promise<{ok: boolean, status: number, text: string, retryAfter: ?string,
 * noTab: boolean, error?: string}>} Результат; noTab=true означает, что подходящая
 * вкладка не найдена и запрос не выполнялся.
 */
export async function requestViaTab(url, init, serviceKey, { beforeSend } = {}) {
    const result = await runInTab(url, init, 'text', serviceKey, beforeSend);
    return { text: '', retryAfter: null, ...result };
}
