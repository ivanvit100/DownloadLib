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

    it('Fetch manga metadata throws error', async () => {
        const svc = new BaseService(config);
        await expect(svc.fetchMangaMetadata('slug')).rejects.toThrow('fetchMangaMetadata must be implemented');
    });

    it('Fetch chapters list throws error', async () => {
        const svc = new BaseService(config);
        await expect(svc.fetchChaptersList('slug')).rejects.toThrow('fetchChaptersList must be implemented');
    });

    it('Fetch chapter throws error', async () => {
        const svc = new BaseService(config);
        await expect(svc.fetchChapter('slug', 1, 1)).rejects.toThrow('fetchChapter must be implemented');
    });

    it('Static matches throws error', () => {
        expect(() => BaseService.matches('url')).toThrow('matches must be implemented');
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
            readAsDataURL(blob) {
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
            readAsDataURL(blob) {
                setTimeout(() => { this.result = 'data:base64,xyz'; this.onloadend(); }, 0);
            }
        }
        global.FileReader = FakeFileReader;
        const result = await svc.blobToBase64(new Blob(['abc']));
        expect(result).toBe('data:base64,xyz');
        global.FileReader = origFileReader;
    });
});