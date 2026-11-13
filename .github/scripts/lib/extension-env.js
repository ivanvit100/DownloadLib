/**
 * DownloadLib CI script
 * Extension API for running the extension code outside the browser: service tabs
 * where injected functions run with a browser-like fetch, messages delivered to the
 * real background listeners, in-memory storage
 * @module .github/scripts/lib/extension-env
 * @license MIT
 * @author ivanvit
 * @version 1.1.1
 */

import { createContext, runInContext } from 'node:vm';

/** id расширения в CI. */
const EXTENSION_ID = 'downloadlib-ci';

/** URL страницы расширения, от имени которой отправляются сообщения фону. */
const EXTENSION_PAGE = `chrome-extension://${EXTENSION_ID}/popup.html`;

/**
 * Web Storage страницы (localStorage, sessionStorage) в памяти.
 */
class MemoryStorage {
    /**
     * Создаёт пустое хранилище.
     */
    constructor() {
        this.items = new Map();
    }

    /**
     * Число записей.
     * @returns {number}
     */
    get length() {
        return this.items.size;
    }

    /**
     * Ключ записи по номеру.
     * @param {number} index - Номер записи.
     * @returns {?string}
     */
    key(index) {
        return [...this.items.keys()][index] ?? null;
    }

    /**
     * Значение по ключу.
     * @param {string} key - Ключ.
     * @returns {?string}
     */
    getItem(key) {
        return this.items.get(String(key)) ?? null;
    }

    /**
     * Сохраняет значение.
     * @param {string} key - Ключ.
     * @param {*} value - Значение (сохраняется строкой).
     * @returns {void}
     */
    setItem(key, value) {
        this.items.set(String(key), String(value));
    }

    /**
     * Удаляет запись.
     * @param {string} key - Ключ.
     * @returns {void}
     */
    removeItem(key) {
        this.items.delete(String(key));
    }

    /**
     * Удаляет все записи.
     * @returns {void}
     */
    clear() {
        this.items.clear();
    }
}

/**
 * FileReader страницы: в Node его нет, а внедрённая функция загрузки изображений
 * читает через него Blob в data-URL.
 */
class DataUrlReader {
    /**
     * Читает Blob в data-URL и вызывает onload, при ошибке вызывает onerror.
     * @param {Blob} blob - Читаемый Blob.
     * @returns {void}
     */
    readAsDataURL(blob) {
        blob.arrayBuffer().then(buffer => {
            this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
            this.onload?.();
        }, error => {
            this.error = error;
            this.onerror?.();
        });
    }
}

/**
 * Область storage.local/storage.session в памяти.
 * @returns {{get: function(*): Promise<object>, set: function(object): Promise<void>,
 * remove: function(*): Promise<void>, clear: function(): Promise<void>}}
 */
function storageArea() {
    const data = new Map();
    return {
        /**
         * Читает записи: все, по ключу, по списку ключей или по объекту ключей со значениями по умолчанию.
         * @param {?(string|string[]|object)} keys - Что читать.
         * @returns {Promise<object>}
         */
        get(keys) {
            if (keys == null) return Promise.resolve(Object.fromEntries(data));
            const defaults = typeof keys === 'string' || Array.isArray(keys)
                ? Object.fromEntries([].concat(keys).filter(key => data.has(key)).map(key => [key, null]))
                : keys;
            return Promise.resolve(Object.fromEntries(Object.entries(defaults).map(([key, fallback]) =>
                [key, data.has(key) ? data.get(key) : fallback])));
        },

        /**
         * Сохраняет записи.
         * @param {object} items - Ключи и значения.
         * @returns {Promise<void>}
         */
        set(items) {
            for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
            return Promise.resolve();
        },

        /**
         * Удаляет записи.
         * @param {string|string[]} keys - Ключи.
         * @returns {Promise<void>}
         */
        remove(keys) {
            [].concat(keys).forEach(key => data.delete(key));
            return Promise.resolve();
        },

        /**
         * Удаляет все записи.
         * @returns {Promise<void>}
         */
        clear() {
            data.clear();
            return Promise.resolve();
        }
    };
}

/**
 * Проверяет URL на соответствие match-паттерну расширения ('*://host/*', 'https://*.host/*').
 * @param {string} pattern - Match-паттерн.
 * @param {string} url - Проверяемый URL.
 * @returns {boolean}
 */
