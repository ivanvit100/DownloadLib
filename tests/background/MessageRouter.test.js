import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../core/RateLimiter.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('globalRateLimiter'));
vi.mock('../../background/RequestInterceptor.js', async () => (await import('../helpers/globalBridge.js'))
    .globalBridge({ authTokens: 'authTokenStore' }));

let mockTrackRequest;
let mockSetLimit;
let mockGetStats;
let mockThrottle;
let mockAddListenerOnMessage;
let capturedMessageCb;
let mockAddListenerOnConnect;
let capturedConnectCb;
let isFirefoxMode;

function setupGlobals(mode) {
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

    globalThis.authTokenStore = {};

    capturedMessageCb = null;
    mockAddListenerOnMessage = vi.fn((cb) => { capturedMessageCb = cb; });

    capturedConnectCb = null;
    mockAddListenerOnConnect = vi.fn((cb) => { capturedConnectCb = cb; });

    const apiObj = {
        webRequest: {
            onBeforeSendHeaders: { addListener: vi.fn() },
            onBeforeRequest: { addListener: vi.fn() },
        },
        runtime: {
            onMessage: { addListener: mockAddListenerOnMessage },
            onConnect: { addListener: mockAddListenerOnConnect },
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

async function loadWithPlugins(plugins) {
    setupGlobals('firefox');
    const storageGet = vi.fn().mockResolvedValue({ custom_plugins: plugins });
    globalThis.browser.storage = { local: { get: storageGet } };
    await loadModule();
    await vi.waitFor(() => expect(storageGet).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 0));
}

async function detectedServiceFor(url) {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    globalThis.browser.windows = { create, update: vi.fn() };
    const sendResponse = vi.fn();
    capturedMessageCb({ action: 'openDownloadWindow' }, { tab: { url } }, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    const popupUrl = create.mock.calls[0]?.[0]?.url;
    return popupUrl ? new URLSearchParams(popupUrl.split('?')[1]).get('service') : null;
}

describe('MessageRouter', () => {
    afterEach(() => {
        vi.restoreAllMocks();
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

        it('Does not handle the removed fetchImage action', () => {
            const sendResponse = vi.fn();
            expect(capturedMessageCb({ action: 'fetchImage', url: 'https://img3.mixlib.me/a.jpg' }, {}, sendResponse))
                .toBe(false);
            expect(sendResponse).not.toHaveBeenCalled();
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
        it('Shares the auth token store with RequestInterceptor', async () => {
            setupGlobals('firefox');
            await loadModule();
            capturedMessageCb({ action: 'cacheAuthToken', serviceKey: 'mangalib', token: 'abc' }, {}, vi.fn());
            expect(globalThis.authTokenStore.mangalib).toBe('abc');
            expect(globalThis.pluginServiceHosts).toBeUndefined();
        });
    });

    describe('openDownloadWindow plugin paths', () => {
        beforeEach(async () => {
            await loadWithPlugins([{ service: 'myplugin', hosts: ['myplugin.com'] }]);
        });

        it('Detects service via pluginServiceHosts when detectServiceByUrl returns null', async () => {
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
        });

        it('Detects service via pluginServiceHosts using subdomain match', async () => {
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
        });

        it('Fails when hostname matches no pluginServiceHosts entry', async () => {
            const sendResponse = vi.fn();
            capturedMessageCb(
                { action: 'openDownloadWindow', format: 'epub' },
                { tab: { url: 'https://other.com/manga/my-slug' } },
                sendResponse,
            );
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
            expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Cannot detect slug or service' });
        });

        it('Fails for a non-service host when no plugins are installed', async () => {
            await loadWithPlugins([]);
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

    describe('_syncContentScripts', () => {
        let mockRegister;
        let mockGetRegistered;
        let mockUnregister;
        let capturedStorageChangeCb;

        const JS = ['/content/AdCleaner.js', '/content/DownloadButton.js', '/content/ImageFetcher.js'];
        const BUILTIN_SCRIPTS = [
            { id: 'dl-service-mangalib', matches: ['https://mangalib.me/*', 'https://mangalib.org/*'], js: JS, runAt: 'document_idle' },
            { id: 'dl-service-ranobelib', matches: ['https://ranobelib.me/*'], js: JS, runAt: 'document_idle' }
        ];
        const registeredIds = () => mockRegister.mock.calls.map(([scripts]) => scripts[0].id);

        async function setupWithScripting(plugins = [], { existing = [], storageGet } = {}) {
            setupGlobals('firefox');
            mockRegister = vi.fn().mockResolvedValue();
            mockGetRegistered = vi.fn().mockResolvedValue(existing);
            mockUnregister = vi.fn().mockResolvedValue();
            capturedStorageChangeCb = null;

            globalThis.browser.scripting = {
                registerContentScripts: mockRegister,
                getRegisteredContentScripts: mockGetRegistered,
                unregisterContentScripts: mockUnregister,
            };
            globalThis.browser.storage = {
                local: { get: storageGet || vi.fn().mockResolvedValue({ custom_plugins: plugins }) },
                onChanged: { addListener: vi.fn(cb => { capturedStorageChangeCb = cb; }) },
            };

            await loadModule();
            await vi.waitFor(() => expect(mockGetRegistered).toHaveBeenCalled());
            await new Promise(resolve => setTimeout(resolve, 0));
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

        it('Still populates pluginServiceHosts when scripting.registerContentScripts is unavailable', async () => {
            setupGlobals('firefox');
            const storageGet = vi.fn().mockResolvedValue({
                custom_plugins: [{ service: 'myplugin', hosts: ['myplugin.com'], enabled: true }],
            });
            globalThis.browser.storage = {
                local: { get: storageGet },
                onChanged: { addListener: vi.fn() },
            };
            await loadModule();
            await vi.waitFor(() => expect(storageGet).toHaveBeenCalled());
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(await detectedServiceFor('https://myplugin.com/manga/slug')).toBe('myplugin');
        });

        it('Registers content scripts for the built-in services from their config hosts', async () => {
            await setupWithScripting([]);
            expect(mockRegister).toHaveBeenCalledWith([BUILTIN_SCRIPTS[0]]);
            expect(mockRegister).toHaveBeenCalledWith([BUILTIN_SCRIPTS[1]]);
            expect(mockUnregister).not.toHaveBeenCalled();
        });

        it('Registers only built-in scripts when custom_plugins key is absent from storage', async () => {
            await setupWithScripting([], { storageGet: vi.fn().mockResolvedValue({}) });
            expect(registeredIds()).toEqual(['dl-service-mangalib', 'dl-service-ranobelib']);
        });

        it('Leaves up-to-date registrations untouched', async () => {
            const existing = BUILTIN_SCRIPTS.map(s => ({
                ...s,
                js: s.js.map(path => path.slice(1)),
                matches: [...s.matches].reverse(),
                persistAcrossSessions: true
            }));
            await setupWithScripting([], { existing });
            expect(mockUnregister).not.toHaveBeenCalled();
            expect(mockRegister).not.toHaveBeenCalled();
        });

        it('Re-registers a registration whose hosts changed', async () => {
            const existing = [
                { ...BUILTIN_SCRIPTS[0], matches: ['https://old-mangalib.example/*'] },
                BUILTIN_SCRIPTS[1]
            ];
            await setupWithScripting([], { existing });
            expect(mockUnregister).toHaveBeenCalledWith({ ids: ['dl-service-mangalib'] });
            expect(registeredIds()).toEqual(['dl-service-mangalib']);
        });

        it('Registers content scripts for enabled plugins', async () => {
            await setupWithScripting([{ service: 'myplugin', hosts: ['myplugin.com'], enabled: true }]);
            await vi.waitFor(() => expect(mockRegister).toHaveBeenCalledWith([{
                id: 'dl-plugin-myplugin',
                matches: ['https://myplugin.com/*'],
                js: ['/content/AdCleaner.js', '/content/DownloadButton.js', '/content/ImageFetcher.js'],
                runAt: 'document_idle',
            }]));
            expect(await detectedServiceFor('https://myplugin.com/manga/slug')).toBe('myplugin');
        });

        it('Uses format as key when service is absent', async () => {
            await setupWithScripting([{ format: 'myformat', hosts: ['myformat.com'] }]);
            await vi.waitFor(() => expect(mockRegister).toHaveBeenCalledWith([expect.objectContaining({ id: 'dl-plugin-myformat' })]));
        });

        it('Skips plugins with no service or format key', async () => {
            await setupWithScripting([{ hosts: ['myplugin.com'] }]);
            expect(registeredIds()).toEqual(['dl-service-mangalib', 'dl-service-ranobelib']);
        });

        it('Skips disabled plugins', async () => {
            await setupWithScripting([{ service: 'myplugin', hosts: ['myplugin.com'], enabled: false }]);
            expect(registeredIds()).toEqual(['dl-service-mangalib', 'dl-service-ranobelib']);
        });

        it('Skips plugins with no hosts', async () => {
            await setupWithScripting([{ service: 'myplugin', hosts: [] }]);
            expect(registeredIds()).toEqual(['dl-service-mangalib', 'dl-service-ranobelib']);
        });

        it('Unregisters stale plugin scripts and leaves foreign registrations alone', async () => {
            await setupWithScripting([{ service: 'myplugin', hosts: ['myplugin.com'] }], {
                existing: [{ id: 'dl-plugin-oldplugin' }, { id: 'other-script' }]
            });
            expect(mockUnregister).toHaveBeenCalledWith({ ids: ['dl-plugin-oldplugin'] });
            expect(registeredIds()).toContain('dl-plugin-myplugin');
        });

        it('Does not call unregister when no stale scripts exist', async () => {
            await setupWithScripting([{ service: 'myplugin', hosts: ['myplugin.com'] }]);
            expect(mockUnregister).not.toHaveBeenCalled();
        });

        it('Keeps plugin registrations and still registers built-ins when reading plugins fails', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            await setupWithScripting([], {
                existing: [{ id: 'dl-plugin-myplugin', matches: ['https://myplugin.com/*'], js: JS }],
                storageGet: vi.fn().mockRejectedValue(new Error('storage error'))
            });
            expect(warnSpy).toHaveBeenCalledWith('[MessageRouter] Failed to read custom plugins:', 'storage error');
            expect(mockUnregister).not.toHaveBeenCalled();
            expect(registeredIds()).toEqual(['dl-service-mangalib', 'dl-service-ranobelib']);
        });

        it('Keeps registering the rest when one registration fails', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            setupGlobals('firefox');
            mockRegister = vi.fn(async ([script]) => {
                if (script.id === 'dl-plugin-bad') throw new Error('Invalid match pattern');
            });
            mockGetRegistered = vi.fn().mockResolvedValue([]);
            globalThis.browser.scripting = {
                registerContentScripts: mockRegister,
                getRegisteredContentScripts: mockGetRegistered,
                unregisterContentScripts: vi.fn(),
            };
            globalThis.browser.storage = {
                local: { get: vi.fn().mockResolvedValue({ custom_plugins: [
                    { service: 'bad', hosts: ['bad host'] },
                    { service: 'good', hosts: ['good.example'] }
                ] }) },
                onChanged: { addListener: vi.fn() },
            };
            await loadModule();
            await vi.waitFor(() => expect(registeredIds()).toContain('dl-plugin-good'));
            expect(warnSpy).toHaveBeenCalledWith(
                '[MessageRouter] Failed to register content scripts dl-plugin-bad:', 'Invalid match pattern');
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
                '[MessageRouter] Failed to sync content scripts:', 'scripting error',
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

    describe('Keep-alive port', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
        });

        it('Registers an onConnect listener', () => {
            expect(mockAddListenerOnConnect).toHaveBeenCalledWith(expect.any(Function));
        });

        it('Ignores connections with an unrelated port name', () => {
            const onMessageAddListener = vi.fn();
            capturedConnectCb({ name: 'somethingElse', onMessage: { addListener: onMessageAddListener } });
            expect(onMessageAddListener).not.toHaveBeenCalled();
        });

        it('Attaches a no-op onMessage listener to a downloadKeepAlive port', () => {
            const onMessageAddListener = vi.fn();
            capturedConnectCb({ name: 'downloadKeepAlive', onMessage: { addListener: onMessageAddListener } });
            expect(onMessageAddListener).toHaveBeenCalledWith(expect.any(Function));

            const pingHandler = onMessageAddListener.mock.calls[0][0];
            expect(() => pingHandler({ type: 'ping' })).not.toThrow();
        });

        it('Does not register onConnect listener when runtime.onConnect is unavailable', async () => {
            setupGlobals('chrome');
            delete globalThis.chrome.runtime.onConnect;
            await expect(loadModule()).resolves.not.toThrow();
        });
    });
});
