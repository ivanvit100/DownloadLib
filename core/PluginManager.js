/**
 * DownloadLib core module
 * Manages user-defined plugin scripts (custom services and exporters)
 * @module core/PluginManager
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { browserEnv, extensionApi } from './BrowserApi.js';
import { MSG } from './messages.js';
import { BaseExporter } from '../exporters/BaseExporter.js';
import { ExporterRegistry } from '../exporters/ExporterRegistry.js';
import { CdnLibsService } from '../services/CdnLibsService.js';
import { matchesHosts } from '../services/hosts.js';
import { serviceRegistry } from '../services/ServiceRegistry.js';

console.log('[PluginManager] Loading...');

const STORAGE_KEY = 'custom_plugins';

/**
 * Читает список сохранённых пользовательских плагинов из storage.local.
 * @returns {Promise<object[]>} Список плагинов, либо пустой массив при ошибке
 * или отсутствии storage API.
 */
async function _storageGet() {
    if (!extensionApi?.storage?.local) return [];
    try {
        const result = await extensionApi.storage.local.get(STORAGE_KEY);
        return (result && result[STORAGE_KEY]) || [];
    } catch (e) {
        console.warn('[PluginManager] Failed to read storage:', e);
        return [];
    }
}

/**
 * Сохраняет список плагинов в storage.local.
 * @param {object[]} plugins - Список плагинов для сохранения.
 * @returns {Promise<void>}
 */
async function _storageSet(plugins) {
    if (!extensionApi?.storage?.local) return;
    await extensionApi.storage.local.set({ [STORAGE_KEY]: plugins });
}

/**
 * Загружает и выполняет внешний скрипт, добавляя тег script в document.head.
 * @param {string} src - URL скрипта (обычно виртуальный путь /plugin-runtime/*.js).
 * @returns {Promise<void>} Промис, разрешающийся после загрузки скрипта
 * (тег удаляется из DOM в обоих случаях), либо отклоняющийся при ошибке загрузки.
 */
function _injectScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
            script.remove();
            resolve();
        };

        script.onerror = () => {
            script.remove();
            reject(new Error(`Failed to load plugin script: ${src}`));
        };
        document.head.appendChild(script);
    });
}

/**
 * Загружает код плагина как ES-модуль через временный Blob URL
 * (запасной способ, если загрузка через service worker недоступна).
 * @param {string} code - Исходный код плагина.
 * @returns {Promise<*>} Промис динамического импорта модуля; Blob URL освобождается
 * после завершения импорта независимо от результата.
 */
function _injectFromBlob(code) {
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    return import(url).finally(() => URL.revokeObjectURL(url));
}

/**
 * Читает код заглушек песочницы (sandbox.js) из пакета расширения, чтобы
 * встроить его в iframe песочницы Firefox.
 * @returns {Promise<string>} Код sandbox.js.
 * @throws {Error} Если файл не удалось прочитать.
 */
