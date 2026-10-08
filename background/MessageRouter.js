/**
 * DownloadLib background module
 * Routes runtime messages from content scripts and the popup to the appropriate handlers
 * @module background/MessageRouter
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { browserEnv, extensionApi } from '../core/BrowserApi.js';
import { globalRateLimiter } from '../core/RateLimiter.js';
import { extractSlug, serviceConfigs, serviceKeyForUrl } from '../services/hosts.js';
import { authTokens } from './RequestInterceptor.js';

console.log('[MessageRouter] Script loading...');

const isFirefox = !!browserEnv.isFirefox;

/**
 * Хосты сервисов из включённых пользовательских плагинов: ключ сервиса → список хостов.
 * Обновляется _syncPluginServiceHosts при старте и при изменении списка плагинов.
 * @type {Object<string, string[]>}
 */
let pluginServiceHosts = {};

/**
 * Открывает всплывающее окно расширения по заданному URL, используя windows API
 * или, если он недоступен, откатываясь на создание вкладки.
 * @param {string} url - URL страницы, которую нужно открыть.
 * @returns {Promise<boolean|null>} true при успешном создании окна/вкладки, false при неудаче,
 * null — если ни windows, ни tabs API недоступны.
 */
async function openPopupWindow(url) {
    if (extensionApi.windows) {
        const win = await extensionApi.windows.create({
            url, type: 'popup', width: 350, height: 650, focused: true, state: 'normal'
        });
        if (win && win.id) extensionApi.windows.update(win.id, { focused: true });
        return !!win;
    } else if (extensionApi.tabs) {
        const tab = await extensionApi.tabs.create({ url, active: true });
        return !!tab;
    }
    return null;
}

/**
 * Карта обработчиков runtime-сообщений: ключ — значение поля `action` сообщения,
 * значение — функция-обработчик `(msg, sender, respond) => boolean`, возвращающая true
 * для указания, что ответ будет отправлен асинхронно через `respond`.
 * @type {Map<string, function(object, object, function(*): void): boolean>}
 */
