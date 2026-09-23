/**
 * DownloadLib background module
 * Routes runtime messages from content scripts and the popup to the appropriate handlers
 * @module background/MessageRouter
 * @license MIT
 * @author ivanvit
 * @version 1.0.9
 */

'use strict';

(function() {
    console.log('[MessageRouter] Script loading...');

    const browserAPI = typeof getExtensionApi === 'function'
        ? getExtensionApi()
        : ((typeof browser !== 'undefined' && browser) || (typeof chrome !== 'undefined' && chrome) || null);
    const browserEnv = typeof getBrowserEnv === 'function'
        ? getBrowserEnv()
        : (() => {
            const hasBrowser = typeof browser !== 'undefined' && !!browser;
            const supportsDnr = typeof chrome !== 'undefined' && !!chrome?.declarativeNetRequest;
            const isFirefox = hasBrowser && !supportsDnr;
            return {
                isFirefox,
                isChromium: typeof chrome !== 'undefined' && !!chrome && !isFirefox,
                supportsDnr
            };
        })();
    const isFirefox = !!browserEnv.isFirefox;

    const rateLimiter = globalRateLimiter || new RateLimiter({ maxRequestsPerMinute: 80 });

    if (!globalThis.authTokenStore) globalThis.authTokenStore = {};
    const authTokens = globalThis.authTokenStore;

    const detectServiceByUrl = globalThis.detectServiceByUrl || (() => null);

    const CDN_IMAGE_HOSTS = [
        'img3.mixlib.me', 'img2.imgslib.link', 'cover.cdnlibs.org', 'cover.imglib.info'
    ];

    /**
     * Проверяет, относится ли URL к одному из известных CDN-хостов изображений,
     * которые можно безопасно загрузить напрямую из background-контекста.
     * @param {string} url - Проверяемый URL изображения.
     * @returns {boolean} true, если хост URL входит в список CDN_IMAGE_HOSTS.
     */
    function isCdnImageUrl(url) {
        try {
            return CDN_IMAGE_HOSTS.includes(new URL(url).hostname);
        } catch {
            return false;
        }
    }

    /**
     * Строит список match-паттернов вкладок для поиска открытой вкладки сервиса.
     * @param {string} [serviceKey] - Ключ сервиса.
     * @returns {string[]} Список match-паттернов вида '*://host/*'.
     */
    function _getTabPatterns(serviceKey) {
        if (serviceKey === 'ranobelib')
            return ['*://ranobelib.me/*'];
        if (!serviceKey || serviceKey === 'mangalib')
            return ['*://mangalib.me/*', '*://mangalib.org/*'];
        const pluginHosts = globalThis.pluginServiceHosts?.[serviceKey] || [];
        return pluginHosts.map(h => `*://${h}/*`);
    }

    /**
     * Загружает изображение напрямую из background-контекста и кодирует его в base64.
     * @param {string} url - URL изображения.
     * @returns {Promise<{ok: true, base64: string, contentType: string}|{ok: false, error: string}>}
     * Результат загрузки: base64-содержимое и MIME-тип при успехе, либо описание ошибки.
     */
    async function fetchImageFromBackground(url) {
        try {
            const response = await fetch(url, { credentials: 'omit' });
            if (!response.ok)
                return { ok: false, error: `HTTP ${response.status}` };
            const blob = await response.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve({
                    ok: true,
                    base64: reader.result.split(',')[1],
                    contentType: blob.type || 'image/jpeg'
                });
                reader.onerror = () => resolve({ ok: false, error: 'FileReader error' });
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    }

    /**
     * Открывает всплывающее окно расширения по заданному URL, используя windows API
     * или, если он недоступен, откатываясь на создание вкладки.
     * @param {string} url - URL страницы, которую нужно открыть.
     * @returns {Promise<boolean|null>} true при успешном создании окна/вкладки, false при неудаче,
     * null — если ни windows, ни tabs API недоступны.
     */
    async function openPopupWindow(url) {
        if (browserAPI.windows) {
            const win = await browserAPI.windows.create({
                url, type: 'popup', width: 350, height: 650, focused: true, state: 'normal'
            });
            if (win && win.id) browserAPI.windows.update(win.id, { focused: true });
            return !!win;
        } else if (browserAPI.tabs) {
            const tab = await browserAPI.tabs.create({ url, active: true });
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
         * Сохраняет auth-токен сервиса в глобальном хранилище токенов.
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
            rateLimiter.setLimit(msg.limit);
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
            respond({ ok: true, stats: rateLimiter.getStats() });
            return true;
        }],

        /**
         * Загружает изображение по URL: напрямую либо через
         * найденную вкладку сервиса — сначала пробуя scripting.executeScript,
         * затем сообщение content script'у как запасной вариант.
         * @param {{url: string, serviceKey?: string}} msg - Сообщение с URL изображения и опциональным ключом сервиса.
         * @param {object} _sender - Отправитель сообщения (не используется).
         * @param {function({ok: boolean, base64?: string, contentType?: string, error?: string}): void} respond
         * Функция отправки ответа.
         * @returns {true}
         */
        ['fetchImage', (msg, _sender, respond) => {
            (async () => {
                try {
                    const { url } = msg;
                    const serviceKey = msg.serviceKey || detectServiceByUrl(url);

                    if (serviceKey) await rateLimiter.trackRequest(serviceKey);

                    if (isCdnImageUrl(url)) {
                        const bgResult = await fetchImageFromBackground(url);
                        respond(bgResult);
                        return;
                    }

                    const patterns = _getTabPatterns(serviceKey);

                    if (!patterns.length) {
                        respond({ ok: false, error: `No tab patterns for service: ${serviceKey}` });
                        return;
                    }

                    const tabs = await browserAPI.tabs.query({ url: patterns });
                    const tabId = tabs?.[0]?.id ?? null;

                    if (!tabId) {
                        respond({ ok: false, error: 'No service tab found' });
                        return;
                    }

                    if (browserAPI.scripting?.executeScript) {
                        const injectResults = await browserAPI.scripting.executeScript({
                            target: { tabId },
                            func: async (imageUrl) => {
                                try {
                                    const r = await fetch(imageUrl);
                                    if (!r.ok) return null;
                                    const blob = await r.blob();
                                    const contentType = blob.type || 'image/jpeg';
                                    return await new Promise(resolve => {
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
                        const injected = injectResults?.[0]?.result;
                        if (injected?.ok) {
                            respond({ ok: true, base64: injected.base64, contentType: injected.contentType });
                            return;
                        }
                    }

                    const result = await browserAPI.tabs.sendMessage(tabId, {
                        action: 'fetchImageFromTab',
                        url
                    });

                    if (result?.ok)
                        respond({ ok: true, base64: result.base64, contentType: result.contentType });
                    else
                        respond({ ok: false, error: result?.error || 'Content script returned no data' });
                } catch (err) {
                    respond({ ok: false, error: String(err) });
                }
            })();
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
                        const service = detectServiceByUrl(url);
                        if (service) await rateLimiter.trackRequest(service);
                        response = await fetch(url, fetchOptions);
                        if (response.status !== 429) break;
                        console.warn(`[MessageRouter] fetchWithRateLimit 429 on attempt ${attempt + 1}, throttling 30s...`);
                        rateLimiter.throttle(30000);
                        await rateLimiter.trackRequest('429-retry');
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

                    const slugMatch = tabUrl.match(/\/(?:manga|book)\/([^/?#]+)/);
                    const slug = slugMatch ? slugMatch[1] : null;
                    let serviceKey = detectServiceByUrl(tabUrl);
                    if (!serviceKey) {
                        const { hostname } = new URL(tabUrl);
                        const h = hostname.toLowerCase();
                        serviceKey = Object.entries(globalThis.pluginServiceHosts || {})
                            .find(([, hosts]) => hosts.some(ph => h === ph || h.endsWith(`.${ph}`)))?.[0] ?? null;
                    }

                    if (!slug || !serviceKey) {
                        respond({ ok: false, error: 'Cannot detect slug or service' });
                        return;
                    }

                    const tabId = sender.tab?.id ?? null;
                    const format = encodeURIComponent(msg.format || 'fb2');
                    let urlParams = `?download=true&slug=${encodeURIComponent(slug)}&service=${encodeURIComponent(serviceKey)}&format=${format}&rateLimit=85&maxSizeMB=200`;
                    if (tabId != null) urlParams += `&tabId=${tabId}`;
                    const popupUrl = browserAPI.runtime.getURL('popup.html') + urlParams;

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
                if (!browserAPI.scripting?.executeScript)
                    throw new Error('scripting.executeScript not available');
                if (!tabId)
                    throw new Error('No tabId provided');
                await browserAPI.scripting.executeScript({
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

    if (browserAPI && browserAPI.runtime && browserAPI.runtime.onMessage) {
        /**
         * Диспетчеризует входящее runtime-сообщение обработчику из карты `handlers`
         * по значению поля `message.action`.
         * @param {{action: string}} message - Входящее сообщение.
         * @param {object} sender - Отправитель сообщения.
         * @param {function(*): void} sendResponse - Функция отправки ответа отправителю.
         * @returns {boolean} Результат вызова найденного обработчика (true — асинхронный ответ),
         * либо false, если обработчик для данного action не зарегистрирован.
         */
        browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
        if (!browserAPI?.runtime?.onConnect) return;
        browserAPI.runtime.onConnect.addListener(port => {
            if (port.name !== 'downloadKeepAlive') return;
            port.onMessage.addListener(() => {});
        });
    }

    _installKeepAliveListener();

    const PLUGIN_CONTENT_SCRIPTS = [
        '/content/AdCleaner.js',
        '/content/DownloadButton.js',
        '/content/ImageFetcher.js'
    ];
    const PLUGIN_SCRIPT_ID_PREFIX = 'dl-plugin-';

    /**
     * Читает включённые пользовательские плагины из storage.local и обновляет
     * глобальную карту `globalThis.pluginServiceHosts` (сервис -> список хостов).
     * @returns {Promise<object[]>} Список включённых плагинов с непустым списком hosts.
     */
    async function _syncPluginServiceHosts() {
        if (!browserAPI?.storage?.local) return [];
        const result = await browserAPI.storage.local.get('custom_plugins');
        const plugins = (result?.custom_plugins || []).filter(
            p => p.enabled !== false && Array.isArray(p.hosts) && p.hosts.length
        );

        globalThis.pluginServiceHosts = {};
        for (const p of plugins)
            if (p.service) globalThis.pluginServiceHosts[p.service] = p.hosts;

        return plugins;
    }

    /**
     * Синхронизирует зарегистрированные content scripts плагинов с текущим списком
     * пользовательских плагинов: удаляет старые регистрации и регистрирует заново
     * PLUGIN_CONTENT_SCRIPTS для хостов каждого включённого плагина.
     * @returns {Promise<void>}
     */
    async function _syncPluginContentScripts() {
        let plugins;
        try {
            plugins = await _syncPluginServiceHosts();
        } catch (e) {
            console.warn('[MessageRouter] Failed to read custom plugins:', e.message);
            return;
        }

        if (!browserAPI?.scripting?.registerContentScripts) return;
        try {
            const existing = await browserAPI.scripting.getRegisteredContentScripts();
            const oldIds = existing
                .filter(s => s.id.startsWith(PLUGIN_SCRIPT_ID_PREFIX))
                .map(s => s.id);
            if (oldIds.length) await browserAPI.scripting.unregisterContentScripts({ ids: oldIds });

            for (const p of plugins) {
                const key = p.service || p.format;
                if (!key) continue;
                await browserAPI.scripting.registerContentScripts([{
                    id: `${PLUGIN_SCRIPT_ID_PREFIX}${key}`,
                    matches: p.hosts.map(h => `https://${h}/*`),
                    js: PLUGIN_CONTENT_SCRIPTS,
                    runAt: 'document_idle'
                }]);
                console.log(`[MessageRouter] Registered content scripts for plugin: ${key}`);
            }
        } catch (e) {
            console.warn('[MessageRouter] Failed to sync plugin content scripts:', e.message);
        }
    }

    if (browserAPI?.storage?.onChanged) {
        /**
         * Реагирует на изменение списка кастомных плагинов в storage.local,
         * повторно синхронизируя зарегистрированные content scripts.
         * @param {object} changes - Объект изменений storage (ключ → {oldValue, newValue}).
         * @param {string} area - Область хранилища ('local', 'sync' и т.д.).
         * @returns {void}
         */
        browserAPI.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.custom_plugins) _syncPluginContentScripts();
        });
    }

    _syncPluginContentScripts();

    console.log('[MessageRouter] Script loaded');
})();
