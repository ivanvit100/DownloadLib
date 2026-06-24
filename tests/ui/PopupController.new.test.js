import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let PopupController;
let intervals = [];
let originalSetInterval;

function setupDOM() {
    document.body.innerHTML = `
        <button id="downloadBtn"></button>
        <button id="pauseBtn"></button>
        <button id="stopBtn"></button>
        <div id="status"></div>
        <progress id="progress"></progress>
        <img id="siteLogo" />
        <div id="logoInfo"></div>
        <img id="cover" />
        <div id="description"></div>
        <div id="releaseDate"></div>
        <div id="error" class="hidden"></div>
        <div id="success" class="hidden"></div>
    `;
}

beforeEach(async () => {
    vi.resetModules();
    delete global.getExtensionApi;

    intervals = [];
    if (!originalSetInterval) {
        originalSetInterval = global.setInterval;
    }
    global.setInterval = vi.fn((fn, ms) => {
        const id = originalSetInterval(() => {
            if (typeof document !== 'undefined' && document && document.body) {
                try { fn(); } catch (e) { /* ignore */ }
            }
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
                    rus_name: 'Title', summary: 'Summary', cover: 'cover.png',
                    authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020'
                },
                image: 'cover.png'
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [{}, {}] }))
        })),
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
    global.ExporterRegistry = {
        getFormats: vi.fn(() => [
            { value: 'fb2', label: 'FB2' },
            { value: 'epub', label: 'EPUB' },
            { value: 'pdf', label: 'PDF' },
            { value: 'mobi', label: 'MOBI' },
            { value: 'simple', label: 'TXT/JPEG' },
        ]),
    };

    await import('../../core/MangaPatcher.js');
    await import('../../ui/PopupController.js');
    PopupController = global.PopupController;
});

afterEach(() => {
    intervals.forEach(id => originalSetInterval && clearInterval(id));
    intervals = [];
    vi.restoreAllMocks();
    vi.clearAllTimers();
});