async function _sandboxScript() {
    const url = extensionApi?.runtime?.getURL?.('sandbox.js');
    if (!url) throw new Error('Cannot resolve sandbox URL');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load sandbox.js: HTTP ${response.status}`);
    return response.text();
}

/**
 * Создаёт изолированный iframe-песочницу (sandbox="allow-scripts") для безопасного
 * выполнения кода плагина, не зарегистрировавшего свой формат обычным способом.
 * Заглушки BaseService/BaseExporter/ExporterRegistry и протокол sb-* — в sandbox.js:
 * в Chrome iframe загружает sandbox.html из пакета расширения (там разрешён CSP
 * unsafe-eval), в Firefox тот же sandbox.js встраивается в srcdoc. Общение
 * с песочницей идёт через postMessage с сопоставлением ответов по id запроса.
 * @returns {Promise<{exec: function(string): Promise<object>,
 * exportVia: function(string, object, object[], ?string): Promise<object>,
 * destroy: function(): void}>} Объект-хендл песочницы: exec — выполняет код и
 * возвращает зарегистрированные в нём метаданные экспортёра, exportVia — вызывает
 * export() зарегистрированного в песочнице экспортёра, destroy — снимает
 * обработчики и удаляет iframe.
 */
async function _createSandbox() {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;visibility:hidden;pointer-events:none';

    if (browserEnv.isFirefox) {
        const script = (await _sandboxScript()).replace(/<\/script/gi, '<\\/script');
        iframe.srcdoc = `<!DOCTYPE html><html><body><script>${script}<\/script></body></html>`;
    } else {
        const sandboxUrl = extensionApi?.runtime?.getURL?.('sandbox.html');
        if (!sandboxUrl) throw new Error('Cannot resolve sandbox URL');
        iframe.src = sandboxUrl;
    }

    return new Promise((resolve, reject) => {
        const loadTimeout = setTimeout(() => {
            iframe.remove();
            reject(new Error('Sandbox load timeout'));
        }, 5000);

        document.body.appendChild(iframe);
        iframe.addEventListener('load', () => {
            clearTimeout(loadTimeout);
            const pending = new Map();
            let seq = 0;
            const onMsg = e => {
                if (e.source !== iframe.contentWindow) return;
                const m = e.data;
                const p = pending.get(m?._id);
                if (!p) return;
                pending.delete(m._id);
                if (m._t === 'sb-ok') p.resolve(m.c);
                else if (m._t === 'sb-export-ok') p.resolve(m);
                else p.reject(new Error(m.e || 'Sandbox error'));
            };
            window.addEventListener('message', onMsg);
            resolve({
                /**
                 * Выполняет произвольный код внутри песочницы (например,
                 * зависимость вроде jszip или сам код плагина).
                 * @param {string} code - Код для выполнения.
                 * @returns {Promise<object>} Метаданные, зарегистрированные кодом
                 * через ExporterRegistry.register внутри песочницы.
                 */
                exec(code) {
                    return new Promise((res, rej) => {
                        seq += 1;
                        const id = seq;
                        const timer = setTimeout(() => {
                            pending.delete(id);
                            rej(new Error('Sandbox exec timeout'));
                        }, 8000);
                        pending.set(id, {
                            resolve: v => { clearTimeout(timer); res(v); },
                            reject:  err => { clearTimeout(timer); rej(err); }
                        });
                        iframe.contentWindow.postMessage({ _t: 'sb-exec', _id: id, code }, '*');
                    });
                },
                /**
                 * Просит песочницу вызвать export() зарегистрированного в ней
                 * экспортёра формата и вернуть результат.
                 * @param {string} fmt - Формат экспорта, ранее зарегистрированный в песочнице.
                 * @param {object} manga - Нормализованные метаданные тайтла.
                 * @param {object[]} chapters - Содержимое глав для экспорта.
                 * @param {?string} cover - Обложка тайтла в base64.
                 * @returns {Promise<{filename: string, mimeType: string, buf: ArrayBuffer}>}
                 * Результат экспорта, сериализованный через postMessage.
                 */
                exportVia(fmt, manga, chapters, cover) {
                    return new Promise((res, rej) => {
                        seq += 1;
                        const id = seq;
                        const timer = setTimeout(() => {
                            pending.delete(id);
                            rej(new Error('Sandbox export timeout'));
                        }, 120000);
                        pending.set(id, {
                            resolve: v => { clearTimeout(timer); res(v); },
                            reject:  err => { clearTimeout(timer); rej(err); }
                        });
                        iframe.contentWindow.postMessage(
                            { _t: 'sb-export', _id: id, fmt, manga, chapters, cover }, '*');
                    });
                },
                /**
                 * Снимает обработчик сообщений и удаляет iframe песочницы из DOM.
                 * @returns {void}
                 */
                destroy() {
                    window.removeEventListener('message', onMsg);
                    iframe.remove();
                }
            });
        }, { once: true });
    });
}

/**
 * Управляет пользовательскими плагинами расширения: кастомными форматами
 * экспорта и кастомными сервисами (парсерами сайтов). Хранит их метаданные
 * в storage.local и умеет загружать код плагина несколькими способами —
 * через background service worker, Blob-модуль или изолированную песочницу.
 */
export class PluginManager {
    /**
     * Возвращает список всех сохранённых плагинов.
     * @returns {Promise<object[]>} Список плагинов.
     */
    static list() {
        return _storageGet();
    }

    /**
     * Сохраняет плагин: если передан код, извлекает из него метаданные
     * (@dl-format/@dl-service и связанные аннотации) и переопределяет ими
     * поля плагина, затем добавляет или обновляет запись в storage.local
     * и синхронизирует облегчённый кэш форматов/сервисов в localStorage.
     * @param {{id: string, code?: string}} plugin - Данные плагина для сохранения.
     * @returns {Promise<void>}
     */
    static async save(plugin) {
        if (plugin.code) {
            const meta = PluginManager.parseMetadata(plugin.code);
            if (meta.format) {
                plugin.format = meta.format;
                plugin.label  = meta.label || meta.format.toUpperCase();
                delete plugin.service;
                delete plugin.serviceLabel;
                delete plugin.serviceConfig;
            } else if (meta.service) {
                plugin.service      = meta.service;
                plugin.serviceLabel = meta.serviceLabel || meta.service.toUpperCase();
                delete plugin.format;
                delete plugin.label;
                if (meta.serviceConfig)
                    plugin.serviceConfig = { name: meta.service, ...meta.serviceConfig };
            }
            if (meta.hosts?.length) plugin.hosts = meta.hosts;
        }

        const plugins = await _storageGet();
        const idx = plugins.findIndex(p => p.id === plugin.id);
        if (idx >= 0) plugins[idx] = plugin;
        else plugins.push(plugin);
        await _storageSet(plugins);
        PluginManager._syncLocalStorage(plugins);
    }

    /**
     * Удаляет плагин по id из storage.local и синхронизирует облегчённый кэш.
     * @param {string} id - id плагина.
     * @returns {Promise<void>}
     */
    static async remove(id) {
        const plugins = await _storageGet();
        const updated = plugins.filter(p => p.id !== id);
        await _storageSet(updated);
        PluginManager._syncLocalStorage(updated);
    }

    /**
     * Включает или отключает плагин по id.
     * @param {string} id - id плагина.
     * @param {boolean} enabled - Новое состояние включённости.
     * @returns {Promise<void>}
     */
    static async toggle(id, enabled) {
        const plugins = await _storageGet();
        const plugin  = plugins.find(p => p.id === id);
        if (plugin) {
            plugin.enabled = enabled;
            await _storageSet(plugins);
            PluginManager._syncLocalStorage(plugins);
        }
    }

    /**
     * Строит облегчённый кэш включённых форматов/сервисов плагинов в localStorage
     * (синхронно читаемый другими модулями без обращения к storage.local).
     * @param {object[]} plugins - Полный список плагинов.
     * @returns {void}
     */
    static _syncLocalStorage(plugins) {
        try {
            const formats = {};
            const services = {};
            plugins.forEach(p => {
                if (p.format)
                    formats[p.format] = { label: p.label || p.format.toUpperCase(), enabled: p.enabled !== false };
                if (p.service) {
                    services[p.service] = {
                        label: p.serviceLabel || p.service.toUpperCase(),
                        enabled: p.enabled !== false
                    };
                }
            });
            localStorage.setItem('__dl_plugin_formats__', JSON.stringify(formats));
            localStorage.setItem('__dl_plugin_services__', JSON.stringify(services));
        } catch (e) {
            console.warn('[PluginManager] localStorage sync failed:', e);
        }
    }

    /**
     * Генерирует уникальный id нового плагина.
     * @returns {string} Строка вида "plugin_<timestamp>_<random>".
     */
    static generateId() {
        return `plugin_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Извлекает метаданные плагина из doc-комментария в его коде: аннотации
     * @dl-format/@dl-label (плагин формата) либо @dl-service/@dl-service-label/
     * @dl-host (плагин сервиса), а также опциональный JSON-блок @dl-service-config.
     * @param {string} code - Исходный код плагина.
     * @returns {{format: ?string, label: ?string, service: ?string, serviceLabel: ?string,
     * hosts: string[], serviceConfig: ?object}} Извлечённые метаданные плагина.
     */
    static parseMetadata(code) {
        const formatMatch  = code.match(/^\s*\*\s*@dl-format\s+([a-z][a-z0-9_-]*)\s*$/m);
        const labelMatch   = code.match(/^\s*\*\s*@dl-label\s+(.+)/m);
        const serviceMatch = code.match(/^\s*\*\s*@dl-service\s+([a-z][a-z0-9_-]*)\s*$/m);
        const svcLblMatch  = code.match(/^\s*\*\s*@dl-service-label\s+(.+)/m);
        const hostMatches  = [...code.matchAll(/^\s*\*\s*@dl-host\s+([a-z0-9][a-z0-9._-]*)\s*$/gm)];

        let serviceConfig = null;
        const cfgMatch = code.match(/\/\*(?:[^@*]|\*(?!\/))*@dl-service-config((?:[^*]|\*(?!\/))*)\*\//);
        if (cfgMatch) {
            const [, raw] = cfgMatch;
            try {
                serviceConfig = JSON.parse(raw.replace(/^\s*\*\s?/gm, '').trim());
            } catch {}
        }

        return {
            format:       formatMatch?.[1]?.trim().toLowerCase() || null,
            label:        labelMatch?.[1]?.trim() || null,
            service:      serviceMatch?.[1]?.trim().toLowerCase() || null,
            serviceLabel: svcLblMatch?.[1]?.trim() || null,
            hosts:        hostMatches.map(m => m[1].trim().toLowerCase()),
            serviceConfig
        };
    }

    /**
     * Возвращает список форматов экспорта, добавленных включёнными плагинами,
     * в формате, ожидаемом селектором формата в UI.
     * @returns {Promise<{value: string, label: string}[]>} Список опций формата.
     */
    static async getFormats() {
        const plugins = await _storageGet();
        return plugins
            .filter(p => p.enabled !== false && p.format)
            .map(p => ({ value: p.format, label: p.label || p.format.toUpperCase() }));
    }

    /**
     * Пытается загрузить плагин, попросив background-скрипт выполнить его код
     * напрямую в указанной вкладке через scripting.executeScript (самый быстрый
     * способ, доступный когда открыта собственная страница расширения).
     * @param {object} api - API расширения с runtime.sendMessage.
     * @param {number} tabId - id вкладки, в которой нужно выполнить код плагина.
     * @param {{format?: string, code: string}} plugin - Данные плагина.
     * @returns {Promise<boolean>} true при успешной загрузке этим способом.
     */
    static async _tryScriptingExec(api, tabId, plugin) {
        try {
            const res = await api.runtime.sendMessage({
                action: MSG.PLUGIN_EXEC,
                tabId,
                code: plugin.code
            });
            if (res?.ok) {
                console.log(`[PluginManager] Loaded (scripting): ${plugin.name || plugin.format}`);
                return true;
            }
            console.warn(`[PluginManager] scripting exec failed for ${plugin.format}:`, res?.error);
        } catch (e) {
            console.warn(`[PluginManager] scripting exec error for ${plugin.format}:`, e.message);
        }
        return false;
    }

    /**
     * Загружает плагин формата экспорта каскадом запасных способов: кэширует код
     * в background-скрипте (Cache API/IndexedDB), затем пробует подключить его как
     * внешний скрипт с виртуального пути /plugin-runtime/*, затем как Blob-модуль,
     * и в крайнем случае регистрирует прокси-экспортёр, выполняющий код в изолированной
     * песочнице (для случаев, когда прямое выполнение кода в контексте страницы
     * запрещено политикой безопасности).
     * @param {object} api - API расширения с runtime.sendMessage.
     * @param {{service?: string, format?: string, name?: string, serviceLabel?: string,
     * label?: string, code: string}} plugin - Данные плагина.
     * @returns {Promise<void>}
     */
    static async _loadViaSW(api, plugin) {
        const key  = plugin.service || plugin.format;
        const name = plugin.name || plugin.serviceLabel || plugin.label || key;
        try {
            const res = await api.runtime.sendMessage({
                action: MSG.PLUGIN_CACHE,
                format: key,
                code:   plugin.code
            });
            if (!res?.ok)
                console.warn(`[PluginManager] Background cache failed for ${key}:`, res?.error || 'unknown error');
        } catch (e) {
            console.warn(`[PluginManager] Cache request failed for ${key}:`, e.message);
        }

        try {
            await _injectScript(`/plugin-runtime/${key}.js`);
            console.log(`[PluginManager] Loaded (SW): ${name}`);
            return;
        } catch {}

        try {
            await _injectFromBlob(plugin.code);
            console.log(`[PluginManager] Loaded (blob): ${name}`);
            return;
        } catch {}

        if (plugin.format && typeof document !== 'undefined') {
            const { format: fmt, code } = plugin;
            const lbl = plugin.label || fmt.toUpperCase();

            /**
             * Экспортёр-заглушка, регистрируемый в ExporterRegistry вместо плагина,
             * код которого не удалось выполнить напрямую: каждый экспорт запускает
             * изолированную песочницу, выполняет в ней код плагина и делегирует
             * ей фактическое построение файла.
             */
            class FormatSandboxProxy extends BaseExporter {
                /**
                 * Выполняет код плагина в песочнице и делегирует ей экспорт тайтла.
                 * @param {object} manga - Нормализованные метаданные тайтла.
                 * @param {object[]} chapters - Содержимое глав для экспорта.
                 * @param {?string} coverBase64 - Обложка тайтла в base64.
                 * @returns {Promise<{blob: Blob, filename: string, mimeType: string}>}
                 * Результат экспорта.
                 */
                async export(manga, chapters, coverBase64) {
                    let jsZipCode = null;
                    if (extensionApi?.runtime?.getURL) {
                        try {
                            const resp = await fetch(extensionApi.runtime.getURL('lib/jszip.min.js'));
                            if (resp.ok) jsZipCode = await resp.text();
                        } catch {}
                    }
                    const sandbox = await _createSandbox();
                    try {
                        if (jsZipCode) await sandbox.exec(jsZipCode);
                        await sandbox.exec(code);
                        const result = await sandbox.exportVia(fmt, manga, chapters, coverBase64);
                        return {
                            blob: new Blob([result.buf], { type: result.mimeType }),
                            filename: result.filename,
                            mimeType: result.mimeType
                        };
                    } finally {
                        sandbox.destroy();
                    }
                }
            }

            ExporterRegistry.register(fmt, FormatSandboxProxy, { label: lbl });
            console.log(`[PluginManager] Registered sandbox proxy for: ${name}`);
            return;
        }

        console.error(`[PluginManager] All load methods failed for "${name}"`);
    }

    /**
     * Регистрирует в serviceRegistry прокси-сервис для плагина сервиса (кастомного
     * парсера сайта), собирая класс сервиса на основе CdnLibsService и конфигурации
     * плагина (хосты, конфиг сервера изображений и т.д.).
     * @param {{service: string, serviceConfig?: object, hosts?: string[],
     * serviceLabel?: string}} plugin - Данные плагина сервиса.
     * @returns {void}
     */
    static _loadServiceProxy(plugin) {
        const config = plugin.serviceConfig || { name: plugin.service };
        const hosts = plugin.hosts || [];

        /**
         * Сервис, описанный плагином через @dl-service-config: определяет
         * принадлежность URL по хостам плагина, а страницы глав загружает, режет
         * и сжимает так же, как MangaLib (см. CdnLibsService), по полям конфига
         * imagesDomain, imageServers, defaultImageServer, splitLongImages, maxImageHeight.
         */
        class PluginServiceProxy extends CdnLibsService {
            /**
             * Создаёт сервис с конфигурацией плагина.
             */
            constructor() { super(config); }

            /**
             * Проверяет, относится ли URL к одному из хостов плагина.
             * @param {string} url - Проверяемый URL.
             * @returns {boolean} true, если хост URL входит в список хостов плагина
             * (точное совпадение или поддомен).
             */
            static matches(url) {
                return matchesHosts(url, hosts);
            }
        }

        serviceRegistry.register(PluginServiceProxy);
        console.log(`[PluginManager] Loaded (proxy): ${plugin.serviceLabel || plugin.service}`);
    }

    /**
     * Загружает все включённые плагины: сервисные плагины регистрируются как
     * прокси-сервисы напрямую, плагины форматов сначала пробуют выполниться
     * через scripting.executeScript в собственной вкладке расширения, а при
     * неудаче — каскадом запасных способов через _loadViaSW.
     * @returns {Promise<void>}
     */
    static async loadAll() {
        const plugins = await _storageGet();
        const enabled = plugins.filter(p => p.enabled !== false && (p.format || p.service));

        if (enabled.length === 0) {
            console.log('[PluginManager] No plugins to load');
            return;
        }

        console.log(`[PluginManager] Loading ${enabled.length} plugin(s)...`);

        const api = extensionApi;
        if (!api?.runtime?.sendMessage) {
            console.error('[PluginManager] No runtime.sendMessage — cannot load plugins');
            return;
        }

        let ownTabId = null;
        try {
            const tab = await api.tabs.getCurrent();
            const url = tab?.url || '';
            if (tab?.id != null && !url.startsWith('moz-extension://') && !url.startsWith('chrome-extension://'))
                ownTabId = tab.id;
        } catch { console.warn('[PluginManager] Failed to get current tab ID'); }

        for (const plugin of enabled) {
            const isServicePlugin = !!plugin.service && !plugin.format;
            if (isServicePlugin) {
                PluginManager._loadServiceProxy(plugin);
                continue;
            }
            if (ownTabId !== null &&
                await PluginManager._tryScriptingExec(api, ownTabId, plugin))
                continue;
            await PluginManager._loadViaSW(api, plugin);
        }
    }
}

console.log('[PluginManager] Loaded');
