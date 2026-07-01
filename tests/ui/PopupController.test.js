import { describe, it, expect, beforeEach, vi } from 'vitest';

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
            <div id="splitModeContainer">
                <input id="maxSizeInput" type="number" value="200">
            </div>
            <div id="rateLimitContainer">
                <input id="rateLimitInput" type="number" value="85">
            </div>
            <div id="formatContainer">
                <select id="formatSelector"></select>
            </div>
            <div id="fileInputContainer">
                <input type="file" id="fileInput">
                <button id="customFileBtn">Загрузить файл для обновления</button>
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
    global.DownloadManager = class {
        constructor() { this.eventBus = { on: vi.fn() }; }
        startDownload = vi.fn(async () => ({ updated: true, addedChapters: 1 }));
        stop = vi.fn();
        getDownloadState = vi.fn(() => ({ id: 1, status: 'active', progress: 50, slug: 'slug' }));
    };
    global.serviceRegistry = {
        getServiceByUrl: vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                },
                image: 'cover.png'
            })),
            fetchChaptersList: vi.fn(async () => ({
                data: [{}, {}]
            }))
        })),
    };
    global.RanobeLibService = class {
        fetchMangaMetadata = vi.fn(async () => ({ data: { rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }, image: 'cover.png' }));
        fetchChaptersList = vi.fn(async () => ({ data: [{}, {}] }));
    };
    global.MangaLibService = class {
        fetchMangaMetadata = vi.fn(async () => ({ data: { rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }, image: 'cover.png' }));
        fetchChaptersList = vi.fn(async () => ({ data: [{}, {}] }));
    };
    global.browser = {
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
    global.ExporterRegistry = {
        getFormats: vi.fn(() => [
            { value: 'fb2', label: 'FB2' },
            { value: 'epub', label: 'EPUB' },
            { value: 'pdf', label: 'PDF' },
            { value: 'mobi', label: 'MOBI' },
            { value: 'simple', label: 'TXT/JPEG' },
        ]),
    };
    global.DownloadHistory = { add: vi.fn(), getAll: vi.fn(() => []), clear: vi.fn() };
    global.TemplateLoader = {
        init: vi.fn(),
        show: vi.fn(async () => {}),
        current: vi.fn(() => null)
    };
    global.HistoryController = { init: vi.fn() };

    await import('../../core/MangaPatcher.js');
    await import('../../ui/PopupController.js');
    PopupController = global.PopupController;
});

