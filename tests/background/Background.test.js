import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mockTrackRequest;
let mockSetLimit;
let mockGetStats;
let mockTakeOverDownload;
let mockGetActiveDownloads;
let mockPause;
let mockResume;
let mockStop;
let mockAddListenerBeforeSendHeaders;
let mockAddListenerOnMessage;
let mockAddListenerOnBeforeRequest;
let capturedBeforeSendHeadersCb;
let capturedMessageCb;
let capturedOnBeforeRequestCb;
let isFirefoxMode;
let isChromeMode;

function setupGlobals(mode) {
    isFirefoxMode = mode === 'firefox';
    isChromeMode = mode === 'chrome';

    mockTrackRequest = vi.fn().mockResolvedValue();
    mockSetLimit = vi.fn();
    mockGetStats = vi.fn().mockReturnValue({ rpm: 10 });

    globalThis.globalRateLimiter = {
        trackRequest: mockTrackRequest,
        setLimit: mockSetLimit,
        getStats: mockGetStats,
    };
    globalThis.RateLimiter = vi.fn(() => globalThis.globalRateLimiter);

    globalThis.mangalibConfig = {
        headers: { 'Accept': 'text/html', 'X-Custom': 'mangalib' },
        imageHeaders: { 'Accept': 'image/webp', 'Referer': 'https://mangalib.me/' },
    };
    globalThis.ranolibConfig = {
        headers: { 'Accept': 'text/html', 'X-Custom': 'ranobelib' },
    };

    mockTakeOverDownload = vi.fn().mockResolvedValue({ downloadId: 'bg_1' });
    mockGetActiveDownloads = vi.fn().mockReturnValue([]);
    mockPause = vi.fn();
    mockResume = vi.fn();
    mockStop = vi.fn();

    globalThis.backgroundDownload = {
        takeOverDownload: mockTakeOverDownload,
        getActiveDownloads: mockGetActiveDownloads,
        pause: mockPause,
        resume: mockResume,
        stop: mockStop,
    };

    capturedBeforeSendHeadersCb = null;
    capturedMessageCb = null;
    capturedOnBeforeRequestCb = null;

    mockAddListenerBeforeSendHeaders = vi.fn((cb) => { capturedBeforeSendHeadersCb = cb; });
    mockAddListenerOnMessage = vi.fn((cb) => { capturedMessageCb = cb; });
    mockAddListenerOnBeforeRequest = vi.fn((cb) => { capturedOnBeforeRequestCb = cb; });

    const apiObj = {
        webRequest: {
            onBeforeSendHeaders: { addListener: mockAddListenerBeforeSendHeaders },
            onBeforeRequest: { addListener: mockAddListenerOnBeforeRequest },
        },
        runtime: {
            onMessage: { addListener: mockAddListenerOnMessage },
        },
    };

    if (isChromeMode) {
        delete globalThis.browser;
        globalThis.chrome = {
            ...apiObj,
            runtime: { ...apiObj.runtime, id: 'test' },
            declarativeNetRequest: {},
        };
    } else if (isFirefoxMode) {
        delete globalThis.chrome;
        globalThis.browser = apiObj;
    } else {
        delete globalThis.chrome;
        delete globalThis.browser;
    }

    globalThis.fetch = vi.fn();
    globalThis.FileReader = class {
        readAsDataURL() {
            setTimeout(() => {
                this.result = 'data:image/jpeg;base64,AAAA';
                this.onloadend();
            }, 0);
        }
    };

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
}

async function loadModule() {
    vi.resetModules();
    await import('../../background/Background.js');
}

