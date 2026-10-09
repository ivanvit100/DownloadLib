import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../background/tokenStore.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('setToken'));
vi.mock('../../background/pluginHosts.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('getPluginHosts'));

let webRequest;
let listeners;
let webRequestUrls;

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature';

/**
 * Создаёт фейковый API расширения и загружает модуль в выбранном браузере.
 * @param {'firefox'|'chrome'|'none'} mode - Браузер.
 * @returns {Promise<void>}
 */
async function load(mode) {
    vi.resetModules();
    listeners = {};
    const listen = name => ({
        addListener: vi.fn((cb, filter, extra) => { listeners[name] = { cb, filter, extra }; })
    });
    webRequest = {
        onBeforeSendHeaders: listen('onBeforeSendHeaders'),
        onHeadersReceived: listen('onHeadersReceived'),
        onCompleted: listen('onCompleted'),
        onErrorOccurred: listen('onErrorOccurred'),
        onBeforeRequest: listen('onBeforeRequest')
    };
    const api = { webRequest, runtime: { id: 'ext', getURL: path => `moz-extension://uuid/${path}` } };

    delete globalThis.browser;
    delete globalThis.chrome;
    if (mode === 'firefox') globalThis.browser = api;
    if (mode === 'chrome') globalThis.chrome = { ...api, declarativeNetRequest: {} };

    ({ webRequestUrls } = await import('../../services/hosts.js'));
    await import('../../background/RequestInterceptor.js');
}

const apiRequest = (extra = {}) => ({
    requestId: 'r1',
    tabId: 5,
    url: 'https://api.cdnlibs.org/api/manga/slug',
    requestHeaders: [{ name: 'Authorization', value: `Bearer ${JWT}` }],
    ...extra
});

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    globalThis.setToken = vi.fn(async () => true);
    globalThis.getPluginHosts = vi.fn(() => ({}));
});

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.browser;
    delete globalThis.chrome;
});

describe('RequestInterceptor listeners', () => {
    it('Firefox: watches request headers without blocking and fixes CORS of responses', async () => {
        await load('firefox');
        expect(listeners.onBeforeSendHeaders.filter).toEqual({ urls: webRequestUrls() });
        expect(listeners.onBeforeSendHeaders.extra).toEqual(['requestHeaders']);
        expect(listeners.onHeadersReceived.extra).toEqual(['blocking', 'responseHeaders']);
        expect(listeners.onCompleted).toBeDefined();
        expect(listeners.onErrorOccurred).toBeDefined();
        expect(listeners.onBeforeRequest).toBeUndefined();
    });

    it('Chrome: only watches request headers without blocking', async () => {
        await load('chrome');
        expect(listeners.onBeforeSendHeaders.extra).toEqual(['requestHeaders']);
        expect(listeners.onHeadersReceived).toBeUndefined();
        expect(listeners.onCompleted).toBeUndefined();
    });

    it('Does not crash without a browser API', async () => {
        await expect(load('none')).resolves.toBeUndefined();
    });

    it('The token capture listener returns nothing, so requests are never modified', async () => {
        await load('firefox');
        expect(listeners.onBeforeSendHeaders.cb(apiRequest({ originUrl: 'https://mangalib.me/ru/manga/x' })))
            .toBeUndefined();
    });
});

describe('Auth token capture', () => {
    beforeEach(async () => {
        await load('firefox');
    });

    const capture = details => listeners.onBeforeSendHeaders.cb(details);

    it('Detects the built-in service by the Site-Id header', () => {
        capture(apiRequest({ requestHeaders: [...apiRequest().requestHeaders, { name: 'Site-Id', value: '3' }] }));
        expect(globalThis.setToken).toHaveBeenCalledWith('ranobelib', JWT);
    });

    it('Detects the service by the host of the page that made the request', () => {
        capture(apiRequest({ originUrl: 'https://mangalib.org/ru/manga/x' }));
        expect(globalThis.setToken).toHaveBeenCalledWith('mangalib', JWT);
    });

    it('Uses the Chrome initiator origin', () => {
        capture(apiRequest({ initiator: 'https://ranobelib.me' }));
        expect(globalThis.setToken).toHaveBeenCalledWith('ranobelib', JWT);
    });

    it('Detects service plugins by their hosts', () => {
        globalThis.getPluginHosts = vi.fn(() => ({ hlib: ['hentailib.me'] }));
        capture(apiRequest({
            originUrl: 'https://hentailib.me/ru/manga/x',
            requestHeaders: [...apiRequest().requestHeaders, { name: 'Site-Id', value: '4' }]
        }));
        expect(globalThis.setToken).toHaveBeenCalledWith('hlib', JWT);
    });

    it('Does not store a token when the service is unknown', () => {
        capture(apiRequest({ originUrl: 'https://unknown.example/' }));
        capture(apiRequest({ initiator: 'chrome-extension://abc' }));
        capture(apiRequest());
        expect(globalThis.setToken).not.toHaveBeenCalled();
    });

    it('Ignores requests outside the service API and requests without a Bearer token', () => {
        capture(apiRequest({ url: 'https://img3.cdnlibs.org/a.jpg', originUrl: 'https://mangalib.me/' }));
        capture(apiRequest({ originUrl: 'https://mangalib.me/', requestHeaders: [{ name: 'Authorization', value: 'Basic x' }] }));
        capture(apiRequest({ originUrl: 'https://mangalib.me/', requestHeaders: undefined }));
        expect(globalThis.setToken).not.toHaveBeenCalled();
    });
});