afterEach(() => {
    intervals.forEach(id => clearInterval(id));
    intervals = [];
    if (controller) controller = null;
    vi.clearAllTimers();
});

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
        expect(document.getElementById('fileInputContainer')).toBeDefined();
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
        controller.loadedFile = {};
        controller.resetUI();
        expect(controller.isDownloading).toBe(false);
        expect(controller.isPaused).toBe(false);
        expect(controller.shouldStop).toBe(false);
        expect(controller.loadedFile).toBe(null);
    });

    it('resetUI hides splitModeContainer when present', () => {
        const splitModeContainer = document.getElementById('splitModeContainer');
        splitModeContainer.style.display = 'none';
        const controller = new PopupController();
        controller.resetUI();
        expect(splitModeContainer.style.display).toBe('block');
    });

    it('startDownload hides splitModeContainer when present', async () => {
        const splitModeContainer = document.getElementById('splitModeContainer');
        splitModeContainer.style.display = 'block';
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        await controller.startDownload();
        expect(splitModeContainer.style.display).toBe('none');
    });

    it('startDownload uses maxSizeInput value when present', async () => {
        const controller = new PopupController();
        await Promise.resolve();
        await Promise.resolve();
        const maxSizeInput = document.getElementById('maxSizeInput');
        maxSizeInput.value = '150';
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        await controller.startDownload();
        expect(controller.downloadManager.startDownload).toHaveBeenCalledWith(
            expect.objectContaining({ maxSizeMB: 150 })
        );
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

	it('Returns early when browserAPI is not available', async () => {
        vi.resetModules();
        
        const originalBrowser = global.browser;
        const originalChrome = global.chrome;
        
        global.browser = undefined;
        global.chrome = undefined;
        
        const consoleErrorSpy = vi.spyOn(console, 'error');
        
        delete global.PopupController;
        
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        
        expect(consoleErrorSpy).toHaveBeenCalledWith('[PopupController] No browser API available');
        expect(global.PopupController).toBeUndefined();
        
        consoleErrorSpy.mockRestore();
        
        global.browser = originalBrowser;
        global.chrome = originalChrome;
    });

	it('Detects browserAPI as chrome when chrome.runtime exists', async () => {
        vi.resetModules();
        delete global.PopupController;
        global.browser = undefined;
        global.chrome = { runtime: { foo: 'bar' } };

        const consoleLogSpy = vi.spyOn(console, 'log');
        const consoleErrorSpy = vi.spyOn(console, 'error');

        await import('../../ui/PopupController.js?nocache=' + Math.random());

        expect(consoleLogSpy).toHaveBeenCalledWith('[PopupController] Loading...');
        expect(global.PopupController).toBeDefined();
        expect(consoleErrorSpy).not.toHaveBeenCalledWith('[PopupController] No browser API available');

        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

	it('Uses getExtensionApi when available', async () => {
        vi.resetModules();
        setupDOM();
        const extensionApi = {
            runtime: { sendMessage: vi.fn(async () => ({})), getURL: vi.fn(() => 'popup.html') },
            windows: { getCurrent: vi.fn(async () => ({ type: 'normal' })), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }])) }
        };
        global.getExtensionApi = vi.fn(() => extensionApi);
        global.browser = undefined;
        global.chrome = undefined;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        expect(global.getExtensionApi).toHaveBeenCalled();
        delete global.getExtensionApi;
    });

	it('Handles download:started event in constructor', async () => {
        vi.resetModules();
        setupDOM();
        let handler;
        global.DownloadManager = class {
            constructor() {
                this.eventBus = {
                    on: (event, fn) => {
                        if (event === 'download:started') handler = fn;
                    }
                };
            }
        };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;

        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        const controller = new PopupControllerClass();

        handler({ id: 42 });

        expect(controller.currentDownloadId).toBe(42);
    });

	it('Shows error and returns if downloadBtn is missing', async () => {
        vi.resetModules();
        document.body.innerHTML = '';
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;

        const consoleErrorSpy = vi.spyOn(console, 'error');

        const PopupModule = await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        await Promise.resolve();
        await Promise.resolve();

        expect(consoleErrorSpy).toHaveBeenCalledWith('[PopupController] downloadBtn not found in title template');
        consoleErrorSpy.mockRestore();
    });