describe('Background', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Firefox mode', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
        });

        it('Registers webRequest listener with blocking mode', () => {
            expect(mockAddListenerBeforeSendHeaders).toHaveBeenCalledWith(
                expect.any(Function),
                { urls: ['<all_urls>'] },
                ['blocking', 'requestHeaders'],
            );
        });

        it('Registers message listener', () => {
            expect(mockAddListenerOnMessage).toHaveBeenCalledWith(expect.any(Function));
        });

        it('Registers onBeforeRequest listener', () => {
            expect(mockAddListenerOnBeforeRequest).toHaveBeenCalledWith(
                expect.any(Function),
                { urls: ['<all_urls>'] },
                ['blocking'],
            );
        });

        it('Returns empty object for non-extension requests', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: 1,
                frameId: 0,
                url: 'https://example.com',
                requestHeaders: [],
            });
            expect(result).toEqual({});
        });

        it('Tracks rate limit for mangalib requests from extension', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.mangalib.me/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/some-manga' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
            expect(result.requestHeaders).toBeDefined();
        });

        it('Tracks rate limit for ranobelib requests from extension', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.ranobelib.me/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://ranobelib.me/some-ranobe' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('ranobelib');
        });

        it('Adds configured headers for mangalib service', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.mangalib.me/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            });
            const custom = result.requestHeaders.find(h => h.name === 'X-Custom');
            expect(custom.value).toBe('mangalib');
        });

        it('Adds image headers for mangalib image requests', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://img.mixlib.me/some-image.jpg',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            });
            const accept = result.requestHeaders.find(h => h.name === 'Accept');
            expect(accept.value).toBe('image/webp');
        });

        it('Updates existing header instead of adding duplicate', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.mangalib.me/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                    { name: 'Accept', value: 'old-value' },
                ],
            });
            const accepts = result.requestHeaders.filter(h => h.name === 'Accept');
            expect(accepts).toHaveLength(1);
            expect(accepts[0].value).toBe('text/html');
        });

        it('Does not track rate limit when service is not detected', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://example.com/page',
                requestHeaders: [
                    { name: 'Referer', value: 'https://example.com/' },
                ],
            });
            expect(mockTrackRequest).not.toHaveBeenCalled();
        });

        it('Detects extension request by originUrl', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: 5,
                frameId: 0,
                originUrl: 'moz-extension://abc/popup.html',
                url: 'https://api.mangalib.me/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            });
            expect(result.requestHeaders).toBeDefined();
        });

        it('Detects extension request by documentUrl', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: 5,
                frameId: 0,
                documentUrl: 'moz-extension://abc/popup.html',
                url: 'https://api.mangalib.me/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            });
            expect(result.requestHeaders).toBeDefined();
        });

        it('Detects mangalib by image url when no referer', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://img.mixlib.me/image.jpg',
                requestHeaders: [],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Detects mangalib by imglib.info url', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://cdn.imglib.info/image.jpg',
                requestHeaders: [],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Detects mangalib by imgslib.link url', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://cdn.imgslib.link/image.jpg',
                requestHeaders: [],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Returns headers without modification when no service config', async () => {
            const headers = [{ name: 'X-Test', value: 'val' }];
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://other.com/page',
                requestHeaders: [...headers],
            });
            expect(result.requestHeaders).toEqual(headers);
        });
    });

    describe('Chrome mode', () => {
        beforeEach(async () => {
            setupGlobals('chrome');
            await loadModule();
        });

        it('Registers webRequest listener without blocking', () => {
            expect(mockAddListenerBeforeSendHeaders).toHaveBeenCalledWith(
                expect.any(Function),
                { urls: ['<all_urls>'] },
                ['requestHeaders'],
            );
        });

        it('Tracks rate limit for detected service', async () => {
            await capturedBeforeSendHeadersCb({
                url: 'https://api.mangalib.me/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                    { name: 'X-Extension-Request', value: 'true' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Does not track when not from extension', async () => {
            await capturedBeforeSendHeadersCb({
                url: 'https://api.mangalib.me/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            });
            expect(mockTrackRequest).not.toHaveBeenCalled();
        });

        it('Returns undefined for non-extension requests', async () => {
            const result = await capturedBeforeSendHeadersCb({
                url: 'https://example.com',
                requestHeaders: [],
            });
            expect(result).toBeUndefined();
        });

        it('Detects extension by x-extension-request header', async () => {
            await capturedBeforeSendHeadersCb({
                url: 'https://api.ranobelib.me/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://ranobelib.me/' },
                    { name: 'X-Extension-Request', value: 'true' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('ranobelib');
        });
    });

    describe('Message handler', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
        });

        it('Handles setRateLimit action', () => {
            const sendResponse = vi.fn();
            const result = capturedMessageCb({ action: 'setRateLimit', limit: 100 }, {}, sendResponse);
            expect(mockSetLimit).toHaveBeenCalledWith(100);
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
            expect(result).toBe(true);
        });

        it('Handles getRateLimiterStats action', () => {
            const sendResponse = vi.fn();
            const result = capturedMessageCb({ action: 'getRateLimiterStats' }, {}, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith({ ok: true, stats: { rpm: 10 } });
            expect(result).toBe(true);
        });

        it('Handles fetchImage success', async () => {
            const blob = new Blob(['img'], { type: 'image/jpeg' });
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                blob: vi.fn().mockResolvedValue(blob),
            });

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.com/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({ ok: true, base64: expect.any(String), contentType: expect.any(String) }),
            );
        });

        it('Handles fetchImage with custom referer', async () => {
            const blob = new Blob(['img'], { type: 'image/png' });
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                blob: vi.fn().mockResolvedValue(blob),
            });

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'fetchImage', url: 'https://img.com/a.jpg', referer: 'https://ranobelib.me/' },
                {},
                sendResponse,
            );

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'https://img.com/a.jpg',
                expect.objectContaining({
                    headers: expect.objectContaining({ 'Referer': 'https://ranobelib.me/' }),
                }),
            );
        });

        it('Handles fetchImage http error', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.com/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'HTTP 404' });
        });

        it('Handles fetchImage empty blob', async () => {
            const blob = new Blob([], { type: 'image/jpeg' });
            Object.defineProperty(blob, 'size', { value: 0 });
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                blob: vi.fn().mockResolvedValue(blob),
            });

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.com/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Empty response' });
        });

        it('Handles fetchImage fetch exception', async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.com/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('network error') });
        });

        it('Handles fetchImage with FileReader error', async () => {
            const blob = new Blob(['img'], { type: 'image/jpeg' });
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                blob: vi.fn().mockResolvedValue(blob),
            });
            globalThis.FileReader = class {
                readAsDataURL() {
                    setTimeout(() => { this.onerror(new Error('read fail')); }, 0);
                }
            };

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.com/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('read fail') });
        });

        it('Handles fetchWithRateLimit success', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: vi.fn().mockResolvedValue('{"data":1}'),
                headers: { get: vi.fn().mockReturnValue('application/json') },
            });

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'fetchWithRateLimit', url: 'https://api.mangalib.me/data' },
                {},
                sendResponse,
            );

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({
                ok: true,
                status: 200,
                body: '{"data":1}',
                contentType: 'application/json',
            });
        });

        it('Handles fetchWithRateLimit with custom options', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: vi.fn().mockResolvedValue('ok'),
                headers: { get: vi.fn().mockReturnValue('text/plain') },
            });

            const sendResponse = vi.fn();
            capturedMessageCb(
                {
                    action: 'fetchWithRateLimit',
                    url: 'https://api.mangalib.me/data',
                    options: { credentials: 'same-origin', headers: { 'X-Test': '1' } },
                },
                {},
                sendResponse,
            );

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'https://api.mangalib.me/data',
                expect.objectContaining({ credentials: 'same-origin' }),
            );
        });

        it('Handles fetchWithRateLimit uses default credentials in firefox', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: vi.fn().mockResolvedValue(''),
                headers: { get: vi.fn().mockReturnValue(null) },
            });

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'fetchWithRateLimit', url: 'https://example.com', options: {} },
                {},
                sendResponse,
            );

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'https://example.com',
                expect.objectContaining({ credentials: 'include' }),
            );
        });

        it('Handles fetchWithRateLimit http error', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            });

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'fetchWithRateLimit', url: 'https://api.mangalib.me/data' },
                {},
                sendResponse,
            );

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            });
        });

        it('Handles fetchWithRateLimit fetch exception', async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(new Error('timeout'));

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'fetchWithRateLimit', url: 'https://api.mangalib.me/data' },
                {},
                sendResponse,
            );

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('timeout') });
        });

        it('Handles takeOverDownload success', async () => {
            const sendResponse = vi.fn();
            capturedMessageCb(
                {
                    action: 'takeOverDownload',
                    slug: 'my-manga',
                    serviceKey: 'mangalib',
                    format: 'epub',
                    manga: { title: 'T' },
                    coverBase64: 'b64',
                    chapterContents: [],
                    chapters: [],
                    currentChapterIndex: 0,
                    currentStatus: 'ok',
                    currentProgress: 50,
                    loadedFile: null,
                },
                {},
                sendResponse,
            );

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(mockTakeOverDownload).toHaveBeenCalledWith(
                expect.objectContaining({ slug: 'my-manga', serviceKey: 'mangalib' }),
            );
            expect(sendResponse).toHaveBeenCalledWith({ ok: true, downloadId: 'bg_1' });
        });

        it('Handles takeOverDownload error', async () => {
            mockTakeOverDownload.mockRejectedValueOnce(new Error('take fail'));

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'takeOverDownload', slug: 's', serviceKey: 'mangalib', format: 'epub', manga: {}, chapters: [] },
                {},
                sendResponse,
            );

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('take fail') });
        });

        it('Handles getActiveDownloads action', () => {
            mockGetActiveDownloads.mockReturnValue([{ id: 'd1' }]);
            const sendResponse = vi.fn();
            const result = capturedMessageCb({ action: 'getActiveDownloads' }, {}, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith({ ok: true, downloads: [{ id: 'd1' }] });
            expect(result).toBe(true);
        });

        it('Handles pauseBackgroundDownload action', () => {
            const sendResponse = vi.fn();
            const result = capturedMessageCb({ action: 'pauseBackgroundDownload', downloadId: 'd1' }, {}, sendResponse);
            expect(mockPause).toHaveBeenCalledWith('d1');
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
            expect(result).toBe(true);
        });

        it('Handles resumeBackgroundDownload action', () => {
            const sendResponse = vi.fn();
            const result = capturedMessageCb({ action: 'resumeBackgroundDownload', downloadId: 'd1' }, {}, sendResponse);
            expect(mockResume).toHaveBeenCalledWith('d1');
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
            expect(result).toBe(true);
        });

        it('Handles stopBackgroundDownload action', () => {
            const sendResponse = vi.fn();
            const result = capturedMessageCb({ action: 'stopBackgroundDownload', downloadId: 'd1' }, {}, sendResponse);
            expect(mockStop).toHaveBeenCalledWith('d1');
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
            expect(result).toBe(true);
        });
    });

    describe('onBeforeRequest ad blocking', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
        });

        it('Blocks slider items from mangalib page', () => {
            const result = capturedOnBeforeRequestCb({
                documentUrl: 'https://mangalib.me/some-manga',
                url: 'https://mangalib.me/uploads/slider_items/banner.jpg',
            });
            expect(result).toEqual({ cancel: true });
        });

        it('Blocks yandex from mangalib page', () => {
            const result = capturedOnBeforeRequestCb({
                documentUrl: 'https://mangalib.me/some-manga',
                url: 'https://yandex.ru/metrika/watch.js',
            });
            expect(result).toEqual({ cancel: true });
        });

        it('Blocks requests from mangalib.org page', () => {
            const result = capturedOnBeforeRequestCb({
                documentUrl: 'https://mangalib.org/some-manga',
                url: 'https://yandex.ru/some-script.js',
            });
            expect(result).toEqual({ cancel: true });
        });

        it('Blocks requests from ranobelib page', () => {
            const result = capturedOnBeforeRequestCb({
                documentUrl: 'https://ranobelib.me/some-ranobe',
                url: 'https://yandex.ru/ads.js',
            });
            expect(result).toEqual({ cancel: true });
        });

        it('Does not block non-matching urls from service page', () => {
            const result = capturedOnBeforeRequestCb({
                documentUrl: 'https://mangalib.me/some-manga',
                url: 'https://cdn.mangalib.me/chapter-image.jpg',
            });
            expect(result).toBeUndefined();
        });

        it('Does not block matching urls from non-service page', () => {
            const result = capturedOnBeforeRequestCb({
                documentUrl: 'https://example.com/page',
                url: 'https://yandex.ru/metrika/watch.js',
            });
            expect(result).toBeUndefined();
        });

        it('Handles missing documentUrl gracefully', () => {
            const result = capturedOnBeforeRequestCb({
                url: 'https://yandex.ru/metrika/watch.js',
            });
            expect(result).toBeUndefined();
        });

        it('Uses initiator field as fallback', () => {
            const result = capturedOnBeforeRequestCb({
                initiator: 'https://mangalib.me',
                url: 'https://yandex.ru/ads.js',
            });
            expect(result).toEqual({ cancel: true });
        });

        it('Uses originUrl field as fallback', () => {
            const result = capturedOnBeforeRequestCb({
                originUrl: 'https://ranobelib.me/page',
                url: 'https://mangalib.me/uploads/slider_items/item.jpg',
            });
            expect(result).toEqual({ cancel: true });
        });
    });

    describe('Helper functions', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
        });

        it('Detects ranobelib image url', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://ranobelib.me/uploads/image.jpg',
                requestHeaders: [],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('ranobelib');
        });

        it('Detects image request with covers path', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://cdn.example.com/covers/thumb.jpg',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            });
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://cdn.example.com/covers/thumb.jpg',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            });
            const accept = result.requestHeaders.find(h => h.name === 'Accept');
            expect(accept.value).toBe('image/webp');
        });

        it('Detects image request with uploads path', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://cdn.example.com/uploads/image.jpg',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            });
            const accept = result.requestHeaders.find(h => h.name === 'Accept');
            expect(accept.value).toBe('image/webp');
        });

        it('Detects extension request by no tabId', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: 0,
                frameId: 0,
                url: 'https://api.mangalib.me/',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            });
            expect(result.requestHeaders).toBeDefined();
        });

        it('Applies ranobelib headers without imageHeaders fallback', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://ranobelib.me/uploads/image.jpg',
                requestHeaders: [
                    { name: 'Referer', value: 'https://ranobelib.me/' },
                ],
            });
            const custom = result.requestHeaders.find(h => h.name === 'X-Custom');
            expect(custom.value).toBe('ranobelib');
        });
    });

    describe('No browser API available', () => {
        it('Does not crash when no browser API', async () => {
            setupGlobals('none');
            await expect(loadModule()).resolves.not.toThrow();
        });
    });

    describe('Global initialization', () => {
        it('Uses globalRateLimiter when available', async () => {
            setupGlobals('firefox');
            await loadModule();
            expect(globalThis.RateLimiter).not.toHaveBeenCalled();
        });

        it('Creates new RateLimiter when globalRateLimiter is missing', async () => {
            setupGlobals('firefox');
            globalThis.globalRateLimiter = null;
            globalThis.RateLimiter = vi.fn(function () {
                this.trackRequest = mockTrackRequest;
                this.setLimit = mockSetLimit;
                this.getStats = mockGetStats;
            });
            await loadModule();
            expect(globalThis.RateLimiter).toHaveBeenCalledWith({ maxRequestsPerMinute: 80 });
        });

        it('Loads mangalib config into ServiceConfigs', async () => {
            setupGlobals('firefox');
            await loadModule();
            expect(mockAddListenerBeforeSendHeaders).toHaveBeenCalled();
        });

        it('Loads ranobelib config into ServiceConfigs', async () => {
            setupGlobals('firefox');
            await loadModule();
            expect(mockAddListenerBeforeSendHeaders).toHaveBeenCalled();
        });

        it('Skips mangalib config when not defined', async () => {
            setupGlobals('firefox');
            delete globalThis.mangalibConfig;
            await loadModule();
            expect(mockAddListenerBeforeSendHeaders).toHaveBeenCalled();
        });

        it('Skips ranobelib config when not defined', async () => {
            setupGlobals('firefox');
            delete globalThis.ranolibConfig;
            await loadModule();
            expect(mockAddListenerBeforeSendHeaders).toHaveBeenCalled();
        });
    });

    describe('Chrome credentials', () => {
        beforeEach(async () => {
            setupGlobals('chrome');
            await loadModule();
        });

        it('Uses omit credentials for fetchImage in chrome', async () => {
            const blob = new Blob(['img'], { type: 'image/jpeg' });
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                blob: vi.fn().mockResolvedValue(blob),
            });

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.com/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'https://img.com/a.jpg',
                expect.objectContaining({ credentials: 'omit' }),
            );
        });

        it('Uses omit credentials for fetchWithRateLimit in chrome', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: vi.fn().mockResolvedValue(''),
                headers: { get: vi.fn().mockReturnValue(null) },
            });

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'fetchWithRateLimit', url: 'https://example.com', options: {} },
                {},
                sendResponse,
            );

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'https://example.com',
                expect.objectContaining({ credentials: 'omit' }),
            );
        });
    });
});