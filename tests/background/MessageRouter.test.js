import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mockTrackRequest;
let mockSetLimit;
let mockGetStats;
let mockThrottle;
let mockAddListenerOnMessage;
let capturedMessageCb;
let isFirefoxMode;

function setupGlobals(mode) {
    delete globalThis.getExtensionApi;

    isFirefoxMode = mode === 'firefox';

    mockTrackRequest = vi.fn().mockResolvedValue();
    mockSetLimit = vi.fn();
    mockGetStats = vi.fn().mockReturnValue({ rpm: 10 });
    mockThrottle = vi.fn();

    globalThis.globalRateLimiter = {
        trackRequest: mockTrackRequest,
        setLimit: mockSetLimit,
        getStats: mockGetStats,
        throttle: mockThrottle,
    };
    globalThis.RateLimiter = vi.fn(() => globalThis.globalRateLimiter);

    globalThis.authTokenStore = {};

    globalThis.detectServiceByUrl = (url) => {
        if (url.includes('ranobelib.me')) return 'ranobelib';
        if (url.includes('mangalib.me') || url.includes('mangalib.org')) return 'mangalib';
        if (url.includes('mixlib.me') || url.includes('imglib.info') || url.includes('imgslib.link')) return 'mangalib';
        if (url.includes('cdnlibs.org')) return 'mangalib';
        return null;
    };

    capturedMessageCb = null;
    mockAddListenerOnMessage = vi.fn((cb) => { capturedMessageCb = cb; });

    const apiObj = {
        webRequest: {
            onBeforeSendHeaders: { addListener: vi.fn() },
            onBeforeRequest: { addListener: vi.fn() },
        },
        runtime: {
            onMessage: { addListener: mockAddListenerOnMessage },
            getURL: vi.fn(p => `moz-extension://test-id/${p}`),
            id: 'test-ext-id',
        },
    };

    if (mode === 'chrome') {
        delete globalThis.browser;
        globalThis.chrome = { ...apiObj, declarativeNetRequest: {} };
    } else if (mode === 'firefox') {
        delete globalThis.chrome;
        globalThis.browser = apiObj;
    } else {
        delete globalThis.chrome;
        delete globalThis.browser;
    }

    globalThis.fetch = vi.fn();

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
}

async function loadModule() {
    vi.resetModules();
    globalThis.authTokenStore = {};
    await import('../../background/MessageRouter.js');
}

