import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetchChapter = vi.fn();
const mockExtractText = vi.fn((c) => c);
const mockProcessChapterContent = vi.fn((c) => c);
const mockExportFn = vi.fn();

globalThis.MangaLibService = class {
    fetchChapter = mockFetchChapter;
    extractText = mockExtractText;
    processChapterContent = mockProcessChapterContent;
};

globalThis.RanobeLibService = class {
    fetchChapter = mockFetchChapter;
    extractText = mockExtractText;
    processChapterContent = mockProcessChapterContent;
};

globalThis.ExporterFactory = {
    create: vi.fn(() => ({ export: mockExportFn })),
};

delete globalThis.getExtensionApi;

globalThis.browser = {
    downloads: {
        download: vi.fn().mockResolvedValue(42),
    },
};

globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
globalThis.URL.revokeObjectURL = vi.fn();

vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

const { BackgroundDownload } = await import('../../background/BackgroundDownload.js');

describe('BackgroundDownload', () => {
    let bg;

    beforeEach(() => {
        bg = new BackgroundDownload();
        vi.clearAllMocks();
    });

    it('Initializes active downloads as empty map', () => {
        expect(bg.activeDownloads).toBeInstanceOf(Map);
        expect(bg.activeDownloads.size).toBe(0);
    });

    it('Initializes download ID counter to 0', () => {
        expect(bg.downloadIdCounter).toBe(0);
    });

    it('Returns object with expected API', () => {
        const c = bg.createController();
        expect(c).toHaveProperty('pause');
        expect(c).toHaveProperty('resume');
        expect(c).toHaveProperty('stop');
        expect(c).toHaveProperty('isPaused');
        expect(c).toHaveProperty('shouldStop');
        expect(c).toHaveProperty('waitIfPaused');
    });

    it('Is not paused and not stopped by default', () => {
        const c = bg.createController();
        expect(c.isPaused()).toBe(false);
        expect(c.shouldStop()).toBe(false);
    });

    it('Pause/resume toggle', () => {
        const c = bg.createController();
        c.pause();
        expect(c.isPaused()).toBe(true);
        c.resume();
        expect(c.isPaused()).toBe(false);
    });

    it('Stop sets to true', () => {
        const c = bg.createController();
        c.stop();
        expect(c.shouldStop()).toBe(true);
    });

    it('Resolves immediately when not paused', async () => {
        const c = bg.createController();
        await expect(c.waitIfPaused()).resolves.toBeUndefined();
    });

    it('Blocks while paused and resolves on resume', async () => {
        const c = bg.createController();
        c.pause();

        let resolved = false;
        const p = c.waitIfPaused().then(() => { resolved = true; });

        await new Promise((r) => setTimeout(r, 60));
        expect(resolved).toBe(false);

        c.resume();
        await p;
        expect(resolved).toBe(true);
    });

    it('Resolves when stopped while paused', async () => {
        const c = bg.createController();
        c.pause();

        let resolved = false;
        const p = c.waitIfPaused().then(() => { resolved = true; });

        await new Promise((r) => setTimeout(r, 60));
        expect(resolved).toBe(false);

        c.stop();
        await p;
        expect(resolved).toBe(true);
    });

    it('Resolves after given ms', async () => {
        vi.useFakeTimers();
        const p = bg.delay(500);
        vi.advanceTimersByTime(500);
        await expect(p).resolves.toBeUndefined();
        vi.useRealTimers();
    });

    const baseOpts = () => ({
        slug: 'my-manga',
        serviceKey: 'mangalib',
        format: 'epub',
        chapters: [],
        manga: { title: 'My Manga' },
        coverBase64: 'abc',
        chapterContents: [{ title: 'cached' }],
        currentChapterIndex: 3,
        currentStatus: 'Custom status',
        currentProgress: 55,
        loadedFile: { name: 'f' },
    });

    it('Returns an object with downloadId string', async () => {
        const res = await bg.takeOverDownload(baseOpts());
        expect(res).toHaveProperty('downloadId');
        expect(typeof res.downloadId).toBe('string');
        expect(res.downloadId).toMatch(/^bg_\d+_\d+$/);
    });

    it('Increments download ID counter', async () => {
        await bg.takeOverDownload(baseOpts());
        expect(bg.downloadIdCounter).toBe(1);
        await bg.takeOverDownload(baseOpts());
        expect(bg.downloadIdCounter).toBe(2);
    });

    it('Stores download', async () => {
        const res = await bg.takeOverDownload(baseOpts());
        expect(bg.activeDownloads.has(res.downloadId)).toBe(true);
    });

    it('Maps all provided options into stored download', async () => {
        // Prevent continueDownload from mutating the download state
        const spy = vi.spyOn(bg, 'continueDownload').mockResolvedValue();
        const opts = baseOpts();
        const res = await bg.takeOverDownload(opts);
        const d = bg.activeDownloads.get(res.downloadId);

        expect(d.slug).toBe('my-manga');
        expect(d.serviceKey).toBe('mangalib');
        expect(d.format).toBe('epub');
        expect(d.status).toBe('Custom status');
        expect(d.progress).toBe(55);
        expect(d.manga).toEqual({ title: 'My Manga' });
        expect(d.coverBase64).toBe('abc');
        expect(d.chapterContents).toEqual([{ title: 'cached' }]);
        expect(d.currentChapterIndex).toBe(3);
        expect(d.loadedFile).toEqual({ name: 'f' });
        spy.mockRestore();
    });

    it('Uses defaults when optional fields are omitted', async () => {
        const spy = vi.spyOn(bg, 'continueDownload').mockResolvedValue();
        const res = await bg.takeOverDownload({
            slug: 's',
            serviceKey: 'mangalib',
            format: 'fb2',
            chapters: [],
            manga: {},
        });
        const d = bg.activeDownloads.get(res.downloadId);

        expect(d.status).toBe('Продолжение загрузки...');
        expect(d.progress).toBe(0);
        expect(d.chapterContents).toEqual([]);
        expect(d.currentChapterIndex).toBe(0);
        expect(d.loadedFile).toBeUndefined();
        spy.mockRestore();
    });

    it('Catches download errors and marks download as failed', async () => {
        const res = await bg.takeOverDownload({
            slug: 's',
            serviceKey: 'UNKNOWN',
            format: 'epub',
            chapters: [{ number: '1', volume: '1' }],
            manga: {},
        });

        await new Promise((r) => setTimeout(r, 100));

        const d = bg.activeDownloads.get(res.downloadId);
        expect(d.status).toBe('failed');
        expect(d.error).toContain('Unknown service');
    });

    it('Returns empty array when nothing active', () => {
        expect(bg.getActiveDownloads()).toEqual([]);
    });

    it('Returns summary of each active download', async () => {
        bg.activeDownloads.set('d1', {
            id: 'd1', slug: 'a', serviceKey: 'mangalib',
            format: 'epub', status: 'ok', progress: 50,
            error: undefined, controller: bg.createController(),
        });
        bg.activeDownloads.set('d2', {
            id: 'd2', slug: 'b', serviceKey: 'ranobelib',
            format: 'fb2', status: 'err', progress: 10,
            error: 'fail', controller: bg.createController(),
        });

        const list = bg.getActiveDownloads();
        expect(list).toHaveLength(2);

        expect(list[0]).toEqual({
            id: 'd1', slug: 'a', serviceKey: 'mangalib',
            format: 'epub', status: 'ok', progress: 50,
            error: undefined,
        });
        expect(list[1]).toEqual({
            id: 'd2', slug: 'b', serviceKey: 'ranobelib',
            format: 'fb2', status: 'err', progress: 10,
            error: 'fail',
        });
    });

    it('Does not expose internal fields', async () => {
        bg.activeDownloads.set('d1', {
            id: 'd1', slug: 'a', serviceKey: 'mangalib',
            format: 'epub', status: 'ok', progress: 0,
            controller: bg.createController(),
            manga: {}, chapterContents: [], chapters: [],
            coverBase64: 'x', loadedFile: null,
        });

        const item = bg.getActiveDownloads()[0];
        expect(item).not.toHaveProperty('controller');
        expect(item).not.toHaveProperty('manga');
        expect(item).not.toHaveProperty('chapterContents');
        expect(item).not.toHaveProperty('chapters');
        expect(item).not.toHaveProperty('coverBase64');
        expect(item).not.toHaveProperty('loadedFile');
    });

    it('Pauses existing download controller', () => {
        const ctrl = bg.createController();
        bg.activeDownloads.set('x', { controller: ctrl });
        bg.pause('x');
        expect(ctrl.isPaused()).toBe(true);
    });

    it('Does nothing for unknown id', () => {
        expect(() => bg.pause('nope')).not.toThrow();
    });

    it('Resumes paused controller', () => {
        const ctrl = bg.createController();
        ctrl.pause();
        bg.activeDownloads.set('x', { controller: ctrl });
        bg.resume('x');
        expect(ctrl.isPaused()).toBe(false);
    });

    it('Does nothing for unknown id', () => {
        expect(() => bg.resume('nope')).not.toThrow();
    });

    it('Stops controller and sets status', () => {
        const ctrl = bg.createController();
        const d = { controller: ctrl, status: 'running' };
        bg.activeDownloads.set('x', d);
        bg.stop('x');
        expect(ctrl.shouldStop()).toBe(true);
        expect(d.status).toBe('Остановлено');
    });

    it('Does nothing for unknown id', () => {
        expect(() => bg.stop('nope')).not.toThrow();
    });

    const makeDownload = (overrides = {}) => ({
        id: 'test-dl',
        slug: 'test-slug',
        serviceKey: 'mangalib',
        format: 'epub',
        status: '',
        progress: 0,
        startTime: Date.now(),
        controller: bg.createController(),
        manga: { title: 'M' },
        coverBase64: 'cover',
        chapterContents: [],
        chapters: [
            { name: 'Ch 1', number: '1', volume: '1' },
            { name: 'Ch 2', number: '2', volume: '1' },
        ],
        currentChapterIndex: 0,
        loadedFile: null,
        ...overrides,
    });

    beforeEach(() => {
        mockFetchChapter.mockResolvedValue({ data: { content: 'html' } });
        mockExtractText.mockReturnValue('text');
        mockProcessChapterContent.mockResolvedValue([{ type: 'text', text: 'p' }]);
        mockExportFn.mockResolvedValue({
            filename: 'out.epub',
            blob: new Blob(['data']),
        });
        globalThis.browser.downloads.download.mockResolvedValue(42);
        // Stub delay so continueDownload doesn't wait 500ms per chapter
        vi.spyOn(bg, 'delay').mockResolvedValue();
    });

    it('Throws for unknown serviceKey', async () => {
        const d = makeDownload({ serviceKey: 'nope' });
        await expect(bg.continueDownload(d)).rejects.toThrow('Unknown service: nope');
        expect(d.status).toContain('Ошибка');
        expect(d.error).toContain('Unknown service');
    });

    it('Creates MangaLibService for serviceKey mangalib', async () => {
        const d = makeDownload({ serviceKey: 'mangalib' });
        await bg.continueDownload(d);
        expect(d.status).toBe('Готово!');
    });

    it('Creates RanobeLibService for serviceKey ranobelib', async () => {
        const d = makeDownload({ serviceKey: 'ranobelib' });
        await bg.continueDownload(d);
        expect(d.status).toBe('Готово!');
    });

    it('Fetches every chapter with correct args', async () => {
        const d = makeDownload();
        await bg.continueDownload(d);

        expect(mockFetchChapter).toHaveBeenCalledTimes(2);
        expect(mockFetchChapter).toHaveBeenCalledWith('test-slug', '1', '1');
        expect(mockFetchChapter).toHaveBeenCalledWith('test-slug', '2', '1');
    });

    it('Defaults volume to "1" when chapter has no volume', async () => {
        const d = makeDownload({
            chapters: [{ name: 'X', number: '5' }],
        });
        await bg.continueDownload(d);
        expect(mockFetchChapter).toHaveBeenCalledWith('test-slug', '5', '1');
    });

    it('Pushes processed content into chapterContents', async () => {
        const d = makeDownload({
            chapters: [{ name: 'A', number: '1', volume: '2' }],
        });
        await bg.continueDownload(d);

        expect(d.chapterContents).toHaveLength(1);
        expect(d.chapterContents[0]).toEqual({
            title: 'A',
            content: [{ type: 'text', text: 'p' }],
            volume: '2',
            number: '1',
        });
    });

    it('Uses fallback title when chapter name is missing', async () => {
        const d = makeDownload({
            chapters: [{ number: '7', volume: '3' }],
        });
        await bg.continueDownload(d);
        expect(d.chapterContents[0].title).toBe('Том 3, Глава 7');
    });

    it('Updates progress during download', async () => {
        const progressValues = [];
        mockFetchChapter.mockImplementation(async () => {
            progressValues.push(bg.activeDownloads.get('test-dl')?.progress);
            return { data: { content: 'c' } };
        });

        const d = makeDownload();
        bg.activeDownloads.set('test-dl', d);
        await bg.continueDownload(d);

        expect(progressValues.length).toBe(2);
        expect(progressValues[1]).toBeGreaterThanOrEqual(progressValues[0]);
    });

    it('Updates status to show current chapter', async () => {
        const statusValues = [];
        const d = makeDownload();
        mockFetchChapter.mockImplementation(async () => {
            statusValues.push(d.status);
            return { data: { content: 'c' } };
        });

        await bg.continueDownload(d);

        expect(statusValues[0]).toBe('Глава 1/2: Ch 1');
        expect(statusValues[1]).toBe('Глава 2/2: Ch 2');
    });

    it('Calls extractText and processChapterContent', async () => {
        const d = makeDownload({
            chapters: [{ name: 'C', number: '1', volume: '1' }],
        });
        await bg.continueDownload(d);

        expect(mockExtractText).toHaveBeenCalledWith('html');
        expect(mockProcessChapterContent).toHaveBeenCalledWith(
            'text',
            null,
            expect.objectContaining({
                chapterObj: expect.objectContaining({ number: '1' }),
                mangaSlug: 'test-slug',
            }),
        );
    });

    it('Handles fetchChapter response without data wrapper', async () => {
        mockFetchChapter.mockResolvedValue({ content: 'direct' });

        const d = makeDownload({
            chapters: [{ name: 'D', number: '1', volume: '1' }],
        });
        await bg.continueDownload(d);

        expect(mockExtractText).toHaveBeenCalledWith('direct');
    });

    it('Handles fetchChapter response with raw content', async () => {
        mockFetchChapter.mockResolvedValue('raw-string');

        const d = makeDownload({
            chapters: [{ name: 'R', number: '1', volume: '1' }],
        });
        await bg.continueDownload(d);

        expect(mockExtractText).toHaveBeenCalledWith('raw-string');
    });

    it('Catches per-chapter errors and adds error content', async () => {
        mockFetchChapter
            .mockRejectedValueOnce(new Error('net fail'))
            .mockResolvedValueOnce({ data: { content: 'ok' } });

        const d = makeDownload();
        await bg.continueDownload(d);

        expect(d.chapterContents).toHaveLength(2);
        expect(d.chapterContents[0].content[0].text).toContain('Ошибка загрузки главы');
        expect(d.chapterContents[0].content[0].text).toContain('net fail');
        expect(d.chapterContents[1].content).toEqual([{ type: 'text', text: 'p' }]);
    });

    it('Resumes from currentChapterIndex', async () => {
        const d = makeDownload({ currentChapterIndex: 1 });
        await bg.continueDownload(d);

        expect(mockFetchChapter).toHaveBeenCalledTimes(1);
        expect(mockFetchChapter).toHaveBeenCalledWith('test-slug', '2', '1');
    });

    it('Stops when controller is stopped before loop', async () => {
        const d = makeDownload();
        d.controller.stop();
        await bg.continueDownload(d);

        expect(d.status).toBe('Остановлено');
        expect(mockFetchChapter).not.toHaveBeenCalled();
    });

    it('Stops when controller is stopped mid-loop', async () => {
        const d = makeDownload();
        mockFetchChapter.mockImplementation(async () => {
            d.controller.stop();
            return { data: { content: 'c' } };
        });

        await bg.continueDownload(d);

        expect(d.chapterContents).toHaveLength(1);
        expect(d.status).toBe('Остановлено');
    });

    it('Creates exporter via ExporterFactory', async () => {
        const d = makeDownload();
        await bg.continueDownload(d);

        expect(globalThis.ExporterFactory.create).toHaveBeenCalledWith('epub');
        expect(mockExportFn).toHaveBeenCalledWith(
            { title: 'M' },
            d.chapterContents,
            'cover',
        );
    });

    it('Calls browser.downloads.download with correct params', async () => {
        const d = makeDownload();
        await bg.continueDownload(d);

        expect(globalThis.browser.downloads.download).toHaveBeenCalledWith({
            url: 'blob:mock',
            filename: 'out.epub',
            saveAs: false,
        });
    });

    it('Sets final status and progress on success', async () => {
        const d = makeDownload();
        await bg.continueDownload(d);

        expect(d.status).toBe('Готово!');
        expect(d.progress).toBe(100);
        expect(d.downloadItemId).toBe(42);
    });

    it('Schedules cleanup with URL.revokeObjectURL and map removal', async () => {
        vi.useFakeTimers();

        const d = makeDownload();
        bg.activeDownloads.set('test-dl', d);
        await bg.continueDownload(d);

        expect(bg.activeDownloads.has('test-dl')).toBe(true);
        expect(globalThis.URL.revokeObjectURL).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(10000);

        expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock');
        expect(bg.activeDownloads.has('test-dl')).toBe(false);

        vi.useRealTimers();
    });

    it('Handles export error', async () => {
        mockExportFn.mockRejectedValueOnce(new Error('export boom'));

        const d = makeDownload();
        await expect(bg.continueDownload(d)).rejects.toThrow('export boom');

        expect(d.status).toBe('Ошибка: export boom');
        expect(d.error).toBe('export boom');
    });

    it('Handles browser.downloads.download error', async () => {
        globalThis.browser.downloads.download.mockRejectedValueOnce(
            new Error('download api error'),
        );

        const d = makeDownload();
        await expect(bg.continueDownload(d)).rejects.toThrow('download api error');
        expect(d.status).toContain('Ошибка');
    });

    it('Works with zero chapters', async () => {
        const d = makeDownload({ chapters: [] });
        await bg.continueDownload(d);

        expect(mockFetchChapter).not.toHaveBeenCalled();
        expect(d.status).toBe('Готово!');
    });

    it('Passes file loader into processChapterContent', async () => {
        const loaded = { name: 'archive.zip' };
        const d = makeDownload({
            chapters: [{ name: 'C', number: '1', volume: '1' }],
            loadedFile: loaded,
        });
        await bg.continueDownload(d);

        expect(mockProcessChapterContent).toHaveBeenCalledWith(
            'text',
            loaded,
            expect.any(Object),
        );
    });

    it('Passes chapter meta from raw response', async () => {
        const rawData = { content: 'html', extraField: 42 };
        mockFetchChapter.mockResolvedValue({ data: rawData });

        const d = makeDownload({
            chapters: [{ name: 'C', number: '1', volume: '1' }],
        });
        await bg.continueDownload(d);

        expect(mockProcessChapterContent).toHaveBeenCalledWith(
            'text',
            null,
            expect.objectContaining({
                chapterMeta: rawData,
            }),
        );
    });

    it('Uses chapter name for status display', async () => {
        const statuses = [];
        const d = makeDownload({
            chapters: [
                { name: 'Named', number: '1', volume: '1' },
                { number: '2', volume: '1' },
            ],
        });
        mockFetchChapter.mockImplementation(async () => {
            statuses.push(d.status);
            return { data: { content: 'c' } };
        });

        await bg.continueDownload(d);

        expect(statuses[0]).toContain('Named');
        expect(statuses[1]).toContain('2');
    });

    it('Sets creating-file status before export', async () => {
        let statusBeforeExport;
        const d = makeDownload({
            chapters: [],
            format: 'fb2',
        });
        mockExportFn.mockImplementation(async () => {
            statusBeforeExport = d.status;
            return { filename: 'f.epub', blob: new Blob([]) };
        });

        await bg.continueDownload(d);

        expect(statusBeforeExport).toBe('Создание FB2...');
    });

    it('Progress is 95 before export', async () => {
        let progressBeforeExport;
        const d = makeDownload({ chapters: [] });
        mockExportFn.mockImplementation(async () => {
            progressBeforeExport = d.progress;
            return { filename: 'f.epub', blob: new Blob([]) };
        });

        await bg.continueDownload(d);

        expect(progressBeforeExport).toBe(95);
    });

    it('Preserves and appends existing chapterContents', async () => {
        const existing = [{ title: 'Prev', content: 'old', volume: '1', number: '0' }];
        const d = makeDownload({
            chapterContents: existing,
            chapters: [{ name: 'New', number: '1', volume: '1' }],
        });
        await bg.continueDownload(d);

        expect(d.chapterContents).toHaveLength(2);
        expect(d.chapterContents[0].title).toBe('Prev');
        expect(d.chapterContents[1].title).toBe('New');
    });

    it('Handles chapterData with no content field', async () => {
        const bg = new BackgroundDownload();
        const d = {
            id: 'test-dl',
            slug: 'slug',
            serviceKey: 'mangalib',
            format: 'epub',
            status: '',
            progress: 0,
            startTime: Date.now(),
            controller: bg.createController(),
            manga: {},
            coverBase64: '',
            chapterContents: [],
            chapters: [{ name: 'Ch', number: '1', volume: '1' }],
            currentChapterIndex: 0,
            loadedFile: null,
        };
        mockFetchChapter.mockResolvedValue({ data: { foo: 'bar' } });

        const origMangaLibService = globalThis.MangaLibService;
        globalThis.MangaLibService = class {
            fetchChapter = mockFetchChapter;
        };

        await bg.continueDownload(d);

        expect(d.chapterContents[0].content).toEqual({ foo: 'bar' });

        globalThis.MangaLibService = origMangaLibService;
    });

    it('Uses fallback title in catch when chapter name is missing', async () => {
        const d = {
            id: 'test-dl',
            slug: 'slug',
            serviceKey: 'mangalib',
            format: 'epub',
            status: '',
            progress: 0,
            startTime: Date.now(),
            controller: bg.createController(),
            manga: {},
            coverBase64: '',
            chapterContents: [],
            chapters: [{ number: '4', volume: '2' }],
            currentChapterIndex: 0,
            loadedFile: null,
        };
        mockFetchChapter.mockRejectedValueOnce(new Error('fail'));
        await bg.continueDownload(d);
        expect(d.chapterContents[0].title).toBe('Том 2, Глава 4');
        expect(d.chapterContents[0].content[0].text).toContain('fail');
    });
});