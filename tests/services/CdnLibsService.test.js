import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../core/TabNetwork.js', async () =>
    (await import('../helpers/globalBridge.js')).globalBridge('fetchViaTab', 'requestViaTab', 'NoServiceTabError'));
vi.mock('../../core/ImageCompressor.js', async () =>
    (await import('../helpers/globalBridge.js')).globalBridge('ImageCompressor', 'PAGE_ASPECT'));

let CdnLibsService, DownloadContext;

const CONFIG = { name: 'cdn', baseUrl: 'https://api.test', imagesDomain: 'https://img.test', headers: {} };
const IMAGE = { ok: true, status: 200, noTab: false, base64: 'RAW', contentType: 'image/png' };

/**
 * Сервис на CdnLibsService с заданным конфигом.
 * @param {object} [config] - Поля конфига поверх CONFIG.
 * @returns {object} Экземпляр сервиса.
 */
function service(config = {}) {
    return new CdnLibsService({ ...CONFIG, ...config });
}

beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.clear();
    globalThis.NoServiceTabError = class NoServiceTabError extends Error {};
    globalThis.PAGE_ASPECT = 297 / 210;
    globalThis.fetchViaTab = vi.fn(async () => IMAGE);
    globalThis.ImageCompressor = {
        process: vi.fn(async (base64, contentType, opts) => [{ base64: `${base64}:${opts.format}`, contentType: opts.format }])
    };
    ({ CdnLibsService } = await import('../../services/CdnLibsService.js'));
    ({ DownloadContext } = await import('../../core/DownloadContext.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    ['NoServiceTabError', 'PAGE_ASPECT', 'fetchViaTab', 'ImageCompressor'].forEach(name => delete globalThis[name]);
});

describe('CdnLibsService: page references', () => {
    it.each([
        ['a path', '/manga/x/01.jpg', 'https://img.test/manga/x/01.jpg'],
        ['a relative path', 'manga/x/01.jpg', 'https://img.test/manga/x/01.jpg'],
        ['a //path from the API', '//manga/x/01.jpg', 'https://img.test/manga/x/01.jpg'],
        ['an absolute URL', 'https://cdn.example/01.jpg', 'https://cdn.example/01.jpg'],
        ['a page with filename', { filename: '/a.jpg', url: '/b.jpg' }, 'https://img.test/a.jpg'],
        ['a page with url', { url: '//manga/x/02.jpg' }, 'https://img.test/manga/x/02.jpg'],
        ['a page with image', { image: 'c.jpg' }, 'https://img.test/c.jpg'],
        ['a page with src', { src: 'https://cdn.example/d.jpg' }, 'https://cdn.example/d.jpg']
    ])('resolvePageUrl handles %s', (_case, ref, url) => {
        expect(service().resolvePageUrl(ref)).toBe(url);
    });

    it('resolvePageUrl returns null without a reference', () => {
        const svc = service();
        [null, undefined, '', {}, { other: 1 }].forEach(ref => expect(svc.resolvePageUrl(ref)).toBeNull());
    });

    it('extractText turns the pages of a chapter into image blocks', () => {
        const svc = service();
        expect(svc.extractText({ pages: ['a.jpg', { url: '//b.jpg' }, { filename: 'c.jpg' }, 7] })).toEqual([
            { type: 'image', src: 'a.jpg' }, { type: 'image', src: '//b.jpg' },
            { type: 'image', src: 'c.jpg' }, { type: 'image', src: '7' }
        ]);
        expect(svc.extractText({})).toEqual([]);
    });
});

describe('CdnLibsService: image server', () => {
    const servers = {
        compression: { domain: 'https://compressed.test', compress: true },
        original: { domain: 'https://original.test', compress: false }
    };

    it('Uses imagesDomain with compression without imageServers', () => {
        expect(service()._activeServer()).toEqual({ domain: 'https://img.test', compress: true });
    });

    it('Prefers the server chosen by the user, then defaultImageServer, then compression', () => {
        const svc = service({ imageServers: servers, defaultImageServer: 'original' });
        expect(svc._activeServer()).toBe(servers.original);
        localStorage.setItem('cdn_image_server', 'compression');
        expect(svc._activeServer()).toBe(servers.compression);
        localStorage.setItem('cdn_image_server', 'missing');
        expect(svc._activeServer()).toBe(servers.compression);
        expect(service({ imageServers: { other: servers.original } })._activeServer())
            .toEqual({ domain: 'https://img.test', compress: true });
    });

    it('Builds page URLs on the domain of the active server', () => {
        expect(service({ imageServers: servers }).resolvePageUrl('/a.jpg')).toBe('https://compressed.test/a.jpg');
    });
});

