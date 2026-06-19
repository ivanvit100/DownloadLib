import { describe, it, expect, beforeEach, vi } from 'vitest';

let DownloadManager, globalMock, eventBusMock, exporterMock, serviceMock, fileUtilsMock;

function createChapter(vol, num, name = undefined) {
    return { volume: vol, number: num, name };
}

beforeEach(async () => {
    globalMock = {};
    eventBusMock = { emit: vi.fn() };
    exporterMock = {
        export: vi.fn(async () => ({ blob: {}, filename: 'file.fb2' })),
        parse: vi.fn(async () => ({ chapters: [], metadata: {}, cover: 'c' })),
        parseFB2: vi.fn((text, name) => ({ chapters: [], metadata: {}, cover: 'c' })),
        parseEPUB: vi.fn(async file => ({ chapters: [], metadata: {}, cover: 'c' }))
    };
    serviceMock = {
        name: 'mangalib',
        fetchMangaMetadata: vi.fn(async slug => ({ data: { cover: { default: 'url' } } })),
        fetchChaptersList: vi.fn(async slug => ({ data: [createChapter('1', '1'), createChapter('1', '2')] })),
        fetchChapter: vi.fn(async (slug, number, volume) => ({ data: { content: [{ type: 'text', text: 'ok' }] } })),
        extractText: vi.fn(content => content),
        processChapterContent: vi.fn(async (content) => content)
    };
    fileUtilsMock = { downloadBlob: vi.fn(async () => {}) };

    globalMock.EventBus = vi.fn(function() { return eventBusMock; });
    globalMock.ExporterRegistry = { create: vi.fn(() => exporterMock) };
    globalMock.MangaPatcher = { patch: vi.fn((c) => c) };
    globalMock.serviceRegistry = {
        getServiceByUrl: vi.fn(() => serviceMock),
        createService: vi.fn(key => key === 'ranobelib' ? { ...serviceMock, name: 'ranobelib' } : serviceMock)
    };
    globalMock.FileUtils = fileUtilsMock;

    globalThis.EventBus = globalMock.EventBus;
    globalThis.ExporterRegistry = globalMock.ExporterRegistry;
    globalThis.MangaPatcher = globalMock.MangaPatcher;
    globalThis.serviceRegistry = globalMock.serviceRegistry;
    globalThis.FileUtils = globalMock.FileUtils;

    globalThis.document = {
        createElement: vi.fn(() => ({ href: '', download: '', click: vi.fn(), remove: vi.fn() })),
        body: { appendChild: vi.fn() },
        getElementById: vi.fn(() => ({ innerHTML: '', textContent: '', classList: { remove: vi.fn() } }))
    };
    if (typeof globalThis.URL === 'undefined') {
        globalThis.URL = class {};
    }
    globalThis.URL.createObjectURL = vi.fn(() => 'bloburl');
    globalThis.URL.revokeObjectURL = vi.fn();
    globalThis.FileReader = vi.fn(function() {
        this.readAsDataURL = function () { setTimeout(() => this.onloadend && this.onloadend(), 0); };
        this.readAsText = function () { setTimeout(() => this.onload && this.onload({ target: { result: 'txt' } }), 0); };
    });

    await import('../../core/DownloadManager.js');
    DownloadManager = globalThis.DownloadManager;
});

