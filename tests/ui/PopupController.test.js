import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs/promises';
import vm from 'vm';

let PopupController;

function setupDOM() {
    document.body.innerHTML = `
        <button id="downloadBtn"></button>
        <div id="status"></div>
        <progress id="progress"></progress>
        <img id="siteLogo" />
        <div id="logoInfo"></div>
        <img id="cover" />
        <div id="description"></div>
        <div id="releaseDate"></div>
        <div id="activeDownloadsInfo"></div>
        <div id="error" class="hidden"></div>
        <div id="success" class="hidden"></div>
    `;
}

beforeEach(async () => {
    vi.resetModules();
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
    await import('../../ui/PopupController.js');
    PopupController = global.PopupController;
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

    it('Updates active downloads info', async () => {
        const controller = new PopupController();
        await controller.updateActiveDownloadsInfo();
        expect(document.getElementById('activeDownloadsInfo').style.display).toBe('block');
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

    it('Start download and disables UI', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        await controller.startDownload();
        expect(controller.isDownloading).toBe(true);
        expect(document.getElementById('downloadBtn').disabled).toBe(true);
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

	it('Update active downloads info in constructor', async () => {
        vi.resetModules();
        setupDOM();
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;

        let called = false;
        const origSetInterval = global.setInterval;
        global.setInterval = (fn, ms) => { fn(); return 1; };

        const PopupModule = await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;

        PopupControllerClass.prototype.updateActiveDownloadsInfo = function() {
            called = true;
        };

        new PopupControllerClass();

        expect(called).toBe(true);

        global.setInterval = origSetInterval;
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

        expect(consoleErrorSpy).toHaveBeenCalledWith('downloadBtn not found in DOM');
        consoleErrorSpy.mockRestore();
    });

	it('Warns if formatSelector found in DOM', async () => {
        vi.resetModules();
        setupDOM();
        const formatSelector = document.createElement('select');
        formatSelector.id = 'formatSelector';
        document.body.appendChild(formatSelector);
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;

        const consoleWarnSpy = vi.spyOn(console, 'warn');

        const PopupModule = await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();

        expect(consoleWarnSpy).toHaveBeenCalledWith('formatSelector found in DOM');
        consoleWarnSpy.mockRestore();
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

        const PopupModule = await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();

        const formatSelector = document.getElementById('formatSelector');
        formatSelector.value = 'pdf';
        formatSelector.dispatchEvent(new Event('change'));

        expect(setItemSpy).toHaveBeenCalledWith(FORMAT_STORAGE_KEY, 'pdf');
        setItemSpy.mockRestore();
    });

    it('Warns if RateLimitInput found in DOM', async () => {
        vi.resetModules();
        document.body.innerHTML = `<button id="downloadBtn"></button><input id="rateLimitInput" type="number" />`;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        expect(consoleWarnSpy).toHaveBeenCalledWith('rateLimitInput found in DOM');
        consoleWarnSpy.mockRestore();
    });

    it('EventListener clamps value correctly', async () => {
        document.body.innerHTML = `<button id="downloadBtn"></button>`;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        const input = document.getElementById('rateLimitInput');
        input.value = '1';
        input.dispatchEvent(new Event('input'));
        expect(input.value).toBe('2');
        input.value = '250';
        input.dispatchEvent(new Event('input'));
        expect(input.value).toBe('200');
        input.value = 'abc';
        input.dispatchEvent(new Event('input'));
        expect(input.value).toBe('2');
        input.value = '50.9';
        input.dispatchEvent(new Event('input'));
        expect(input.value).toBe('50');
    });

    it('Change on file input calls stopPropagation', async () => {
        document.body.innerHTML = `<button id="downloadBtn"></button>`;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        const input = document.getElementById('fileInput');
        const event = new Event('change');
        event.stopPropagation = vi.fn();
        Object.defineProperty(input, 'files', { value: [new File([''], 'test.fb2')], configurable: true });
        input.dispatchEvent(event);
        expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('Change on file input handles no file case', async () => {
        document.body.innerHTML = `<button id="downloadBtn"></button><div id="status"></div>`;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        const input = document.getElementById('fileInput');
        const btn = document.getElementById('downloadBtn');
        const status = document.getElementById('status');
        const formatSelector = document.getElementById('formatSelector');
        const customFileBtn = document.getElementById('customFileBtn');
        const event = new Event('change');
        event.stopPropagation = vi.fn();
        Object.defineProperty(input, 'files', { value: [], configurable: true });
        input.dispatchEvent(event);
        expect(formatSelector.disabled).toBe(false);
        expect(status.textContent).toBe('');
        expect(customFileBtn.textContent).toBe('Загрузить файл для обновления');
        expect(btn.textContent).toBe('Скачать');
        expect(btn.style.display).toBe('block');
    });

    it('Warns if status not found when resetting after file deselection', async () => {
        document.body.innerHTML = `<button id="downloadBtn"></button>`;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        const controller = new PopupControllerClass();
        const input = document.getElementById('fileInput');
        const event = new Event('change');
        event.stopPropagation = vi.fn();
        Object.defineProperty(input, 'files', { value: [], configurable: true });
        const formatSelector = document.getElementById('formatSelector');
        if (formatSelector && formatSelector.parentNode) formatSelector.parentNode.removeChild(formatSelector);
        const status = document.getElementById('status');
        if (status && status.parentNode) status.parentNode.removeChild(status);
        input.dispatchEvent(event);
        expect(consoleWarnSpy).toHaveBeenCalledWith('Status element not found when resetting after file deselection');
        consoleWarnSpy.mockRestore();
    });

    it('Sets status textContent to uploaded file name on file upload', async () => {
        document.body.innerHTML = `<button id="downloadBtn"></button><div id="status"></div>`;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        const input = document.getElementById('fileInput');
        const status = document.getElementById('status');
        const event = new Event('change');
        event.stopPropagation = vi.fn();
        Object.defineProperty(input, 'files', { value: [new File([''], 'test.fb2')], configurable: true });
        input.dispatchEvent(event);
        expect(status.textContent).toBe('Загружен файл: test.fb2');
    });

    it('Handles unsupported file type in fileInput change event', async () => {
        document.body.innerHTML = `<button id="downloadBtn"></button><div id="status"></div>`;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        const input = document.getElementById('fileInput');
        const status = document.getElementById('status');
        const formatSelector = document.getElementById('formatSelector');
        const customFileBtn = document.getElementById('customFileBtn');
        const btn = document.getElementById('downloadBtn');
        const event = new Event('change');
        event.stopPropagation = vi.fn();
        Object.defineProperty(input, 'files', { value: [new File([''], 'test.txt')], configurable: true });
        input.dispatchEvent(event);
        expect(formatSelector.disabled).toBe(false);
        expect(status.textContent).toBe('Ошибка: поддерживаются только файлы PDF, EPUB или FB2');
        expect(customFileBtn.textContent).toBe('Загрузить файл для обновления');
        expect(input.value).toBe('');
        expect(btn.textContent).toBe('Скачать');
    });

    it('Warns if status element not found when showing file type error', async () => {
        document.body.innerHTML = `<button id="downloadBtn"></button>`;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        const input = document.getElementById('fileInput');
        const event = new Event('change');
        event.stopPropagation = vi.fn();
        Object.defineProperty(input, 'files', { value: [new File([''], 'test.txt')], configurable: true });
        input.dispatchEvent(event);
        expect(consoleWarnSpy).toHaveBeenCalledWith('Status element not found when showing file type error');
        consoleWarnSpy.mockRestore();
    });

    it('Warns if fileInputContainer found in DOM', async () => {
        vi.resetModules();
        document.body.innerHTML = `<button id="downloadBtn"></button><div id="fileInputContainer"></div>`;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        expect(consoleWarnSpy).toHaveBeenCalledWith('fileInputContainer found in DOM');
        consoleWarnSpy.mockRestore();
    });

    it('Warns if downloadControls container found in DOM', async () => {
        vi.resetModules();
        document.body.innerHTML = `<button id="downloadBtn"></button><div id="downloadControls"></div>`;
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } };
        global.browser = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })), getURL: vi.fn() },
            windows: { getCurrent: vi.fn(), create: vi.fn(), update: vi.fn() },
            tabs: { query: vi.fn() }
        };
        global.chrome = undefined;
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        new PopupControllerClass();
        expect(consoleWarnSpy).toHaveBeenCalledWith('downloadControls container found in DOM');
        consoleWarnSpy.mockRestore();
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

    it('Logs no background downloads currently active', async () => {
        const controller = new PopupController();
        global.browser.runtime.sendMessage = vi.fn(async () => ({ ok: true, downloads: [] }));
        controller.isDownloading = true;
        const activeDownloadsInfo = document.getElementById('activeDownloadsInfo');
        const consoleLogSpy = vi.spyOn(console, 'log');
        await controller.updateActiveDownloadsInfo();
        expect(consoleLogSpy).toHaveBeenCalledWith('No background downloads currently active');
        consoleLogSpy.mockRestore();
    });

    it('Warns if failed to get active downloads', async () => {
        const controller = new PopupController();
        global.browser.runtime.sendMessage = vi.fn(async () => ({ ok: false, downloads: null }));
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.updateActiveDownloadsInfo();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to get active downloads or no downloads found:', { ok: false, downloads: null });
        consoleWarnSpy.mockRestore();
    });

    it('Logs error if exception thrown', async () => {
        const controller = new PopupController();
        const consoleErrorSpy = vi.spyOn(console, 'error');
        global.browser.runtime.sendMessage = vi.fn(() => { throw new Error('fail'); });
        await controller.updateActiveDownloadsInfo();
        expect(consoleErrorSpy).toHaveBeenCalledWith('[PopupController] Failed to get active downloads:', expect.any(Error));
        consoleErrorSpy.mockRestore();
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

    it('Disables UI and shows message if service is not found', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => null);
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://unknownsite.me/' }]));
        await controller.loadMetadata();
        expect(document.getElementById('logoInfo').textContent).toBe('');
        expect(document.getElementById('cover').style.display).toBe('none');
        expect(document.getElementById('description').textContent).toBe('Сперва откройте один из сайтов проекта MangaLib');
        expect(document.getElementById('releaseDate').textContent).toBe('');
        expect(document.getElementById('downloadBtn').disabled).toBe(true);
        expect(document.getElementById('status').textContent).toBe('');
    });

    it('Warns for missing elements when showing no service error', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => null);
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://unknownsite.me/' }]));
        const coverImg = document.getElementById('cover');
        const desc = document.getElementById('description');
        const releaseEl = document.getElementById('releaseDate');
        const status = document.getElementById('status');
        if (coverImg && coverImg.parentNode) coverImg.parentNode.removeChild(coverImg);
        if (desc && desc.parentNode) desc.parentNode.removeChild(desc);
        if (releaseEl && releaseEl.parentNode) releaseEl.parentNode.removeChild(releaseEl);
        if (status && status.parentNode) status.parentNode.removeChild(status);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('No service found for current URL');
        expect(consoleWarnSpy).toHaveBeenCalledWith('Description element found when showing no service error');
        expect(consoleWarnSpy).toHaveBeenCalledWith('Release date element found when showing no service error');
        expect(consoleWarnSpy).toHaveBeenCalledWith('Status element not found when showing no service error');
        consoleWarnSpy.mockRestore();
    });

    it('Warns for missing elements when showing no slug error', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({ name: 'ranobelib', fetchMangaMetadata: vi.fn(), fetchChaptersList: vi.fn() }));
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true
        });
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/' }]));
        const coverImg = document.getElementById('cover');
        const desc = document.getElementById('description');
        const releaseEl = document.getElementById('releaseDate');
        const status = document.getElementById('status');
        if (coverImg && coverImg.parentNode) coverImg.parentNode.removeChild(coverImg);
        if (desc && desc.parentNode) desc.parentNode.removeChild(desc);
        if (releaseEl && releaseEl.parentNode) releaseEl.parentNode.removeChild(releaseEl);
        if (status && status.parentNode) status.parentNode.removeChild(status);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Cover image element not found when showing no slug error');
        expect(consoleWarnSpy).toHaveBeenCalledWith('Description element found when showing no slug error');
        expect(consoleWarnSpy).toHaveBeenCalledWith('Release date element found when showing no slug error');
        expect(consoleWarnSpy).toHaveBeenCalledWith('Status element not found when showing no slug error');
        consoleWarnSpy.mockRestore();
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

    it('Uses meta.description or fallback text when summary is missing', async () => {
        const controller = new PopupController();
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    name: 'MetaName',
                    description: 'MetaDescription',
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
        expect(document.getElementById('description').innerHTML).toContain('MetaDescription');

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
        expect(consoleWarnSpy).toHaveBeenCalledWith('No valid cover URL found in meta.cover object');
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

    it('Sets authors to null if meta.authors is not an array', async () => {
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
        expect(document.getElementById('logoInfo').textContent).not.toContain('Авторы:');
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

    it('Warns if no rating information found in metadata', async () => {
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
        expect(consoleWarnSpy).toHaveBeenCalledWith('No rating information found in metadata');
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

    it('Warns if status element not found when prompting for file selection in separate window', async () => {
        const controller = new PopupController();
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(true);
        const customFileBtn = document.getElementById('customFileBtn');
        const status = document.getElementById('status');
        if (status && status.parentNode) status.parentNode.removeChild(status);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        await customFileBtn.onclick();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Status element not found when prompting for file selection in separate window');
        consoleWarnSpy.mockRestore();
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

    it('Warns if status element not found when showing window creation error', async () => {
        const controller = new PopupController();
        const customFileBtn = document.getElementById('customFileBtn');
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockRejectedValue(new Error('fail create'));
        const status = document.getElementById('status');
        if (status && status.parentNode) status.parentNode.removeChild(status);
        const hiddenFileInput = document.getElementById('fileInput');
        const clickSpy = vi.spyOn(hiddenFileInput, 'click');
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        const consoleErrorSpy = vi.spyOn(console, 'error');
        await controller.loadMetadata();
        await customFileBtn.onclick();
        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to create window:', expect.any(Error));
        expect(consoleWarnSpy).toHaveBeenCalledWith('Status element not found when showing window creation error');
        expect(clickSpy).toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
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

    it('Warns if status element not found when prompting for file selection after error', async () => {
        const controller = new PopupController();
        const customFileBtn = document.getElementById('customFileBtn');
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockImplementation(() => { throw new Error('fail isInSeparateWindow'); });
        const status = document.getElementById('status');
        if (status && status.parentNode) status.parentNode.removeChild(status);
        const hiddenFileInput = document.getElementById('fileInput');
        const clickSpy = vi.spyOn(hiddenFileInput, 'click');
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        const consoleErrorSpy = vi.spyOn(console, 'error');
        await controller.loadMetadata();
        await customFileBtn.onclick();
        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to handle file upload:', expect.any(Error));
        expect(consoleWarnSpy).toHaveBeenCalledWith('Status element not found when prompting for file selection after error');
        expect(clickSpy).toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
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

    it('Warns if custom file button not found when setting up file upload handler', async () => {
        const controller = new PopupController();
        const customFileBtn = document.getElementById('customFileBtn');
        if (customFileBtn && customFileBtn.parentNode) customFileBtn.parentNode.removeChild(customFileBtn);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        await controller.loadMetadata();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Custom file button not found when setting up file upload handler');
        consoleWarnSpy.mockRestore();
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

    it('Defaults format to fb2 if formatSelector is missing when download button clicked', async () => {
        const controller = new PopupController();
        const formatSelector = document.getElementById('formatSelector');
        if (formatSelector && formatSelector.parentNode) formatSelector.parentNode.removeChild(formatSelector);
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockResolvedValue({ id: 123 });
        const downloadBtn = document.getElementById('downloadBtn');
        await downloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const urlArg = windowsCreateSpy.mock.calls[0][0].url;
        expect(urlArg).toContain('format=fb2');
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
    });

    it('Defaults rateLimit to 100 if rateLimitInput value is empty or invalid', async () => {
        const controller = new PopupController();
        const rateLimitInput = document.getElementById('rateLimitInput');
        rateLimitInput.value = '';
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockResolvedValue({ id: 123 });
        const downloadBtn = document.getElementById('downloadBtn');
        await downloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const urlArg = windowsCreateSpy.mock.calls[0][0].url;
        expect(urlArg).toContain('rateLimit=100');
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
    });

    it('Defaults rateLimit to 100 if rateLimitInput is missing', async () => {
        const controller = new PopupController();
        const rateLimitInput = document.getElementById('rateLimitInput');
        if (rateLimitInput && rateLimitInput.parentNode) rateLimitInput.parentNode.removeChild(rateLimitInput);
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockResolvedValue({ id: 123 });
        const downloadBtn = document.getElementById('downloadBtn');
        await downloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const urlArg = windowsCreateSpy.mock.calls[0][0].url;
        expect(urlArg).toContain('rateLimit=100');
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
    });

    it('Calls windows update after window creation', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockResolvedValue({ id: 123 });
        const windowsUpdateSpy = vi.spyOn(global.browser.windows, 'update').mockResolvedValue({});
        const downloadBtn = document.getElementById('downloadBtn');
        await downloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 600));
        expect(windowsUpdateSpy).toHaveBeenCalledWith(123, { focused: true });
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
        windowsUpdateSpy.mockRestore();
    });

    it('Warns if window created but no ID found', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockResolvedValue({});
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        const downloadBtn = document.getElementById('downloadBtn');
        await downloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(consoleWarnSpy).toHaveBeenCalledWith('Window created but no ID found:', {});
        consoleWarnSpy.mockRestore();
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
    });

    it('Handles error in window creation and calls startDownload', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const isInSeparateWindowSpy = vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockRejectedValue(new Error('fail create'));
        const startDownloadSpy = vi.spyOn(controller, 'startDownload').mockResolvedValue();
        const consoleErrorSpy = vi.spyOn(console, 'error');
        const downloadBtn = document.getElementById('downloadBtn');
        await downloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to create window:', expect.any(Error));
        expect(startDownloadSpy).toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
        isInSeparateWindowSpy.mockRestore();
        windowsCreateSpy.mockRestore();
        startDownloadSpy.mockRestore();
    });

    it('Toggles pause state when button clicked', async () => {
        const controller = new PopupController();
        const pauseBtn = document.getElementById('pauseBtn');
        const status = document.getElementById('status');
        pauseBtn.click();
        expect(controller.isPaused).toBe(true);
        expect(pauseBtn.textContent).toBe('Продолжить');
        expect(status.textContent).toBe('Пауза...');
        pauseBtn.click();
        expect(controller.isPaused).toBe(false);
        expect(pauseBtn.textContent).toBe('Пауза');
        expect(status.textContent).toBe('Загрузка...');
    });

    it('Warns if status element not found when updating status on pause/resume', async () => {
        const controller = new PopupController();
        const pauseBtn = document.getElementById('pauseBtn');
        const status = document.getElementById('status');
        if (status && status.parentNode) status.parentNode.removeChild(status);
        const consoleWarnSpy = vi.spyOn(console, 'warn');
        pauseBtn.click();
        expect(consoleWarnSpy).toHaveBeenCalledWith('Status element not found when updating status on pause/resume');
        consoleWarnSpy.mockRestore();
    });

    it('Calls stopDownload when stop button clicked', async () => {
        const controller = new PopupController();
        const stopDownloadSpy = vi.spyOn(controller, 'stopDownload');
        const stopBtn = document.getElementById('stopBtn');
        stopBtn.click();
        expect(stopDownloadSpy).toHaveBeenCalled();
        stopDownloadSpy.mockRestore();
    });

    it('Logs error and returns early if currentDownloadId is missing when background button clicked', async () => {
        const controller = new PopupController();
        controller.currentDownloadId = null;
        const backgroundBtn = document.getElementById('backgroundBtn');
        const consoleErrorSpy = vi.spyOn(console, 'error');
        backgroundBtn.click();
        expect(consoleErrorSpy).toHaveBeenCalledWith('[PopupController] No currentDownloadId:', null);
        consoleErrorSpy.mockRestore();
    });

    it('Logs attempt to move download to background', async () => {
        const controller = new PopupController();
        controller.currentDownloadId = 42;
        const backgroundBtn = document.getElementById('backgroundBtn');
        const consoleLogSpy = vi.spyOn(console, 'log');
        backgroundBtn.click();
        expect(consoleLogSpy).toHaveBeenCalledWith('[PopupController] Attempting to move download to background with ID:', 42);
        consoleLogSpy.mockRestore();
    });
});