function matchesPattern(pattern, url) {
    const match = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
    if (!match) return false;
    const [, scheme, host, path] = match;
    const target = new URL(url);
    const schemeOk = scheme === '*' ? ['http:', 'https:'].includes(target.protocol) : target.protocol === `${scheme}:`;
    const hostOk = host === '*' || target.hostname === host ||
        (host.startsWith('*.') && (target.hostname === host.slice(2) || target.hostname.endsWith(host.slice(1))));
    const pathRe = new RegExp(`^${path.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    return schemeOk && hostOk && pathRe.test(target.pathname + target.search);
}

/**
 * Доставляет сообщение слушателям runtime.onMessage (фону) так, как его доставил
 * бы браузер со страницы расширения, и ждёт ответа.
 * @param {function[]} listeners - Слушатели runtime.onMessage.
 * @param {object} message - Сообщение.
 * @returns {Promise<*>} Ответ слушателя, либо undefined, если никто не ответил.
 */
function dispatchMessage(listeners, message) {
    const sender = { id: EXTENSION_ID, url: EXTENSION_PAGE };
    return new Promise(resolve => {
        let answered = false;
        let pending = false;
        const respond = value => {
            if (answered) return;
            answered = true;
            resolve(value);
        };
        for (const listener of listeners)
            if (listener(structuredClone(message), sender, respond) === true) pending = true;
        if (!pending) respond();
    });
}

/**
 * Создаёт API расширения для кода расширения в Node: вкладки сервисов открываются
 * через openTab, функции из scripting.executeScript выполняются в отдельном
 * контексте вкладки (как в изолированном мире content script) с её fetch,
 * аргументы и результат проходят через JSON, как в Chrome.
 * @returns {{api: object, openTab: function(string, function): number}} API для
 * globalThis.chrome и открытие вкладки по URL страницы и её fetch, возвращающее id вкладки.
 */
export function createExtensionEnv() {
    const tabs = new Map();
    const listeners = [];

    const api = {
        runtime: {
            id: EXTENSION_ID,
            getURL: path => `chrome-extension://${EXTENSION_ID}/${String(path).replace(/^\//, '')}`,
            sendMessage: message => dispatchMessage(listeners, message),
            onMessage: {
                addListener: listener => listeners.push(listener),
                removeListener: listener => listeners.splice(0, listeners.length,
                    ...listeners.filter(item => item !== listener))
            }
        },
        tabs: {
            /**
             * Открытые вкладки, URL которых подходит под один из match-паттернов.
             * @param {{url?: string|string[]}} [queryInfo] - Паттерны URL.
             * @returns {Promise<{id: number, url: string}[]>}
             */
            query({ url } = {}) {
                const patterns = url == null ? null : [].concat(url);
                return Promise.resolve([...tabs]
                    .filter(([, tab]) => !patterns || patterns.some(pattern => matchesPattern(pattern, tab.url)))
                    .map(([id, tab]) => ({ id, url: tab.url })));
            }
        },
        scripting: {
            /**
             * Выполняет функцию во вкладке по её исходному тексту, как браузер, в контексте вкладки.
             * @param {{target: {tabId: number}, func: function, args?: Array}} injection - Вкладка,
             * функция и её аргументы.
             * @returns {Promise<{frameId: number, result: *}[]>}
             * @throws {Error} Если вкладки нет.
             */
            async executeScript({ target, func, args = [] }) {
                const tab = tabs.get(target?.tabId);
                if (!tab) throw new Error(`No tab with id: ${target?.tabId}`);
                const injected = runInContext(`(${func})`, tab.context);
                const result = (await injected(...JSON.parse(JSON.stringify(args)))) ?? null;
                return [{ frameId: 0, result: JSON.parse(JSON.stringify(result)) }];
            }
        },
        storage: {
            local: storageArea(),
            session: storageArea(),
            onChanged: { addListener() {} }
        }
    };

    return {
        api,

        /**
         * Открывает вкладку сервиса: её функции выполняются в отдельном контексте
         * с fetch этой страницы, пустыми localStorage и sessionStorage.
         * @param {string} url - URL страницы.
         * @param {function} fetch - fetch страницы (см. createBrowserFetch).
         * @returns {number} id вкладки.
         */
        openTab(url, fetch) {
            const id = tabs.size + 1;
            const context = createContext({
                fetch,
                FileReader: DataUrlReader,
                localStorage: new MemoryStorage(),
                sessionStorage: new MemoryStorage(),
                atob,
                btoa
            });
            tabs.set(id, { url, context });
            return id;
        }
    };
}
