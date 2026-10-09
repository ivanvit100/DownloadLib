/**
 * DownloadLib background module
 * Routes runtime messages from extension pages and service tabs to their handlers
 * and registers the content scripts of the services
 * @module background/MessageRouter
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi, isExtensionUrl } from '../core/BrowserApi.js';
import { MSG, PORT_KEEP_ALIVE } from '../core/messages.js';
import { extractSlug, isServiceHost, serviceConfigs, serviceKeyForUrl } from '../services/hosts.js';
import { getPluginHosts, syncPluginHosts } from './pluginHosts.js';
import * as rateLimitService from './rateLimitService.js';
import * as tokenStore from './tokenStore.js';

console.log('[MessageRouter] Script loading...');

/**
 * Проверяет, что сообщение отправлено страницей самого расширения (popup, окно
 * загрузки, настройки), а не content script'ом.
 * @param {object} sender - Отправитель сообщения.
 * @returns {boolean}
 */
function isExtensionPage(sender) {
    return isExtensionUrl(sender.url);
}

/**
 * Проверяет, что сообщение отправлено из вкладки сайта встроенного сервиса
 * или сервисного плагина.
 * @param {object} sender - Отправитель сообщения.
 * @returns {boolean}
 */
function isServiceTab(sender) {
    return !!sender.tab?.url && isServiceHost(sender.tab.url, getPluginHosts());
}

/**
 * Проверяет, может ли отправитель вызвать обработчик: сообщение пришло от этого
 * расширения и от разрешённого обработчику типа отправителя.
 * @param {{allow: 'extensionPage'|'serviceTab'}} handler - Обработчик.
 * @param {object} sender - Отправитель сообщения.
 * @returns {boolean}
 */
function isAllowed(handler, sender) {
    if (!sender || sender.id !== extensionApi.runtime.id) return false;
    return handler.allow === 'extensionPage' ? isExtensionPage(sender) : isServiceTab(sender);
}

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
 * Переводит результат openPopupWindow в ответ на сообщение.
 * @param {boolean|null} ok - Результат openPopupWindow.
 * @param {string} failure - Текст ошибки, если окно создать не удалось.
 * @returns {{ok: boolean, error?: string}} Ответ.
 */
function windowResponse(ok, failure) {
    if (ok === null) return { ok: false, error: 'No window/tab API available' };
    return ok ? { ok: true } : { ok: false, error: failure };
}

/**
 * Определяет slug тайтла и сервис по URL вкладки-отправителя и открывает окно
 * загрузки. В URL окна передаются только тайтл, сервис, формат и вкладка:
 * остальные параметры загрузки берутся из настроек.
 * @param {{format?: string}} msg - Сообщение с желаемым форматом экспорта.
 * @param {object} sender - Отправитель (вкладка сервиса).
 * @returns {Promise<{ok: boolean, error?: string}>} Ответ.
 */
async function openDownloadWindow(msg, sender) {
    const tabUrl = sender.tab?.url;
    if (!tabUrl) return { ok: false, error: 'No tab URL' };

    const slug = extractSlug(tabUrl);
    const serviceKey = serviceKeyForUrl(tabUrl, getPluginHosts());
    if (!slug || !serviceKey) return { ok: false, error: 'Cannot detect slug or service' };

    const params = new URLSearchParams({ download: 'true', slug, service: serviceKey, format: msg.format || 'fb2' });
    if (sender.tab.id != null) params.set('tabId', String(sender.tab.id));
    const popupUrl = `${extensionApi.runtime.getURL('popup.html')}?${params}`;
    return windowResponse(await openPopupWindow(popupUrl), 'window create');
}

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
 * @returns {Promise<{ok: boolean, swStatus: string, error?: string}>} Ответ.
 */
async function cachePlugin(msg) {
    const { format, code } = msg;
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
        return { ok: true, swStatus };
    } catch (e) {
        console.warn('[MessageRouter] Plugin storage failed:', e.message);
        return { ok: false, error: e.message, swStatus };
    }
}

/**
 * Выполняет код плагина в контексте указанной вкладки через scripting.executeScript.
 * @param {{tabId: number, code: string}} msg - Сообщение с id вкладки и исполняемым кодом.
 * @returns {Promise<{ok: boolean, error?: string}>} Ответ.
 */
