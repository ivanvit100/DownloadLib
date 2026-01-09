'use strict';

console.log('[Background] Script loading...');

const rateLimiter = new RateLimiter({ maxRequestsPerMinute: 100 });
let ServiceConfigs = {};
const extensionRequests = new Map();

if (typeof mangalibConfig !== 'undefined')
    ServiceConfigs.mangalib = mangalibConfig;
if (typeof ranolibConfig !== 'undefined')
    ServiceConfigs.ranobelib = ranolibConfig;

function detectService(url) {
    if (url.includes('mangalib.me') || url.includes('mixlib.me') || url.includes('imglib.info') || url.includes('api.cdnlibs.org'))
        return 'mangalib';
    if (url.includes('ranobelib.me') || url.includes('ranobelib.org'))
        return 'ranobelib';
    return null;
}

function isImageRequest(url) {
    return url.includes('mixlib.me') || url.includes('imglib.info') || url.includes('/covers/');
}

if (typeof browser !== 'undefined' && browser.webRequest) {
    browser.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            if (!extensionRequests.has(details.url)) return;

            const serviceName = detectService(details.url);
            if (!serviceName || !ServiceConfigs[serviceName]) return;

            const config = ServiceConfigs[serviceName];
            const isImage = isImageRequest(details.url);
            
            let headers = details.requestHeaders || [];
            
            const targetHeaders = isImage && config.imageHeaders ? config.imageHeaders : config.headers;
            
            if (targetHeaders) {
                for (const [name, value] of Object.entries(targetHeaders)) {
                    const existing = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
                    if (existing) existing.value = value;
                    else headers.push({ name, value });
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
                    await rateLimiter.trackRequest('image');
                    const url = message.url;
                    const serviceName = message.serviceName || detectService(url);
                    
                    extensionRequests.set(url, Date.now());
                    
                    const fetchOptions = {
                        method: 'GET',
                        credentials: 'include',
                        cache: 'no-cache',
                        redirect: 'follow',
                        mode: 'cors'
                    };
                    
                    if (serviceName && ServiceConfigs[serviceName]) {
                        const config = ServiceConfigs[serviceName];
                        const headers = config.imageHeaders || config.headers;
                        if (headers) fetchOptions.headers = headers;
                    }
                    
                    const response = await fetch(url, fetchOptions);

                    extensionRequests.delete(url);

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
                    await rateLimiter.trackRequest('api');
                    const url = message.url;
                    const serviceName = message.serviceName || detectService(url);
                    
                    extensionRequests.set(url, Date.now());
                    
                    let fetchOptions = message.options || {};
                    
                    if (!fetchOptions.credentials)
                        fetchOptions.credentials = 'include';
                    if (!fetchOptions.headers && serviceName && ServiceConfigs[serviceName])
                        fetchOptions.headers = ServiceConfigs[serviceName].headers;
                    
                    const response = await fetch(url, fetchOptions);
                    
                    extensionRequests.delete(url);
                    
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
    });
    
    console.log('[Background] Message listener installed');
}

console.log('[Background] Script loaded');