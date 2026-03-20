import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let PopupController;
let intervals = [];
let originalSetInterval;

function setupDOM() {
    document.body.innerHTML = `
        <button id="downloadBtn"></button>
        <button id="pauseBtn"></button>
        <button id="stopBtn"></button>
        <button id="backgroundBtn"></button>
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
    it('Sets shouldStop to false when background download takeover fails', async () => {
        const controller = new PopupController();
        controller.currentDownloadId = 123;
        controller.downloadManager.getDownloadState = vi.fn(() => ({
            id: 123, status: 'active', progress: 50, slug: 'slug'
        }));

        const stopSpy = vi.spyOn(controller.downloadManager, 'stop');
        const resetUISpy = vi.spyOn(controller, 'resetUI');

        let resolveSendMessage;
        const sendMessageCalled = new Promise(resolve => { resolveSendMessage = resolve; });

        global.browser.runtime.sendMessage = vi.fn(async () => {
            const result = { ok: false };
            resolveSendMessage();
            return result;
        });

        const backgroundBtn = document.getElementById('backgroundBtn');
        backgroundBtn.click();

        await sendMessageCalled;
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(stopSpy).toHaveBeenCalledWith(123);
        expect(controller.shouldStop).toBe(false);
        expect(resetUISpy).not.toHaveBeenCalled();
    });

    it('Shows error and returns if downloadState is missing', async () => {
        const controller = new PopupController();
        controller.currentDownloadId = 123;
        controller.downloadManager.getDownloadState = vi.fn(() => null);

        const errorSpy = vi.spyOn(console, 'error');
        const stopSpy = vi.spyOn(controller.downloadManager, 'stop');
        const resetUISpy = vi.spyOn(controller, 'resetUI');

        const backgroundBtn = document.getElementById('backgroundBtn');
        backgroundBtn.click();

        await new Promise(resolve => setTimeout(resolve, 30));

        expect(errorSpy).toHaveBeenCalledWith('[PopupController] No downloadState for ID:', 123);
        expect(stopSpy).not.toHaveBeenCalled();
        expect(resetUISpy).not.toHaveBeenCalled();
    });

    it('Resets UI and sets status text when background download takeover succeeds and not in separate window', async () => {
        const controller = new PopupController();
        controller.currentDownloadId = 123;
        controller.downloadManager.getDownloadState = vi.fn(() => ({
            id: 123, status: 'active', progress: 50, slug: 'slug'
        }));
        const stopSpy = vi.spyOn(controller.downloadManager, 'stop');
        const resetUISpy = vi.spyOn(controller, 'resetUI');
        global.browser.runtime.sendMessage = vi.fn(async () => ({ ok: true }));
        controller.isInSeparateWindow = vi.fn(async () => false);

        const status = document.getElementById('status');
        status.textContent = '';

        const backgroundBtn = document.getElementById('backgroundBtn');
        backgroundBtn.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(stopSpy).toHaveBeenCalledWith(123);
        expect(resetUISpy).toHaveBeenCalled();
        expect(status.textContent).toBe('Нажмите "Скачать" для загрузки книги');
    });

    it('Warns in console if status element is missing after moving to background', async () => {
        const controller = new PopupController();
        controller.currentDownloadId = 123;
        controller.downloadManager.getDownloadState = vi.fn(() => ({
            id: 123, status: 'active', progress: 50, slug: 'slug'
        }));
        global.browser.runtime.sendMessage = vi.fn(async () => ({ ok: true }));
        controller.isInSeparateWindow = vi.fn(async () => false);

        const status = document.getElementById('status');
        status.parentNode.removeChild(status);

        const warnSpy = vi.spyOn(console, 'warn');

        const backgroundBtn = document.getElementById('backgroundBtn');
        backgroundBtn.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(warnSpy).toHaveBeenCalledWith('Status element not found when updating status after moving to background');
    });

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

    it('Sets shouldStop to false and logs error if moving to background throws', async () => {
        const controller = new PopupController();
        controller.currentDownloadId = 123;
        controller.downloadManager.getDownloadState = vi.fn(() => ({
            id: 123, status: 'active', progress: 50, slug: 'slug'
        }));
        global.browser.runtime.sendMessage = vi.fn(async () => { throw new Error('fail'); });
        const errorSpy = vi.spyOn(console, 'error');

        const backgroundBtn = document.getElementById('backgroundBtn');
        backgroundBtn.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(errorSpy).toHaveBeenCalledWith('[PopupController] Failed to move to background:', expect.any(Error));
        expect(controller.shouldStop).toBe(false);
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
            'formatSelector', 'rateLimitInput', 'fileInput', 'customFileBtn',
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
            'Format selector not found when disabling during download',
            'Rate limit input not found when disabling during download',
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

    it('Warns when format selector is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('formatSelector');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Format selector not found when resetting UI');
    });

    it('Warns when rate limit input is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('rateLimitInput');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('Rate limit input not found when resetting UI');
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

    it('Changes fromSelect border on mouseenter and restores on mouseleave', async () => {
        const controller = new PopupController();

        await new Promise(resolve => setTimeout(resolve, 100));

        const fromSelect = document.getElementById('chapterFromSelect');

        fromSelect.dispatchEvent(new Event('mouseenter'));
        expect(fromSelect.style.border).toBe('2px solid var(--secondary-color)');

        fromSelect.dispatchEvent(new Event('mouseleave'));
        expect(fromSelect.style.border).toBe('2px solid var(--primary-color)');
    });

    it('Changes toSelect border on mouseenter and restores on mouseleave', async () => {
        const controller = new PopupController();

        await new Promise(resolve => setTimeout(resolve, 100));

        const toSelect = document.getElementById('chapterToSelect');

        toSelect.dispatchEvent(new Event('mouseenter'));
        expect(toSelect.style.border).toBe('2px solid var(--secondary-color)');

        toSelect.dispatchEvent(new Event('mouseleave'));
        expect(toSelect.style.border).toBe('2px solid var(--primary-color)');
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

    it('Uses extension api provider when available', async () => {
        vi.resetModules();
        setupDOM();
        global.DownloadManager = class {
            constructor() {
                this.eventBus = { on: vi.fn() };
            }
        };
        const extensionApi = {
            runtime: {
                sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })),
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
        global.getExtensionApi = vi.fn(() => extensionApi);
        global.browser = {
            runtime: {
                sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })),
                getURL: vi.fn(() => 'popup.html')
            },
            windows: {
                getCurrent: vi.fn(async () => ({ type: 'popup' })),
                create: vi.fn(async () => ({ id: 2 })),
                update: vi.fn(async () => {})
            },
            tabs: {
                query: vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]))
            }
        };
        global.chrome = {
            runtime: {
                sendMessage: vi.fn(async () => ({ ok: true, downloads: [] })),
                getURL: vi.fn(() => 'popup.html')
            },
            windows: {
                getCurrent: vi.fn(async () => ({ type: 'popup' })),
                create: vi.fn(async () => ({ id: 3 })),
                update: vi.fn(async () => {})
            },
            tabs: {
                query: vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug' }]))
            }
        };
        await import('../../ui/PopupController.js?nocache=' + Math.random());
        const PopupControllerClass = global.PopupController;
        const localController = new PopupControllerClass();
        await localController.updateActiveDownloadsInfo();
        expect(global.getExtensionApi).toHaveBeenCalledTimes(1);
        expect(extensionApi.runtime.sendMessage).toHaveBeenCalled();
        expect(global.browser.runtime.sendMessage).not.toHaveBeenCalled();
    });
});