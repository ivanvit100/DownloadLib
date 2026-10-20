import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({}));

vi.mock('../../../core/BrowserApi.js', async () =>
    (await import('../../helpers/ModuleMock.js')).mockExports(mocks, 'extensionApi'));
vi.mock('../../../core/TabNetwork.js', async () =>
    (await import('../../helpers/ModuleMock.js')).mockExports(mocks, 'requestViaTab', 'fetchViaTab', 'NoServiceTabError'));
vi.mock('../../../core/ImageCompressor.js', async () =>
    (await import('../../helpers/ModuleMock.js')).mockExports(mocks, 'ImageCompressor', 'PAGE_ASPECT'));
vi.mock('../../../services/mangalib/config.js', async () =>
    (await import('../../helpers/ModuleMock.js')).mockExports(mocks, 'mangalibConfig'));

import { ImageCompressor } from '../../../core/ImageCompressor.js';
import { fetchViaTab, requestViaTab } from '../../../core/TabNetwork.js';

let MangaLibService, CdnLibsService;

const reply = (status, text = '') => ({ ok: status >= 200 && status < 300, status, text, retryAfter: null, noTab: false });

beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    mocks.extensionApi = {};
    mocks.NoServiceTabError = class NoServiceTabError extends Error {};
    mocks.PAGE_ASPECT = 297 / 210;
    mocks.ImageCompressor = { process: vi.fn(async (base64, contentType) => [{ base64, contentType }]) };
    mocks.fetchViaTab = vi.fn(async () => ({ ok: true, status: 200, noTab: false, base64: 'IMG', contentType: 'image/jpeg' }));
    mocks.requestViaTab = vi.fn(async () => reply(200, '{"data":{}}'));
    mocks.mangalibConfig = {
        name: 'mangalib',
        baseUrl: 'https://api.test',
        headers: { 'Site-Id': '1' },
        fields: ['id', 'title'],
        imagesDomain: 'https://img.test',
        splitLongImages: true,
        maxImageHeight: 1800,
        hosts: ['mangalib.me', 'mangalib.org'],
        imageHosts: ['img.test']
    };
    ({ MangaLibService } = await import('../../../services/mangalib/MangaLibService.js'));
    ({ CdnLibsService } = await import('../../../services/CdnLibsService.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
    ['extensionApi', 'NoServiceTabError', 'PAGE_ASPECT', 'ImageCompressor', 'fetchViaTab', 'requestViaTab', 'mangalibConfig']
        .forEach(name => delete mocks[name]);
});

describe('MangaLibService', () => {
    it('Is a CdnLibsService with the MangaLib config', () => {
        const svc = new MangaLibService();
        expect(svc).toBeInstanceOf(CdnLibsService);
        expect(svc.name).toBe('mangalib');
        expect(svc.baseUrl).toBe('https://api.test');
        expect(svc.config).toEqual(mocks.mangalibConfig);
        expect(console.debug).toHaveBeenCalledWith('[MangaLibService] Instance created');
    });

    it('Gives every instance its own headers', () => {
        const first = new MangaLibService();
        first.setAuthToken('t');
        expect(new MangaLibService().config.headers).toEqual({ 'Site-Id': '1' });
        expect(mocks.mangalibConfig.headers).toEqual({ 'Site-Id': '1' });
    });

    it('Matches the site hosts from the config, including subdomains', () => {
        expect(MangaLibService.matches('https://mangalib.me/book')).toBe(true);
        expect(MangaLibService.matches('https://mangalib.org/ru/manga/x')).toBe(true);
        expect(MangaLibService.matches('https://test-front.mangalib.me/')).toBe(true);
    });

    it('Does not match image hosts, lookalike hosts and invalid URLs', () => {
        expect(MangaLibService.matches('https://img.test/')).toBe(false);
        expect(MangaLibService.matches('https://notmangalib.me/')).toBe(false);
        expect(MangaLibService.matches('https://example.com')).toBe(false);
        expect(MangaLibService.matches('not a url')).toBe(false);
    });

    it('Requests metadata with the fields of the config', async () => {
        requestViaTab.mockResolvedValue(reply(200, '{"data":{"id":1}}'));
        await expect(new MangaLibService().fetchMangaMetadata('slug')).resolves.toEqual({ data: { id: 1 } });
        expect(requestViaTab.mock.calls[0][0]).toBe('https://api.test/api/manga/slug?fields[]=id&fields[]=title');
        expect(requestViaTab.mock.calls[0][1].headers).toEqual({ 'Site-Id': '1' });
    });

    it('Always requests chapters from the compressed image server', async () => {
        const svc = new MangaLibService();
        await svc.fetchChapter('slug', 2, 3, 7);
        await svc.fetchChapter('slug', 1);
        expect(requestViaTab.mock.calls.map(([url]) => url)).toEqual([
            'https://api.test/api/manga/slug/chapter?number=2&volume=3&branch_id=7&server=compress',
            'https://api.test/api/manga/slug/chapter?number=1&volume=1&server=compress'
        ]);
    });

    it('getChapter uses the compressed server too', async () => {
        requestViaTab.mockResolvedValue(reply(200, '{"data":{"pages":[]}}'));
        await expect(new MangaLibService().getChapter('slug', 1, 1, null)).resolves.toEqual({ pages: [] });
        expect(requestViaTab.mock.calls[0][0]).toContain('server=compress');
    });

    it('Reports API errors clearly', async () => {
        requestViaTab.mockResolvedValue(reply(400, 'bad'));
        await expect(new MangaLibService().fetchChaptersList('slug')).rejects.toThrow('Ошибка API (список глав): HTTP 400');
    });

    it('Loads chapter pages from the images domain and splits long pages', async () => {
        const svc = new MangaLibService();
        const blocks = await svc.processChapterContent([], null, {
            chapterMeta: { pages: [{ url: '//manga/x/1.jpg' }] }, splitLongImages: true
        });
        expect(fetchViaTab.mock.calls[0][0]).toBe('https://img.test/manga/x/1.jpg');
        expect(ImageCompressor.process.mock.calls[0][2]).toMatchObject({ splitAspect: 297 / 210, maxPartHeight: 1800 });
        expect(blocks).toMatchObject([{ type: 'image', data: { base64: 'IMG' } }]);
    });
});