async function execPlugin(msg) {
    const { tabId, code } = msg;
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
        return { ok: true };
    } catch (e) {
        console.warn('[MessageRouter] plugin:exec failed:', e.message);
        return { ok: false, error: e.message };
    }
}

/**
 * Обработчики runtime-сообщений по значению поля `action`. `allow` задаёт, кто
 * может вызвать обработчик: 'extensionPage' — страницы расширения, 'serviceTab' —
 * content script'ы на сайтах сервисов и сервисных плагинов. `handle` возвращает
 * ответ (или промис ответа).
 * @type {Object<string, {allow: 'extensionPage'|'serviceTab', handle: function(object, object): *}>}
 */
const handlers = {
    [MSG.GET_AUTH_TOKEN]: {
        allow: 'extensionPage',
        handle: async msg => ({ token: msg.serviceKey ? await tokenStore.getToken(msg.serviceKey) : null })
    },
    [MSG.CACHE_AUTH_TOKEN]: {
        allow: 'extensionPage',
        handle: async msg => {
            if (msg.serviceKey && msg.token && await tokenStore.setToken(msg.serviceKey, msg.token))
                console.log(`[MessageRouter] Cached auth token for ${msg.serviceKey}`);
            return { ok: true };
        }
    },
    [MSG.AUTH_INVALIDATE]: {
        allow: 'extensionPage',
        handle: async msg => {
            if (msg.serviceKey) await tokenStore.invalidate(msg.serviceKey);
            return { ok: true };
        }
    },
    [MSG.RATE_ACQUIRE]: {
        allow: 'extensionPage',
        handle: async msg => {
            await rateLimitService.acquire(msg.serviceKey);
            return { ok: true };
        }
    },
    [MSG.RATE_THROTTLE]: {
        allow: 'extensionPage',
        handle: async msg => ({ ok: true, ...await rateLimitService.throttle(msg.ms) })
    },
    [MSG.OPEN_DOWNLOAD_WINDOW]: { allow: 'serviceTab', handle: openDownloadWindow },
    [MSG.OPEN_WINDOW_WITH_URL]: {
        allow: 'extensionPage',
        handle: async msg => windowResponse(await openPopupWindow(msg.url), 'tab create')
    },
    [MSG.PLUGIN_CACHE]: { allow: 'extensionPage', handle: cachePlugin },
    [MSG.PLUGIN_EXEC]: { allow: 'extensionPage', handle: execPlugin }
};

/**
 * Передаёт сообщение обработчику, если отправителю он разрешён, и отправляет
 * ответ асинхронно. Ошибка обработчика превращается в ответ {ok: false, error}.
 * @param {{action: string}} message - Входящее сообщение.
 * @param {object} sender - Отправитель сообщения.
 * @param {function(*): void} sendResponse - Функция отправки ответа отправителю.
 * @returns {boolean} true, если ответ будет отправлен асинхронно.
 */
function onMessage(message, sender, sendResponse) {
    const handler = Object.hasOwn(handlers, message?.action) ? handlers[message.action] : null;
    if (!handler) return false;
    if (!isAllowed(handler, sender)) {
        console.warn(`[MessageRouter] Rejected "${message.action}" from`, sender?.url);
        sendResponse({ ok: false, error: 'forbidden' });
        return false;
    }

    Promise.resolve()
        .then(() => handler.handle(message, sender))
        .then(sendResponse, e => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
}

if (extensionApi?.runtime?.onMessage) {
    extensionApi.runtime.onMessage.addListener(onMessage);
    console.log('[MessageRouter] Message listener installed');
}

/**
 * Устанавливает слушатель long-lived подключений PORT_KEEP_ALIVE,
 * которые окно загрузки держит открытыми, чтобы service worker не выгружался.
 * @returns {void}
 */
function _installKeepAliveListener() {
    if (!extensionApi?.runtime?.onConnect) return;
    extensionApi.runtime.onConnect.addListener(port => {
        if (port.name !== PORT_KEEP_ALIVE) return;
        port.onMessage.addListener(() => {});
    });
}

_installKeepAliveListener();

const CONTENT_SCRIPTS = [
    '/content/AdCleaner.js',
    '/content/DownloadButton.js'
];
const SERVICE_SCRIPT_ID_PREFIX = 'dl-service-';
const PLUGIN_SCRIPT_ID_PREFIX = 'dl-plugin-';

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
        plugins = await syncPluginHosts();
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
