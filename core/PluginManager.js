/**
 * DownloadLib core module
 * Manages user-defined plugin scripts (custom services and exporters)
 * @module core/PluginManager
 * @license MIT
 * @author ivanvit
 * @version 1.0.9
 */

'use strict';

(function(global) {
    console.log('[PluginManager] Loading...');

    const STORAGE_KEY = 'custom_plugins';

    /**
     * Возвращает доступный API расширения (promise-based, либо нативный browser/chrome).
     * @returns {?object} API расширения, либо null, если ни один вариант недоступен.
     */
    function _getApi() {
        return typeof global.getExtensionApi === 'function'
            ? global.getExtensionApi()
            : ((typeof global.browser !== 'undefined' && global.browser) ||
               (typeof global.chrome !== 'undefined' && global.chrome) ||
               null);
    }

    /**
     * Читает список сохранённых пользовательских плагинов из storage.local.
     * @returns {Promise<object[]>} Список плагинов, либо пустой массив при ошибке
     * или отсутствии storage API.
     */
    async function _storageGet() {
        const api = _getApi();
        if (!api?.storage?.local) return [];
        try {
            const result = await api.storage.local.get(STORAGE_KEY);
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
        const api = _getApi();
        if (!api?.storage?.local) return;
        await api.storage.local.set({ [STORAGE_KEY]: plugins });
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
     * Создаёт изолированный iframe-песочницу (sandbox="allow-scripts") для безопасного
     * выполнения кода плагина, не зарегистрировавшего свой формат обычным способом.
     * В Firefox песочница строится из инлайн-скрипта (srcdoc) с минимальными заглушками
     * BaseService/BaseExporter/ExporterRegistry, в Chrome — загружается sandbox.html
     * из пакета расширения (там разрешён CSP unsafe-eval). Общение с песочницей идёт
     * через postMessage с сопоставлением ответов по числовому id запроса.
     * @returns {Promise<{exec: function(string): Promise<object>,
     * exportVia: function(string, object, object[], ?string): Promise<object>,
     * destroy: function(): void}>} Объект-хендл песочницы: exec — выполняет код и
     * возвращает зарегистрированные в нём метаданные экспортёра, exportVia — вызывает
     * export() зарегистрированного в песочнице экспортёра, destroy — снимает
     * обработчики и удаляет iframe.
     */
    function _createSandbox() {
        return new Promise((resolve, reject) => {
            const iframe = document.createElement('iframe');
            iframe.setAttribute('sandbox', 'allow-scripts');
            iframe.style.cssText = 'position:fixed;width:0;height:0;border:none;visibility:hidden;pointer-events:none';

            const env = typeof global.getBrowserEnv === 'function' ? global.getBrowserEnv() : {};
            if (env.isFirefox) {
                const innerScript = [
                    '"use strict";',
                    'var _cap={};var _reg={};var global=window;',
                    'global.BaseService=function(c){this.config=c;this.name=c&&c.name;};',
                    'global.BaseExporter=function(){this.format="unknown";};',
                    'global.BaseExporter.prototype.escapeXml=function(s){',
                    '  if(!s)return"";',
                    '  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")',
                    '    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&apos;");',
                    '};',
                    'global.BaseExporter.prototype.escapeHtml=function(s){',
                    '  if(!s)return"";',
                    '  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")',
                    '    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;");',
                    '};',
                    'global.BaseExporter.prototype.sanitizeText=function(t){if(!t)return"";return String(t).trim();};',
                    'global.ExporterRegistry={',
                    '  register:function(fmt,Cls,meta){_cap.format=fmt;',
                    '    _reg[String(fmt).toLowerCase()]={Cls:Cls,meta:meta||{}};},',
                    '};',
                    'window.addEventListener("message",function(e){',
                    '  var m=e.data;if(!m||!m._t)return;',
                    '  if(m._t==="sb-exec"){',
                    '    _cap={};',
                    '    try{(new Function(m.code))();e.source.postMessage({_t:"sb-ok",_id:m._id,c:_cap},"*");}',
                    '    catch(err){e.source.postMessage({_t:"sb-err",_id:m._id,e:err.message},"*");}',
                    '  } else if(m._t==="sb-export"){',
                    '    (async function(){',
                    '      try{',
                    '        var entry=_reg[String(m.fmt).toLowerCase()];',
                    '        if(!entry)throw new Error("Format not registered in sandbox: "+m.fmt);',
                    '        var inst=new entry.Cls();',
                    '        var result=await inst.export(m.manga,m.chapters,m.cover);',
                    '        var buf=await result.blob.arrayBuffer();',
                    '        var pl={_t:"sb-export-ok",_id:m._id,buf:buf,',
                    '          filename:result.filename,mimeType:result.mimeType};',
                    '        e.source.postMessage(pl,"*",[buf]);',
                    '      }catch(ex){e.source.postMessage({_t:"sb-err",_id:m._id,e:ex.message},"*");}',
                    '    })();',
                    '  }',
                    '});'
                ].join('');
                iframe.srcdoc = `<!DOCTYPE html><html><body><script>${innerScript}<\/script></body></html>`;
            } else {
                const api = _getApi();
                const sandboxUrl = api?.runtime?.getURL?.('sandbox.html');
                if (!sandboxUrl) {
                    reject(new Error('Cannot resolve sandbox URL'));
                    return;
                }
                iframe.src = sandboxUrl;
            }

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
    class PluginManager {
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
                    action: 'plugin:exec',
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
                    action: 'plugin:cache',
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

            if (plugin.format && typeof document !== 'undefined'
                    && global.BaseExporter && global.ExporterRegistry) {
                const { format: fmt, code } = plugin;
                const lbl = plugin.label || fmt.toUpperCase();

                /**
                 * Экспортёр-заглушка, регистрируемый в ExporterRegistry вместо плагина,
                 * код которого не удалось выполнить напрямую: каждый экспорт запускает
                 * изолированную песочницу, выполняет в ней код плагина и делегирует
                 * ей фактическое построение файла.
                 */
                class FormatSandboxProxy extends global.BaseExporter {
                    /**
                     * Выполняет код плагина в песочнице и делегирует ей экспорт тайтла.
                     * @param {object} manga - Нормализованные метаданные тайтла.
                     * @param {object[]} chapters - Содержимое глав для экспорта.
                     * @param {?string} coverBase64 - Обложка тайтла в base64.
                     * @returns {Promise<{blob: Blob, filename: string, mimeType: string}>}
                     * Результат экспорта.
                     */
                    async export(manga, chapters, coverBase64) {
                        const runtimeApi = _getApi();
                        let jsZipCode = null;
                        if (runtimeApi?.runtime?.getURL) {
                            try {
                                const resp = await fetch(runtimeApi.runtime.getURL('lib/jszip.min.js'));
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

                global.ExporterRegistry.register(fmt, FormatSandboxProxy, { label: lbl });
                console.log(`[PluginManager] Registered sandbox proxy for: ${name}`);
                return;
            }

            console.error(`[PluginManager] All load methods failed for "${name}"`);
        }

        /**
         * Регистрирует в serviceRegistry прокси-сервис для плагина сервиса (кастомного
         * парсера сайта), собирая класс сервиса на основе BaseService и конфигурации
         * плагина (хосты, конфиг сервера изображений и т.д.).
         * @param {{service: string, serviceConfig?: object, hosts?: string[],
         * serviceLabel?: string}} plugin - Данные плагина сервиса.
         * @returns {void}
         */
        static _loadServiceProxy(plugin) {
            if (!global.BaseService || !global.serviceRegistry) {
                console.warn(`[PluginManager] BaseService/serviceRegistry not available for: ${plugin.service}`);
                return;
            }
            const config = plugin.serviceConfig || { name: plugin.service };
            const hosts = new Set((plugin.hosts || []).map(h => h.toLowerCase()));
            const serviceName = plugin.service;

            /**
             * Строит query-параметры запроса главы для API кастомного сервиса.
             * @param {*} number - Номер главы.
             * @param {*} volume - Номер тома.
             * @param {?number} branchId - id ветки перевода.
             * @param {object} extraParams - Дополнительные параметры запроса, специфичные для сервиса.
             * @returns {URLSearchParams} Собранные query-параметры.
             */
            function _buildChapterParams(number, volume, branchId, extraParams) {
                const p = new URLSearchParams();
                p.set('number', number != null ? String(number) : '1');
                p.set('volume', String(volume));
                if (branchId != null) p.set('branch_id', String(branchId));
                for (const [k, v] of Object.entries(extraParams)) p.set(k, String(v));
                return p;
            }

            /**
             * Прокси-реализация BaseService для кастомного сервиса, описанного плагином:
             * определяет принадлежность URL по списку хостов плагина и переопределяет
             * загрузку страниц главы конфигурацией плагина (сервер изображений, сжатие).
             */
            class PluginServiceProxy extends global.BaseService {
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
                    try {
                        const h = new URL(url).hostname.toLowerCase();
                        return hosts.has(h) || [...hosts].some(ph => h.endsWith(`.${ph}`));
                    } catch { return false; }
                }

                /**
                 * Извлекает список страниц главы в унифицированном текстовом формате.
                 * @param {object} content - Сырое содержимое главы от API сервиса.
                 * @returns {{type: 'image', src: string}[]} Список страниц как изображений.
                 */
                extractText(content) {
                    const pages = this.extractPages(content);
                    return pages.map(page => ({
                        type: 'image',
                        src: page.url || page.filename || page.src || String(page)
                    }));
                }

                /**
                 * Возвращает конфигурацию активного сервера изображений сервиса,
                 * выбранного пользователем (или сервер по умолчанию из конфигурации плагина).
                 * @returns {?object} Конфигурация сервера изображений, либо null,
                 * если плагин не описывает серверы изображений.
                 */
                _getActiveServer() {
                    if (!config.imageServers) return null;
                    const key = (typeof localStorage !== 'undefined' && localStorage.getItem(`${serviceName}_image_server`))
                        || config.defaultImageServer
                        || 'compression';
                    return config.imageServers[key] || config.imageServers.compression || null;
                }

                /**
                 * Загружает данные главы: сначала пытается выполнить запрос в контексте
                 * открытой вкладки сервиса (в обход CORS/куки-ограничений фонового
                 * контекста), а при неудаче откатывается на базовую реализацию BaseService.
                 * @param {string} slug - Slug тайтла.
                 * @param {*} number - Номер главы.
                 * @param {*} [volume='1'] - Номер тома.
                 * @param {?number} [branchId] - id ветки перевода.
                 * @param {object} [extraParams] - Дополнительные параметры запроса, специфичные для сервиса.
                 * @returns {Promise<object>} Данные главы от API сервиса.
                 */
                async fetchChapter(slug, number, volume = '1', branchId = null, extraParams = {}) {
                    const api = this.extensionApi;
                    if (api?.scripting?.executeScript && api?.tabs?.query) {
                        try {
                            const hostPatterns = (plugin.hosts || []).map(h => `*://${h}/*`);
                            const tabs = hostPatterns.length
                                ? await api.tabs.query({ url: hostPatterns })
                                : [];
                            const tabId = tabs?.[0]?.id;
                            if (tabId != null) {
                                const p = _buildChapterParams(number, volume, branchId, extraParams);
                                const url = `${this.baseUrl}/api/manga/${slug}/chapter?${p}`;
                                const hdrs = this.config.headers || {};
                                const [injRes] = await api.scripting.executeScript({
                                    target: { tabId },
                                    /**
                                     * Инжектируется в контекст вкладки: выполняет GET-запрос
                                     * с переданными заголовками и куки вкладки.
                                     * @param {string} u - URL запроса.
                                     * @param {object} h - Заголовки запроса.
                                     * @returns {Promise<{ok: boolean, body: ?string}>} Результат запроса.
                                     */
                                    func: async (u, h) => {
                                        try {
                                            const r = await fetch(u, {
                                                method: 'GET', headers: h,
                                                mode: 'cors', credentials: 'include', cache: 'no-store'
                                            });
                                            return { ok: r.ok, body: r.ok ? await r.text() : null };
                                        } catch { return { ok: false, body: null }; }
                                    },
                                    args: [url, hdrs]
                                });
                                if (injRes?.result?.ok) return JSON.parse(injRes.result.body);
                            }
                        } catch (_) {}
                    }
                    return await super.fetchChapter(slug, number, volume, branchId, extraParams);
                }

                /**
                 * Строит абсолютный URL страницы главы из ссылки, используя домен
                 * активного сервера изображений или домен из конфигурации плагина.
                 * @param {*} ref - Ссылка на страницу: готовый URL, объект с полем src,
                 * либо относительный путь.
                 * @returns {?string} Абсолютный URL страницы, либо null, если ref пуст.
                 */
                resolvePageUrl(ref) {
                    if (!ref) return null;
                    const str = String(ref?.src || ref);
                    if (/^https?:\/\//i.test(str)) return str;
                    const server = this._getActiveServer();
                    const domain = server ? server.domain : (config.imagesDomain || '');
                    return str.startsWith('/') ? `${domain}${str}` : `${domain}/${str}`;
                }

                /**
                 * Загружает страницу главы и кодирует её в base64, сжимая изображение,
                 * если это не отключено конфигурацией активного сервера.
                 * @param {*} ref - Ссылка на страницу.
                 * @param {{compressionFormat?: string, compressionQuality?: number}} [opts] - Параметры сжатия.
                 * @returns {Promise<?{base64: string, contentType: string}>} Загруженное
                 * изображение, либо null при ошибке загрузки или отсутствии URL.
                 */
                async loadPageAsBase64(ref, opts = {}) {
                    const url = this.resolvePageUrl(ref?.src || ref);
                    if (!url) return null;
                    const response = await global.fetchPageImage(url, serviceName);
                    if (!response?.ok) {
                        console.warn(`[${serviceName}] Failed to fetch ${url}:`, response?.error);
                        return null;
                    }

                    const server = this._getActiveServer();
                    if (server && server.compress === false)
                        return { base64: response.base64, contentType: response.contentType };

                    if (global.ImageCompressor) {
                        const compressOpts = {
                            format: opts.compressionFormat || 'image/jpeg',
                            quality: opts.compressionQuality || 0.92
                        };
                        return global.ImageCompressor.compress(response.base64, response.contentType, compressOpts);
                    }
                    return { base64: response.base64, contentType: response.contentType };
                }

                /**
                 * Загружает все страницы главы пакетами (по 5 одновременно), обновляя
                 * статус прогресса, и приводит результат к унифицированному формату
                 * контента главы (изображения либо текст-заглушка при ошибке загрузки).
                 * @param {Array} extracted - Список страниц, извлечённых extractText/extractPages.
                 * @param {?{textContent: string}} status - Элемент статуса для отображения прогресса.
                 * @param {{compressionFormat?: string, compressionQuality?: number}} [opts] - Параметры сжатия.
                 * @returns {Promise<object[]>} Список элементов содержимого главы (изображения/текст).
                 */
                async processChapterContent(extracted, status, opts = {}) {
                    const pages = Array.isArray(extracted) ? extracted : [];
                    const loadOpts = {
                        compressionFormat: opts.compressionFormat || 'image/jpeg',
                        compressionQuality: opts.compressionQuality || 0.92
                    };
                    const result = [];
                    let completed = 0;
                    const concurrency = 5;
                    for (let i = 0; i < pages.length; i += concurrency) {
                        const batch = pages.slice(i, Math.min(i + concurrency, pages.length));
                        const batchResults = await Promise.all(
                            batch.map((page, batchIdx) =>
                                this.loadPageAsBase64(page, loadOpts)
                                    .then(img => ({ img, index: i + batchIdx }))
                                    .catch(() => ({ img: null, index: i + batchIdx }))
                            )
                        );
                        for (const { img, index } of batchResults) {
                            if (!img)
                                result.push({ type: 'text', text: `[Ошибка загрузки изображения ${index + 1}]` });
                            else {
                                result.push({
                                    type: 'image',
                                    id: `img_${Date.now()}_${index}`,
                                    data: img,
                                    originalIndex: index
                                });
                            }
                            completed += 1;
                            if (status) status.textContent = `Загружено страниц: ${completed}/${pages.length}`;
                        }
                    }
                    return result;
                }
            }

            global.serviceRegistry.register(PluginServiceProxy);
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

            const api = _getApi();
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

    global.PluginManager = PluginManager;
    console.log('[PluginManager] Loaded');
})(typeof window !== 'undefined' ? window : self);
