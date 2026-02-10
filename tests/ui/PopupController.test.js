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
});