describe('CdnLibsService.loadPage', () => {
    it('Loads the page through the service tab and processes it', async () => {
        const svc = service();
        const parts = await svc.loadPage('/a.png', { compressionFormat: 'image/webp', compressionQuality: 0.7 });
        expect(fetchViaTab).toHaveBeenCalledWith('https://img.test/a.png', 'cdn', expect.objectContaining({ beforeSend: expect.any(Function) }));
        expect(ImageCompressor.process).toHaveBeenCalledWith('RAW', 'image/png', { format: 'image/webp', quality: 0.7 });
        expect(parts).toEqual([{ base64: 'RAW:image/webp', contentType: 'image/webp' }]);
    });

    it('Passes the image fit of the download', async () => {
        await service().loadPage('/a.png', { imageFit: { maxWidth: 560, maxHeight: 740 } });
        expect(ImageCompressor.process.mock.calls[0][2]).toMatchObject({ maxWidth: 560, maxHeight: 740 });
    });

    it('Splits long pages only when both the config and the download allow it', async () => {
        await service({ splitLongImages: true, maxImageHeight: 1800 }).loadPage('/a', { splitLongImages: true });
        expect(ImageCompressor.process.mock.calls[0][2]).toMatchObject({ splitAspect: 297 / 210, maxPartHeight: 1800 });

        await service({ splitLongImages: true }).loadPage('/a', { splitLongImages: true });
        expect(ImageCompressor.process.mock.calls[1][2]).toMatchObject({ splitAspect: 297 / 210, maxPartHeight: Infinity });

        await service({ splitLongImages: true }).loadPage('/a', { splitLongImages: false });
        await service({ splitLongImages: false }).loadPage('/a', { splitLongImages: true });
        expect(ImageCompressor.process.mock.calls[2][2].splitAspect).toBeUndefined();
        expect(ImageCompressor.process.mock.calls[3][2].splitAspect).toBeUndefined();
    });

    it('Keeps the page as is on a server with compress:false', async () => {
        const svc = service({ imageServers: { compression: { domain: 'https://o.test', compress: false } } });
        await expect(svc.loadPage('/a.png', { splitLongImages: true })).resolves.toEqual([{ base64: 'RAW', contentType: 'image/png' }]);
        expect(ImageCompressor.process).not.toHaveBeenCalled();
    });

    it('Returns null when the page reference or the image is bad', async () => {
        const svc = service();
        await expect(svc.loadPage(null)).resolves.toBeNull();
        fetchViaTab.mockResolvedValue({ ok: false, status: 404, noTab: false, error: 'HTTP 404' });
        await expect(svc.loadPage('/a.png')).resolves.toBeNull();
        expect(console.warn).toHaveBeenCalledWith('[cdn] Failed to fetch https://img.test/a.png:', 'HTTP 404');
    });

    it('Loads a page once per cache', async () => {
        const svc = service();
        const cache = new Map();
        const first = await svc.loadPage('/a.png', {}, cache);
        await expect(svc.loadPage({ filename: '/a.png' }, {}, cache)).resolves.toBe(first);
        expect(fetchViaTab).toHaveBeenCalledTimes(1);
    });

    it('Throws NoServiceTabError without a service tab', async () => {
        fetchViaTab.mockResolvedValue({ ok: false, status: 0, noTab: true });
        await expect(service().loadPage('/a.png')).rejects.toBeInstanceOf(NoServiceTabError);
    });
});

describe('CdnLibsService.loadPageAsBase64 (previous interface)', () => {
    it('Returns one image, or the parts of a split page', async () => {
        const svc = service({ splitLongImages: true });
        await expect(svc.loadPageAsBase64('/a.png')).resolves.toEqual({ base64: 'RAW:image/jpeg', contentType: 'image/jpeg' });
        expect(ImageCompressor.process.mock.calls[0][2].splitAspect).toBe(297 / 210);

        ImageCompressor.process.mockResolvedValue([{ base64: '1' }, { base64: '2' }]);
        await expect(svc.loadPageAsBase64('/b.png')).resolves.toEqual([{ base64: '1' }, { base64: '2' }]);

        await svc.loadPageAsBase64('/c.png', { splitLongImages: false });
        expect(ImageCompressor.process.mock.calls[2][2].splitAspect).toBeUndefined();
    });

    it('Returns null on a failed page and on unexpected errors', async () => {
        const svc = service();
        fetchViaTab.mockResolvedValueOnce({ ok: false, status: 404, noTab: false });
        await expect(svc.loadPageAsBase64('/a.png')).resolves.toBeNull();
        ImageCompressor.process.mockRejectedValueOnce(new Error('canvas'));
        await expect(svc.loadPageAsBase64('/a.png')).resolves.toBeNull();
    });

    it('Rethrows NoServiceTabError and a stopped download', async () => {
        const svc = service();
        fetchViaTab.mockResolvedValueOnce({ ok: false, status: 0, noTab: true });
        await expect(svc.loadPageAsBase64('/a.png')).rejects.toBeInstanceOf(NoServiceTabError);

        const aborted = Object.assign(new Error('Download aborted'), { aborted: true });
        svc.attach({ checkpoint: vi.fn().mockRejectedValue(aborted) });
        await expect(svc.loadPageAsBase64('/a.png')).rejects.toBe(aborted);
    });
});

