/**
 * DownloadLib core module
 * Cross-browser API adapter for Firefox and Chromium
 * @module core/BrowserApi
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    /**
     * Оборачивает callback-based метод в промис, преобразуя chrome.runtime.lastError
     * (при его наличии) в отклонение промиса.
     * @param {function} fn - Callback-based функция API (последний аргумент — колбэк результата).
     * @param {object} context - Контекст (this), с которым нужно вызвать fn.
     * @param {Array} args - Аргументы вызова fn (без колбэка).
     * @returns {Promise<*>} Промис, разрешающийся результатом колбэка или отклоняющийся ошибкой.
     */
    function toPromise(fn, context, args) {
        return new Promise((resolve, reject) => {
            try {
                fn.call(context, ...args, (result) => {
                    const err = global.chrome && global.chrome.runtime && global.chrome.runtime.lastError;
                    if (err) {
                        reject(new Error(err.message || String(err)));
                        return;
                    }
                    resolve(result);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Оборачивает callback-based Chrome extension API в promise-based интерфейс,
     * совместимый по форме вызова с нативным WebExtensions API Firefox (browser.*).
     * @param {?object} chromeApi - Глобальный объект chrome, либо null.
     * @returns {?object} Promise-based обёртка над chromeApi (runtime, tabs, windows,
     * downloads, storage.local — с промисифицированными методами; scripting,
     * webRequest, declarativeNetRequest — переданы как есть), либо null, если chromeApi не передан.
     */
    function createChromePromiseApi(chromeApi) {
        if (!chromeApi) return null;

        return {
            runtime: {
                ...chromeApi.runtime,
                sendMessage: (...args) => toPromise(chromeApi.runtime.sendMessage, chromeApi.runtime, args)
            },
            tabs: {
                ...chromeApi.tabs,
                query: (...args) => toPromise(chromeApi.tabs.query, chromeApi.tabs, args)
            },
            windows: {
                ...chromeApi.windows,
                getCurrent: (...args) => toPromise(chromeApi.windows.getCurrent, chromeApi.windows, args),
                create: (...args) => toPromise(chromeApi.windows.create, chromeApi.windows, args),
                update: (...args) => toPromise(chromeApi.windows.update, chromeApi.windows, args)
            },
            downloads: {
                ...chromeApi.downloads,
                download: (...args) => toPromise(chromeApi.downloads.download, chromeApi.downloads, args)
            },
            storage: {
                ...chromeApi.storage,
                local: chromeApi.storage && chromeApi.storage.local ? {
                    ...chromeApi.storage.local,
                    get: (...args) => toPromise(chromeApi.storage.local.get, chromeApi.storage.local, args),
                    set: (...args) => toPromise(chromeApi.storage.local.set, chromeApi.storage.local, args)
                } : void 0
            },
            scripting: chromeApi.scripting,
            webRequest: chromeApi.webRequest,
            declarativeNetRequest: chromeApi.declarativeNetRequest
        };
    }

    /**
     * Определяет доступное расширение-API текущего браузера: нативный browser
     * (Firefox, уже promise-based) или chrome (промисифицируется отдельно).
     * @returns {{api: ?object, nativeName: 'browser'|'chrome'|'none'}} Найденный API
     * и имя нативного пространства имён.
     */
    function resolveNativeApi() {
        if (typeof global.browser !== 'undefined' && global.browser)
            return { api: global.browser, nativeName: 'browser' };
        if (typeof global.chrome !== 'undefined' && global.chrome)
            return { api: createChromePromiseApi(global.chrome), nativeName: 'chrome' };
        return { api: null, nativeName: 'none' };
    }

    /**
     * Определяет характеристики текущего браузерного окружения. Наличие пространства
     * имён browser само по себе не означает Firefox (Chrome тоже его предоставляет) —
     * надёжным признаком служит поддержка chrome.declarativeNetRequest.
     * @param {'browser'|'chrome'|'none'} nativeName - Имя нативного API из resolveNativeApi.
     * @returns {{nativeName: string, isFirefox: boolean, isChromium: boolean, supportsDnr: boolean}}
     * Флаги окружения.
     */
    function resolveEnv(nativeName) {
        const hasChrome = typeof global.chrome !== 'undefined' && !!global.chrome;
        const hasBrowser = typeof global.browser !== 'undefined' && !!global.browser;
        const supportsDnr = !!(hasChrome && global.chrome.declarativeNetRequest);
        const isFirefox = hasBrowser && !supportsDnr;
        const isChromium = hasChrome && !isFirefox;

        return {
            nativeName,
            isFirefox,
            isChromium,
            supportsDnr
        };
    }

    /**
     * Возвращает единый promise-based API расширения для текущего браузера.
     * @returns {?object} Ранее определённый extensionApi, либо null.
     */
    function getExtensionApi() {
        return global.extensionApi || null;
    }

    /**
     * Возвращает характеристики текущего браузерного окружения.
     * @returns {{nativeName: string, isFirefox: boolean, isChromium: boolean, supportsDnr: boolean}}
     * Ранее определённый browserEnv, либо безопасные значения по умолчанию, если он не был вычислен.
     */
    function getBrowserEnv() {
        return global.browserEnv || {
            nativeName: 'none',
            isFirefox: false,
            isChromium: false,
            supportsDnr: false
        };
    }

    const resolved = resolveNativeApi();
    global.extensionApi = resolved.api;
    global.browserEnv = resolveEnv(resolved.nativeName);
    global.getExtensionApi = getExtensionApi;
    global.getBrowserEnv = getBrowserEnv;

    /**
     * Бросается, когда для сервиса не найдено открытой вкладки, через которую можно
     * выполнить запрос в её контексте. В отличие от обычной ошибки одного запроса,
     * означает, что весь пакет запросов (например, все страницы главы) заведомо
     * провалится — вызывающий код должен прервать операцию, а не деградировать постранично.
     */
    class NoServiceTabError extends Error {}

    let _serviceTabId = null;
    let _serviceTabExpiry = 0;

    /**
     * Запоминает id вкладки текущего сервиса на час — используется как приоритетный
     * кандидат для последующих запросов fetchViaTab без повторного tabs.query.
     * @param {number} tabId - id вкладки сервиса.
     * @returns {void}
     */
    function setServiceTab(tabId) {
        _serviceTabId = tabId;
        _serviceTabExpiry = Date.now() + 3600000;
    }

    /**
     * Ищет хосты кастомного плагина, зарегистрированного под указанным ключом сервиса.
     * @param {object} api - Promise-based API расширения.
     * @param {string} serviceKey - Ключ сервиса (или плагина).
     * @returns {Promise<string[]>} Список хостов плагина, либо пустой массив,
     * если плагин не найден, отключён или storage недоступен.
     */
    async function _resolvePluginHosts(api, serviceKey) {
        if (!api?.storage?.local) return [];
        try {
            const result = await api.storage.local.get('custom_plugins');
            const plugin = (result?.custom_plugins || [])
                .find(p => p.service === serviceKey && p.enabled !== false);
            return plugin?.hosts || [];
        } catch {
            return [];
        }
    }

    /**
     * Строит список match-паттернов вкладок для поиска открытой вкладки сервиса.
     * @param {object} api - Promise-based API расширения.
     * @param {string} [serviceKey] - Ключ сервиса ('ranobelib', 'mangalib' или ключ плагина).
     * @returns {Promise<string[]>} Список match-паттернов вида '*://host/*'.
     */
    async function _getTabPatterns(api, serviceKey) {
        if (serviceKey === 'ranobelib') return ['*://ranobelib.me/*'];
        if (!serviceKey || serviceKey === 'mangalib') return ['*://mangalib.me/*', '*://mangalib.org/*'];
        const hosts = await _resolvePluginHosts(api, serviceKey);
        return hosts.map(h => `*://${h}/*`);
    }

    /**
     * Находит id вкладки сервиса для выполнения запроса в её контексте, кэшируя
     * результат на час между вызовами. Общий хелпер для fetchViaTab и requestViaTab.
     * @param {object} api - Promise-based API расширения.
     * @param {string} [serviceKey] - Ключ сервиса, вкладку которого нужно найти.
     * @returns {Promise<?number>} id найденной вкладки, либо null, если не найдена.
     */
    async function _resolveServiceTabId(api, serviceKey) {
        if (_serviceTabId && Date.now() <= _serviceTabExpiry) return _serviceTabId;

        const patterns = await _getTabPatterns(api, serviceKey);
        if (!patterns.length) return null;
        try {
            const tabs = await api.tabs.query({ url: patterns });
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
    async function fetchViaTab(url, serviceKey) {
        const api = getExtensionApi();
        if (!api?.scripting?.executeScript) return null;

        const tabId = await _resolveServiceTabId(api, serviceKey);
        if (!tabId) return null;

        try {
            const results = await api.scripting.executeScript({
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
    async function hasServiceTab(serviceKey) {
        const api = getExtensionApi();
        if (!api?.scripting?.executeScript) return false;
        return !!(await _resolveServiceTabId(api, serviceKey));
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
    async function requestViaTab(url, options, serviceKey) {
        const api = getExtensionApi();
        if (!api?.scripting?.executeScript) return { ok: false, noTab: true };

        const tabId = await _resolveServiceTabId(api, serviceKey);
        if (!tabId) return { ok: false, noTab: true };

        try {
            const results = await api.scripting.executeScript({
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

    global.setServiceTab = setServiceTab;
    global.fetchViaTab = fetchViaTab;
    global.hasServiceTab = hasServiceTab;
    global.requestViaTab = requestViaTab;
    global.NoServiceTabError = NoServiceTabError;

    console.log('[BrowserApi] Loaded:', global.browserEnv.nativeName);
})(typeof window !== 'undefined' ? window : self);