describe('PopupController second test file', () => {
    it('Handles progress, completed and failed events from eventBus', async () => {
        const controller = new PopupController();
        const updateProgressSpy = vi.spyOn(controller, 'updateProgress');
        const showSuccessSpy = vi.spyOn(controller, 'showSuccess');
        const resetUISpy = vi.spyOn(controller, 'resetUI');
        const showErrorSpy = vi.spyOn(controller, 'showError');

        const eventHandlers = {};
        controller.downloadManager.eventBus.on = (event, handler) => { eventHandlers[event] = handler; };

        controller.subscribeToEvents();

        eventHandlers['download:progress']({ status: 'downloading', progress: 42 });
        expect(updateProgressSpy).toHaveBeenCalledWith('downloading', 42);

        controller.loadedFile = null;
        eventHandlers['download:completed']();
        expect(showSuccessSpy).toHaveBeenCalledWith('Загрузка завершена!');
        expect(resetUISpy).toHaveBeenCalled();

        eventHandlers['download:failed']({ error: { message: 'fail' } });
        expect(showErrorSpy).toHaveBeenCalledWith('fail');
        expect(resetUISpy).toHaveBeenCalled();
    });

    it('Shows updated file message when completed event fires and loadedFile is set', async () => {
        const controller = new PopupController();
        controller.loadedFile = {};
        const showSuccessSpy = vi.spyOn(controller, 'showSuccess');
        const resetUISpy = vi.spyOn(controller, 'resetUI');

        const eventHandlers = {};
        controller.downloadManager.eventBus.on = (event, handler) => { eventHandlers[event] = handler; };

        controller.subscribeToEvents();

        eventHandlers['download:completed']();

        expect(showSuccessSpy).toHaveBeenCalledWith('Файл обновлён!');
        expect(resetUISpy).toHaveBeenCalled();
    });

    it('Uses default rate limit if rateLimitInput is empty or invalid', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const rateLimitInput = document.getElementById('rateLimitInput');
        rateLimitInput.value = '';
        const sendMessageSpy = vi.spyOn(global.browser.runtime, 'sendMessage');

        await controller.startDownload();

        expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'setRateLimit', limit: 100 }));

        rateLimitInput.value = 'notanumber';
        await controller.startDownload();
        expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'setRateLimit', limit: 100 }));
    });

    it('Warns in console if rateLimitInput is missing when setting rate limit', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const rateLimitInput = document.getElementById('rateLimitInput');
        rateLimitInput.parentNode.removeChild(rateLimitInput);
        const warnSpy = vi.spyOn(console, 'warn');

        await controller.startDownload();

        expect(warnSpy).toHaveBeenCalledWith('Rate limit input not found when setting rate limit');
    });

    it('Triggers every warning when all optional elements are missing during download start', async () => {
        document.body.innerHTML = `
            <button id="downloadBtn"></button>
            <div id="status"></div>
            <div id="error" class="hidden"></div>
            <div id="success" class="hidden"></div>
        `;

        global.DownloadManager = class {
            constructor() { this.eventBus = { on: vi.fn() }; }
            startDownload = vi.fn(async () => ({ updated: true, addedChapters: 1 }));
            stop = vi.fn();
            getDownloadState = vi.fn(() => null);
        };
        global.browser.runtime.sendMessage = vi.fn(async () => ({ ok: true, downloads: [] }));

        const warnSpy = vi.spyOn(console, 'warn');

        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        const idsToRemove = [
            'formatContainer', 'rateLimitContainer', 'fileInput', 'customFileBtn',
            'fileInputContainer', 'progress', 'siteLogo', 'downloadControls',
            'chapterRangeContainer'
        ];
        idsToRemove.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.parentNode.removeChild(el);
        });

        warnSpy.mockClear();

        await controller.startDownload();

        const expectedWarnings = [
            'Rate limit input not found when setting rate limit',
            'Format container not found when hiding during download',
            'Rate limit container not found when hiding during download',
            'Hidden file input not found when disabling during download',
            'Custom file button not found when disabling during download',
            'File input container not found when disabling during download',
            'Progress element not found when showing during download',
            'Controls container not found when showing during download',
            'Chapter range container not found when hiding during download',
        ];

        expectedWarnings.forEach(msg => {
            expect(warnSpy).toHaveBeenCalledWith(msg);
        });

        expect(
            warnSpy.mock.calls.filter(call =>
                expectedWarnings.includes(call[0])
            ).length
        ).toBe(expectedWarnings.length);
    });

    it('Sets update status text when loaded file is present', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        controller.downloadManager.startDownload = vi.fn(async () => ({}));
        controller.loadedFile = { name: 'test.fb2' };

        const setTextSpy = vi.fn();
        const status = document.getElementById('status');
        Object.defineProperty(status, 'textContent', {
            set: setTextSpy,
            get: () => '',
            configurable: true
        });

        await controller.startDownload();

        expect(setTextSpy).toHaveBeenCalledWith('Запуск обновления...');
    });

    it('Warns when status element is missing during download start', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        controller.downloadManager.startDownload = vi.fn(async () => ({}));

        const status = document.getElementById('status');
        if (status) status.parentNode.removeChild(status);

        const warnSpy = vi.spyOn(console, 'warn');

        await controller.startDownload();

        expect(warnSpy).toHaveBeenCalledWith('Status element not found when setting initial status for download start');
    });

    it('Controller callbacks correctly reflect and mutate pause and stop state', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        let capturedController;
        controller.downloadManager.startDownload = vi.fn(async (opts) => {
            capturedController = opts.controller;
            return {};
        });

        controller.isPaused = false;
        controller.shouldStop = false;

        await controller.startDownload();

        expect(capturedController).toBeDefined();

        expect(capturedController.isPaused()).toBe(false);
        controller.isPaused = true;
        expect(capturedController.isPaused()).toBe(true);

        expect(capturedController.shouldStop()).toBe(false);
        controller.shouldStop = true;
        expect(capturedController.shouldStop()).toBe(true);

        controller.shouldStop = false;
        capturedController.stop();
        expect(controller.shouldStop).toBe(true);

        controller.isPaused = true;
        controller.shouldStop = false;
        const waitPromise = capturedController.waitIfPaused();
        await new Promise(resolve => setTimeout(resolve, 120));
        controller.isPaused = false;
        await waitPromise;
        expect(controller.isPaused).toBe(false);
    });

    it('Sets status text to file is already up to date', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        controller.downloadManager.startDownload = vi.fn(async () => ({
            updated: false,
            addedChapters: 0
        }));

        const status = document.getElementById('status');
        status.textContent = '';

        controller.loadedFile = { name: 'test.fb2' };

        await controller.startDownload();

        expect(status.textContent).toBe('Файл уже актуален!');
    });

    it('Handles error in download and calls error display and UI reset', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        const errorSpy = vi.spyOn(console, 'error');
        const showErrorSpy = vi.spyOn(controller, 'showError');
        const resetUISpy = vi.spyOn(controller, 'resetUI');

        controller.downloadManager.startDownload = vi.fn(async () => {
            throw new Error('Download failed test');
        });

        await controller.startDownload();

        expect(errorSpy).toHaveBeenCalledWith('[PopupController] Download failed:', expect.any(Error));
        expect(showErrorSpy).toHaveBeenCalledWith('Download failed test');
        expect(resetUISpy).toHaveBeenCalled();
    });

    it('Warns when status element is missing for download result message', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        controller.downloadManager.startDownload = vi.fn(async () => ({
            updated: true,
            addedChapters: 5
        }));

        const status = document.getElementById('status');
        if (status) status.parentNode.removeChild(status);

        const warnSpy = vi.spyOn(console, 'warn');

        await controller.startDownload();

        expect(warnSpy).toHaveBeenCalledWith('Status element not found when showing download result message');
    });

    it('Warns when status element is missing on download stop', async () => {
        const controller = new PopupController();

        const status = document.getElementById('status');
        if (status) status.parentNode.removeChild(status);

        const warnSpy = vi.spyOn(console, 'warn');

        controller.stopDownload();

        expect(warnSpy).toHaveBeenCalledWith('Status element not found when setting status on download stop');
    });

    it('Warns when status or progress element is missing during progress update', async () => {
        const controller = new PopupController();

        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.parentNode.removeChild(statusEl);

        const progressEl = document.getElementById('progress');
        if (progressEl) progressEl.parentNode.removeChild(progressEl);

        const warnSpy = vi.spyOn(console, 'warn');

        controller.updateProgress('Загрузка...', 55);

        expect(warnSpy).toHaveBeenCalledWith('Status element not found when updating progress status');
        expect(warnSpy).toHaveBeenCalledWith('Progress element not found when updating progress percentage');
    });

    it('Warns when download button is missing during UI reset', async () => {
        const controller = new PopupController();

        const btn = document.getElementById('downloadBtn');
        if (btn) btn.parentNode.removeChild(btn);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Download button not found when resetting UI');
    });

    it('Warns when format container is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('formatContainer');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Format container not found when resetting UI');
    });

    it('Warns when rate limit container is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('rateLimitContainer');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Rate limit container not found when resetting UI');
    });

    it('Warns when hidden file input is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('fileInput');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Hidden file input not found when resetting UI');
    });

    it('Warns when custom file button is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('customFileBtn');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Custom file button not found when resetting UI');
    });

    it('Warns when progress element is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('progress');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Progress element not found when resetting UI');
    });

    it('Warns when controls container is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('downloadControls');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Controls container not found when resetting UI');
    });

    it('Warns when chapter range container is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('chapterRangeContainer');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Chapter range container not found when resetting UI');
    });

    it('Warns when fileInputContainer is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('fileInputContainer');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('File input container not found when resetting UI');
    });

    it('Warns when error element is missing during error display', async () => {
        const controller = new PopupController();

        const errorEl = document.getElementById('error');
        if (errorEl) errorEl.parentNode.removeChild(errorEl);

        const warnSpy = vi.spyOn(console, 'warn');

        controller.showError('Ошибка теста');

        expect(warnSpy).toHaveBeenCalledWith('Error element not found when showing error message');
    });

    it('Warns when success element is missing during success display', async () => {
        const controller = new PopupController();

        const successEl = document.getElementById('success');
        if (successEl) successEl.parentNode.removeChild(successEl);

        const warnSpy = vi.spyOn(console, 'warn');

        controller.showSuccess('Успешно!');

        expect(warnSpy).toHaveBeenCalledWith('Success element not found when showing success message');
    });

    it('Warns when status element is missing during pause/resume event', async () => {
        const controller = new PopupController();

        const pauseBtn = document.getElementById('pauseBtn');
        const status = document.getElementById('status');
        if (status) status.parentNode.removeChild(status);

        const warnSpy = vi.spyOn(console, 'warn');

        pauseBtn.click();

        expect(warnSpy).toHaveBeenCalledWith('Status element not found when updating status on pause/resume');
    });

    it('Warns when chapter range selectors are missing when constructing URL parameters for download', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        controller.isInSeparateWindow = vi.fn(async () => false);
        controller.loadedFile = null;

        await new Promise(resolve => setTimeout(resolve, 100));

        const fromSelect = document.getElementById('chapterFromSelect');
        if (fromSelect) fromSelect.parentNode.removeChild(fromSelect);
        const toSelect = document.getElementById('chapterToSelect');
        if (toSelect) toSelect.parentNode.removeChild(toSelect);

        const warnSpy = vi.spyOn(console, 'warn');

        const downloadBtn = document.getElementById('downloadBtn');
        downloadBtn.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(warnSpy).toHaveBeenCalledWith('Chapter range selectors not found or not visible when constructing URL parameters for download');
    });

    it('Restores chapter range from URL parameters when chapterFrom and chapterTo are present', async () => {
        Object.defineProperty(window, 'location', {
            value: { search: '?chapterFrom=1&chapterTo=3' },
            configurable: true
        });

        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

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
            fetchChaptersList: vi.fn(async () => ({
                data: [
                    { volume: 1, number: 1 },
                    { volume: 1, number: 2 },
                    { volume: 1, number: 3 },
                    { volume: 1, number: 4 }
                ]
            }))
        }));

        await controller.loadMetadata();

        const fromSelect = document.getElementById('chapterFromSelect');
        const toSelect = document.getElementById('chapterToSelect');

        expect(fromSelect).not.toBeNull();
        expect(toSelect).not.toBeNull();
        expect(fromSelect.value).toBe('1');
        expect(toSelect.value).toBe('3');
    });

    it('Clamps toSelect value when fromSelect changes to a higher index', async () => {
        const controller = new PopupController();

        await new Promise(resolve => setTimeout(resolve, 100));

        const fromSelect = document.getElementById('chapterFromSelect');
        const toSelect = document.getElementById('chapterToSelect');

        const opt1 = document.createElement('option');
        opt1.value = '1';
        const opt2 = document.createElement('option');
        opt2.value = '2';
        const opt3 = document.createElement('option');
        opt3.value = '3';

        [opt1, opt2, opt3].forEach(o => { fromSelect.appendChild(o.cloneNode(true)); toSelect.appendChild(o.cloneNode(true)); });

        fromSelect.value = '3';
        toSelect.value = '1';
        fromSelect.dispatchEvent(new Event('change'));

        expect(toSelect.value).toBe('3');
    });

    it('Clamps fromSelect value when toSelect changes to a lower index', async () => {
        const controller = new PopupController();

        await new Promise(resolve => setTimeout(resolve, 100));

        const fromSelect = document.getElementById('chapterFromSelect');
        const toSelect = document.getElementById('chapterToSelect');

        const opt1 = document.createElement('option');
        opt1.value = '1';
        const opt2 = document.createElement('option');
        opt2.value = '2';
        const opt3 = document.createElement('option');
        opt3.value = '3';

        [opt1, opt2, opt3].forEach(o => { fromSelect.appendChild(o.cloneNode(true)); toSelect.appendChild(o.cloneNode(true)); });

        fromSelect.value = '3';
        toSelect.value = '1';
        toSelect.dispatchEvent(new Event('change'));

        expect(fromSelect.value).toBe('1');
    });

    it('Logs no saved format when localStorage has no format and logs UI setup complete', async () => {
        const logSpy = vi.spyOn(console, 'log');

        new PopupController();

        expect(logSpy).toHaveBeenCalledWith('No saved format in localStorage');
        expect(logSpy).toHaveBeenCalledWith('[PopupController] UI setup complete');
    });

    it('Logs valid range message when fromSelect changes without exceeding toSelect', async () => {
        const controller = new PopupController();

        await new Promise(resolve => setTimeout(resolve, 100));

        const fromSelect = document.getElementById('chapterFromSelect');
        const toSelect = document.getElementById('chapterToSelect');

        const opt1 = document.createElement('option');
        opt1.value = '1';
        const opt2 = document.createElement('option');
        opt2.value = '2';
        [opt1, opt2].forEach(o => { fromSelect.appendChild(o.cloneNode(true)); toSelect.appendChild(o.cloneNode(true)); });

        fromSelect.value = '1';
        toSelect.value = '2';

        const logSpy = vi.spyOn(console, 'log');

        fromSelect.dispatchEvent(new Event('change'));

        expect(logSpy).toHaveBeenCalledWith('Chapter range selectors updated without invalid range');
    });

    it('Logs valid range message when toSelect changes without going below fromSelect', async () => {
        const controller = new PopupController();

        await new Promise(resolve => setTimeout(resolve, 100));

        const fromSelect = document.getElementById('chapterFromSelect');
        const toSelect = document.getElementById('chapterToSelect');

        const opt1 = document.createElement('option');
        opt1.value = '1';
        const opt2 = document.createElement('option');
        opt2.value = '2';
        [opt1, opt2].forEach(o => { fromSelect.appendChild(o.cloneNode(true)); toSelect.appendChild(o.cloneNode(true)); });

        fromSelect.value = '1';
        toSelect.value = '2';

        const logSpy = vi.spyOn(console, 'log');

        toSelect.dispatchEvent(new Event('change'));

        expect(logSpy).toHaveBeenCalledWith('Chapter range selectors updated without invalid range');
    });

    it('Defaults format to fb2 when formatSelector is absent in window creation path', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const formatSelector = document.getElementById('formatSelector');
        if (formatSelector && formatSelector.parentNode) formatSelector.parentNode.removeChild(formatSelector);
        controller.isInSeparateWindow = vi.fn().mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockResolvedValue({ id: 123 });
        const downloadBtn = document.getElementById('downloadBtn');
        downloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const urlArg = windowsCreateSpy.mock.calls[0]?.[0]?.url;
        expect(urlArg).toContain('format=fb2');
        windowsCreateSpy.mockRestore();
    });

    it('Uses 200 as maxSizeMB when maxSizeInput is absent in window creation path, and splitModeContainer is hidden on startDownload and shown on resetUI', async () => {
        const splitModeContainer = document.createElement('div');
        splitModeContainer.id = 'splitModeContainer';
        splitModeContainer.style.display = 'block';
        document.body.appendChild(splitModeContainer);
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const maxSizeInput = document.getElementById('maxSizeInput');
        if (maxSizeInput && maxSizeInput.parentNode) maxSizeInput.parentNode.removeChild(maxSizeInput);
        controller.isInSeparateWindow = vi.fn().mockResolvedValue(false);
        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockResolvedValue({ id: 123 });
        const downloadBtn = document.getElementById('downloadBtn');
        downloadBtn.click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const urlArg = windowsCreateSpy.mock.calls[0]?.[0]?.url;
        expect(urlArg).toContain('maxSizeMB=200');
        windowsCreateSpy.mockRestore();
        await controller.startDownload();
        expect(splitModeContainer.style.display).toBe('none');
        controller.resetUI();
        expect(splitModeContainer.style.display).toBe('block');
    });

    it('openInNewContext uses tabs.create when windows API is unavailable and tab is returned', async () => {
        const controller = new PopupController();
        delete global.browser.windows;
        global.browser.tabs = { create: vi.fn(async () => ({ id: 5, active: true })) };

        const warnSpy = vi.spyOn(console, 'warn');
        await controller.openInNewContext('popup.html?test=1');

        expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'popup.html?test=1', active: true });
        expect(warnSpy).not.toHaveBeenCalledWith('Tab created but no ID found:', expect.anything());
    });

    it('openInNewContext warns when tabs.create returns null', async () => {
        const controller = new PopupController();
        delete global.browser.windows;
        global.browser.tabs = { create: vi.fn(async () => null) };

        const warnSpy = vi.spyOn(console, 'warn');
        await controller.openInNewContext('popup.html?test=1');

        expect(warnSpy).toHaveBeenCalledWith('Tab created but no ID found:', null);
    });

    it('openInNewContext logs error when neither windows nor tabs API is available', async () => {
        const controller = new PopupController();
        delete global.browser.windows;
        delete global.browser.tabs;

        const errorSpy = vi.spyOn(console, 'error');
        await controller.openInNewContext('popup.html?test=1');

        expect(errorSpy).toHaveBeenCalledWith('No window/tab API available');
    });

    it('_setupTranslatorSelector returns null when translatorContainer is missing from DOM', () => {
        const controller = new PopupController();
        const tc = document.getElementById('translatorContainer');
        if (tc) tc.parentNode.removeChild(tc);

        const result = controller._setupTranslatorSelector([{ branches: [{ branch_id: 1 }] }], null);
        expect(result).toBeNull();
    });

    it('_setupTranslatorSelector hides container and returns null when chapters have no branches', () => {
        const controller = new PopupController();
        const tc = document.getElementById('translatorContainer');
        tc.style.display = 'block';

        const result = controller._setupTranslatorSelector([{ volume: 1 }, { volume: 2 }], null);

        expect(tc.style.display).toBe('none');
        expect(result).toBeNull();
    });

    it('_setupTranslatorSelector hides container and returns branch id for single branch', () => {
        const controller = new PopupController();
        const tc = document.getElementById('translatorContainer');
        tc.style.display = 'block';

        const result = controller._setupTranslatorSelector([
            { branches: [{ branch_id: 5, teams: [{ name: 'Solo Team' }] }] }
        ], null);

        expect(tc.style.display).toBe('none');
        expect(result).toBe(5);
    });

    it('_setupTranslatorSelector shows selector with team names when multiple branches exist', () => {
        const controller = new PopupController();
        const chapters = [
            { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] },
            { /* no branches */ }
        ];

        const result = controller._setupTranslatorSelector(chapters, null);

        const tc = document.getElementById('translatorContainer');
        expect(tc.style.display).toBe('block');
        const ts = document.getElementById('translatorSelect');
        expect(ts.options.length).toBe(2);
        expect(ts.options[0].textContent).toBe('Team A');
        expect(ts.options[1].textContent).toBe('Team B');
        expect(result).toBe(1);
    });

    it('_setupTranslatorSelector uses default name when branch has no teams', () => {
        const controller = new PopupController();
        const chapters = [
            { branches: [{ branch_id: 10 }, { branch_id: 20 }] }
        ];

        controller._setupTranslatorSelector(chapters, null);

        const ts = document.getElementById('translatorSelect');
        expect(ts.options[0].textContent).toBe('Перевод 10');
        expect(ts.options[1].textContent).toBe('Перевод 20');
    });

    it('_setupTranslatorSelector uses branchIdFromUrl when it matches a known branch', () => {
        const controller = new PopupController();
        const chapters = [
            { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] }
        ];

        const result = controller._setupTranslatorSelector(chapters, '2');

        expect(result).toBe(2);
        const ts = document.getElementById('translatorSelect');
        expect(Number(ts.value)).toBe(2);
    });

    it('_setupTranslatorSelector onchange repopulates chapter selects with filtered chapters', () => {
        const controller = new PopupController();
        const chapters = [
            { volume: 1, number: 1, branches: [{ branch_id: 1, teams: [{ name: 'A' }] }, { branch_id: 2, teams: [{ name: 'B' }] }] },
            { volume: 1, number: 2, branches: [{ branch_id: 2, teams: [{ name: 'B' }] }] }
        ];
        controller._allChapters = chapters;

        controller._setupTranslatorSelector(chapters, null);

        const repopulateSpy = vi.spyOn(controller, '_repopulateChapterSelects');
        const ts = document.getElementById('translatorSelect');
        ts.value = '2';
        ts.dispatchEvent(new Event('change'));

        expect(repopulateSpy).toHaveBeenCalled();
    });

    it('_setupTranslatorSelector onchange skips repopulate when chapter selects are removed from DOM', () => {
        const controller = new PopupController();
        const chapters = [
            { volume: 1, number: 1, branches: [{ branch_id: 1, teams: [{ name: 'A' }] }, { branch_id: 2, teams: [{ name: 'B' }] }] }
        ];
        controller._allChapters = chapters;

        controller._setupTranslatorSelector(chapters, null);

        const fromSelect = document.getElementById('chapterFromSelect');
        if (fromSelect) fromSelect.parentNode.removeChild(fromSelect);

        const repopulateSpy = vi.spyOn(controller, '_repopulateChapterSelects');
        const ts = document.getElementById('translatorSelect');
        ts.value = '2';
        ts.dispatchEvent(new Event('change'));

        expect(repopulateSpy).not.toHaveBeenCalled();
    });

    it('_getFilteredChapters returns only chapters matching the given branchId', () => {
        const controller = new PopupController();
        controller._allChapters = [
            { volume: 1, number: 1, branches: [{ branch_id: 1 }] },
            { volume: 1, number: 2, branches: [{ branch_id: 2 }] },
            { volume: 1, number: 3, branches: [{ branch_id: 1 }, { branch_id: 2 }] },
            { volume: 2, number: 1 }
        ];

        const result = controller._getFilteredChapters(1);

        expect(result).toHaveLength(2);
        expect(result[0].number).toBe(1);
        expect(result[1].number).toBe(3);
    });

    it('Appends branchId to URL params when translatorContainer is visible during download button click', async () => {
        const controller = new PopupController();
        controller.isInSeparateWindow = vi.fn().mockResolvedValue(false);
        controller.loadedFile = null;

        await new Promise(resolve => setTimeout(resolve, 100));

        const tc = document.getElementById('translatorContainer');
        tc.style.display = 'block';
        const ts = document.getElementById('translatorSelect');
        const opt = document.createElement('option');
        opt.value = '42';
        ts.appendChild(opt);
        ts.value = '42';

        const windowsCreateSpy = vi.spyOn(global.browser.windows, 'create').mockResolvedValue({ id: 123 });

        document.getElementById('downloadBtn').click();

        await new Promise(resolve => setTimeout(resolve, 100));

        const urlArg = windowsCreateSpy.mock.calls[0]?.[0]?.url;
        expect(urlArg).toContain('branchId=42');
    });

    it('Warns when translatorContainer is missing during download start', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        const tc = document.getElementById('translatorContainer');
        if (tc) tc.parentNode.removeChild(tc);

        const warnSpy = vi.spyOn(console, 'warn');
        await controller.startDownload();

        expect(warnSpy).toHaveBeenCalledWith('Translator container not found when hiding during download');
    });

    it('Warns when translatorContainer is missing during UI reset', () => {
        const controller = new PopupController();

        const tc = document.getElementById('translatorContainer');
        if (tc) tc.parentNode.removeChild(tc);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Translator container not found when resetting UI');
    });

    it('_loadChaptersAndPopulateSelects skips hiding translatorContainer when it is absent and no multiple branches', async () => {
        const controller = new PopupController();
        await new Promise(resolve => setTimeout(resolve, 100));

        const tc = document.getElementById('translatorContainer');
        if (tc) tc.parentNode.removeChild(tc);

        const service = { fetchChaptersList: vi.fn(async () => ({ data: [{ volume: 1, number: 1 }] })) };
        const result = await controller._loadChaptersAndPopulateSelects(service, 'slug', null, null);

        expect(result).toBe(1);
    });

    it('_loadChaptersAndPopulateSelects calls _setupTranslatorSelector and filters chapters when multiple branches exist', async () => {
        const controller = new PopupController();
        await new Promise(resolve => setTimeout(resolve, 100));

        const chapters = [
            { volume: 1, number: 1, branches: [
                { branch_id: 1, teams: [{ name: 'Team A' }] },
                { branch_id: 2, teams: [{ name: 'Team B' }] }
            ]},
            { volume: 1, number: 2, branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }] }
        ];
        const service = { fetchChaptersList: vi.fn(async () => ({ data: chapters })) };

        const count = await controller._loadChaptersAndPopulateSelects(service, 'slug', null, null);

        expect(count).toBe(2);
        const tc = document.getElementById('translatorContainer');
        expect(tc.style.display).toBe('block');
    });

    it('_renderMeta handles empty authors array (covers false branches of secondLine ternaries)', async () => {
        global.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title', summary: 'Summary', cover: 'cover.png',
                    authors: [], artists: [],
                    ageRestriction: { label: '18+' }, releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [] }))
        }));

        const controller = new PopupController();
        await controller.loadMetadata();

        const logoInfo = document.getElementById('logoInfo');
        expect(logoInfo.textContent).not.toContain('Авторы:');
    });

    it('loadMetadata parses integer branchId from URL params (covers true branch at branchIdFromUrl)', async () => {
        Object.defineProperty(window, 'location', {
            value: { search: '?branchId=2' },
            configurable: true
        });

        const controller = new PopupController();
        await controller.loadMetadata();

        expect(document.getElementById('downloadBtn').disabled).toBe(false);
    });

    it('startDownload passes branchId to downloadManager when translatorContainer is visible', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        const tc = document.getElementById('translatorContainer');
        tc.style.display = 'block';
        const ts = document.getElementById('translatorSelect');
        const opt = document.createElement('option');
        opt.value = '7';
        ts.appendChild(opt);
        ts.value = '7';

        let capturedBranchId;
        controller.downloadManager.startDownload = vi.fn(async (opts) => {
            capturedBranchId = opts.branchId;
            return {};
        });

        await controller.startDownload();

        expect(capturedBranchId).toBe(7);
    });

    it('Warns when downloadInfoPanel is already in DOM during setupUI', async () => {
        const panel = document.createElement('div');
        panel.id = 'downloadInfoPanel';
        document.body.appendChild(panel);

        const warnSpy = vi.spyOn(console, 'warn');
        new PopupController();
        expect(warnSpy).toHaveBeenCalledWith('downloadInfoPanel found in DOM');
        warnSpy.mockRestore();
    });

    it('Populates downloadInfoPanel with format, rate limit and max size during download', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        const formatSelector = document.getElementById('formatSelector');
        const rateLimitInput = document.getElementById('rateLimitInput');
        const maxSizeInput = document.getElementById('maxSizeInput');

        if (formatSelector) formatSelector.selectedIndex = 0;  // FB2
        if (rateLimitInput) rateLimitInput.value = '85';
        if (maxSizeInput) maxSizeInput.value = '200';

        controller.downloadManager.startDownload = vi.fn(async () => ({}));

        await controller.startDownload();

        const panel = document.getElementById('downloadInfoPanel');
        expect(panel).not.toBeNull();
        expect(panel.style.display).toBe('block');
        expect(panel.innerHTML).toContain('info-row');
        expect(panel.innerHTML).toContain('85');
        expect(panel.innerHTML).toContain('200');
    });

    it('Hides downloadInfoPanel after resetUI', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        controller.downloadManager.startDownload = vi.fn(async () => ({}));
        await controller.startDownload();

        const panel = document.getElementById('downloadInfoPanel');
        expect(panel.style.display).toBe('block');

        controller.resetUI();
        expect(panel.style.display).toBe('none');
    });

    it('Restores formatContainer visibility after resetUI', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        controller.downloadManager.startDownload = vi.fn(async () => ({}));
        await controller.startDownload();

        const formatContainer = document.getElementById('formatContainer');
        expect(formatContainer.style.display).toBe('none');

        controller.resetUI();
        expect(formatContainer.style.display).toBe('');
    });

    it('Restores rateLimitContainer visibility after resetUI', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        controller.downloadManager.startDownload = vi.fn(async () => ({}));
        await controller.startDownload();

        const rateLimitContainer = document.getElementById('rateLimitContainer');
        expect(rateLimitContainer.style.display).toBe('none');

        controller.resetUI();
        expect(rateLimitContainer.style.display).toBe('');
    });

    it('Skips panel population when downloadInfoPanel is absent from DOM during startDownload', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        const panel = document.getElementById('downloadInfoPanel');
        if (panel) panel.parentNode.removeChild(panel);

        controller.downloadManager.startDownload = vi.fn(async () => ({}));
        await expect(controller.startDownload()).resolves.not.toThrow();
    });

    it('Uses formatSelector.value when selected option has no text in downloadInfoPanel', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        const formatSelector = document.getElementById('formatSelector');
        formatSelector.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = 'mobi';
        formatSelector.appendChild(opt);

        controller.downloadManager.startDownload = vi.fn(async () => ({}));
        await controller.startDownload();

        const panel = document.getElementById('downloadInfoPanel');
        expect(panel.innerHTML).toContain('mobi');
    });

    it('Skips downloadInfoPanel hiding when it is absent from DOM during resetUI', () => {
        const controller = new PopupController();

        const panel = document.getElementById('downloadInfoPanel');
        if (panel) panel.parentNode.removeChild(panel);

        expect(() => controller.resetUI()).not.toThrow();
    });

    it('Shows translatorContainer in resetUI when translatorSelect has more than one option', () => {
        const controller = new PopupController();

        const tc = document.getElementById('translatorContainer');
        const ts = document.getElementById('translatorSelect');

        const opt1 = document.createElement('option');
        opt1.value = '1';
        const opt2 = document.createElement('option');
        opt2.value = '2';
        ts.appendChild(opt1);
        ts.appendChild(opt2);

        tc.style.display = 'none';
        controller.resetUI();

        expect(tc.style.display).toBe('block');
    });
});