describe('Firefox image CORS fix', () => {
    beforeEach(async () => {
        await load('firefox');
    });

    const imageRequest = (origin, extra = {}) => ({
        requestId: 'img1',
        tabId: 5,
        url: 'https://img3.cdnlibs.org/manga/x/1.jpg',
        requestHeaders: origin ? [{ name: 'Origin', value: origin }] : [],
        ...extra
    });

    const respond = (extra = {}) => listeners.onHeadersReceived.cb({
        requestId: 'img1', tabId: 5, url: 'https://img3.cdnlibs.org/manga/x/1.jpg', responseHeaders: [], ...extra
    });

    const corsHeaders = result => Object.fromEntries(result.responseHeaders
        .filter(h => h.name.startsWith('Access-Control'))
        .map(h => [h.name, h.value]));

    it('Allows the origin of a service site with credentials', () => {
        listeners.onBeforeSendHeaders.cb(imageRequest('https://mangalib.me'));
        expect(corsHeaders(respond())).toEqual({
            'Access-Control-Allow-Origin': 'https://mangalib.me',
            'Access-Control-Allow-Credentials': 'true'
        });
    });

    it('Never reflects an arbitrary origin', () => {
        listeners.onBeforeSendHeaders.cb(imageRequest('https://evil.example'));
        expect(corsHeaders(respond())).toEqual({});
    });

    it('Allows the extension origin without credentials', () => {
        listeners.onBeforeSendHeaders.cb(imageRequest('moz-extension://uuid'));
        expect(corsHeaders(respond())).toEqual({ 'Access-Control-Allow-Origin': 'moz-extension://uuid' });
    });

    it('Uses the extension origin for extension requests without an Origin header', () => {
        expect(corsHeaders(respond({ tabId: -1 }))).toEqual({ 'Access-Control-Allow-Origin': 'moz-extension://uuid' });
    });

    it('Uses the site of the image service for tab requests without an Origin header', () => {
        expect(corsHeaders(respond({ url: 'https://cover.imglib.info/a.jpg' }))).toEqual({
            'Access-Control-Allow-Origin': 'https://ranobelib.me',
            'Access-Control-Allow-Credentials': 'true'
        });
    });

    it('Keeps an existing Access-Control-Allow-Origin header', () => {
        listeners.onBeforeSendHeaders.cb(imageRequest('https://mangalib.me'));
        const result = respond({ responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }] });
        expect(result.responseHeaders).toEqual([{ name: 'Access-Control-Allow-Origin', value: '*' }]);
    });

    it('Leaves non-image responses alone', () => {
        expect(respond({ url: 'https://api.cdnlibs.org/api/manga/x' })).toEqual({});
    });

    it.each(['onCompleted', 'onErrorOccurred'])('Forgets the remembered origin on %s', name => {
        listeners.onBeforeSendHeaders.cb(imageRequest('https://ranobelib.me'));
        listeners[name].cb({ requestId: 'img1' });
        expect(corsHeaders(respond())['Access-Control-Allow-Origin']).toBe('https://mangalib.me');
    });

    it('Forgets the remembered origin once the response is handled', () => {
        listeners.onBeforeSendHeaders.cb(imageRequest('https://ranobelib.me'));
        respond();
        expect(corsHeaders(respond())['Access-Control-Allow-Origin']).toBe('https://mangalib.me');
    });
});
