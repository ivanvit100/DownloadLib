/**
 * DownloadLib core module
 * Cross-browser API adapter for Firefox and Chromium
 * @module core/BrowserApi
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

/**
 * Promise-based API расширения текущего браузера: нативный browser (Firefox) либо
 * chrome (в MV3 методы chrome.* без колбэка сами возвращают промисы, поэтому
 * отдельная обёртка не нужна).
 * @type {?object}
 */
export const extensionApi = globalThis.browser ?? globalThis.chrome ?? null;

/**
 * Определяет характеристики текущего браузерного окружения. Наличие пространства
 * имён browser само по себе не означает Firefox (Chrome тоже его предоставляет) —
 * признаком служит поддержка chrome.declarativeNetRequest.
 * @returns {{nativeName: 'browser'|'chrome'|'none', isFirefox: boolean,
 * isChromium: boolean, supportsDnr: boolean}} Флаги окружения.
 */
function resolveEnv() {
    const hasChrome = !!globalThis.chrome;
    const hasBrowser = !!globalThis.browser;
    const supportsDnr = !!(hasChrome && globalThis.chrome.declarativeNetRequest);
    const isFirefox = hasBrowser && !supportsDnr;
    const isChromium = hasChrome && !isFirefox;

    let nativeName = 'none';
    if (hasBrowser) nativeName = 'browser';
    else if (hasChrome) nativeName = 'chrome';

    return { nativeName, isFirefox, isChromium, supportsDnr };
}

/**
 * Характеристики текущего браузерного окружения (вычисляются один раз при загрузке).
 * @type {{nativeName: string, isFirefox: boolean, isChromium: boolean, supportsDnr: boolean}}
 */
export const browserEnv = resolveEnv();

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
 * кандидат для последующих запросов fetchViaTab без повторного tabs.query.
 * @param {number} tabId - id вкладки сервиса.
 * @returns {void}
 */
export function setServiceTab(tabId) {
    _serviceTabId = tabId;
    _serviceTabExpiry = Date.now() + 3600000;
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
    } catch {
        return [];
    }
}

/**
 * Строит список match-паттернов вкладок для поиска открытой вкладки сервиса.
 * @param {string} [serviceKey] - Ключ сервиса ('ranobelib', 'mangalib' или ключ плагина).
 * @returns {Promise<string[]>} Список match-паттернов вида '*://host/*'.
 */
async function _getTabPatterns(serviceKey) {
    if (serviceKey === 'ranobelib') return ['*://ranobelib.me/*'];
    if (!serviceKey || serviceKey === 'mangalib') return ['*://mangalib.me/*', '*://mangalib.org/*'];
    const hosts = await _resolvePluginHosts(serviceKey);
    return hosts.map(h => `*://${h}/*`);
}

/**
 * Находит id вкладки сервиса для выполнения запроса в её контексте, кэшируя
 * результат на час между вызовами. Общий хелпер для fetchViaTab и requestViaTab.
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
        if (tabId) {
            _serviceTabId = tabId;
            _serviceTabExpiry = Date.now() + 3600000;
        }
        return tabId;
    } catch (e) {
        console.warn('[BrowserApi] tabs.query failed:', e.message);
        return null;
    }
}

/**
 * Загружает ресурс по URL в контексте вкладки сервиса (в обход CORS и ограничений
 * фонового контекста), кэшируя найденную вкладку сервиса на час между вызовами.
 * @param {string} url - URL ресурса для загрузки.
 * @param {string} [serviceKey] - Ключ сервиса, вкладку которого нужно использовать.
 * @returns {Promise<?{ok: boolean, base64?: string, contentType?: string}>} Результат
 * загрузки в виде base64, либо null, если подходящая вкладка не найдена или запрос не удался.
 */
export async function fetchViaTab(url, serviceKey) {
    if (!extensionApi?.scripting?.executeScript) return null;

    const tabId = await _resolveServiceTabId(serviceKey);
    if (!tabId) return null;

    try {
        const results = await extensionApi.scripting.executeScript({
            target: { tabId },
            /**
             * Инжектируется в контекст вкладки: загружает ресурс по URL и
             * кодирует его в base64.
             * @param {string} imageUrl - URL загружаемого ресурса.
             * @returns {Promise<?{ok: true, base64: string, contentType: string}>}
             * Результат загрузки, либо null при ошибке.
             */
            func: async (imageUrl) => {
                try {
                    const r = await fetch(imageUrl);
                    if (!r.ok) return null;
                    const blob = await r.blob();
                    const contentType = blob.type || 'image/jpeg';
                    return await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve({
                            ok: true,
                            base64: reader.result.split(',')[1],
                            contentType
                        });
                        reader.readAsDataURL(blob);
                    });
                } catch { return null; }
            },
            args: [url]
        });
        return results?.[0]?.result ?? null;
    } catch (e) {
        console.warn('[BrowserApi] fetchViaTab failed:', e.message);
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
 * Выполняет произвольный fetch в контексте вкладки сервиса и возвращает текстовый
 * результат — в отличие от fetchViaTab (бинарные ресурсы как base64), предназначен
 * для JSON/текстовых API-запросов. Запрос реально уходит со страницы сервиса, поэтому
 * браузер сам ставит корректные Referer/Origin — подделывать их не нужно.
 * @param {string} url - URL запроса.
 * @param {object} [options] - Опции fetch (method, headers, body, credentials, mode, cache).
 * @param {string} [serviceKey] - Ключ сервиса, вкладку которого нужно использовать.
 * @returns {Promise<{ok: boolean, status?: number, text?: string, retryAfter?: ?string,
 * noTab?: boolean, error?: string}>} Результат запроса; noTab=true означает, что
 * подходящая вкладка не найдена (и запрос не выполнялся).
 */
export async function requestViaTab(url, options, serviceKey) {
    if (!extensionApi?.scripting?.executeScript) return { ok: false, noTab: true };

    const tabId = await _resolveServiceTabId(serviceKey);
    if (!tabId) return { ok: false, noTab: true };

    try {
        const results = await extensionApi.scripting.executeScript({
            target: { tabId },
            /**
             * Инжектируется в контекст вкладки: выполняет fetch и возвращает текстовое
             * тело ответа вместе со статусом и заголовком Retry-After.
             * @param {string} u - URL запроса.
             * @param {object} opts - Опции fetch.
             * @returns {Promise<{ok: boolean, status: number, text: string, retryAfter: ?string}>}
             * Результат запроса.
             */
            func: async (u, opts) => {
                try {
                    const r = await fetch(u, opts);
                    const text = await r.text();
                    return { ok: r.ok, status: r.status, text, retryAfter: r.headers.get('Retry-After') };
                } catch (e) {
                    return { ok: false, status: 0, text: '', error: String(e) };
                }
            },
            args: [url, options || {}]
        });
        const result = results?.[0]?.result;
        return result ? { ...result, noTab: false } : { ok: false, noTab: false, error: 'No result from tab' };
    } catch (e) {
        console.warn('[BrowserApi] requestViaTab failed:', e.message);
        return { ok: false, noTab: false, error: String(e) };
    }
}

console.log('[BrowserApi] Loaded:', browserEnv.nativeName);
