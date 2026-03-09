/**
 * DownloadLib background module
 * Module to handle background tasks like request interception and downloads
 * @module background/Background
 * @license MIT
 * @author ivanvit
 * @version 1.0.0
 */

'use strict';

console.log('[Background] Script loading...');

const browserAPI = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome : ((typeof browser !== 'undefined') ? browser : null);
const isChrome = typeof chrome !== 'undefined' && chrome.runtime && chrome.declarativeNetRequest;
const isFirefox = (typeof browser !== 'undefined') && !isChrome;

console.log('[Background] Detected browser:', isChrome ? 'Chrome' : (isFirefox ? 'Firefox' : 'Unknown'));

const rateLimiter = globalRateLimiter || new RateLimiter({ maxRequestsPerMinute: 80 });
let ServiceConfigs = {};

if (typeof mangalibConfig !== 'undefined')
    ServiceConfigs.mangalib = mangalibConfig;
if (typeof ranolibConfig !== 'undefined')
    ServiceConfigs.ranobelib = ranolibConfig;

function isImageRequest(url) {
    return url.includes('mixlib.me') || 
           url.includes('imglib.info') || 
           url.includes('imgslib.link') ||
           url.includes('/covers/') || 
           url.includes('/uploads/');
}

function detectServiceByUrl(url) {
    if (url.includes('ranobelib.me')) return 'ranobelib';
    if (url.includes('mangalib.me') || url.includes('mangalib.org')) return 'mangalib';
    if (url.includes('mixlib.me') || url.includes('imglib.info') || url.includes('imgslib.link')) return 'mangalib';
    return null;
}

function detectServiceByReferer(details) {
    const headers = details.requestHeaders || [];
    const refererHeader = headers.find(h => h.name.toLowerCase() === 'referer');
    const referer = refererHeader ? refererHeader.value : '';

    if (referer.includes('ranobelib.me')) return 'ranobelib';
    if (referer.includes('mangalib.me') || referer.includes('mangalib.org')) return 'mangalib';

    if (isImageRequest(details.url)) {
        if (details.url.includes('mixlib.me') || details.url.includes('imglib.info') || details.url.includes('imgslib.link'))
            return 'mangalib';
        if (details.url.includes('ranobelib.me'))
            return 'ranobelib';
        return null;
    }

    return null;
}

function isFromExtension(details) {
    if (isFirefox) {
        return details.tabId === -1 || 
               details.frameId === -1 ||
               !details.tabId ||
               (details.originUrl && details.originUrl.startsWith('moz-extension://')) ||
               (details.documentUrl && details.documentUrl.startsWith('moz-extension://'));
    }
    
    const originHeader = details.requestHeaders?.find(h => h.name.toLowerCase() === 'x-extension-request');
    return originHeader?.value === 'true';
}

if (isFirefox && browserAPI && browserAPI.webRequest) {
    console.log('[Background] Firefox: Setting up webRequest with blocking mode');
    
    browserAPI.webRequest.onBeforeSendHeaders.addListener(
        async (details) => {
            const fromExtension = isFromExtension(details);
            const serviceName = detectServiceByReferer(details);

            if (!fromExtension) {
                if (serviceName) rateLimiter.recordRequest(serviceName);
                return {};
            }

            if (details.url.includes('ranobelib.me') && isImageRequest(details.url))
                return {};

            if (serviceName) {
                await rateLimiter.trackRequest(serviceName);
            }

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
                } else console.warn(`[Background] No headers found for service ${serviceName} (isImage: ${isImage})`);
            }

            return { requestHeaders: headers };
        },
        { urls: ['<all_urls>'] },
        ['blocking', 'requestHeaders']
    );
    
    console.log('[Background] Firefox: WebRequest blocking interceptor installed');
}

if (isChrome && browserAPI && browserAPI.webRequest) {
    console.log('[Background] Chrome: Setting up rate limiter');
    
    browserAPI.webRequest.onBeforeSendHeaders.addListener(
        async (details) => {
            const serviceName = detectServiceByReferer(details);
            if (!serviceName) return;

            if (isFromExtension(details))
                await rateLimiter.trackRequest(serviceName);
            else
                rateLimiter.recordRequest(serviceName);
        },
        { urls: ['<all_urls>'] },
        ['requestHeaders']
    );
    
    console.log('[Background] Chrome: Rate limiter installed');
}