it('Sets formatSelector value from localStorage', async () => {
        vi.resetModules();
        setupDOM();
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        const FORMAT_STORAGE_KEY = 'manga_parser_selected_format';
        global.localStorage.getItem = vi.fn(() => 'epub');

        const PopupModule = await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        await Promise.resolve();
        await Promise.resolve();

        const formatSelector = document.getElementById('formatSelector');
        expect(formatSelector.value).toBe('epub');
    });

	it('Saves formatSelector value to localStorage on change', async () => {
        vi.resetModules();
        setupDOM();
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        const FORMAT_STORAGE_KEY = 'manga_parser_selected_format';
        const setItemSpy = vi.spyOn(global.localStorage, 'setItem');

        const PopupControllerClass = global.PopupController;
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
        delete global.PopupController;
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(async () => ({ type: 'normal' })) },
            tabs: { query: vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }])) }
        };
        global.chrome = undefined;
        const hasSpy = vi.spyOn(URLSearchParams.prototype, 'has').mockReturnValue(true);
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        const controller = new PopupControllerClass();
        const result = await controller.isInSeparateWindow();
        expect(result).toBe(true);
        expect(hasSpy).toHaveBeenCalled();
        hasSpy.mockRestore();
    });

    it('Returns false and warns on exception', async () => {
        const controller = new PopupController();
        const origGetCurrent = global.browser.windows.getCurrent;
        global.browser.windows.getCurrent = vi.fn(() => { throw new Error('fail'); });
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        const result = await controller.isInSeparateWindow();
        expect(result).toBe(false);
        expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to detect window type:', expect.any(Error));
        consoleWarnSpy.mockRestore();
        global.browser.windows.getCurrent = origGetCurrent;
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

    it('Sets rateLimitInput value from url param', async () => {
        const controller = new PopupController();
        const rateLimitInput = document.getElementById('rateLimitInput');
        const originalSearch = window.location.search;
        Object.defineProperty(window, 'location', {
            value: { search: '?rateLimit=77' },
            writable: true
        });
        await controller.loadMetadata();
        expect(rateLimitInput.value).toBe('77');
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
        global.MangaLibService = vi.fn().mockImplementation(() => ({
            fetchMangaMetadata: vi.fn(async () => ({ data: { rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }, image: 'cover.png' })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        const controller = new PopupController();
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=mangalib' },
            writable: true
        });
        await controller.loadMetadata();
        expect(global.MangaLibService).toHaveBeenCalled();
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
        const origMangaLibService = global.MangaLibService;
        global.MangaLibService = class {
            constructor() {
                hostnameSet = true;
            }
            fetchMangaMetadata = vi.fn(async () => ({ data: { rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }, image: 'cover.png' }));
            fetchChaptersList = vi.fn(async () => ({ data: [{}, {}] }));
        };
        const controller = new PopupController();
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=mangalib' },
            writable: true
        });
        await controller.loadMetadata();
        expect(hostnameSet).toBe(true);
        global.MangaLibService = origMangaLibService;
    });

    it('Sets slug to null when no match in url', async () => {
        const controller = new PopupController();
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/' }]));
        const originalSearch = window.location.search;
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        await controller.loadMetadata();
        expect(controller.currentSlug).toBe(null);
        window.location.search = originalSearch;
    });

    it('Uses rawResp as metadata if data is missing', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                rus_name: 'Title',
                summary: 'Summary',
                cover: 'cover.png',
                authors: ['Author'],
                ageRestriction: { label: '18+' },
                releaseDate: '2020'
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).toContain('Глав:');
        expect(document.getElementById('description').innerHTML).toContain('Title');
    });

    it('Warns if site logo element not found when setting logo for service mangalib', async () => {
        global.MangaLibService = class {
            fetchMangaMetadata = vi.fn(async () => ({ data: { rus_name: 'Title', summary: 'Summary', cover: 'cover.png', authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020' }, image: 'cover.png' }));
            fetchChaptersList = vi.fn(async () => ({ data: [{}, {}] }));
        };
        const controller = new PopupController();
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=mangalib' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://mangalib.me/manga/testslug' }]));
        const siteLogo = document.getElementById('siteLogo');
        if (siteLogo && siteLogo.parentNode) siteLogo.parentNode.removeChild(siteLogo);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Site logo element not found when setting logo for service:', 'mangalib');
        consoleWarnSpy.mockRestore();
    });

    it('Uses empty array as chapters if chaptersData.data is missing', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                },
                image: 'cover.png'
            })),
            fetchChaptersList: vi.fn(async () => ({}))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).not.toContain('Глав: 1');
    });

    it('Uses meta.name or slug as title when rus_name is missing', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    name: 'MetaName',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug1' }]));
        await controller.loadMetadata();
        expect(document.getElementById('description').innerHTML).toContain('MetaName');

        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug2' }]));
        await controller.loadMetadata();
        expect(document.getElementById('description').innerHTML).toContain('slug2');
    });

    it('Extracts text from ProseMirror summary or shows fallback', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    name: 'MetaName',
                    summary: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rich summary text' }] }, { type: 'paragraph' }] },
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug1' }]));
        await controller.loadMetadata();
        expect(document.getElementById('description').innerHTML).toContain('Rich summary text');

        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    name: 'MetaName',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug2' }]));
        await controller.loadMetadata();
        expect(document.getElementById('description').innerHTML).toContain('Описание отсутствует');
    });

    it('Warns if failed to fetch chapters count', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                },
                image: 'cover.png'
            })),
            fetchChaptersList: vi.fn(async () => { throw new Error('fail chapters'); })
        }));
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('[PopupController] Failed to fetch chapters count:', expect.any(Error));
        consoleWarnSpy.mockRestore();
    });

    it('Warns if no valid cover URL found in meta.cover object', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: { foo: 'bar' },
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('No cover information found in metadata');
        consoleWarnSpy.mockRestore();
    });

    it('Sets cover to meta.cover.default if present', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: { default: 'default-cover.png' },
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('cover').src).toContain('default-cover.png');
    });

    it('Sets cover to meta.cover.thumbnail if present', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: { thumbnail: 'thumbnail-cover.png' },
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('cover').src).toContain('thumbnail-cover.png');
    });

    it('Sets cover to meta.cover.md if present', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: { md: 'md-cover.png' },
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('cover').src).toContain('md-cover.png');
    });

    it('Sets cover to meta.cover.url if present', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: { url: 'url-cover.png' },
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('cover').src).toContain('url-cover.png');
    });

    it('Sets cover to meta.image if present', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    image: 'meta-image.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('cover').src).toContain('meta-image.png');
    });

    it('Warns if no cover information found in metadata', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('No cover information found in metadata');
        consoleWarnSpy.mockRestore();
    });

    it('Returns null for empty author in metadata', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: [null, undefined, '', 'Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).toContain('Авторы: Author');
    });

    it('Returns null for author object without name fields', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: [{ foo: 'bar' }, 'Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).toContain('Авторы: Author');
    });

    it('Normalizes string authors via MangaPatcher', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: 'Ivan',
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).toContain('Авторы: Ivan');
    });

    it('Warns if no age restriction label found in metadata', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: {},
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('No age restriction label found in metadata');
        consoleWarnSpy.mockRestore();
    });

    it('Sets release date from releaseDate or releaseDateString or release_date or published or year or date or empty', async () => {
        const controller = new PopupController();

        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2022-01-01'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug1' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2022-01-01');

        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDateString: '2023-02-02'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug2' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2023-02-02');

        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    release_date: '2024-03-03'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug3' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2024-03-03');

        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    published: '2025-04-04'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug4' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2025-04-04');

        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    year: '2026'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug5' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2026');

        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    date: '2027-06-06'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug6' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toContain('2027-06-06');

        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' }
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug7' }]));
        await controller.loadMetadata();
        expect(document.getElementById('releaseDate').textContent).toBe('');
    });

    it('Warns if release date element found when setting release date', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        const releaseEl = document.getElementById('releaseDate');
        if (releaseEl && releaseEl.parentNode) releaseEl.parentNode.removeChild(releaseEl);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Release date element not found when setting release date:', '2020');
        consoleWarnSpy.mockRestore();
    });

    it('Warns if status element not found when setting ready to download message', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title',
                    summary: 'Summary',
                    cover: 'cover.png',
                    authors: ['Author'],
                    ageRestriction: { label: '18+' },
                    releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]));
        const status = document.getElementById('status');
        if (status && status.parentNode) status.parentNode.removeChild(status);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Status element not found when setting ready to download message');
        consoleWarnSpy.mockRestore();
    });

    it('Calls isInSeparateWindow when clicking file button', async () => {
        const controller = new PopupController();
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(true);
        const customFileBtn = document.getElementById('customFileBtn');
        await controller.loadMetadata();
        await customFileBtn.onclick();
        expect(isInSeparateWindowSpy).toHaveBeenCalled();
        isInSeparateWindowSpy.mockRestore();
    });

    it('Sets format from formatSelector value', async () => {
        const controller = new PopupController();
        const customFileBtn = document.getElementById('customFileBtn');
        const formatSelector = document.createElement('select');
        formatSelector.id = 'formatSelector';
        const opt = document.createElement('option');
        opt.value = 'epub';
        formatSelector.appendChild(opt);
        document.body.appendChild(formatSelector);

        formatSelector.value = 'epub';
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const formatValues = [];
        const origAlert = global.alert;
        global.alert = (msg) => formatValues.push(msg);

        await controller.loadMetadata();
        await customFileBtn.onclick();
        expect(formatSelector.value).toBe('epub');

        formatSelector.parentNode.removeChild(formatSelector);
        await customFileBtn.onclick();
        global.alert = origAlert;
        isInSeparateWindowSpy.mockRestore();
    });

    it('Defaults format to fb2 if formatSelector is missing', async () => {
        const controller = new PopupController();
        const customFileBtn = document.getElementById('customFileBtn');
        const formatSelector = document.getElementById('formatSelector');
        if (formatSelector && formatSelector.parentNode) formatSelector.parentNode.removeChild(formatSelector);
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create');
        await controller.loadMetadata();
        await customFileBtn.onclick();
        const urlArg = windowsCreateSpy.mock.calls[0][0].url;
        expect(urlArg).toContain('format=fb2');
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
    });

    it('Defaults rateLimit to 100 if rateLimitInput is missing', async () => {
        const controller = new PopupController();
        const customFileBtn = document.getElementById('customFileBtn');
        const rateLimitInput = document.getElementById('rateLimitInput');
        if (rateLimitInput && rateLimitInput.parentNode) rateLimitInput.parentNode.removeChild(rateLimitInput);
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create');
        await controller.loadMetadata();
        await customFileBtn.onclick();
        const urlArg = windowsCreateSpy.mock.calls[0][0].url;
        expect(urlArg).toContain('rateLimit=100');
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
    });

    it('Defaults rateLimit to 100 if rateLimitInput value is empty or invalid', async () => {
        const controller = new PopupController();
        const customFileBtn = document.getElementById('customFileBtn');
        const rateLimitInput = document.getElementById('rateLimitInput');
        rateLimitInput.value = '';
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create');
        await controller.loadMetadata();
        await customFileBtn.onclick();
        const urlArg = windowsCreateSpy.mock.calls[0][0].url;
        expect(urlArg).toContain('rateLimit=100');
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
    });

    it('Warns if window created but no ID found', async () => {
        const controller = new PopupController();
        const customFileBtn = document.getElementById('customFileBtn');
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockResolvedValue({});
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        await customFileBtn.onclick();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Window created but no ID found:', {});
        consoleWarnSpy.mockRestore();
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
    });

    it('Handles error when window creation fails', async () => {
        const controller = new PopupController();
        const customFileBtn = document.getElementById('customFileBtn');
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockRejectedValue(new Error('fail create'));
        const status = document.getElementById('status');
        const hiddenFileInput = document.getElementById('fileInput');
        const clickSpy = vi.spyOn(hiddenFileInput, 'click');
        const consoleErrorSpy = vi.spyOn(console, 'error');
        await controller.loadMetadata();
        await customFileBtn.onclick();
        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to create window:', expect.any(Error));
        expect(status.textContent).toBe('Не удалось открыть окно, используем текущее');
        expect(clickSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
        clickSpy.mockRestore();
    });

    it('Handles error in file handler and shows prompt for file selection', async () => {
        const controller = new PopupController();
        const customFileBtn = document.getElementById('customFileBtn');
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockImplementation(() => { throw new Error('fail isInSeparateWindow'); });
        const status = document.getElementById('status');
        const hiddenFileInput = document.getElementById('fileInput');
        const clickSpy = vi.spyOn(hiddenFileInput, 'click');
        const consoleErrorSpy = vi.spyOn(console, 'error');
        await controller.loadMetadata();
        await customFileBtn.onclick();
        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to handle file upload:', expect.any(Error));
        expect(status.textContent).toBe('Выберите файл для обновления');
        expect(clickSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
        isInSeparateWindowSpy.mockRestore();
        clickSpy.mockRestore();
    });

    it('Clicks hidden file input if fileUploadMode is true and hiddenFileInput exists', async () => {
        const controller = new PopupController();
        const hiddenFileInput = document.getElementById('fileInput');
        const clickSpy = vi.spyOn(hiddenFileInput, 'click');
        Object.defineProperty(window, 'location', {
            value: { search: '?fileUpload=true&slug=testslug&service=ranobelib' },
            writable: true
        });
        await controller.loadMetadata();
        await new Promise(resolve => setTimeout(resolve, 350));
        expect(clickSpy).toHaveBeenCalled();
        clickSpy.mockRestore();
    });

    it('Warns if status element not found when prompting for file selection in file upload mode', async () => {
        const controller = new PopupController();
        const status = document.getElementById('status');
        if (status && status.parentNode) status.parentNode.removeChild(status);
        const hiddenFileInput = document.getElementById('fileInput');
        const clickSpy = vi.spyOn(hiddenFileInput, 'click');
        Object.defineProperty(window, 'location', {
            value: { search: '?fileUpload=true&slug=testslug&service=ranobelib' },
            writable: true
        });
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        await new Promise(resolve => setTimeout(resolve, 350));
        expect(consoleWarnSpy).toHaveBeenCalledWith('Status element not found when prompting for file selection in file upload mode');
        expect(clickSpy).toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
        clickSpy.mockRestore();
    });

    it('Returns input as is if text is falsy in truncateText', () => {
        const controller = new PopupController();
        expect(controller.truncateText(null)).toBe(null);
        expect(controller.truncateText(undefined)).toBe(undefined);
        expect(controller.truncateText('')).toBe('');
    });

    it('Gets formatSelector and rateLimitInput elements when download button clicked', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockResolvedValue({ id: 123 });
        const windowsUpdateSpy = vi.spyOn(global.browser.windows, 'update').mockResolvedValue({});
        const getElementByIdSpy = vi.spyOn(document, 'getElementById');
        const downloadBtn = document.getElementById('downloadBtn');
        await downloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(getElementByIdSpy).toHaveBeenCalledWith('formatSelector');
        expect(getElementByIdSpy).toHaveBeenCalledWith('rateLimitInput');
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

    it('loadMetadata applies maxSizeMB from URL params', async () => {
        const controller = new PopupController();
        const originalSearch = window.location.search;
        Object.defineProperty(window, 'location', {
            value: { search: '?maxSizeMB=150' },
            writable: true
        });
        await controller.loadMetadata();
        expect(global.localStorage.setItem).toHaveBeenCalledWith('manga_parser_max_size_mb', '150');
        window.location.search = originalSearch;
    });

    it('Warns when splitModeContainer not found during startDownload', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const sc = document.getElementById('splitModeContainer');
        if (sc) sc.parentNode.removeChild(sc);
        const warnSpy = vi.spyOn(console, 'warn');
        await controller.startDownload();
        expect(warnSpy).toHaveBeenCalledWith('Split mode container not found when hiding during download');
        warnSpy.mockRestore();
    });

    it('Warns when splitModeContainer not found during resetUI', () => {
        const controller = new PopupController();
        const sc = document.getElementById('splitModeContainer');
        if (sc) sc.parentNode.removeChild(sc);
        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();
        expect(warnSpy).toHaveBeenCalledWith('Split mode container not found when resetting UI');
        warnSpy.mockRestore();
    });

    it('_getAuthToken returns cached token from sendMessage', async () => {
        global.browser.runtime.sendMessage = vi.fn(async () => ({ token: 'cached-token' }));
        const controller = new PopupController();
        const result = await controller._getAuthToken('mangalib', 1);
        expect(result).toBe('cached-token');
    });

    it('_getAuthToken falls back to executeScript when cache returns no token', async () => {
        global.browser.runtime.sendMessage = vi.fn(async (msg) => {
            if (msg.action === 'getAuthToken') return { token: null };
            return {};
        });
        global.browser.scripting = {
            executeScript: vi.fn(async () => [{ result: 'script-token' }])
        };
        const controller = new PopupController();
        const result = await controller._getAuthToken('mangalib', 1);
        expect(result).toBe('script-token');
    });

    it('_getAuthToken returns null when executeScript returns no result', async () => {
        global.browser.runtime.sendMessage = vi.fn(async () => ({ token: null }));
        global.browser.scripting = {
            executeScript: vi.fn(async () => [{ result: null }])
        };
        const controller = new PopupController();
        const result = await controller._getAuthToken('mangalib', 1);
        expect(result).toBeNull();
    });

    it('_getAuthToken returns null and warns when executeScript throws', async () => {
        global.browser.runtime.sendMessage = vi.fn(async () => ({ token: null }));
        global.browser.scripting = {
            executeScript: vi.fn(async () => { throw new Error('script error'); })
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const controller = new PopupController();
        const result = await controller._getAuthToken('mangalib', 1);
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            '[PopupController] Failed to extract auth token via executeScript:',
            expect.any(Error)
        );
        warnSpy.mockRestore();
    });

    it('_applyAuthToken sets authToken and updates service headers when token found', async () => {
        global.browser.runtime.sendMessage = vi.fn(async () => ({ token: 'the-token' }));
        const controller = new PopupController();
        const service = { config: { headers: { 'Content-Type': 'application/json' } } };
        await controller._applyAuthToken('mangalib', 1, service);
        expect(controller.authToken).toBe('the-token');
        expect(service.config.headers['Authorization']).toBe('Bearer the-token');
    });

    it('_applyAuthToken catches exception from _getAuthToken and warns', async () => {
        const controller = new PopupController();
        vi.spyOn(controller, '_getAuthToken').mockRejectedValue(new Error('get token failed'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const service = { config: { headers: {} } };
        await controller._applyAuthToken('mangalib', 1, service);
        expect(controller.authToken).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            '[PopupController] Could not get auth token:',
            expect.any(Error)
        );
        warnSpy.mockRestore();
    });

    it('_getAuthToken warns when sendMessage throws', async () => {
        global.browser.runtime.sendMessage = vi.fn(async () => { throw new Error('send error'); });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const controller = new PopupController();
        const result = await controller._getAuthToken('mangalib', null);
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            '[PopupController] Failed to get cached auth token:',
            expect.any(Error)
        );
        warnSpy.mockRestore();
    });

    it('_getAuthToken executeScript func finds JWT directly in localStorage', async () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I8PLt4bWhFBYwI';
        global.browser.runtime.sendMessage = vi.fn(async () => ({ token: null }));
        global.localStorage = { length: 1, key: vi.fn(() => 'auth'), getItem: vi.fn(() => jwt) };
        global.sessionStorage = { length: 0, key: vi.fn(), getItem: vi.fn() };
        global.browser.scripting = { executeScript: vi.fn(async ({ func }) => [{ result: func() }]) };
        const controller = new PopupController();
        const result = await controller._getAuthToken('mangalib', 1);
        expect(result).toBe(jwt);
    });

    it('_getAuthToken executeScript func finds Bearer-prefixed JWT', async () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I8PLt4bWhFBYwI';
        global.browser.runtime.sendMessage = vi.fn(async () => ({ token: null }));
        global.localStorage = { length: 1, key: vi.fn(() => 'token'), getItem: vi.fn(() => `Bearer ${jwt}`) };
        global.sessionStorage = { length: 0, key: vi.fn(), getItem: vi.fn() };
        global.browser.scripting = { executeScript: vi.fn(async ({ func }) => [{ result: func() }]) };
        const controller = new PopupController();
        const result = await controller._getAuthToken('mangalib', 1);
        expect(result).toBe(jwt);
    });

    it('_getAuthToken executeScript func scans nested JSON objects via scanObj', async () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I8PLt4bWhFBYwI';
        global.browser.runtime.sendMessage = vi.fn(async () => ({ token: null }));
        global.localStorage = {
            length: 1,
            key: vi.fn(() => 'data'),
            getItem: vi.fn(() => JSON.stringify({ nullVal: null, nested: { inner: jwt } }))
        };
        global.sessionStorage = { length: 0, key: vi.fn(), getItem: vi.fn() };
        global.browser.scripting = { executeScript: vi.fn(async ({ func }) => [{ result: func() }]) };
        const controller = new PopupController();
        const result = await controller._getAuthToken('mangalib', 1);
        expect(result).toBe(jwt);
    });

    it('_getAuthToken executeScript func silently catches cacheAuthToken sendMessage rejection', async () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I8PLt4bWhFBYwI';
        global.browser.runtime.sendMessage = vi.fn(async (msg) => {
            if (msg.action === 'cacheAuthToken') throw new Error('cache fail');
            return { token: null };
        });
        global.localStorage = { length: 1, key: vi.fn(() => 'auth'), getItem: vi.fn(() => jwt) };
        global.sessionStorage = { length: 0, key: vi.fn(), getItem: vi.fn() };
        global.browser.scripting = { executeScript: vi.fn(async ({ func }) => [{ result: func() }]) };
        const controller = new PopupController();
        const result = await controller._getAuthToken('mangalib', 1);
        expect(result).toBe(jwt);
    });

    it('_getAuthToken executeScript func handles null, invalid JSON, and plain JSON entries', async () => {
        const values = [null, 'invalid-json', JSON.stringify({ text: 'not-a-jwt' })];
        let idx = 0;
        global.browser.runtime.sendMessage = vi.fn(async () => ({ token: null }));
        global.localStorage = {
            length: 3,
            key: vi.fn(i => `k${i}`),
            getItem: vi.fn(() => values[idx++])
        };
        global.sessionStorage = { length: 0, key: vi.fn(), getItem: vi.fn() };
        global.browser.scripting = { executeScript: vi.fn(async ({ func }) => [{ result: func() }]) };
        const controller = new PopupController();
        const result = await controller._getAuthToken('mangalib', 1);
        expect(result).toBeNull();
    });

    it('openInNewContext sends openWindowWithUrl to background in Chrome mode', async () => {
        const sendMessageMock = vi.fn(async () => ({ ok: true }));
        global.browser.runtime.sendMessage = sendMessageMock;
        global.browser = undefined;
        const controller = new PopupController();
        await controller.openInNewContext('popup.html?download=true');
        expect(sendMessageMock).toHaveBeenCalledWith({ action: 'openWindowWithUrl', url: 'popup.html?download=true' });
    });

    it('openInNewContext silently catches sendMessage rejection in Chrome mode', async () => {
        const sendMessageMock = vi.fn(async () => { throw new Error('port closed'); });
        global.browser.runtime.sendMessage = sendMessageMock;
        global.browser = undefined;
        const controller = new PopupController();
        await controller.openInNewContext('popup.html?download=true');
        await Promise.resolve();
        expect(sendMessageMock).toHaveBeenCalled();
    });
});