import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const NAMES = ['BaseExporter', 'ExporterRegistry', 'BaseService', 'serviceRegistry'];

// Первый импорт PluginApi тянет весь граф модулей попапа: под инструментированием
// покрытия и при параллельных тестах он может занимать больше 5 с.
describe('core/PluginApi', { timeout: 30000 }, () => {
    beforeEach(() => {
        vi.resetModules();
        NAMES.forEach(name => delete globalThis[name]);
    });

    afterEach(() => {
        NAMES.forEach(name => delete globalThis[name]);
    });

    it('Publishes plugin base classes and registries on globalThis', async () => {
        await import('../../core/PluginApi.js');
        const { BaseExporter } = await import('../../exporters/BaseExporter.js');
        const { ExporterRegistry } = await import('../../exporters/ExporterRegistry.js');
        const { BaseService } = await import('../../services/BaseService.js');
        const { serviceRegistry } = await import('../../services/ServiceRegistry.js');

        expect(globalThis.BaseExporter).toBe(BaseExporter);
        expect(globalThis.ExporterRegistry).toBe(ExporterRegistry);
        expect(globalThis.BaseService).toBe(BaseService);
        expect(globalThis.serviceRegistry).toBe(serviceRegistry);
    });

    it('Lets a classic plugin script register an exporter', async () => {
        await import('../../core/PluginApi.js');
        class PluginExporter extends globalThis.BaseExporter {}
        globalThis.ExporterRegistry.register('cbz', PluginExporter, { label: 'CBZ' });
        const { ExporterRegistry } = await import('../../exporters/ExporterRegistry.js');
        expect(ExporterRegistry.create('cbz')).toBeInstanceOf(PluginExporter);
    });
});

describe('core/PluginApi: deprecated network globals keep their old results', { timeout: 30000 }, () => {
    let legacy;
    let tabResult;

    beforeEach(async () => {
        vi.resetModules();
        vi.doMock('../../core/TabNetwork.js', async importOriginal => ({
            ...await importOriginal(),
            fetchViaTab: vi.fn(async () => tabResult),
            requestViaTab: vi.fn(async () => tabResult),
            hasServiceTab: vi.fn(async serviceKey => serviceKey === 'mangalib'),
            setServiceTab: vi.fn()
        }));
        ({ legacyPluginGlobals: legacy } = await import('../../core/PluginApi.js'));
    });

    afterEach(() => {
        vi.doUnmock('../../core/TabNetwork.js');
    });

    it('fetchViaTab returns {ok, base64, contentType} on success', async () => {
        tabResult = { ok: true, status: 200, noTab: false, retryAfter: null, base64: 'AAAA', contentType: 'image/png' };
        await expect(legacy.fetchViaTab('https://img.example/a.png', 'mangalib'))
            .resolves.toEqual({ ok: true, base64: 'AAAA', contentType: 'image/png' });
    });

    it.each([
        ['there is no service tab', { ok: false, status: 0, noTab: true, error: 'No service tab' }],
        ['the request fails', { ok: false, status: 404, noTab: false, error: 'HTTP 404' }]
    ])('fetchViaTab returns null when %s', async (_case, result) => {
        tabResult = result;
        await expect(legacy.fetchViaTab('https://img.example/a.png', 'mangalib')).resolves.toBeNull();
    });

    it('requestViaTab keeps ok, status, text, retryAfter and noTab', async () => {
        tabResult = { ok: false, status: 429, text: '', retryAfter: '5', noTab: false };
        await expect(legacy.requestViaTab('https://api.example/x', {}, 'mangalib'))
            .resolves.toMatchObject({ ok: false, status: 429, text: '', retryAfter: '5', noTab: false });
    });

    it('hasServiceTab and setServiceTab delegate to the network layer', async () => {
        const { hasServiceTab, setServiceTab } = await import('../../core/TabNetwork.js');
        await expect(legacy.hasServiceTab('mangalib')).resolves.toBe(true);
        await expect(legacy.hasServiceTab('ranobelib')).resolves.toBe(false);
        legacy.setServiceTab(42);
        expect(hasServiceTab).toHaveBeenCalledWith('mangalib');
        expect(setServiceTab).toHaveBeenCalledWith(42);
    });

    it('fetchPageImage returns {ok, base64, contentType} or {ok:false, error}', async () => {
        tabResult = { ok: true, status: 200, noTab: false, retryAfter: null, base64: 'AAAA', contentType: 'image/png' };
        await expect(legacy.fetchPageImage('https://img.example/a.png', 'mangalib'))
            .resolves.toEqual({ ok: true, base64: 'AAAA', contentType: 'image/png' });

        tabResult = { ok: false, status: 404, noTab: false, error: 'HTTP 404' };
        await expect(legacy.fetchPageImage('https://img.example/a.png', 'mangalib')).resolves.toEqual({ ok: false, error: 'HTTP 404' });
        tabResult = { ok: false, status: 0, noTab: false };
        await expect(legacy.fetchPageImage('https://img.example/a.png', 'mangalib')).resolves.toEqual({ ok: false, error: 'Image fetch failed' });
    });

    it('fetchPageImage throws NoServiceTabError without a service tab', async () => {
        tabResult = { ok: false, status: 0, noTab: true, error: 'No service tab' };
        await expect(legacy.fetchPageImage('https://img.example/a.png', 'mangalib')).rejects.toBeInstanceOf(legacy.NoServiceTabError);
    });

    it('loadImageOrDefer uses the current download, or just loads outside a download', async () => {
        const { DownloadContext } = await import('../../core/DownloadContext.js');
        await expect(legacy.loadImageOrDefer(1, async () => ['plain'])).resolves.toEqual(['plain']);

        const ctx = new DownloadContext();
        const defer = vi.spyOn(ctx, 'loadImageOrDefer').mockResolvedValue(['deferred']);
        ctx.activate();
        const load = vi.fn();
        await expect(legacy.loadImageOrDefer(2, load)).resolves.toEqual(['deferred']);
        expect(defer).toHaveBeenCalledWith(2, load);
        ctx.deactivate();
    });
});

