import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({}));

vi.mock('../../core/BrowserApi.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'extensionApi'));
vi.mock('../../core/TabNetwork.js', async () => (await import('../helpers/ModuleMock.js'))
    .mockExports(mocks, 'fetchViaTab', 'NoServiceTabError'));
vi.mock('../../core/EventBus.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'EventBus'));
vi.mock('../../core/ImageCompressor.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'ImageCompressor'));
vi.mock('../../core/MangaPatcher.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'MangaPatcher'));
vi.mock('../../core/PluginManager.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'PluginManager'));
vi.mock('../../core/RateLimitClient.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'RateLimitClient'));
vi.mock('../../exporters/ExporterRegistry.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'ExporterRegistry'));
vi.mock('../../services/ServiceRegistry.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'serviceRegistry'));

let DownloadManager, safeFilename, DEFERRED_SETTINGS, BaseService;
let globalMock, eventBusMock, exporterMock, serviceMock, downloadsMock, exported;

const NO_TAB = { ok: false, status: 0, noTab: true, error: 'No service tab' };

function createChapter(vol, num, name = undefined) {
    return { volume: vol, number: num, name };
}

/**
 * Запоминает копию того, что получил экспортёр: после сохранения файла
 * DownloadManager освобождает содержимое глав пакета.
 * @param {object} manga - Метаданные тайтла.
 * @param {object[]} chapters - Главы пакета.
 * @param {string} cover - Обложка.
 * @returns {void}
 */
function recordExport(manga, chapters, cover) {
    exported.push({
        manga: { ...manga },
        chapters: chapters.map(ch => ({ ...ch, content: Array.isArray(ch.content) ? [...ch.content] : ch.content })),
        cover
    });
}

/**
 * Заглушка сервиса с методами get* настоящего BaseService: они вызывают fetch*-методы
 * заглушки и разворачивают ответ API так же, как у настоящих сервисов.
 * @param {object} methods - Поля и методы заглушки.
 * @returns {object} Заглушка сервиса.
 */
function asService(methods) {
    return Object.assign(Object.create(BaseService.prototype), methods);
}

beforeEach(async () => {
    ({ BaseService } = await import('../../services/BaseService.js'));
    globalMock = {};
    eventBusMock = { emit: vi.fn() };
    exported = [];
    exporterMock = {
        export: vi.fn(async (manga, chapters, cover) => {
            recordExport(manga, chapters, cover);
            return { blob: {}, filename: 'file.fb2' };
        })
    };
    serviceMock = asService({
        name: 'mangalib',
        fetchMangaMetadata: vi.fn(async slug => ({ data: { cover: { default: 'url' } } })),
        fetchChaptersList: vi.fn(async slug => ({ data: [createChapter('1', '1'), createChapter('1', '2')] })),
        fetchChapter: vi.fn(async (slug, number, volume) => ({ data: { content: [{ type: 'text', text: 'ok' }] } })),
        extractText: vi.fn(content => content),
        processChapterContent: vi.fn(async (content) => content)
    });
    downloadsMock = {
        download: vi.fn(async () => 7),
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    };

    globalMock.EventBus = vi.fn(function() { return eventBusMock; });
    globalMock.ExporterRegistry = { create: vi.fn(() => exporterMock), getSupportedFormats: vi.fn(() => ['fb2', 'epub', 'mobi', 'simple']) };
    globalMock.MangaPatcher = { patch: vi.fn((c) => c) };
    globalMock.serviceRegistry = {
        getServiceByUrl: vi.fn(() => serviceMock),
        findServiceKey: vi.fn(() => 'mangalib'),
        createService: vi.fn(key => key === 'ranobelib' ? asService({ ...serviceMock, name: 'ranobelib' }) : serviceMock)
    };

    mocks.EventBus = globalMock.EventBus;
    mocks.ExporterRegistry = globalMock.ExporterRegistry;
    mocks.MangaPatcher = globalMock.MangaPatcher;
    mocks.serviceRegistry = globalMock.serviceRegistry;
    mocks.extensionApi = { downloads: downloadsMock };

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
    });

    mocks.fetchViaTab = vi.fn(async () => NO_TAB);
    mocks.NoServiceTabError = class NoServiceTabError extends Error {};
    mocks.PluginManager = { loadAll: vi.fn(async () => {}) };
    mocks.ImageCompressor = { compress: vi.fn(async (base64, contentType) => ({ base64, contentType })) };
    mocks.RateLimitClient = {
        acquire: vi.fn(async () => {}),
        isHeldBack: vi.fn(() => false),
        throttle: vi.fn()
    };

    ({ DownloadManager, safeFilename } = await import('../../core/DownloadManager.js'));
    ({ DEFERRED_SETTINGS } = await import('../../core/DeferredQueue.js'));
});

afterEach(() => {
    delete mocks.extensionApi;
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

    it('Selects the chapters of the branch between the range keys', () => {
        const dm = new DownloadManager();
        const chapters = [
            { id: 1, volume: '1', number: '1', branches: [{ branch_id: 5 }] },
            { id: 2, volume: '1', number: '2', branches: [{ branch_id: 9 }] },
            { id: 3, volume: '1', number: '3', branches: [{ branch_id: 5 }] },
            { id: 4, volume: '2', number: '4', branches: [{ branch_id: 5 }] }
        ];
        expect(dm._selectChapters(chapters, null, null)).toBe(chapters);
        expect(dm._selectChapters(chapters, 5, { fromKey: '3', toKey: '4' }))
            .toEqual([{ ...chapters[2], branchId: 5 }, { ...chapters[3], branchId: 5 }]);
        expect(() => dm._selectChapters(chapters, 5, { fromKey: '2', toKey: '4' })).toThrow('не найдены');
        expect(() => dm._selectChapters(chapters, null, { fromKey: '4', toKey: '1' })).toThrow('позже');
        expect(() => dm._selectChapters(chapters, 7, null)).toThrow('Нет глав для загрузки');
    });

    it('Turns an invalid branch id into no branch with a warning', () => {
        const dm = new DownloadManager();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(dm._normalizeBranchId(null)).toBeNull();
        expect(dm._normalizeBranchId(undefined)).toBeNull();
        expect(dm._normalizeBranchId('')).toBeNull();
        expect(dm._normalizeBranchId('12')).toBe(12);
        expect(dm._normalizeBranchId(7)).toBe(7);
        expect(warnSpy).not.toHaveBeenCalled();
        expect(dm._normalizeBranchId(NaN)).toBeNull();
        expect(dm._normalizeBranchId('abc')).toBeNull();
        expect(warnSpy).toHaveBeenCalledTimes(2);
        warnSpy.mockRestore();
    });

    it('Downloads the given chapter list in the key range without fetching it again', async () => {
        const dm = new DownloadManager();
        const chapters = [
            { id: 10, volume: '1', number: '1' },
            { id: 11, volume: '1', number: '2' },
            { id: 12, volume: '1', number: '3' }
        ];
        await dm.startDownload({
            slug: 'slug', serviceKey: 'mangalib', chapters, chapterRange: { fromKey: '11', toKey: '12' }, branchId: NaN
        });
        expect(serviceMock.fetchChaptersList).not.toHaveBeenCalled();
        expect(serviceMock.fetchChapter.mock.calls.map(call => call[1])).toEqual(['2', '3']);
        expect(exported[0].chapters.map(ch => ch.key)).toEqual(['11', '12']);
    });

    it('Fetches and sorts the chapter list when none is given and fails on an unknown range', async () => {
        const dm = new DownloadManager();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        serviceMock.fetchChaptersList = vi.fn(async () => ({ data: [createChapter('2', '1'), createChapter('1', '1')] }));
        await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', chapters: [] });
        expect(serviceMock.fetchChaptersList).toHaveBeenCalledTimes(1);
        expect(exported.map(file => file.chapters.map(ch => ch.key))).toEqual([['v1_ch1'], ['v2_ch1']]);

        await expect(dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', chapterRange: { fromKey: 'x', toKey: 'y' } }))
            .rejects.toThrow('Выбранные главы не найдены');
        expect(exported).toHaveLength(2);
    });

    it('Takes the slug from the url when no slug is given', () => {
        const dm = new DownloadManager();
        const service = { name: 'mangalib' };
        expect(dm._createDownloadState({ url: 'https://site/manga/abc-def#comments' }, service).slug).toBe('abc-def');
        expect(dm._createDownloadState({ url: 'https://site/book/xyz?section=info' }, service).slug).toBe('xyz');
        expect(dm._createDownloadState({ slug: 'given', url: 'https://site/manga/other' }, service).slug).toBe('given');
        expect(dm._createDownloadState({}, service).slug).toBeNull();
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

    it('_chapterVolume returns the chapter volume or falls back to "1"', () => {
        const dm = new DownloadManager();
        expect(dm._chapterVolume({ volume: '3' })).toBe('3');
        expect(dm._chapterVolume({})).toBe('1');
        expect(dm._chapterVolume({ volume: null })).toBe('1');
        expect(dm._chapterVolume({ volume: '' })).toBe('1');
    });

    describe('saveFile', () => {
        it('Saves through the downloads API with a cleaned name and frees the URL when the download completes', async () => {
            const dm = new DownloadManager();
            const blob = new Blob(['x']);
            await dm.saveFile(blob, ' Манга: том/1?.fb2 ');
            expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(blob);
            expect(downloadsMock.download).toHaveBeenCalledWith({
                url: 'bloburl', filename: 'Манга_ том_1_.fb2', conflictAction: 'uniquify'
            });
            const [listener] = downloadsMock.onChanged.addListener.mock.calls[0];
            listener({ id: 99, state: { current: 'complete' } });
            listener({ id: 7, state: { current: 'in_progress' } });
            expect(globalThis.URL.revokeObjectURL).not.toHaveBeenCalled();
            listener({ id: 7, state: { current: 'complete' } });
            expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('bloburl');
            expect(downloadsMock.onChanged.removeListener).toHaveBeenCalledWith(listener);
            listener({ id: 7, state: { current: 'interrupted' } });
            expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
        });

        it('Frees the URL of an interrupted download and, failing any event, after a timeout', async () => {
            vi.useFakeTimers();
            try {
                const dm = new DownloadManager();
                await dm.saveFile(new Blob(['x']), 'a.fb2');
                downloadsMock.onChanged.addListener.mock.calls[0][0]({ id: 7, state: { current: 'interrupted' } });
                expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(1);

                delete downloadsMock.onChanged;
                await dm.saveFile(new Blob(['x']), 'b.fb2');
                vi.advanceTimersByTime(10 * 60 * 1000);
                expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(2);
            } finally {
                vi.useRealTimers();
            }
        });

        it('Frees the URL at once and rethrows when the browser rejects the download', async () => {
            const dm = new DownloadManager();
            downloadsMock.download.mockRejectedValueOnce(new Error('Invalid filename'));
            await expect(dm.saveFile(new Blob(['x']), 'a.fb2')).rejects.toThrow('Invalid filename');
            expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('bloburl');
        });

        it('Fails clearly without the downloads API', async () => {
            const dm = new DownloadManager();
            delete mocks.extensionApi;
            await expect(dm.saveFile(new Blob(['x']), 'a.fb2')).rejects.toThrow('Сохранение файла недоступно');
            expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled();
        });

        it('safeFilename keeps the extension and trims dots and spaces', () => {
            expect(safeFilename('Title.fb2')).toBe('Title.fb2');
            expect(safeFilename('  ..Ti<t>le..  .epub')).toBe('Ti_t_le.epub');
            expect(safeFilename('...')).toBe('download');
            expect(safeFilename(null)).toBe('download');
            expect(safeFilename('.zip')).toBe('download.zip');
            expect(safeFilename('No extension.')).toBe('No extension');
            const long = safeFilename(`${'a'.repeat(300)}.mobi`);
            expect(long).toHaveLength(200);
            expect(long.endsWith('.mobi')).toBe(true);
        });
    });

    it('Frees the chapters of a batch once its file is saved', async () => {
        const dm = new DownloadManager();
        const received = [];
        exporterMock.export = vi.fn(async (manga, chapters) => {
            received.push(chapters);
            recordExport(manga, chapters);
            return { blob: {}, filename: 'f.fb2' };
        });
        await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib' });
        expect(exported[0].chapters.map(ch => ch.content)).toEqual([[{ type: 'text', text: 'ok' }], [{ type: 'text', text: 'ok' }]]);
        expect(received[0]).toEqual([]);
    });

    it('Keeps the batch when saving its file fails', async () => {
        const dm = new DownloadManager();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const received = [];
        exporterMock.export = vi.fn(async (manga, chapters) => {
            received.push(chapters);
            return { blob: {}, filename: 'f.fb2' };
        });
        downloadsMock.download.mockRejectedValueOnce(new Error('disk full'));
        await expect(dm.startDownload({ slug: 'slug', serviceKey: 'mangalib' })).rejects.toThrow('disk full');
        expect(received[0].map(ch => ch.content)).toEqual([[{ type: 'text', text: 'ok' }], [{ type: 'text', text: 'ok' }]]);
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
        const stoppingService = asService({
            ...serviceMock,
            fetchChapter: vi.fn(async function () {
                stopped = true;
                await this.fetchImage('url');
                return { data: { content: [] } };
            })
        });
        mocks.serviceRegistry.createService = vi.fn(() => stoppingService);
        await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', controller });
        expect(stoppingService.fetchChapter).toHaveBeenCalledTimes(1);
        expect(mocks.fetchViaTab).not.toHaveBeenCalled();
        expect(exporterMock.export).not.toHaveBeenCalled();
        expect(stoppingService.ctx).toBeNull();
    });

    it('Gives every download its own context and detaches the service afterwards', async () => {
        const dm = new DownloadManager();
        mocks.fetchViaTab = vi.fn(async () => ({ ok: true, status: 200, noTab: false, base64: 'x', contentType: 'image/jpeg' }));
        const contexts = [];
        const nestedService = asService({
            ...serviceMock,
            name: 'ranobelib',
            fetchChaptersList: vi.fn(async () => ({ data: [createChapter('1', '1')] }))
        });
        const outerService = asService({
            ...serviceMock,
            fetchChapter: vi.fn(async function () {
                contexts.push(this.ctx);
                await this.fetchImage('url');
                await dm.startDownload({ slug: 'nested', serviceKey: 'ranobelib', format: 'fb2' });
                contexts.push(this.ctx);
                return { data: { content: [{ type: 'text', text: 'ok' }] } };
            })
        });
        mocks.serviceRegistry.createService = vi.fn(key => key === 'ranobelib' ? nestedService : outerService);
        const result = await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
        expect(result.success).toBe(true);
        expect(contexts[0]).toBeTruthy();
        expect(contexts[1]).toBe(contexts[0]);
        expect(outerService.ctx).toBeNull();
        expect(nestedService.ctx).toBeNull();
        expect(exporterMock.export).toHaveBeenCalled();
    });

    it('Leaves a service alone that was attached to another context during the download', async () => {
        const dm = new DownloadManager();
        const otherCtx = { checkpoint: async () => {} };
        const service = asService({
            ...serviceMock,
            fetchChapter: vi.fn(async function () {
                this.attach(otherCtx);
                return { data: { content: [{ type: 'text', text: 'ok' }] } };
            })
        });
        mocks.serviceRegistry.createService = vi.fn(() => service);
        await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
        expect(service.ctx).toBe(otherCtx);
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
        mocks.fetchViaTab = vi.fn(async () => {
            paused = true;
            resumed = false;
            setTimeout(() => { resumed = true; paused = false; }, 30);
            return { ok: true, status: 200, noTab: false, base64: 'x', contentType: 'image/jpeg' };
        });
        const observedResumed = [];
        const pausingService = asService({
            ...serviceMock,
            fetchChapter: vi.fn(async function () {
                const response = await this.fetchImage('url');
                observedResumed.push(resumed);
                expect(response.ok).toBe(true);
                return { data: { content: [{ type: 'text', text: 'ok' }] } };
            })
        });
        mocks.serviceRegistry.createService = vi.fn(() => pausingService);
        await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', controller });
        expect(observedResumed.length).toBeGreaterThan(0);
        expect(observedResumed.every(Boolean)).toBe(true);
    });

    it('Start download with unknown service', async () => {
        mocks.serviceRegistry.createService = vi.fn(() => null);
        const dm = new DownloadManager();
        await expect(dm.startDownload({ serviceKey: 'unknown' })).rejects.toThrow('Unknown service: unknown');
    });

    it('Start download no service', async () => {
        const dm = new DownloadManager();
        await expect(dm.startDownload({})).rejects.toThrow();
    });

    it('Start download for a site no service matches', async () => {
        mocks.serviceRegistry.findServiceKey = vi.fn(() => null);
        const dm = new DownloadManager();
        await expect(dm.startDownload({ url: 'https://site/manga/slug' })).rejects.toThrow('Unsupported service');
    });

    it('Creates its own service instance for a download started by URL', async () => {
        const dm = new DownloadManager();
        await dm.startDownload({ url: 'https://mangalib.me/ru/manga/slug', format: 'fb2' });
        expect(mocks.serviceRegistry.findServiceKey).toHaveBeenCalledWith('https://mangalib.me/ru/manga/slug');
        expect(mocks.serviceRegistry.createService).toHaveBeenCalledWith('mangalib');
        expect(mocks.serviceRegistry.getServiceByUrl).not.toHaveBeenCalled();
    });

    it('Calls RanobeLib service via serviceRegistry.createService', async () => {
        const ranobeMock = asService({ name: 'ranobelib', fetchMangaMetadata: vi.fn(async () => ({ data: {} })), fetchChaptersList: vi.fn(async () => ({ data: [createChapter('1', '1')] })), fetchChapter: vi.fn(async () => ({ data: { content: [] } })), extractText: vi.fn(), processChapterContent: vi.fn() });
        const createServiceSpy = vi.fn(key => key === 'ranobelib' ? ranobeMock : null);
        mocks.serviceRegistry = { getServiceByUrl: vi.fn(() => null), createService: createServiceSpy };

        const dm = new DownloadManager();
        await dm.startDownload({ serviceKey: 'ranobelib', url: 'https://site/book/slug' });

        expect(createServiceSpy).toHaveBeenCalledWith('ranobelib');
    });

    it('Not detect data in metadata', async () => {
        const serviceWithoutData = asService({
            name: 'mangalib',
            fetchMangaMetadata: vi.fn(async slug => ({ cover: { default: 'url' } })),
            fetchChaptersList: vi.fn(async slug => ({ data: [createChapter('1', '1')] })),
            fetchChapter: vi.fn(async (slug, number, volume) => ({ data: { content: [{ type: 'text', text: 'ok' }] } })),
            extractText: vi.fn(content => content),
            processChapterContent: vi.fn(async (content) => content)
        });

        mocks.serviceRegistry = { getServiceByUrl: vi.fn(() => serviceWithoutData), createService: vi.fn(() => serviceWithoutData) };

        const dm = new DownloadManager();

        const res = await dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug' });
        const state = dm.activeDownloads.get(res.downloadId);
        expect(state.manga).toEqual({ cover: { default: 'url' } });
    });

    it('Fetches cover for ranobelib service via fetchViaTab', async () => {
        mocks.fetchViaTab = vi.fn(async () => ({ ok: true, status: 200, noTab: false, contentType: 'image/jpeg', base64: 'abc123' }));

        const ranobeMock = asService({
            name: 'ranobelib',
            config: { imageHeaders: { 'Referer': 'https://ranobelib.me/', 'Accept': 'image/*' } },
            fetchMangaMetadata: vi.fn(async () => ({ data: { cover: 'ranobe-cover' } })),
            fetchChaptersList: vi.fn(async () => ({ data: [createChapter('1', '1')] })),
            fetchChapter: vi.fn(async () => ({ data: { content: [] } })),
            extractText: vi.fn(),
            processChapterContent: vi.fn()
        });
        mocks.serviceRegistry = {
            getServiceByUrl: vi.fn(() => ranobeMock),
            createService: vi.fn(() => ranobeMock)
        };

        const dm = new DownloadManager();
        await dm.startDownload({ serviceKey: 'ranobelib', url: 'https://ranobelib.me/book/slug' });

        expect(mocks.fetchViaTab).toHaveBeenCalledWith('ranobe-cover', 'ranobelib', expect.any(Object));
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

    it('Fails with a clear error when the title has no chapters to download', async () => {
        serviceMock.fetchChaptersList = vi.fn(async () => ({}));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const dm = new DownloadManager();
        await expect(dm.startDownload({ serviceKey: 'mangalib', url: 'https://site/manga/slug' }))
            .rejects.toThrow('Нет глав для загрузки');
        expect(exporterMock.export).not.toHaveBeenCalled();
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

    it('Loads a chapter through the service pipeline with the download settings', async () => {
        const dm = new DownloadManager();
        const ds = dm._createDownloadState({ slug: 'slug', format: 'fb2', splitPages: true, fitFb2Images: true }, serviceMock);
        ds.mangaId = 42;
        const fetchBlocks = vi.spyOn(serviceMock, 'fetchChapterBlocks');
        const chapter = { id: 9, volume: '2', number: '5', branchId: 3, name: 'Пять' };
        const result = await dm._loadChapter(serviceMock, ds, chapter);
        expect(fetchBlocks).toHaveBeenCalledWith(chapter, {
            slug: 'slug', mangaId: 42, splitLongImages: true, imageFit: { maxWidth: 560, maxHeight: 740 }
        });
        expect(serviceMock.fetchChapter).toHaveBeenCalledWith('slug', '5', '2', 3);
        expect(result).toEqual({
            title: 'Пять', content: [{ type: 'text', text: 'ok' }], volume: '2', number: '5', key: '9'
        });
    });

    it('Does not split pages for the simple format or when splitting is off', async () => {
        const dm = new DownloadManager();
        const fetchBlocks = vi.spyOn(serviceMock, 'fetchChapterBlocks');
        for (const options of [{ format: 'simple', splitPages: true }, { format: 'fb2', splitPages: false }]) {
            const ds = dm._createDownloadState({ slug: 'slug', ...options }, serviceMock);
            await dm._loadChapter(serviceMock, ds, createChapter('1', '1'));
        }
        expect(fetchBlocks.mock.calls.map(call => call[1].splitLongImages)).toEqual([false, false]);
    });

    it('Turns a failed chapter into an error chapter with its title and key', async () => {
        const dm = new DownloadManager();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const service = asService({ fetchChapter: vi.fn(async () => { throw new Error('network error'); }) });
        const ds = { slug: 'slug', format: 'fb2' };
        const named = await dm._downloadChapterOrDefer(service, ds, { volume: '1', number: '7', name: 'Chapter 7' });
        expect(named).toEqual({
            title: 'Chapter 7',
            content: [{ type: 'text', text: '[Ошибка загрузки главы: network error]' }],
            volume: '1',
            number: '7',
            key: 'v1_ch7'
        });
        const unnamed = await dm._downloadChapterOrDefer(service, ds, { volume: '2', number: '5' });
        expect(unnamed.title).toBe('Том 2, Глава 5');
        errorSpy.mockRestore();
    });

    it('Pause logs when downloadId not found', () => {
        const dm = new DownloadManager();
        const logSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        dm.pause('not_found_id');
        expect(logSpy).toHaveBeenCalledWith('[DownloadManager] No active download with ID: not_found_id');
        logSpy.mockRestore();
    });

    it('Resume logs when downloadId not found', () => {
        const dm = new DownloadManager();
        const logSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        dm.resume('not_found_id');
        expect(logSpy).toHaveBeenCalledWith('[DownloadManager] No active download with ID: not_found_id');
        logSpy.mockRestore();
    });

    it('Stop logs when downloadId not found', () => {
        const dm = new DownloadManager();
        const logSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
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

    it('Shows the 429 wait in the status with the current progress of the download', async () => {
        const dm = new DownloadManager();
        const statusUpdates = [];
        const originalUpdateStatus = dm.updateStatus.bind(dm);
        dm.updateStatus = (id, msg, progress) => {
            statusUpdates.push({ id, msg, progress });
            originalUpdateStatus(id, msg, progress);
        };
        const service = asService({
            ...serviceMock,
            fetchChapter: vi.fn(async function () {
                this.ctx.on429(2000);
                return { data: { content: [{ type: 'text', text: 'ok' }] } };
            })
        });
        mocks.serviceRegistry.createService = vi.fn(() => service);

        const { downloadId } = await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });

        const waitingCall = statusUpdates.find(u => u.msg === 'Ожидание разрешения от сервера...');
        expect(waitingCall).toEqual({ id: downloadId, msg: 'Ожидание разрешения от сервера...', progress: 10 });
    });

    it('Reports page progress of a chapter as a download:pages event', async () => {
        const dm = new DownloadManager();
        const service = asService({
            ...serviceMock,
            processChapterContent: vi.fn(async function (content) {
                this._reportPages(1, 2, null);
                return content;
            })
        });
        mocks.serviceRegistry.createService = vi.fn(() => service);

        const { downloadId } = await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });

        expect(eventBusMock.emit).toHaveBeenCalledWith('download:pages', { id: downloadId, done: 1, total: 2 });
    });

    it('Passes no DOM element to processChapterContent', async () => {
        const dm = new DownloadManager();
        const ds = dm._createDownloadState({ slug: 'slug' }, serviceMock);
        await dm._loadChapter(serviceMock, ds, createChapter('1', '1'));
        expect(serviceMock.processChapterContent.mock.calls[0][1]).toBeNull();
        expect(globalThis.document.getElementById).not.toHaveBeenCalled();
    });

    it('Gives the download context its settings and a promise-based controller by default', async () => {
        const dm = new DownloadManager();
        const ds = dm._createDownloadState({ slug: 's', format: 'fb2', splitPages: false, fitFb2Images: true }, serviceMock);
        expect(ds.ctx.settings).toEqual({ splitPages: false, imageFit: { maxWidth: 560, maxHeight: 740 }, format: 'fb2' });
        expect(ds.ctx.controller).toBe(ds.controller);
        expect(ds.deferred).toBe(ds.ctx.deferred);

        ds.controller.pause();
        let resumed = false;
        const waiting = ds.controller.waitIfPaused().then(() => { resumed = true; });
        await Promise.resolve();
        expect(resumed).toBe(false);
        ds.controller.resume();
        await waiting;
        expect(resumed).toBe(true);
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

    it('Throws Unknown service when createService returns null', async () => {
        mocks.serviceRegistry.createService = vi.fn(() => null);
        const dm = new DownloadManager();
        await expect(dm.startDownload({ serviceKey: 'nonexistent' })).rejects.toThrow('Unknown service: nonexistent');
    });

    it('_fetchCoverBase64 returns empty string when fetchViaTab throws', async () => {
        const dm = new DownloadManager();
        mocks.fetchViaTab = vi.fn(async () => { throw new Error('Network error'); });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await dm._fetchCoverBase64(asService({ name: 'mangalib' }), 'https://cover.url');
        expect(result).toBe('');
        expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Failed to load cover:', expect.any(Error));
        warnSpy.mockRestore();
    });

    it('_resolveService gives the token to its own service instance', () => {
        const dm = new DownloadManager();
        const mockService = asService({ name: 'mangalib', config: { headers: {} } });
        mocks.serviceRegistry.createService = vi.fn(() => mockService);
        expect(dm._resolveService('mangalib', null, 'mytoken')).toBe(mockService);
        expect(mockService.config.headers['Authorization']).toBe('Bearer mytoken');
    });

    it('_createExporter skips plugin load when format is supported', async () => {
        const dm = new DownloadManager();
        mocks.PluginManager = { loadAll: vi.fn(async () => {}) };
        await dm._createExporter('fb2');
        expect(mocks.PluginManager.loadAll).not.toHaveBeenCalled();
        expect(mocks.ExporterRegistry.create).toHaveBeenCalledWith('fb2');
        delete mocks.PluginManager;
    });

    it('_createExporter loads plugins when format is not supported', async () => {
        const dm = new DownloadManager();
        mocks.PluginManager = { loadAll: vi.fn(async () => {}) };
        await dm._createExporter('myplugin');
        expect(mocks.PluginManager.loadAll).toHaveBeenCalled();
        expect(mocks.ExporterRegistry.create).toHaveBeenCalledWith('myplugin');
        delete mocks.PluginManager;
    });

    it('_fetchCoverBase64 returns empty string and warns when fetchViaTab returns ok=false', async () => {
        const dm = new DownloadManager();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mocks.fetchViaTab = vi.fn(async () => ({ ok: false, status: 404, noTab: false, error: 'HTTP 404' }));
        const result = await dm._fetchCoverBase64(asService({ name: 'mangalib' }), 'https://cover.url');
        expect(result).toBe('');
        expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Failed to load cover:', 'HTTP 404');
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
        mocks.fetchViaTab = vi.fn(async () => ({ ok: true, contentType: 'image/png', base64: 'orig' }));
        const compress = vi.fn(async () => ({ base64: 'small', contentType: 'image/jpeg' }));
        const prevCompressor = mocks.ImageCompressor;
        mocks.ImageCompressor = { compress };
        try {
            const fit = { maxWidth: 560, maxHeight: 740 };
            const result = await dm._fetchCoverBase64(asService({ name: 'ranobelib' }), 'https://cover.url', fit);
            expect(compress).toHaveBeenCalledWith('orig', 'image/png', fit);
            expect(result).toBe('data:image/jpeg;base64,small');
        } finally {
            mocks.ImageCompressor = prevCompressor;
        }
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
        expect(exported).toEqual([
            { manga: { name: 'M Том 1' }, chapters: [expect.objectContaining({ volume: '1' }), expect.objectContaining({ volume: '1' })], cover: '' },
            { manga: { name: 'M Том 2' }, chapters: [expect.objectContaining({ volume: '2' })], cover: '' }
        ]);
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

    it('downloadWithSizeLimit splits a volume by the number of chapters, ignoring the size', async () => {
        const dm = new DownloadManager();
        vi.spyOn(dm, 'saveFile').mockResolvedValue();
        vi.spyOn(dm, 'estimateChapterSize').mockReturnValue(60 * 1024 * 1024);
        const ctrl = dm.createController();
        const ds = { id: 'dl7', slug: 'slug', controller: ctrl, chapterContents: [], format: 'fb2', splitPages: true, mangaId: null };
        dm.activeDownloads.set('dl7', ds);
        const chapters = [createChapter('1', '1'), createChapter('1', '2'), createChapter('1', '3'),
            createChapter('1', '4'), createChapter('1', '5'), createChapter('2', '1')];

        await dm.downloadWithSizeLimit(ds, serviceMock, chapters, { name: 'M' }, '', 'fb2', 50, 2);

        expect(exported.map(file => [file.manga.name, file.chapters.map(ch => `${ch.volume}.${ch.number}`)])).toEqual([
            ['M Том 1', ['1.1', '1.2']],
            ['M Том 1 (Часть 2)', ['1.3', '1.4']],
            ['M Том 1 (Часть 3)', ['1.5']],
            ['M Том 2', ['2.1']]
        ]);
    });

    it('_exceedsPartLimit counts chapters when maxChapters is set and the estimated size otherwise', () => {
        const dm = new DownloadManager();
        const chapter = { content: [{ type: 'text', text: 'x'.repeat(512) }] };
        expect(dm._exceedsPartLimit([chapter], chapter, 1, 2)).toBe(false);
        expect(dm._exceedsPartLimit([chapter, chapter], chapter, Infinity, 2)).toBe(true);
        expect(dm._exceedsPartLimit([chapter], chapter, 2048, 0)).toBe(false);
        expect(dm._exceedsPartLimit([chapter], chapter, 2047, 0)).toBe(true);
    });

    it('A download is limited by size by default', () => {
        const dm = new DownloadManager();
        const ds = dm._createDownloadState({ slug: 'slug' }, serviceMock);
        expect([ds.maxSizeMB, ds.maxChapters]).toEqual([200, 0]);
        ds.ctx.dispose();
    });

    it('The 429 callback of the download context updates the status with the progress of the state', () => {
        const dm = new DownloadManager();
        const ds = dm._createDownloadState({ slug: 'slug' }, serviceMock);
        ds.progress = 42;
        const updateStatusSpy = vi.spyOn(dm, 'updateStatus');
        ds.ctx.on429(1000);
        expect(updateStatusSpy).toHaveBeenCalledWith(ds.id, 'Ожидание разрешения от сервера...', 42);
    });

    describe('keep-alive port', () => {
        it('returns null and does not throw when runtime.connect is unavailable', () => {
            const dm = new DownloadManager();
            mocks.extensionApi = { runtime: {} };
            expect(dm._startKeepAlive()).toBeNull();
            delete mocks.extensionApi;
        });

        it('connects through the shared extension api', () => {
            const dm = new DownloadManager();
            const connect = vi.fn(() => ({ postMessage: vi.fn(), disconnect: vi.fn(), onDisconnect: { addListener: vi.fn() } }));
            mocks.extensionApi = { runtime: { connect } };
            expect(dm._startKeepAlive()).not.toBeNull();
            expect(connect).toHaveBeenCalledWith({ name: 'downloadKeepAlive' });
            delete mocks.extensionApi;
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
            mocks.extensionApi = { runtime: { connect } };

            const keepAlive = dm._startKeepAlive();
            disconnectHandler();
            keepAlive.stopped = true;
            vi.advanceTimersByTime(2000);
            expect(connect).toHaveBeenCalledTimes(1);

            delete mocks.extensionApi;
            vi.useRealTimers();
        });

        it('pings the port on an interval and disconnects it on stop', () => {
            vi.useFakeTimers();
            const dm = new DownloadManager();
            const postMessage = vi.fn();
            const disconnect = vi.fn();
            const connect = vi.fn(() => ({ postMessage, disconnect, onDisconnect: { addListener: vi.fn() } }));
            mocks.extensionApi = { runtime: { connect } };

            const keepAlive = dm._startKeepAlive();
            expect(connect).toHaveBeenCalledWith({ name: 'downloadKeepAlive' });

            vi.advanceTimersByTime(20000);
            expect(postMessage).toHaveBeenCalledTimes(1);

            dm._stopKeepAlive(keepAlive);
            expect(disconnect).toHaveBeenCalled();

            vi.advanceTimersByTime(20000);
            expect(postMessage).toHaveBeenCalledTimes(1);

            delete mocks.extensionApi;
            vi.useRealTimers();
        });

        it('stops quietly when the port is already disconnected', () => {
            const dm = new DownloadManager();
            const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
            const gone = new Error('Attempting to use a disconnected port object');
            const port = { postMessage: vi.fn(), disconnect: vi.fn(() => { throw gone; }), onDisconnect: { addListener: vi.fn() } };
            mocks.extensionApi = { runtime: { connect: vi.fn(() => port) } };
            const keepAlive = dm._startKeepAlive();
            expect(() => dm._stopKeepAlive(keepAlive)).not.toThrow();
            expect(debug).toHaveBeenCalledWith('[DownloadManager] Keep-alive port is already disconnected:', gone);
            delete mocks.extensionApi;
        });

        it('stops pinging once postMessage starts throwing (port already gone)', () => {
            vi.useFakeTimers();
            const dm = new DownloadManager();
            const postMessage = vi.fn(() => { throw new Error('port closed'); });
            const connect = vi.fn(() => ({ postMessage, disconnect: vi.fn(), onDisconnect: { addListener: vi.fn() } }));
            mocks.extensionApi = { runtime: { connect } };

            dm._startKeepAlive();
            vi.advanceTimersByTime(20000);
            expect(postMessage).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(20000);
            expect(postMessage).toHaveBeenCalledTimes(1);

            delete mocks.extensionApi;
            vi.useRealTimers();
        });

        it('warns and returns a state without throwing when runtime.connect itself throws', () => {
            const dm = new DownloadManager();
            const connect = vi.fn(() => { throw new Error('connect failed'); });
            mocks.extensionApi = { runtime: { connect } };
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const keepAlive = dm._startKeepAlive();
            expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Failed to start keep-alive port:', 'connect failed');
            expect(() => dm._stopKeepAlive(keepAlive)).not.toThrow();

            warnSpy.mockRestore();
            delete mocks.extensionApi;
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
            mocks.extensionApi = { runtime: { connect } };

            dm._startKeepAlive();
            expect(connect).toHaveBeenCalledTimes(1);

            disconnectHandler();
            expect(connect).toHaveBeenCalledTimes(1);
            vi.advanceTimersByTime(2000);
            expect(connect).toHaveBeenCalledTimes(2);

            delete mocks.extensionApi;
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
            mocks.extensionApi = { runtime: { connect } };

            dm._startKeepAlive();
            disconnectHandlers[0]();
            disconnectHandlers[0]();
            disconnectHandlers[0]();
            expect(connect).toHaveBeenCalledTimes(1);

            delete mocks.extensionApi;
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
            mocks.extensionApi = { runtime: { connect } };

            const keepAlive = dm._startKeepAlive();
            dm._stopKeepAlive(keepAlive);
            disconnectHandler();
            vi.advanceTimersByTime(5000);
            expect(connect).toHaveBeenCalledTimes(1);

            delete mocks.extensionApi;
            vi.useRealTimers();
        });
    });

    describe('Images of a download', () => {
        it('Stop the download while a request waits for the rate limiter: the request is not sent', async () => {
            const dm = new DownloadManager();
            let stopped = false;
            const controller = { isPaused: () => false, shouldStop: () => stopped, stop: vi.fn(), waitIfPaused: async () => {} };
            let sent = false;
            mocks.fetchViaTab = vi.fn(async (url, key, { beforeSend }) => {
                stopped = true;
                await beforeSend();
                sent = true;
                return { ok: true, status: 200, noTab: false, base64: 'x', contentType: 'image/jpeg' };
            });
            const service = asService({
                ...serviceMock,
                fetchChapter: vi.fn(async function () {
                    await expect(this.fetchImage('url')).rejects.toMatchObject({ aborted: true });
                    return { data: { content: [] } };
                })
            });
            mocks.serviceRegistry.createService = vi.fn(() => service);
            await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', controller });
            expect(mocks.fetchViaTab).toHaveBeenCalledTimes(1);
            expect(sent).toBe(false);
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
            settings = DEFERRED_SETTINGS;
            saved = { ...settings };
            Object.assign(settings, {
                deferAfterMs: 20, backgroundAttemptTimeoutMs: 60, retryDelayMs: 5, maxAttempts: 3,
                maxDeferredChapters: 3, defaultImageBytes: 1000, defaultChapterBytes: 6000, pollIntervalMs: 5
            });
            warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        });

        afterEach(() => {
            Object.assign(settings, saved);
            delete mocks.RateLimitClient;
            vi.restoreAllMocks();
        });

        describe('DownloadManager', () => {
            const collectStatuses = () => {
                const statuses = [];
                eventBusMock.emit = vi.fn((event, data) => { if (event === 'download:progress') statuses.push(data.status); });
                return statuses;
            };
            const useService = overrides => {
                const service = asService({ ...serviceMock, ...overrides });
                mocks.serviceRegistry.createService = vi.fn(() => service);
                return service;
            };
            const exportedChapters = (call = 0) => exported[call].chapters;

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
                    processChapterContent: vi.fn(async function (c, s, opts) {
                        if (opts.chapterObj.number !== '1') return [image('N2')];
                        const slow = await this.loadImageOrDefer(2, async () => {
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
                expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[DeferredQueue\] Chapter "Том 1, Глава 1" not loaded within 0\.02 s/));
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

            it('starts the next volume only after the background loads of the previous one', async () => {
                const dm = new DownloadManager();
                const events = [];
                const statuses = collectStatuses();
                exporterMock.export = vi.fn(async (manga, chapters) => {
                    events.push(`save ${manga.name}`);
                    recordExport(manga, chapters);
                    return { blob: {}, filename: 'f' };
                });
                useService({
                    fetchChaptersList: vi.fn(async () => ({
                        data: [createChapter('1', '1'), createChapter('1', '2'), createChapter('2', '1')]
                    })),
                    fetchChapter: vi.fn(async (slug, number, volume) => {
                        events.push(`fetch vol ${volume} ch ${number}`);
                        return { data: { content: [] } };
                    }),
                    processChapterContent: vi.fn(async function (c, s, opts) {
                        const { volume, number } = opts.chapterObj;
                        if (volume !== '1' || number !== '1') return [image(`V${volume}.${number}`)];
                        return this.loadImageOrDefer(1, async () => {
                            await tick(40);
                            events.push('background image of vol 1 loaded');
                            return [image('V1.1')];
                        });
                    })
                });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
                expect(events.filter(e => !e.startsWith('save'))).toEqual([
                    'fetch vol 1 ch 1', 'fetch vol 1 ch 2', 'background image of vol 1 loaded', 'fetch vol 2 ch 1'
                ]);
                expect(events.filter(e => e.startsWith('save'))).toEqual(['save undefined Том 1', 'save undefined Том 2']);
                expect(exportedChapters(0).map(contentOf)).toEqual([['V1.1'], ['V1.2']]);
                expect(statuses).toContain('Дозагрузка в фоне: осталось 1...');
            });

            it('stop while waiting for the previous volume does not start the next one', async () => {
                const dm = new DownloadManager();
                const controller = dm.createController();
                eventBusMock.emit = vi.fn((event, data) => {
                    if (event === 'download:progress' && data.status.startsWith('Дозагрузка в фоне')) controller.stop();
                });
                const service = useService({
                    fetchChaptersList: vi.fn(async () => ({ data: [createChapter('1', '1'), createChapter('2', '1')] })),
                    processChapterContent: vi.fn(async (c, s, opts) =>
                        opts.chapterObj.volume === '1' ? [image('OK'), placeholder(2, never())] : [image('V2')])
                });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', controller });
                expect(service.fetchChapter.mock.calls.map(call => call[2])).toEqual(['1']);
                expect(exportedChapters().map(contentOf)).toEqual([['OK', '[Ошибка загрузки изображения 2]']]);
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
                expect(logSpy).toHaveBeenCalledWith('[DeferredQueue] Download stopped, cancelling 1 background load(s)');
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
                const ds = dm._createDownloadState({ slug: 'slug', controller }, serviceMock);
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
                mocks.fetchViaTab = vi.fn(never);
                useService({ fetchMangaMetadata: vi.fn(async () => ({ data: { cover: 'https://img.example.com/c.jpg' } })) });
                await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
                expect(exporterMock.export.mock.calls[0][2]).toBe('');
                expect(warnSpy).toHaveBeenCalledWith('[DownloadManager] Cover is still not loaded, saving without it');
            });

            it('uses the cover loaded in background for every saved file', async () => {
                const dm = new DownloadManager();
                mocks.fetchViaTab = vi.fn(async () => ({ ok: true, base64: 'CV', contentType: 'image/png' }));
                useService({
                    fetchMangaMetadata: vi.fn(async () => ({ data: { cover: 'https://img.example.com/c.jpg' } })),
                    fetchChaptersList: vi.fn(async () => ({ data: [createChapter('1', '1'), createChapter('2', '1')] }))
                });
                const res = await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' });
                expect(exporterMock.export.mock.calls.map(c => c[2])).toEqual(['data:image/png;base64,CV', 'data:image/png;base64,CV']);
                expect(mocks.fetchViaTab).toHaveBeenCalledTimes(1);
                expect(dm.activeDownloads.get(res.downloadId).coverBase64).toBe('data:image/png;base64,CV');
            });

            it('fails the download when saving a file fails', async () => {
                const dm = new DownloadManager();
                vi.spyOn(console, 'error').mockImplementation(() => {});
                exporterMock.export = vi.fn().mockRejectedValue(new Error('disk full'));
                useService({});
                await expect(dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2' })).rejects.toThrow('disk full');
            });

            it('stops the download when a file cannot be saved and exports nothing after it', async () => {
                const dm = new DownloadManager();
                vi.spyOn(console, 'error').mockImplementation(() => {});
                const controller = dm.createController();
                const saveFailed = deferred();
                exporterMock.export = vi.fn(async () => {
                    saveFailed.resolve();
                    throw new Error('disk full');
                });
                const service = useService({
                    fetchChaptersList: vi.fn(async () => ({
                        data: [createChapter('1', '1'), createChapter('2', '1'), createChapter('3', '1'), createChapter('4', '1')]
                    })),
                    fetchChapter: vi.fn(async (slug, number, volume) => {
                        if (volume === '2') {
                            await saveFailed.promise;
                            await tick();
                        }
                        return { data: { content: [{ type: 'text', text: 'ok' }] } };
                    })
                });
                await expect(dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', controller }))
                    .rejects.toThrow('disk full');
                expect(exporterMock.export).toHaveBeenCalledTimes(1);
                expect(service.fetchChapter.mock.calls.map(call => call[2])).toEqual(['1', '2']);
                expect(controller.shouldStop()).toBe(true);
                expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stopping the download'),
                    expect.objectContaining({ message: 'disk full' }));
            });

            it('splits files by maxChapters passed to startDownload', async () => {
                const dm = new DownloadManager();
                useService({});
                const res = await dm.startDownload({ slug: 'slug', serviceKey: 'mangalib', format: 'fb2', maxChapters: 1 });
                expect(exported.map(file => file.chapters.length)).toEqual([1, 1]);
                expect(exported[1].manga.name).toMatch(/ Том 1 \(Часть 2\)$/);
                expect(dm.activeDownloads.get(res.downloadId).maxChapters).toBe(1);
            });

            it('waits for the background loads of the given chapters only, reporting each remaining count once', async () => {
                const dm = new DownloadManager();
                const statuses = collectStatuses();
                const ds = dm._createDownloadState({ slug: 'slug' }, serviceMock);
                dm.activeDownloads.set(ds.id, ds);
                const first = deferred();
                const second = deferred();
                const chapter = { content: [placeholder(1, first.promise), placeholder(2, second.promise)] };
                const other = { content: [placeholder(3, never())] };
                ds.deferred.observe(chapter);
                ds.deferred.observe(other);

                let settled = false;
                const waiting = dm._waitForDeferred(ds, [chapter], { report: true, progress: 50 }).then(() => { settled = true; });
                first.resolve([image('A')]);
                await tick();
                expect(settled).toBe(false);
                second.resolve([image('B')]);
                await waiting;
                expect(contentOf(chapter)).toEqual(['A', 'B']);
                expect(statuses).toEqual(['Дозагрузка в фоне: осталось 2...', 'Дозагрузка в фоне: осталось 1...']);
                expect(ds.deferred.size).toBe(1);
                ds.ctx.dispose();
            });

            it('stops waiting for background loads as soon as the download is stopped', async () => {
                const dm = new DownloadManager();
                const ds = dm._createDownloadState({ slug: 'slug' }, serviceMock);
                const chapter = { content: [placeholder(1, never())] };
                ds.deferred.observe(chapter);
                const waiting = dm._waitForDeferred(ds, null);
                await tick();
                ds.controller.stop();
                await waiting;
                expect(contentOf(chapter)).toEqual(['[Ошибка загрузки изображения 1]']);
                expect(ds.deferred.size).toBe(0);
            });
        });
    });
});