const handlers = new Map([
    /**
     * Возвращает сохранённый auth-токен указанного сервиса.
     * @param {{serviceKey?: string}} msg - Сообщение с ключом сервиса.
     * @param {object} _sender - Отправитель сообщения (не используется).
     * @param {function({token: string|null}): void} respond - Функция отправки ответа.
     * @returns {true}
     */
    ['getAuthToken', (msg, _sender, respond) => {
        const token = msg.serviceKey ? (authTokens[msg.serviceKey] || null) : null;
        respond({ token });
        return true;
    }],

    /**
     * Сохраняет auth-токен сервиса в хранилище токенов.
     * @param {{serviceKey?: string, token?: string}} msg - Сообщение с ключом сервиса и токеном.
     * @param {object} _sender - Отправитель сообщения (не используется).
     * @param {function({ok: true}): void} respond - Функция отправки ответа.
     * @returns {true}
     */
    ['cacheAuthToken', (msg, _sender, respond) => {
        if (msg.serviceKey && msg.token) {
            authTokens[msg.serviceKey] = msg.token;
            console.log(`[MessageRouter] Cached auth token for ${msg.serviceKey}`);
        }
        respond({ ok: true });
        return true;
    }],

    /**
     * Устанавливает лимит запросов в минуту для общего rate limiter.
     * @param {{limit: number}} msg - Сообщение с новым значением лимита.
     * @param {object} _sender - Отправитель сообщения (не используется).
     * @param {function({ok: true}): void} respond - Функция отправки ответа.
     * @returns {true}
     */
    ['setRateLimit', (msg, _sender, respond) => {
        globalRateLimiter.setLimit(msg.limit);
        respond({ ok: true });
        return true;
    }],

    /**
     * Возвращает текущую статистику rate limiter'а.
     * @param {object} _msg - Сообщение (не используется).
     * @param {object} _sender - Отправитель сообщения (не используется).
     * @param {function({ok: true, stats: object}): void} respond - Функция отправки ответа.
     * @returns {true}
     */
    ['getRateLimiterStats', (_msg, _sender, respond) => {
        respond({ ok: true, stats: globalRateLimiter.getStats() });
        return true;
    }],

    /**
     * Выполняет fetch с учётом rate limiter'а сервиса, автоматически повторяя запрос
     * с 30-секундной блокировкой при получении статуса 429 (до MAX_RETRIES попыток).
     * @param {{url: string, options?: object}} msg - Сообщение с URL и опциями fetch.
     * @param {object} _sender - Отправитель сообщения (не используется).
     * @param {function({ok: boolean, status?: number, statusText?: string, body?: string,
     * contentType?: string, error?: string}): void} respond - Функция отправки ответа.
     * @returns {true}
     */
    ['fetchWithRateLimit', (msg, _sender, respond) => {
        (async () => {
            try {
                const { url } = msg;
                const fetchOptions = msg.options || {};

                if (!fetchOptions.credentials)
                    fetchOptions.credentials = isFirefox ? 'include' : 'omit';

                const MAX_RETRIES = 4;
                let response;
                for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                    const service = serviceKeyForUrl(url);
                    if (service) await globalRateLimiter.trackRequest(service);
                    response = await fetch(url, fetchOptions);
                    if (response.status !== 429) break;
                    console.warn(`[MessageRouter] fetchWithRateLimit 429 on attempt ${attempt + 1}, throttling 30s...`);
                    globalRateLimiter.throttle(30000);
                    await globalRateLimiter.trackRequest('429-retry');
                }

                if (!response.ok) {
                    respond({ ok: false, status: response.status, statusText: response.statusText });
                    return;
                }

                const text = await response.text();
                respond({ ok: true, status: response.status,
                    body: text, contentType: response.headers.get('content-type') });
            } catch (err) {
                respond({ ok: false, error: String(err) });
            }
        })();
        return true;
    }],

    /**
     * Определяет slug тайтла и сервис по URL вкладки-отправителя и открывает
     * всплывающее окно загрузки (popup.html) с параметрами скачивания.
     * @param {{format?: string}} msg - Сообщение с желаемым форматом экспорта.
     * @param {object} sender - Отправитель сообщения; используется sender.tab.url и sender.tab.id.
     * @param {function({ok: boolean, error?: string}): void} respond - Функция отправки ответа.
     * @returns {true}
     */
    ['openDownloadWindow', (msg, sender, respond) => {
        (async () => {
            try {
                const tabUrl = sender.tab && sender.tab.url;
                if (!tabUrl) { respond({ ok: false, error: 'No tab URL' }); return; }

                const slug = extractSlug(tabUrl);
                const serviceKey = serviceKeyForUrl(tabUrl, pluginServiceHosts);

                if (!slug || !serviceKey) {
                    respond({ ok: false, error: 'Cannot detect slug or service' });
                    return;
                }

                const tabId = sender.tab?.id ?? null;
                const format = encodeURIComponent(msg.format || 'fb2');
                let urlParams = `?download=true&slug=${encodeURIComponent(slug)}&service=${encodeURIComponent(serviceKey)}&format=${format}&rateLimit=85&maxSizeMB=200`;
                if (tabId != null) urlParams += `&tabId=${tabId}`;
                const popupUrl = extensionApi.runtime.getURL('popup.html') + urlParams;

                const ok = await openPopupWindow(popupUrl);
                if (ok === null) respond({ ok: false, error: 'No window/tab API available' });
                else if (!ok) respond({ ok: false, error: 'window create' });
                else respond({ ok: true });
            } catch (e) {
                respond({ ok: false, error: String(e) });
            }
        })();
        return true;
    }],

    /**
     * Открывает всплывающее окно расширения по произвольному URL, переданному в сообщении.
     * @param {{url: string}} msg - Сообщение с URL, который нужно открыть.
     * @param {object} _sender - Отправитель сообщения (не используется).
     * @param {function({ok: boolean, error?: string}): void} respond - Функция отправки ответа.
     * @returns {true}
     */
    ['openWindowWithUrl', (msg, _sender, respond) => {
        (async () => {
            try {
                const ok = await openPopupWindow(msg.url);
                if (ok === null) respond({ ok: false, error: 'No window/tab API available' });
                else if (!ok) respond({ ok: false, error: 'tab create' });
                else respond({ ok: true });
            } catch (e) {
                respond({ ok: false, error: String(e) });
            }
        })();
        return true;
    }]
]);

const _inSWContext = typeof importScripts === 'function';

/**
 * Сохраняет код плагина в IndexedDB.
 * @param {string} format - Ключ формата плагина, под которым сохраняется код.
 * @param {string} code - Исходный код плагина.
 * @returns {Promise<void>} Промис, разрешающийся после успешной записи в хранилище plugins.
 */
function _storePluginInIDB(format, code) {
    return new Promise((res, rej) => {
        const req = indexedDB.open('dl-plugins', 1);
        req.onupgradeneeded = e => e.target.result.createObjectStore('plugins', { keyPath: 'format' });
        req.onsuccess = e => {
            const db = e.target.result;
            const tx = db.transaction('plugins', 'readwrite');
            tx.objectStore('plugins').put({ format, code });
            tx.oncomplete = () => {
                db.close();
                res();
            };

            tx.onerror = ev => {
                db.close();
                rej(ev.target.error);
            };
        };
        req.onerror = ev => rej(ev.target.error);
    });
}

