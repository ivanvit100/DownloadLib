'use strict';

console.log('[Background] Script loading...');

const rateLimiter = globalRateLimiter || new RateLimiter({ maxRequestsPerMinute: 80 });
let ServiceConfigs = {};

if (typeof mangalibConfig !== 'undefined')
    ServiceConfigs.mangalib = mangalibConfig;
if (typeof ranolibConfig !== 'undefined')
    ServiceConfigs.ranobelib = ranolibConfig;

function isImageRequest(url) {
    return url.includes('mixlib.me') || url.includes('imglib.info') || url.includes('/covers/') || url.includes('/uploads/');
}

function detectServiceByReferer(details) {
    const headers = details.requestHeaders || [];
    const refererHeader = headers.find(h => h.name.toLowerCase() === 'referer');
    const referer = refererHeader ? refererHeader.value : '';
    
    if (referer.includes('ranobelib.me'))
        return 'ranobelib';
    if (referer.includes('mangalib.me'))
        return 'mangalib';
    
    if (isImageRequest(details.url)) {
        if (details.url.includes('mixlib.me') || details.url.includes('imglib.info'))
            return 'mangalib';
        if (details.url.includes('ranobelib.me'))
            return 'ranobelib';
    }
    
    return null;
}

function isFromExtension(details) {
    return details.tabId === -1 || 
           details.frameId === -1 ||
           !details.tabId ||
           (details.originUrl && details.originUrl.startsWith('moz-extension://')) ||
           (details.documentUrl && details.documentUrl.startsWith('moz-extension://'));
}

if (typeof browser !== 'undefined' && browser.webRequest) {
    browser.webRequest.onBeforeSendHeaders.addListener(
        async (details) => {
            if (!isFromExtension(details)) return {};

            const serviceName = detectServiceByReferer(details);
            if (serviceName) {
                console.log(`[Background] Rate limiting ${serviceName} request: ${details.url}`);
                await rateLimiter.trackRequest(serviceName);
            } else {
                console.warn(`[Background] Could not detect service for: ${details.url}`);
            }

            let headers = details.requestHeaders || [];

            if (serviceName && ServiceConfigs[serviceName]) {
                const config = ServiceConfigs[serviceName];
                const isImage = isImageRequest(details.url);
                
                const targetHeaders = isImage && config.imageHeaders ? config.imageHeaders : config.headers;
                
                if (targetHeaders) {
                    console.log(`[Background] Applying ${serviceName} headers (${isImage ? 'image' : 'api'}) to:`, details.url);
                    for (const [name, value] of Object.entries(targetHeaders)) {
                        const lowerName = name.toLowerCase();
                        
                        const existing = headers.find(h => h.name.toLowerCase() === lowerName);
                        if (existing) existing.value = value;
                        else headers.push({ name, value });
                    }
                }
            }

            return { requestHeaders: headers };
        },
        { urls: ['<all_urls>'] },
        ['blocking', 'requestHeaders']
    );
    
    console.log('[Background] WebRequest interceptor installed');
}

if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        
        if (message.action === 'setRateLimit') {
            rateLimiter.setLimit(message.limit);
            sendResponse({ ok: true });
            return true;
        }

        if (message.action === 'getRateLimiterStats') {
            sendResponse({ ok: true, stats: rateLimiter.getStats() });
            return true;
        }
        
        if (message.action === 'fetchImage') {
            (async () => {
                try {
                    const url = message.url;
                    
                    const fetchOptions = {
                        method: 'GET',
                        credentials: 'include',
                        cache: 'no-cache',
                        redirect: 'follow',
                        mode: 'cors'
                    };
                    
                    const response = await fetch(url, fetchOptions);

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
        }

        if (message.action === 'fetchWithRateLimit') {
            (async () => {
                try {
                    const url = message.url;
                    
                    let fetchOptions = message.options || {};
                    
                    if (!fetchOptions.credentials)
                        fetchOptions.credentials = 'include';
                    
                    const response = await fetch(url, fetchOptions);
                    
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
        }

        if (message.action === 'takeOverDownload') {
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
        }

        if (message.action === 'getActiveDownloads') {
            sendResponse({ ok: true, downloads: backgroundDownload.getActiveDownloads() });
            return true;
        }

        if (message.action === 'pauseBackgroundDownload') {
            backgroundDownload.pause(message.downloadId);
            sendResponse({ ok: true });
            return true;
        }

        if (message.action === 'resumeBackgroundDownload') {
            backgroundDownload.resume(message.downloadId);
            sendResponse({ ok: true });
            return true;
        }

        if (message.action === 'stopBackgroundDownload') {
            backgroundDownload.stop(message.downloadId);
            sendResponse({ ok: true });
            return true;
        }
    });
    
    console.log('[Background] Message listener installed');
}

console.log('[Background] Script loaded');