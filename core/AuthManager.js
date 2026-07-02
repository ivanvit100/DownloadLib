/**
 * DownloadLib core module
 * Manages authorization token extraction and caching
 * @module core/AuthManager
 * @license MIT
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function(global) {
    console.log('[AuthManager] Loading...');

    const browserAPI = typeof global.getExtensionApi === 'function'
        ? global.getExtensionApi()
        : ((typeof global.browser !== 'undefined' && global.browser) ||
            (typeof global.chrome !== 'undefined' && global.chrome) ||
            null);

    const AuthManager = {
        async getToken(serviceKey, tabId = null) {
            try {
                const cached = await browserAPI.runtime.sendMessage({ action: 'getAuthToken', serviceKey });
                if (cached && cached.token) return cached.token;
            } catch (e) {
                console.warn('[AuthManager] Failed to get cached auth token:', e);
            }

            if (tabId != null && browserAPI.scripting) {
                try {
                    const results = await browserAPI.scripting.executeScript({
                        target: { tabId },
                        func: () => {
                            const RE = /^eyJ[\w\-+=/]+\.eyJ[\w\-+=/]+\.[\w\-+=/]+$/;

                            function findJwt(val) {
                                if (typeof val !== 'string' || !val) return null;
                                if (RE.test(val)) return val;
                                const bare = val.startsWith('Bearer ') ? val.slice(7) : null;
                                if (bare && RE.test(bare)) return bare;
                                try { return scanObj(JSON.parse(val)); } catch { return null; }
                            }

                            function scanObj(o) {
                                if (!o || typeof o !== 'object') return null;
                                for (const v of Object.values(o)) {
                                    const f = typeof v === 'string'
                                        ? findJwt(v)
                                        : scanObj(typeof v === 'object' && v ? v : null);
                                    if (f) return f;
                                }
                                return null;
                            }

                            for (const s of [localStorage, sessionStorage]) {
                                for (let i = 0; i < s.length; i++) {
                                    const f = findJwt(s.getItem(s.key(i)));
                                    if (f) return f;
                                }
                            }
                            return null;
                        }
                    });
                    if (results && results[0] && results[0].result) {
                        const token = results[0].result;
                        browserAPI.runtime.sendMessage({ action: 'cacheAuthToken', serviceKey, token }).catch(() => {});
                        return token;
                    }
                } catch (e) {
                    console.warn('[AuthManager] Failed to extract auth token via executeScript:', e);
                }
            }

            return null;
        },

        async apply(serviceKey, activeTabId, service) {
            try {
                const token = await this.getToken(serviceKey, activeTabId);
                if (token) {
                    service.config = service.config || {};
                    service.config.headers = { ...service.config.headers, 'Authorization': `Bearer ${token}` };
                    console.log('[AuthManager] Auth token applied');
                    return token;
                }
            } catch (e) {
                console.warn('[AuthManager] Could not get auth token:', e);
            }
            return null;
        }
    };

    global.AuthManager = AuthManager;
    console.log('[AuthManager] Loaded');
})(typeof window !== 'undefined' ? window : self);
