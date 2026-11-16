
/**
 * DownloadLib core module
 * Network requests made in the context of an open service tab
 * @module core/TabNetwork
 * @license MIT
 * @author ivanvit
 * @version 1.1.1
 */

import { extensionApi } from './BrowserApi.js';
import { createLogger } from './ConsoleLogger.js';
import { RateLimitClient } from './RateLimitClient.js';
import { tabPatterns } from '../services/ServiceHosts.js';

const log = createLogger('TabNetwork');

/** Сколько помнить найденную вкладку сервиса. */
const TAB_CACHE_MS = 3600000;

/**
 * Бросается, когда для сервиса не найдено открытой вкладки.
 */
export class NoServiceTabError extends Error {}

let _serviceTabId = null;
let _serviceTabExpiry = 0;

/**
 * Запоминает id вкладки текущего сервиса на час.
 * @param {number} tabId
 */
export function setServiceTab(tabId) {
    _serviceTabId = tabId;
    _serviceTabExpiry = Date.now() + TAB_CACHE_MS;
}

/**
 * Забывает запомненную вкладку.
 * @param {number} tabId
 */
function forgetServiceTab(tabId) {
    if (_serviceTabId !== tabId) return;
    _serviceTabId = null;
    _serviceTabExpiry = 0;
}

/**
 * Ищет хосты кастомного плагина.
 * @param {string} serviceKey
 * @returns {Promise<string[]>}
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
 * Строит список match-паттернов вкладок.
 * @param {string} [serviceKey]
 * @returns {Promise<string[]>}
 */
async function _getTabPatterns(serviceKey) {
    const builtin = tabPatterns(serviceKey);

    if (builtin.length || !serviceKey) return builtin;

    return tabPatterns(
        serviceKey,
        { [serviceKey]: await _resolvePluginHosts(serviceKey) }
    );
}

/**
 * Находит id вкладки сервиса.
 * @param {string} [serviceKey]
 * @returns {Promise<?number>}
 */