describe('CdnLibsService.processChapterContent', () => {
    const pages = n => Array.from({ length: n }, (_, i) => ({ url: `//p/${i + 1}.jpg` }));

    it('Loads the pages of the chapter data in order as image blocks', async () => {
        const svc = service();
        const blocks = await svc.processChapterContent([], null, { chapterMeta: { pages: pages(3) } });
        expect(blocks.map(b => b.type)).toEqual(['image', 'image', 'image']);
        expect(blocks.map(b => b.originalIndex)).toEqual([0, 1, 2]);
        expect(fetchViaTab.mock.calls.map(([url]) => url)).toEqual([
            'https://img.test/p/1.jpg', 'https://img.test/p/2.jpg', 'https://img.test/p/3.jpg'
        ]);
    });

    it('Falls back to the pages from extractText', async () => {
        const blocks = await service().processChapterContent([{ type: 'image', src: '/x.jpg' }, { type: 'text' }], null, {});
        expect(blocks).toHaveLength(1);
        expect(fetchViaTab.mock.calls[0][0]).toBe('https://img.test/x.jpg');
    });

    it('Returns nothing for a chapter without pages', async () => {
        await expect(service().processChapterContent(null, null)).resolves.toEqual([]);
    });

    it('Loads at most five pages at once', async () => {
        let running = 0;
        let peak = 0;
        fetchViaTab.mockImplementation(async () => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise(resolve => setTimeout(resolve, 5));
            running -= 1;
            return IMAGE;
        });
        await service().processChapterContent([], null, { chapterMeta: { pages: pages(12) } });
        expect(peak).toBe(5);
    });

    it('Turns the parts of a split page into numbered blocks', async () => {
        ImageCompressor.process.mockResolvedValue([{ base64: '1' }, { base64: '2' }]);
        const blocks = await service({ splitLongImages: true }).processChapterContent([], null, {
            chapterMeta: { pages: pages(1) }, splitLongImages: true
        });
        expect(blocks).toMatchObject([
            { type: 'image', data: { base64: '1' }, originalIndex: 0, partIndex: 0, totalParts: 2 },
            { type: 'image', data: { base64: '2' }, originalIndex: 0, partIndex: 1, totalParts: 2 }
        ]);
        expect(blocks[0].id).not.toBe(blocks[1].id);
    });

    it('Leaves an error text in place of a page that failed', async () => {
        fetchViaTab.mockResolvedValueOnce(IMAGE).mockResolvedValueOnce({ ok: false, status: 500, noTab: false });
        const blocks = await service().processChapterContent([], null, { chapterMeta: { pages: pages(2) } });
        expect(blocks[1]).toEqual({ type: 'text', text: '[Ошибка загрузки изображения 2]' });
    });

    it('Stops the whole chapter without a service tab', async () => {
        fetchViaTab.mockResolvedValue({ ok: false, status: 0, noTab: true });
        await expect(service().processChapterContent([], null, { chapterMeta: { pages: pages(3) } }))
            .rejects.toBeInstanceOf(NoServiceTabError);
    });

    it('Keeps loaded pages only within a chapter', async () => {
        const svc = service();
        const meta = { pages: ['/same.jpg'] };
        await svc.processChapterContent([], null, { chapterMeta: meta });
        await svc.processChapterContent([], null, { chapterMeta: meta });
        expect(fetchViaTab).toHaveBeenCalledTimes(2);
        expect(svc._imageCache).toBeUndefined();
    });

    it('Defers slow pages through the context of the download and reports progress', async () => {
        const onPageProgress = vi.fn();
        const ctx = new DownloadContext({ onPageProgress });
        const defer = vi.spyOn(ctx, 'loadImageOrDefer');
        const svc = service().attach(ctx);
        await svc.processChapterContent([], null, { chapterMeta: { pages: pages(2) } });
        expect(defer.mock.calls.map(([label]) => label)).toEqual([1, 2]);
        expect(onPageProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
    });

    it('Still updates a status element passed by old callers', async () => {
        const status = { textContent: '' };
        await service().processChapterContent([], status, { chapterMeta: { pages: pages(2) } });
        expect(status.textContent).toBe('Загружено страниц: 2/2');
    });
});
