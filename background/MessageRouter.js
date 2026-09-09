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
        : {
            isFirefox: typeof browser !== 'undefined' && !!browser,
            isChromium: typeof chrome !== 'undefined' && !!chrome,
            supportsDnr: typeof chrome !== 'undefined' && !!chrome?.declarativeNetRequest
        };
    const isFirefox = !!browserEnv.isFirefox;

    const rateLimiter = globalRateLimiter || new RateLimiter({ maxRequestsPerMinute: 80 });

    if (!globalThis.authTokenStore) globalThis.authTokenStore = {};
    const authTokens = globalThis.authTokenStore;

    const detectServiceByUrl = globalThis.detectServiceByUrl || (() => null);

    const CDN_IMAGE_HOSTS = [
        'img3.mixlib.me', 'img2.imgslib.link', 'cover.cdnlibs.org', 'cover.imglib.info'
    ];

    function isCdnImageUrl(url) {
        try {
            return CDN_IMAGE_HOSTS.includes(new URL(url).hostname);
        } catch {
            return false;
        }
    }

    function _getTabPatterns(serviceKey) {
        if (serviceKey === 'ranobelib')
            return ['*://ranobelib.me/*'];
        if (!serviceKey || serviceKey === 'mangalib')
            return ['*://mangalib.me/*', '*://mangalib.org/*'];
        const pluginHosts = globalThis.pluginServiceHosts?.[serviceKey] || [];
        return pluginHosts.map(h => `*://${h}/*`);
    }

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

    const handlers = new Map([
        ['getAuthToken', (msg, _sender, respond) => {
            const token = msg.serviceKey ? (authTokens[msg.serviceKey] || null) : null;
            respond({ token });
            return true;
        }],

        ['cacheAuthToken', (msg, _sender, respond) => {
            if (msg.serviceKey && msg.token) {
                authTokens[msg.serviceKey] = msg.token;
                console.log(`[MessageRouter] Cached auth token for ${msg.serviceKey}`);
            }
            respond({ ok: true });
            return true;
        }],

        ['setRateLimit', (msg, _sender, respond) => {
            rateLimiter.setLimit(msg.limit);
            respond({ ok: true });
            return true;
        }],

        ['getRateLimiterStats', (_msg, _sender, respond) => {
            respond({ ok: true, stats: rateLimiter.getStats() });
            return true;
        }],

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
        browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const handler = handlers.get(message.action);
            if (handler) return handler(message, sender, sendResponse);
            return false;
        });

        console.log('[MessageRouter] Message listener installed');
    }

    const PLUGIN_CONTENT_SCRIPTS = [
        '/content/AdCleaner.js',
        '/content/DownloadButton.js',
        '/content/ImageFetcher.js'
    ];
    const PLUGIN_SCRIPT_ID_PREFIX = 'dl-plugin-';

    async function _syncPluginContentScripts() {
        if (!browserAPI?.scripting?.registerContentScripts) return;
        try {
            const result = await browserAPI.storage.local.get('custom_plugins');
            const plugins = (result?.custom_plugins || []).filter(
                p => p.enabled !== false && Array.isArray(p.hosts) && p.hosts.length
            );

            globalThis.pluginServiceHosts = {};
            for (const p of plugins)
                if (p.service) globalThis.pluginServiceHosts[p.service] = p.hosts;

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
        browserAPI.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.custom_plugins) _syncPluginContentScripts();
        });
    }

    _syncPluginContentScripts();

    console.log('[MessageRouter] Script loaded');
})();
