'use strict';

const extensionImageRequests = new Set();
const activeDownloads = new Map();

if (typeof importScripts === 'function') {
    try {
        importScripts('lib/lib_parser.js', 'lib/ranobelib.js', 'lib/mangalib.js');
        console.log('[background] Scripts imported via importScripts');
    } catch (e) {
        console.error('[background] Failed to import scripts:', e);
    }
}

if (typeof browser !== 'undefined' && browser.webRequest) {
    browser.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            if (details.url.startsWith('blob:')) return;
            
            const isExtensionRequest = extensionImageRequests.has(details.url) || 
                                        details.originUrl?.startsWith('moz-extension://') ||
                                        details.documentUrl?.startsWith('moz-extension://');
            
            if (!isExtensionRequest) return;

            const isImageRequest = details.url.includes('cover.imglib.info') || 
                                   details.url.includes('img3.mixlib.me') ||
                                   details.url.includes('.jpg') ||
                                   details.url.includes('.png') ||
                                   details.url.includes('.webp');

            if (!isImageRequest) return;

            let headers = details.requestHeaders || [];
            headers = headers.filter(h => h.name.toLowerCase() !== 'origin');
            headers = headers.filter(h => {
                const name = h.name.toLowerCase();
                return !['sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site'].includes(name);
            });
            
            const hasReferer = headers.some(h => h.name.toLowerCase() === 'referer');
            if (!hasReferer) {
                if (details.url.includes('ranobelib'))
                    headers.push({ name: 'Referer', value: 'https://ranobelib.me/' });
                else if (details.url.includes('mangalib') || details.url.includes('imglib') || details.url.includes('mixlib'))
                    headers.push({ name: 'Referer', value: 'https://mangalib.me/' });
            }
            
            headers.push({ name: 'Sec-Fetch-Dest', value: 'image' });
            headers.push({ name: 'Sec-Fetch-Mode', value: 'no-cors' });
            headers.push({ name: 'Sec-Fetch-Site', value: 'cross-site' });
            
            extensionImageRequests.delete(details.url);
            
            return { requestHeaders: headers };
        },
        { urls: ['<all_urls>'] },
        ['blocking', 'requestHeaders']
    );
}

if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'fetchImage') {
            (async () => {
                try {
                    const result = await fetchImage(message.url, message.referer);
                    sendResponse(result);
                } catch (err) {
                    sendResponse({ ok: false, error: String(err) });
                }
            })();
            return true;
        }
        if (message.action === 'downloadFb2') {
            (async () => {
                try {
                    const result = await handleDownloadFb2(message.filename, message.content);
                    sendResponse(result);
                } catch (err) {
                    sendResponse({ ok: false, error: String(err) });
                }
            })();
            return true;
        }
        if (message.action === 'startBackgroundDownload') {
            (async () => {
                try {
                    const result = await startBackgroundDownload(message.downloadId, message.mangaSlug, message.serviceKey);
                    sendResponse(result);
                } catch (err) {
                    sendResponse({ ok: false, error: String(err) });
                }
            })();
            return true;
        }
        if (message.action === 'pauseDownload') {
            pauseDownload(message.downloadId);
            sendResponse({ ok: true });
            return true;
        }
        if (message.action === 'resumeDownload') {
            resumeDownload(message.downloadId);
            sendResponse({ ok: true });
            return true;
        }
        if (message.action === 'stopDownload') {
            stopDownload(message.downloadId);
            sendResponse({ ok: true });
            return true;
        }
        if (message.action === 'getDownloadStatus') {
            const download = activeDownloads.get(message.downloadId);
            sendResponse(download ? { ok: true, status: download.status } : { ok: false });
            return true;
        }
    });
} else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'fetchImage') {
            (async () => {
                try {
                    const result = await fetchImage(message.url, message.referer);
                    sendResponse(result);
                } catch (err) {
                    sendResponse({ ok: false, error: String(err) });
                }
            })();
            return true;
        }
        if (message.action === 'downloadFb2') {
            (async () => {
                try {
                    const result = await handleDownloadFb2(message.filename, message.content);
                    sendResponse(result);
                } catch (err) {
                    sendResponse({ ok: false, error: String(err) });
                }
            })();
            return true;
        }
        if (message.action === 'startBackgroundDownload') {
            (async () => {
                try {
                    const result = await startBackgroundDownload(message.downloadId, message.mangaSlug, message.serviceKey);
                    sendResponse(result);
                } catch (err) {
                    sendResponse({ ok: false, error: String(err) });
                }
            })();
            return true;
        }
        if (message.action === 'pauseDownload') {
            pauseDownload(message.downloadId);
            sendResponse({ ok: true });
            return true;
        }
        if (message.action === 'resumeDownload') {
            resumeDownload(message.downloadId);
            sendResponse({ ok: true });
            return true;
        }
        if (message.action === 'stopDownload') {
            stopDownload(message.downloadId);
            sendResponse({ ok: true });
            return true;
        }
        if (message.action === 'getDownloadStatus') {
            const download = activeDownloads.get(message.downloadId);
            sendResponse(download ? { ok: true, status: download.status } : { ok: false });
            return true;
        }
    });
}

