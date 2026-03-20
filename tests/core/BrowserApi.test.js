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
// ...existing code...
});