/**
 * Определяет текущий статус service worker'а расширения для диагностики хранения плагинов.
 * @returns {Promise<string>} Один из статусов: 'sw-background' (выполняется внутри SW),
 * 'no-navigator-sw', 'not-registered', 'registered:<state>' или 'error:<message>'.
 */
async function _getSwStatus() {
    if (_inSWContext) return 'sw-background';
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return 'no-navigator-sw';
    try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        if (!reg) return 'not-registered';
        const state = reg.active?.state || reg.installing?.state || reg.waiting?.state || 'unknown';
        return `registered:${state}`;
    } catch (e) {
        return `error:${e.message}`;
    }
}

/**
 * Сохраняет код кастомного плагина: в Cache API внутри service worker'а
 * или в IndexedDB в остальных контекстах.
 * @param {{format: string, code: string}} msg - Сообщение с ключом формата и исходным кодом плагина.
 * @param {object} _sender - Отправитель сообщения (не используется).
 * @param {function({ok: boolean, swStatus: string, error?: string}): void} respond - Функция отправки ответа.
 * @returns {true}
 */
handlers.set('plugin:cache', (msg, _sender, respond) => {
    const { format, code } = msg;
    (async () => {
        const swStatus = await _getSwStatus();
        try {
            if (_inSWContext) {
                const cache = await caches.open('dl-plugins-v1');
                await cache.put(
                    `/plugin-runtime/${format}.js`,
                    new Response(code, { headers: { 'Content-Type': 'text/javascript' } })
                );
            } else await _storePluginInIDB(format, code);
            console.log(`[MessageRouter] Plugin "${format}" stored (${_inSWContext ? 'Cache' : 'IDB'}), SW: ${swStatus}`);
            respond({ ok: true, swStatus });
        } catch (e) {
            console.warn('[MessageRouter] Plugin storage failed:', e.message);
            respond({ ok: false, error: e.message, swStatus });
        }
    })();
    return true;
});

/**
 * Выполняет код плагина в контексте указанной вкладки через scripting.executeScript.
 * @param {{tabId: number, code: string}} msg - Сообщение с id вкладки и исполняемым кодом.
 * @param {object} _sender - Отправитель сообщения (не используется).
 * @param {function({ok: boolean, error?: string}): void} respond - Функция отправки ответа.
 * @returns {true}
 */
handlers.set('plugin:exec', (msg, _sender, respond) => {
    const { tabId, code } = msg;
    (async () => {
        try {
            if (!extensionApi.scripting?.executeScript)
                throw new Error('scripting.executeScript not available');
            if (!tabId)
                throw new Error('No tabId provided');
            await extensionApi.scripting.executeScript({
                target: { tabId },
                func: pluginCode => { (0, eval)(pluginCode); }, // eslint-disable-line no-eval
                args:  [code]
            });
            respond({ ok: true });
        } catch (e) {
            console.warn('[MessageRouter] plugin:exec failed:', e.message);
            respond({ ok: false, error: e.message });
        }
    })();
    return true;
});

if (extensionApi?.runtime?.onMessage) {
    /**
     * Диспетчеризует входящее runtime-сообщение обработчику из карты `handlers`
     * по значению поля `message.action`.
     * @param {{action: string}} message - Входящее сообщение.
     * @param {object} sender - Отправитель сообщения.
     * @param {function(*): void} sendResponse - Функция отправки ответа отправителю.
     * @returns {boolean} Результат вызова найденного обработчика (true — асинхронный ответ),
     * либо false, если обработчик для данного action не зарегистрирован.
     */
    extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        const handler = handlers.get(message.action);
        if (handler) return handler(message, sender, sendResponse);
        return false;
    });

    console.log('[MessageRouter] Message listener installed');
}

/**
 * Устанавливает слушатель long-lived подключений с именем 'downloadKeepAlive',
 * которые popup держит открытыми во время загрузки, чтобы service worker не выгружался.
 * @returns {void}
 */
function _installKeepAliveListener() {
    if (!extensionApi?.runtime?.onConnect) return;
    extensionApi.runtime.onConnect.addListener(port => {
        if (port.name !== 'downloadKeepAlive') return;
        port.onMessage.addListener(() => {});
    });
}

_installKeepAliveListener();

const CONTENT_SCRIPTS = [
    '/content/AdCleaner.js',
    '/content/DownloadButton.js',
    '/content/ImageFetcher.js'
];
const SERVICE_SCRIPT_ID_PREFIX = 'dl-service-';
const PLUGIN_SCRIPT_ID_PREFIX = 'dl-plugin-';

