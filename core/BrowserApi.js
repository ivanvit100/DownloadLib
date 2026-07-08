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
            webRequest: chromeApi.webRequest,
            declarativeNetRequest: chromeApi.declarativeNetRequest
        };
    }

    function resolveNativeApi() {
        if (typeof global.browser !== 'undefined' && global.browser)
            return { api: global.browser, nativeName: 'browser' };
        if (typeof global.chrome !== 'undefined' && global.chrome)
            return { api: createChromePromiseApi(global.chrome), nativeName: 'chrome' };
        return { api: null, nativeName: 'none' };
    }

    function resolveEnv(nativeName) {
        const hasChrome = typeof global.chrome !== 'undefined' && !!global.chrome;
        const hasBrowser = typeof global.browser !== 'undefined' && !!global.browser;
        const supportsDnr = !!(hasChrome && global.chrome.declarativeNetRequest);
        const isFirefox = nativeName === 'browser' || (hasBrowser && !supportsDnr);
        const isChromium = hasChrome && !isFirefox;

        return {
            nativeName,
            isFirefox,
            isChromium,
            supportsDnr
        };
    }

    function getExtensionApi() {
        return global.extensionApi || null;
    }

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

    let _serviceTabId = null;
    let _serviceTabExpiry = 0;

    function setServiceTab(tabId) {
        _serviceTabId = tabId;
        _serviceTabExpiry = Date.now() + 3600000;
    }

    async function fetchViaTab(url, serviceKey) {
        const api = getExtensionApi();
        if (!api?.scripting?.executeScript) return null;

        let tabId = _serviceTabId;
        if (!tabId || Date.now() > _serviceTabExpiry) {
            const patterns = serviceKey === 'ranobelib'
                ? ['*://ranobelib.me/*']
                : ['*://mangalib.me/*', '*://mangalib.org/*'];
            try {
                const tabs = await api.tabs.query({ url: patterns });
                tabId = tabs?.[0]?.id ?? null;
                if (tabId) {
                    _serviceTabId = tabId;
                    _serviceTabExpiry = Date.now() + 3600000;
                }
            } catch (e) {
                console.warn('[BrowserApi] tabs.query failed:', e.message);
                return null;
            }
        }

        if (!tabId) return null;

        try {
            const results = await api.scripting.executeScript({
                target: { tabId },
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

    global.setServiceTab = setServiceTab;
    global.fetchViaTab = fetchViaTab;

    console.log('[BrowserApi] Loaded:', global.browserEnv.nativeName);
})(typeof window !== 'undefined' ? window : self);
