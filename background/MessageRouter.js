/**
 * DownloadLib background module
 * Routes runtime messages from content scripts and the popup to the appropriate handlers
 * @module background/MessageRouter
 * @license MIT
 * @author ivanvit
 * @version 1.0.7
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
                    const serviceKey = detectServiceByUrl(url);

                    if (serviceKey) await rateLimiter.trackRequest(serviceKey);

                    const patterns = serviceKey === 'ranobelib'
                        ? ['*://ranobelib.me/*']
                        : ['*://mangalib.me/*', '*://mangalib.org/*'];

                    const tabs = await browserAPI.tabs.query({ url: patterns });
                    const tabId = tabs?.[0]?.id ?? null;

                    if (!tabId) {
                        respond({ ok: false, error: 'No service tab found' });
                        return;
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
                    const serviceKey = detectServiceByUrl(tabUrl);
                    if (!slug || !serviceKey) {
                        respond({ ok: false, error: 'Cannot detect slug or service' }); return;
                    }

                    const format = encodeURIComponent(msg.format || 'fb2');
                    const urlParams = `?download=true&slug=${encodeURIComponent(slug)}&service=${encodeURIComponent(serviceKey)}&format=${format}&rateLimit=85&maxSizeMB=200`;
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

    if (browserAPI && browserAPI.runtime && browserAPI.runtime.onMessage) {
        browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const handler = handlers.get(message.action);
            if (handler) return handler(message, sender, sendResponse);
            return false;
        });

        console.log('[MessageRouter] Message listener installed');
    }

    console.log('[MessageRouter] Script loaded');
})();
