import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadBrowserApi() {
    vi.resetModules();
    return import('../../core/BrowserApi.js');
}

function clearBrowserGlobals() {
    delete global.browser;
    delete global.chrome;
    if (typeof window !== 'undefined') {
        delete window.browser;
        delete window.chrome;
    }
}

describe('BrowserApi', () => {
    beforeEach(() => {
        clearBrowserGlobals();
    });

    it('Uses browser native api when available', async () => {
        const browserApi = {
            runtime: { sendMessage: async () => ({ ok: true }) },
            tabs: { query: async () => [] },
            windows: { getCurrent: async () => ({}) }
        };
        global.browser = browserApi;

        const { extensionApi, browserEnv } = await loadBrowserApi();

        expect(extensionApi).toBe(browserApi);
        expect(browserEnv).toEqual({
            nativeName: 'browser',
            isFirefox: true,
            isChromium: false,
            supportsDnr: false
        });
    });

    it('Uses the chrome namespace as is (MV3 chrome.* methods already return promises)', async () => {
        const chromeApi = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true })) },
            declarativeNetRequest: { updateDynamicRules: () => {} }
        };
        global.chrome = chromeApi;

        const { extensionApi, browserEnv } = await loadBrowserApi();

        expect(extensionApi).toBe(chromeApi);
        await expect(extensionApi.runtime.sendMessage({ a: 1 })).resolves.toEqual({ ok: true });
        expect(browserEnv).toEqual({
            nativeName: 'chrome',
            isFirefox: false,
            isChromium: true,
            supportsDnr: true
        });
    });

    it('Prefers browser over chrome when both namespaces exist', async () => {
        const browserApi = { runtime: {} };
        global.browser = browserApi;
        global.chrome = { runtime: {}, declarativeNetRequest: {} };

        const { extensionApi, browserEnv } = await loadBrowserApi();

        expect(extensionApi).toBe(browserApi);
        expect(browserEnv.nativeName).toBe('browser');
        expect(browserEnv.isFirefox).toBe(false);
        expect(browserEnv.isChromium).toBe(true);
    });

    it('Returns null api and default env when no browser globals exist', async () => {
        const { extensionApi, browserEnv } = await loadBrowserApi();

        expect(extensionApi).toBeNull();
        expect(browserEnv).toEqual({
            nativeName: 'none',
            isFirefox: false,
            isChromium: false,
            supportsDnr: false
        });
    });

    it('Detects firefox mode from browser presence when dnr is not supported', async () => {
        global.browser = { runtime: {} };
        global.chrome = { runtime: {}, tabs: {}, windows: {}, downloads: {}, storage: {} };

        const { browserEnv } = await loadBrowserApi();

        expect(browserEnv.supportsDnr).toBe(false);
        expect(browserEnv.isFirefox).toBe(true);
        expect(browserEnv.isChromium).toBe(false);
    });

    it('Does not provide network functions (they live in TabNetwork)', async () => {
        const api = await loadBrowserApi();
        ['fetchViaTab', 'requestViaTab', 'hasServiceTab', 'setServiceTab', 'NoServiceTabError']
            .forEach(name => expect(api[name], name).toBeUndefined());
    });
});

describe('extensionOrigin / isExtensionUrl', () => {
    beforeEach(() => {
        clearBrowserGlobals();
    });

    it.each([
        ['moz-extension://uuid/', 'moz-extension://uuid'],
        ['chrome-extension://abcdef/', 'chrome-extension://abcdef']
    ])('Takes the origin from runtime.getURL(%s) without URL.origin', async (base, origin) => {
        global.browser = { runtime: { getURL: path => `${base}${path}` } };
        const { extensionOrigin } = await loadBrowserApi();
        expect(extensionOrigin()).toBe(origin);
    });

    it('Returns null without a runtime', async () => {
        const { extensionOrigin, isExtensionUrl } = await loadBrowserApi();
        expect(extensionOrigin()).toBeNull();
        expect(isExtensionUrl('moz-extension://uuid/popup.html')).toBe(false);
    });

    it('Accepts only pages of this extension', async () => {
        global.browser = { runtime: { getURL: path => `moz-extension://uuid/${path}` } };
        const { isExtensionUrl } = await loadBrowserApi();
        expect(isExtensionUrl('moz-extension://uuid/popup.html?download=true')).toBe(true);
        expect(isExtensionUrl('moz-extension://uuid.evil/popup.html')).toBe(false);
        expect(isExtensionUrl('moz-extension://other/popup.html')).toBe(false);
        expect(isExtensionUrl('https://mangalib.me/')).toBe(false);
        expect(isExtensionUrl('null')).toBe(false);
        expect(isExtensionUrl(undefined)).toBe(false);
    });
});
