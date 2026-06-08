import { describe, it, expect, vi, beforeEach } from 'vitest';

let BaseService;

beforeEach(async () => {
    const path = require.resolve('../../services/BaseService.js');
    delete require.cache[path];
    await import('../../services/BaseService.js');
    BaseService = global.BaseService;
});

describe('BaseService', () => {
    const config = { name: 'TestService', baseUrl: 'https://test.com' };

    it('Constructs with config and logs', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const svc = new BaseService(config);
        expect(svc.config).toEqual(config);
        expect(svc.name).toBe('TestService');
        expect(svc.baseUrl).toBe('https://test.com');
        expect(logSpy).toHaveBeenCalledWith('[BaseService] Created service: TestService');
        logSpy.mockRestore();
    });

    it('Extract pages correct array for known keys', () => {
        const svc = new BaseService(config);
        expect(svc.extractPages({ pages: [1, 2, 3] })).toEqual([1, 2, 3]);
        expect(svc.extractPages({ images: ['a'] })).toEqual(['a']);
        expect(svc.extractPages({ pages_list: [5] })).toEqual([5]);
        expect(svc.extractPages({ content: ['x', 'y'] })).toEqual(['x', 'y']);
    });

    it('Extract pages returns empty array if no known keys', () => {
        const svc = new BaseService(config);
        expect(svc.extractPages({})).toEqual([]);
        expect(svc.extractPages({ foo: [1, 2] })).toEqual([]);
        expect(svc.extractPages({ pages: [] })).toEqual([]);
    });

    it('Static matches throws error', () => {
        expect(() => BaseService.matches('url')).toThrow('matches must be implemented');
    });

    it('extensionApi falls back to browser when getExtensionApi is not a function', () => {
        delete global.getExtensionApi;
        const svc = new BaseService(config);
        const fakeBrowser = { runtime: {} };
        global.browser = fakeBrowser;
        expect(svc.extensionApi).toBe(fakeBrowser);
        delete global.browser;
    });

    it('extensionApi falls back to chrome when browser is not defined', () => {
        delete global.getExtensionApi;
        delete global.browser;
        const svc = new BaseService(config);
        const fakeChrome = { runtime: {} };
        global.chrome = fakeChrome;
        expect(svc.extensionApi).toBe(fakeChrome);
        delete global.chrome;
    });

    it('extensionApi returns null when neither getExtensionApi, browser nor chrome are defined', () => {
        delete global.getExtensionApi;
        delete global.browser;
        delete global.chrome;
        const svc = new BaseService(config);
        expect(svc.extensionApi).toBeNull();
    });

    it('Delay resolves after given ms', async () => {
        const svc = new BaseService(config);
        const spy = vi.spyOn(global, 'setTimeout');
        await svc.delay(10);
        expect(spy).toHaveBeenCalledWith(expect.any(Function), 10);
        spy.mockRestore();
    });

    it('Fetch with retry returns fetch result on first try', async () => {
        const svc = new BaseService(config);
        const fakeResponse = {};
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        const result = await svc.fetchWithRetry('url', {});
        expect(result).toBe(fakeResponse);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        delete global.fetch;
    });

    it('Fetch with retry retries on failure and then throws', async () => {
        const svc = new BaseService(config);
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error('fail1'))
            .mockRejectedValueOnce(new Error('fail2'))
            .mockRejectedValueOnce(new Error('fail3'));
        global.fetch = fetchMock;
        const delaySpy = vi.spyOn(svc, 'delay').mockResolvedValue();
        await expect(svc.fetchWithRetry('url', {}, 3)).rejects.toThrow('fail3');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(delaySpy).toHaveBeenCalledTimes(2);
        delete global.fetch;
        delaySpy.mockRestore();
    });

    it('loadPageAsBase64 returns base64 string', async () => {
        const svc = new BaseService(config);
        const fakeBlob = new Blob(['test'], { type: 'text/plain' });
        const fakeResponse = { blob: vi.fn().mockResolvedValue(fakeBlob) };
        vi.spyOn(svc, 'fetchWithRetry').mockResolvedValue(fakeResponse);
        const origFileReader = global.FileReader;
        class FakeFileReader {
            constructor() { this.onloadend = null; }
            readAsDataURL(_blob) {
                setTimeout(() => { this.result = 'data:base64,abc'; this.onloadend(); }, 0);
            }
        }
        global.FileReader = FakeFileReader;
        const result = await svc.loadPageAsBase64('url');
        expect(result).toBe('data:base64,abc');
        global.FileReader = origFileReader;
    });

    it('blobToBase64 resolves to base64 string', async () => {
        const svc = new BaseService(config);
        const origFileReader = global.FileReader;
        class FakeFileReader {
            constructor() { this.onloadend = null; }
            readAsDataURL(_blob) {
                setTimeout(() => { this.result = 'data:base64,xyz'; this.onloadend(); }, 0);
            }
        }
        global.FileReader = FakeFileReader;
        const result = await svc.blobToBase64(new Blob(['abc']));
        expect(result).toBe('data:base64,xyz');
        global.FileReader = origFileReader;
    });

    it('Handles 429 response with on429, global throttling and delay then retries', async () => {
        const svc = new BaseService({ name: 'TestService', baseUrl: 'https://test.com' });
        const response429 = {
            status: 429,
            headers: { get: vi.fn(() => '2') }
        };
        const responseOk = { status: 200 };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response429)
            .mockResolvedValueOnce(responseOk);
        global.fetch = fetchMock;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const delaySpy = vi.spyOn(svc, 'delay').mockResolvedValue();
        let on429Called = false;
        svc._on429 = (ms) => { on429Called = ms === 2000; };
        global.globalRateLimiter = { throttle: vi.fn() };
        const result = await svc.fetchWithRateLimitRetry('url', {}, 2);
        expect(result).toBe(responseOk);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalledWith('[TestService] 429 Too Many Requests (attempt 1/2), waiting 2000ms...');
        expect(on429Called).toBe(true);
        expect(global.globalRateLimiter.throttle).toHaveBeenCalledWith(2000);
        expect(delaySpy).toHaveBeenCalledWith(2000);
        warnSpy.mockRestore();
        delaySpy.mockRestore();
        delete global.fetch;
        delete global.globalRateLimiter;
    });

    it('Warns when no globalRateLimiter is found and proceeds with local delay', async () => {
        const svc = new BaseService({ name: 'TestService', baseUrl: 'https://test.com' });
        const response429 = {
            status: 429,
            headers: { get: vi.fn(() => '1') }
        };
        const responseOk = { status: 200 };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response429)
            .mockResolvedValueOnce(responseOk);
        global.fetch = fetchMock;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const delaySpy = vi.spyOn(svc, 'delay').mockResolvedValue();
        delete global.globalRateLimiter;
        delete global.self;
        const result = await svc.fetchWithRateLimitRetry('url', {}, 2);
        expect(result).toBe(responseOk);
        expect(warnSpy).toHaveBeenCalledWith('[TestService] No globalRateLimiter found, proceeding with local delay.');
        warnSpy.mockRestore();
        delaySpy.mockRestore();
        delete global.fetch;
    });

    it('Uses self globalRateLimiter throttle when global is missing but self is present', async () => {
        const svc = new BaseService({ name: 'TestService', baseUrl: 'https://test.com' });
        const response429 = {
            status: 429,
            headers: { get: vi.fn(() => '1') }
        };
        const responseOk = { status: 200 };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response429)
            .mockResolvedValueOnce(responseOk);
        global.fetch = fetchMock;
        delete global.globalRateLimiter;
        global.self = { globalRateLimiter: { throttle: vi.fn() } };
        const delaySpy = vi.spyOn(svc, 'delay').mockResolvedValue();
        const result = await svc.fetchWithRateLimitRetry('url', {}, 2);
        expect(result).toBe(responseOk);
        expect(global.self.globalRateLimiter.throttle).toHaveBeenCalledWith(1000);
        delaySpy.mockRestore();
        delete global.fetch;
        delete global.self;
    });

    it('Uses default waitMs 30000 when Retry-After header is missing or invalid', async () => {
        const svc = new BaseService({ name: 'TestService', baseUrl: 'https://test.com' });
        const response429 = {
            status: 429,
            headers: { get: vi.fn(() => null) }
        };
        const responseOk = { status: 200 };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response429)
            .mockResolvedValueOnce(responseOk);
        global.fetch = fetchMock;
        const delaySpy = vi.spyOn(svc, 'delay').mockResolvedValue();
        global.globalRateLimiter = { throttle: vi.fn() };
        const result = await svc.fetchWithRateLimitRetry('url', {}, 2);
        expect(result).toBe(responseOk);
        expect(delaySpy).toHaveBeenCalledWith(30000);
        delaySpy.mockRestore();
        delete global.fetch;
        delete global.globalRateLimiter;
    });

    it('Throws error after maxRetries when always rate limited', async () => {
        const svc = new BaseService({ name: 'TestService', baseUrl: 'https://test.com' });
        const response429 = {
            status: 429,
            headers: { get: vi.fn(() => '1') }
        };
        const fetchMock = vi.fn().mockResolvedValue(response429);
        global.fetch = fetchMock;
        const delaySpy = vi.spyOn(svc, 'delay').mockResolvedValue();
        await expect(svc.fetchWithRateLimitRetry('url', {}, 3)).rejects.toThrow('Rate limited after 3 retries (429)');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        delaySpy.mockRestore();
        delete global.fetch;
    });

    it('fetchMangaMetadata returns null when urls list is empty', async () => {
        const svc = new BaseService({ name: 'T', baseUrl: 'https://test.com', fields: [] });
        const origPush = Array.prototype.push;
        Array.prototype.push = function() { return 0; };
        try {
            const result = await svc.fetchMangaMetadata('slug');
            expect(result).toBeNull();
        } finally {
            Array.prototype.push = origPush;
        }
    });

    it('fetchChapter includes branch_id param when branchId is provided', async () => {
        const svc = new BaseService({ name: 'T', baseUrl: 'https://test.com', headers: {} });
        const mockResponse = {
            ok: true,
            text: vi.fn().mockResolvedValue(JSON.stringify({ data: 'chapter' }))
        };
        vi.spyOn(svc, 'fetchWithRateLimitRetry').mockResolvedValue(mockResponse);
        await svc.fetchChapter('slug', '1', '1', '123');
        expect(svc.fetchWithRateLimitRetry).toHaveBeenCalledWith(
            expect.stringContaining('branch_id=123'),
            expect.any(Object)
        );
    });
});