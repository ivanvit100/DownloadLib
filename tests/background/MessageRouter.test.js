import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../background/tokenStore.js', async () => (await import('../helpers/globalBridge.js'))
    .globalBridge({ getToken: 'tsGetToken', setToken: 'tsSetToken', invalidate: 'tsInvalidate' }));
vi.mock('../../background/rateLimitService.js', async () => (await import('../helpers/globalBridge.js'))
    .globalBridge({ acquire: 'rlAcquire', throttle: 'rlThrottle', getStats: 'rlGetStats' }));

const EXT_ID = 'test-ext-id';
const PAGE = { id: EXT_ID, url: 'moz-extension://test-id/popup.html' };

/**
 * Отправитель — вкладка сайта с content script'ом расширения.
 * @param {string} url - URL вкладки.
 * @param {number} [id] - id вкладки.
 * @returns {object} Отправитель.
 */
const tabSender = (url, id) => ({ id: EXT_ID, url, tab: { url, id } });

let mockAddListenerOnMessage;
let capturedMessageCb;
let mockAddListenerOnConnect;
let capturedConnectCb;

function setupGlobals(mode) {
    globalThis.tsGetToken = vi.fn().mockResolvedValue(null);
    globalThis.tsSetToken = vi.fn().mockResolvedValue(true);
    globalThis.tsInvalidate = vi.fn().mockResolvedValue();
    globalThis.rlAcquire = vi.fn().mockResolvedValue();
    globalThis.rlThrottle = vi.fn(async ms => ({ blockedUntil: 1000 + ms }));
    globalThis.rlGetStats = vi.fn().mockResolvedValue({});

    capturedMessageCb = null;
    mockAddListenerOnMessage = vi.fn((cb) => { capturedMessageCb = cb; });

    capturedConnectCb = null;
    mockAddListenerOnConnect = vi.fn((cb) => { capturedConnectCb = cb; });

    const apiObj = {
        runtime: {
            onMessage: { addListener: mockAddListenerOnMessage },
            onConnect: { addListener: mockAddListenerOnConnect },
            getURL: vi.fn(p => `moz-extension://test-id/${p}`),
            id: EXT_ID,
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

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
}

async function loadModule() {
    vi.resetModules();
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

/**
 * Передаёт сообщение роутеру и дожидается ответа, если роутер обещал ответить.
 * @param {object} message - Сообщение.
 * @param {object} [sender=PAGE] - Отправитель.
 * @returns {Promise<{returned: boolean, response: *, sendResponse: Function}>}
 */
async function send(message, sender = PAGE) {
    const sendResponse = vi.fn();
    const returned = capturedMessageCb(message, sender, sendResponse);
    if (returned) await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    return { returned, response: sendResponse.mock.calls[0]?.[0], sendResponse };
}

async function detectedServiceFor(url) {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    globalThis.browser.windows = { create, update: vi.fn() };
    await send({ action: 'openDownloadWindow' }, tabSender(url));
    const popupUrl = create.mock.calls[0]?.[0]?.url;
    return popupUrl ? new URLSearchParams(popupUrl.split('?')[1]).get('service') : null;
}

describe('MessageRouter', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        for (const name of ['tsGetToken', 'tsSetToken', 'tsInvalidate', 'rlAcquire', 'rlThrottle', 'rlGetStats'])
            delete globalThis[name];
    });

    describe('Message handler', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
        });

        it('Registers message listener', () => {
            expect(mockAddListenerOnMessage).toHaveBeenCalledWith(expect.any(Function));
        });

        it('Returns false without responding for unknown or missing actions', async () => {
            for (const message of [{ action: 'unknownAction' }, { action: 'toString' }, {}, null]) {
                const { returned, sendResponse } = await send(message);
                expect(returned).toBe(false);
                expect(sendResponse).not.toHaveBeenCalled();
            }
        });

        it.each(['setRateLimit', 'getRateLimiterStats', 'fetchWithRateLimit', 'fetchImage'])(
            'Does not handle the removed %s action', async action => {
                expect((await send({ action, url: 'https://x' })).returned).toBe(false);
            });

        it('getAuthToken returns the token from the token store', async () => {
            globalThis.tsGetToken.mockResolvedValue('jwt');
            const { returned, response } = await send({ action: 'getAuthToken', serviceKey: 'hlib' });
            expect(returned).toBe(true);
            expect(response).toEqual({ token: 'jwt' });
            expect(globalThis.tsGetToken).toHaveBeenCalledWith('hlib');
        });

        it('getAuthToken returns null without a serviceKey', async () => {
            expect((await send({ action: 'getAuthToken' })).response).toEqual({ token: null });
            expect(globalThis.tsGetToken).not.toHaveBeenCalled();
        });

        it('cacheAuthToken stores the token of the service', async () => {
            const { response } = await send({ action: 'cacheAuthToken', serviceKey: 'mangalib', token: 'abc' });
            expect(response).toEqual({ ok: true });
            expect(globalThis.tsSetToken).toHaveBeenCalledWith('mangalib', 'abc');
        });

        it('cacheAuthToken skips storage when serviceKey or token is missing', async () => {
            await send({ action: 'cacheAuthToken', serviceKey: 'mangalib' });
            await send({ action: 'cacheAuthToken', token: 'abc' });
            expect(globalThis.tsSetToken).not.toHaveBeenCalled();
        });

        it('authInvalidate drops the token of the service', async () => {
            const { response } = await send({ action: 'authInvalidate', serviceKey: 'mangalib' });
            expect(response).toEqual({ ok: true });
            expect(globalThis.tsInvalidate).toHaveBeenCalledWith('mangalib');
        });

        it('rateAcquire answers once the background limiter grants the request', async () => {
            let grant;
            globalThis.rlAcquire.mockReturnValue(new Promise(resolve => { grant = resolve; }));
            const sendResponse = vi.fn();
            expect(capturedMessageCb({ action: 'rateAcquire', serviceKey: 'mangalib' }, PAGE, sendResponse)).toBe(true);

            await new Promise(resolve => setTimeout(resolve, 0));
            expect(globalThis.rlAcquire).toHaveBeenCalledWith('mangalib');
            expect(sendResponse).not.toHaveBeenCalled();

            grant();
            await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
        });

        it('rateThrottle blocks the background limiter and returns the end of the block', async () => {
            const { response } = await send({ action: 'rateThrottle', ms: 5000 });
            expect(globalThis.rlThrottle).toHaveBeenCalledWith(5000);
            expect(response).toEqual({ ok: true, blockedUntil: 6000 });
        });

        it('Turns a handler error into an error response', async () => {
            globalThis.rlAcquire.mockRejectedValue(new Error('Rate limiter reset'));
            expect((await send({ action: 'rateAcquire' })).response).toEqual({ ok: false, error: 'Rate limiter reset' });
        });

        it('openWindowWithUrl opens the URL with the windows API', async () => {
            const create = vi.fn().mockResolvedValue({ id: 3 });
            const update = vi.fn();
            globalThis.browser.windows = { create, update };
            const { response } = await send({ action: 'openWindowWithUrl', url: 'moz-extension://test-id/popup.html?x=1' });
            expect(response).toEqual({ ok: true });
            expect(create).toHaveBeenCalledWith(expect.objectContaining({ url: 'moz-extension://test-id/popup.html?x=1', type: 'popup' }));
            expect(update).toHaveBeenCalledWith(3, { focused: true });
        });

        it('openWindowWithUrl falls back to the tabs API', async () => {
            globalThis.browser.tabs = { create: vi.fn().mockResolvedValue({ id: 2 }) };
            expect((await send({ action: 'openWindowWithUrl', url: 'u' })).response).toEqual({ ok: true });
        });

        it('openWindowWithUrl reports a failed tab creation', async () => {
            globalThis.browser.tabs = { create: vi.fn().mockResolvedValue(null) };
            expect((await send({ action: 'openWindowWithUrl', url: 'u' })).response).toEqual({ ok: false, error: 'tab create' });
        });

        it('openWindowWithUrl reports when no window or tab API is available', async () => {
            expect((await send({ action: 'openWindowWithUrl', url: 'u' })).response)
                .toEqual({ ok: false, error: 'No window/tab API available' });
        });

        it('openWindowWithUrl reports an exception', async () => {
            globalThis.browser.windows = { create: vi.fn().mockRejectedValue(new Error('denied')) };
            expect((await send({ action: 'openWindowWithUrl', url: 'u' })).response).toEqual({ ok: false, error: 'denied' });
        });
    });

    describe('Sender checks', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            globalThis.browser.scripting = { executeScript: vi.fn().mockResolvedValue() };
            await loadModule();
        });

        const EXTENSION_ACTIONS = [
            ['getAuthToken', { serviceKey: 'mangalib' }],
            ['cacheAuthToken', { serviceKey: 'mangalib', token: 'x' }],
            ['authInvalidate', { serviceKey: 'mangalib' }],
            ['rateAcquire', { serviceKey: 'mangalib' }],
            ['rateThrottle', { ms: 1000 }],
            ['openWindowWithUrl', { url: 'https://evil.example' }],
            ['plugin:cache', { format: 'x', code: 'alert(1)' }],
            ['plugin:exec', { tabId: 1, code: 'alert(1)' }]
        ];

        it.each(EXTENSION_ACTIONS)('Rejects %s from a content script on a service site', async (action, extra) => {
            const { returned, response } = await send({ action, ...extra }, tabSender('https://mangalib.me/ru/manga/x'));
            expect(returned).toBe(false);
            expect(response).toEqual({ ok: false, error: 'forbidden' });
        });

        it('Rejects messages from another extension', async () => {
            const { response } = await send({ action: 'plugin:exec', tabId: 1, code: 'x' }, { ...PAGE, id: 'other-ext' });
            expect(response).toEqual({ ok: false, error: 'forbidden' });
            expect(globalThis.browser.scripting.executeScript).not.toHaveBeenCalled();
        });

        it('Rejects messages without a sender or from a lookalike URL', async () => {
            for (const sender of [undefined, null, {}]) {
                const sendResponse = vi.fn();
                expect(capturedMessageCb({ action: 'getAuthToken', serviceKey: 'x' }, sender, sendResponse)).toBe(false);
                expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'forbidden' });
            }
            const lookalike = { id: EXT_ID, url: 'moz-extension://test-id.evil.example/popup.html' };
            expect((await send({ action: 'getAuthToken', serviceKey: 'x' }, lookalike)).response)
                .toEqual({ ok: false, error: 'forbidden' });
            expect(globalThis.tsGetToken).not.toHaveBeenCalled();
        });

        it('Accepts extension actions from extension pages', async () => {
            const { returned } = await send({ action: 'plugin:exec', tabId: 1, code: 'x' });
            expect(returned).toBe(true);
            expect(globalThis.browser.scripting.executeScript).toHaveBeenCalled();
        });

        it('Rejects openDownloadWindow from extension pages', async () => {
            expect((await send({ action: 'openDownloadWindow' })).response).toEqual({ ok: false, error: 'forbidden' });
        });

        it('Rejects openDownloadWindow from tabs of other sites', async () => {
            const { response } = await send({ action: 'openDownloadWindow' }, tabSender('https://other.com/manga/my-slug'));
            expect(response).toEqual({ ok: false, error: 'forbidden' });
        });

        it('Rejects openDownloadWindow from a sender without a tab', async () => {
            const { response } = await send({ action: 'openDownloadWindow' }, { id: EXT_ID });
            expect(response).toEqual({ ok: false, error: 'forbidden' });
        });
    });

    describe('openDownloadWindow', () => {
        let create;
        let update;

        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
            create = vi.fn().mockResolvedValue({ id: 1 });
            update = vi.fn();
            globalThis.browser.windows = { create, update };
        });

        const popupParams = () => Object.fromEntries(new URLSearchParams(create.mock.calls[0][0].url.split('?')[1]));

        it('Opens the download window with only the title, service, format and tab', async () => {
            const { response } = await send(
                { action: 'openDownloadWindow', format: 'epub', rateLimit: 1, maxSizeMB: 1 },
                tabSender('https://mangalib.me/ru/manga/my-manga?section=info', 7)
            );
            expect(response).toEqual({ ok: true });
            expect(create.mock.calls[0][0].url.startsWith('moz-extension://test-id/popup.html?')).toBe(true);
            expect(popupParams()).toEqual({ download: 'true', slug: 'my-manga', service: 'mangalib', format: 'epub', tabId: '7' });
            expect(update).toHaveBeenCalledWith(1, { focused: true });
        });

        it('Uses fb2 by default and omits a missing tab id', async () => {
            await send({ action: 'openDownloadWindow' }, tabSender('https://ranobelib.me/ru/book/my-book'));
            expect(popupParams()).toEqual({ download: 'true', slug: 'my-book', service: 'ranobelib', format: 'fb2' });
        });

        it('Fails when the slug cannot be detected', async () => {
            const { response } = await send({ action: 'openDownloadWindow' }, tabSender('https://mangalib.me/ru'));
            expect(response).toEqual({ ok: false, error: 'Cannot detect slug or service' });
            expect(create).not.toHaveBeenCalled();
        });

        it('Does not focus a window without an id', async () => {
            create.mockResolvedValue({});
            expect((await send({ action: 'openDownloadWindow' }, tabSender('https://mangalib.me/ru/manga/x'))).response)
                .toEqual({ ok: true });
            expect(update).not.toHaveBeenCalled();
        });

        it('Reports a window that could not be created', async () => {
            create.mockResolvedValue(null);
            expect((await send({ action: 'openDownloadWindow' }, tabSender('https://mangalib.me/ru/manga/x'))).response)
                .toEqual({ ok: false, error: 'window create' });
        });

        it('Reports an exception', async () => {
            create.mockRejectedValue(new Error('boom'));
            expect((await send({ action: 'openDownloadWindow' }, tabSender('https://mangalib.me/ru/manga/x'))).response)
                .toEqual({ ok: false, error: 'boom' });
        });

        it('Uses tabs.create when the windows API is unavailable', async () => {
            delete globalThis.browser.windows;
            globalThis.browser.tabs = { create: vi.fn().mockResolvedValue({ id: 5 }) };
            expect((await send({ action: 'openDownloadWindow' }, tabSender('https://mangalib.me/ru/manga/x'))).response)
                .toEqual({ ok: true });
        });

        it('Reports when neither windows nor tabs API is available', async () => {
            delete globalThis.browser.windows;
            expect((await send({ action: 'openDownloadWindow' }, tabSender('https://mangalib.me/ru/manga/x'))).response)
                .toEqual({ ok: false, error: 'No window/tab API available' });
        });
    });

    describe('No browser API available', () => {
        it('Does not crash when no browser API', async () => {
            setupGlobals('none');
            await expect(loadModule()).resolves.toBeUndefined();
        });
    });

    describe('openDownloadWindow on plugin sites', () => {
        beforeEach(async () => {
            await loadWithPlugins([{ service: 'myplugin', hosts: ['myplugin.com'] }]);
        });

        it('Accepts tabs of service plugin sites and detects the plugin service', async () => {
            const create = vi.fn().mockResolvedValue({ id: 1 });
            globalThis.browser.windows = { create, update: vi.fn() };
            const { response } = await send(
                { action: 'openDownloadWindow', format: 'epub' }, tabSender('https://myplugin.com/manga/my-slug'));
            expect(response).toEqual({ ok: true });
            const urlArg = create.mock.calls[0][0].url;
            expect(urlArg).toContain('service=myplugin');
            expect(urlArg).toContain('slug=my-slug');
        });

        it('Accepts subdomains of plugin hosts', async () => {
            expect(await detectedServiceFor('https://sub.myplugin.com/manga/my-slug')).toBe('myplugin');
        });

        it('Rejects sites that match no plugin host', async () => {
            const { response } = await send({ action: 'openDownloadWindow' }, tabSender('https://other.com/manga/my-slug'));
            expect(response).toEqual({ ok: false, error: 'forbidden' });
        });

        it('Rejects plugin sites once the plugin is removed', async () => {
            await loadWithPlugins([]);
            const { response } = await send({ action: 'openDownloadWindow' }, tabSender('https://myplugin.com/manga/my-slug'));
            expect(response).toEqual({ ok: false, error: 'forbidden' });
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
            const { response } = await send({ action: 'plugin:cache', format: 'myformat', code: 'console.log(1)' });
            expect(response).toEqual({ ok: true, swStatus: expect.any(String) });
            expect(mockObjectStore.put).toHaveBeenCalledWith({ format: 'myformat', code: 'console.log(1)' });
        });

        it('Handles IDB transaction error', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            makeMockIdb({ failTx: true });
            const { response } = await send({ action: 'plugin:cache', format: 'myformat', code: 'code' });
            expect(response).toEqual({ ok: false, error: 'tx error', swStatus: expect.any(String) });
        });

        it('Handles IDB open error', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            makeMockIdb({ failOpen: true });
            const { response } = await send({ action: 'plugin:cache', format: 'myformat', code: 'code' });
            expect(response).toEqual({ ok: false, error: 'open error', swStatus: expect.any(String) });
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
            const { response } = await send({ action: 'plugin:cache', format: 'sw-fmt', code: 'code here' });
            expect(response).toEqual({ ok: true, swStatus: 'sw-background' });
            expect(globalThis.caches.open).toHaveBeenCalledWith('dl-plugins-v1');
            expect(mockPut).toHaveBeenCalledWith('/plugin-runtime/sw-fmt.js', expect.any(Object));
        });

        it('Handles Cache API error in SW context', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            globalThis.caches = { open: vi.fn().mockRejectedValue(new Error('cache error')) };
            const { response } = await send({ action: 'plugin:cache', format: 'sw-fmt', code: 'code' });
            expect(response).toEqual({ ok: false, error: 'cache error', swStatus: 'sw-background' });
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

        const swStatus = async () => (await send({ action: 'plugin:cache', format: 'f', code: 'c' })).response.swStatus;

        it('Returns not-registered when no SW registration found', async () => {
            globalThis.navigator = { serviceWorker: { getRegistration: vi.fn().mockResolvedValue(null) } };
            expect(await swStatus()).toBe('not-registered');
        });

        it('Returns registered:activated when active SW found', async () => {
            globalThis.navigator = {
                serviceWorker: {
                    getRegistration: vi.fn().mockResolvedValue({ active: { state: 'activated' }, installing: null, waiting: null }),
                },
            };
            expect(await swStatus()).toBe('registered:activated');
        });

        it('Returns registered:installing from installing state', async () => {
            globalThis.navigator = {
                serviceWorker: {
                    getRegistration: vi.fn().mockResolvedValue({ active: null, installing: { state: 'installing' }, waiting: null }),
                },
            };
            expect(await swStatus()).toBe('registered:installing');
        });

        it('Returns registered:unknown when SW has no recognizable state', async () => {
            globalThis.navigator = { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({}) } };
            expect(await swStatus()).toBe('registered:unknown');
        });

        it('Returns error string when getRegistration throws', async () => {
            globalThis.navigator = { serviceWorker: { getRegistration: vi.fn().mockRejectedValue(new Error('sw error')) } };
            expect(await swStatus()).toBe('error:sw error');
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
            const { response } = await send({ action: 'plugin:exec', tabId: 42, code: 'console.log("hi")' });
            expect(response).toEqual({ ok: true });
            expect(mockExecuteScript).toHaveBeenCalledWith({
                target: { tabId: 42 },
                func: expect.any(Function),
                args: ['console.log("hi")'],
            });
            const funcArg = mockExecuteScript.mock.calls[0][0].func;
            expect(() => funcArg('1+1')).not.toThrow();
        });

        it('Responds with error when scripting.executeScript not available', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect((await send({ action: 'plugin:exec', tabId: 42, code: 'code' })).response)
                .toEqual({ ok: false, error: 'scripting.executeScript not available' });
        });

        it('Responds with error when tabId is missing', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            globalThis.browser.scripting = { executeScript: vi.fn() };
            expect((await send({ action: 'plugin:exec', code: 'code' })).response)
                .toEqual({ ok: false, error: 'No tabId provided' });
        });

        it('Responds with error when executeScript throws', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            globalThis.browser.scripting = { executeScript: vi.fn().mockRejectedValue(new Error('exec error')) };
            expect((await send({ action: 'plugin:exec', tabId: 10, code: 'code' })).response)
                .toEqual({ ok: false, error: 'exec error' });
        });
    });

    describe('_syncContentScripts', () => {
        let mockRegister;
        let mockGetRegistered;
        let mockUnregister;
        let capturedStorageChangeCb;

        const JS = ['/content/AdCleaner.js', '/content/DownloadButton.js'];
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

        it('Still learns plugin hosts when scripting.registerContentScripts is unavailable', async () => {
            await loadWithPlugins([{ service: 'myplugin', hosts: ['myplugin.com'], enabled: true }]);
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

        it('Re-registers registrations left from versions that injected ImageFetcher', async () => {
            const existing = BUILTIN_SCRIPTS.map(s => ({ ...s, js: [...s.js, '/content/ImageFetcher.js'] }));
            await setupWithScripting([], { existing });
            expect(mockUnregister).toHaveBeenCalledWith({ ids: ['dl-service-mangalib', 'dl-service-ranobelib'] });
            expect(registeredIds()).toEqual(['dl-service-mangalib', 'dl-service-ranobelib']);
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
                js: JS,
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
