import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mockTrackRequest;
let mockSetLimit;
let mockGetStats;
let mockAddListenerBeforeSendHeaders;
let mockAddListenerOnBeforeRequest;
let mockAddListenerOnHeadersReceived;
let capturedBeforeSendHeadersCb;
let capturedOnBeforeRequestCb;
let capturedHeadersReceivedCb;
let isFirefoxMode;
let isChromeMode;

function setupGlobals(mode) {
    delete globalThis.getExtensionApi;
    delete globalThis.detectServiceByUrl;

    isFirefoxMode = mode === 'firefox';
    isChromeMode = mode === 'chrome';

    mockTrackRequest = vi.fn().mockResolvedValue();
    mockSetLimit = vi.fn();
    mockGetStats = vi.fn().mockReturnValue({ rpm: 10 });

    globalThis.globalRateLimiter = {
        trackRequest: mockTrackRequest,
        recordRequest: vi.fn(),
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

    globalThis.authTokenStore = {};

    capturedBeforeSendHeadersCb = null;
    capturedOnBeforeRequestCb = null;
    capturedHeadersReceivedCb = null;

    mockAddListenerBeforeSendHeaders = vi.fn((cb) => { capturedBeforeSendHeadersCb = cb; });
    mockAddListenerOnBeforeRequest = vi.fn((cb) => { capturedOnBeforeRequestCb = cb; });
    mockAddListenerOnHeadersReceived = vi.fn((cb) => { capturedHeadersReceivedCb = cb; });

    const apiObj = {
        webRequest: {
            onBeforeSendHeaders: { addListener: mockAddListenerBeforeSendHeaders },
            onBeforeRequest: { addListener: mockAddListenerOnBeforeRequest },
            onHeadersReceived: { addListener: mockAddListenerOnHeadersReceived },
        },
        runtime: { id: 'test-ext-id' },
    };

    if (isChromeMode) {
        delete globalThis.browser;
        globalThis.chrome = {
            ...apiObj,
            declarativeNetRequest: {},
        };
    } else if (isFirefoxMode) {
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
    globalThis.authTokenStore = {};
    await import('../../background/RequestInterceptor.js');
}

describe('RequestInterceptor', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.detectServiceByUrl;
        delete globalThis.authTokenStore;
    });

    describe('Firefox mode', () => {
        beforeEach(async () => {
            setupGlobals('firefox');
            await loadModule();
        });

        it('Registers webRequest listener with blocking mode', () => {
            expect(mockAddListenerBeforeSendHeaders).toHaveBeenCalledWith(
                expect.any(Function),
                {
                    urls: [
                        'https://api.cdnlibs.org/*',
                        'https://cover.cdnlibs.org/*',
                        'https://img3.cdnlibs.org/*',
                        'https://*.mixlib.me/*',
                        'https://*.imglib.info/*',
                        'https://*.imgslib.link/*',
                        'https://ranobelib.me/*',
                        'https://*.ranobelib.me/*',
                        'https://*.mangalib.me/*',
                        'https://*.mangalib.org/*'
                    ]
                },
                ['blocking', 'requestHeaders'],
            );
        });

        it('Registers onBeforeRequest listener', () => {
            expect(mockAddListenerOnBeforeRequest).toHaveBeenCalledWith(
                expect.any(Function),
                {
                    urls: [
                        'https://mangalib.me/uploads/slider_items/*',
                        'https://yandex.ru/*'
                    ]
                },
                ['blocking'],
            );
        });

        it('Registers onHeadersReceived listener', () => {
            expect(mockAddListenerOnHeadersReceived).toHaveBeenCalledWith(
                expect.any(Function),
                { urls: expect.any(Array) },
                ['blocking', 'responseHeaders'],
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
                    { name: 'X-Extension-Request', value: 'true' },
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
                    { name: 'X-Extension-Request', value: 'true' },
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
                    { name: 'X-Extension-Request', value: 'true' },
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
                    { name: 'X-Extension-Request', value: 'true' },
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
                    { name: 'X-Extension-Request', value: 'true' },
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
                requestHeaders: [{ name: 'X-Extension-Request', value: 'true' }],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Detects mangalib by imglib.info url', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://cdn.imglib.info/image.jpg',
                requestHeaders: [{ name: 'X-Extension-Request', value: 'true' }],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Detects mangalib by imgslib.link url', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://cdn.imgslib.link/image.jpg',
                requestHeaders: [{ name: 'X-Extension-Request', value: 'true' }],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Returns headers without modification when no service config', async () => {
            const headers = [{ name: 'X-Test', value: 'val' }];
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://other.com/page',
                requestHeaders: [{ name: 'X-Extension-Request', value: 'true' }, ...headers],
            });
            expect(result.requestHeaders).toEqual([{ name: 'X-Extension-Request', value: 'true' }, ...headers]);
        });

        it('Falls back to empty array when requestHeaders is undefined', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://example.com/page',
                originUrl: 'moz-extension://abc/popup.html',
                requestHeaders: undefined,
            });
            expect(mockTrackRequest).not.toHaveBeenCalled();
            expect(result).toEqual({ requestHeaders: [] });
        });

        it('Returns null for image request from unknown cdn without matching service url', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://cdn.example.com/uploads/image.jpg',
                requestHeaders: [],
            });
            expect(mockTrackRequest).not.toHaveBeenCalled();
        });

        it('Warns when no headers found for service config without targetHeaders', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            globalThis.mangalibConfig = { headers: null, imageHeaders: null };
            await loadModule();
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.mangalib.me/data',
                requestHeaders: [
                    { name: 'X-Extension-Request', value: 'true' },
                    { name: 'Referer', value: 'https://mangalib.me/' }
                ],
            });
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No headers found for service mangalib'));
            warnSpy.mockRestore();
        });

        it('Detects service by X-DL-Service header', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [
                    { name: 'X-Extension-Request', value: 'true' },
                    { name: 'X-DL-Service', value: 'ranobelib' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('ranobelib');
        });

        it('Detects mangalib by X-DL-Service header', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [
                    { name: 'X-Extension-Request', value: 'true' },
                    { name: 'X-DL-Service', value: 'mangalib' },
                    { name: 'Site-Id', value: '3' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Detects service by Site-Id header', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [
                    { name: 'X-Extension-Request', value: 'true' },
                    { name: 'Site-Id', value: '1' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Detects ranobelib by Site-Id 3 when service header value is empty', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [
                    { name: 'X-Extension-Request', value: 'true' },
                    { name: 'X-DL-Service', value: undefined },
                    { name: 'Site-Id', value: '3' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('ranobelib');
        });

        it('Falls back from unknown service header to Site-Id mapping', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [
                    { name: 'X-Extension-Request', value: 'true' },
                    { name: 'X-DL-Service', value: 'unknown-service' },
                    { name: 'Site-Id', value: '1' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Falls back from unknown Site-Id to referer mapping', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [
                    { name: 'X-Extension-Request', value: 'true' },
                    { name: 'Site-Id', value: '2' },
                    { name: 'Referer', value: 'https://ranobelib.me/title' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('ranobelib');
        });

        it('Falls back from empty Site-Id value to referer mapping', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [
                    { name: 'X-Extension-Request', value: 'true' },
                    { name: 'Site-Id', value: undefined },
                    { name: 'Referer', value: 'https://mangalib.me/title' },
                ],
            });
            expect(mockTrackRequest).toHaveBeenCalledWith('mangalib');
        });

        it('Does not track non-extension service request', async () => {
            const details = {
                tabId: 1,
                frameId: 0,
                url: 'https://api.mangalib.me/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            };
            await capturedBeforeSendHeadersCb(details);
            expect(globalThis.globalRateLimiter.recordRequest).not.toHaveBeenCalled();
            expect(mockTrackRequest).not.toHaveBeenCalled();
        });

        it('Captures Bearer token from non-extension request to api.cdnlibs.org', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: 1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [{ name: 'Authorization', value: 'Bearer capturedtoken' }],
                originUrl: 'https://mangalib.me/',
            });
            expect(console.log).toHaveBeenCalledWith('[RequestInterceptor] Captured auth token for mangalib');
        });

        it('Captures Bearer token and detects ranobelib service via originUrl', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: 1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [{ name: 'Authorization', value: 'Bearer ranobetoken' }],
                originUrl: 'https://ranobelib.me/',
            });
            expect(console.log).toHaveBeenCalledWith('[RequestInterceptor] Captured auth token for ranobelib');
        });

        it('Does not re-capture same Bearer token', async () => {
            const details = {
                tabId: 1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [{ name: 'Authorization', value: 'Bearer same-token' }],
                originUrl: 'https://mangalib.me/',
            };
            await capturedBeforeSendHeadersCb(details);
            console.log.mockClear();
            await capturedBeforeSendHeadersCb(details);
            expect(console.log).not.toHaveBeenCalledWith('[RequestInterceptor] Captured auth token for mangalib');
        });

        it('Injects cached auth token into extension request to api.cdnlibs.org', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: 1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [{ name: 'Authorization', value: 'Bearer injected-token' }],
                originUrl: 'https://mangalib.me/',
            });
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [
                    { name: 'X-Extension-Request', value: 'true' },
                    { name: 'X-DL-Service', value: 'mangalib' },
                ],
            });
            const auth = result.requestHeaders.find(h => h.name === 'Authorization');
            expect(auth.value).toBe('Bearer injected-token');
        });

        it('Updates existing Authorization header when injecting cached token', async () => {
            await capturedBeforeSendHeadersCb({
                tabId: 1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [{ name: 'Authorization', value: 'Bearer new-token' }],
                originUrl: 'https://mangalib.me/',
            });
            const result = await capturedBeforeSendHeadersCb({
                tabId: -1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [
                    { name: 'X-Extension-Request', value: 'true' },
                    { name: 'X-DL-Service', value: 'mangalib' },
                    { name: 'Authorization', value: 'Bearer old-token' },
                ],
            });
            const auth = result.requestHeaders.find(h => h.name === 'Authorization');
            expect(auth.value).toBe('Bearer new-token');
        });

        it('Does not capture token when Authorization value does not start with Bearer', async () => {
            console.log.mockClear();
            await capturedBeforeSendHeadersCb({
                tabId: 1,
                frameId: 0,
                url: 'https://api.cdnlibs.org/api/manga/slug',
                requestHeaders: [{ name: 'Authorization', value: 'Basic dXNlcjpwYXNz' }],
                originUrl: 'https://mangalib.me/',
            });
            expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Captured auth token'));
        });

        it('onHeadersReceived returns empty object for non-image request', () => {
            const result = capturedHeadersReceivedCb({
                url: 'https://api.mangalib.me/data',
                responseHeaders: [],
            });
            expect(result).toEqual({});
        });

        it('onHeadersReceived adds CORS header using service URL fallback for image request', () => {
            const result = capturedHeadersReceivedCb({
                requestId: 'req-1',
                tabId: 1,
                url: 'https://img.mixlib.me/image.jpg',
                responseHeaders: [],
            });
            const acao = result.responseHeaders.find(h => h.name === 'Access-Control-Allow-Origin');
            expect(acao).toBeDefined();
            expect(acao.value).toBe('https://mangalib.me');
        });

        it('onHeadersReceived adds CORS header for ranobelib image', () => {
            const result = capturedHeadersReceivedCb({
                requestId: 'req-2',
                tabId: 1,
                url: 'https://ranobelib.me/uploads/image.jpg',
                responseHeaders: [],
            });
            const acao = result.responseHeaders.find(h => h.name === 'Access-Control-Allow-Origin');
            expect(acao.value).toBe('https://ranobelib.me');
        });

        it('onHeadersReceived uses moz-extension origin for background fetch (tabId=-1)', () => {
            const result = capturedHeadersReceivedCb({
                requestId: 'req-3',
                tabId: -1,
                url: 'https://img.mixlib.me/image.jpg',
                responseHeaders: [],
            });
            const acao = result.responseHeaders.find(h => h.name === 'Access-Control-Allow-Origin');
            expect(acao.value).toContain('moz-extension://');
        });

        it('onHeadersReceived uses captured origin when pendingOrigins has entry', async () => {
            await capturedBeforeSendHeadersCb({
                requestId: 'req-cors',
                tabId: 1,
                url: 'https://img.mixlib.me/image.jpg',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                    { name: 'Origin', value: 'https://mangalib.me' },
                ],
            });

            const result = capturedHeadersReceivedCb({
                requestId: 'req-cors',
                tabId: 1,
                url: 'https://img.mixlib.me/image.jpg',
                responseHeaders: [],
            });
            const acao = result.responseHeaders.find(h => h.name === 'Access-Control-Allow-Origin');
            expect(acao.value).toBe('https://mangalib.me');
            const acac = result.responseHeaders.find(h => h.name === 'Access-Control-Allow-Credentials');
            expect(acac.value).toBe('true');
        });

        it('onHeadersReceived does not duplicate ACAO when already present', () => {
            const result = capturedHeadersReceivedCb({
                requestId: 'req-dup',
                tabId: 1,
                url: 'https://img.mixlib.me/image.jpg',
                responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: 'https://mangalib.me' }],
            });
            const cors = result.responseHeaders.filter(h => h.name.toLowerCase() === 'access-control-allow-origin');
            expect(cors).toHaveLength(1);
        });

        it('onHeadersReceived handles missing responseHeaders', () => {
            const result = capturedHeadersReceivedCb({
                requestId: 'req-no-headers',
                tabId: 1,
                url: 'https://img.mixlib.me/image.jpg',
            });
            expect(result.responseHeaders).toContainEqual(
                expect.objectContaining({ name: 'Access-Control-Allow-Origin' })
            );
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
                {
                    urls: [
                        'https://api.cdnlibs.org/*',
                        'https://*.mixlib.me/*',
                        'https://*.imglib.info/*',
                        'https://*.imgslib.link/*',
                        'https://*.ranobelib.me/*',
                        'https://*.mangalib.me/*',
                        'https://*.mangalib.org/*'
                    ]
                },
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

        it('Does not track when extension request has no detectable service', async () => {
            await capturedBeforeSendHeadersCb({
                url: 'https://api.cdnlibs.org/unknown/path',
                requestHeaders: [{ name: 'X-Extension-Request', value: 'true' }],
            });
            expect(mockTrackRequest).not.toHaveBeenCalled();
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
            const result = await capturedBeforeSendHeadersCb({
                originUrl: 'moz-extension://test-id/background.js',
                url: 'https://ranobelib.me/uploads/image.jpg',
                requestHeaders: [],
            });
            const custom = result.requestHeaders.find(h => h.name === 'X-Custom');
            expect(custom.value).toBe('ranobelib');
        });

        it('Detects image request with covers path', async () => {
            const result = await capturedBeforeSendHeadersCb({
                originUrl: 'moz-extension://test-id/background.js',
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
                originUrl: 'moz-extension://test-id/background.js',
                url: 'https://cdn.example.com/uploads/image.jpg',
                requestHeaders: [
                    { name: 'Referer', value: 'https://mangalib.me/' },
                ],
            });
            const accept = result.requestHeaders.find(h => h.name === 'Accept');
            expect(accept.value).toBe('image/webp');
        });

        it('Applies ranobelib headers without imageHeaders fallback', async () => {
            const result = await capturedBeforeSendHeadersCb({
                originUrl: 'moz-extension://test-id/background.js',
                url: 'https://ranobelib.me/api/data',
                requestHeaders: [
                    { name: 'Referer', value: 'https://ranobelib.me/' },
                ],
            });
            const custom = result.requestHeaders.find(h => h.name === 'X-Custom');
            expect(custom.value).toBe('ranobelib');
        });

        it('Exposes detectServiceByUrl globally', () => {
            expect(typeof globalThis.detectServiceByUrl).toBe('function');
            expect(globalThis.detectServiceByUrl('https://ranobelib.me/book/slug')).toBe('ranobelib');
            expect(globalThis.detectServiceByUrl('https://mangalib.me/manga/slug')).toBe('mangalib');
            expect(globalThis.detectServiceByUrl('https://example.com')).toBeNull();
        });

        it('detectServiceByUrl returns mangalib for cdnlibs.org URL', () => {
            expect(globalThis.detectServiceByUrl('https://img3.cdnlibs.org/image.jpg')).toBe('mangalib');
            expect(globalThis.detectServiceByUrl('https://cover.cdnlibs.org/cover.jpg')).toBe('mangalib');
        });

        it('onBeforeSendHeaders handles image request with undefined requestHeaders', async () => {
            const result = await capturedBeforeSendHeadersCb({
                tabId: 1,
                url: 'https://img.mixlib.me/image.jpg',
            });
            expect(result).toEqual({});
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
            await import('../../background/RequestInterceptor.js');
            expect(globalThis.authTokenStore).toBeDefined();
        });
    });

    describe('With getExtensionApi and getBrowserEnv defined', () => {
        beforeEach(async () => {
            setupGlobals('chrome');
            const apiObj = {
                webRequest: {
                    onBeforeSendHeaders: { addListener: vi.fn() },
                    onBeforeRequest: { addListener: vi.fn() }
                },
                runtime: { id: 'ext-id' },
                declarativeNetRequest: {}
            };
            globalThis.getExtensionApi = vi.fn(() => apiObj);
            globalThis.getBrowserEnv = vi.fn(() => ({
                isFirefox: false,
                isChromium: true,
                supportsDnr: false
            }));
            await loadModule();
        });

        it('Calls getExtensionApi when defined as a function', () => {
            expect(globalThis.getExtensionApi).toHaveBeenCalled();
        });

        it('Calls getBrowserEnv when defined as a function', () => {
            expect(globalThis.getBrowserEnv).toHaveBeenCalled();
        });
    });
});
