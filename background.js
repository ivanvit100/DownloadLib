'use strict';

const activeDownloads = new Map();

if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'downloadFb2') {
            handleDownload(message.filename, message.content)
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ ok: false, error: String(err) }));
            return true;
        }
    });
} else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'downloadFb2') {
            handleDownload(message.filename, message.content)
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ ok: false, error: String(err) }));
            return true;
        }
    });
}

async function handleDownload(filename, content) {
    try {
        const blob = new Blob([content], { type: 'application/fb2+xml;charset=utf-8' });
        const objectUrl = URL.createObjectURL(blob);
        
        const downloadId = Date.now() + '_' + Math.random();
        activeDownloads.set(downloadId, objectUrl);

        if (typeof browser !== 'undefined' && browser.downloads && browser.downloads.download) {
            const id = await browser.downloads.download({
                url: objectUrl,
                filename: filename,
                saveAs: true
            });
            
            setTimeout(() => {
                try {
                    URL.revokeObjectURL(objectUrl);
                    activeDownloads.delete(downloadId);
                } catch (e) {
                    console.error('Error revoking URL:', e);
                }
            }, 5 * 60 * 1000);
            
            return { ok: true, id, method: 'background-browser' };
        }

        if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
            return new Promise((resolve) => {
                chrome.downloads.download({
                    url: objectUrl,
                    filename: filename,
                    saveAs: true
                }, (id) => {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        try {
                            URL.revokeObjectURL(objectUrl);
                            activeDownloads.delete(downloadId);
                        } catch (e) {}
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    
                    setTimeout(() => {
                        try {
                            URL.revokeObjectURL(objectUrl);
                            activeDownloads.delete(downloadId);
                        } catch (e) {}
                    }, 5 * 60 * 1000);
                    
                    resolve({ ok: true, id, method: 'background-chrome' });
                });
            });
        }

        return { ok: false, error: 'downloads API unavailable in background' };
        
    } catch (error) {
        console.error('handleDownload error:', error);
        return { ok: false, error: String(error) };
    }
}