describe('_showWrongServiceState and _showNoTitleState', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="container">
                <img id="siteLogo" />
                <div id="logoInfo"></div>
                <div id="bookContainer">
                    <img id="cover" />
                    <div id="description"></div>
                </div>
                <button id="downloadBtn"></button>
                <div id="status"></div>
                <progress id="progress"></progress>
                <div id="error" class="hidden"></div>
                <div id="success" class="hidden"></div>
            </div>
        `;
        global.browser.tabs.create = vi.fn(async () => {});
    });

    it('_showWrongServiceState hides UI controls', () => {
        const controller = new PopupController();
        controller._showWrongServiceState();

        expect(document.getElementById('downloadBtn').style.display).toBe('none');
        expect(document.getElementById('status').style.display).toBe('none');
        expect(document.getElementById('formatContainer').style.display).toBe('none');
        expect(document.getElementById('rateLimitContainer').style.display).toBe('none');
        expect(document.getElementById('fileInputContainer').style.display).toBe('none');
    });

    it('_showWrongServiceState clears logoInfo and creates visible panel', () => {
        const controller = new PopupController();
        document.getElementById('logoInfo').textContent = 'something';

        controller._showWrongServiceState();

        expect(document.getElementById('logoInfo').textContent).toBe('');
        const panel = document.getElementById('wrongServicePanel');
        expect(panel).not.toBeNull();
        expect(panel.style.display).toBe('block');
    });

    it('_showWrongServiceState creates MangaLib and RanobeLib buttons', () => {
        const controller = new PopupController();
        controller._showWrongServiceState();

        const btns = document.getElementById('serviceLinks').querySelectorAll('button');
        expect(btns.length).toBe(2);
        expect(btns[0].textContent).toBe('MangaLib');
        expect(btns[1].textContent).toBe('RanobeLib');
    });

    it('_showWrongServiceState creates GitHub button with SVG icon', () => {
        const controller = new PopupController();
        controller._showWrongServiceState();

        const githubBtn = document.querySelector('#wrongServicePanel .github-link-btn');
        expect(githubBtn).not.toBeNull();
        expect(githubBtn.innerHTML).toContain('svg');
        expect(githubBtn.innerHTML).toContain('GitHub');
    });

    it('_showWrongServiceState does not duplicate panel on repeated calls', () => {
        const controller = new PopupController();
        controller._showWrongServiceState();
        controller._showWrongServiceState();

        expect(document.querySelectorAll('#wrongServicePanel').length).toBe(1);
    });

    it('MangaLib button opens mangalib.me tab', () => {
        const controller = new PopupController();
        controller._showWrongServiceState();

        document.querySelector('.mangalib-link-btn').click();

        expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://mangalib.me' });
    });

    it('MangaLib button applies mangalib theme and transitions to noTitleState', () => {
        const controller = new PopupController();
        controller._showWrongServiceState();

        document.querySelector('.mangalib-link-btn').click();

        expect(document.getElementById('siteLogo').src).toContain('logo1.png');
        expect(document.getElementById('wrongServicePanel').style.display).toBe('none');
        expect(document.getElementById('noTitlePanel')).not.toBeNull();
        expect(document.getElementById('noTitlePanel').style.display).toBe('block');
    });

    it('RanobeLib button opens ranobelib.me tab', () => {
        const controller = new PopupController();
        controller._showWrongServiceState();

        document.querySelector('.ranobelib-link-btn').click();

        expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://ranobelib.me' });
    });

    it('RanobeLib button applies ranobelib theme and transitions to noTitleState', () => {
        const controller = new PopupController();
        controller._showWrongServiceState();

        document.querySelector('.ranobelib-link-btn').click();

        expect(document.getElementById('siteLogo').src).toContain('logo3.png');
        expect(document.getElementById('wrongServicePanel').style.display).toBe('none');
        expect(document.getElementById('noTitlePanel')).not.toBeNull();
        expect(document.getElementById('noTitlePanel').style.display).toBe('block');
    });

    it('GitHub button in wrongServicePanel opens repo URL', () => {
        const controller = new PopupController();
        controller._showWrongServiceState();

        document.querySelector('#wrongServicePanel .github-link-btn').click();

        expect(global.browser.tabs.create).toHaveBeenCalledWith({
            url: 'https://github.com/ivanvit100/DownloadLib'
        });
    });

    it('_showNoTitleState hides UI controls and shows noTitlePanel', () => {
        const controller = new PopupController();
        controller._showNoTitleState();

        expect(document.getElementById('downloadBtn').style.display).toBe('none');
        expect(document.getElementById('formatContainer').style.display).toBe('none');
        const panel = document.getElementById('noTitlePanel');
        expect(panel).not.toBeNull();
        expect(panel.style.display).toBe('block');
    });

    it('_showNoTitleState creates GitHub button with SVG icon', () => {
        const controller = new PopupController();
        controller._showNoTitleState();

        const githubBtn = document.querySelector('#noTitlePanel .github-link-btn');
        expect(githubBtn).not.toBeNull();
        expect(githubBtn.innerHTML).toContain('svg');
        expect(githubBtn.innerHTML).toContain('GitHub');
    });

    it('_showNoTitleState does not duplicate panel on repeated calls', () => {
        const controller = new PopupController();
        controller._showNoTitleState();
        controller._showNoTitleState();

        expect(document.querySelectorAll('#noTitlePanel').length).toBe(1);
    });

    it('GitHub button in noTitlePanel opens repo URL', () => {
        const controller = new PopupController();
        controller._showNoTitleState();

        document.querySelector('#noTitlePanel .github-link-btn').click();

        expect(global.browser.tabs.create).toHaveBeenCalledWith({
            url: 'https://github.com/ivanvit100/DownloadLib'
        });
    });

    it('loadMetadata triggers _showWrongServiceState when no service found', async () => {
        global.serviceRegistry.getServiceByUrl = vi.fn(() => null);
        const controller = new PopupController();
        const spy = vi.spyOn(controller, '_showWrongServiceState');

        await controller.loadMetadata();

        expect(spy).toHaveBeenCalled();
    });

    it('loadMetadata triggers _showNoTitleState when service found but URL has no title slug', async () => {
        global.browser.tabs.query = vi.fn(async () => ([{ url: 'https://ranobelib.me/' }]));
        const controller = new PopupController();
        const spy = vi.spyOn(controller, '_showNoTitleState');

        await controller.loadMetadata();

        expect(spy).toHaveBeenCalled();
    });
});