if (browserAPI && browserAPI.runtime && browserAPI.runtime.onMessage) {
    browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
        
        if (message.action === 'setRateLimit') {
            rateLimiter.setLimit(message.limit);
            sendResponse({ ok: true });
            return true;
        } else if (message.action === 'getRateLimiterStats') {
            sendResponse({ ok: true, stats: rateLimiter.getStats() });
            return true;
        } else if (message.action === 'fetchImage') {
            (async () => {
                try {
                    const url = message.url;
                    
                    const isRanobelib = url.includes('ranobelib.me');
                    const defaultReferer = isRanobelib
                        ? 'https://ranobelib.me/'
                        : 'https://mangalib.me/';

                    const fetchOptions = {
                        method: 'GET',
                        headers: {
                            'Referer': message.referer || defaultReferer,
                            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                            'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
                            ...(isRanobelib ? {} : { 'X-Extension-Request': 'true' })
                        },
                        credentials: isFirefox ? 'include' : 'omit',
                        cache: 'no-cache',
                        redirect: 'follow',
                        mode: 'cors'
                    };
                    
                    const MAX_RETRIES = 4;
                    let response;
                    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                        const service = detectServiceByUrl(url);
                        if (service) await rateLimiter.trackRequest(service);
                        response = await fetch(url, fetchOptions);
                        if (response.status !== 429) break;
                        console.warn(`[Background] fetchImage 429 on attempt ${attempt + 1}, throttling 30s...`);
                        rateLimiter.throttle(30000);
                        await rateLimiter.trackRequest('429-retry');
                    }

                    if (!response.ok) {
                        sendResponse({ ok: false, error: `HTTP ${response.status}` });
                        return;
                    }

                    const blob = await response.blob();
                    
                    if (blob.size === 0) {
                        sendResponse({ ok: false, error: 'Empty response' });
                        return;
                    }

                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const b64 = reader.result.split(',')[1] || reader.result;
                            resolve(b64);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });

                    sendResponse({ ok: true, base64, contentType: blob.type || 'image/jpeg' });
                } catch (err) {
                    sendResponse({ ok: false, error: String(err) });
                }
            })();
            return true;
        } else if (message.action === 'fetchWithRateLimit') {
            (async () => {
                try {
                    const url = message.url;
                    
                    let fetchOptions = message.options || {};
                    
                    if (!fetchOptions.credentials)
                        fetchOptions.credentials = isFirefox ? 'include' : 'omit';

                    const MAX_RETRIES = 4;
                    let response;
                    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                        const service = detectServiceByUrl(url);
                        if (service) await rateLimiter.trackRequest(service);
                        response = await fetch(url, fetchOptions);
                        if (response.status !== 429) break;
                        console.warn(`[Background] fetchWithRateLimit 429 on attempt ${attempt + 1}, throttling 30s...`);
                        rateLimiter.throttle(30000);
                        await rateLimiter.trackRequest('429-retry');
                    }
                    
                    if (!response.ok) {
                        sendResponse({ 
                            ok: false, 
                            status: response.status,
                            statusText: response.statusText 
                        });
                        return;
                    }

                    const text = await response.text();
                    sendResponse({ 
                        ok: true, 
                        status: response.status,
                        body: text,
                        contentType: response.headers.get('content-type')
                    });
                } catch (err) {
                    sendResponse({ ok: false, error: String(err) });
                }
            })();
            return true;
        } else if (message.action === 'takeOverDownload') {
            (async () => {
                try {
                    const result = await backgroundDownload.takeOverDownload({
                        slug: message.slug,
                        serviceKey: message.serviceKey,
                        format: message.format,
                        manga: message.manga,
                        coverBase64: message.coverBase64,
                        chapterContents: message.chapterContents,
                        chapters: message.chapters,
                        currentChapterIndex: message.currentChapterIndex,
                        currentStatus: message.currentStatus,
                        currentProgress: message.currentProgress,
                        loadedFile: message.loadedFile
                    });
                    sendResponse({ ok: true, downloadId: result.downloadId });
                } catch (err) {
                    sendResponse({ ok: false, error: String(err) });
                }
            })();
            return true;
        } else if (message.action === 'getActiveDownloads') {
            sendResponse({ ok: true, downloads: backgroundDownload.getActiveDownloads() });
            return true;
        } else if (message.action === 'pauseBackgroundDownload') {
            backgroundDownload.pause(message.downloadId);
            sendResponse({ ok: true });
            return true;
        } else if (message.action === 'resumeBackgroundDownload') {
            backgroundDownload.resume(message.downloadId);
            sendResponse({ ok: true });
            return true;
        } else if (message.action === 'stopBackgroundDownload') {
            backgroundDownload.stop(message.downloadId);
            sendResponse({ ok: true });
            return true;
        } else return false;
    });
    
    console.log('[Background] Message listener installed');
}

if (browserAPI && browserAPI.webRequest && browserAPI.webRequest.onBeforeRequest) {
    browserAPI.webRequest.onBeforeRequest.addListener(
        function(details) {
            let isService = false;
            try {
                const tabUrl = details.documentUrl || details.initiator || details.originUrl || '';
                if (
                    tabUrl.includes('mangalib.me') ||
                    tabUrl.includes('mangalib.org') ||
                    tabUrl.includes('ranobelib.me')
                ) {
                    isService = true;
                }
            } catch (e) {}

            if (
                isService &&
                (
                    details.url.startsWith('https://mangalib.me/uploads/slider_items/') ||
                    details.url.startsWith('https://yandex.ru')
                )
            ) {
                return { cancel: true };
            }
        },
        { urls: ['<all_urls>'] },
        ['blocking']
    );
}

console.log('[Background] Script loaded');