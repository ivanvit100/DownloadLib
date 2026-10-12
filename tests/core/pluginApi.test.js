import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const NAMES = ['BaseExporter', 'ExporterRegistry', 'BaseService', 'serviceRegistry'];

describe('core/pluginApi', () => {
    beforeEach(() => {
        vi.resetModules();
        NAMES.forEach(name => delete globalThis[name]);
    });

    afterEach(() => {
        NAMES.forEach(name => delete globalThis[name]);
    });

    it('Publishes plugin base classes and registries on globalThis', async () => {
        await import('../../core/pluginApi.js');
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
        await import('../../core/pluginApi.js');
        class PluginExporter extends globalThis.BaseExporter {}
        globalThis.ExporterRegistry.register('cbz', PluginExporter, { label: 'CBZ' });
        const { ExporterRegistry } = await import('../../exporters/ExporterRegistry.js');
        expect(ExporterRegistry.create('cbz')).toBeInstanceOf(PluginExporter);
    });
});

describe('core/pluginApi: deprecated network globals keep their old results', () => {
    let legacy;
    let tabResult;

    beforeEach(async () => {
        vi.resetModules();
        vi.doMock('../../core/TabNetwork.js', async importOriginal => ({
            ...await importOriginal(),
            fetchViaTab: vi.fn(async () => tabResult),
            requestViaTab: vi.fn(async () => tabResult)
        }));
        ({ legacyPluginGlobals: legacy } = await import('../../core/pluginApi.js'));
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