describe('MessageRouter', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.detectServiceByUrl;
        delete globalThis.authTokenStore;
    });

    describe('Message handler', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
        });

        it('Registers message listener', () => {
            expect(mockAddListenerOnMessage).toHaveBeenCalledWith(expect.any(Function));
        });

        it('Returns false for unknown message action', () => {
            const sendResponse = vi.fn();
            const result = capturedMessageCb({ action: 'unknownAction' }, {}, sendResponse);
            expect(result).toBe(false);
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

        it('Handles getAuthToken returns null when no serviceKey provided', () => {
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'getAuthToken' }, {}, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith({ token: null });
        });

        it('Handles getAuthToken returns null for uncached service', () => {
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'getAuthToken', serviceKey: 'mangalib' }, {}, sendResponse);
            expect(sendResponse).toHaveBeenCalledWith({ token: null });
        });

        it('Handles cacheAuthToken stores token and getAuthToken retrieves it', () => {
            const cacheResp = vi.fn();
            capturedMessageCb({ action: 'cacheAuthToken', serviceKey: 'mangalib', token: 'abc123' }, {}, cacheResp);
            expect(cacheResp).toHaveBeenCalledWith({ ok: true });
            const getResp = vi.fn();
            capturedMessageCb({ action: 'getAuthToken', serviceKey: 'mangalib' }, {}, getResp);
            expect(getResp).toHaveBeenCalledWith({ token: 'abc123' });
        });

        it('Handles cacheAuthToken skips storage when serviceKey or token missing', () => {
            const cacheResp = vi.fn();
            capturedMessageCb({ action: 'cacheAuthToken', serviceKey: 'mangalib' }, {}, cacheResp);
            expect(cacheResp).toHaveBeenCalledWith({ ok: true });
            const getResp = vi.fn();
            capturedMessageCb({ action: 'getAuthToken', serviceKey: 'mangalib' }, {}, getResp);
            expect(getResp).toHaveBeenCalledWith({ token: null });
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

        it('Handles fetchWithRateLimit uses default credentials include in firefox', async () => {
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

        it('Handles fetchWithRateLimit tracks ranobelib service', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true, status: 200,
                text: vi.fn().mockResolvedValue(''),
                headers: { get: vi.fn().mockReturnValue(null) },
            });

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'fetchWithRateLimit', url: 'https://ranobelib.me/api/v2/manga' },
                {},
                sendResponse,
            );

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(mockTrackRequest).toHaveBeenCalledWith('ranobelib');
        });

        it('Handles fetchWithRateLimit throttles and retries on 429', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            globalThis.fetch = vi.fn()
                .mockResolvedValueOnce({ ok: false, status: 429 })
                .mockResolvedValue({
                    ok: true, status: 200,
                    text: vi.fn().mockResolvedValue('ok'),
                    headers: { get: vi.fn().mockReturnValue('text/plain') },
                });

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchWithRateLimit', url: 'https://mangalib.me/api/test' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fetchWithRateLimit 429 on attempt 1'));
            expect(mockThrottle).toHaveBeenCalledWith(30000);
            expect(mockTrackRequest).toHaveBeenCalledWith('429-retry');
        });

        it('Handles fetchImage success via tabs proxy', async () => {
            const mockQuery = vi.fn().mockResolvedValue([{ id: 42 }]);
            const mockSendMessage = vi.fn().mockResolvedValue({ ok: true, base64: 'AAAA', contentType: 'image/jpeg' });
            globalThis.browser.tabs = { query: mockQuery, sendMessage: mockSendMessage };

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.mixlib.me/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(mockQuery).toHaveBeenCalledWith({ url: expect.arrayContaining(['*://mangalib.me/*']) });
            expect(mockSendMessage).toHaveBeenCalledWith(42, { action: 'fetchImageFromTab', url: 'https://img.mixlib.me/a.jpg' });
            expect(sendResponse).toHaveBeenCalledWith({ ok: true, base64: 'AAAA', contentType: 'image/jpeg' });
        });

        it('Handles fetchImage queries ranobelib tabs for ranobelib url', async () => {
            const mockQuery = vi.fn().mockResolvedValue([{ id: 7 }]);
            const mockSendMessage = vi.fn().mockResolvedValue({ ok: true, base64: 'BBBB', contentType: 'image/png' });
            globalThis.browser.tabs = { query: mockQuery, sendMessage: mockSendMessage };

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://ranobelib.me/uploads/cover.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(mockQuery).toHaveBeenCalledWith({ url: ['*://ranobelib.me/*'] });
        });

        it('Handles fetchImage when no service tab found', async () => {
            globalThis.browser.tabs = {
                query: vi.fn().mockResolvedValue([]),
                sendMessage: vi.fn(),
            };

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.mixlib.me/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'No service tab found' });
        });

        it('Handles fetchImage when content script returns error', async () => {
            globalThis.browser.tabs = {
                query: vi.fn().mockResolvedValue([{ id: 5 }]),
                sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'CORS error' }),
            };

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.mixlib.me/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'CORS error' });
        });

        it('Handles fetchImage when content script returns null result', async () => {
            globalThis.browser.tabs = {
                query: vi.fn().mockResolvedValue([{ id: 5 }]),
                sendMessage: vi.fn().mockResolvedValue(null),
            };

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.mixlib.me/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Content script returned no data' });
        });

        it('Handles fetchImage exception', async () => {
            globalThis.browser.tabs = {
                query: vi.fn().mockRejectedValue(new Error('tabs error')),
                sendMessage: vi.fn(),
            };

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.mixlib.me/a.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('tabs error') });
        });

        it('Handles fetchImage tracks rate limit for detected service', async () => {
            globalThis.browser.tabs = {
                query: vi.fn().mockResolvedValue([{ id: 1 }]),
                sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'X', contentType: 'image/jpeg' }),
            };

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://cover.cdnlibs.org/manga/cover.jpg' }, {}, sendResponse);

            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('isCdnImageUrl returns false for invalid URL (routes through tabs proxy)', async () => {
            globalThis.browser.tabs = {
                query: vi.fn().mockResolvedValue([{ id: 1 }]),
                sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'X', contentType: 'image/jpeg' }),
            };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'not-a-url' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(globalThis.browser.tabs.query).toHaveBeenCalled();
        });

        it('fetchImage routes CDN URL through fetchImageFromBackground (success)', async () => {
            const mockBlob = new Blob(['data'], { type: 'image/png' });
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(mockBlob) });
            const OrigFileReader = globalThis.FileReader;
            globalThis.FileReader = class {
                readAsDataURL() {
                    this.result = 'data:image/png;base64,MOCKBASE64';
                    setTimeout(() => this.onloadend(), 0);
                }
            };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img3.cdnlibs.org/manga/img.jpg' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(globalThis.fetch).toHaveBeenCalledWith('https://img3.cdnlibs.org/manga/img.jpg', { credentials: 'omit' });
            expect(sendResponse).toHaveBeenCalledWith({ ok: true, base64: 'MOCKBASE64', contentType: 'image/png' });
            globalThis.FileReader = OrigFileReader;
        });

        it('fetchImageFromBackground returns HTTP error when response not ok', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img3.cdnlibs.org/img.jpg' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'HTTP 503' });
        });

        it('fetchImageFromBackground returns FileReader error on reader onerror', async () => {
            const mockBlob = new Blob(['x'], { type: 'image/jpeg' });
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(mockBlob) });
            const OrigFileReader = globalThis.FileReader;
            globalThis.FileReader = class {
                readAsDataURL() { setTimeout(() => this.onerror(), 0); }
            };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img3.cdnlibs.org/img.jpg' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'FileReader error' });
            globalThis.FileReader = OrigFileReader;
        });

        it('fetchImageFromBackground returns error when fetch throws', async () => {
            globalThis.fetch = vi.fn().mockRejectedValue(new Error('network failure'));
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img3.cdnlibs.org/img.jpg' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('network failure') });
        });

        it('fetchImageFromBackground uses image/jpeg fallback when blob.type is empty', async () => {
            const mockBlob = new Blob(['data']);
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(mockBlob) });
            const OrigFileReader = globalThis.FileReader;
            globalThis.FileReader = class {
                readAsDataURL() {
                    this.result = 'data:application/octet-stream;base64,AAA';
                    setTimeout(() => this.onloadend(), 0);
                }
            };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img3.cdnlibs.org/img.jpg' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true, base64: 'AAA', contentType: 'image/jpeg' });
            globalThis.FileReader = OrigFileReader;
        });

        it('Handles openDownloadWindow with no tab URL', async () => {
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'openDownloadWindow', format: 'epub' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'No tab URL' });
        });

        it('Handles openDownloadWindow when slug or service cannot be detected', async () => {
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://mangalib.me/some-page' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Cannot detect slug or service' });
        });

        it('Handles openDownloadWindow success and updates window focus', async () => {
            const mockCreate = vi.fn().mockResolvedValue({ id: 42 });
            const mockUpdate = vi.fn().mockResolvedValue({});
            globalThis.browser.windows = { create: mockCreate, update: mockUpdate };

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://mangalib.me/manga/my-manga/chapter-1' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
            expect(mockUpdate).toHaveBeenCalledWith(42, { focused: true });
        });

        it('Handles openDownloadWindow without win.id (no update call)', async () => {
            const mockCreate = vi.fn().mockResolvedValue({});
            const mockUpdate = vi.fn();
            globalThis.browser.windows = { create: mockCreate, update: mockUpdate };

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'fb2' },
                { tab: { url: 'https://ranobelib.me/book/my-ranobe' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
            expect(mockUpdate).not.toHaveBeenCalled();
        });

        it('Handles openDownloadWindow with default format fb2', async () => {
            const mockCreate = vi.fn().mockResolvedValue({ id: 1 });
            globalThis.browser.windows = { create: mockCreate, update: vi.fn() };

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow' },
                { tab: { url: 'https://mangalib.me/manga/slug' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            const createCall = mockCreate.mock.calls[0][0];
            expect(createCall.url).toContain('format=fb2');
        });

        it('Handles openDownloadWindow exception', async () => {
            globalThis.browser.windows = {
                create: vi.fn().mockRejectedValue(new Error('window fail')),
                update: vi.fn(),
            };

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://mangalib.me/manga/my-manga' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('window fail') });
        });

        it('Handles openDownloadWindow when windows.create returns null (ok=false)', async () => {
            globalThis.browser.windows = {
                create: vi.fn().mockResolvedValue(null),
                update: vi.fn(),
            };

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'fb2' },
                { tab: { url: 'https://mangalib.me/manga/my-manga' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'window create' });
        });

        it('Handles openDownloadWindow using tabs.create when windows is unavailable', async () => {
            globalThis.browser.tabs = { create: vi.fn().mockResolvedValue({ id: 5 }) };

            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://mangalib.me/manga/my-manga' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
        });

        it('Handles openDownloadWindow when neither windows nor tabs API is available', async () => {
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://mangalib.me/manga/my-manga' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'No window/tab API available' });
        });

        it('Handles openWindowWithUrl with windows API', async () => {
            const mockCreate = vi.fn().mockResolvedValue({ id: 99 });
            const mockUpdate = vi.fn();
            globalThis.browser.windows = { create: mockCreate, update: mockUpdate };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'openWindowWithUrl', url: 'popup.html?download=true' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
            expect(mockUpdate).toHaveBeenCalledWith(99, { focused: true });
        });

        it('Handles openWindowWithUrl with tabs API when windows unavailable', async () => {
            globalThis.browser.tabs = { create: vi.fn().mockResolvedValue({ id: 5 }) };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'openWindowWithUrl', url: 'popup.html?download=true' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
        });

        it('Handles openWindowWithUrl when neither windows nor tabs API is available', async () => {
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'openWindowWithUrl', url: 'popup.html?download=true' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'No window/tab API available' });
        });

        it('Handles openWindowWithUrl when tabs.create returns null', async () => {
            globalThis.browser.tabs = { create: vi.fn().mockResolvedValue(null) };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'openWindowWithUrl', url: 'popup.html?download=true' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'tab create' });
        });

        it('Handles openWindowWithUrl exception', async () => {
            globalThis.browser.windows = {
                create: vi.fn().mockRejectedValue(new Error('create fail')),
                update: vi.fn(),
            };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'openWindowWithUrl', url: 'popup.html?download=true' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('create fail') });
        });
    });

    describe('Chrome credentials', () => {
        beforeEach(async () => {
            setupGlobals('chrome');
            await loadModule();
        });

        it('Uses omit credentials for fetchWithRateLimit in chrome', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true, status: 200,
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

        it('Initializes authTokenStore when not present', async () => {
            setupGlobals('firefox');
            delete globalThis.authTokenStore;
            await loadModule();
            expect(globalThis.authTokenStore).toBeDefined();
        });

        it('Module itself creates authTokenStore when not pre-set before import', async () => {
            setupGlobals('firefox');
            vi.resetModules();
            delete globalThis.authTokenStore;
            await import('../../background/MessageRouter.js');
            expect(globalThis.authTokenStore).toBeDefined();
        });

        it('Falls back gracefully when detectServiceByUrl is not set', async () => {
            setupGlobals('firefox');
            delete globalThis.detectServiceByUrl;

            globalThis.browser.tabs = {
                query: vi.fn().mockResolvedValue([{ id: 1 }]),
                sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'X', contentType: 'image/jpeg' }),
            };

            await loadModule();

            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'fetchImage', url: 'https://img.mixlib.me/a.jpg' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
        });
    });

    describe('With getExtensionApi defined', () => {
        it('Calls getExtensionApi when defined as a function', async () => {
            setupGlobals('chrome');
            const apiObj = {
                webRequest: { onBeforeSendHeaders: { addListener: vi.fn() }, onBeforeRequest: { addListener: vi.fn() } },
                runtime: { onMessage: { addListener: vi.fn() }, id: 'ext-id', getURL: vi.fn(p => p) },
                declarativeNetRequest: {}
            };
            globalThis.getExtensionApi = vi.fn(() => apiObj);
            globalThis.getBrowserEnv = vi.fn(() => ({
                isFirefox: false,
                isChromium: true,
                supportsDnr: false
            }));
            await loadModule();
            expect(globalThis.getExtensionApi).toHaveBeenCalled();
        });
    });

    describe('fetchImage plugin service paths', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
        });

        it('Uses pluginServiceHosts patterns when serviceKey is a plugin', async () => {
            globalThis.pluginServiceHosts = { myplugin: ['myplugin.com'] };
            globalThis.browser.tabs = {
                query: vi.fn().mockResolvedValue([{ id: 3 }]),
                sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'ZZ', contentType: 'image/webp' }),
            };
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'fetchImage', url: 'https://myplugin.com/img.webp', serviceKey: 'myplugin' },
                {}, sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true, base64: 'ZZ', contentType: 'image/webp' });
            expect(globalThis.browser.tabs.query).toHaveBeenCalledWith({ url: ['*://myplugin.com/*'] });
            delete globalThis.pluginServiceHosts;
        });

        it('Responds with error when pluginServiceHosts has no hosts for service', async () => {
            globalThis.pluginServiceHosts = {};
            globalThis.browser.tabs = { query: vi.fn(), sendMessage: vi.fn() };
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'fetchImage', url: 'https://myplugin.com/img.webp', serviceKey: 'myplugin' },
                {}, sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'No tab patterns for service: myplugin' });
            delete globalThis.pluginServiceHosts;
        });
    });

    describe('openDownloadWindow plugin paths', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
        });

        it('Detects service via pluginServiceHosts when detectServiceByUrl returns null', async () => {
            globalThis.pluginServiceHosts = { myplugin: ['myplugin.com'] };
            const mockCreate = vi.fn().mockResolvedValue({ id: 1 });
            globalThis.browser.windows = { create: mockCreate, update: vi.fn() };
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://myplugin.com/manga/my-slug' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
            const urlArg = mockCreate.mock.calls[0][0].url;
            expect(urlArg).toContain('service=myplugin');
            expect(urlArg).toContain('slug=my-slug');
            delete globalThis.pluginServiceHosts;
        });

        it('Detects service via pluginServiceHosts using subdomain match', async () => {
            globalThis.pluginServiceHosts = { myplugin: ['myplugin.com'] };
            const mockCreate = vi.fn().mockResolvedValue({ id: 1 });
            globalThis.browser.windows = { create: mockCreate, update: vi.fn() };
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://sub.myplugin.com/manga/my-slug' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
            delete globalThis.pluginServiceHosts;
        });

        it('Fails when hostname matches no pluginServiceHosts entry', async () => {
            globalThis.pluginServiceHosts = { myplugin: ['myplugin.com'] };
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://other.com/manga/my-slug' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Cannot detect slug or service' });
            delete globalThis.pluginServiceHosts;
        });

        it('Falls back to empty object when pluginServiceHosts is not defined', async () => {
            delete globalThis.pluginServiceHosts;
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://other.com/manga/my-slug' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Cannot detect slug or service' });
        });

        it('Includes tabId in popup URL when sender.tab.id is present', async () => {
            const mockCreate = vi.fn().mockResolvedValue({ id: 1 });
            globalThis.browser.windows = { create: mockCreate, update: vi.fn() };
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://mangalib.me/manga/my-manga', id: 7 } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            const urlArg = mockCreate.mock.calls[0][0].url;
            expect(urlArg).toContain('tabId=7');
        });
    });

    describe('plugin:cache handler', () => {
        function makeMockIdb({ failOpen = false, failTx = false } = {}) {
            const mockObjectStore = { put: vi.fn() };
            const mockTx = { objectStore: vi.fn(() => mockObjectStore), oncomplete: null, onerror: null };
            const mockDb = { transaction: vi.fn(() => mockTx), close: vi.fn(), createObjectStore: vi.fn() };
            const mockReq = { onsuccess: null, onerror: null, onupgradeneeded: null };
            globalThis.indexedDB = {
                open: vi.fn(() => {
                    Promise.resolve().then(() => {
                        if (failOpen) {
                            mockReq.onerror({ target: { error: new Error('open error') } });
                        } else {
                            mockReq.onupgradeneeded?.({ target: { result: mockDb } });
                            mockReq.onsuccess({ target: { result: mockDb } });
                            Promise.resolve().then(() => {
                                if (failTx) mockTx.onerror({ target: { error: new Error('tx error') } });
                                else mockTx.oncomplete();
                            });
                        }
                    });
                    return mockReq;
                }),
            };
            return { mockObjectStore };
        }

        beforeEach(async () => {
            setupGlobals('firefox');
            globalThis.browser.storage = {
                local: { get: vi.fn().mockResolvedValue({ custom_plugins: [] }) },
                onChanged: { addListener: vi.fn() },
            };
            await loadModule();
        });

        it('Stores plugin in IDB on success', async () => {
            const { mockObjectStore } = makeMockIdb();
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'plugin:cache', format: 'myformat', code: 'console.log(1)' },
                {}, sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true, swStatus: expect.any(String) });
            expect(mockObjectStore.put).toHaveBeenCalledWith({ format: 'myformat', code: 'console.log(1)' });
        });

        it('Handles IDB transaction error', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            makeMockIdb({ failTx: true });
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'plugin:cache', format: 'myformat', code: 'code' },
                {}, sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'tx error', swStatus: expect.any(String) });
        });

        it('Handles IDB open error', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            makeMockIdb({ failOpen: true });
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'plugin:cache', format: 'myformat', code: 'code' },
                {}, sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'open error', swStatus: expect.any(String) });
        });
    });

    describe('plugin:cache in SW context', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            globalThis.importScripts = vi.fn();
            globalThis.browser.storage = {
                local: { get: vi.fn().mockResolvedValue({ custom_plugins: [] }) },
                onChanged: { addListener: vi.fn() },
            };
            await loadModule();
        });

        afterEach(() => {
            delete globalThis.importScripts;
            delete globalThis.caches;
        });

        it('Stores plugin via Cache API in SW context', async () => {
            const mockPut = vi.fn().mockResolvedValue();
            globalThis.caches = { open: vi.fn().mockResolvedValue({ put: mockPut }) };
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'plugin:cache', format: 'sw-fmt', code: 'code here' },
                {}, sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true, swStatus: 'sw-background' });
            expect(globalThis.caches.open).toHaveBeenCalledWith('dl-plugins-v1');
            expect(mockPut).toHaveBeenCalledWith('/plugin-runtime/sw-fmt.js', expect.any(Object));
        });

        it('Handles Cache API error in SW context', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            globalThis.caches = { open: vi.fn().mockRejectedValue(new Error('cache error')) };
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'plugin:cache', format: 'sw-fmt', code: 'code' },
                {}, sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'cache error', swStatus: 'sw-background' });
        });
    });

    describe('_getSwStatus paths via plugin:cache', () => {
        function makeMockIdb() {
            const mockTx = { objectStore: vi.fn(() => ({ put: vi.fn() })), oncomplete: null, onerror: null };
            const mockDb = { transaction: vi.fn(() => mockTx), close: vi.fn(), createObjectStore: vi.fn() };
            const mockReq = { onsuccess: null, onerror: null, onupgradeneeded: null };
            globalThis.indexedDB = {
                open: vi.fn(() => {
                    Promise.resolve().then(() => {
                        mockReq.onsuccess({ target: { result: mockDb } });
                        Promise.resolve().then(() => mockTx.oncomplete());
                    });
                    return mockReq;
                }),
            };
        }

        let origNavigator;

        beforeEach(async () => {
            setupGlobals('firefox');
            globalThis.browser.storage = {
                local: { get: vi.fn().mockResolvedValue({ custom_plugins: [] }) },
                onChanged: { addListener: vi.fn() },
            };
            makeMockIdb();
            origNavigator = globalThis.navigator;
            await loadModule();
        });

        afterEach(() => {
            globalThis.navigator = origNavigator;
        });

        it('Returns not-registered when no SW registration found', async () => {
            globalThis.navigator = { serviceWorker: { getRegistration: vi.fn().mockResolvedValue(null) } };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'plugin:cache', format: 'f', code: 'c' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse.mock.calls[0][0].swStatus).toBe('not-registered');
        });

        it('Returns registered:activated when active SW found', async () => {
            globalThis.navigator = {
                serviceWorker: {
                    getRegistration: vi.fn().mockResolvedValue({ active: { state: 'activated' }, installing: null, waiting: null }),
                },
            };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'plugin:cache', format: 'f', code: 'c' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse.mock.calls[0][0].swStatus).toBe('registered:activated');
        });

        it('Returns registered:installing from installing state', async () => {
            globalThis.navigator = {
                serviceWorker: {
                    getRegistration: vi.fn().mockResolvedValue({ active: null, installing: { state: 'installing' }, waiting: null }),
                },
            };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'plugin:cache', format: 'f', code: 'c' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse.mock.calls[0][0].swStatus).toBe('registered:installing');
        });

        it('Returns registered:unknown when SW has no recognizable state', async () => {
            globalThis.navigator = {
                serviceWorker: { getRegistration: vi.fn().mockResolvedValue({}) },
            };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'plugin:cache', format: 'f', code: 'c' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse.mock.calls[0][0].swStatus).toBe('registered:unknown');
        });

        it('Returns error string when getRegistration throws', async () => {
            globalThis.navigator = {
                serviceWorker: { getRegistration: vi.fn().mockRejectedValue(new Error('sw error')) },
            };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'plugin:cache', format: 'f', code: 'c' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse.mock.calls[0][0].swStatus).toBe('error:sw error');
        });
    });

    describe('plugin:exec handler', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            globalThis.browser.storage = {
                local: { get: vi.fn().mockResolvedValue({ custom_plugins: [] }) },
                onChanged: { addListener: vi.fn() },
            };
            await loadModule();
        });

        it('Executes plugin script in specified tab', async () => {
            const mockExecuteScript = vi.fn().mockResolvedValue();
            globalThis.browser.scripting = { executeScript: mockExecuteScript };
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'plugin:exec', tabId: 42, code: 'console.log("hi")' },
                {}, sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: true });
            expect(mockExecuteScript).toHaveBeenCalledWith({
                target: { tabId: 42 },
                func: expect.any(Function),
                args: ['console.log("hi")'],
            });
            // Invoke the func argument to cover the eval line
            const funcArg = mockExecuteScript.mock.calls[0][0].func;
            expect(() => funcArg('1+1')).not.toThrow();
        });

        it('Responds with error when scripting.executeScript not available', async () => {
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'plugin:exec', tabId: 42, code: 'code' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'scripting.executeScript not available' });
        });

        it('Responds with error when tabId is missing', async () => {
            globalThis.browser.scripting = { executeScript: vi.fn() };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'plugin:exec', code: 'code' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'No tabId provided' });
        });

        it('Responds with error when executeScript throws', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            globalThis.browser.scripting = {
                executeScript: vi.fn().mockRejectedValue(new Error('exec error')),
            };
            const sendResponse = vi.fn();
            capturedMessageCb({ action: 'plugin:exec', tabId: 10, code: 'code' }, {}, sendResponse);
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'exec error' });
        });
    });

    describe('_syncPluginContentScripts', () => {
        let mockRegister;
        let mockGetRegistered;
        let mockUnregister;
        let capturedStorageChangeCb;

        async function setupWithScripting(plugins = []) {
            setupGlobals('firefox');
            mockRegister = vi.fn().mockResolvedValue();
            mockGetRegistered = vi.fn().mockResolvedValue([]);
            mockUnregister = vi.fn().mockResolvedValue();
            capturedStorageChangeCb = null;

            globalThis.browser.scripting = {
                registerContentScripts: mockRegister,
                getRegisteredContentScripts: mockGetRegistered,
                unregisterContentScripts: mockUnregister,
            };
            globalThis.browser.storage = {
                local: { get: vi.fn().mockResolvedValue({ custom_plugins: plugins }) },
                onChanged: { addListener: vi.fn(cb => { capturedStorageChangeCb = cb; }) },
            };

            await loadModule();
            await vi.waitFor(() => expect(mockGetRegistered).toHaveBeenCalled());
        }

        it('Returns early when scripting API not available', async () => {
            setupGlobals('firefox');
            globalThis.browser.storage = {
                local: { get: vi.fn().mockResolvedValue({}) },
                onChanged: { addListener: vi.fn() },
            };
            await loadModule();
            expect(mockAddListenerOnMessage).toHaveBeenCalled();
        });

        it('Uses empty array when custom_plugins key is absent from storage', async () => {
            setupGlobals('firefox');
            mockRegister = vi.fn().mockResolvedValue();
            mockGetRegistered = vi.fn().mockResolvedValue([]);
            mockUnregister = vi.fn().mockResolvedValue();
            globalThis.browser.scripting = {
                registerContentScripts: mockRegister,
                getRegisteredContentScripts: mockGetRegistered,
                unregisterContentScripts: mockUnregister,
            };
            globalThis.browser.storage = {
                local: { get: vi.fn().mockResolvedValue({}) }, // no custom_plugins key
                onChanged: { addListener: vi.fn() },
            };
            await loadModule();
            await vi.waitFor(() => expect(mockGetRegistered).toHaveBeenCalled());
            expect(mockRegister).not.toHaveBeenCalled();
        });

        it('Registers content scripts for enabled plugins', async () => {
            await setupWithScripting([{ service: 'myplugin', hosts: ['myplugin.com'], enabled: true }]);
            await vi.waitFor(() => expect(mockRegister).toHaveBeenCalledWith([{
                id: 'dl-plugin-myplugin',
                matches: ['https://myplugin.com/*'],
                js: ['/content/AdCleaner.js', '/content/DownloadButton.js', '/content/ImageFetcher.js'],
                runAt: 'document_idle',
            }]));
            expect(globalThis.pluginServiceHosts).toEqual({ myplugin: ['myplugin.com'] });
        });

        it('Uses format as key when service is absent', async () => {
            await setupWithScripting([{ format: 'myformat', hosts: ['myformat.com'] }]);
            await vi.waitFor(() => expect(mockRegister).toHaveBeenCalledWith([expect.objectContaining({ id: 'dl-plugin-myformat' })]));
        });

        it('Skips plugins with no service or format key', async () => {
            await setupWithScripting([{ hosts: ['myplugin.com'] }]);
            expect(mockRegister).not.toHaveBeenCalled();
        });

        it('Skips disabled plugins', async () => {
            await setupWithScripting([{ service: 'myplugin', hosts: ['myplugin.com'], enabled: false }]);
            expect(mockRegister).not.toHaveBeenCalled();
        });

        it('Skips plugins with no hosts', async () => {
            await setupWithScripting([{ service: 'myplugin', hosts: [] }]);
            expect(mockRegister).not.toHaveBeenCalled();
        });

        it('Unregisters old plugin scripts before registering new ones', async () => {
            setupGlobals('firefox');
            mockRegister = vi.fn().mockResolvedValue();
            mockGetRegistered = vi.fn().mockResolvedValue([
                { id: 'dl-plugin-oldplugin' },
                { id: 'other-script' },
            ]);
            mockUnregister = vi.fn().mockResolvedValue();

            globalThis.browser.scripting = {
                registerContentScripts: mockRegister,
                getRegisteredContentScripts: mockGetRegistered,
                unregisterContentScripts: mockUnregister,
            };
            globalThis.browser.storage = {
                local: { get: vi.fn().mockResolvedValue({ custom_plugins: [{ service: 'myplugin', hosts: ['myplugin.com'] }] }) },
                onChanged: { addListener: vi.fn() },
            };

            await loadModule();
            await vi.waitFor(() => expect(mockRegister).toHaveBeenCalled());
            expect(mockUnregister).toHaveBeenCalledWith({ ids: ['dl-plugin-oldplugin'] });
        });

        it('Does not call unregister when no old plugin scripts exist', async () => {
            await setupWithScripting([{ service: 'myplugin', hosts: ['myplugin.com'] }]);
            expect(mockUnregister).not.toHaveBeenCalled();
        });

        it('Handles error during sync gracefully', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            setupGlobals('firefox');
            globalThis.browser.scripting = {
                registerContentScripts: vi.fn(),
                getRegisteredContentScripts: vi.fn().mockRejectedValue(new Error('scripting error')),
                unregisterContentScripts: vi.fn(),
            };
            globalThis.browser.storage = {
                local: { get: vi.fn().mockResolvedValue({ custom_plugins: [] }) },
                onChanged: { addListener: vi.fn() },
            };
            await loadModule();
            await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
                '[MessageRouter] Failed to sync plugin content scripts:', 'scripting error',
            ));
        });

        it('Triggers sync when storage.onChanged fires with custom_plugins in local area', async () => {
            await setupWithScripting([]);
            mockGetRegistered.mockClear();
            capturedStorageChangeCb({ custom_plugins: { newValue: [] } }, 'local');
            await vi.waitFor(() => expect(mockGetRegistered).toHaveBeenCalled());
        });

        it('Does not trigger sync for non-local area changes', async () => {
            await setupWithScripting([]);
            mockGetRegistered.mockClear();
            capturedStorageChangeCb({ custom_plugins: {} }, 'sync');
            await new Promise(r => setTimeout(r, 30));
            expect(mockGetRegistered).not.toHaveBeenCalled();
        });

        it('Does not trigger sync when changed key is not custom_plugins', async () => {
            await setupWithScripting([]);
            mockGetRegistered.mockClear();
            capturedStorageChangeCb({ other_key: {} }, 'local');
            await new Promise(r => setTimeout(r, 30));
            expect(mockGetRegistered).not.toHaveBeenCalled();
        });

        it('Does not register storage.onChanged listener when storage API unavailable', async () => {
            setupGlobals('firefox');
            await loadModule();
            expect(mockAddListenerOnMessage).toHaveBeenCalled();
        });
    });
});
