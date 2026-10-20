import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { withServiceFactory } from '../helpers/ServiceRegistryMock.js';

const mocks = vi.hoisted(() => ({}));

vi.mock('../../core/AuthManager.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'AuthManager'));
vi.mock('../../core/BrowserApi.js', async () => (await import('../helpers/ModuleMock.js'))
    .mockExports(mocks, 'extensionApi', 'browserEnv'));
vi.mock('../../core/TabNetwork.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'fetchViaTab', 'setServiceTab'));
vi.mock('../../core/DownloadHistory.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'DownloadHistory'));
vi.mock('../../core/DownloadManager.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'DownloadManager'));
vi.mock('../../core/PluginManager.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'PluginManager'));
vi.mock('../../exporters/ExporterRegistry.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'ExporterRegistry'));
vi.mock('../../services/mangalib/MangaLibService.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'MangaLibService'));
vi.mock('../../services/ranobelib/RanobeLibService.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'RanobeLibService'));
vi.mock('../../services/ServiceRegistry.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'serviceRegistry'));
vi.mock('../../ui/ChapterController.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'ChapterController'));
vi.mock('../../ui/HistoryController.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'HistoryController'));
vi.mock('../../ui/SettingsController.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'SettingsController'));
vi.mock('../../ui/TemplateLoader.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'TemplateLoader'));

let PopupController;
let controller;

function setupDOM() {
    document.body.innerHTML = `
        <img id="siteLogo" />
        <div id="logoInfo"></div>
        <div id="activeDownloadsInfo"></div>
        <div id="error" class="hidden"></div>
        <div id="success" class="hidden"></div>
        <div id="view">
            <img id="cover" />
            <div id="description"></div>
            <div id="releaseDate"></div>
            <div id="translatorContainer" style="display:none;">
                <select id="translatorSelect"></select>
            </div>
            <div id="chapterRangeContainer" style="display:none;">
                <div id="chapterLabelsRow">
                    <div id="chapterFromLabel">от</div>
                    <div id="chapterToLabel">до</div>
                </div>
                <div id="chapterSelectRow">
                    <select id="chapterFromSelect"></select>
                    <select id="chapterToSelect"></select>
                </div>
            </div>
            <div id="splitPagesContainer" style="display:none">
                <input type="checkbox" id="splitPagesCheckbox">
            </div>
            <div id="splitModeContainer">
                <input id="maxSizeInput" type="number" value="200">
            </div>
            <div id="rateLimitContainer">
                <input id="rateLimitInput" type="number" value="85">
            </div>
            <div id="formatContainer">
                <select id="formatSelector"></select>
            </div>
            <div id="downloadInfoPanel" style="display:none;"></div>
            <button id="downloadBtn"></button>
            <div id="status"></div>
            <progress id="progress"></progress>
            <div id="downloadControls" style="display:none;">
                <div id="btnRow"><button id="pauseBtn">Пауза</button></div>
                <button id="stopBtn">Завершить</button>
            </div>
        </div>
    `;
}

let intervals = [];

beforeEach(async () => {
    vi.resetModules();
    
    intervals = [];
    const originalSetInterval = global.setInterval;
    global.setInterval = vi.fn((fn, ms) => {
        const id = originalSetInterval(() => {
            typeof document !== 'undefined' && document && document.getElementById && fn();
        }, ms);
        intervals.push(id);
        return id;
    });
    
    setupDOM();
    
    global.localStorage = {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn()
    };
    mocks.DownloadManager = class {
        constructor() { this.eventBus = { on: vi.fn() }; }
        startDownload = vi.fn(async () => ({ success: true, downloadId: 'id' }));
        stop = vi.fn();
        getDownloadState = vi.fn(() => ({ id: 1, status: 'active', progress: 50, slug: 'slug' }));
    };
    mocks.serviceRegistry = withServiceFactory({
        getServiceByUrl: vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        })),
        getService: vi.fn(() => null),
    }, mocks);
    mocks.RanobeLibService = class {
        getManga = vi.fn(async () => ({ rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }));
        getChapterList = vi.fn(async () => [{}, {}]);
    };
    mocks.MangaLibService = class {
        getManga = vi.fn(async () => ({ rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }));
        getChapterList = vi.fn(async () => [{}, {}]);
    };
    mocks.extensionApi = {
        runtime: {
            sendMessage: vi.fn(async () => ({ ok: true, downloads: [{ slug: 'slug', status: 'active', progress: 50 }] })),
            getURL: vi.fn(() => 'popup.html')
        },
        windows: {
            getCurrent: vi.fn(async () => ({ type: 'popup' })),
            create: vi.fn(async () => ({ id: 1 })),
            update: vi.fn(async () => {})
        },
        tabs: {
            query: vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]))
        }
    };
    global.chrome = undefined;
    global.window.close = vi.fn();
    mocks.ExporterRegistry = {
        getFormats: vi.fn(() => [
            { value: 'fb2', label: 'FB2' },
            { value: 'epub', label: 'EPUB' },
            { value: 'pdf', label: 'PDF' },
            { value: 'mobi', label: 'MOBI' },
            { value: 'simple', label: 'TXT/JPEG' },
        ]),
    };
    mocks.DownloadHistory = { add: vi.fn(), getAll: vi.fn(() => []), clear: vi.fn() };
    mocks.AuthManager = { getToken: vi.fn(async () => null), apply: vi.fn(async () => null) };
    mocks.ChapterController = class {
        constructor() { this._allChapters = []; }
        loadAndPopulate = vi.fn(async () => 2);
        getChapters = vi.fn(() => this._allChapters);
        getFilteredChapters = vi.fn(() => []);
        repopulateSelects = vi.fn();
    };
    mocks.TemplateLoader = {
        init: vi.fn(),
        show: vi.fn(async () => {}),
        current: vi.fn(() => null)
    };
    mocks.HistoryController = { init: vi.fn() };
    mocks.fetchViaTab = vi.fn(async () => ({ ok: false, status: 0, noTab: true }));
    mocks.setServiceTab = vi.fn();
    mocks.browserEnv = { isFirefox: true };
    mocks.PluginManager = { loadAll: vi.fn(async () => {}) };
    mocks.SettingsController = { init: vi.fn() };

    ({ PopupController } = await import('../../ui/PopupController.js'));
});

afterEach(() => {
    intervals.forEach(id => clearInterval(id));
    intervals = [];
    if (controller) controller = null;
    vi.clearAllTimers();
});

// Окно загрузки (?download=true) запускает скачивание через 500 мс: даём таймерам
// последних тестов сработать, пока окружение jsdom ещё не разобрано.
afterAll(() => new Promise(resolve => setTimeout(resolve, 600)));

describe('PopupController', () => {
    it('Initializes and sets up UI', () => {
        const controller = new PopupController();
        expect(controller.downloadManager).toBeDefined();
        expect(document.getElementById('downloadBtn')).toBeDefined();
    });

    it('Creates missing elements', () => {
        document.body.innerHTML = `<button id="downloadBtn"></button>`;
        const controller = new PopupController();
        expect(document.getElementById('formatSelector')).toBeDefined();
        expect(document.getElementById('rateLimitInput')).toBeDefined();
        expect(document.getElementById('activeDownloadsInfo')).toBeDefined();
        expect(document.getElementById('downloadControls')).toBeDefined();
    });

    it('Returns truncated text', () => {
        const controller = new PopupController();
        const txt = controller.truncateText('a'.repeat(200), 10);
        expect(txt.endsWith('...')).toBe(true);
    });

    it('Displays error', () => {
        const controller = new PopupController();
        controller.showError('fail');
        expect(document.getElementById('error').textContent).toBe('fail');
    });

    it('Shows success message', () => {
        const controller = new PopupController();
        controller.showSuccess('ok');
        expect(document.getElementById('success').textContent).toBe('ok');
    });

    it('Resets UI state', () => {
        const controller = new PopupController();
        controller.isDownloading = true;
        controller.isPaused = true;
        controller.shouldStop = true;
        controller.resetUI();
        expect(controller.isDownloading).toBe(false);
        expect(controller.isPaused).toBe(false);
        expect(controller.shouldStop).toBe(false);
    });

    it('resetUI does not change splitModeContainer display', () => {
        const splitModeContainer = document.getElementById('splitModeContainer');
        splitModeContainer.style.display = 'none';
        const controller = new PopupController();
        controller.resetUI();
        expect(splitModeContainer.style.display).toBe('none');
    });

    it('startDownload hides splitPagesContainer', async () => {
        const container = document.getElementById('splitPagesContainer');
        container.style.display = 'block';
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        await controller.startDownload();
        expect(container.style.display).toBe('none');
    });

    it('startDownload uses maxSizeMB from localStorage', async () => {
        const controller = new PopupController();
        global.localStorage.getItem = vi.fn((key) => key === 'manga_parser_max_size_mb' ? '150' : null);
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        await controller.startDownload();
        expect(controller.downloadManager.startDownload).toHaveBeenCalledWith(
            expect.objectContaining({ maxSizeMB: 150 })
        );
    });

    it('startDownload passes the loaded chapter list and the key range to the download', async () => {
        const controller = new PopupController();
        const chapters = [{ id: 1 }, { id: 2 }];
        controller.chapterController._allChapters = chapters;
        const fromSelect = document.getElementById('chapterFromSelect');
        const toSelect = document.getElementById('chapterToSelect');
        for (const key of ['1', '2']) {
            const opt = document.createElement('option');
            opt.value = key;
            fromSelect.appendChild(opt.cloneNode(true));
            toSelect.appendChild(opt);
        }
        toSelect.value = '2';
        document.getElementById('chapterRangeContainer').style.display = 'block';
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'mangalib';
        await controller.startDownload();
        expect(controller.downloadManager.startDownload).toHaveBeenCalledWith(expect.objectContaining({
            chapters, chapterRange: { fromKey: '1', toKey: '2' }
        }));
    });

    it('Updates progress and status', () => {
        const controller = new PopupController();
        controller.updateProgress('msg', 42);
        expect(document.getElementById('status').textContent).toBe('msg');
        expect(Number(document.getElementById('progress').getAttribute('value'))).toBe(42);
    });

    it('Sets shouldStop and updates status', () => {
        const controller = new PopupController();
        controller.currentDownloadId = 123;
        controller.downloadManager.stop = vi.fn();
        controller.stopDownload();
        expect(controller.shouldStop).toBe(true);
        expect(controller.isDownloading).toBe(false);
        expect(document.getElementById('status').textContent).toBe('Досрочное завершение...');
    });

    it('stopDownload disables pause and stop buttons', () => {
        const controller = new PopupController();
        controller.isPaused = true;
        controller.stopDownload();
        expect(controller.isPaused).toBe(false);
        expect(document.getElementById('pauseBtn').disabled).toBe(true);
        expect(document.getElementById('stopBtn').disabled).toBe(true);
    });

    it('stopDownload works when pause and stop buttons are missing', () => {
        document.getElementById('pauseBtn').remove();
        document.getElementById('stopBtn').remove();
        const controller = new PopupController();
        controller.stopDownload();
        expect(controller.shouldStop).toBe(true);
    });

    it('updateProgress keeps pause status but updates progress bar while paused', () => {
        const controller = new PopupController();
        document.getElementById('status').textContent = 'Пауза...';
        controller.isPaused = true;
        controller.updateProgress('msg', 55);
        expect(document.getElementById('status').textContent).toBe('Пауза...');
        expect(Number(document.getElementById('progress').getAttribute('value'))).toBe(55);
    });

    it('Pause button toggles pause and is ignored after stop', () => {
        const controller = new PopupController();
        controller.setupEventListeners();
        const pauseBtn = document.getElementById('pauseBtn');
        pauseBtn.click();
        expect(controller.isPaused).toBe(true);
        expect(pauseBtn.textContent).toBe('Продолжить');
        pauseBtn.click();
        expect(controller.isPaused).toBe(false);
        expect(pauseBtn.textContent).toBe('Пауза');
        controller.shouldStop = true;
        pauseBtn.click();
        expect(controller.isPaused).toBe(false);
        expect(pauseBtn.textContent).toBe('Пауза');
    });

    it('Returns true for params in separate window', async () => {
        const controller = new PopupController();
        window.location.search = '?download=true';
        const result = await controller.isInSeparateWindow();
        expect(result).toBe(true);
    });

    it('Returns true for small window', async () => {
        const controller = new PopupController();
        window.location.search = '';
        window.outerWidth = 400;
        window.outerHeight = 600;
        const result = await controller.isInSeparateWindow();
        expect(result).toBe(true);
    });

    it('Returns true for popup type', async () => {
        const controller = new PopupController();
        window.location.search = '';
        window.outerWidth = 800;
        window.outerHeight = 800;
        const result = await controller.isInSeparateWindow();
        expect(result).toBe(true);
    });

    it('Loads metadata and fills UI', async () => {
        const controller = new PopupController();
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).toContain('Глав:');
        expect(document.getElementById('description').innerHTML).toContain('Title');
        expect(document.getElementById('cover').src).toContain('cover.png');
    });

    it('Shows HTML in the title and the summary as text', () => {
        const controller = new PopupController();
        const desc = document.getElementById('description');
        controller._renderMeta({
            patched: { name: '<img src=x onerror="alert(1)">Title', summary: '<b>bold</b> & more', authors: [] },
            chaptersCount: 1,
            slug: 'slug',
            coverImg: document.getElementById('cover'),
            desc,
            releaseEl: null,
            logoInfo: document.getElementById('logoInfo')
        });
        expect(desc.querySelector('img')).toBeNull();
        expect(desc.querySelector('b')).toBeNull();
        expect(desc.querySelector('strong').textContent).toBe('<img src=x onerror="alert(1)">Title');
        expect(desc.querySelector('small').textContent).toBe('<b>bold</b> & more');
        expect(controller.currentTitle).toBe('<img src=x onerror="alert(1)">Title');
    });

    it('Attaches event listeners', () => {
        const controller = new PopupController();
        const btn = document.getElementById('downloadBtn');
        btn.click();
        expect(btn).toBeDefined();
    });

    it('Attaches event listeners', () => {
        const controller = new PopupController();
        controller.downloadManager.eventBus.on = vi.fn();
        controller.subscribeToEvents();
        expect(controller.downloadManager.eventBus.on).toHaveBeenCalled();
    });

    it('Shows error if slug missing', async () => {
        const controller = new PopupController();
        controller.currentSlug = null;
        controller.currentServiceKey = null;
        controller.showError = vi.fn();
        await controller.startDownload();
        expect(controller.showError).toHaveBeenCalled();
    });

	it('Handles download:started event in constructor', async () => {
        vi.resetModules();
        setupDOM();
        let handler;
        mocks.DownloadManager = class {
            constructor() {
                this.eventBus = {
                    on: (event, fn) => {
                        if (event === 'download:started') handler = fn;
                    }
                };
            }
        };
        mocks.extensionApi = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;

        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = PopupController;
        const controller = new PopupControllerClass();

        handler({ id: 42 });

        expect(controller.currentDownloadId).toBe(42);
    });

	it('Shows error and returns if downloadBtn is missing', async () => {
        vi.resetModules();
        document.body.innerHTML = '';
        mocks.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        mocks.extensionApi = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;

        const consoleErrorSpy = vi.spyOn(console, 'error');

        const PopupModule = await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = PopupController;
        new PopupControllerClass();
        await Promise.resolve();
        await Promise.resolve();

        expect(consoleErrorSpy).toHaveBeenCalledWith('[PopupController] downloadBtn not found in title template');
        consoleErrorSpy.mockRestore();
    });

it('Sets formatSelector value from localStorage', async () => {
        vi.resetModules();
        setupDOM();
        mocks.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        mocks.extensionApi = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        const FORMAT_STORAGE_KEY = 'manga_parser_selected_format';
        global.localStorage.getItem = vi.fn(() => 'epub');

        const PopupModule = await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = PopupController;
        new PopupControllerClass();
        await Promise.resolve();
        await Promise.resolve();

        const formatSelector = document.getElementById('formatSelector');
        expect(formatSelector.value).toBe('epub');
    });

	it('Saves formatSelector value to localStorage on change', async () => {
        vi.resetModules();
        setupDOM();
        mocks.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        mocks.extensionApi = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        const FORMAT_STORAGE_KEY = 'manga_parser_selected_format';
        const setItemSpy = vi.spyOn(global.localStorage, 'setItem');

        const PopupControllerClass = PopupController;
        new PopupControllerClass();
        await Promise.resolve();
        await Promise.resolve();

        const formatSelector = document.getElementById('formatSelector');
        formatSelector.value = 'pdf';
        formatSelector.dispatchEvent(new Event('change'));

        expect(setItemSpy).toHaveBeenCalledWith(FORMAT_STORAGE_KEY, 'pdf');
        setItemSpy.mockRestore();
    });

    it('Returns true if hasParams', async () => {
        vi.resetModules();
        mocks.extensionApi = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(async () => ({ type: 'normal' })) },
            tabs: { query: vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }])) }
        };
        global.chrome = undefined;
        const hasSpy = vi.spyOn(URLSearchParams.prototype, 'has').mockReturnValue(true);
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = PopupController;
        const controller = new PopupControllerClass();
        const result = await controller.isInSeparateWindow();
        expect(result).toBe(true);
        expect(hasSpy).toHaveBeenCalled();
        hasSpy.mockRestore();
    });

    it('Returns false and warns on exception', async () => {
        const controller = new PopupController();
        const origGetCurrent = mocks.extensionApi.windows.getCurrent;
        mocks.extensionApi.windows.getCurrent = vi.fn(() => { throw new Error('fail'); });
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        const result = await controller.isInSeparateWindow();
        expect(result).toBe(false);
        expect(consoleWarnSpy).toHaveBeenCalledWith('[PopupController] Failed to detect window type:', expect.any(Error));
        consoleWarnSpy.mockRestore();
        mocks.extensionApi.windows.getCurrent = origGetCurrent;
    });

    it('Sets formatSelector value from url param', async () => {
        const controller = new PopupController();
        const formatSelector = document.getElementById('formatSelector');
        const originalSearch = window.location.search;
        const option = document.createElement('option');
        option.value = 'epub';
        formatSelector.appendChild(option);
        Object.defineProperty(window, 'location', {
            value: { search: '?format=epub' },
            writable: true
        });
        await controller.loadMetadata();
        expect(formatSelector.value).toBe('epub');
        window.location.search = originalSearch;
    });

    it('Accepts rateLimit url param without error (rate limit now comes from settings)', async () => {
        const controller = new PopupController();
        const originalSearch = window.location.search;
        Object.defineProperty(window, 'location', {
            value: { search: '?rateLimit=77' },
            writable: true
        });
        await expect(controller.loadMetadata()).resolves.toBeUndefined();
        window.location.search = originalSearch;
    });

    it('Uses slug and service from url params', async () => {
        const controller = new PopupController();
        const originalSearch = window.location.search;
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=ranobelib' },
            writable: true
        });
        await controller.loadMetadata();
        expect(controller.currentSlug).toBe('testslug');
        expect(controller.currentServiceKey).toBe('ranobelib');
        window.location.search = originalSearch;
    });

    it('Creates MangaLibService when serviceKey is mangalib', async () => {
        mocks.MangaLibService = vi.fn().mockImplementation(() => ({
            getManga: vi.fn(async () => ({ rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        const controller = new PopupController();
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=mangalib' },
            writable: true
        });
        await controller.loadMetadata();
        expect(mocks.MangaLibService).toHaveBeenCalled();
    });

    it('Throws error for unknown service in url params', async () => {
        const controller = new PopupController();
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=unknownservice' },
            writable: true
        });
        const consoleErrorSpy = vi.spyOn(console, 'error');
        await controller.loadMetadata();
        expect(consoleErrorSpy).toHaveBeenCalledWith('[PopupController] Failed to load metadata:', expect.any(Error));
        expect(document.getElementById('description').textContent).toContain('Ошибка: Unknown service: unknownservice');
        consoleErrorSpy.mockRestore();
    });

    it('Sets hostname to mangalib.me for mangalib service', async () => {
        let hostnameSet = false;
        const origMangaLibService = mocks.MangaLibService;
        mocks.MangaLibService = class {
            constructor() {
                hostnameSet = true;
            }
            getManga = vi.fn(async () => ({ rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }));
            getChapterList = vi.fn(async () => [{}, {}]);
        };
        const controller = new PopupController();
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=mangalib' },
            writable: true
        });
        await controller.loadMetadata();
        expect(hostnameSet).toBe(true);
        mocks.MangaLibService = origMangaLibService;
    });

    it('Sets slug to null when no match in url', async () => {
        const controller = new PopupController();
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/' }]));
        const originalSearch = window.location.search;
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        await controller.loadMetadata();
        expect(controller.currentSlug).toBe(null);
        window.location.search = originalSearch;
    });

    it('Renders the metadata returned by service.getManga', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).toContain('Глав:');
        expect(document.getElementById('description').innerHTML).toContain('Title');
    });

    it('Warns if site logo element not found when setting logo for service mangalib', async () => {
        mocks.MangaLibService = class {
            getManga = vi.fn(async () => ({ rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }));
            getChapterList = vi.fn(async () => [{}, {}]);
        };
        const controller = new PopupController();
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=mangalib' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://mangalib.me/manga/testslug' }]));
        const siteLogo = document.getElementById('siteLogo');
        if (siteLogo && siteLogo.parentNode) siteLogo.parentNode.removeChild(siteLogo);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('[PopupController] Site logo element not found when setting logo for service:', 'mangalib');
        consoleWarnSpy.mockRestore();
    });

    it('Handles a title without chapters', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).not.toContain('Глав: 1');
    });

    it('Uses meta.name or slug as title when rus_name is missing', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                name: 'MetaName',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug1' }]));
        await controller.loadMetadata();
        expect(document.getElementById('description').innerHTML).toContain('MetaName');

        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug2' }]));
        await controller.loadMetadata();
        expect(document.getElementById('description').innerHTML).toContain('slug2');
    });

    it('Extracts text from ProseMirror summary or shows fallback', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                name: 'MetaName',
                summary: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich summary text' }] }, { type: 'paragraph' }] },
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug1' }]));
        await controller.loadMetadata();
        expect(document.getElementById('description').innerHTML).toContain('Rich summary text');

        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                name: 'MetaName',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug2' }]));
        await controller.loadMetadata();
        expect(document.getElementById('description').innerHTML).toContain('Описание отсутствует');
    });

    it('Completes loadMetadata without crashing when chapter loading returns null', async () => {
        const controller = new PopupController();
        controller.chapterController.loadAndPopulate = vi.fn(async () => null);
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            }))
        }));
        await expect(controller.loadMetadata()).resolves.not.toThrow();
    });

    it('Warns if no valid cover URL found in meta.cover object', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: { foo: 'bar' },
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('[PopupController] No cover information found in metadata');
        consoleWarnSpy.mockRestore();
    });

    it('Sets cover to meta.cover.default if present', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: { default: 'default-cover.png' },
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('cover').src).toContain('default-cover.png');
    });

    it('Sets cover to meta.cover.thumbnail if present', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: { thumbnail: 'thumbnail-cover.png' },
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('cover').src).toContain('thumbnail-cover.png');
    });

    it('Sets cover to meta.cover.md if present', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: { md: 'md-cover.png' },
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('cover').src).toContain('md-cover.png');
    });

    it('Sets cover to meta.cover.url if present', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: { url: 'url-cover.png' },
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('cover').src).toContain('url-cover.png');
    });

    it('Sets cover to meta.image if present', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                image: 'meta-image.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('cover').src).toContain('meta-image.png');
    });

    it('Warns if no cover information found in metadata', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('[PopupController] No cover information found in metadata');
        consoleWarnSpy.mockRestore();
    });

    it('Returns null for empty author in metadata', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: [null, undefined, '', 'Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).toContain('Авторы: Author');
    });

    it('Returns null for author object without name fields', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: [{ foo: 'bar' }, 'Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).toContain('Авторы: Author');
    });

    it('Normalizes string authors via MangaPatcher', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: 'Ivan',
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).toContain('Авторы: Ivan');
    });

    it('Warns if no age restriction label found in metadata', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: {},
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('[PopupController] No age restriction label found in metadata');
        consoleWarnSpy.mockRestore();
    });

    it('Sets release date from releaseDate or releaseDateString or release_date or published or year or date or empty', async () => {
        const controller = new PopupController();

        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2022-01-01'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug1' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2022-01-01');

        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDateString: '2023-02-02'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug2' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2023-02-02');

        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                release_date: '2024-03-03'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug3' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2024-03-03');

        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                published: '2025-04-04'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug4' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2025-04-04');

        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                year: '2026'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug5' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2026');

        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                date: '2027-06-06'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug6' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2027-06-06');

        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' }
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug7' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toBe('');
    });

    it('Warns if release date element found when setting release date', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        const releaseEl = document.getElementById('releaseDate');
        if (releaseEl && releaseEl.parentNode) releaseEl.parentNode.removeChild(releaseEl);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('[PopupController] Release date element not found when setting release date:', '2020');
        consoleWarnSpy.mockRestore();
    });

    it('Warns if status element not found when setting ready to download message', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        const status = document.getElementById('status');
        if (status && status.parentNode) status.parentNode.removeChild(status);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('[PopupController] Status element not found when setting ready to download message');
        consoleWarnSpy.mockRestore();
    });

    it('Warns if window created but no ID found', async () => {
        const controller = new PopupController();
        const windowsCreateSpy = vi.spyOn(mocks.extensionApi.windows, 'create').mockResolvedValue({});
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.openInNewContext('popup.html?download=true');
        expect(consoleWarnSpy).toHaveBeenCalledWith('[PopupController] Window created but no ID found:', {});
        consoleWarnSpy.mockRestore();
        windowsCreateSpy.mockRestore();
    });

    it('Returns input as is if text is falsy in truncateText', () => {
        const controller = new PopupController();
        expect(controller.truncateText(null)).toBe(null);
        expect(controller.truncateText(undefined)).toBe(undefined);
        expect(controller.truncateText('')).toBe('');
    });

    it('Gets formatSelector and maxSizeInput elements when download button clicked', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(mocks.extensionApi.windows, 'create').mockResolvedValue({ id: 123 });
        const windowsUpdateSpy = vi.spyOn(mocks.extensionApi.windows, 'update').mockResolvedValue({});
        const getElementByIdSpy = vi.spyOn(document, 'getElementById');
        const downloadBtn = document.getElementById('downloadBtn');
        await downloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(getElementByIdSpy).toHaveBeenCalledWith('formatSelector');
        getElementByIdSpy.mockRestore();
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
        windowsUpdateSpy.mockRestore();
    });

    it('splitModeContainer falls back to btn parent when chapterRangeContainer is absent', () => {
        let chapterRangeCallCount = 0;
        const original = document.getElementById.bind(document);
        const spy = vi.spyOn(document, 'getElementById').mockImplementation((id) => {
            if (id === 'chapterRangeContainer') {
                chapterRangeCallCount++;
                if (chapterRangeCallCount >= 2) return null;
            }
            return original(id);
        });
        const controller = new PopupController();
        spy.mockRestore();
        expect(document.getElementById('splitModeContainer')).toBeTruthy();
    });

    it('loadMetadata does not save the download window URL params as settings', async () => {
        const controller = new PopupController();
        const originalSearch = window.location.search;
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=mangalib&maxSizeMB=150&format=epub&splitPages=false' },
            writable: true
        });
        await controller.loadMetadata();
        expect(global.localStorage.setItem).not.toHaveBeenCalledWith('manga_parser_max_size_mb', expect.anything());
        expect(global.localStorage.setItem).not.toHaveBeenCalledWith('manga_parser_selected_format', expect.anything());
        expect(global.localStorage.setItem).not.toHaveBeenCalledWith('manga_parser_split_pages', expect.anything());
        window.location.search = originalSearch;
    });

    it('Completes without error when splitModeContainer not found during startDownload', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const sc = document.getElementById('splitModeContainer');
        if (sc) sc.parentNode.removeChild(sc);
        await expect(controller.startDownload()).resolves.not.toThrow();
    });

    it('Completes without error when splitModeContainer not found during resetUI', () => {
        const controller = new PopupController();
        const sc = document.getElementById('splitModeContainer');
        if (sc) sc.parentNode.removeChild(sc);
        expect(() => controller.resetUI()).not.toThrow();
    });

    it('openInNewContext sends openWindowWithUrl to background in Chrome mode', async () => {
        const sendMessageMock = vi.fn(async () => ({ ok: true }));
        mocks.extensionApi.runtime.sendMessage = sendMessageMock;
        mocks.browserEnv = { isFirefox: false };
        const controller = new PopupController();
        await controller.openInNewContext('popup.html?download=true');
        expect(sendMessageMock).toHaveBeenCalledWith({ action: 'openWindowWithUrl', url: 'popup.html?download=true' });
    });

    it('openInNewContext catches sendMessage rejection in Chrome mode and logs it', async () => {
        const error = new Error('port closed');
        const sendMessageMock = vi.fn(async () => { throw error; });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mocks.extensionApi.runtime.sendMessage = sendMessageMock;
        mocks.browserEnv = { isFirefox: false };
        const controller = new PopupController();
        await expect(controller.openInNewContext('popup.html?download=true')).resolves.toBeUndefined();
        await vi.waitFor(() => expect(warnSpy)
            .toHaveBeenCalledWith('[PopupController] Failed to ask the background to open a window:', error));
        expect(sendMessageMock).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('splitPagesCheckbox defaults to checked when localStorage has no saved value', async () => {
        global.localStorage.getItem = vi.fn(() => null);
        const controller = new PopupController();
        await Promise.resolve();
        await Promise.resolve();
        const checkbox = document.getElementById('splitPagesCheckbox');
        expect(checkbox.checked).toBe(true);
    });

    it('splitPagesCheckbox restored to false when localStorage has saved false', async () => {
        global.localStorage.getItem = vi.fn((key) =>
            key === 'manga_parser_split_pages' ? 'false' : null
        );
        const controller = new PopupController();
        await Promise.resolve();
        await Promise.resolve();
        const checkbox = document.getElementById('splitPagesCheckbox');
        expect(checkbox.checked).toBe(false);
    });

    it('splitPagesCheckbox restored to true when localStorage has saved true', async () => {
        global.localStorage.getItem = vi.fn((key) =>
            key === 'manga_parser_split_pages' ? 'true' : null
        );
        const controller = new PopupController();
        await Promise.resolve();
        await Promise.resolve();
        const checkbox = document.getElementById('splitPagesCheckbox');
        expect(checkbox.checked).toBe(true);
    });

    it('splitPagesCheckbox change event saves state to localStorage', async () => {
        const controller = new PopupController();
        await Promise.resolve();
        await Promise.resolve();
        const checkbox = document.getElementById('splitPagesCheckbox');
        const setItemSpy = vi.spyOn(global.localStorage, 'setItem');
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));
        expect(setItemSpy).toHaveBeenCalledWith('manga_parser_split_pages', false);
        setItemSpy.mockRestore();
    });

    it('splitPagesContainer shown for mangalib service in loadMetadata', async () => {
        mocks.MangaLibService = class {
            getManga = vi.fn(async () => ({ rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }));
            getChapterList = vi.fn(async () => [{}, {}]);
        };
        const controller = new PopupController();
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=mangalib' },
            writable: true
        });
        await controller.loadMetadata();
        const container = document.getElementById('splitPagesContainer');
        expect(container.style.display).toBe('block');
    });

    it('splitPagesContainer hidden for ranobelib service in loadMetadata', async () => {
        const controller = new PopupController();
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        mocks.extensionApi.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        const container = document.getElementById('splitPagesContainer');
        expect(container.style.display).toBe('none');
    });

    it('splitPages URL param applied to checkbox only, not to the saved setting', async () => {
        const controller = new PopupController();
        mocks.MangaLibService = class {
            getManga = vi.fn(async () => ({ rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }));
            getChapterList = vi.fn(async () => [{}, {}]);
        };
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=mangalib&splitPages=false' },
            writable: true
        });
        const setItemSpy = vi.spyOn(global.localStorage, 'setItem');
        await controller.loadMetadata();
        const checkbox = document.getElementById('splitPagesCheckbox');
        expect(checkbox.checked).toBe(false);
        expect(setItemSpy).not.toHaveBeenCalledWith('manga_parser_split_pages', expect.anything());
        setItemSpy.mockRestore();
    });

    it('startDownload hides splitPagesContainer when present', async () => {
        window.location.search = '';
        const container = document.getElementById('splitPagesContainer');
        container.style.display = 'block';
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        await controller.startDownload();
        expect(container.style.display).toBe('none');
    });

    it('resetUI shows splitPagesContainer for mangalib', () => {
        const controller = new PopupController();
        controller.currentServiceKey = 'mangalib';
        controller.resetUI();
        expect(document.getElementById('splitPagesContainer').style.display).toBe('block');
    });

    it('resetUI hides splitPagesContainer for non-mangalib', () => {
        const controller = new PopupController();
        controller.currentServiceKey = 'ranobelib';
        controller.resetUI();
        expect(document.getElementById('splitPagesContainer').style.display).toBe('none');
    });
});