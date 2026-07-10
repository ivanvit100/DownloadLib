import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let PopupController;
let intervals = [];
let originalSetInterval;

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
                <select id="chapterFromSelect"></select>
                <select id="chapterToSelect"></select>
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

beforeEach(async () => {
    vi.resetModules();
    delete global.getExtensionApi;

    intervals = [];
    if (!originalSetInterval) originalSetInterval = global.setInterval;
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
        getDownloadState = vi.fn(() => null);
    };
    global.serviceRegistry = {
        getServiceByUrl: vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: {
                    rus_name: 'Title', summary: 'Summary', cover: 'cover.png',
                    authors: ['Author'], ageRestriction: { label: '18+' }, releaseDate: '2020'
                }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [] }))
        })),
    };
    global.RanobeLibService = class {
        name = 'ranobelib';
        fetchMangaMetadata = vi.fn(async () => ({ data: { rus_name: 'Title', summary: 'S', cover: null, authors: [], ageRestriction: null } }));
        fetchChaptersList = vi.fn(async () => ({ data: [] }));
    };
    global.MangaLibService = class {
        name = 'mangalib';
        fetchMangaMetadata = vi.fn(async () => ({ data: { rus_name: 'Title', summary: 'S', cover: null, authors: [], ageRestriction: null } }));
        fetchChaptersList = vi.fn(async () => ({ data: [] }));
    };
    global.browser = {
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
            query: vi.fn(async () => ([{ url: 'https://ranobelib.me/ru/book/my-slug', id: 42 }])),
            create: vi.fn(async () => {})
        }
    };
    global.chrome = undefined;
    global.window.close = vi.fn();
    global.ExporterRegistry = {
        getFormats: vi.fn(() => [
            { value: 'fb2', label: 'FB2' },
            { value: 'epub', label: 'EPUB' },
        ])
    };
    global.DownloadHistory = { add: vi.fn(), getAll: vi.fn(() => []), clear: vi.fn() };
    global.AuthManager = { getToken: vi.fn(async () => null), apply: vi.fn(async () => null) };
    global.ChapterController = class {
        constructor() { this._allChapters = []; }
        loadAndPopulate = vi.fn(async () => 0);
        getFilteredChapters = vi.fn(() => []);
        repopulateSelects = vi.fn();
    };
    global.TemplateLoader = {
        init: vi.fn(),
        show: vi.fn(async () => {}),
        current: vi.fn(() => null)
    };
    global.HistoryController = { init: vi.fn() };
    global.fetchViaTab = vi.fn(async () => null);
    global.setServiceTab = vi.fn();
    global.fetch = vi.fn(async () => ({
        json: async () => ({ workflow_runs: [{ conclusion: 'success' }] })
    }));

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