describe('core/PluginApi: deprecated globalRateLimiter works through the background limiter', { timeout: 30000 }, () => {
    let limiter;
    let client;

    beforeEach(async () => {
        vi.resetModules();
        client = {
            acquire: vi.fn(async () => {}),
            throttle: vi.fn(),
            setLimit: vi.fn(async () => {}),
            getStats: vi.fn(() => ({ pending: 0 })),
            reset: vi.fn()
        };
        vi.doMock('../../core/RateLimitClient.js', () => ({ RateLimitClient: client }));
        ({ legacyPluginGlobals: { globalRateLimiter: limiter } } = await import('../../core/PluginApi.js'));
    });

    afterEach(() => {
        vi.doUnmock('../../core/RateLimitClient.js');
    });

    it('Asks the background limiter for a slot under the old method names', async () => {
        await limiter.trackRequest('plugin');
        await limiter.trackRequest();
        limiter.recordRequest('page');
        limiter.recordRequest();
        await limiter.acquire('hlib');
        await limiter.acquire();
        expect(client.acquire.mock.calls.map(([key]) => key)).toEqual(['plugin', 'unknown', 'page', 'unknown', 'hlib', 'default']);
    });

    it('execute waits for a slot and then runs the function', async () => {
        const order = [];
        client.acquire.mockImplementation(async key => { order.push(`acquire:${key}`); });
        await expect(limiter.execute('hlib', async () => { order.push('run'); return 5; })).resolves.toBe(5);
        expect(order).toEqual(['acquire:hlib', 'run']);
    });

    it('Passes throttle, setLimit, getStats and reset to the client', () => {
        limiter.throttle(5000);
        limiter.throttle();
        limiter.setLimit(20);
        expect(limiter.getStats()).toEqual({ pending: 0 });
        limiter.reset();
        expect(client.throttle.mock.calls).toEqual([[5000], [30000]]);
        expect(client.setLimit).toHaveBeenCalledWith(20);
        expect(client.reset).toHaveBeenCalled();
    });
});