describe('DownloadManager', () => {
    it('Constructor', () => {
        const dm = new DownloadManager();
        expect(dm.activeDownloads).toBeInstanceOf(Map);
        expect(dm.eventBus).toBe(eventBusMock);
    });

    it('Generate Id', () => {
        const dm = new DownloadManager();
        const id1 = dm.generateId();
        const id2 = dm.generateId();
        expect(id1).not.toBe(id2);
        expect(id1).toMatch(/^download_/);
    });

    it('Chapters sorting', () => {
        const dm = new DownloadManager();
        const arr = [createChapter('2', '1'), createChapter('1', '2'), createChapter('1', '1')];
        const sorted = dm.sortChapters(arr);
        expect(sorted[0].volume).toBe('1');
        expect(sorted[0].number).toBe('1');
        expect(sorted[2].volume).toBe('2');
    });

    it('Extract slug', () => {
        const dm = new DownloadManager();
        expect(dm.extractSlug('https://site/manga/abc-def')).toBe('abc-def');
        expect(dm.extractSlug('https://site/book/xyz')).toBe('xyz');
        expect(dm.extractSlug('https://site/other/123')).toBeNull();
    });

    it('Create controller', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        expect(ctrl.isPaused()).toBe(false);
        ctrl.pause();
        expect(ctrl.isPaused()).toBe(true);
        ctrl.resume();
        expect(ctrl.isPaused()).toBe(false);
        expect(ctrl.shouldStop()).toBe(false);
        ctrl.stop();
        expect(ctrl.shouldStop()).toBe(true);
        let paused = false;
        ctrl.pause();
        setTimeout(() => ctrl.resume(), 100);
        const p = ctrl.waitIfPaused().then(() => { paused = true; });
        await new Promise(r => setTimeout(r, 150));
        expect(paused).toBe(true);
    });

    it('Update status', () => {
        const dm = new DownloadManager();
        const id = dm.generateId();
        dm.activeDownloads.set(id, { id, status: '', progress: 0 });
        dm.updateStatus(id, 'msg', 42);
        expect(dm.activeDownloads.get(id).status).toBe('msg');
        expect(dm.activeDownloads.get(id).progress).toBe(42);
        expect(eventBusMock.emit).toHaveBeenCalledWith('download:progress', expect.any(Object));
    });

    it('Get download state', () => {
        const dm = new DownloadManager();
        const id = dm.generateId();
        dm.activeDownloads.set(id, {
            id, slug: 'slug', serviceKey: 'key', format: 'fb2', manga: {}, coverBase64: 'c',
            chapterContents: [], chapters: [], currentChapterIndex: 0, status: 'ok', progress: 100, loadedFile: null
        });
        const state = dm.getDownloadState(id);
        expect(state.slug).toBe('slug');
        expect(state.format).toBe('fb2');
        expect(state.currentStatus).toBe('ok');
        expect(state.currentProgress).toBe(100);
    });

    it('Get status', () => {
        const dm = new DownloadManager();
        const id = dm.generateId();
        dm.activeDownloads.set(id, { id, foo: 1 });
        expect(dm.getStatus(id)).toEqual({ id, foo: 1 });
        expect(dm.getStatus('notfound')).toBeNull();
    });

    it('Pause/Resume/Stop', () => {
        const dm = new DownloadManager();
        const id = dm.generateId();
        const ctrl = dm.createController();
        dm.activeDownloads.set(id, { id, controller: ctrl });
        dm.pause(id);
        expect(ctrl.isPaused()).toBe(true);
        expect(eventBusMock.emit).toHaveBeenCalledWith('download:paused', expect.any(Object));
        dm.resume(id);
        expect(ctrl.isPaused()).toBe(false);
        expect(eventBusMock.emit).toHaveBeenCalledWith('download:resumed', expect.any(Object));
        dm.stop(id);
        expect(ctrl.shouldStop()).toBe(true);
        expect(eventBusMock.emit).toHaveBeenCalledWith('download:stopped', expect.any(Object));
    });

    it('Get chapter key', () => {
        const dm = new DownloadManager();
        expect(dm.getChapterKey({ volume: '2', number: '3' })).toBe('v2_ch3');
        expect(dm.getChapterKey({})).toBe('v1_ch0');
    });

    it('Check if chapter is empty', () => {
        const dm = new DownloadManager();
        expect(dm.isChapterEmpty({})).toBe(true);
        expect(dm.isChapterEmpty({ content: [{ type: 'text', text: ' ' }] })).toBe(true);
        expect(dm.isChapterEmpty({ content: [{ type: 'text', text: 'ok' }] })).toBe(false);
        expect(dm.isChapterEmpty({ content: [{ type: 'text', text: '[Ошибка загрузки главы: ...]' }] })).toBe(true);
        expect(dm.isChapterEmpty({ content: [{ type: 'image', data: { base64: 'x' } }] })).toBe(false);
        expect(dm.isChapterEmpty({ content: [{ type: 'image', data: { src: 'x' } }] })).toBe(false);
    });

    it('Find missing chapters', () => {
        const dm = new DownloadManager();
        const server = [createChapter('1', '1'), createChapter('1', '2')];
        const exist = [
            Object.assign(createChapter('1', '1'), { content: [{ type: 'text', text: 'ok' }] })
        ];
        expect(dm.findMissingChapters(server, exist).length).toBe(1);
        const exist2 = [createChapter('1', '1', undefined)];
        exist2[0].content = [{ type: 'text', text: '[Ошибка загрузки главы: ...]' }];
        expect(dm.findMissingChapters(server, exist2).length).toBe(2);
    });

    it('Merge chapters', () => {
        const dm = new DownloadManager();
        const existing = [createChapter('1', '1')];
        existing[0].content = [{ type: 'text', text: 'ok' }];
        const newCh = [createChapter('1', '2')];
        newCh[0].content = [{ type: 'text', text: 'ok' }];
        const server = [createChapter('1', '1'), createChapter('1', '2'), createChapter('1', '3')];
        const merged = dm.mergeChapters(existing, newCh, server);
        expect(merged.length).toBe(3);
        expect(merged[2].content[0].text).toBe('[Глава не загружена]');
    });

    it('Delay function', async () => {
        const dm = new DownloadManager();
        await expect(dm.delay(10)).resolves.toBeUndefined();
    });

    it('Save file with FileUtils', async () => {
        const dm = new DownloadManager();
        await dm.saveFile({}, 'f.fb2');
        expect(fileUtilsMock.downloadBlob).toHaveBeenCalled();
    });

    it('Save file fallback', async () => {
        delete globalThis.FileUtils;
        const dm = new DownloadManager();
        await dm.saveFile({}, 'f.fb2');
        expect(globalThis.document.createElement).toHaveBeenCalled();
        expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    });

    it('Parse file as fb2', async () => {
        const dm = new DownloadManager();
        const file = { name: 'f.fb2' };
        const res = await dm.parseFile(file, 'fb2');
        expect(res).toHaveProperty('chapters');
    });

    it('Parse file as epub', async () => {
        const dm = new DownloadManager();
        const file = { name: 'f.epub' };
        const res = await dm.parseFile(file, 'epub');
        expect(res).toHaveProperty('chapters');
    });

    it('Parse file as pdf', async () => {
        const dm = new DownloadManager();
        await expect(dm.parseFile({}, 'pdf')).rejects.toThrow();
    });

    it('Parse file with unknown type', async () => {
        const dm = new DownloadManager();
        await expect(dm.parseFile({}, 'unknown')).rejects.toThrow();
    });

    it('Read file as text', async () => {
        const dm = new DownloadManager();
        const file = {};
        const res = await dm.readFileAsText(file);
        expect(res).toBe('txt');
    });

    it('Download specific chapters', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl };
        const chapters = [createChapter('1', '1')];
        const res = await dm.downloadSpecificChapters(serviceMock, ds, chapters, 1);
        expect(res.length).toBe(1);
        expect(res[0].content[0].text).toBe('ok');
    });

    it('Error during download specific chapters', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl };
        const badService = { ...serviceMock, fetchChapter: vi.fn(async () => { throw new Error('fail'); }) };
        const chapters = [createChapter('1', '1')];
        const res = await dm.downloadSpecificChapters(badService, ds, chapters, 1);
        expect(res[0].content[0].text).toMatch(/Ошибка загрузки главы/);
    });

    it('Download chapters', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [] };
        const chapters = [createChapter('1', '1')];
        const res = await dm.downloadChapters(serviceMock, ds, chapters, () => {});
        expect(res.length).toBe(1);
        expect(res[0].content[0].text).toBe('ok');
        expect(ds.chapterContents.length).toBe(1);
    });

    it('Error during download chapters', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [] };
        const badService = { ...serviceMock, fetchChapter: vi.fn(async () => { throw new Error('fail'); }) };
        const chapters = [createChapter('1', '1')];
        const res = await dm.downloadChapters(badService, ds, chapters, () => {});
        expect(res[0].content[0].text).toMatch(/Ошибка загрузки главы/);
        expect(ds.chapterContents.length).toBe(1);
    });

    it('Start download with serviceKey', async () => {
        const dm = new DownloadManager();
        const options = { serviceKey: 'mangalib', url: 'https://site/manga/slug' };
        const res = await dm.startDownload(options);
        expect(res.success).toBe(true);
    });

    it('Start download with url', async () => {
        const dm = new DownloadManager();
        const options = { url: 'https://site/manga/slug' };
        const res = await dm.startDownload(options);
        expect(res.success).toBe(true);
    });

    it('Start download with loadedFile', async () => {
        const dm = new DownloadManager();
        const options = { serviceKey: 'mangalib', url: 'https://site/manga/slug', loadedFile: {} };
        const res = await dm.startDownload(options);
        expect(res.success).toBe(true);
    });

    it('Start download with unknown service', async () => {
        const dm = new DownloadManager();
        await expect(dm.startDownload({ serviceKey: 'unknown' })).rejects.toThrow();
    });

    it('Start download no service', async () => {
        const dm = new DownloadManager();
        await expect(dm.startDownload({})).rejects.toThrow();
    });

    it('Start download service returns null', async () => {
        globalThis.serviceRegistry.getServiceByUrl = vi.fn(() => null);
        const dm = new DownloadManager();
        await expect(dm.startDownload({ url: 'https://site/manga/slug' })).rejects.toThrow();
    });

    it('Start download with authToken applies Authorization header to service', async () => {
        serviceMock.config = { headers: {} };
        const dm = new DownloadManager();
        const res = await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug', authToken: 'mytoken' });
        expect(serviceMock.config.headers['Authorization']).toBe('Bearer mytoken');
        expect(res.success).toBe(true);
    });

    it('Update existing file error', async () => {
        const dm = new DownloadManager();
        const ds = { id: 'id', slug: 'slug', format: 'fb2', controller: dm.createController() };
        const service = { ...serviceMock, fetchChaptersList: vi.fn(async () => { throw new Error('fail'); }) };
        const loadedFile = {};
        await expect(dm.updateExistingFile(ds, service, loadedFile)).rejects.toThrow();
    });

    it('Calls RanobeLib service via serviceRegistry.createService', async () => {
        const ranobeMock = { name: 'ranobelib', fetchMangaMetadata: vi.fn(async () => ({ data: {} })), fetchChaptersList: vi.fn(async () => ({ data: [] })), fetchChapter: vi.fn(async () => ({ data: { content: [] } })), extractText: vi.fn(), processChapterContent: vi.fn() };
        const createServiceSpy = vi.fn(key => key === 'ranobelib' ? ranobeMock : null);
        globalThis.serviceRegistry = { getServiceByUrl: vi.fn(() => null), createService: createServiceSpy };

        await import('../../core/DownloadManager.js');
        const DownloadManager = globalThis.DownloadManager;
        const dm = new DownloadManager();
        await dm.startDownload({ serviceKey: 'ranobelib', url: 'https://site/book/slug' });

        expect(createServiceSpy).toHaveBeenCalledWith('ranobelib');
    });

    it('Not detect data in metadata', async () => {
        const serviceWithoutData = {
            name: 'mangalib',
            fetchMangaMetadata: vi.fn(async slug => ({ cover: { default: 'url' } })),
            fetchChaptersList: vi.fn(async slug => ({ data: [] })),
            fetchChapter: vi.fn(async (slug, number, volume) => ({ data: { content: [{ type: 'text', text: 'ok' }] } })),
            extractText: vi.fn(content => content),
            processChapterContent: vi.fn(async (content) => content)
        };

        globalThis.serviceRegistry = { getServiceByUrl: vi.fn(() => serviceWithoutData), createService: vi.fn(() => serviceWithoutData) };

        await import('../../core/DownloadManager.js');
        const DownloadManager = globalThis.DownloadManager;
        const dm = new DownloadManager();

        const res = await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug' });
        const downloadId = res.downloadId;
        const state = dm.getDownloadState(downloadId);
        expect(state.manga).toEqual({ cover: { default: 'url' } });
    });

    it('Cover url selection logic', async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            blob: async () => ({}),
        }));
        globalThis.FileReader = vi.fn(function() {
            this.readAsDataURL = function () { this.result = 'data:img'; this.onloadend && this.onloadend(); };
        });

        serviceMock.fetchMangaMetadata = vi.fn(async () => ({ data: { cover: 'url_default' } }));
        await import('../../core/DownloadManager.js');
        const DownloadManager = globalThis.DownloadManager;
        const dm = new DownloadManager();
        const res = await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug' });
        const state = dm.getDownloadState(res.downloadId);
        expect(globalThis.fetch).toHaveBeenCalledWith('url_default', expect.any(Object));
        expect(state.coverBase64).toBe('data:img');
    });

    it('Sets Referer to ranobelib.me for ranobelib service', async () => {
        globalThis.fetch = vi.fn(async (url, opts) => ({
            ok: true,
            blob: async () => ({}),
        }));
        globalThis.FileReader = vi.fn(function() {
            this.readAsDataURL = function () { this.result = 'data:img'; this.onloadend && this.onloadend(); };
        });

        const ranobeMock = {
            name: 'ranobelib',
            config: { imageHeaders: { 'Referer': 'https://ranobelib.me/', 'Accept': 'image/*' } },
            fetchMangaMetadata: vi.fn(async () => ({ data: { cover: 'ranobe-cover' } })),
            fetchChaptersList: vi.fn(async () => ({ data: [] })),
            fetchChapter: vi.fn(async () => ({ data: { content: [] } })),
            extractText: vi.fn(),
            processChapterContent: vi.fn()
        };
        globalThis.serviceRegistry = {
            getServiceByUrl: vi.fn(() => ranobeMock),
            createService: vi.fn(() => ranobeMock)
        };

        await import('../../core/DownloadManager.js');
        const DownloadManager = globalThis.DownloadManager;
        const dm = new DownloadManager();
        await dm.startDownload({ serviceKey: 'ranobelib', url: 'https://ranobelib.me/book/slug' });

        expect(globalThis.fetch).toHaveBeenCalledWith(
            'ranobe-cover',
            expect.objectContaining({
                headers: expect.objectContaining({
                    Referer: 'https://ranobelib.me/'
                })
            })
        );
    });

    it('Сover fetch and unknown cover format errorы', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl };
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        serviceMock.fetchMangaMetadata = vi.fn(async () => ({ data: { cover: 'bad-url' } }));
        globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, blob: async () => ({}) }));
        globalThis.FileReader = vi.fn(function() {
            this.readAsDataURL = function () { this.result = 'data:img'; this.onloadend && this.onloadend(); };
        });
        await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug' });
        expect(errorSpy).toHaveBeenCalledWith('[DownloadManager] Failed to fetch cover image:', 404);

        errorSpy.mockRestore();
    });

    it('Catches and handles error in startDownload', async () => {
        const dm = new DownloadManager();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const eventSpy = vi.spyOn(eventBusMock, 'emit');
        serviceMock.fetchMangaMetadata = vi.fn(async () => { throw new Error('meta fail'); });

        await expect(dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug' })).rejects.toThrow('meta fail');

        expect(errorSpy).toHaveBeenCalledWith('[DownloadManager] Error:', expect.any(Error));
        expect(eventSpy).toHaveBeenCalledWith('download:failed', expect.objectContaining({
            error: expect.any(Error)
        }));
    });

    it('Get chapters data without data property', async () => {
        serviceMock.fetchChaptersList = vi.fn(async () => ({}));
        const dm = new DownloadManager();
        const res = await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug' });
        const state = dm.getDownloadState(res.downloadId);
        expect(state.chapters).toEqual([]);
    });

    it('Get chapter data without data property in updateExistingFile', async () => {
        const dm = new DownloadManager();
        const ds = { id: 'id', slug: 'slug', format: 'fb2', controller: dm.createController() };
        const loadedFile = {};
        serviceMock.fetchChaptersList = vi.fn(async () => ({}));
        exporterMock.parse = vi.fn(async () => ({ chapters: [], metadata: {}, cover: 'c' }));
        const res = await dm.updateExistingFile(ds, serviceMock, loadedFile);
        expect(res.updated).toBe(false);
    });

    it('Parse file while update existing file when exporter.parse is undefined', async () => {
        const dm = new DownloadManager();
        const ds = { id: 'id', slug: 'slug', format: 'fb2', controller: dm.createController() };
        const loadedFile = {};
        const exporter = {
            parse: undefined,
            parseFB2: vi.fn(() => ({ chapters: [], metadata: {}, cover: 'c' })),
            export: vi.fn(async () => ({ blob: {}, filename: 'file.fb2' }))
        };
        globalMock.ExporterRegistry.create = vi.fn(() => exporter);
        const parseFileSpy = vi.spyOn(dm, 'parseFile').mockResolvedValue({ chapters: [], metadata: {}, cover: 'c' });
        await dm.updateExistingFile(ds, serviceMock, loadedFile);
        expect(parseFileSpy).toHaveBeenCalledWith(loadedFile, 'fb2');
    });

    it('Text block without text property in check is chapter empty', () => {
        const dm = new DownloadManager();
        const chapter = { content: [{ type: 'text' }] };
        expect(dm.isChapterEmpty(chapter)).toBe(true);
    });

    it('Returns false for chapter with text block with content and unknown block type', () => {
        const dm = new DownloadManager();
        const chapter = { content: [{ type: 'audio' }, { type: 'text', text: 'ok' }] };
        expect(dm.isChapterEmpty(chapter)).toBe(false);
    });

    it('Breaks when controller.shouldStop()', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        ctrl.shouldStop = () => true;
        const ds = { id: 'id', slug: 'slug', controller: ctrl };
        const chapters = [createChapter('1', '1'), createChapter('1', '2')];
        const res = await dm.downloadSpecificChapters(serviceMock, ds, chapters, 2);
        expect(res.length).toBe(0);
    });

    it('Uses default volume "1" when volume is undefined', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl };
        const chapters = [{ number: '5' }];
        const fetchChapterSpy = vi.spyOn(serviceMock, 'fetchChapter');
        await dm.downloadSpecificChapters(serviceMock, ds, chapters, 1);
        expect(fetchChapterSpy).toHaveBeenCalledWith('slug', '5', '1');
    });

    it('Uses chapterData directly when chapterData.data is undefined', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl };
        const chapters = [{ number: '1', volume: '2' }];
        serviceMock.fetchChapter = vi.fn(async () => ({ content: [{ type: 'text', text: 'direct' }] }));
        const res = await dm.downloadSpecificChapters(serviceMock, ds, chapters, 1);
        expect(res[0].content[0].text).toBe('direct');
    });

    it('Uses rawContent directly when rawContent.content is undefined', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl };
        const chapters = [{ number: '1', volume: '2' }];
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { notContent: 'value' } }));
        const res = await dm.downloadSpecificChapters(serviceMock, ds, chapters, 1);
        expect(res[0].content.notContent).toBe('value');
    });

    it('Uses contentToExtract directly when service.extractText is undefined', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl };
        const chapters = [{ number: '1', volume: '2' }];
        serviceMock.extractText = undefined;
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'plain' }] } }));
        const res = await dm.downloadSpecificChapters(serviceMock, ds, chapters, 1);
        expect(res[0].content[0].text).toBe('plain');
    });

    it('Uses extractedContent directly when service.processChapterContent is undefined', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl };
        const chapters = [{ number: '1', volume: '2' }];
        serviceMock.processChapterContent = undefined;
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'plain' }] } }));
        const res = await dm.downloadSpecificChapters(serviceMock, ds, chapters, 1);
        expect(res[0].content[0].text).toBe('plain');
    });

    it('Returns null for unknown id', () => {
        const dm = new DownloadManager();
        expect(dm.getDownloadState('nonexistent_id')).toBeNull();
    });

    it('Breaks when controller.shouldStop() returns true', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        ctrl.shouldStop = () => true;
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [] };
        const chapters = [createChapter('1', '1'), createChapter('1', '2')];
        const res = await dm.downloadChapters(serviceMock, ds, chapters, () => {});
        expect(res.length).toBe(0);
    });

    it('Uses default volume "1" when chapter.volume is undefined in downloadChapters', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [] };
        const chapters = [{ number: '5' }];
        const fetchChapterSpy = vi.spyOn(serviceMock, 'fetchChapter');
        await dm.downloadChapters(serviceMock, ds, chapters, () => {});
        expect(fetchChapterSpy).toHaveBeenCalledWith('slug', '5', '1');
    });

    it('Uses chapterData directly when chapterData.data is undefined in downloadChapters', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [] };
        const chapters = [{ number: '1', volume: '2' }];
        serviceMock.fetchChapter = vi.fn(async () => ({ content: [{ type: 'text', text: 'direct' }] }));
        const res = await dm.downloadChapters(serviceMock, ds, chapters, () => {});
        expect(res[0].content[0].text).toBe('direct');
    });

    it('Uses rawContent directly when rawContent.content is undefined in downloadChapters', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [] };
        const chapters = [{ number: '1', volume: '2' }];
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { notContent: 'value' } }));
        const res = await dm.downloadChapters(serviceMock, ds, chapters, () => {});
        expect(res[0].content.notContent).toBe('value');
    });

    it('Uses contentToExtract directly when service.extractText is undefined in downloadChapters', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [] };
        const chapters = [{ number: '1', volume: '2' }];
        serviceMock.extractText = undefined;
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'plain' }] } }));
        const res = await dm.downloadChapters(serviceMock, ds, chapters, () => {});
        expect(res[0].content[0].text).toBe('plain');
    });

    it('Uses extractedContent directly when service.processChapterContent is undefined in downloadChapters', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [] };
        const chapters = [{ number: '1', volume: '2' }];
        serviceMock.processChapterContent = undefined;
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'plain' }] } }));
        const res = await dm.downloadChapters(serviceMock, ds, chapters, () => {});
        expect(res[0].content[0].text).toBe('plain');
    });

    it('waitIfPaused uses await new Promise for pause', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        ctrl.pause();
        let resumed = false;
        setTimeout(() => {
            ctrl.resume();
            resumed = true;
        }, 150);
        const p = ctrl.waitIfPaused();
        await new Promise(r => setTimeout(r, 200));
        await p;
        expect(resumed).toBe(true);
    });

    it('sortChapters uses 0 for missing volume and number', () => {
        const dm = new DownloadManager();
        const chapters = [
            { volume: undefined, number: undefined },
            { volume: '2', number: undefined },
            { volume: undefined, number: '3' },
            { volume: '1', number: '2' }
        ];
        const sorted = dm.sortChapters(chapters);
        expect(sorted[0]).toEqual({ volume: undefined, number: undefined });
        expect(sorted[1]).toEqual({ volume: undefined, number: '3' });
        expect(sorted[2]).toEqual({ volume: '1', number: '2' });
        expect(sorted[3]).toEqual({ volume: '2', number: undefined });
    });

    it('sortChapters uses 0 for NaN volume and number', () => {
        const dm = new DownloadManager();
        const chapters = [
            { volume: 'NaN', number: 'NaN' },
            { volume: '1', number: '2' }
        ];
        const sorted = dm.sortChapters(chapters);
        expect(sorted[0]).toEqual({ volume: 'NaN', number: 'NaN' });
        expect(sorted[1]).toEqual({ volume: '1', number: '2' });
    });

    it('sortChapters uses 0 for empty string volume and number', () => {
        const dm = new DownloadManager();
        const chapters = [
            { volume: '', number: '' },
            { volume: '1', number: '2' }
        ];
        const sorted = dm.sortChapters(chapters);
        expect(sorted[0]).toEqual({ volume: '', number: '' });
        expect(sorted[1]).toEqual({ volume: '1', number: '2' });
    });

    it('sortChapters uses 0 when number is NaN', () => {
        const dm = new DownloadManager();
        const chapters = [
            { volume: '1', number: 'NaN' },
            { volume: '1', number: undefined },
            { volume: '1', number: '2' }
        ];
        const sorted = dm.sortChapters(chapters);
        expect(sorted[0].number).toBe('NaN');
        expect(sorted[1].number).toBe(undefined);
        expect(sorted[2].number).toBe('2');
    });

    it('Pause logs when downloadId not found', () => {
        const dm = new DownloadManager();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        dm.pause('not_found_id');
        expect(logSpy).toHaveBeenCalledWith('[DownloadManager] No active download with ID: not_found_id');
        logSpy.mockRestore();
    });

    it('Resume logs when downloadId not found', () => {
        const dm = new DownloadManager();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        dm.resume('not_found_id');
        expect(logSpy).toHaveBeenCalledWith('[DownloadManager] No active download with ID: not_found_id');
        logSpy.mockRestore();
    });

    it('Stop logs when downloadId not found', () => {
        const dm = new DownloadManager();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        dm.stop('not_found_id');
        expect(logSpy).toHaveBeenCalledWith('[DownloadManager] No active download with ID: not_found_id');
        logSpy.mockRestore();
    });

    it('Splits into multiple parts when content exceeds size limit', async () => {
        const dm = new DownloadManager();
        const chapters = [];
        for (let i = 1; i <= 5; i++) chapters.push({ volume: '1', number: String(i) });
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: chapters }));
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } }));
        const estimateSpy = vi.spyOn(dm, 'estimateChapterSize').mockReturnValue(80 * 1024 * 1024);
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        const delaySpy = vi.spyOn(dm, 'delay').mockResolvedValue();
        await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug', maxSizeMB: 100 });
        expect(saveFileSpy).toHaveBeenCalledTimes(5);
        estimateSpy.mockRestore();
        saveFileSpy.mockRestore();
        delaySpy.mockRestore();
    }, 30000);

    it('Breaks loop early when controller should stop', async () => {
        const dm = new DownloadManager();
        const chapters = [];
        for (let i = 1; i <= 181; i++) chapters.push({ volume: '1', number: String(i) });
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: chapters }));
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } }));
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        const delaySpy = vi.spyOn(dm, 'delay').mockResolvedValue();
        const ctrl = dm.createController();
        let stopCalled = false;
        ctrl.shouldStop = () => {
            stopCalled = true;
            return true;
        };
        await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug', controller: ctrl });
        expect(stopCalled).toBe(true);
        expect(saveFileSpy).toHaveBeenCalledTimes(0);
        saveFileSpy.mockRestore();
        delaySpy.mockRestore();
    });

    it('Filters chapters by chapterRange and downloads only the specified range', async () => {
        const dm = new DownloadManager();
        const chapters = [
            { volume: '1', number: '1' },
            { volume: '1', number: '2' },
            { volume: '1', number: '3' },
            { volume: '1', number: '4' }
        ];
        const service = {
            name: 'mangalib',
            fetchMangaMetadata: vi.fn(async () => ({ data: { cover: { default: 'url' } } })),
            fetchChaptersList: vi.fn(async () => ({ data: chapters })),
            fetchChapter: vi.fn(async (slug, number, volume) => ({ data: { content: [{ type: 'text', text: `chapter${number}` }] } })),
            extractText: vi.fn(content => content),
            processChapterContent: vi.fn(async (content) => content)
        };
        globalThis.serviceRegistry = { getServiceByUrl: vi.fn(() => service), createService: vi.fn(() => service) };
        const exporter = {
            export: vi.fn(async (manga, chapterContents, coverBase64) => ({ blob: {}, filename: 'file.fb2' }))
        };
        globalThis.ExporterRegistry = { create: vi.fn(() => exporter) };
        globalThis.FileUtils = { downloadBlob: vi.fn(async () => {}) };

        const delaySpy = vi.spyOn(dm, 'delay').mockResolvedValue();
        const options = {
            serviceKey: 'mangalib',
            url: 'https://site/manga/slug',
            chapterRange: { from: 1, to: 2 }
        };
        await dm.startDownload(options);
        expect(service.fetchChaptersList).toHaveBeenCalled();
        const calledNumbers = service.fetchChapter.mock.calls.map(c => c[1]);
        expect(calledNumbers).toEqual(['2', '3']);
        delaySpy.mockRestore();
    });

    it('Empty part suffix when total parts equals one', async () => {
        const dm = new DownloadManager();
        const chapters = [];
        for (let i = 1; i <= 81; i++) chapters.push({ volume: '1', number: String(i) });
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: chapters }));
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } }));
        const originalCeil = Math.ceil;
        vi.spyOn(Math, 'ceil').mockImplementation((...args) => {
            if (args[0] === 81 / 80) return 1;
            return originalCeil(...args);
        });
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        const delaySpy = vi.spyOn(dm, 'delay').mockResolvedValue();
        const manga = { rus_name: 'TestManga', cover: { default: 'url' } };
        serviceMock.fetchMangaMetadata = vi.fn(async () => ({ data: manga }));
        await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug' });
        expect(exporterMock.export).toHaveBeenCalledWith(
            expect.objectContaining({ rus_name: 'TestManga' }),
            expect.any(Array),
            expect.any(String)
        );
        expect(saveFileSpy).toHaveBeenCalledTimes(1);
        Math.ceil.mockRestore();
        saveFileSpy.mockRestore();
        delaySpy.mockRestore();
    }, 30000);

    it('Calls _on429 handler with waiting status and current progress', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'test-id', slug: 'slug', controller: ctrl, chapterContents: [], progress: 55 };
        dm.activeDownloads.set('test-id', ds);

        const statusUpdates = [];
        const originalUpdateStatus = dm.updateStatus.bind(dm);
        dm.updateStatus = (id, msg, progress) => {
            statusUpdates.push({ id, msg, progress });
            originalUpdateStatus(id, msg, progress);
        };

        const service = {
            fetchChapter: vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } })),
            extractText: vi.fn(content => content),
            processChapterContent: vi.fn(async content => content)
        };

        const downloadPromise = dm.downloadChapters(service, ds, [{ number: '1', volume: '1' }], () => {});

        await new Promise(resolve => setTimeout(resolve, 0));
        ds.progress = 55;
        service._on429();

        await downloadPromise;

        const waitingCall = statusUpdates.find(u => u.msg === 'Ожидание разрешения от сервера...');
        expect(waitingCall).toBeDefined();
        expect(waitingCall.id).toBe('test-id');
        expect(waitingCall.progress).toBe(55);
    });

    it('Calls _on429 handler with zero progress when download is not in activeDownloads', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'ghost-id', slug: 'slug', controller: ctrl, chapterContents: [] };

        const statusUpdates = [];
        const originalUpdateStatus = dm.updateStatus.bind(dm);
        dm.updateStatus = (id, msg, progress) => {
            statusUpdates.push({ id, msg, progress });
            originalUpdateStatus(id, msg, progress);
        };

        const service = {
            fetchChapter: vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } })),
            extractText: vi.fn(content => content),
            processChapterContent: vi.fn(async content => content)
        };

        const downloadPromise = dm.downloadChapters(service, ds, [{ number: '1', volume: '1' }], () => {});

        await new Promise(resolve => setTimeout(resolve, 0));
        service._on429();

        await downloadPromise;

        const waitingCall = statusUpdates.find(u => u.msg === 'Ожидание разрешения от сервера...');
        expect(waitingCall).toBeDefined();
        expect(waitingCall.id).toBe('ghost-id');
        expect(waitingCall.progress).toBe(0);
    });

    it('downloadWithSizeLimit triggers _on429 with current progress', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'size-id', slug: 'slug', controller: ctrl, chapterContents: [], format: 'fb2' };
        dm.activeDownloads.set('size-id', { ...ds, progress: 33 });

        const statusUpdates = [];
        const original = dm.updateStatus.bind(dm);
        dm.updateStatus = (id, msg, progress) => { statusUpdates.push({ msg, progress }); original(id, msg, progress); };

        let resolveChapter;
        const service = {
            fetchChapter: vi.fn(() => new Promise(resolve => { resolveChapter = resolve; })),
            extractText: vi.fn(c => c),
            processChapterContent: vi.fn(async c => c)
        };
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        const delaySpy = vi.spyOn(dm, 'delay').mockResolvedValue();

        const promise = dm.downloadWithSizeLimit(
            ds, service, [{ volume: '1', number: '1' }], { rus_name: 'M' }, '', 'fb2', 200
        );
        await new Promise(r => setTimeout(r, 0));
        service._on429();
        resolveChapter({ data: { content: [{ type: 'text', text: 'ok' }] } });
        await promise;

        const waiting = statusUpdates.find(u => u.msg === 'Ожидание разрешения от сервера...');
        expect(waiting).toBeDefined();
        expect(waiting.progress).toBe(10);
        saveFileSpy.mockRestore();
        delaySpy.mockRestore();
    });

    it('downloadWithSizeLimit triggers _on429 with zero progress when not in activeDownloads', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'ghost-size-id', slug: 'slug', controller: ctrl, chapterContents: [], format: 'fb2' };

        const statusUpdates = [];
        const original = dm.updateStatus.bind(dm);
        dm.updateStatus = (id, msg, progress) => { statusUpdates.push({ msg, progress }); original(id, msg, progress); };

        let resolveChapter;
        const service = {
            fetchChapter: vi.fn(() => new Promise(resolve => { resolveChapter = resolve; })),
            extractText: vi.fn(c => c),
            processChapterContent: vi.fn(async c => c)
        };
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        const delaySpy = vi.spyOn(dm, 'delay').mockResolvedValue();

        const promise = dm.downloadWithSizeLimit(
            ds, service, [{ volume: '1', number: '1' }], { rus_name: 'M' }, '', 'fb2', 200
        );
        await new Promise(r => setTimeout(r, 0));
        service._on429();
        resolveChapter({ data: { content: [{ type: 'text', text: 'ok' }] } });
        await promise;

        const waiting = statusUpdates.find(u => u.msg === 'Ожидание разрешения от сервера...');
        expect(waiting).toBeDefined();
        expect(waiting.progress).toBe(0);
        saveFileSpy.mockRestore();
        delaySpy.mockRestore();
    });

    it('downloadSingleChapter returns error chapter when fetchChapter throws', async () => {
        const dm = new DownloadManager();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const chapter = { volume: '1', number: '7', name: 'Chapter 7' };
        const service = { fetchChapter: vi.fn(async () => { throw new Error('network error'); }) };
        const ds = { slug: 'slug', format: 'fb2' };

        const result = await dm.downloadSingleChapter(service, ds, chapter);

        expect(result.title).toBe('Chapter 7');
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toContain('Ошибка загрузки главы');
        expect(result.content[0].text).toContain('network error');
        errorSpy.mockRestore();
    });

    it('estimateChapterSize returns 0 for null or non-array content', () => {
        const dm = new DownloadManager();
        expect(dm.estimateChapterSize(null)).toBe(0);
        expect(dm.estimateChapterSize({ content: 'not-array' })).toBe(0);
    });

    it('estimateChapterSize counts image base64 bytes', () => {
        const dm = new DownloadManager();
        const b64 = 'AAAA';
        const chapter = { content: [{ type: 'image', data: { base64: b64 } }] };
        expect(dm.estimateChapterSize(chapter)).toBe(Math.ceil(b64.length * 3 / 4));
    });

    it('estimateChapterSize returns 0 for image block without base64', () => {
        const dm = new DownloadManager();
        const chapter = { content: [{ type: 'image', data: {} }] };
        expect(dm.estimateChapterSize(chapter)).toBe(0);
    });

    it('estimateChapterSize ignores blocks of unknown type', () => {
        const dm = new DownloadManager();
        const chapter = { content: [{ type: 'unknown', data: {} }] };
        expect(dm.estimateChapterSize(chapter)).toBe(0);
    });

    it('downloadSingleChapter returns fallback title when chapter.name is undefined and fetchChapter throws', async () => {
        const dm = new DownloadManager();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const chapter = { volume: '2', number: '5' };
        const service = { fetchChapter: vi.fn(async () => { throw new Error('fail'); }) };
        const ds = { slug: 'slug', format: 'fb2' };
        const result = await dm.downloadSingleChapter(service, ds, chapter);
        expect(result.title).toBe('Том 2, Глава 5');
        expect(result.content[0].text).toContain('fail');
        errorSpy.mockRestore();
    });

    it('downloadSingleChapter uses default volume "1" when chapter.volume is undefined', async () => {
        const dm = new DownloadManager();
        const fetchSpy = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } }));
        const service = { fetchChapter: fetchSpy, extractText: vi.fn(c => c), processChapterContent: vi.fn(async c => c) };
        const ds = { slug: 'myslug', format: 'fb2' };
        const chapter = { number: '3' };
        await dm.downloadSingleChapter(service, ds, chapter);
        expect(fetchSpy).toHaveBeenCalledWith('myslug', '3', '1');
    });

    it('downloadSingleChapter uses chapterData directly when chapterData.data is absent', async () => {
        const dm = new DownloadManager();
        const service = {
            fetchChapter: vi.fn(async () => ({ content: [{ type: 'text', text: 'direct' }] })),
            extractText: vi.fn(c => c),
            processChapterContent: vi.fn(async c => c)
        };
        const ds = { slug: 'slug', format: 'fb2' };
        const result = await dm.downloadSingleChapter(service, ds, { number: '1', volume: '1' });
        expect(result.content[0].text).toBe('direct');
    });

    it('downloadSingleChapter uses rawContent directly when rawContent.content is absent', async () => {
        const dm = new DownloadManager();
        const service = {
            fetchChapter: vi.fn(async () => ({ data: { notContent: 'value' } })),
            extractText: vi.fn(c => c),
            processChapterContent: vi.fn(async c => c)
        };
        const ds = { slug: 'slug', format: 'fb2' };
        const result = await dm.downloadSingleChapter(service, ds, { number: '1', volume: '1' });
        expect(result.content.notContent).toBe('value');
    });

    it('downloadSingleChapter uses contentToExtract directly when extractText is undefined', async () => {
        const dm = new DownloadManager();
        const service = {
            fetchChapter: vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'plain' }] } })),
            extractText: undefined,
            processChapterContent: vi.fn(async c => c)
        };
        const ds = { slug: 'slug', format: 'fb2' };
        const result = await dm.downloadSingleChapter(service, ds, { number: '1', volume: '1' });
        expect(result.content[0].text).toBe('plain');
    });

    it('downloadSingleChapter uses extractedContent directly when processChapterContent is undefined', async () => {
        const dm = new DownloadManager();
        const service = {
            fetchChapter: vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'plain' }] } })),
            extractText: vi.fn(c => c),
            processChapterContent: undefined
        };
        const ds = { slug: 'slug', format: 'fb2' };
        const result = await dm.downloadSingleChapter(service, ds, { number: '1', volume: '1' });
        expect(result.content[0].text).toBe('plain');
    });

    it('Throws Unknown service when createService returns null', async () => {
        globalThis.serviceRegistry.createService = vi.fn(() => null);
        const dm = new DownloadManager();
        await expect(dm.startDownload({ serviceKey: 'nonexistent' })).rejects.toThrow('Unknown service: nonexistent');
    });

    it('startDownload filters chapters by branchId when branchId is provided', async () => {
        serviceMock.fetchChaptersList = vi.fn(async () => ({
            data: [
                { volume: '1', number: '1', branches: [{ branch_id: 42 }] },
                { volume: '1', number: '2', branches: [{ branch_id: 99 }] }
            ]
        }));
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const dm = new DownloadManager();
        await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug', branchId: 42 });
        expect(serviceMock.fetchChapter).toHaveBeenCalledTimes(1);
        expect(serviceMock.fetchChapter).toHaveBeenCalledWith('slug', '1', '1', 42);
        logSpy.mockRestore();
    });

    it('_fetchCoverBase64 returns empty string when fetch throws', async () => {
        const dm = new DownloadManager();
        globalThis.fetch = vi.fn(async () => { throw new Error('Network error'); });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await dm._fetchCoverBase64({ config: {} }, 'https://cover.url');
        expect(result).toBe('');
        expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Failed to load cover:', expect.any(Error));
        warnSpy.mockRestore();
        delete globalThis.fetch;
    });

    it('downloadSingleChapter pushes branchId to fetchArgs when chapter.branchId is not null', async () => {
        const dm = new DownloadManager();
        const fetchSpy = vi.fn(async () => ({ data: { content: [] } }));
        const service = {
            fetchChapter: fetchSpy,
            extractText: vi.fn(c => c),
            processChapterContent: vi.fn(async c => c)
        };
        const ds = { slug: 'slug', format: 'fb2', mangaId: null };
        await dm.downloadSingleChapter(service, ds, { number: '3', volume: '1', branchId: 77 });
        expect(fetchSpy).toHaveBeenCalledWith('slug', '3', '1', 77);
    });

    it('downloadSpecificChapters pushes branchId to fetchArgs when chapter.branchId is not null', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl, mangaId: null, format: 'fb2' };
        const fetchSpy = vi.fn(async () => ({ data: { content: [] } }));
        const service = {
            fetchChapter: fetchSpy,
            extractText: vi.fn(c => c),
            processChapterContent: vi.fn(async c => c)
        };
        const chapters = [{ volume: '1', number: '5', branchId: 33 }];
        await dm.downloadSpecificChapters(service, ds, chapters, 1);
        expect(fetchSpy).toHaveBeenCalledWith('slug', '5', '1', 33);
    });

    it('downloadChapters pushes branchId to fetchArgs when chapter.branchId is not null', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [], mangaId: null, format: 'fb2' };
        const fetchSpy = vi.fn(async () => ({ data: { content: [] } }));
        const service = {
            fetchChapter: fetchSpy,
            extractText: vi.fn(c => c),
            processChapterContent: vi.fn(async c => c)
        };
        const chapters = [{ volume: '2', number: '7', branchId: 55 }];
        await dm.downloadChapters(service, ds, chapters, () => {});
        expect(fetchSpy).toHaveBeenCalledWith('slug', '7', '2', 55);
    });

    it('findMissingChapters returns empty array when no server chapter key matches existing', () => {
        const dm = new DownloadManager();
        const server = [createChapter('1', '1'), createChapter('1', '2')];
        const exist = [Object.assign(createChapter('2', '5'), { content: [{ type: 'text', text: 'ok' }] })];
        expect(dm.findMissingChapters(server, exist)).toEqual([]);
    });

    it('updateExistingFile downloads new chapters when chaptersToDownload is not empty', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', format: 'fb2', controller: ctrl };
        const existingChapter = Object.assign(createChapter('1', '1'), {
            content: [{ type: 'text', text: 'existing ok' }]
        });
        exporterMock.parse = vi.fn(async () => ({
            chapters: [existingChapter],
            metadata: { name: 'Manga', authors: [] },
            cover: 'cover_base64'
        }));
        serviceMock.fetchChaptersList = vi.fn(async () => ({
            data: [createChapter('1', '1'), createChapter('1', '2')]
        }));
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'new' }] } }));
        const result = await dm.updateExistingFile(ds, serviceMock, {});
        expect(result.success).toBe(true);
        expect(result.updated).toBe(true);
        expect(result.addedChapters).toBe(1);
    });

    it('updateExistingFile splits output when size exceeds limit', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', format: 'fb2', controller: ctrl, maxSizeMB: 0.000001 };
        const existingChapter = Object.assign(createChapter('1', '1'), {
            content: [{ type: 'text', text: 'existing ok' }]
        });
        exporterMock.parse = vi.fn(async () => ({
            chapters: [existingChapter],
            metadata: { name: 'Manga', authors: [] },
            cover: 'cover_base64'
        }));
        serviceMock.fetchChaptersList = vi.fn(async () => ({
            data: [createChapter('1', '1'), createChapter('1', '2')]
        }));
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'new content that is large' }] } }));
        const result = await dm.updateExistingFile(ds, serviceMock, {});
        expect(result.success).toBe(true);
        expect(exporterMock.export).toHaveBeenCalledTimes(2);
    });

    it('updateExistingFile skips final export when mergedChapters is empty', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const ds = { id: 'id', slug: 'slug', format: 'fb2', controller: ctrl };
        const existingChapter = Object.assign(createChapter('1', '1'), {
            content: [{ type: 'text', text: 'ok' }]
        });
        exporterMock.parse = vi.fn(async () => ({
            chapters: [existingChapter],
            metadata: { name: 'M', authors: [] },
            cover: 'c'
        }));
        serviceMock.fetchChaptersList = vi.fn(async () => ({
            data: [createChapter('1', '1'), createChapter('1', '2')]
        }));
        vi.spyOn(dm, 'mergeChapters').mockReturnValue([]);
        const result = await dm.updateExistingFile(ds, serviceMock, {});
        expect(result.success).toBe(true);
        expect(exporterMock.export).not.toHaveBeenCalled();
    });

    it('parseFile for mobi format', async () => {
        const dm = new DownloadManager();
        exporterMock.parse = vi.fn(async () => ({ chapters: [], metadata: {}, cover: '' }));
        globalThis.ExporterRegistry = { create: vi.fn(() => exporterMock) };
        const result = await dm.parseFile({}, 'mobi');
        expect(result).toHaveProperty('chapters');
    });

    it('parseFile for simple format', async () => {
        const dm = new DownloadManager();
        exporterMock.parse = vi.fn(async () => ({ chapters: [], metadata: {}, cover: '' }));
        globalThis.ExporterRegistry = { create: vi.fn(() => exporterMock) };
        const result = await dm.parseFile({}, 'simple');
        expect(result).toHaveProperty('chapters');
    });
});