/**
 * Читает включённые пользовательские плагины из storage.local и обновляет
 * карту pluginServiceHosts (сервис -> список хостов).
 * @returns {Promise<object[]>} Список включённых плагинов с непустым списком hosts.
 */
async function _syncPluginServiceHosts() {
    if (!extensionApi?.storage?.local) return [];
    const result = await extensionApi.storage.local.get('custom_plugins');
    const plugins = (result?.custom_plugins || []).filter(
        p => p.enabled !== false && Array.isArray(p.hosts) && p.hosts.length
    );

    pluginServiceHosts = {};
    for (const p of plugins)
        if (p.service) pluginServiceHosts[p.service] = p.hosts;

    return plugins;
}

/**
 * Описывает регистрацию CONTENT_SCRIPTS на сайтах с указанными хостами.
 * @param {string} id - id регистрации.
 * @param {string[]} hosts - Хосты сайтов.
 * @returns {{id: string, matches: string[], js: string[], runAt: string}} Описание для registerContentScripts.
 */
function _contentScript(id, hosts) {
    return { id, matches: hosts.map(h => `https://${h}/*`), js: CONTENT_SCRIPTS, runAt: 'document_idle' };
}

/**
 * Приводит описание регистрации к виду, по которому две регистрации можно сравнить:
 * браузер может вернуть пути скриптов без ведущего слэша и матчи в другом порядке.
 * @param {{matches?: string[], js?: string[], runAt?: string}} script - Описание регистрации.
 * @returns {string} Строковый ключ регистрации.
 */
function _contentScriptKey(script) {
    return JSON.stringify({
        matches: [...(script.matches || [])].sort(),
        js: (script.js || []).map(path => path.replace(/^\//, '')),
        runAt: script.runAt || 'document_idle'
    });
}

/**
 * Синхронизирует зарегистрированные content scripts со встроенными сервисами
 * (по `hosts` их конфигов) и включёнными плагинами. Неизменённые регистрации
 * не трогает, поэтому на сайтах сервисов нет момента без скриптов; устаревшие
 * снимает, новые и изменённые регистрирует по одной, чтобы ошибка в хостах
 * одного плагина не мешала остальным. Если список плагинов прочитать не удалось,
 * регистрации плагинов остаются как есть.
 * @returns {Promise<void>}
 */
async function _syncContentScripts() {
    let plugins = null;
    try {
        plugins = await _syncPluginServiceHosts();
    } catch (e) {
        console.warn('[MessageRouter] Failed to read custom plugins:', e.message);
    }

    if (!extensionApi?.scripting?.registerContentScripts) return;

    const desired = serviceConfigs.map(config => _contentScript(`${SERVICE_SCRIPT_ID_PREFIX}${config.name}`, config.hosts));
    for (const p of plugins || []) {
        const key = p.service || p.format;
        if (key) desired.push(_contentScript(`${PLUGIN_SCRIPT_ID_PREFIX}${key}`, p.hosts));
    }

    try {
        const managed = (await extensionApi.scripting.getRegisteredContentScripts()).filter(s =>
            s.id.startsWith(SERVICE_SCRIPT_ID_PREFIX) || (plugins && s.id.startsWith(PLUGIN_SCRIPT_ID_PREFIX)));
        const desiredKeys = new Map(desired.map(s => [s.id, _contentScriptKey(s)]));
        const upToDate = new Set(managed
            .filter(s => desiredKeys.get(s.id) === _contentScriptKey(s))
            .map(s => s.id));
        const staleIds = managed.map(s => s.id).filter(id => !upToDate.has(id));
        if (staleIds.length) await extensionApi.scripting.unregisterContentScripts({ ids: staleIds });

        for (const script of desired) {
            if (upToDate.has(script.id)) continue;
            try {
                await extensionApi.scripting.registerContentScripts([script]);
                console.log(`[MessageRouter] Registered content scripts: ${script.id}`);
            } catch (e) {
                console.warn(`[MessageRouter] Failed to register content scripts ${script.id}:`, e.message);
            }
        }
    } catch (e) {
        console.warn('[MessageRouter] Failed to sync content scripts:', e.message);
    }
}

if (extensionApi?.storage?.onChanged) {
    /**
     * Реагирует на изменение списка кастомных плагинов в storage.local,
     * повторно синхронизируя зарегистрированные content scripts.
     * @param {object} changes - Объект изменений storage (ключ → {oldValue, newValue}).
     * @param {string} area - Область хранилища ('local', 'sync' и т.д.).
     * @returns {void}
     */
    extensionApi.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.custom_plugins) _syncContentScripts();
    });
}

_syncContentScripts();

console.log('[MessageRouter] Script loaded');
