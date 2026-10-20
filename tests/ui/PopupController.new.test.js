import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
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
let RealChapterController;
let intervals = [];
let originalSetInterval;

function setupDOM() {
    document.body.innerHTML = `
        <img id="siteLogo" />
        <div id="logoInfo"></div>
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
    mocks.DownloadManager = class {
        constructor() { this.eventBus = { on: vi.fn() }; }
        startDownload = vi.fn(async () => ({ success: true, downloadId: 'id' }));
        stop = vi.fn();
        getDownloadState = vi.fn(() => ({ id: 1, status: 'active', progress: 50, slug: 'slug' }));
    };
    mocks.serviceRegistry = {
        getServiceByUrl: vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title', summary: 'Summary', cover: 'cover.png',
                authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [{}, {}])
        })),
        getService: vi.fn(() => null),
    };
    withServiceFactory(mocks.serviceRegistry, mocks);
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
    ({ ChapterController: RealChapterController } = await vi.importActual('../../ui/ChapterController.js'));
    mocks.ChapterController = class extends RealChapterController {
        constructor() {
            super();
            this.loadAndPopulate = vi.fn(async () => 2);
        }
    };
    mocks.TemplateLoader = {
        init: vi.fn(),
        show: vi.fn(async () => {}),
        current: vi.fn(() => null)
    };
    mocks.HistoryController = { init: vi.fn() };
    mocks.browserEnv = { isFirefox: true };
    mocks.PluginManager = { loadAll: vi.fn(async () => {}) };
    mocks.SettingsController = { init: vi.fn() };

    ({ PopupController } = await import('../../ui/PopupController.js'));
});

afterEach(() => {
    intervals.forEach(id => originalSetInterval && clearInterval(id));
    intervals = [];
    vi.restoreAllMocks();
    vi.clearAllTimers();
});

// Окно загрузки (?download=true) запускает скачивание через 500 мс: даём таймерам
// последних тестов сработать, пока окружение jsdom ещё не разобрано.
afterAll(() => new Promise(resolve => setTimeout(resolve, 600)));

describe('PopupController second test file', () => {
    it('Handles progress, completed and failed events from eventBus', async () => {
        const controller = new PopupController();
        const updateProgressSpy = vi.spyOn(controller, 'updateProgress');
        const resetUISpy = vi.spyOn(controller, 'resetUI');
        const showErrorSpy = vi.spyOn(controller, 'showError');

        const eventHandlers = {};
        controller.downloadManager.eventBus.on = (event, handler) => { eventHandlers[event] = handler; };

        controller.subscribeToEvents();

        eventHandlers['download:progress']({ status: 'downloading', progress: 42 });
        expect(updateProgressSpy).toHaveBeenCalledWith('downloading', 42);

        eventHandlers['download:completed']();
        expect(resetUISpy).toHaveBeenCalled();

        eventHandlers['download:failed']({ error: { message: 'fail' } });
        expect(showErrorSpy).toHaveBeenCalledWith('fail');
        expect(resetUISpy).toHaveBeenCalled();
    });

    it('Shows the page progress of a chapter from download:pages, but not while paused', () => {
        const controller = new PopupController();
        const eventHandlers = {};
        controller.downloadManager.eventBus.on = (event, handler) => { eventHandlers[event] = handler; };
        controller.subscribeToEvents();
        const status = document.getElementById('status');

        eventHandlers['download:pages']({ id: 'd', done: 3, total: 10 });
        expect(status.textContent).toBe('Загружено страниц: 3/10');

        controller.isPaused = true;
        status.textContent = 'Пауза...';
        eventHandlers['download:pages']({ id: 'd', done: 4, total: 10 });
        expect(status.textContent).toBe('Пауза...');
    });

    it('Creates its own service instance through the registry for the active tab', async () => {
        const controller = new PopupController();
        mocks.extensionApi.tabs.query = vi.fn(async () => [{ url: 'https://ranobelib.me/ru/book/slug', id: 3 }]);
        const resolved = await controller._resolveService({ autoDownload: false });
        expect(mocks.serviceRegistry.findServiceKey).toHaveBeenCalledWith('https://ranobelib.me/ru/book/slug');
        expect(mocks.serviceRegistry.createService).toHaveBeenCalledWith('ranobelib');
        expect(resolved).toMatchObject({ slug: 'slug', serviceKey: 'ranobelib', activeTabId: 3 });
    });

    it('Creates the service of the download window from the URL parameters through the registry', async () => {
        const controller = new PopupController();
        mocks.serviceRegistry.createService = vi.fn(key => ({ name: key }));
        const resolved = await controller._resolveService({
            autoDownload: true, slugFromUrl: 's', serviceFromUrl: 'hlib', tabIdFromUrl: 9
        });
        expect(mocks.serviceRegistry.createService).toHaveBeenCalledWith('hlib');
        expect(resolved).toEqual({ slug: 's', serviceKey: 'hlib', service: { name: 'hlib' }, activeTabId: 9 });

        mocks.serviceRegistry.createService = vi.fn(() => null);
        await expect(controller._resolveService({ autoDownload: true, slugFromUrl: 's', serviceFromUrl: 'nope' }))
            .rejects.toThrow('Unknown service: nope');
    });

    it('Shows the default rate limit of 85 and leaves the limit to the background', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        const sendMessageSpy = vi.spyOn(mocks.extensionApi.runtime, 'sendMessage');

        await controller.startDownload();

        expect(document.getElementById('downloadInfoPanel').textContent).toContain('Запросов в минуту85');
        expect(sendMessageSpy).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'setRateLimit' }));
    });

    it('Shows the rate limit saved by an older version in localStorage', async () => {
        global.localStorage.getItem = vi.fn(key =>
            key === 'downloadlib_default_rate_limit' ? '120' : null
        );
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await controller.startDownload();

        expect(document.getElementById('downloadInfoPanel').textContent).toContain('Запросов в минуту120');
    });

    it('Shows the rate limit from the settings in storage.local', async () => {
        mocks.extensionApi.storage = {
            local: { get: vi.fn(async () => ({ downloadlib_default_rate_limit: 40 })), set: vi.fn(async () => {}) }
        };
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await controller.startDownload();

        expect(document.getElementById('downloadInfoPanel').textContent).toContain('Запросов в минуту40');
    });

    it('Completes without spurious warnings when all optional elements are missing during download start', async () => {
        document.body.innerHTML = `
            <button id="downloadBtn"></button>
            <div id="status"></div>
            <div id="error" class="hidden"></div>
            <div id="success" class="hidden"></div>
        `;

        mocks.DownloadManager = class {
            constructor() { this.eventBus = { on: vi.fn() }; }
            startDownload = vi.fn(async () => ({ success: true, downloadId: 'id' }));
            stop = vi.fn();
            getDownloadState = vi.fn(() => null);
        };
        mocks.extensionApi.runtime.sendMessage = vi.fn(async () => ({ ok: true, downloads: [] }));

        const warnSpy = vi.spyOn(console, 'warn');

        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        warnSpy.mockClear();

        await controller.startDownload();

        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('Sets download start status text', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        controller.downloadManager.startDownload = vi.fn(async () => ({}));

        const setTextSpy = vi.fn();
        const status = document.getElementById('status');
        Object.defineProperty(status, 'textContent', {
            set: setTextSpy,
            get: () => '',
            configurable: true
        });

        await controller.startDownload();

        expect(setTextSpy).toHaveBeenCalledWith('Запуск скачивания...');
    });

    it('Completes without error when status element is missing during download start', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        controller.downloadManager.startDownload = vi.fn(async () => ({}));

        const status = document.getElementById('status');
        if (status) status.parentNode.removeChild(status);

        await expect(controller.startDownload()).resolves.not.toThrow();
    });

    it('Passes a promise-based controller that pauses without polling and stops with stopDownload', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        let capturedController;
        controller.downloadManager.startDownload = vi.fn(async (opts) => {
            capturedController = opts.controller;
            return {};
        });

        await controller.startDownload();

        expect(capturedController).toBe(controller.controller);
        expect(capturedController.isPaused()).toBe(false);
        expect(capturedController.shouldStop()).toBe(false);

        capturedController.pause();
        let resumed = false;
        const waiting = capturedController.waitIfPaused().then(() => { resumed = true; });
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(resumed).toBe(false);
        capturedController.resume();
        await waiting;
        expect(resumed).toBe(true);

        controller.stopDownload();
        expect(capturedController.shouldStop()).toBe(true);
        await expect(capturedController.waitIfPaused()).resolves.toBeUndefined();
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

    it('Warns when status element is missing on download stop', async () => {
        const controller = new PopupController();

        const status = document.getElementById('status');
        if (status) status.parentNode.removeChild(status);

        const warnSpy = vi.spyOn(console, 'warn');

        controller.stopDownload();

        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Status element not found when setting status on download stop');
    });

    it('Warns when status or progress element is missing during progress update', async () => {
        const controller = new PopupController();

        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.parentNode.removeChild(statusEl);

        const progressEl = document.getElementById('progress');
        if (progressEl) progressEl.parentNode.removeChild(progressEl);

        const warnSpy = vi.spyOn(console, 'warn');

        controller.updateProgress('Загрузка...', 55);

        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Status element not found when updating progress status');
        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Progress element not found when updating progress percentage');
    });

    it('Warns when download button is missing during UI reset', async () => {
        const controller = new PopupController();

        const btn = document.getElementById('downloadBtn');
        if (btn) btn.parentNode.removeChild(btn);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Download button not found when resetting UI');
    });

    it('Completes without error when format container is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('formatContainer');
        if (el) el.parentNode.removeChild(el);

        expect(() => controller.resetUI()).not.toThrow();
    });

    it('Completes without error when rate limit container is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('rateLimitContainer');
        if (el) el.parentNode.removeChild(el);

        expect(() => controller.resetUI()).not.toThrow();
    });

    it('Warns when progress element is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('progress');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Progress element not found when resetting UI');
    });

    it('Warns when controls container is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('downloadControls');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Controls container not found when resetting UI');
    });

    it('Warns when chapter range container is missing during UI reset', async () => {
        const controller = new PopupController();

        const el = document.getElementById('chapterRangeContainer');
        if (el) el.parentNode.removeChild(el);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Chapter range container not found when resetting UI');
    });

    it('Warns when error element is missing during error display', async () => {
        const controller = new PopupController();

        const errorEl = document.getElementById('error');
        if (errorEl) errorEl.parentNode.removeChild(errorEl);

        const warnSpy = vi.spyOn(console, 'warn');

        controller.showError('Ошибка теста');

        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Error element not found when showing error message');
    });

    it('Warns when success element is missing during success display', async () => {
        const controller = new PopupController();

        const successEl = document.getElementById('success');
        if (successEl) successEl.parentNode.removeChild(successEl);

        const warnSpy = vi.spyOn(console, 'warn');

        controller.showSuccess('Успешно!');

        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Success element not found when showing success message');
    });

    it('Warns when chapter range selectors are missing when constructing URL parameters for download', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';
        controller.isInSeparateWindow = vi.fn(async () => false);

        await new Promise(resolve => setTimeout(resolve, 100));

        const fromSelect = document.getElementById('chapterFromSelect');
        if (fromSelect) fromSelect.parentNode.removeChild(fromSelect);
        const toSelect = document.getElementById('chapterToSelect');
        if (toSelect) toSelect.parentNode.removeChild(toSelect);

        const warnSpy = vi.spyOn(console, 'warn');

        const downloadBtn = document.getElementById('downloadBtn');
        downloadBtn.click();

        await new Promise(resolve => setTimeout(resolve, 50));

        expect(warnSpy).toHaveBeenCalledWith(
            '[PopupController] Chapter range selectors not found or not visible when constructing URL parameters for download');
    });

    it('Passes chapter range URL parameters to ChapterController.loadAndPopulate', async () => {
        Object.defineProperty(window, 'location', {
            value: { search: '?chapterFrom=1&chapterTo=3' },
            configurable: true
        });

        const controller = new PopupController();

        await controller.loadMetadata();

        expect(controller.chapterController.loadAndPopulate).toHaveBeenCalledWith(
            expect.anything(), expect.any(String), '1', '3', null
        );
    });

    it('Does not start the download window automatically when its chapter range is not in the list', async () => {
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&chapterFrom=101&chapterTo=105' },
            configurable: true
        });
        const controller = new PopupController();
        controller.chapterController.loadAndPopulate = vi.fn(async function () {
            this.rangeNotFound = true;
            return 2;
        });
        const startSpy = vi.spyOn(controller, 'startDownload').mockResolvedValue();
        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        await controller.loadMetadata();

        expect(document.getElementById('status').textContent)
            .toBe('Выбранные главы не найдены в списке глав тайтла: выберите диапазон заново');
        expect(document.getElementById('downloadBtn').disabled).toBe(false);
        expect(timeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 500);
        expect(startSpy).not.toHaveBeenCalled();
        timeoutSpy.mockRestore();
        Object.defineProperty(window, 'location', { value: { search: '' }, configurable: true });
    });

    it('Does not start the download window automatically for a missing range even without a status line', async () => {
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&chapterFrom=101&chapterTo=105' },
            configurable: true
        });
        const controller = new PopupController();
        controller.chapterController.loadAndPopulate = vi.fn(async function () {
            this.rangeNotFound = true;
            return 2;
        });
        const startSpy = vi.spyOn(controller, 'startDownload').mockResolvedValue();
        document.getElementById('status').remove();

        await expect(controller.loadMetadata()).resolves.toBeUndefined();
        await new Promise(resolve => setTimeout(resolve, 600));
        expect(startSpy).not.toHaveBeenCalled();
        Object.defineProperty(window, 'location', { value: { search: '' }, configurable: true });
    });

    it('Shows the default rate limit in the download panel when none is given', () => {
        const controller = new PopupController();
        controller._setDownloadingUIState({ btn: document.getElementById('downloadBtn') });
        const values = Array.from(document.querySelectorAll('#downloadInfoPanel .info-value'), el => el.textContent);
        expect(values[1]).toBe('85');
    });

    it('Clamps toSelect value when fromSelect changes to a higher index', async () => {
        new PopupController();

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
        new PopupController();

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

    it('Compares the range selects by option position, not by the chapter keys', async () => {
        new PopupController();

        await new Promise(resolve => setTimeout(resolve, 100));

        const fromSelect = document.getElementById('chapterFromSelect');
        const toSelect = document.getElementById('chapterToSelect');
        for (const key of ['900', '50', '7']) {
            const opt = document.createElement('option');
            opt.value = key;
            fromSelect.appendChild(opt.cloneNode(true));
            toSelect.appendChild(opt);
        }

        fromSelect.value = '50';
        toSelect.value = '7';
        fromSelect.dispatchEvent(new Event('change'));
        toSelect.dispatchEvent(new Event('change'));
        expect([fromSelect.value, toSelect.value]).toEqual(['50', '7']);

        toSelect.value = '900';
        toSelect.dispatchEvent(new Event('change'));
        expect(fromSelect.value).toBe('900');
    });

    it('openInNewContext uses tabs.create when windows API is unavailable and tab is returned', async () => {
        const controller = new PopupController();
        delete mocks.extensionApi.windows;
        mocks.extensionApi.tabs = { create: vi.fn(async () => ({ id: 5, active: true })) };

        const warnSpy = vi.spyOn(console, 'warn');
        await controller.openInNewContext('popup.html?test=1');

        expect(mocks.extensionApi.tabs.create).toHaveBeenCalledWith({ url: 'popup.html?test=1', active: true });
        expect(warnSpy).not.toHaveBeenCalledWith('[PopupController] Tab created but no ID found:', expect.anything());
    });

    it('openInNewContext warns when tabs.create returns null', async () => {
        const controller = new PopupController();
        delete mocks.extensionApi.windows;
        mocks.extensionApi.tabs = { create: vi.fn(async () => null) };

        const warnSpy = vi.spyOn(console, 'warn');
        await controller.openInNewContext('popup.html?test=1');

        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Tab created but no ID found:', null);
    });

    it('openInNewContext logs error when neither windows nor tabs API is available', async () => {
        const controller = new PopupController();
        delete mocks.extensionApi.windows;
        delete mocks.extensionApi.tabs;

        const errorSpy = vi.spyOn(console, 'error');
        await controller.openInNewContext('popup.html?test=1');

        expect(errorSpy).toHaveBeenCalledWith('[PopupController] No window/tab API available');
    });

    it('openInNewContext opens a popup window when browserEnv.isFirefox is true', async () => {
        const controller = new PopupController();
        mocks.browserEnv = { isFirefox: true };

        await controller.openInNewContext('popup.html?test=1');

        expect(mocks.extensionApi.windows.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'popup.html?test=1' }));
    });

    it('openInNewContext asks the background when browserEnv.isFirefox is false', async () => {
        const controller = new PopupController();
        mocks.browserEnv = { isFirefox: false };

        await controller.openInNewContext('popup.html?test=1');

        expect(mocks.extensionApi.runtime.sendMessage).toHaveBeenCalledWith({ action: 'openWindowWithUrl', url: 'popup.html?test=1' });
        expect(mocks.extensionApi.windows.create).not.toHaveBeenCalled();
    });

    it('_setupTranslatorSelector returns null when translatorContainer is missing from DOM', () => {
        const controller = new PopupController();
        const tc = document.getElementById('translatorContainer');
        if (tc) tc.parentNode.removeChild(tc);

        const result = controller.chapterController._setupTranslatorSelector([{ branches: [{ branch_id: 1 }] }], null);
        expect(result).toBeNull();
    });

    it('_setupTranslatorSelector hides container and returns null when chapters have no branches', () => {
        const controller = new PopupController();
        const tc = document.getElementById('translatorContainer');
        tc.style.display = 'block';

        const result = controller.chapterController._setupTranslatorSelector([{ volume: 1 }, { volume: 2 }], null);

        expect(tc.style.display).toBe('none');
        expect(result).toBeNull();
    });

    it('_setupTranslatorSelector hides container and returns branch id for single branch', () => {
        const controller = new PopupController();
        const tc = document.getElementById('translatorContainer');
        tc.style.display = 'block';

        const result = controller.chapterController._setupTranslatorSelector([
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

        const result = controller.chapterController._setupTranslatorSelector(chapters, null);

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

        controller.chapterController._setupTranslatorSelector(chapters, null);

        const ts = document.getElementById('translatorSelect');
        expect(ts.options[0].textContent).toBe('Перевод 10');
        expect(ts.options[1].textContent).toBe('Перевод 20');
    });

    it('_setupTranslatorSelector uses branchIdFromUrl when it matches a known branch', () => {
        const controller = new PopupController();
        const chapters = [
            { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] }
        ];

        const result = controller.chapterController._setupTranslatorSelector(chapters, '2');

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
        controller.chapterController._allChapters = chapters;

        controller.chapterController._setupTranslatorSelector(chapters, null);

        const repopulateSpy = vi.spyOn(controller.chapterController, 'repopulateSelects');
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
        controller.chapterController._allChapters = chapters;

        controller.chapterController._setupTranslatorSelector(chapters, null);

        const fromSelect = document.getElementById('chapterFromSelect');
        if (fromSelect) fromSelect.parentNode.removeChild(fromSelect);

        const repopulateSpy = vi.spyOn(controller.chapterController, 'repopulateSelects');
        const ts = document.getElementById('translatorSelect');
        ts.value = '2';
        ts.dispatchEvent(new Event('change'));

        expect(repopulateSpy).not.toHaveBeenCalled();
    });

    it('_getFilteredChapters returns only chapters matching the given branchId', () => {
        const controller = new PopupController();
        controller.chapterController._allChapters = [
            { volume: 1, number: 1, branches: [{ branch_id: 1 }] },
            { volume: 1, number: 2, branches: [{ branch_id: 2 }] },
            { volume: 1, number: 3, branches: [{ branch_id: 1 }, { branch_id: 2 }] },
            { volume: 2, number: 1 }
        ];

        const result = controller.chapterController.getFilteredChapters(1);

        expect(result).toHaveLength(2);
        expect(result[0].number).toBe(1);
        expect(result[1].number).toBe(3);
    });

    it('Appends branchId to URL params when translatorContainer is visible during download button click', async () => {
        const controller = new PopupController();
        controller.isInSeparateWindow = vi.fn().mockResolvedValue(false);

        await new Promise(resolve => setTimeout(resolve, 100));

        const tc = document.getElementById('translatorContainer');
        tc.style.display = 'block';
        const ts = document.getElementById('translatorSelect');
        const opt = document.createElement('option');
        opt.value = '42';
        ts.appendChild(opt);
        ts.value = '42';

        const windowsCreateSpy = vi.spyOn(mocks.extensionApi.windows, 'create').mockResolvedValue({ id: 123 });

        document.getElementById('downloadBtn').click();

        await new Promise(resolve => setTimeout(resolve, 100));

        const urlArg = windowsCreateSpy.mock.calls[0]?.[0]?.url;
        expect(urlArg).toContain('branchId=42');
    });

    it('Completes without error when translatorContainer is missing during download start', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        await new Promise(resolve => setTimeout(resolve, 100));

        const tc = document.getElementById('translatorContainer');
        if (tc) tc.parentNode.removeChild(tc);

        await expect(controller.startDownload()).resolves.not.toThrow();
    });

    it('Warns when translatorContainer is missing during UI reset', () => {
        const controller = new PopupController();

        const tc = document.getElementById('translatorContainer');
        if (tc) tc.parentNode.removeChild(tc);

        const warnSpy = vi.spyOn(console, 'warn');
        controller.resetUI();

        expect(warnSpy).toHaveBeenCalledWith('[PopupController] Translator container not found when resetting UI');
    });

    it('ChapterController.loadAndPopulate skips hiding translatorContainer when it is absent and no multiple branches', async () => {
        const tc = document.getElementById('translatorContainer');
        if (tc) tc.parentNode.removeChild(tc);

        const service = { fetchChapters: vi.fn(async () => [{ volume: 1, number: 1 }]) };
        const cc = new RealChapterController();
        const result = await cc.loadAndPopulate(service, 'slug', null, null);

        expect(result).toBe(1);
    });

    it('ChapterController.loadAndPopulate calls _setupTranslatorSelector and filters chapters when multiple branches exist', async () => {
        const chapters = [
            { volume: 1, number: 1, branches: [
                { branch_id: 1, teams: [{ name: 'Team A' }] },
                { branch_id: 2, teams: [{ name: 'Team B' }] }
            ]},
            { volume: 1, number: 2, branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }] }
        ];
        const service = { fetchChapters: vi.fn(async () => chapters) };

        const cc = new RealChapterController();
        const count = await cc.loadAndPopulate(service, 'slug', null, null);

        expect(count).toBe(2);
        const tc = document.getElementById('translatorContainer');
        expect(tc.style.display).toBe('block');
    });

    it('_renderMeta handles empty authors array (covers false branches of secondLine ternaries)', async () => {
        mocks.serviceRegistry.getServiceByUrl = vi.fn(() => ({
            name: 'ranobelib',
            getManga: vi.fn(async () => ({
                rus_name: 'Title', summary: 'Summary', cover: 'cover.png',
                authors: [], artists: [],
                ageRestriction: { label: '18+' }, releaseDate: '2020'
            })),
            getChapterList: vi.fn(async () => [])
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

    it('startDownload hides splitPagesContainer, resetUI restores it for mangalib', async () => {
        const controller = new PopupController();
        await new Promise(resolve => setTimeout(resolve, 100));

        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'mangalib';

        const container = document.getElementById('splitPagesContainer');
        container.style.display = 'block';

        controller.downloadManager.startDownload = vi.fn(async () => ({}));
        await controller.startDownload();
        expect(container.style.display).toBe('none');

        controller.resetUI();
        expect(container.style.display).toBe('block');
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

    it('Builds the download parameters panel from text nodes', async () => {
        const controller = new PopupController();
        controller.currentSlug = 'slug';
        controller.currentServiceKey = 'ranobelib';

        const formatSelector = document.getElementById('formatSelector');
        formatSelector.replaceChildren();
        const opt = document.createElement('option');
        opt.value = 'plugin';
        opt.textContent = '<img src=x onerror="alert(1)">';
        formatSelector.appendChild(opt);

        controller.downloadManager.startDownload = vi.fn(async () => ({}));
        await controller.startDownload();

        const panel = document.getElementById('downloadInfoPanel');
        expect(panel.querySelector('img')).toBeNull();
        const rows = Array.from(panel.querySelectorAll('.info-row'), row => [
            row.querySelector('.info-label').textContent, row.querySelector('.info-value').textContent
        ]);
        expect(rows[0]).toEqual(['Формат', '<img src=x onerror="alert(1)">']);
        expect(rows.map(([label]) => label)).toEqual(['Формат', 'Запросов в минуту', 'Макс. размер части']);
        expect(rows[2][1]).toMatch(/ МБ$/);
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
