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
});