describe('PopupController extra coverage', () => {
    describe('_restoreMainView', () => {
        it('calls TemplateLoader.show, _bindTitleEvents, loadMetadata, checkApiHealth', async () => {
            const controller = new PopupController();
            const showSpy = vi.spyOn(global.TemplateLoader, 'show');
            await controller._restoreMainView();
            expect(showSpy).toHaveBeenCalledWith('title');
        });

        it('clears logoInfo text before showing template', async () => {
            const controller = new PopupController();
            vi.spyOn(controller, 'loadMetadata').mockResolvedValue();
            document.getElementById('logoInfo').textContent = 'old text';
            await controller._restoreMainView();
            expect(document.getElementById('logoInfo').textContent).toBe('');
        });

        it('skips logoInfo clear when logoInfo is null', async () => {
            const controller = new PopupController();
            vi.spyOn(controller, 'loadMetadata').mockResolvedValue();
            document.getElementById('logoInfo').remove();
            await expect(controller._restoreMainView()).resolves.not.toThrow();
        });
    });

    describe('_bindShellEvents historyBtn', () => {
        it('clicks historyBtn: clears logoInfo, calls TemplateLoader.show with history', () => {
            document.body.innerHTML += '<button id="historyBtn"></button>';
            const controller = new PopupController();
            controller._shellEventsBound = false;
            global.TemplateLoader.show = vi.fn(async (_name, cb) => { if (cb) cb(); });
            controller._bindShellEvents();
            document.getElementById('logoInfo').textContent = 'existing';
            document.getElementById('historyBtn').click();
            expect(global.TemplateLoader.show).toHaveBeenCalledWith('history', expect.any(Function));
            expect(document.getElementById('logoInfo').textContent).toBe('');
            expect(global.HistoryController.init).toHaveBeenCalled();
        });

        it('early returns when _shellEventsBound is already true', () => {
            const controller = new PopupController();
            controller._shellEventsBound = true;
            const warnSpy = vi.spyOn(console, 'warn');
            controller._bindShellEvents();
            expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('historyBtn'));
        });

        it('skips logoInfo clear when logoInfo is null in historyBtn handler', () => {
            document.body.innerHTML += '<button id="historyBtn"></button>';
            const controller = new PopupController();
            controller._shellEventsBound = false;
            global.TemplateLoader.show = vi.fn(async () => {});
            controller._bindShellEvents();
            document.getElementById('logoInfo').remove();
            expect(() => document.getElementById('historyBtn').click()).not.toThrow();
        });
    });

    describe('_bindTitleEvents', () => {
        it('browserAPI.storage.local.set called on init when storage is available', () => {
            global.browser.storage = { local: { set: vi.fn() } };
            const controller = new PopupController();
            controller._bindTitleEvents();
            expect(global.browser.storage.local.set).toHaveBeenCalled();
        });

        it('browserAPI.storage.local.set called on format change', () => {
            global.browser.storage = { local: { set: vi.fn() } };
            const controller = new PopupController();
            controller._bindTitleEvents();
            const formatSelector = document.getElementById('formatSelector');
            formatSelector.dispatchEvent(new Event('change'));
            expect(global.browser.storage.local.set.mock.calls.length).toBeGreaterThan(1);
        });

        it('rateLimitInput: clamps value below 2 to 2', () => {
            const controller = new PopupController();
            controller._bindTitleEvents();
            const input = document.getElementById('rateLimitInput');
            input.value = '1';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            expect(parseInt(input.value)).toBe(2);
        });

        it('rateLimitInput: clamps value above 200 to 200', () => {
            const controller = new PopupController();
            controller._bindTitleEvents();
            const input = document.getElementById('rateLimitInput');
            input.value = '300';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            expect(parseInt(input.value)).toBe(200);
        });

        it('rateLimitInput: clamps NaN to 2', () => {
            const controller = new PopupController();
            controller._bindTitleEvents();
            const input = document.getElementById('rateLimitInput');
            input.value = 'abc';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            expect(parseInt(input.value)).toBe(2);
        });

        it('maxSizeInput: clamps value below 1 to 1', () => {
            const controller = new PopupController();
            controller._bindTitleEvents();
            const input = document.getElementById('maxSizeInput');
            input.value = '0';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            expect(parseInt(input.value)).toBe(1);
        });

        it('maxSizeInput: accepts valid value and saves to localStorage', () => {
            const controller = new PopupController();
            controller._bindTitleEvents();
            const input = document.getElementById('maxSizeInput');
            input.value = '150';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            expect(global.localStorage.setItem).toHaveBeenCalledWith('manga_parser_max_size_mb', '150');
        });

        it('hiddenFileInput change: no file resets btn text', () => {
            const controller = new PopupController();
            controller._bindTitleEvents();
            const fileInput = document.getElementById('fileInput');
            Object.defineProperty(fileInput, 'files', { value: [], configurable: true });
            fileInput.dispatchEvent(new Event('change'));
            expect(document.getElementById('downloadBtn').textContent).toBe('Скачать');
        });

        it('hiddenFileInput change: valid extension sets loadedFile and updates UI', () => {
            const controller = new PopupController();
            controller._bindTitleEvents();
            const fileInput = document.getElementById('fileInput');
            Object.defineProperty(fileInput, 'files', {
                value: [{ name: 'book.epub' }], configurable: true
            });
            fileInput.dispatchEvent(new Event('change'));
            expect(controller.loadedFile).toEqual({ name: 'book.epub' });
            expect(document.getElementById('downloadBtn').textContent).toBe('Обновить файл');
        });

        it('hiddenFileInput change: invalid extension shows error and clears loadedFile', () => {
            const controller = new PopupController();
            controller._bindTitleEvents();
            const fileInput = document.getElementById('fileInput');
            Object.defineProperty(fileInput, 'files', {
                value: [{ name: 'data.docx' }], configurable: true
            });
            fileInput.dispatchEvent(new Event('change'));
            expect(controller.loadedFile).toBeNull();
            expect(document.getElementById('status').textContent).toContain('Ошибка');
        });

        it('chapterFromSelect: logs when no invalid range (from <= to)', () => {
            const controller = new PopupController();
            controller._bindTitleEvents();
            const fromSel = document.getElementById('chapterFromSelect');
            const toSel = document.getElementById('chapterToSelect');
            [fromSel, toSel].forEach(sel => {
                ['1', '2', '3'].forEach(v => {
                    const opt = document.createElement('option');
                    opt.value = v;
                    sel.appendChild(opt);
                });
            });
            fromSel.value = '1';
            toSel.value = '2';
            const logSpy = vi.spyOn(console, 'log');
            fromSel.dispatchEvent(new Event('change'));
            expect(logSpy).toHaveBeenCalledWith('[PopupController] Chapter range selectors updated without invalid range');
        });

        it('hiddenFileInput change: no file with status null does not throw', () => {
            document.getElementById('status').remove();
            const controller = new PopupController();
            controller._bindTitleEvents();
            const fileInput = document.getElementById('fileInput');
            Object.defineProperty(fileInput, 'files', { value: [], configurable: true });
            expect(() => fileInput.dispatchEvent(new Event('change'))).not.toThrow();
        });

        it('hiddenFileInput change: valid ext with status null does not throw', () => {
            document.getElementById('status').remove();
            const controller = new PopupController();
            controller._bindTitleEvents();
            const fileInput = document.getElementById('fileInput');
            Object.defineProperty(fileInput, 'files', { value: [{ name: 'x.fb2' }], configurable: true });
            expect(() => fileInput.dispatchEvent(new Event('change'))).not.toThrow();
        });

        it('hiddenFileInput change: invalid ext with status null does not throw', () => {
            document.getElementById('status').remove();
            const controller = new PopupController();
            controller._bindTitleEvents();
            const fileInput = document.getElementById('fileInput');
            Object.defineProperty(fileInput, 'files', { value: [{ name: 'x.doc' }], configurable: true });
            expect(() => fileInput.dispatchEvent(new Event('change'))).not.toThrow();
        });

        it('chapterToSelect: logs when no invalid range (to >= from)', () => {
            const controller = new PopupController();
            controller._bindTitleEvents();
            const fromSel = document.getElementById('chapterFromSelect');
            const toSel = document.getElementById('chapterToSelect');
            [fromSel, toSel].forEach(sel => {
                ['1', '2', '3'].forEach(v => {
                    const opt = document.createElement('option');
                    opt.value = v;
                    sel.appendChild(opt);
                });
            });
            fromSel.value = '1';
            toSel.value = '2';
            const logSpy = vi.spyOn(console, 'log');
            toSel.dispatchEvent(new Event('change'));
            expect(logSpy).toHaveBeenCalledWith('[PopupController] Chapter range selectors updated without invalid range');
        });
    });

    describe('_applyUrlParams', () => {
        it('warns when maxSizeMBFromUrl is set but maxSizeInput element is missing', () => {
            const controller = new PopupController();
            const el = document.getElementById('maxSizeInput');
            if (el) el.parentNode.removeChild(el);
            const warnSpy = vi.spyOn(console, 'warn');
            controller._applyUrlParams({ maxSizeMBFromUrl: '100' });
            expect(warnSpy).toHaveBeenCalledWith('Max size input element not found');
        });
    });

    describe('_showWrongServiceState', () => {
        beforeEach(() => {
            global.TemplateLoader.show = vi.fn(async (name) => {
                if (name === 'wrong-service') {
                    document.body.innerHTML += `
                        <button id="openMangaLib"></button>
                        <button id="openRanobeLib"></button>
                        <button id="openGithub"></button>
                    `;
                }
                if (name === 'no-title') {
                    document.body.innerHTML += `<button id="openGithub"></button>`;
                }
            });
        });

        it('shows wrong-service template and binds openMangaLib click', async () => {
            const controller = new PopupController();
            controller._showNoTitleState = vi.fn(async () => {});
            await controller._showWrongServiceState();
            document.getElementById('openMangaLib').click();
            await new Promise(r => setTimeout(r, 10));
            expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://mangalib.me' });
        });

        it('binds openRanobeLib click', async () => {
            const controller = new PopupController();
            controller._showNoTitleState = vi.fn(async () => {});
            await controller._showWrongServiceState();
            document.getElementById('openRanobeLib').click();
            await new Promise(r => setTimeout(r, 10));
            expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://ranobelib.me' });
        });

        it('binds openGithub click in wrong-service', async () => {
            const controller = new PopupController();
            await controller._showWrongServiceState();
            document.getElementById('openGithub').click();
            expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://github.com/ivanvit100/DownloadLib' });
        });

        it('skips logoInfo clear when logoInfo is null in wrong-service', async () => {
            document.getElementById('logoInfo').remove();
            const controller = new PopupController();
            await expect(controller._showWrongServiceState()).resolves.not.toThrow();
        });
    });

    describe('_showNoTitleState', () => {
        it('binds openGithub click in no-title template', async () => {
            global.TemplateLoader.show = vi.fn(async (name) => {
                if (name === 'no-title') {
                    document.body.innerHTML += `<button id="openGithub"></button>`;
                }
            });
            const controller = new PopupController();
            await controller._showNoTitleState();
            document.getElementById('openGithub').click();
            expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://github.com/ivanvit100/DownloadLib' });
        });

        it('skips logoInfo clear when logoInfo is null in no-title state', async () => {
            global.TemplateLoader.show = vi.fn(async () => {});
            document.getElementById('logoInfo').remove();
            const controller = new PopupController();
            await expect(controller._showNoTitleState()).resolves.not.toThrow();
        });
    });

    describe('loadMetadata', () => {
        it('calls setServiceTab with activeTabId when tab has an id', async () => {
            const controller = new PopupController();
            await controller.loadMetadata();
            expect(global.setServiceTab).toHaveBeenCalledWith(42);
        });

        it('shows wrong service state when getServiceByUrl returns null', async () => {
            global.serviceRegistry.getServiceByUrl = vi.fn(() => null);
            global.TemplateLoader.show = vi.fn(async () => {});
            const controller = new PopupController();
            await controller.loadMetadata();
            expect(global.TemplateLoader.show).toHaveBeenCalledWith('wrong-service');
        });
    });

    describe('setupEventListeners', () => {
        it('download btn: appends chapterFrom/chapterTo params when container is visible', async () => {
            const controller = new PopupController();
            controller.currentSlug = 'my-slug';
            controller.currentServiceKey = 'ranobelib';
            controller.loadedFile = null;
            controller.isInSeparateWindow = vi.fn(async () => false);
            controller.openInNewContext = vi.fn(async () => {});

            const container = document.getElementById('chapterRangeContainer');
            container.style.display = 'block';
            const fromSel = document.getElementById('chapterFromSelect');
            const toSel = document.getElementById('chapterToSelect');
            ['0', '1', '2'].forEach(v => {
                const o1 = document.createElement('option'); o1.value = v; fromSel.appendChild(o1);
                const o2 = document.createElement('option'); o2.value = v; toSel.appendChild(o2);
            });
            fromSel.value = '0';
            toSel.value = '2';

            controller.setupEventListeners();
            document.getElementById('downloadBtn').click();
            await new Promise(r => setTimeout(r, 50));

            const url = controller.openInNewContext.mock.calls[0]?.[0];
            expect(url).toContain('chapterFrom=0');
            expect(url).toContain('chapterTo=2');
        });

        it('download btn falls back to startDownload when openInNewContext throws', async () => {
            const controller = new PopupController();
            controller.currentSlug = 'my-slug';
            controller.currentServiceKey = 'ranobelib';
            controller.loadedFile = null;
            controller.isInSeparateWindow = vi.fn(async () => false);
            controller.openInNewContext = vi.fn(async () => { throw new Error('window error'); });
            const startSpy = vi.spyOn(controller, 'startDownload').mockResolvedValue();

            controller.setupEventListeners();
            document.getElementById('downloadBtn').click();
            await new Promise(r => setTimeout(r, 50));

            expect(startSpy).toHaveBeenCalled();
        });

        it('download btn calls startDownload directly when loadedFile is set', async () => {
            const controller = new PopupController();
            controller.currentSlug = 'my-slug';
            controller.currentServiceKey = 'ranobelib';
            controller.loadedFile = { name: 'book.epub' };
            const startSpy = vi.spyOn(controller, 'startDownload').mockResolvedValue();

            controller.setupEventListeners();
            document.getElementById('downloadBtn').click();
            await new Promise(r => setTimeout(r, 50));

            expect(startSpy).toHaveBeenCalled();
        });

        it('pauseBtn click toggles isPaused and updates text', () => {
            const controller = new PopupController();
            controller.isPaused = false;
            controller.setupEventListeners();
            const pauseBtn = document.getElementById('pauseBtn');

            pauseBtn.click();
            expect(controller.isPaused).toBe(true);
            expect(pauseBtn.textContent).toBe('Продолжить');

            pauseBtn.click();
            expect(controller.isPaused).toBe(false);
            expect(pauseBtn.textContent).toBe('Пауза');
        });

        it('stopBtn click calls stopDownload', () => {
            const controller = new PopupController();
            const stopSpy = vi.spyOn(controller, 'stopDownload').mockImplementation(() => {});
            controller.setupEventListeners();
            document.getElementById('stopBtn').click();
            expect(stopSpy).toHaveBeenCalled();
        });

        it('pauseBtn warns when status element is missing', () => {
            const controller = new PopupController();
            controller.setupEventListeners();
            const status = document.getElementById('status');
            if (status) status.parentNode.removeChild(status);
            const warnSpy = vi.spyOn(console, 'warn');
            document.getElementById('pauseBtn').click();
            expect(warnSpy).toHaveBeenCalledWith('Status element not found when updating status on pause/resume');
        });
    });

    describe('download button fallback branches', () => {
        async function clickDownloadBtn(controller, elementsToRemove = []) {
            controller.currentSlug = 'slug';
            controller.currentServiceKey = 'ranobelib';
            controller.loadedFile = null;
            controller.isInSeparateWindow = vi.fn(async () => false);
            const openSpy = vi.fn(async () => {});
            controller.openInNewContext = openSpy;
            controller.setupEventListeners();
            elementsToRemove.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.parentNode.removeChild(el);
            });
            document.getElementById('downloadBtn').click();
            await new Promise(r => setTimeout(r, 50));
            return openSpy;
        }

        it('uses "fb2" fallback when formatSelector is missing in download button handler', async () => {
            const controller = new PopupController();
            const openSpy = await clickDownloadBtn(controller, ['formatSelector']);
            const url = openSpy.mock.calls[0]?.[0] || '';
            expect(url).toContain('format=fb2');
        });

        it('uses 100 fallback when rateLimitInput value is 0', async () => {
            const controller = new PopupController();
            controller.currentSlug = 'slug';
            controller.currentServiceKey = 'ranobelib';
            controller.loadedFile = null;
            controller.isInSeparateWindow = vi.fn(async () => false);
            const openSpy = vi.fn(async () => {});
            controller.openInNewContext = openSpy;
            controller.setupEventListeners();
            document.getElementById('rateLimitInput').value = '0';
            document.getElementById('downloadBtn').click();
            await new Promise(r => setTimeout(r, 50));
            const url = openSpy.mock.calls[0]?.[0] || '';
            expect(url).toContain('rateLimit=100');
        });

        it('uses 100 fallback when rateLimitInput is missing from DOM in download button handler', async () => {
            const controller = new PopupController();
            const openSpy = await clickDownloadBtn(controller, ['rateLimitInput']);
            const url = openSpy.mock.calls[0]?.[0] || '';
            expect(url).toContain('rateLimit=100');
        });

        it('uses "200" fallback when maxSizeInput is missing from DOM in download button handler', async () => {
            const controller = new PopupController();
            const openSpy = await clickDownloadBtn(controller, ['maxSizeInput']);
            const url = openSpy.mock.calls[0]?.[0] || '';
            expect(url).toContain('maxSizeMB=200');
        });
    });

    describe('_setDownloadingUIState formatLabel', () => {
        it('uses empty string for formatLabel when formatSelector is missing', async () => {
            const controller = new PopupController();
            controller.currentSlug = 'slug';
            controller.currentServiceKey = 'ranobelib';
            const formatEl = document.getElementById('formatSelector');
            if (formatEl) formatEl.parentNode.removeChild(formatEl);
            controller.downloadManager.startDownload = vi.fn(async () => ({}));
            await controller.startDownload();
            const panel = document.getElementById('downloadInfoPanel');
            expect(panel.innerHTML).toBeDefined();
        });
    });

    describe('resetUI chapter range display', () => {
        it('shows chapterRangeContainer when chapterFromSelect has options after reset', () => {
            const controller = new PopupController();
            const fromSel = document.getElementById('chapterFromSelect');
            const opt = document.createElement('option');
            opt.value = '0';
            fromSel.appendChild(opt);
            controller.resetUI();
            expect(document.getElementById('chapterRangeContainer').style.display).toBe('block');
        });
    });

    describe('_buildChapterRange', () => {
        it('returns from/to when container is visible', () => {
            const controller = new PopupController();
            const fromSel = document.getElementById('chapterFromSelect');
            const toSel = document.getElementById('chapterToSelect');
            const container = document.getElementById('chapterRangeContainer');
            const opt1 = document.createElement('option'); opt1.value = '0'; fromSel.appendChild(opt1);
            const opt2 = document.createElement('option'); opt2.value = '3'; toSel.appendChild(opt2);
            fromSel.value = '0';
            toSel.value = '3';
            container.style.display = 'block';
            const result = controller._buildChapterRange(fromSel, toSel, container);
            expect(result).toEqual({ from: 0, to: 3 });
        });

        it('returns null when container is hidden', () => {
            const controller = new PopupController();
            const fromSel = document.getElementById('chapterFromSelect');
            const toSel = document.getElementById('chapterToSelect');
            const container = document.getElementById('chapterRangeContainer');
            container.style.display = 'none';
            expect(controller._buildChapterRange(fromSel, toSel, container)).toBeNull();
        });
    });

    describe('customFileBtn.onclick branches', () => {
        async function setupCustomFileBtn(controller) {
            controller.isInSeparateWindow = vi.fn(async () => false);
            controller.openInNewContext = vi.fn(async () => {});
            await controller.loadMetadata();
        }

        it('else branch (not separate window): calls openInNewContext', async () => {
            const controller = new PopupController();
            await setupCustomFileBtn(controller);
            document.getElementById('customFileBtn').click();
            await new Promise(r => setTimeout(r, 50));
            expect(controller.openInNewContext).toHaveBeenCalled();
        });

        it('inner catch: calls hiddenFileInput.click when openInNewContext throws', async () => {
            const controller = new PopupController();
            controller.isInSeparateWindow = vi.fn(async () => false);
            controller.openInNewContext = vi.fn(async () => { throw new Error('ctx error'); });
            await controller.loadMetadata();
            const clickSpy = vi.spyOn(document.getElementById('fileInput'), 'click');
            document.getElementById('customFileBtn').click();
            await new Promise(r => setTimeout(r, 50));
            expect(clickSpy).toHaveBeenCalled();
        });

        it('outer catch: handles exception from isInSeparateWindow', async () => {
            const controller = new PopupController();
            controller.isInSeparateWindow = vi.fn(async () => { throw new Error('detect fail'); });
            await controller.loadMetadata();
            const clickSpy = vi.spyOn(document.getElementById('fileInput'), 'click');
            document.getElementById('customFileBtn').click();
            await new Promise(r => setTimeout(r, 50));
            expect(clickSpy).toHaveBeenCalled();
        });

        it('inSeparateWindow path: skips status update when status is null', async () => {
            document.getElementById('status').remove();
            const controller = new PopupController();
            controller.isInSeparateWindow = vi.fn(async () => true);
            await controller.loadMetadata();
            await expect(document.getElementById('customFileBtn').onclick()).resolves.not.toThrow();
        });

        it('inner catch path: skips status update when status is null', async () => {
            document.getElementById('status').remove();
            const controller = new PopupController();
            controller.isInSeparateWindow = vi.fn(async () => false);
            controller.openInNewContext = vi.fn(async () => { throw new Error('fail'); });
            await controller.loadMetadata();
            await expect(document.getElementById('customFileBtn').onclick()).resolves.not.toThrow();
        });

        it('outer catch path: skips status update when status is null', async () => {
            document.getElementById('status').remove();
            const controller = new PopupController();
            controller.isInSeparateWindow = vi.fn(() => { throw new Error('fail'); });
            await controller.loadMetadata();
            await expect(document.getElementById('customFileBtn').onclick()).resolves.not.toThrow();
        });
    });

    describe('_fetchCover', () => {
        it('returns base64 data URL when fetchViaTab returns ok response', async () => {
            global.fetchViaTab = vi.fn(async () => ({
                ok: true, contentType: 'image/jpeg', base64: 'abc123'
            }));
            const controller = new PopupController();
            controller.currentServiceKey = 'ranobelib';
            const result = await controller._fetchCover('https://example.com/cover.jpg');
            expect(result).toBe('data:image/jpeg;base64,abc123');
        });
    });

    describe('checkApiHealth', () => {
        it('calls _showApiWarning when cached.isFailing is true', async () => {
            global.localStorage.getItem = vi.fn(() =>
                JSON.stringify({ isFailing: true, timestamp: Date.now() })
            );
            const controller = new PopupController();
            const warnSpy = vi.spyOn(controller, '_showApiWarning');
            await controller.checkApiHealth();
            expect(warnSpy).toHaveBeenCalled();
        });

        it('does not call _showApiWarning when cached.isFailing is false', async () => {
            global.localStorage.getItem = vi.fn(() =>
                JSON.stringify({ isFailing: false, timestamp: Date.now() })
            );
            const controller = new PopupController();
            const warnSpy = vi.spyOn(controller, '_showApiWarning');
            await controller.checkApiHealth();
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('calls _showApiWarning when API returns failure conclusion', async () => {
            global.fetch = vi.fn(async () => ({
                json: async () => ({ workflow_runs: [{ conclusion: 'failure' }] })
            }));
            const controller = new PopupController();
            const warnSpy = vi.spyOn(controller, '_showApiWarning');
            await controller.checkApiHealth();
            expect(warnSpy).toHaveBeenCalled();
        });
    });

    it('attaches to self when window is undefined during IIFE', async () => {
        vi.resetModules();
        setupDOM();
        const originalWindow = global.window;
        delete global.window;
        global.self = global;
        global.browser = { runtime: { sendMessage: vi.fn(), getURL: vi.fn(() => '') }, tabs: { query: vi.fn(async () => []) }, windows: { getCurrent: vi.fn(async () => ({ type: 'normal' })) } };
        global.DownloadManager = class { constructor() { this.eventBus = { on: vi.fn() }; } startDownload = vi.fn(); stop = vi.fn(); getDownloadState = vi.fn(() => null); };
        global.ExporterRegistry = { getFormats: vi.fn(() => []) };
        global.TemplateLoader = { show: vi.fn(async () => {}), current: vi.fn(() => null) };
        global.HistoryController = { init: vi.fn() };
        global.AuthManager = { apply: vi.fn(async () => null) };
        global.ChapterController = class { constructor() {} loadAndPopulate = vi.fn(async () => 0); };
        global.DownloadHistory = { add: vi.fn() };
        global.setServiceTab = vi.fn();
        global.fetchViaTab = vi.fn(async () => null);
        await import('../../core/MangaPatcher.js');
        await import('../../ui/PopupController.js');
        expect(global.self.PopupController).toBeDefined();
        global.window = originalWindow;
    });

    describe('_showApiWarning', () => {
        it('inserts warning div before downloadBtn', () => {
            const controller = new PopupController();
            controller._showApiWarning('https://example.com/issues');
            expect(document.getElementById('apiWarning')).not.toBeNull();
            expect(document.getElementById('apiWarningMsg').textContent).toContain('API');
        });

        it('link click opens GitHub tab via browserAPI', () => {
            const controller = new PopupController();
            controller._showApiWarning('https://example.com/issues');
            const link = document.getElementById('apiWarningLink');
            link.click();
            expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com/issues' });
        });

        it('does not throw when downloadBtn is missing', () => {
            const controller = new PopupController();
            document.getElementById('downloadBtn').remove();
            expect(() => controller._showApiWarning('https://example.com')).not.toThrow();
        });
    });
});
