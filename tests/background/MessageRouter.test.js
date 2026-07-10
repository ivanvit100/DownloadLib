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
});
