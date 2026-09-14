import { describe, it, expect, beforeEach, vi } from 'vitest';

let DownloadManager, fetchPageImage, globalMock, eventBusMock, exporterMock, serviceMock, fileUtilsMock;

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
    globalMock.ExporterRegistry = { create: vi.fn(() => exporterMock), getSupportedFormats: vi.fn(() => ['fb2', 'epub', 'mobi', 'simple']) };
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

    globalThis.fetchViaTab = vi.fn(async () => null);

    await import('../../core/DownloadManager.js');
    DownloadManager = globalThis.DownloadManager;
    fetchPageImage = globalThis.fetchPageImage;
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

    it('Save file with FileUtils', async () => {
        const dm = new DownloadManager();
        await dm.saveFile({}, 'f.fb2');
        expect(fileUtilsMock.downloadBlob).toHaveBeenCalled();
    });

    it('Save file fallback', async () => {
        delete globalThis.FileUtils;
        vi.useFakeTimers();
        const dm = new DownloadManager();
        await dm.saveFile({}, 'f.fb2');
        expect(globalThis.document.createElement).toHaveBeenCalled();
        expect(globalThis.URL.createObjectURL).toHaveBeenCalled();

        const link = globalThis.document.createElement.mock.results[0].value;
        vi.advanceTimersByTime(10000);
        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('bloburl');
        expect(link.remove).toHaveBeenCalled();
        vi.useRealTimers();
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

    it('Fetches cover for ranobelib service via fetchViaTab', async () => {
        globalThis.fetchViaTab = vi.fn(async () => ({ ok: true, contentType: 'image/jpeg', base64: 'abc123' }));

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

        const dm = new DownloadManager();
        await dm.startDownload({ serviceKey: 'ranobelib', url: 'https://ranobelib.me/book/slug' });

        expect(globalThis.fetchViaTab).toHaveBeenCalledWith('ranobe-cover', 'ranobelib');
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

    it('Removes the download from activeDownloads 5s after it finishes', async () => {
        vi.useFakeTimers();
        const dm = new DownloadManager();
        const res = await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug' });
        expect(dm.activeDownloads.has(res.downloadId)).toBe(true);
        vi.advanceTimersByTime(5000);
        expect(dm.activeDownloads.has(res.downloadId)).toBe(false);
        vi.useRealTimers();
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

    it('Breaks loop early when controller should stop', async () => {
        const dm = new DownloadManager();
        const chapters = [];
        for (let i = 1; i <= 181; i++) chapters.push({ volume: '1', number: String(i) });
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: chapters }));
        serviceMock.fetchChapter = vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } }));
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
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
    });

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
            fetchChapter: vi.fn(async () => {
                ds.progress = 55;
                service._on429();
                return { data: { content: [{ type: 'text', text: 'ok' }] } };
            }),
            extractText: vi.fn(content => content),
            processChapterContent: vi.fn(async content => content)
        };

        await dm.downloadChapters(service, ds, [{ number: '1', volume: '1' }], () => {});

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
            fetchChapter: vi.fn(async () => {
                service._on429();
                return { data: { content: [{ type: 'text', text: 'ok' }] } };
            }),
            extractText: vi.fn(content => content),
            processChapterContent: vi.fn(async content => content)
        };

        await dm.downloadChapters(service, ds, [{ number: '1', volume: '1' }], () => {});

        const waitingCall = statusUpdates.find(u => u.msg === 'Ожидание разрешения от сервера...');
        expect(waitingCall).toBeDefined();
        expect(waitingCall.id).toBe('ghost-id');
        expect(waitingCall.progress).toBe(0);
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

    it('_fetchCoverBase64 returns empty string when fetchViaTab throws', async () => {
        const dm = new DownloadManager();
        globalThis.fetchViaTab = vi.fn(async () => { throw new Error('Network error'); });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await dm._fetchCoverBase64({ name: 'mangalib' }, 'https://cover.url');
        expect(result).toBe('');
        expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Failed to load cover:', expect.any(Error));
        warnSpy.mockRestore();
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

    it('downloadSpecificChapters passes splitLongImages true when splitPages=true and format is not simple', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const processContentSpy = vi.fn(async (content, status, opts) => content);
        const service = {
            fetchChapter: vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } })),
            extractText: vi.fn(c => c),
            processChapterContent: processContentSpy
        };
        const ds = { id: 'id', slug: 'slug', controller: ctrl, splitPages: true, format: 'fb2', mangaId: null };
        await dm.downloadSpecificChapters(service, ds, [createChapter('1', '1')], 1);
        expect(processContentSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ splitLongImages: true })
        );
    });

    it('downloadSpecificChapters passes splitLongImages false when splitPages=false', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const processContentSpy = vi.fn(async (content, status, opts) => content);
        const service = {
            fetchChapter: vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } })),
            extractText: vi.fn(c => c),
            processChapterContent: processContentSpy
        };
        const ds = { id: 'id', slug: 'slug', controller: ctrl, splitPages: false, format: 'fb2', mangaId: null };
        await dm.downloadSpecificChapters(service, ds, [createChapter('1', '1')], 1);
        expect(processContentSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ splitLongImages: false })
        );
    });

    it('downloadChapters passes splitLongImages true when splitPages=true and format is not simple', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const processContentSpy = vi.fn(async (content, status, opts) => content);
        const service = {
            fetchChapter: vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } })),
            extractText: vi.fn(c => c),
            processChapterContent: processContentSpy
        };
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [], splitPages: true, format: 'fb2', mangaId: null };
        await dm.downloadChapters(service, ds, [createChapter('1', '1')], () => {});
        expect(processContentSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ splitLongImages: true })
        );
    });

    it('downloadChapters passes splitLongImages false when splitPages=false', async () => {
        const dm = new DownloadManager();
        const ctrl = dm.createController();
        const processContentSpy = vi.fn(async (content, status, opts) => content);
        const service = {
            fetchChapter: vi.fn(async () => ({ data: { content: [{ type: 'text', text: 'ok' }] } })),
            extractText: vi.fn(c => c),
            processChapterContent: processContentSpy
        };
        const ds = { id: 'id', slug: 'slug', controller: ctrl, chapterContents: [], splitPages: false, format: 'fb2', mangaId: null };
        await dm.downloadChapters(service, ds, [createChapter('1', '1')], () => {});
        expect(processContentSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ splitLongImages: false })
        );
    });

    it('findMissingChapters returns empty array when existingChapters is empty', () => {
        const dm = new DownloadManager();
        expect(dm.findMissingChapters([createChapter('1', '1')], [])).toEqual([]);
    });

    it('_resolveService adds Authorization header when authToken is provided', () => {
        const dm = new DownloadManager();
        const mockService = { name: 'mangalib', config: { headers: {} } };
        globalThis.serviceRegistry.createService = vi.fn(() => mockService);
        dm._resolveService('mangalib', null, 'mytoken');
        expect(mockService.config.headers['Authorization']).toBe('Bearer mytoken');
    });

    it('_createExporter skips plugin load when format is supported', async () => {
        const dm = new DownloadManager();
        globalThis.PluginManager = { loadAll: vi.fn(async () => {}) };
        await dm._createExporter('fb2');
        expect(globalThis.PluginManager.loadAll).not.toHaveBeenCalled();
        expect(globalThis.ExporterRegistry.create).toHaveBeenCalledWith('fb2');
        delete globalThis.PluginManager;
    });

    it('_createExporter loads plugins when format is not supported and PluginManager exists', async () => {
        const dm = new DownloadManager();
        globalThis.PluginManager = { loadAll: vi.fn(async () => {}) };
        await dm._createExporter('myplugin');
        expect(globalThis.PluginManager.loadAll).toHaveBeenCalled();
        delete globalThis.PluginManager;
    });

    it('_createExporter skips plugin load when PluginManager is absent', async () => {
        const dm = new DownloadManager();
        delete globalThis.PluginManager;
        await dm._createExporter('myplugin');
        expect(globalThis.ExporterRegistry.create).toHaveBeenCalledWith('myplugin');
    });

    it('_fetchAndFilterChapters filters by branchId', async () => {
        const dm = new DownloadManager();
        const service = {
            fetchChaptersList: vi.fn(async () => ({ data: [
                { volume: '1', number: '1', branches: [{ branch_id: 5 }] },
                { volume: '1', number: '2', branches: [{ branch_id: 9 }] },
            ]}))
        };
        const chapters = await dm._fetchAndFilterChapters(service, { slug: 'slug' }, 5, null);
        expect(chapters.length).toBe(1);
        expect(chapters[0].branchId).toBe(5);
    });

    it('_fetchAndFilterChapters filters by chapterRange', async () => {
        const dm = new DownloadManager();
        const service = {
            fetchChaptersList: vi.fn(async () => ({ data: [
                { volume: '1', number: '1' },
                { volume: '1', number: '2' },
                { volume: '1', number: '3' },
            ]}))
        };
        const chapters = await dm._fetchAndFilterChapters(service, { slug: 'slug' }, null, { from: 0, to: 1 });
        expect(chapters.length).toBe(2);
    });

    it('_fetchCoverBase64 returns empty string and warns when fetchViaTab returns ok=false', async () => {
        const dm = new DownloadManager();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.fetchViaTab = vi.fn(async () => ({ ok: false }));
        const result = await dm._fetchCoverBase64({ name: 'mangalib' }, 'https://cover.url');
        expect(result).toBe('');
        expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] fetchViaTab returned no result for cover');
        warnSpy.mockRestore();
    });

    it('startDownload delegates to updateExistingFile when loadedFile is provided', async () => {
        const dm = new DownloadManager();
        const updateSpy = vi.spyOn(dm, 'updateExistingFile').mockResolvedValue({ success: true, downloadId: 'id', updated: false });
        const result = await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug', loadedFile: {} });
        expect(updateSpy).toHaveBeenCalled();
        expect(result.success).toBe(true);
    });

    it('downloadWithSizeLimit processes chapters and saves a single file', async () => {
        const dm = new DownloadManager();
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        const ctrl = dm.createController();
        const ds = { id: 'dl1', slug: 'slug', controller: ctrl, chapterContents: [], format: 'fb2', splitPages: true, mangaId: null };
        dm.activeDownloads.set('dl1', ds);

        await dm.downloadWithSizeLimit(ds, serviceMock, [createChapter('1', '1')], { name: 'MyManga' }, '', 'fb2', 200);

        expect(saveFileSpy).toHaveBeenCalledTimes(1);
        expect(exporterMock.export).toHaveBeenCalledWith({ name: 'MyManga' }, expect.any(Array), '');
    });

    it('downloadWithSizeLimit splits into multiple parts when chapter size exceeds limit', async () => {
        const dm = new DownloadManager();
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        vi.spyOn(dm, 'estimateChapterSize').mockReturnValue(60 * 1024 * 1024);
        const ctrl = dm.createController();
        const ds = { id: 'dl2', slug: 'slug', controller: ctrl, chapterContents: [], format: 'fb2', splitPages: true, mangaId: null };
        dm.activeDownloads.set('dl2', ds);
        const chapters = [createChapter('1', '1'), createChapter('1', '2'), createChapter('1', '3')];

        await dm.downloadWithSizeLimit(ds, serviceMock, chapters, { name: 'M' }, '', 'fb2', 50);

        expect(saveFileSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('downloadWithSizeLimit _on429 handler updates status with current progress', async () => {
        const dm = new DownloadManager();
        vi.spyOn(dm, 'saveFile').mockResolvedValue();
        const ctrl = dm.createController();
        const ds = { id: 'dl3', slug: 'slug', controller: ctrl, chapterContents: [], format: 'fb2', splitPages: true, mangaId: null, progress: 42 };
        dm.activeDownloads.set('dl3', ds);

        let captured429;
        const origFetch = serviceMock.fetchChapter;
        serviceMock.fetchChapter = vi.fn(async (...args) => {
            captured429 = serviceMock._on429;
            return origFetch(...args);
        });

        await dm.downloadWithSizeLimit(ds, serviceMock, [createChapter('1', '1')], { name: 'M' }, '', 'fb2', 200);

        expect(captured429).toBeTypeOf('function');
        captured429();
        expect(eventBusMock.emit).toHaveBeenCalledWith('download:progress', expect.any(Object));
    });

    it('updateExistingFile returns updated:false when no missing chapters', async () => {
        const dm = new DownloadManager();
        vi.spyOn(dm, 'saveFile').mockResolvedValue();
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: [
            createChapter('1', '1'), createChapter('1', '2'),
        ]}));
        exporterMock.parse = vi.fn(async () => ({
            chapters: [
                { volume: '1', number: '1', content: [{ type: 'text', text: 'ok' }] },
                { volume: '1', number: '2', content: [{ type: 'text', text: 'ok' }] },
            ],
            metadata: { name: 'Test' }, cover: ''
        }));
        const ds = { id: 'ue1', slug: 'slug', format: 'fb2', maxSizeMB: 200, controller: dm.createController() };
        dm.activeDownloads.set('ue1', ds);

        const result = await dm.updateExistingFile(ds, serviceMock, {});
        expect(result.updated).toBe(false);
        expect(result.success).toBe(true);
        expect(eventBusMock.emit).toHaveBeenCalledWith('download:completed', ds);
    });

    it('updateExistingFile downloads missing chapters and saves updated file', async () => {
        const dm = new DownloadManager();
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: [
            createChapter('1', '1'), createChapter('1', '2'),
        ]}));
        exporterMock.parse = vi.fn(async () => ({
            chapters: [{ volume: '1', number: '1', content: [{ type: 'text', text: 'ok' }] }],
            metadata: { name: 'Test' }, cover: ''
        }));
        const ds = { id: 'ue2', slug: 'slug', format: 'fb2', maxSizeMB: 200, controller: dm.createController(), chapterContents: [] };
        dm.activeDownloads.set('ue2', ds);

        const result = await dm.updateExistingFile(ds, serviceMock, {});
        expect(result.updated).toBe(true);
        expect(result.addedChapters).toBe(1);
        expect(saveFileSpy).toHaveBeenCalled();
    });

    it('updateExistingFile uses parseFile when exporter.parse is absent', async () => {
        const dm = new DownloadManager();
        vi.spyOn(dm, 'saveFile').mockResolvedValue();
        const parseFileSpy = vi.spyOn(dm, 'parseFile').mockResolvedValue({
            chapters: [{ volume: '1', number: '1', content: [{ type: 'text', text: 'ok' }] }],
            metadata: { name: 'Test' }, cover: ''
        });
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: [
            createChapter('1', '1'), createChapter('1', '2'),
        ]}));
        const exporterWithoutParse = { export: vi.fn(async () => ({ blob: {}, filename: 'f.fb2' })) };
        globalThis.ExporterRegistry.create = vi.fn(() => exporterWithoutParse);
        const ds = { id: 'ue3', slug: 'slug', format: 'fb2', maxSizeMB: 200, controller: dm.createController(), chapterContents: [] };
        dm.activeDownloads.set('ue3', ds);

        const result = await dm.updateExistingFile(ds, serviceMock, {});
        expect(parseFileSpy).toHaveBeenCalled();
        expect(result.updated).toBe(true);
    });

    it('downloadWithSizeLimit _on429 handler uses 0 progress when download not in activeDownloads', async () => {
        const dm = new DownloadManager();
        vi.spyOn(dm, 'saveFile').mockResolvedValue();
        const ctrl = dm.createController();
        const ds = { id: 'dl4', slug: 'slug', controller: ctrl, chapterContents: [], format: 'fb2', splitPages: true, mangaId: null };
        // ds is intentionally NOT added to activeDownloads

        let captured429;
        const origFetch = serviceMock.fetchChapter;
        serviceMock.fetchChapter = vi.fn(async (...args) => {
            captured429 = serviceMock._on429;
            return origFetch(...args);
        });

        await dm.downloadWithSizeLimit(ds, serviceMock, [createChapter('1', '1')], { name: 'M' }, '', 'fb2', 200);

        expect(captured429).toBeTypeOf('function');
        const updateStatusSpy = vi.spyOn(dm, 'updateStatus');
        captured429();
        expect(updateStatusSpy).toHaveBeenCalledWith('dl4', 'Ожидание разрешения от сервера...', 0);
    });

    it('updateExistingFile uses empty array when chaptersData.data is absent', async () => {
        const dm = new DownloadManager();
        vi.spyOn(dm, 'saveFile').mockResolvedValue();
        serviceMock.fetchChaptersList = vi.fn(async () => ({})); // no .data
        exporterMock.parse = vi.fn(async () => ({
            chapters: [{ volume: '1', number: '1', content: [{ type: 'text', text: 'ok' }] }],
            metadata: { name: 'Test' }, cover: ''
        }));
        const ds = { id: 'ue5', slug: 'slug', format: 'fb2', maxSizeMB: 200, controller: dm.createController() };
        dm.activeDownloads.set('ue5', ds);

        const result = await dm.updateExistingFile(ds, serviceMock, {});
        expect(result.updated).toBe(false); // empty server → nothing to add
    });

    it('updateExistingFile uses default maxSizeBytes 200MB when maxSizeMB is not set', async () => {
        const dm = new DownloadManager();
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: [
            createChapter('1', '1'), createChapter('1', '2'),
        ]}));
        exporterMock.parse = vi.fn(async () => ({
            chapters: [{ volume: '1', number: '1', content: [{ type: 'text', text: 'ok' }] }],
            metadata: { name: 'Test' }, cover: ''
        }));
        const ds = { id: 'ue6', slug: 'slug', format: 'fb2', controller: dm.createController(), chapterContents: [] };
        // maxSizeMB intentionally absent → || 200 branch
        dm.activeDownloads.set('ue6', ds);

        const result = await dm.updateExistingFile(ds, serviceMock, {});
        expect(result.updated).toBe(true);
        expect(saveFileSpy).toHaveBeenCalled();
    });

    it('updateExistingFile skips final export when merged chapters is empty', async () => {
        const dm = new DownloadManager();
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        vi.spyOn(dm, 'mergeChapters').mockReturnValue([]);
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: [createChapter('1', '1'), createChapter('1', '2')] }));
        exporterMock.parse = vi.fn(async () => ({
            chapters: [{ volume: '1', number: '1', content: [{ type: 'text', text: 'ok' }] }],
            metadata: { name: 'Test' }, cover: ''
        }));
        const ds = { id: 'ue7', slug: 'slug', format: 'fb2', maxSizeMB: 200, controller: dm.createController(), chapterContents: [] };
        dm.activeDownloads.set('ue7', ds);

        await dm.updateExistingFile(ds, serviceMock, {});
        expect(saveFileSpy).not.toHaveBeenCalled();
    });

    it('updateExistingFile splits merged chapters into multiple parts when size limit exceeded', async () => {
        const dm = new DownloadManager();
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        vi.spyOn(dm, 'estimateChapterSize').mockReturnValue(60 * 1024 * 1024);
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: [
            createChapter('1', '1'), createChapter('1', '2'),
        ]}));
        exporterMock.parse = vi.fn(async () => ({
            chapters: [{ volume: '1', number: '1', content: [{ type: 'text', text: 'ok' }] }],
            metadata: { name: 'Test' }, cover: ''
        }));
        const ds = { id: 'ue4', slug: 'slug', format: 'fb2', maxSizeMB: 50, controller: dm.createController(), chapterContents: [] };
        dm.activeDownloads.set('ue4', ds);

        const result = await dm.updateExistingFile(ds, serviceMock, {});
        expect(saveFileSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(result.updated).toBe(true);
    });

    describe('fetchPageImage', () => {
        it('prefers fetchViaTab and never touches runtime.sendMessage when it succeeds', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue({ ok: true, base64: 'b64', contentType: 'image/jpeg' });
            const sendMessage = vi.fn();
            globalThis.extensionApi = { runtime: { sendMessage } };
            const result = await fetchPageImage('https://img.example.com/a.jpg', 'mangalib');
            expect(result).toEqual({ ok: true, base64: 'b64', contentType: 'image/jpeg' });
            expect(globalThis.fetchViaTab).toHaveBeenCalledWith('https://img.example.com/a.jpg', 'mangalib');
            expect(sendMessage).not.toHaveBeenCalled();
            delete globalThis.extensionApi;
        });

        it('falls back to runtime.sendMessage when fetchViaTab fails', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue(null);
            const sendMessage = vi.fn().mockResolvedValue({ ok: true, base64: 'b64', contentType: 'image/jpeg' });
            globalThis.extensionApi = { runtime: { sendMessage } };
            const result = await fetchPageImage('https://img.example.com/a.jpg', 'mangalib');
            expect(result).toEqual({ ok: true, base64: 'b64', contentType: 'image/jpeg' });
            expect(sendMessage).toHaveBeenCalledWith({ action: 'fetchImage', url: 'https://img.example.com/a.jpg', serviceKey: 'mangalib' });
            delete globalThis.extensionApi;
        });

        it('retries sendMessage once when the background page was asleep', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue(null);
            const sendMessage = vi.fn()
                .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
                .mockResolvedValueOnce({ ok: true, base64: 'b64', contentType: 'image/jpeg' });
            globalThis.extensionApi = { runtime: { sendMessage } };
            const result = await fetchPageImage('https://img.example.com/a.jpg', 'mangalib');
            expect(result).toEqual({ ok: true, base64: 'b64', contentType: 'image/jpeg' });
            expect(sendMessage).toHaveBeenCalledTimes(2);
            delete globalThis.extensionApi;
        });

        it('gives up after a second failed retry and returns ok:false', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue(null);
            const sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
            globalThis.extensionApi = { runtime: { sendMessage } };
            const result = await fetchPageImage('https://img.example.com/a.jpg', 'mangalib');
            expect(result.ok).toBe(false);
            expect(sendMessage).toHaveBeenCalledTimes(2);
            delete globalThis.extensionApi;
        });

        it('does not retry on unrelated sendMessage errors', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue(null);
            const sendMessage = vi.fn().mockRejectedValue(new Error('Network error'));
            globalThis.extensionApi = { runtime: { sendMessage } };
            const result = await fetchPageImage('https://img.example.com/a.jpg', 'mangalib');
            expect(result).toEqual({ ok: false, error: 'Error: Network error' });
            expect(sendMessage).toHaveBeenCalledTimes(1);
            delete globalThis.extensionApi;
        });

        it('tracks the request through globalRateLimiter when available', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue({ ok: true, base64: 'b64' });
            const trackRequest = vi.fn().mockResolvedValue();
            globalThis.globalRateLimiter = { trackRequest };
            await fetchPageImage('https://img.example.com/a.jpg', 'ranobelib');
            expect(trackRequest).toHaveBeenCalledWith('ranobelib');
            delete globalThis.globalRateLimiter;
        });

        it('returns ok:false when no extension api is available at all', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue(null);
            delete globalThis.extensionApi;
            const result = await fetchPageImage('https://img.example.com/a.jpg', 'mangalib');
            expect(result).toEqual({ ok: false, error: 'runtime.sendMessage not available' });
        });

        it('defaults the rate limiter source to "image" when no serviceKey is given', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue({ ok: true, base64: 'b64' });
            const trackRequest = vi.fn().mockResolvedValue();
            globalThis.globalRateLimiter = { trackRequest };
            await fetchPageImage('https://img.example.com/a.jpg');
            expect(trackRequest).toHaveBeenCalledWith('image');
            delete globalThis.globalRateLimiter;
        });

        it('skips fetchViaTab entirely when it is not defined and goes straight to sendMessage', async () => {
            delete globalThis.fetchViaTab;
            const sendMessage = vi.fn().mockResolvedValue({ ok: true, base64: 'b64', contentType: 'image/jpeg' });
            globalThis.extensionApi = { runtime: { sendMessage } };
            const result = await fetchPageImage('https://img.example.com/a.jpg', 'mangalib');
            expect(result).toEqual({ ok: true, base64: 'b64', contentType: 'image/jpeg' });
            expect(sendMessage).toHaveBeenCalledTimes(1);
            delete globalThis.extensionApi;
        });

        it('resolves the extension api through global.getExtensionApi when it is defined', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue(null);
            const sendMessage = vi.fn().mockResolvedValue({ ok: true, base64: 'b64', contentType: 'image/jpeg' });
            globalThis.getExtensionApi = vi.fn(() => ({ runtime: { sendMessage } }));
            const result = await fetchPageImage('https://img.example.com/a.jpg', 'mangalib');
            expect(result).toEqual({ ok: true, base64: 'b64', contentType: 'image/jpeg' });
            expect(globalThis.getExtensionApi).toHaveBeenCalled();
            delete globalThis.getExtensionApi;
        });

        it('does not retry when the rejection has no message property (falls back to empty string)', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue(null);
            const sendMessage = vi.fn().mockRejectedValue({});
            globalThis.extensionApi = { runtime: { sendMessage } };
            const result = await fetchPageImage('https://img.example.com/a.jpg', 'mangalib');
            expect(result).toEqual({ ok: false, error: '[object Object]' });
            expect(sendMessage).toHaveBeenCalledTimes(1);
            delete globalThis.extensionApi;
        });
    });
});
