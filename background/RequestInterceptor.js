/**
 * DownloadLib background module
 * Intercepts network requests: injects headers, captures auth tokens, enforces rate limits,
 * fixes CORS for image CDNs, and blocks ad network requests
 * @module background/RequestInterceptor
 * @license MIT
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function() {
    console.log('[RequestInterceptor] Script loading...');

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
    const isChrome = !!browserEnv.isChromium || !!browserEnv.supportsDnr;
    const isFirefox = !!browserEnv.isFirefox;

    console.log('[RequestInterceptor] Detected browser:', isFirefox ? 'Firefox' : 'Chrome');

    const rateLimiter = globalRateLimiter || new RateLimiter({ maxRequestsPerMinute: 80 });
    const ServiceConfigs = {};

    if (typeof mangalibConfig !== 'undefined')
        ServiceConfigs.mangalib = mangalibConfig;
    if (typeof ranolibConfig !== 'undefined')
        ServiceConfigs.ranobelib = ranolibConfig;

    if (!globalThis.authTokenStore) globalThis.authTokenStore = {};
    const authTokens = globalThis.authTokenStore;

    function detectServiceByUrl(url) {
        if (url.includes('ranobelib.me')) return 'ranobelib';
        if (url.includes('mangalib.me') || url.includes('mangalib.org')) return 'mangalib';
        if (url.includes('mixlib.me') || url.includes('imglib.info') || url.includes('imgslib.link')) return 'mangalib';
        if (url.includes('cdnlibs.org')) return 'mangalib';
        return null;
    }

    globalThis.detectServiceByUrl = detectServiceByUrl;

    function captureAuthToken(details, serviceName) {
        if (details.url.startsWith('https://api.cdnlibs.org/')) {
            const authHeader = details.requestHeaders?.find(h => h.name.toLowerCase() === 'authorization');
            if (authHeader?.value?.startsWith('Bearer ')) {
                const svc = serviceName || (() => {
                    const tabUrl = [details.originUrl, details.documentUrl].find(u => u?.startsWith('https://'));
                    return tabUrl?.includes('ranobelib.me') ? 'ranobelib' : 'mangalib';
                })();
                const newToken = authHeader.value.substring(7);
                if (authTokens[svc] !== newToken) {
                    authTokens[svc] = newToken;
                    console.log(`[RequestInterceptor] Captured auth token for ${svc}`);
                }
            }
        }
    }

    function injectAuthToken(headers, serviceName, url) {
        if (serviceName && authTokens[serviceName] && url.startsWith('https://api.cdnlibs.org/')) {
            const authIdx = headers.findIndex(h => h.name.toLowerCase() === 'authorization');
            const authValue = `Bearer ${authTokens[serviceName]}`;
            if (authIdx !== -1) headers[authIdx].value = authValue;
            else headers.push({ name: 'Authorization', value: authValue });
        }
    }

    function isImageRequest(url) {
        return url.includes('mixlib.me') ||
            url.includes('imglib.info') ||
            url.includes('imgslib.link') ||
            url.includes('img3.cdnlibs.org') ||
            url.includes('cover.cdnlibs.org') ||
            url.includes('/covers/') ||
            url.includes('/uploads/');
    }

    function detectServiceByReferer(details) {
        const headers = details.requestHeaders || [];
        const serviceHeader = headers.find(h => h.name.toLowerCase() === 'x-dl-service');
        if (serviceHeader) {
            const serviceValue = String(serviceHeader.value || '').toLowerCase();
            if (serviceValue === 'mangalib') return 'mangalib';
            else if (serviceValue === 'ranobelib') return 'ranobelib';
        }

        const siteIdHeader = headers.find(h => h.name.toLowerCase() === 'site-id');
        if (siteIdHeader) {
            const siteId = String(siteIdHeader.value || '').trim();
            if (siteId === '1') return 'mangalib';
            else if (siteId === '3') return 'ranobelib';
        }

        const refererHeader = headers.find(h => h.name.toLowerCase() === 'referer');
        const referer = refererHeader ? refererHeader.value : '';

        if (referer.includes('ranobelib.me')) return 'ranobelib';
        if (referer.includes('mangalib.me') || referer.includes('mangalib.org')) return 'mangalib';

        if (isImageRequest(details.url))
            return detectServiceByUrl(details.url);

        return null;
    }

    function isFromExtension(details) {
        if (details.tabId === -1 && !details.documentUrl && !details.originUrl) return true;

        const extensionSchemes = ['moz-extension://', 'chrome-extension://'];
        const originCandidates = [details.originUrl, details.documentUrl, details.initiator].filter(Boolean);
        const hasExtensionOrigin = originCandidates.some(url =>
            extensionSchemes.some(scheme => url.startsWith(scheme))
        );

        if (hasExtensionOrigin) return true;

        const originHeader = details.requestHeaders?.find(h => h.name.toLowerCase() === 'x-extension-request');
        return originHeader?.value === 'true';
    }

    const pendingOrigins = new Map();

    const FIREFOX_WEBREQUEST_URLS = [
        'https://api.cdnlibs.org/*',
        'https://cover.cdnlibs.org/*',
        'https://img3.cdnlibs.org/*',
        'https://*.mixlib.me/*',
        'https://*.imglib.info/*',
        'https://*.imgslib.link/*',
        'https://ranobelib.me/*',
        'https://*.ranobelib.me/*',
        'https://*.mangalib.me/*',
        'https://*.mangalib.org/*'
    ];

    function setupFirefoxListeners() {
        if (!isFirefox || !browserAPI?.webRequest) return;
        console.log('[RequestInterceptor] Firefox: Setting up webRequest with blocking mode');

        browserAPI.webRequest.onBeforeSendHeaders.addListener(
            async (details) => {
                const fromExtension = isFromExtension(details);
                const serviceName = detectServiceByReferer(details);

                if (isImageRequest(details.url)) {
                    const reqHeaders = details.requestHeaders || [];
                    const originHeader = reqHeaders.find(h => h.name.toLowerCase() === 'origin');
                    if (originHeader?.value)
                        pendingOrigins.set(details.requestId, originHeader.value);
                }

                if (!fromExtension) {
                    captureAuthToken(details, serviceName);
                    return {};
                }

                if (serviceName)
                    await rateLimiter.trackRequest(serviceName);

                let headers = details.requestHeaders || [];

                if (serviceName && ServiceConfigs[serviceName]) {
                    const config = ServiceConfigs[serviceName];
                    const isImage = isImageRequest(details.url);

                    const targetHeaders = isImage && config.imageHeaders ? config.imageHeaders : config.headers;

                    if (targetHeaders) {
                        const targetKeys = Object.keys(targetHeaders).map(k => k.toLowerCase());

                        const otherHeaders = isImage ? config.headers : config.imageHeaders;
                        if (otherHeaders) {
                            const otherKeys = Object.keys(otherHeaders).map(k => k.toLowerCase());
                            const toRemove = otherKeys.filter(k => !targetKeys.includes(k));
                            headers = headers.filter(h => !toRemove.includes(h.name.toLowerCase()));
                        }

                        for (const [name, value] of Object.entries(targetHeaders)) {
                            const lowerName = name.toLowerCase();
                            const existing = headers.find(h => h.name.toLowerCase() === lowerName);
                            if (existing) existing.value = value;
                            else headers.push({ name, value });
                        }
                    } else console.warn(`[RequestInterceptor] No headers found for service ${serviceName} (isImage: ${isImage})`);
                }

                injectAuthToken(headers, serviceName, details.url);

                return { requestHeaders: headers };
            },
            { urls: FIREFOX_WEBREQUEST_URLS },
            ['blocking', 'requestHeaders']
        );

        browserAPI.webRequest.onHeadersReceived.addListener(
            (details) => {
                if (!isImageRequest(details.url)) return {};

                const headers = details.responseHeaders || [];
                const hasACAO = headers.some(h => h.name.toLowerCase() === 'access-control-allow-origin');

                if (!hasACAO) {
                    const requestOrigin = pendingOrigins.get(details.requestId);
                    if (requestOrigin) {
                        headers.push({ name: 'Access-Control-Allow-Origin', value: requestOrigin });
                        headers.push({ name: 'Access-Control-Allow-Credentials', value: 'true' });
                    } else if (details.tabId === -1) {
                        headers.push({ name: 'Access-Control-Allow-Origin', value: `moz-extension://${browserAPI.runtime.id}` });
                        headers.push({ name: 'Access-Control-Allow-Credentials', value: 'true' });
                    } else {
                        const svc = detectServiceByUrl(details.url);
                        const acao = svc === 'ranobelib' ? 'https://ranobelib.me' : 'https://mangalib.me';
                        headers.push({ name: 'Access-Control-Allow-Origin', value: acao });
                        headers.push({ name: 'Access-Control-Allow-Credentials', value: 'true' });
                    }
                }

                pendingOrigins.delete(details.requestId);
                return { responseHeaders: headers };
            },
            { urls: FIREFOX_WEBREQUEST_URLS },
            ['blocking', 'responseHeaders']
        );

        console.log('[RequestInterceptor] Firefox: WebRequest blocking interceptor installed');
    }

    function setupChromeRateLimiter() {
        if (!isChrome || !browserAPI?.webRequest) return;
        console.log('[RequestInterceptor] Chrome: Setting up rate limiter');

        browserAPI.webRequest.onBeforeSendHeaders.addListener(
            async (details) => {
                const fromExtension = isFromExtension(details);
                const serviceName = detectServiceByReferer(details);

                if (!fromExtension)
                    captureAuthToken(details, serviceName);
                else if (serviceName)
                    await rateLimiter.trackRequest(serviceName);
            },
            {
                urls: [
                    'https://api.cdnlibs.org/*',
                    'https://*.mixlib.me/*',
                    'https://*.imglib.info/*',
                    'https://*.imgslib.link/*',
                    'https://*.ranobelib.me/*',
                    'https://*.mangalib.me/*',
                    'https://*.mangalib.org/*'
                ]
            },
            ['requestHeaders']
        );

        console.log('[RequestInterceptor] Chrome: Rate limiter installed');
    }

    function setupAdBlocker() {
        if (!browserAPI?.webRequest?.onBeforeRequest) return;

        browserAPI.webRequest.onBeforeRequest.addListener(
            (details) => {
                let isService = false;
                try {
                    const tabUrl = details.documentUrl || details.initiator || details.originUrl || '';
                    if (
                        tabUrl.includes('mangalib.me') ||
                        tabUrl.includes('mangalib.org') ||
                        tabUrl.includes('ranobelib.me')
                    ) isService = true;
                } catch (e) {}

                if (
                    isService &&
                    (
                        details.url.startsWith('https://mangalib.me/uploads/slider_items/') ||
                        details.url.startsWith('https://yandex.ru')
                    )
                ) return { cancel: true };
            },
            {
                urls: [
                    'https://mangalib.me/uploads/slider_items/*',
                    'https://yandex.ru/*'
                ]
            },
            ['blocking']
        );
    }

    setupFirefoxListeners();
    setupChromeRateLimiter();
    setupAdBlocker();

    console.log('[RequestInterceptor] Script loaded');
})();
