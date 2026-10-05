import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

    it('_chapterVolume returns the chapter volume or falls back to "1"', () => {
        const dm = new DownloadManager();
        expect(dm._chapterVolume({ volume: '3' })).toBe('3');
        expect(dm._chapterVolume({})).toBe('1');
        expect(dm._chapterVolume({ volume: null })).toBe('1');
        expect(dm._chapterVolume({ volume: '' })).toBe('1');
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

    it('Discards interrupted chapter in download chapters', async () => {
        const dm = new DownloadManager();
        const ds = { id: 'id', slug: 'slug', controller: dm.createController(), chapterContents: [], gate: { interrupted: true } };
        const res = await dm.downloadChapters(serviceMock, ds, [createChapter('1', '1')], () => {});
        expect(res).toEqual([]);
        expect(ds.chapterContents).toEqual([]);
    });

    it('Discards interrupted chapter in download specific chapters', async () => {
        const dm = new DownloadManager();
        const ds = { id: 'id', slug: 'slug', controller: dm.createController(), gate: { interrupted: true } };
        const res = await dm.downloadSpecificChapters(serviceMock, ds, [createChapter('1', '1')], 1);
        expect(res).toEqual([]);
    });

    it('Stops download specific chapters on aborted error without error chapter', async () => {
        const dm = new DownloadManager();
        const ds = { id: 'id', slug: 'slug', controller: dm.createController() };
        const abortedService = {
            ...serviceMock,
            fetchChapter: vi.fn(async () => { throw Object.assign(new Error('Download aborted'), { aborted: true }); })
        };
        const res = await dm.downloadSpecificChapters(abortedService, ds, [createChapter('1', '1'), createChapter('1', '2')], 2);
        expect(res).toEqual([]);
        expect(abortedService.fetchChapter).toHaveBeenCalledTimes(1);
    });

    it('Stops download specific chapters when gate is interrupted during error', async () => {
        const dm = new DownloadManager();
        const ds = { id: 'id', slug: 'slug', controller: dm.createController(), gate: { interrupted: false } };
        const failingService = {
            ...serviceMock,
            fetchChapter: vi.fn(async () => { ds.gate.interrupted = true; throw new Error('fail'); })
        };
        const res = await dm.downloadSpecificChapters(failingService, ds, [createChapter('1', '1')], 1);
        expect(res).toEqual([]);
    });

    it('Aborts in-flight image fetch and discards chapter when download is stopped', async () => {
        const dm = new DownloadManager();
        let stopped = false;
        const controller = {
            isPaused: () => false,
            shouldStop: () => stopped,
            stop: () => { stopped = true; },
            waitIfPaused: async () => {}
        };
        const stoppingService = {
            ...serviceMock,
            fetchChapter: vi.fn(async () => {
                stopped = true;
                await globalThis.fetchPageImage('url', 'mangalib');
                return { data: { content: [] } };
            })
        };
        globalThis.serviceRegistry.createService = vi.fn(() => stoppingService);
        await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', controller });
        expect(stoppingService.fetchChapter).toHaveBeenCalledTimes(1);
        expect(exporterMock.export).not.toHaveBeenCalled();
        expect(stoppingService._gate).toBeNull();
    });

    it('Lets image fetch pass an active gate and keeps newer gates on cleanup', async () => {
        const dm = new DownloadManager();
        globalThis.fetchViaTab = vi.fn(async () => ({ ok: true, base64: 'x', contentType: 'image/jpeg' }));
        const nestedService = {
            ...serviceMock,
            name: 'ranobelib',
            fetchChaptersList: vi.fn(async () => ({ data: [] }))
        };
        const outerService = {
            ...serviceMock,
            fetchChapter: vi.fn(async () => {
                await globalThis.fetchPageImage('url', 'mangalib');
                await dm.startDownload({ slug: 'nested', serviceKey: 'ranobelib', format: 'fb2' });
                outerService._gate = null;
                return { data: { content: [{ type: 'text', text: 'ok' }] } };
            })
        };
        globalThis.serviceRegistry.createService = vi.fn(key => key === 'ranobelib' ? nestedService : outerService);
        const result = await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
        expect(result.success).toBe(true);
        expect(outerService.fetchChapter).toHaveBeenCalled();
        expect(exporterMock.export).toHaveBeenCalled();
    });

    it('Holds a finished image fetch until download is resumed', async () => {
        const dm = new DownloadManager();
        let paused = false;
        let resumed = false;
        const controller = {
            isPaused: () => paused,
            shouldStop: () => false,
            stop: vi.fn(),
            waitIfPaused: async () => {
                while (paused) await new Promise(resolve => setTimeout(resolve, 5));
            }
        };
        globalThis.fetchViaTab = vi.fn(async () => {
            paused = true;
            resumed = false;
            setTimeout(() => { resumed = true; paused = false; }, 30);
            return { ok: true, base64: 'x', contentType: 'image/jpeg' };
        });
        const observedResumed = [];
        const pausingService = {
            ...serviceMock,
            fetchChapter: vi.fn(async () => {
                const response = await globalThis.fetchPageImage('url', 'mangalib');
                observedResumed.push(resumed);
                expect(response.ok).toBe(true);
                return { data: { content: [{ type: 'text', text: 'ok' }] } };
            })
        };
        globalThis.serviceRegistry.createService = vi.fn(() => pausingService);
        await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', controller });
        expect(observedResumed.length).toBeGreaterThan(0);
        expect(observedResumed.every(Boolean)).toBe(true);
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

    it('_createDownloadState sets imageFit only for FB2 with fitFb2Images enabled', () => {
        const dm = new DownloadManager();
        const service = { name: 'ranobelib' };
        const fit = dm._createDownloadState({ slug: 's', format: 'fb2', fitFb2Images: true }, service);
        expect(fit.imageFit).toEqual({ maxWidth: 560, maxHeight: 740 });
        expect(dm._createDownloadState({ slug: 's', format: 'epub', fitFb2Images: true }, service).imageFit).toBeNull();
        expect(dm._createDownloadState({ slug: 's', format: 'fb2' }, service).imageFit).toBeNull();
    });

    it('_fetchCoverBase64 fits cover into imageFit via ImageCompressor', async () => {
        const dm = new DownloadManager();
        globalThis.fetchViaTab = vi.fn(async () => ({ ok: true, contentType: 'image/png', base64: 'orig' }));
        const compress = vi.fn(async () => ({ base64: 'small', contentType: 'image/jpeg' }));
        const prevCompressor = globalThis.ImageCompressor;
        globalThis.ImageCompressor = { compress };
        try {
            const fit = { maxWidth: 560, maxHeight: 740 };
            const result = await dm._fetchCoverBase64({ name: 'ranobelib' }, 'https://cover.url', fit);
            expect(compress).toHaveBeenCalledWith('orig', 'image/png', fit);
            expect(result).toBe('data:image/jpeg;base64,small');
        } finally {
            globalThis.ImageCompressor = prevCompressor;
        }
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
        expect(exporterMock.export).toHaveBeenCalledWith({ name: 'MyManga Том 1' }, expect.any(Array), '');
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

    it('downloadWithSizeLimit never mixes chapters from different volumes into one file and names each part by volume', async () => {
        const dm = new DownloadManager();
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        const ctrl = dm.createController();
        const ds = { id: 'dl5', slug: 'slug', controller: ctrl, chapterContents: [], format: 'fb2', splitPages: true, mangaId: null };
        dm.activeDownloads.set('dl5', ds);
        const chapters = [createChapter('1', '1'), createChapter('1', '2'), createChapter('2', '1')];

        await dm.downloadWithSizeLimit(ds, serviceMock, chapters, { name: 'M' }, '', 'fb2', 200);

        expect(saveFileSpy).toHaveBeenCalledTimes(2);
        expect(exporterMock.export).toHaveBeenNthCalledWith(1, { name: 'M Том 1' },
            [expect.objectContaining({ volume: '1' }), expect.objectContaining({ volume: '1' })], '');
        expect(exporterMock.export).toHaveBeenNthCalledWith(2, { name: 'M Том 2' },
            [expect.objectContaining({ volume: '2' })], '');
    });

    it('downloadWithSizeLimit numbers size-split parts within the same volume', async () => {
        const dm = new DownloadManager();
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        vi.spyOn(dm, 'estimateChapterSize').mockReturnValue(60 * 1024 * 1024);
        const ctrl = dm.createController();
        const ds = { id: 'dl6', slug: 'slug', controller: ctrl, chapterContents: [], format: 'fb2', splitPages: true, mangaId: null };
        dm.activeDownloads.set('dl6', ds);
        const chapters = [createChapter('1', '1'), createChapter('1', '2')];

        await dm.downloadWithSizeLimit(ds, serviceMock, chapters, { name: 'M' }, '', 'fb2', 50);

        expect(saveFileSpy).toHaveBeenCalledTimes(2);
        expect(exporterMock.export).toHaveBeenNthCalledWith(1, { name: 'M Том 1' }, expect.any(Array), '');
        expect(exporterMock.export).toHaveBeenNthCalledWith(2, { name: 'M Том 1 (Часть 2)' }, expect.any(Array), '');
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
        serviceMock.fetchChaptersList = vi.fn(async () => ({}));
        exporterMock.parse = vi.fn(async () => ({
            chapters: [{ volume: '1', number: '1', content: [{ type: 'text', text: 'ok' }] }],
            metadata: { name: 'Test' }, cover: ''
        }));
        const ds = { id: 'ue5', slug: 'slug', format: 'fb2', maxSizeMB: 200, controller: dm.createController() };
        dm.activeDownloads.set('ue5', ds);

        const result = await dm.updateExistingFile(ds, serviceMock, {});
        expect(result.updated).toBe(false);
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

    it('updateExistingFile never mixes merged chapters from different volumes into one file', async () => {
        const dm = new DownloadManager();
        const saveFileSpy = vi.spyOn(dm, 'saveFile').mockResolvedValue();
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: [
            createChapter('1', '1'), createChapter('2', '1'),
        ]}));
        exporterMock.parse = vi.fn(async () => ({
            chapters: [{ volume: '1', number: '1', content: [{ type: 'text', text: 'ok' }] }],
            metadata: { name: 'Test' }, cover: ''
        }));
        const ds = { id: 'ue8', slug: 'slug', format: 'fb2', maxSizeMB: 200, controller: dm.createController(), chapterContents: [] };
        dm.activeDownloads.set('ue8', ds);

        await dm.updateExistingFile(ds, serviceMock, {});
        expect(saveFileSpy).toHaveBeenCalledTimes(2);
        expect(exporterMock.export).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'Test Том 1' }),
            [expect.objectContaining({ volume: '1' })], '');
        expect(exporterMock.export).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: 'Test Том 2' }),
            [expect.objectContaining({ volume: '2' })], '');
    });

    describe('keep-alive port', () => {
        it('returns null and does not throw when runtime.connect is unavailable', () => {
            const dm = new DownloadManager();
            globalThis.extensionApi = { runtime: {} };
            expect(dm._startKeepAlive()).toBeNull();
            delete globalThis.extensionApi;
        });

        it('resolves the extension api through global.getExtensionApi when it is defined', () => {
            const dm = new DownloadManager();
            const connect = vi.fn(() => ({ postMessage: vi.fn(), disconnect: vi.fn(), onDisconnect: { addListener: vi.fn() } }));
            globalThis.getExtensionApi = vi.fn(() => ({ runtime: { connect } }));
            expect(dm._startKeepAlive()).not.toBeNull();
            expect(globalThis.getExtensionApi).toHaveBeenCalled();
            expect(connect).toHaveBeenCalledWith({ name: 'downloadKeepAlive' });
            delete globalThis.getExtensionApi;
        });

        it('does not reconnect if stopped externally right before a pending reconnect fires', () => {
            vi.useFakeTimers();
            const dm = new DownloadManager();
            let disconnectHandler;
            const connect = vi.fn(() => ({
                postMessage: vi.fn(),
                disconnect: vi.fn(),
                onDisconnect: { addListener: (cb) => { disconnectHandler = cb; } }
            }));
            globalThis.extensionApi = { runtime: { connect } };

            const keepAlive = dm._startKeepAlive();
            disconnectHandler();
            keepAlive.stopped = true;
            vi.advanceTimersByTime(2000);
            expect(connect).toHaveBeenCalledTimes(1);

            delete globalThis.extensionApi;
            vi.useRealTimers();
        });

        it('pings the port on an interval and disconnects it on stop', () => {
            vi.useFakeTimers();
            const dm = new DownloadManager();
            const postMessage = vi.fn();
            const disconnect = vi.fn();
            const connect = vi.fn(() => ({ postMessage, disconnect, onDisconnect: { addListener: vi.fn() } }));
            globalThis.extensionApi = { runtime: { connect } };

            const keepAlive = dm._startKeepAlive();
            expect(connect).toHaveBeenCalledWith({ name: 'downloadKeepAlive' });

            vi.advanceTimersByTime(20000);
            expect(postMessage).toHaveBeenCalledTimes(1);

            dm._stopKeepAlive(keepAlive);
            expect(disconnect).toHaveBeenCalled();

            vi.advanceTimersByTime(20000);
            expect(postMessage).toHaveBeenCalledTimes(1);

            delete globalThis.extensionApi;
            vi.useRealTimers();
        });

        it('stops pinging once postMessage starts throwing (port already gone)', () => {
            vi.useFakeTimers();
            const dm = new DownloadManager();
            const postMessage = vi.fn(() => { throw new Error('port closed'); });
            const connect = vi.fn(() => ({ postMessage, disconnect: vi.fn(), onDisconnect: { addListener: vi.fn() } }));
            globalThis.extensionApi = { runtime: { connect } };

            dm._startKeepAlive();
            vi.advanceTimersByTime(20000);
            expect(postMessage).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(20000);
            expect(postMessage).toHaveBeenCalledTimes(1);

            delete globalThis.extensionApi;
            vi.useRealTimers();
        });

        it('warns and returns a state without throwing when runtime.connect itself throws', () => {
            const dm = new DownloadManager();
            const connect = vi.fn(() => { throw new Error('connect failed'); });
            globalThis.extensionApi = { runtime: { connect } };
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const keepAlive = dm._startKeepAlive();
            expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Failed to start keep-alive port:', 'connect failed');
            expect(() => dm._stopKeepAlive(keepAlive)).not.toThrow();

            warnSpy.mockRestore();
            delete globalThis.extensionApi;
        });

        it('reconnects after the service worker force-restarts the port mid-download', () => {
            vi.useFakeTimers();
            const dm = new DownloadManager();
            let disconnectHandler;
            const connect = vi.fn(() => ({
                postMessage: vi.fn(),
                disconnect: vi.fn(),
                onDisconnect: { addListener: (cb) => { disconnectHandler = cb; } }
            }));
            globalThis.extensionApi = { runtime: { connect } };

            dm._startKeepAlive();
            expect(connect).toHaveBeenCalledTimes(1);

            disconnectHandler();
            expect(connect).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(2000);
            expect(connect).toHaveBeenCalledTimes(2);

            delete globalThis.extensionApi;
            vi.useRealTimers();
        });

        it('does not reconnect synchronously — waits out a cooldown first (no hot-loop)', () => {
            vi.useFakeTimers();
            const dm = new DownloadManager();
            const disconnectHandlers = [];
            const connect = vi.fn(() => ({
                postMessage: vi.fn(),
                disconnect: vi.fn(),
                onDisconnect: { addListener: (cb) => disconnectHandlers.push(cb) }
            }));
            globalThis.extensionApi = { runtime: { connect } };

            dm._startKeepAlive();
            disconnectHandlers[0]();
            disconnectHandlers[0]();
            disconnectHandlers[0]();
            expect(connect).toHaveBeenCalledTimes(1);

            delete globalThis.extensionApi;
            vi.useRealTimers();
        });

        it('does not reconnect after an intentional stop', () => {
            vi.useFakeTimers();
            const dm = new DownloadManager();
            let disconnectHandler;
            const connect = vi.fn(() => ({
                postMessage: vi.fn(),
                disconnect: vi.fn(),
                onDisconnect: { addListener: (cb) => { disconnectHandler = cb; } }
            }));
            globalThis.extensionApi = { runtime: { connect } };

            const keepAlive = dm._startKeepAlive();
            dm._stopKeepAlive(keepAlive);
            disconnectHandler();
            vi.advanceTimersByTime(5000);
            expect(connect).toHaveBeenCalledTimes(1);

            delete globalThis.extensionApi;
            vi.useRealTimers();
        });
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

        it('throws when fetchViaTab fails and no service tab is open', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue(null);
            globalThis.hasServiceTab = vi.fn().mockResolvedValue(false);
            await expect(fetchPageImage('https://img.example.com/a.jpg', 'mangalib'))
                .rejects.toThrow(/откройте/i);
            delete globalThis.hasServiceTab;
        });

        it('returns ok:false when fetchViaTab fails but a service tab is open', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue(null);
            globalThis.hasServiceTab = vi.fn().mockResolvedValue(true);
            const result = await fetchPageImage('https://img.example.com/a.jpg', 'mangalib');
            expect(result).toEqual({ ok: false, error: 'Image fetch failed' });
            delete globalThis.hasServiceTab;
        });

        it('tracks the request through globalRateLimiter when available', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue({ ok: true, base64: 'b64' });
            const trackRequest = vi.fn().mockResolvedValue();
            globalThis.globalRateLimiter = { trackRequest };
            await fetchPageImage('https://img.example.com/a.jpg', 'ranobelib');
            expect(trackRequest).toHaveBeenCalledWith('ranobelib');
            delete globalThis.globalRateLimiter;
        });

        it('throws when fetchViaTab fails and hasServiceTab is not available either', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue(null);
            delete globalThis.hasServiceTab;
            await expect(fetchPageImage('https://img.example.com/a.jpg', 'mangalib')).rejects.toThrow();
        });

        it('defaults the rate limiter source to "image" when no serviceKey is given', async () => {
            globalThis.fetchViaTab = vi.fn().mockResolvedValue({ ok: true, base64: 'b64' });
            const trackRequest = vi.fn().mockResolvedValue();
            globalThis.globalRateLimiter = { trackRequest };
            await fetchPageImage('https://img.example.com/a.jpg');
            expect(trackRequest).toHaveBeenCalledWith('image');
            delete globalThis.globalRateLimiter;
        });

        it('throws when fetchViaTab is not defined and no service tab is open', async () => {
            delete globalThis.fetchViaTab;
            globalThis.hasServiceTab = vi.fn().mockResolvedValue(false);
            await expect(fetchPageImage('https://img.example.com/a.jpg', 'mangalib')).rejects.toThrow();
            delete globalThis.hasServiceTab;
        });
    });

    describe('background (deferred) loading', () => {
        let settings, saved, warnSpy, logSpy;

        const never = () => new Promise(() => {});
        const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
        const deferred = () => {
            let resolve, reject;
            const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
            return { promise, resolve, reject };
        };
        const image = (base64 = 'AAAA') => ({ type: 'image', data: { base64, contentType: 'image/jpeg' } });
        const placeholder = (label, running, load = vi.fn()) => ({
            type: 'text',
            text: `[Изображение ${label} загружается в фоне]`,
            pendingImage: { label, load, running, estimatedBytes: 0 }
        });
        const later = (ms, value) => () => new Promise(r => setTimeout(() => r(value), ms));
        const contentOf = chapter => chapter.content.map(b => b.text || b.data.base64);

        beforeEach(() => {
            settings = globalThis.deferredLoadSettings;
            saved = { ...settings };
            Object.assign(settings, {
                deferAfterMs: 20, backgroundAttemptTimeoutMs: 60, retryDelayMs: 5, maxAttempts: 3,
                maxDeferredChapters: 3, defaultImageBytes: 1000, defaultChapterBytes: 6000, pollIntervalMs: 5
            });
            warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        });

        afterEach(() => {
            Object.assign(settings, saved);
            delete globalThis.globalRateLimiter;
            vi.restoreAllMocks();
        });

        describe('loadImageOrDefer', () => {
            it('returns the image when it loads in time', async () => {
                const blocks = [image()];
                expect(await globalThis.loadImageOrDefer(1, async () => blocks)).toBe(blocks);
            });

            it('rethrows an error that happens in time', async () => {
                await expect(globalThis.loadImageOrDefer(1, async () => { throw new Error('tab gone'); }))
                    .rejects.toThrow('tab gone');
            });

            it('returns a placeholder after the deadline while the load keeps running', async () => {
                const load = later(200, [image()]);
                const [block] = await globalThis.loadImageOrDefer(2, load);
                expect(block).toEqual({
                    type: 'text',
                    text: '[Изображение 2 загружается в фоне]',
                    pendingImage: { label: 2, load, running: expect.any(Promise), estimatedBytes: 0 }
                });
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Image 2 not loaded within 0.02 s, ' +
                    'temporarily skipped, it keeps loading in background');
            });

            it('does not count time spent in the rate limiter queue or under 429 throttling', async () => {
                const run = deferred();
                const blocks = [image()];
                globalThis.globalRateLimiter = {
                    getStats: vi.fn()
                        .mockReturnValueOnce({ queueSize: 2 })
                        .mockImplementationOnce(() => {
                            run.resolve(blocks);
                            return { queueSize: 0, throttled: true };
                        })
                        .mockReturnValue({ queueSize: 0, throttled: false })
                };
                expect(await globalThis.loadImageOrDefer(1, () => run.promise)).toBe(blocks);
                expect(globalThis.globalRateLimiter.getStats).toHaveBeenCalledTimes(2);
            });
        });

        describe('DeferredQueue', () => {
            it('registers placeholders of a chapter and reserves the average image size for them', () => {
                const queue = new globalThis.DeferredQueue();
                const first = placeholder(1, never());
                queue.observe({ content: [first] });
                expect(first.pendingImage.estimatedBytes).toBe(1000);
                expect(warnSpy).toHaveBeenLastCalledWith('[DownloadManager] Chapter: 1 image(s) loading ' +
                    'in background (1), ~1 KB each reserved');

                const chapter = {
                    title: 'Глава 2',
                    content: [image('A'.repeat(4000)), image('A'.repeat(8000)), placeholder(2, never()), placeholder(5, never())]
                };
                queue.observe(chapter);
                queue.observe(chapter);
                queue.observe(null);
                queue.observe({ content: [], pendingChapter: {} });
                expect(chapter.content[2].pendingImage.estimatedBytes).toBe(4500);
                expect(queue.size).toBe(3);
                expect(queue.chapterCount).toBe(2);
                expect(warnSpy).toHaveBeenLastCalledWith('[DownloadManager] Chapter "Глава 2": 2 image(s) loading ' +
                    'in background (2, 5), ~4 KB each reserved');
                queue.observe({ content: [{ type: 'image', data: {} }] });
                expect(queue.imageCount).toBe(2);
                queue.dispose();
            });

            it('inserts an image into place as soon as its original load finishes, without restarting it', async () => {
                const queue = new globalThis.DeferredQueue();
                const run = deferred();
                const load = vi.fn();
                const chapter = { title: 'Глава 1', content: [image('X'), placeholder(3, run.promise, load), { type: 'text', text: 'after' }] };
                queue.observe(chapter);
                run.resolve([image('Y1'), { type: 'text', text: 'note' }]);
                await vi.waitFor(() => expect(queue.size).toBe(0));
                expect(contentOf(chapter)).toEqual(['X', 'Y1', 'note', 'after']);
                expect(load).not.toHaveBeenCalled();
                expect(queue.imageCount).toBe(2);
                expect(logSpy).toHaveBeenCalledWith('[DownloadManager] Image 3 of chapter "Глава 1": loaded in background ' +
                    '(attempt 1), inserted into place');
                expect(logSpy).toHaveBeenCalledWith('[DownloadManager] Chapter "Глава 1": all background images inserted');
            });

            it('leaves the content alone when the placeholder is no longer in it', async () => {
                const queue = new globalThis.DeferredQueue();
                const run = deferred();
                const chapter = { content: [placeholder(1, run.promise)] };
                queue.observe(chapter);
                chapter.content = [{ type: 'text', text: 'replaced' }];
                run.resolve([image('LATE')]);
                await vi.waitFor(() => expect(queue.size).toBe(0));
                expect(contentOf(chapter)).toEqual(['replaced']);
            });

            it('does not report a chapter as complete while it still has background images', async () => {
                const queue = new globalThis.DeferredQueue();
                const chapter = { content: [placeholder(1, Promise.resolve([image()])), placeholder(2, never())] };
                queue.observe(chapter);
                await vi.waitFor(() => expect(queue.size).toBe(1));
                expect(logSpy).not.toHaveBeenCalledWith('[DownloadManager] Chapter: all background images inserted');
                queue.dispose();
            });

            it('retries a failed background load after a pause', async () => {
                const queue = new globalThis.DeferredQueue();
                const load = vi.fn().mockResolvedValue([image('R')]);
                const chapter = { content: [placeholder(1, Promise.resolve(null), load)] };
                queue.observe(chapter);
                await vi.waitFor(() => expect(queue.size).toBe(0));
                expect(contentOf(chapter)).toEqual(['R']);
                expect(load).toHaveBeenCalledTimes(1);
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Image 1: background attempt 1/3 failed ' +
                    '(source returned an error), retrying in 0.005 s');
                expect(logSpy).toHaveBeenCalledWith('[DownloadManager] Image 1: retrying download in background (attempt 2/3)...');
                expect(logSpy).toHaveBeenCalledWith('[DownloadManager] Image 1: loaded in background (attempt 2), inserted into place');
            });

            it('gives up after the last attempt and leaves an error marker', async () => {
                const queue = new globalThis.DeferredQueue();
                const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce('oops');
                const block = placeholder(4, Promise.reject(new Error('first')), load);
                queue.observe({ content: [block] });
                await vi.waitFor(() => expect(queue.size).toBe(0));
                expect(block.text).toBe('[Ошибка загрузки изображения 4]');
                expect(block.pendingImage).toBeUndefined();
                expect(load).toHaveBeenCalledTimes(2);
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Image 4: background attempt 1/3 failed (first), retrying in 0.005 s');
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Image 4: background attempt 2/3 failed (boom), retrying in 0.005 s');
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Image 4: giving up (oops, 3 attempt(s) made), leaving error marker');
            });

            it('starts another attempt when one hangs too long and accepts whichever finishes first', async () => {
                const queue = new globalThis.DeferredQueue();
                const first = deferred();
                const second = deferred();
                const third = deferred();
                const load = vi.fn().mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
                const chapter = { content: [placeholder(1, first.promise, load)] };
                queue.observe(chapter);
                await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2), { timeout: 2000 });
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Image 1: still loading after 0.06 s, ' +
                    'starting another attempt, the previous one keeps running');

                first.reject(new Error('late failure'));
                second.resolve(null);
                await tick(10);
                expect(queue.size).toBe(1);
                expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('failed'));

                third.resolve([image('T')]);
                await vi.waitFor(() => expect(queue.size).toBe(0));
                expect(contentOf(chapter)).toEqual(['T']);
            });

            it('ignores results that arrive after the image was already inserted', async () => {
                const queue = new globalThis.DeferredQueue();
                const first = deferred();
                const second = deferred();
                const chapter = { content: [placeholder(1, first.promise, vi.fn(() => second.promise))] };
                queue.observe(chapter);
                await vi.waitFor(() => expect(queue.entries[0]?.attempts).toBe(2));
                first.resolve([image('OLD')]);
                await vi.waitFor(() => expect(queue.size).toBe(0));
                second.resolve([image('NEW')]);
                await tick(5);
                expect(contentOf(chapter)).toEqual(['OLD']);
            });

            it('gives up when every attempt hangs', async () => {
                const queue = new globalThis.DeferredQueue();
                const block = placeholder(1, never(), vi.fn(never));
                queue.observe({ content: [block] });
                await vi.waitFor(() => expect(queue.size).toBe(0), { timeout: 2000 });
                expect(block.text).toBe('[Ошибка загрузки изображения 1]');
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Image 1: giving up ' +
                    '(still not loaded 0.06 s after attempt 3), leaving error marker');
            });

            it('does not start another attempt while the download is held back by the rate limiter', async () => {
                globalThis.globalRateLimiter = {
                    getStats: vi.fn().mockReturnValueOnce({ queueSize: 2 }).mockReturnValue({ queueSize: 0 })
                };
                const queue = new globalThis.DeferredQueue();
                const load = vi.fn(never);
                queue.observe({ content: [placeholder(1, never(), load)] });
                await tick(90);
                expect(globalThis.globalRateLimiter.getStats).toHaveBeenCalled();
                expect(load).not.toHaveBeenCalled();
                await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
                queue.dispose();
            });

            it('does not retry a load interrupted by a download stop; cancelAll leaves error markers', async () => {
                const queue = new globalThis.DeferredQueue();
                const aborted = Object.assign(new Error('Download aborted'), { aborted: true });
                const load = vi.fn();
                const block = placeholder(1, Promise.reject(aborted), load);
                queue.observe({ content: [block] });
                await tick(80);
                expect(load).not.toHaveBeenCalled();
                expect(queue.size).toBe(1);

                queue.cancelAll('download stopped');
                expect(block.text).toBe('[Ошибка загрузки изображения 1]');
                expect(logSpy).toHaveBeenCalledWith('[DownloadManager] Download stopped, cancelling 1 background load(s)');
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Image 1: giving up (download stopped), leaving error marker');

                logSpy.mockClear();
                queue.cancelAll('download stopped');
                expect(logSpy).not.toHaveBeenCalled();
            });

            it('dispose drops all loads silently', async () => {
                const queue = new globalThis.DeferredQueue();
                const load = vi.fn();
                const block = placeholder(1, Promise.resolve(null), load);
                queue.observe({ content: [block] });
                queue.dispose();
                await tick(20);
                expect(load).not.toHaveBeenCalled();
                expect(queue.size).toBe(0);
                expect(block.pendingImage).toBeDefined();
            });

            it('defers a chapter, fills it in place when loaded and tracks its own background images', async () => {
                const queue = new globalThis.DeferredQueue();
                queue.observe({ content: [{ type: 'text', text: 'x'.repeat(500) }] });
                const run = deferred();
                const chapter = queue.deferChapter({ volume: '1', number: '2' }, 'Том 1, Глава 2', vi.fn(), run.promise);
                expect(chapter).toEqual({
                    title: 'Том 1, Глава 2',
                    content: [{ type: 'text', text: '[Глава загружается в фоне]' }],
                    volume: '1',
                    number: '2',
                    pendingChapter: { estimatedBytes: 1000 }
                });
                expect(queue.countChapters()).toBe(1);
                expect(queue.countFor([chapter])).toBe(1);
                expect(queue.countFor([{}])).toBe(0);
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Chapter "Том 1, Глава 2" not loaded within 0.02 s, ' +
                    'temporarily skipped, it keeps loading in background (~1 KB reserved)');

                run.resolve({ title: 'Том 1, Глава 2', content: [image('C'), placeholder(1, never())], volume: '1', number: '2' });
                await vi.waitFor(() => expect(queue.countChapters()).toBe(0));
                expect(chapter.pendingChapter).toBeUndefined();
                expect(chapter.content[0].data.base64).toBe('C');
                expect(queue.countFor([chapter])).toBe(1);
                expect(logSpy).toHaveBeenCalledWith('[DownloadManager] Chapter "Том 1, Глава 2": loaded in background ' +
                    '(attempt 1), inserted into place');
                queue.dispose();
            });

            it('leaves an error chapter when a deferred chapter cannot be loaded', async () => {
                const queue = new globalThis.DeferredQueue();
                const chapter = queue.deferChapter({ volume: '1', number: '3' }, 'Глава 3',
                    vi.fn().mockRejectedValue(new Error('api down')), Promise.reject(new Error('api down')));
                await vi.waitFor(() => expect(chapter.pendingChapter).toBeUndefined());
                expect(chapter.content).toEqual([{ type: 'text', text: '[Ошибка загрузки главы: api down]' }]);
                expect(queue.size).toBe(0);
            });
        });

        describe('DownloadManager', () => {
            const collectStatuses = () => {
                const statuses = [];
                eventBusMock.emit = vi.fn((event, data) => { if (event === 'download:progress') statuses.push(data.status); });
                return statuses;
            };
            const useService = overrides => {
                const service = { ...serviceMock, ...overrides };
                globalThis.serviceRegistry.createService = vi.fn(() => service);
                return service;
            };
            const exportedChapters = (call = 0) => exporterMock.export.mock.calls[call][1];

            it('estimateChapterSize counts background placeholders by their estimates', () => {
                const dm = new DownloadManager();
                const block = placeholder(1, never());
                block.pendingImage.estimatedBytes = 5000;
                expect(dm.estimateChapterSize({ content: [block, { type: 'text', text: 'ab' }] })).toBe(5004);
                expect(dm.estimateChapterSize({ content: [], pendingChapter: { estimatedBytes: 700 } })).toBe(700);
                expect(dm.estimateChapterSize({ content: [], pendingChapter: {} })).toBe(0);
                expect(dm.estimateChapterSize({ content: [placeholder(2, never())] })).toBe(0);
            });

            it('moves on to the next chapter while a slow image loads in background, then inserts it', async () => {
                const dm = new DownloadManager();
                const statuses = collectStatuses();
                const events = [];
                const nextChapterStarted = deferred();
                useService({
                    fetchChapter: vi.fn(async (slug, number) => {
                        events.push(`fetch ${number}`);
                        if (number === '2') setTimeout(nextChapterStarted.resolve, 10);
                        return { data: { content: [] } };
                    }),
                    processChapterContent: vi.fn(async (c, s, opts) => {
                        if (opts.chapterObj.number !== '1') return [image('N2')];
                        const slow = await globalThis.loadImageOrDefer(2, async () => {
                            await nextChapterStarted.promise;
                            events.push('slow image loaded');
                            return [image('S')];
                        });
                        return [image('F'), ...slow];
                    })
                });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
                expect(events.indexOf('fetch 2')).toBeLessThan(events.indexOf('slow image loaded'));
                expect(exportedChapters().map(contentOf)).toEqual([['F', 'S'], ['N2']]);
                expect(statuses).toContain('Глава 2/2: 2 (в фоне: 1)');
                expect(statuses).toContain('Дозагрузка в фоне: осталось 1...');
            });

            it('defers a slow chapter, downloads the next ones and saves it in its place', async () => {
                const dm = new DownloadManager();
                const events = [];
                const nextChapterFetched = deferred();
                useService({
                    fetchChapter: vi.fn(async (slug, number) => {
                        events.push(`fetch ${number}`);
                        if (number === '1') await nextChapterFetched.promise;
                        events.push(`fetched ${number}`);
                        if (number === '2') setTimeout(nextChapterFetched.resolve, 10);
                        return { data: { content: [{ type: 'text', text: `ch${number}` }] } };
                    })
                });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
                expect(events.indexOf('fetched 2')).toBeLessThan(events.indexOf('fetched 1'));
                expect(exportedChapters().map(ch => [ch.title, ...contentOf(ch)]))
                    .toEqual([['Том 1, Глава 1', 'ch1'], ['Том 1, Глава 2', 'ch2']]);
                expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[DownloadManager\] Chapter "Том 1, Глава 1" not loaded within 0\.02 s/));
            });

            it('waits for a chapter in foreground when too many chapters are already loading in background', async () => {
                const dm = new DownloadManager();
                settings.maxDeferredChapters = 1;
                settings.backgroundAttemptTimeoutMs = 2000;
                const lastChapterFetched = deferred();
                useService({
                    fetchChaptersList: vi.fn(async () => ({ data: [createChapter('1', '1'), createChapter('1', '2'), createChapter('1', '3')] })),
                    fetchChapter: vi.fn(async (slug, number) => {
                        if (number === '1') await lastChapterFetched.promise;
                        if (number === '2') await tick(60);
                        if (number === '3') lastChapterFetched.resolve();
                        return { data: { content: [{ type: 'text', text: `ch${number}` }] } };
                    })
                });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
                expect(logSpy).toHaveBeenCalledWith('[DownloadManager] 1 chapters are already loading in background, ' +
                    'keep waiting for chapter "Том 1, Глава 2"');
                expect(exportedChapters().map(contentOf)).toEqual([['ch1'], ['ch2'], ['ch3']]);
            });

            it('does not let deadlines expire while the download is paused', async () => {
                const dm = new DownloadManager();
                const controller = {
                    isPaused: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
                    shouldStop: () => false,
                    stop: vi.fn(),
                    waitIfPaused: async () => {}
                };
                useService({
                    fetchChaptersList: vi.fn(async () => ({ data: [createChapter('1', '1')] })),
                    fetchChapter: vi.fn(async () => {
                        await tick(30);
                        return { data: { content: [{ type: 'text', text: 'ok' }] } };
                    })
                });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', controller });
                expect(controller.isPaused).toHaveBeenCalled();
                expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('not loaded within'));
            });

            it('saves a finished volume only after its background loads, without holding up the next volume', async () => {
                const dm = new DownloadManager();
                const events = [];
                const nextVolumeFetched = deferred();
                exporterMock.export = vi.fn(async (manga, chapters) => {
                    events.push(`save ${manga.name}`);
                    return { blob: {}, filename: 'f' };
                });
                useService({
                    fetchChaptersList: vi.fn(async () => ({ data: [createChapter('1', '1'), createChapter('2', '1')] })),
                    fetchChapter: vi.fn(async (slug, number, volume) => {
                        events.push(`fetch vol ${volume}`);
                        if (volume === '2') setTimeout(nextVolumeFetched.resolve, 10);
                        return { data: { content: [] } };
                    }),
                    processChapterContent: vi.fn(async (c, s, opts) => (opts.chapterObj.volume === '1'
                        ? globalThis.loadImageOrDefer(1, async () => {
                            await nextVolumeFetched.promise;
                            return [image('V1')];
                        })
                        : [image('V2')]))
                });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
                expect(events).toEqual(['fetch vol 1', 'fetch vol 2', 'save undefined Том 1', 'save undefined Том 2']);
                expect(exportedChapters(0).map(contentOf)).toEqual([['V1']]);
            });

            it('reserves the estimated size of a deferred chapter when splitting files', async () => {
                const dm = new DownloadManager();
                const nextChapterFetched = deferred();
                useService({
                    fetchChapter: vi.fn(async (slug, number) => {
                        if (number === '1') await nextChapterFetched.promise;
                        if (number === '2') setTimeout(nextChapterFetched.resolve, 10);
                        return { data: { content: [{ type: 'text', text: 'ok' }] } };
                    })
                });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', maxSizeMB: 0.005 });
                expect(exporterMock.export).toHaveBeenCalledTimes(2);
            });

            it('stop during the final background wait cancels the loads and saves what is ready', async () => {
                const dm = new DownloadManager();
                let stopped = false;
                const controller = { isPaused: () => false, shouldStop: () => stopped, stop: vi.fn(), waitIfPaused: async () => {} };
                eventBusMock.emit = vi.fn((event, data) => {
                    if (event === 'download:progress' && data.status.startsWith('Дозагрузка в фоне')) stopped = true;
                });
                useService({
                    fetchChaptersList: vi.fn(async () => ({ data: [createChapter('1', '1')] })),
                    processChapterContent: vi.fn(async () => [image('OK'), placeholder(2, never())])
                });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', controller });
                expect(exportedChapters().map(contentOf)).toEqual([['OK', '[Ошибка загрузки изображения 2]']]);
                expect(logSpy).toHaveBeenCalledWith('[DownloadManager] Download stopped, cancelling 1 background load(s)');
            });

            it('stop in the middle of the chapter loop cancels background loads before saving', async () => {
                const dm = new DownloadManager();
                let stopped = false;
                const controller = { isPaused: () => false, shouldStop: () => stopped, stop: vi.fn(), waitIfPaused: async () => {} };
                useService({
                    processChapterContent: vi.fn(async () => {
                        stopped = true;
                        return [placeholder(1, never())];
                    })
                });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', controller });
                expect(exportedChapters().map(contentOf)).toEqual([['[Ошибка загрузки изображения 1]']]);
            });

            it('stop while a saved volume waits for its background loads still saves it', async () => {
                const dm = new DownloadManager();
                let stopped = false;
                const controller = { isPaused: () => false, shouldStop: () => stopped, stop: vi.fn(), waitIfPaused: async () => {} };
                const ds = { ...dm._createDownloadState({ slug: 'slug' }, serviceMock), controller };
                const chapter = { content: [placeholder(1, never())] };
                ds.deferred.observe(chapter);
                const waiting = dm._waitForDeferred(ds, [chapter]);
                await tick(10);
                stopped = true;
                await waiting;
                expect(contentOf(chapter)).toEqual(['[Ошибка загрузки изображения 1]']);
            });

            it('loads the cover in background and saves without it if it never arrives', async () => {
                const dm = new DownloadManager();
                globalThis.fetchViaTab = vi.fn(never);
                useService({ fetchMangaMetadata: vi.fn(async () => ({ data: { cover: 'https://img.example.com/c.jpg' } })) });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
                expect(exporterMock.export.mock.calls[0][2]).toBe('');
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Cover is still not loaded, saving without it');
            });

            it('uses the cover loaded in background for every saved file', async () => {
                const dm = new DownloadManager();
                globalThis.fetchViaTab = vi.fn(async () => ({ ok: true, base64: 'CV', contentType: 'image/png' }));
                useService({
                    fetchMangaMetadata: vi.fn(async () => ({ data: { cover: 'https://img.example.com/c.jpg' } })),
                    fetchChaptersList: vi.fn(async () => ({ data: [createChapter('1', '1'), createChapter('2', '1')] }))
                });
                const res = await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
                expect(exporterMock.export.mock.calls.map(c => c[2])).toEqual(['data:image/png;base64,CV', 'data:image/png;base64,CV']);
                expect(globalThis.fetchViaTab).toHaveBeenCalledTimes(1);
                expect(dm.activeDownloads.get(res.downloadId).coverBase64).toBe('data:image/png;base64,CV');
            });

            it('fails the download when saving a file fails', async () => {
                const dm = new DownloadManager();
                vi.spyOn(console, 'error').mockImplementation(() => {});
                exporterMock.export = vi.fn().mockRejectedValue(new Error('disk full'));
                useService({});
                await expect(dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' })).rejects.toThrow('disk full');
            });

            it('update mode waits for background loads of the downloaded chapters', async () => {
                const dm = new DownloadManager();
                const statuses = collectStatuses();
                const service = {
                    ...serviceMock,
                    processChapterContent: vi.fn(async () => globalThis.loadImageOrDefer(1, later(80, [image('UPD')])))
                };
                const ds = { ...dm._createDownloadState({ slug: 'slug' }, service), controller: dm.createController() };
                dm.activeDownloads.set(ds.id, ds);
                const res = await dm.downloadSpecificChapters(service, ds, [createChapter('1', '1')]);
                expect(contentOf(res[0])).toEqual(['UPD']);
                expect(statuses).toContain('Дозагрузка в фоне: осталось 1...');
            });

            it('downloadChapters waits for background loads too', async () => {
                const dm = new DownloadManager();
                const service = {
                    ...serviceMock,
                    processChapterContent: vi.fn(async () => globalThis.loadImageOrDefer(1, later(80, [image('DC')])))
                };
                const ds = { ...dm._createDownloadState({ slug: 'slug' }, service), controller: dm.createController() };
                const res = await dm.downloadChapters(service, ds, [createChapter('1', '1')], () => {});
                expect(contentOf(res[0])).toEqual(['DC']);
            });
        });
    });
});