async function _resolveServiceTabId(serviceKey) {
    if (_serviceTabId && Date.now() <= _serviceTabExpiry) {
        return _serviceTabId;
    }

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
 * Проверяет, есть ли открытая вкладка сервиса.
 * @param {string} [serviceKey]
 * @returns {Promise<boolean>}
 */
export async function hasServiceTab(serviceKey) {
    if (!extensionApi?.scripting?.executeScript) return false;

    return !!(await _resolveServiceTabId(serviceKey));
}

/**
 * Выполняет fetch в контексте открытой вкладки сервиса.
 *
 * Для api.cdnlibs.org используется credentials: 'omit'.
 * Это необходимо, поскольку API возвращает Access-Control-Allow-Origin: *,
 * а браузер запрещает wildcard при credentials: 'include'.
 *
 * Cookies не отправляются, но обычные прикладные заголовки,
 * включая Authorization, Site-Id и X-DL-Service, сохраняются.
 *
 * @param {string} url
 * @param {object} init
 * @param {'text'|'base64'} mode
 * @returns {Promise<object>}
 */
export async function tabFetch(url, init, mode) {
    try {
        const requestInit = { ...(init || {}) };

        // Для общего API CdnLibs отключаем cookies.
        // Это устраняет конфликт CORS с Access-Control-Allow-Origin: *.
        try {
            const parsedUrl = new URL(url);

            if (parsedUrl.hostname === 'api.cdnlibs.org') {
                requestInit.credentials = 'omit';
            }
        } catch (e) {
            // Если URL некорректен, fetch сам вернёт соответствующую ошибку.
        }

        // Чистим заголовки, которыми должен управлять браузер.
        if (requestInit.headers) {
            const headers = new Headers(requestInit.headers);

            const browserManagedHeaders = new Set([
                'origin',
                'referer',
                'user-agent',
                'connection',
                'host',
                'content-length',
                'cookie'
            ]);

            for (const [name] of headers.entries()) {
                const lowerName = name.toLowerCase();

                if (
                    browserManagedHeaders.has(lowerName) ||
                    lowerName.startsWith('sec-') ||
                    lowerName.startsWith('proxy-')
                ) {
                    headers.delete(name);
                }
            }

            // Для GET и HEAD без тела Content-Type не нужен.
            // Его наличие может провоцировать лишний preflight.
            const method = String(requestInit.method || 'GET').toUpperCase();

            if (
                (method === 'GET' || method === 'HEAD') &&
                requestInit.body == null
            ) {
                headers.delete('Content-Type');
            }

            requestInit.headers = headers;
        }

        const response = await fetch(url, requestInit);

        const head = {
            ok: response.ok,
            status: response.status,
            retryAfter: response.headers.get('Retry-After')
        };

        // Текстовый ответ API.
        if (mode !== 'base64') {
            return {
                ...head,
                text: await response.text()
            };
        }

        // Обработка HTTP-ошибки при загрузке изображения.
        if (!response.ok) {
            return {
                ...head,
                error: `HTTP ${response.status}`
            };
        }

        const blob = await response.blob();
        const contentType = blob.type || 'image/jpeg';

        return await new Promise(resolve => {
            const reader = new FileReader();

            const fail = reason => resolve({
                ...head,
                ok: false,
                error: `FileReader: ${reason}`
            });

            reader.onload = () => resolve({
                ...head,
                base64: String(reader.result).split(',')[1] || '',
                contentType
            });

            reader.onerror = () => fail(
                String(
                    reader.error?.message ||
                    reader.error ||
                    'read failed'
                )
            );

            reader.onabort = () => fail('aborted');

            reader.readAsDataURL(blob);
        });

    } catch (e) {
        return {
            ok: false,
            status: 0,
            error: `${e?.name || 'Error'}: ${e?.message || e}`
        };
    }
}

/**
 * Результат запроса, для которого не нашлось вкладки сервиса.
 * @returns {{ok: false, status: 0, noTab: true, error: string}}
 */
function noTabResult() {
    return {
        ok: false,
        status: 0,
        noTab: true,
        error: 'No service tab'
    };
}

/**
 * Выполняет запрос во вкладке сервиса.
 * @param {string} url
 * @param {object} init
 * @param {'text'|'base64'} mode
 * @param {string} [serviceKey]
 * @param {function(): Promise<void>} [beforeSend]
 * @returns {Promise<object>}
 */
async function runInTab(url, init, mode, serviceKey, beforeSend) {
    if (!extensionApi?.scripting?.executeScript) {
        return noTabResult();
    }

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
                : {
                    ok: false,
                    status: 0,
                    noTab: false,
                    error: 'No result from tab'
                };

        } catch (e) {
            forgetServiceTab(tabId);

            if (attempt === 0) {
                log.debug(
                    `executeScript failed in tab ${tabId}, looking for another service tab:`,
                    e
                );

                const nextTabId = await _resolveServiceTabId(serviceKey);

                if (!nextTabId) return noTabResult();

                if (nextTabId !== tabId) {
                    tabId = nextTabId;
                    continue;
                }
            }

            log.warn('executeScript failed:', e);

            return {
                ok: false,
                status: 0,
                noTab: false,
                error: String(e?.message || e)
            };
        }
    }
}

/**
 * Загружает ресурс (изображение, обложку) в base64.
 * @param {string} url
 * @param {string} [serviceKey]
 * @param {{init?: object, beforeSend?: function(): Promise<void>}} [options]
 * @returns {Promise<object>}
 */
export function fetchViaTab(url, serviceKey, { init, beforeSend } = {}) {
    return runInTab(url, init, 'base64', serviceKey, beforeSend);
}

/**
 * Выполняет запрос JSON/текста API.
 * @param {string} url
 * @param {object} [init]
 * @param {string} [serviceKey]
 * @param {{beforeSend?: function(): Promise<void>}} [options]
 * @returns {Promise<object>}
 */
export async function requestViaTab(
    url,
    init,
    serviceKey,
    { beforeSend } = {}
) {
    const result = await runInTab(
        url,
        init,
        'text',
        serviceKey,
        beforeSend
    );

    return {
        text: '',
        retryAfter: null,
        ...result
    };
}
