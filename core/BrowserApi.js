/**
 * DownloadLib core module
 * Cross-browser API adapter for Firefox and Chromium
 * @module core/BrowserApi
 * @license MIT
 * @author ivanvit
 * @version 1.0.4
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
                } : undefined
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

    console.log('[BrowserApi] Loaded:', global.browserEnv.nativeName);
})(typeof window !== 'undefined' ? window : self);
