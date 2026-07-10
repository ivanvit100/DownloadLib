import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadBrowserApi() {
    vi.resetModules();
    await import('../../core/BrowserApi.js');
}

function getHost() {
    return typeof window !== 'undefined' ? window : global;
}

function clearBrowserApiGlobals() {
    delete global.extensionApi;
    delete global.browserEnv;
    delete global.getExtensionApi;
    delete global.getBrowserEnv;
    delete global.browser;
    delete global.chrome;
    if (typeof window !== 'undefined') {
        delete window.extensionApi;
        delete window.browserEnv;
        delete window.getExtensionApi;
        delete window.getBrowserEnv;
        delete window.browser;
        delete window.chrome;
    }
}

describe('BrowserApi', () => {
    beforeEach(() => {
        clearBrowserApiGlobals();
    });

    it('Uses browser native api when available', async () => {
        const browserApi = {
            runtime: { sendMessage: async () => ({ ok: true }) },
            tabs: { query: async () => [] },
            windows: { getCurrent: async () => ({}) }
        };
        global.browser = browserApi;
        if (typeof window !== 'undefined') window.browser = browserApi;

        await loadBrowserApi();

        const host = getHost();
        const api = host.getExtensionApi();
        const env = host.getBrowserEnv();

        expect(api).toBe(browserApi);
        expect(env).toEqual({
            nativeName: 'browser',
            isFirefox: true,
            isChromium: false,
            supportsDnr: false
        });
    });

    it('Creates chrome promise wrappers and resolves values', async () => {
        const sendMessage = (payload, cb) => cb({ ok: true, payload });
        const query = (queryInfo, cb) => cb([{ id: 1, queryInfo }]);
        const getCurrent = (cb) => cb({ id: 10 });
        const create = (opts, cb) => cb({ id: 11, opts });
        const update = (id, opts, cb) => cb({ id, opts });
        const download = (opts, cb) => cb(42);
        const localGet = (keys, cb) => cb({ keys });
        const localSet = (value, cb) => cb(value);

        const chromeApi = {
            runtime: { sendMessage, lastError: null },
            tabs: { query },
            windows: { getCurrent, create, update },
            downloads: { download },
            storage: { local: { get: localGet, set: localSet } },
            webRequest: { onBeforeSendHeaders: {} },
            declarativeNetRequest: { updateDynamicRules: () => {} }
        };

        global.chrome = chromeApi;
        if (typeof window !== 'undefined') window.chrome = chromeApi;

        await loadBrowserApi();

        const host = getHost();
        const api = host.getExtensionApi();
        const env = host.getBrowserEnv();

        await expect(api.runtime.sendMessage({ a: 1 })).resolves.toEqual({ ok: true, payload: { a: 1 } });
        await expect(api.tabs.query({ active: true })).resolves.toEqual([{ id: 1, queryInfo: { active: true } }]);
        await expect(api.windows.getCurrent()).resolves.toEqual({ id: 10 });
        await expect(api.windows.create({ type: 'popup' })).resolves.toEqual({ id: 11, opts: { type: 'popup' } });
        await expect(api.windows.update(11, { focused: true })).resolves.toEqual({ id: 11, opts: { focused: true } });
        await expect(api.downloads.download({ filename: 'a.txt' })).resolves.toBe(42);
        await expect(api.storage.local.get(['a'])).resolves.toEqual({ keys: ['a'] });
        await expect(api.storage.local.set({ a: 1 })).resolves.toEqual({ a: 1 });
        expect(api.webRequest).toBe(chromeApi.webRequest);
        expect(api.declarativeNetRequest).toBe(chromeApi.declarativeNetRequest);

        expect(env).toEqual({
            nativeName: 'chrome',
            isFirefox: false,
            isChromium: true,
            supportsDnr: true
        });
    });

    it('Rejects wrapped chrome calls when lastError is set', async () => {
        const chromeApi = {
            runtime: {
                lastError: null,
                sendMessage: (_payload, cb) => {
                    chromeApi.runtime.lastError = { message: 'boom' };
                    cb('ignored');
                    chromeApi.runtime.lastError = null;
                }
            },
            tabs: { query: (_q, cb) => cb([]) },
            windows: { getCurrent: (cb) => cb({}), create: (_o, cb) => cb({}), update: (_i, _o, cb) => cb({}) },
            downloads: { download: (_o, cb) => cb(1) },
            storage: { local: { get: (_k, cb) => cb({}), set: (_v, cb) => cb({}) } }
        };

        global.chrome = chromeApi;
        if (typeof window !== 'undefined') window.chrome = chromeApi;

        await loadBrowserApi();

        const host = getHost();
        const api = host.getExtensionApi();
        await expect(api.runtime.sendMessage({})).rejects.toThrow('boom');
    });

    it('Rejects wrapped chrome calls using stringified lastError fallback', async () => {
        const chromeApi = {
            runtime: {
                lastError: null,
                sendMessage: (_payload, cb) => {
                    chromeApi.runtime.lastError = {};
                    cb('ignored');
                    chromeApi.runtime.lastError = null;
                }
            },
            tabs: { query: (_q, cb) => cb([]) },
            windows: { getCurrent: (cb) => cb({}), create: (_o, cb) => cb({}), update: (_i, _o, cb) => cb({}) },
            downloads: { download: (_o, cb) => cb(1) },
            storage: { local: { get: (_k, cb) => cb({}), set: (_v, cb) => cb({}) } }
        };

        global.chrome = chromeApi;
        if (typeof window !== 'undefined') window.chrome = chromeApi;

        await loadBrowserApi();

        const host = getHost();
        const api = host.getExtensionApi();
        await expect(api.runtime.sendMessage({})).rejects.toThrow('[object Object]');
    });

    it('Rejects wrapped chrome calls on sync throw', async () => {
        const chromeApi = {
            runtime: {
                lastError: null,
                sendMessage: () => { throw new Error('sync fail'); }
            },
            tabs: { query: (_q, cb) => cb([]) },
            windows: { getCurrent: (cb) => cb({}), create: (_o, cb) => cb({}), update: (_i, _o, cb) => cb({}) },
            downloads: { download: (_o, cb) => cb(1) },
            storage: { local: { get: (_k, cb) => cb({}), set: (_v, cb) => cb({}) } }
        };

        global.chrome = chromeApi;
        if (typeof window !== 'undefined') window.chrome = chromeApi;

        await loadBrowserApi();

        const host = getHost();
        const api = host.getExtensionApi();
        await expect(api.runtime.sendMessage({})).rejects.toThrow('sync fail');
    });

    it('Keeps storage.local undefined when chrome storage local is missing', async () => {
        const chromeApi = {
            runtime: { sendMessage: (_payload, cb) => cb({}), lastError: null },
            tabs: { query: (_q, cb) => cb([]) },
            windows: { getCurrent: (cb) => cb({}), create: (_o, cb) => cb({}), update: (_i, _o, cb) => cb({}) },
            downloads: { download: (_o, cb) => cb(1) },
            storage: undefined
        };

        global.chrome = chromeApi;
        if (typeof window !== 'undefined') window.chrome = chromeApi;

        await loadBrowserApi();

        const host = getHost();
        const api = host.getExtensionApi();
        expect(api.storage.local).toBeUndefined();
    });

    it('Returns null api and default env when no browser globals exist', async () => {
        await loadBrowserApi();

        const host = getHost();
        expect(host.getExtensionApi()).toBeNull();
        expect(host.getBrowserEnv()).toEqual({
            nativeName: 'none',
            isFirefox: false,
            isChromium: false,
            supportsDnr: false
        });
    });

    it('Returns default env from getter when stored env is missing', async () => {
        await loadBrowserApi();

        const host = getHost();
        delete host.browserEnv;

        expect(host.getBrowserEnv()).toEqual({
            nativeName: 'none',
            isFirefox: false,
            isChromium: false,
            supportsDnr: false
        });
    });

    it('Attaches api helpers to self when window is unavailable', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        const originalBrowser = global.browser;

        delete global.window;
        global.self = global;
        global.browser = {
            runtime: { sendMessage: async () => ({ ok: true }) },
            tabs: { query: async () => [] },
            windows: { getCurrent: async () => ({}) }
        };

        await loadBrowserApi();

        expect(global.self.getExtensionApi).toBeTypeOf('function');
        expect(global.self.getBrowserEnv).toBeTypeOf('function');
        expect(global.self.getBrowserEnv().nativeName).toBe('browser');

        if (originalWindow !== undefined) global.window = originalWindow;
        else delete global.window;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
        if (originalBrowser !== undefined) global.browser = originalBrowser;
        else delete global.browser;
    });

    it('Returns null extension api when chrome provider disappears during resolution', async () => {
        vi.resetModules();
        const host = typeof window !== 'undefined' ? window : globalThis;
        delete host.browser;
        delete host.extensionApi;
        delete host.browserEnv;
        delete host.getExtensionApi;
        delete host.getBrowserEnv;
        let reads = 0;
        Object.defineProperty(host, 'chrome', {
            configurable: true,
            get() {
                reads += 1;
                if (reads < 3) return { declarativeNetRequest: {}, runtime: {}, tabs: {}, windows: {}, downloads: {}, storage: {} };
                return null;
            }
        });
        await import('../../core/BrowserApi.js');
        expect(host.getExtensionApi()).toBeNull();
        expect(host.getBrowserEnv().nativeName).toBe('chrome');
        delete host.chrome;
    });

    it('Detects firefox mode from browser presence when dnr is not supported', async () => {
        vi.resetModules();
        const host = typeof window !== 'undefined' ? window : globalThis;
        delete host.extensionApi;
        delete host.browserEnv;
        delete host.getExtensionApi;
        delete host.getBrowserEnv;
        let browserReads = 0;
        Object.defineProperty(host, 'browser', {
            configurable: true,
            get() {
                browserReads += 1;
                if (browserReads <= 2) return null;
                return { runtime: {} };
            }
        });
        Object.defineProperty(host, 'chrome', {
            configurable: true,
            value: { runtime: {}, tabs: {}, windows: {}, downloads: {}, storage: {} }
        });
        await import('../../core/BrowserApi.js');
        const env = host.getBrowserEnv();
        expect(env.nativeName).toBe('chrome');
        expect(env.supportsDnr).toBe(false);
        expect(env.isFirefox).toBe(true);
        expect(env.isChromium).toBe(false);
        delete host.browser;
        delete host.chrome;
    });
    describe('setServiceTab / fetchViaTab', () => {
        async function setupWithBrowser(browserApi) {
            clearBrowserApiGlobals();
            global.browser = browserApi;
            if (typeof window !== 'undefined') window.browser = browserApi;
            await loadBrowserApi();
        }

        it('fetchViaTab returns null when scripting API is absent', async () => {
            await setupWithBrowser({ runtime: {}, tabs: { query: async () => [] } });
            const host = getHost();
            expect(await host.fetchViaTab('https://example.com/img.jpg', 'mangalib')).toBeNull();
        });

        it('fetchViaTab returns null when no tab found', async () => {
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'x', contentType: 'image/jpeg' } }]);
            await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [] },
                scripting: { executeScript }
            });
            const host = getHost();
            expect(await host.fetchViaTab('https://example.com/img.jpg', 'mangalib')).toBeNull();
            expect(executeScript).not.toHaveBeenCalled();
        });

        it('fetchViaTab uses ranobelib URL pattern for ranobelib service', async () => {
            const tabsQuery = vi.fn(async ({ url }) => url[0].includes('ranobelib') ? [{ id: 5 }] : []);
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'xyz', contentType: 'image/png' } }]);
            await setupWithBrowser({ runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } });
            const host = getHost();
            const result = await host.fetchViaTab('https://cdn.example.com/img.jpg', 'ranobelib');
            expect(tabsQuery).toHaveBeenCalledWith({ url: ['*://ranobelib.me/*'] });
            expect(result).toEqual({ ok: true, base64: 'xyz', contentType: 'image/png' });
        });

        it('fetchViaTab uses mangalib URL patterns for other services', async () => {
            const tabsQuery = vi.fn(async () => [{ id: 3 }]);
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'abc', contentType: 'image/jpeg' } }]);
            await setupWithBrowser({ runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } });
            const host = getHost();
            await host.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib');
            expect(tabsQuery).toHaveBeenCalledWith({ url: ['*://mangalib.me/*', '*://mangalib.org/*'] });
        });

        it('fetchViaTab caches found tab ID for subsequent calls', async () => {
            const tabsQuery = vi.fn(async () => [{ id: 9 }]);
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'r', contentType: 'image/jpeg' } }]);
            await setupWithBrowser({ runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } });
            const host = getHost();
            await host.fetchViaTab('https://cdn.example.com/a.jpg', 'mangalib');
            await host.fetchViaTab('https://cdn.example.com/b.jpg', 'mangalib');
            expect(tabsQuery).toHaveBeenCalledTimes(1);
            expect(executeScript).toHaveBeenCalledTimes(2);
        });

        it('fetchViaTab returns null and warns when tabs.query throws', async () => {
            await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => { throw new Error('tabs error'); } },
                scripting: { executeScript: vi.fn() }
            });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const host = getHost();
            expect(await host.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib')).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith('[BrowserApi] tabs.query failed:', 'tabs error');
            warnSpy.mockRestore();
        });

        it('fetchViaTab returns null and warns when executeScript throws', async () => {
            await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [{ id: 7 }] },
                scripting: { executeScript: async () => { throw new Error('script error'); } }
            });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const host = getHost();
            expect(await host.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib')).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith('[BrowserApi] fetchViaTab failed:', 'script error');
            warnSpy.mockRestore();
        });

        it('fetchViaTab returns null when executeScript returns no result', async () => {
            await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [{ id: 8 }] },
                scripting: { executeScript: async () => null }
            });
            const host = getHost();
            expect(await host.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib')).toBeNull();
        });

        it('setServiceTab causes fetchViaTab to skip tabs.query', async () => {
            const tabsQuery = vi.fn(async () => []);
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'c', contentType: 'image/jpeg' } }]);
            await setupWithBrowser({ runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } });
            const host = getHost();
            host.setServiceTab(42);
            const result = await host.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib');
            expect(tabsQuery).not.toHaveBeenCalled();
            expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 42 } }));
            expect(result).toEqual({ ok: true, base64: 'c', contentType: 'image/jpeg' });
        });

        it('fetchViaTab re-queries when cached tab has expired', async () => {
            const tabsQuery = vi.fn(async () => [{ id: 77 }]);
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'e', contentType: 'image/jpeg' } }]);
            await setupWithBrowser({ runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } });
            const host = getHost();

            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(0);
            host.setServiceTab(50);
            nowSpy.mockReturnValue(3600001);

            await host.fetchViaTab('https://cdn.example.com/img.jpg', 'ranobelib');
            expect(tabsQuery).toHaveBeenCalledTimes(1);
            nowSpy.mockRestore();
        });

        describe('fetchViaTab inner func (fetch-to-base64)', () => {
            let capturedFunc;

            beforeEach(async () => {
                await setupWithBrowser({
                    runtime: {},
                    tabs: { query: async () => [{ id: 1 }] },
                    scripting: {
                        executeScript: async ({ func }) => {
                            capturedFunc = func;
                            return [{ result: null }];
                        }
                    }
                });
                await getHost().fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib');
            });

            afterEach(() => {
                vi.unstubAllGlobals();
            });

            it('returns null when fetch response is not ok', async () => {
                vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
                expect(await capturedFunc('https://example.com/img.jpg')).toBeNull();
            });

            it('returns base64 result using blob contentType', async () => {
                vi.stubGlobal('fetch', vi.fn(async () => ({
                    ok: true,
                    blob: async () => ({ type: 'image/png' })
                })));
                vi.stubGlobal('FileReader', vi.fn(function () {
                    this.readAsDataURL = function () {
                        this.result = 'data:image/png;base64,abc123';
                        this.onloadend && this.onloadend();
                    };
                }));
                const result = await capturedFunc('https://example.com/img.jpg');
                expect(result).toEqual({ ok: true, base64: 'abc123', contentType: 'image/png' });
            });

            it('falls back to image/jpeg when blob.type is empty', async () => {
                vi.stubGlobal('fetch', vi.fn(async () => ({
                    ok: true,
                    blob: async () => ({ type: '' })
                })));
                vi.stubGlobal('FileReader', vi.fn(function () {
                    this.readAsDataURL = function () {
                        this.result = 'data:image/jpeg;base64,def456';
                        this.onloadend && this.onloadend();
                    };
                }));
                const result = await capturedFunc('https://example.com/img.jpg');
                expect(result).toEqual({ ok: true, base64: 'def456', contentType: 'image/jpeg' });
            });

            it('returns null when fetch throws (catch branch)', async () => {
                vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network fail'); }));
                expect(await capturedFunc('https://example.com/img.jpg')).toBeNull();
            });
        });
    });
});
