'use strict';

console.log('[Background] Script loading...');

const extensionImageRequests = new Set();

if (typeof browser !== 'undefined' && browser.webRequest) {
    browser.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            const isImageRequest = details.url.includes('mixlib.me') || 
                                   details.url.includes('imglib.info');
            
            if (!isImageRequest) return;

            let headers = details.requestHeaders || [];
            
            headers = headers.filter(h => {
                const name = h.name.toLowerCase();
                return name !== 'origin' && !name.startsWith('sec-fetch-');
            });
            
            headers.push({ name: 'Referer', value: 'https://mangalib.me/' });
            headers.push({ name: 'Sec-Fetch-Dest', value: 'image' });
            headers.push({ name: 'Sec-Fetch-Mode', value: 'no-cors' });
            headers.push({ name: 'Sec-Fetch-Site', value: 'cross-site' });
            
            console.log('[Background] Modified headers:', headers.map(h => `${h.name}: ${h.value}`));
            
            return { requestHeaders: headers };
        },
        { urls: ['<all_urls>'] },
        ['blocking', 'requestHeaders']
    );
    
    console.log('[Background] WebRequest interceptor installed');
} else {
    console.error('[Background] browser.webRequest NOT available!');
}

if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        
        if (message.action === 'fetchImage') {
            (async () => {
                try {
                    const url = message.url;
                    const response = await fetch(url, {
                        method: 'GET',
                        credentials: 'include',
                        cache: 'no-cache',
                        redirect: 'follow'
                    });

                    if (!response.ok) {
                        console.error('[Background] HTTP error:', response.status, response.statusText);
                        sendResponse({ ok: false, error: `HTTP ${response.status}` });
                        return;
                    }

                    const blob = await response.blob();
                    
                    if (blob.size === 0) {
                        console.error('[Background] Empty blob');
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
                    console.error('[Background] Fetch error:', err);
                    sendResponse({ ok: false, error: String(err) });
                }
            })();
            return true;
        }
    });
} else {
    console.error('[Background] browser.runtime.onMessage NOT available!');
}

console.log('[Background] Script loaded');