async function fetchImage(url, referer) {
    extensionImageRequests.add(url);
    
    try {
        let actualReferer = referer;
        if (!actualReferer) {
            if (url.includes('ranobelib'))
                actualReferer = 'https://ranobelib.me/';
            else if (url.includes('mangalib') || url.includes('imglib') || url.includes('mixlib'))
                actualReferer = 'https://mangalib.me/';
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
                'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
                'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
                'Referer': actualReferer,
                'Sec-GPC': '1',
                'Connection': 'keep-alive'
            },
            mode: 'cors',
            credentials: 'include',
            redirect: 'follow'
        });

        if (!response.ok) {
            extensionImageRequests.delete(url);
            throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        
        if (blob.size === 0) {
            extensionImageRequests.delete(url);
            throw new Error('Empty response');
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

        extensionImageRequests.delete(url);
        return { ok: true, base64, contentType: blob.type || 'image/jpeg' };
    } catch (error) {
        extensionImageRequests.delete(url);
        return { ok: false, error: error.message };
    }
}

async function handleDownloadFb2(filename, content) {
    try {
        const blob = new Blob([content], { type: 'application/x-fictionbook+xml;charset=utf-8' });
        const objectUrl = URL.createObjectURL(blob);

        if (typeof browser !== 'undefined' && browser.downloads) {
            const downloadId = await browser.downloads.download({
                url: objectUrl,
                filename: filename,
                saveAs: true
            });
            
            setTimeout(() => {
                try { URL.revokeObjectURL(objectUrl); } catch (e) {}
            }, 2 * 60 * 1000);
            
            return { ok: true, downloadId };
        }
        
        if (typeof chrome !== 'undefined' && chrome.downloads) {
            return new Promise((resolve) => {
                chrome.downloads.download({
                    url: objectUrl,
                    filename: filename,
                    saveAs: true
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    
                    setTimeout(() => {
                        try { URL.revokeObjectURL(objectUrl); } catch (e) {}
                    }, 2 * 60 * 1000);
                    
                    resolve({ ok: true, downloadId });
                });
            });
        }

        throw new Error('Downloads API unavailable');
    } catch (error) {
        return { ok: false, error: error.message };
    }
}

async function startBackgroundDownload(downloadId, mangaSlug, serviceKey) {
    if (activeDownloads.has(downloadId))
        return { ok: false, error: 'Download already exists' };

    const downloadState = {
        id: downloadId,
        mangaSlug,
        serviceKey,
        status: {
            isPaused: false,
            shouldStop: false,
            currentChapter: 0,
            totalChapters: 0,
            message: 'Инициализация...',
            progress: 0
        }
    };

    activeDownloads.set(downloadId, downloadState);

    performBackgroundDownload(downloadState).catch(err => {
        console.error('[background] Download failed:', err);
        downloadState.status.message = `Ошибка: ${err.message}`;
    });

    return { ok: true, downloadId };
}

function pauseDownload(downloadId) {
    const download = activeDownloads.get(downloadId);
    if (download) download.status.isPaused = true;
}

function resumeDownload(downloadId) {
    const download = activeDownloads.get(downloadId);
    if (download) download.status.isPaused = false;
}

function stopDownload(downloadId) {
    const download = activeDownloads.get(downloadId);
    if (download) download.status.shouldStop = true;
}

async function performBackgroundDownload(downloadState) {
    const { mangaSlug, serviceKey } = downloadState;
    const status = downloadState.status;

    console.log('[background] performBackgroundDownload started');

    try {
        if (typeof self.libParser === 'undefined' || typeof self.ranobelib === 'undefined' || typeof self.mangalib === 'undefined')
            throw new Error('Required libraries not loaded. Check importScripts in background.js');

        const service = serviceKey === 'mangalib' ? self.mangalib : self.ranobelib;
        
        if (!service) {
            throw new Error(`Service ${serviceKey} not available`);
        }
        
        console.log('[background] Using service:', serviceKey);

        const downloadController = {
            isPaused: () => status.isPaused,
            shouldStop: () => status.shouldStop,
            waitIfPaused: async () => {
                while (status.isPaused && !status.shouldStop) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        };

        const mockStatus = {
            innerHTML: '',
            textContent: '',
            set innerHTML(val) { 
                status.message = String(val).replace(/<[^>]*>/g, ''); 
                console.log('[background]', status.message); 
            },
            set textContent(val) { 
                status.message = String(val); 
                console.log('[background]', status.message); 
            }
        };

        const mockProgress = {
            value: 0,
            style: { display: 'block' },
            set value(val) { status.progress = val; }
        };

        const result = await self.libParser.downloadManga(
            mangaSlug,
            null,
            mockStatus,
            mockProgress,
            service,
            downloadController
        );

        console.log('[background] Download complete:', result);
        
        status.message = 'Готово!';
        status.progress = 100;
        
        setTimeout(() => activeDownloads.delete(downloadState.id), 5000);

    } catch (error) {
        status.message = `Ошибка: ${error.message}`;
        console.error('[background] performBackgroundDownload error:', error);
        throw error;
    }
}