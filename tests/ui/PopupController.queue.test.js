import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { withServiceFactory } from '../helpers/ServiceRegistryMock.js';

const mocks = vi.hoisted(() => ({}));

vi.mock('../../core/AuthManager.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'AuthManager'));
vi.mock('../../core/BrowserApi.js', async () => (await import('../helpers/ModuleMock.js'))
    .mockExports(mocks, 'extensionApi', 'browserEnv'));
vi.mock('../../core/TabNetwork.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'fetchViaTab', 'setServiceTab'));
vi.mock('../../core/DownloadHistory.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'DownloadHistory'));
vi.mock('../../core/DownloadManager.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'DownloadManager'));
vi.mock('../../core/DownloadQueueClient.js', async () => (await import('../helpers/ModuleMock.js'))
    .mockExports(mocks, 'DownloadQueueClient'));
vi.mock('../../core/PluginManager.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'PluginManager'));
vi.mock('../../exporters/ExporterRegistry.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'ExporterRegistry'));
vi.mock('../../services/ServiceRegistry.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'serviceRegistry'));
vi.mock('../../ui/ChapterController.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'ChapterController'));
vi.mock('../../ui/HistoryController.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'HistoryController'));
vi.mock('../../ui/QueueController.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'QueueController'));
vi.mock('../../ui/SettingsController.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'SettingsController'));
vi.mock('../../ui/TemplateLoader.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'TemplateLoader'));

let PopupController;
const originalLocation = window.location;

/**
 * Разметка оболочки попапа и шаблона title.
 * @returns {void}
 */
function setupDOM() {
    document.body.innerHTML = `
        <span id="queueBtn"></span>
        <img id="siteLogo" />
        <div id="logoInfo">info</div>
        <div id="error" class="hidden"></div>
        <div id="success" class="hidden"></div>
        <div id="view">
            <img id="cover" />
            <div id="description"></div>
            <div id="releaseDate"></div>
            <div id="formatContainer"><select id="formatSelector"></select></div>
            <div id="downloadInfoPanel" style="display:none;"></div>
            <button id="downloadBtn"></button>
            <div id="status"></div>
            <progress id="progress"></progress>
            <div id="downloadControls" style="display:none;">
                <button id="pauseBtn">Пауза</button>
                <button id="stopBtn">Завершить</button>
            </div>
        </div>
    `;
}

/**
 * Подменяет строку запроса страницы попапа.
 * @param {string} search - Строка запроса.
 * @returns {void}
 */
function setSearch(search) {
    Object.defineProperty(window, 'location', { value: { search }, writable: true, configurable: true });
}

/**
 * Создаёт контроллер готового экрана тайтла и дожидается его инициализации.
 * @param {boolean} separate - Открыт ли попап отдельным окном.
 * @returns {Promise<object>} Контроллер.
 */
async function readyController(separate) {
    const controller = new PopupController();
    await new Promise(r => setTimeout(r, 20));
    controller.currentSlug = 'slug';
    controller.currentServiceKey = 'mangalib';
    controller.currentTitle = 'Тайтл';
    controller.isInSeparateWindow = vi.fn(async () => separate);
    controller.openInNewContext = vi.fn(async () => {});
    document.getElementById('downloadBtn').disabled = false;
    return controller;
}

/**
 * Нажимает "Скачать" и ждёт обработки клика.
 * @returns {Promise<void>}
 */
async function clickDownload() {
    document.getElementById('downloadBtn').click();
    await new Promise(r => setTimeout(r, 20));
}

beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    setSearch('');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    global.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    mocks.DownloadManager = class {
        constructor() { this.eventBus = { on: vi.fn() }; }
        startDownload = vi.fn(async () => ({}));
        stop = vi.fn();
    };
    mocks.serviceRegistry = withServiceFactory({
        getServiceByUrl: vi.fn(() => null),
        getService: vi.fn(() => null)
    }, mocks);
    mocks.extensionApi = {
        runtime: { sendMessage: vi.fn(async () => ({ ok: true })), getURL: vi.fn(() => 'popup.html') },
        windows: { getCurrent: vi.fn(async () => ({ type: 'normal' })), create: vi.fn(), update: vi.fn() },
        tabs: { query: vi.fn(async () => []), create: vi.fn() },
        storage: { local: { get: vi.fn(async () => ({})), set: vi.fn() } }
    };
    mocks.DownloadQueueClient = {
        request: vi.fn(async () => ({ ok: true })),
        next: vi.fn(async () => null)
    };
    mocks.QueueController = { init: vi.fn() };
    mocks.ExporterRegistry = { getFormats: vi.fn(() => [{ value: 'fb2', label: 'FB2' }]) };
    mocks.DownloadHistory = { add: vi.fn() };
    mocks.AuthManager = { apply: vi.fn(async () => null) };
    mocks.ChapterController = class {
        loadAndPopulate = vi.fn(async () => 0);
        getChapters = vi.fn(() => []);
    };
    mocks.TemplateLoader = { init: vi.fn(), show: vi.fn(async () => {}), current: vi.fn(() => null) };
    mocks.HistoryController = { init: vi.fn() };
    mocks.SettingsController = { init: vi.fn() };
    mocks.fetchViaTab = vi.fn(async () => ({ ok: false, status: 0, noTab: true }));
    mocks.setServiceTab = vi.fn();
    mocks.browserEnv = { isFirefox: true };
    mocks.PluginManager = { loadAll: vi.fn(async () => {}) };
    global.fetch = vi.fn(async () => ({ json: async () => ({ workflow_runs: [] }) }));

    ({ PopupController } = await import('../../ui/PopupController.js'));
});

afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
    vi.restoreAllMocks();
});

afterAll(() => new Promise(resolve => setTimeout(resolve, 600)));

describe('Download button and the queue', () => {
    it('Asks the background with the form choice and the title', async () => {        await readyController(false);

        await clickDownload();

        const request = mocks.DownloadQueueClient.request.mock.calls[0][0];
        expect(request.title).toBe('Тайтл');
        expect(request.inPlace).toBe(false);
        expect(new URLSearchParams(request.params).get('slug')).toBe('slug');
    });

    it('Tells the position of a queued title and opens nothing', async () => {
        mocks.DownloadQueueClient.request.mockResolvedValue({ ok: true, queued: true, position: 2 });
        const controller = await readyController(false);
        const startSpy = vi.spyOn(controller, 'startDownload').mockResolvedValue();

        await clickDownload();

        expect(document.getElementById('success').textContent).toBe('Тайтл добавлен в очередь: 2');
        expect(controller.openInNewContext).not.toHaveBeenCalled();
        expect(startSpy).not.toHaveBeenCalled();
    });

    it('Tells that the title is downloading already', async () => {
        mocks.DownloadQueueClient.request.mockResolvedValue({ ok: true, queued: true, position: 0 });
        await readyController(false);

        await clickDownload();

        expect(document.getElementById('success').textContent).toBe('Этот тайтл уже скачивается');
    });

    it('Leaves opening the window to the background in the toolbar popup', async () => {
        const controller = await readyController(false);
        const startSpy = vi.spyOn(controller, 'startDownload').mockResolvedValue();

        await clickDownload();

        expect(controller.openInNewContext).not.toHaveBeenCalled();
        expect(startSpy).not.toHaveBeenCalled();
    });

    it('Opens the window itself when the background does not answer', async () => {
        mocks.DownloadQueueClient.request.mockResolvedValue(null);
        const controller = await readyController(false);

        await clickDownload();

        expect(controller.openInNewContext).toHaveBeenCalledWith(expect.stringContaining('slug=slug'));
    });

    it('Downloads in place in a separate window that is not queued', async () => {
        const controller = await readyController(true);
        const startSpy = vi.spyOn(controller, 'startDownload').mockResolvedValue();

        await clickDownload();

        expect(mocks.DownloadQueueClient.request.mock.calls[0][0].inPlace).toBe(true);
        expect(startSpy).toHaveBeenCalled();
    });

    it('Opens the queue view from the header', async () => {
        mocks.TemplateLoader.show = vi.fn(async (name, cb) => { if (cb) await cb(); });
        const controller = await readyController(false);
        const restoreSpy = vi.spyOn(controller, '_restoreMainView').mockResolvedValue();
        mocks.QueueController.init = vi.fn(onBack => onBack());

        document.getElementById('queueBtn').click();
        await new Promise(r => setTimeout(r, 0));

        expect(mocks.TemplateLoader.show).toHaveBeenCalledWith('queue', expect.any(Function));
        expect(document.getElementById('logoInfo').textContent).toBe('');
        expect(restoreSpy).toHaveBeenCalled();
    });
});

describe('Continuing the queue after a download', () => {
    it('Reports a successful download and goes on with the next title in the same window', async () => {
        const controller = await readyController(true);
        controller._queueId = 'q1';
        mocks.DownloadQueueClient.next.mockResolvedValue({ id: 'q2', params: 'download=true&slug=next' });
        const replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
        const restoreSpy = vi.spyOn(controller, '_restoreMainView').mockResolvedValue();

        await controller.startDownload();

        expect(mocks.DownloadQueueClient.next).toHaveBeenCalledWith({ queueId: 'q1', ok: true, error: null, stopped: false });
        expect(replaceSpy).toHaveBeenCalledWith(null, '', '?download=true&slug=next&queueId=q2');
        expect(restoreSpy).toHaveBeenCalled();
        expect(controller._queueId).toBeNull();
    });

    it('Reports a failed download with its error', async () => {
        const controller = await readyController(true);
        controller.downloadManager.startDownload = vi.fn(async () => { throw new Error('HTTP 500'); });

        await controller.startDownload();

        expect(mocks.DownloadQueueClient.next).toHaveBeenCalledWith({ queueId: null, ok: false, error: 'HTTP 500', stopped: false });
    });

    it('Reports a stopped download', async () => {
        const controller = await readyController(true);
        controller.downloadManager.startDownload = vi.fn(async ({ controller: downloadController }) => {
            downloadController.stop();
        });

        await controller.startDownload();

        expect(mocks.DownloadQueueClient.next).toHaveBeenCalledWith(expect.objectContaining({ ok: true, stopped: true }));
    });

    it('Stays on the page when the queue is empty', async () => {
        const controller = await readyController(true);
        const restoreSpy = vi.spyOn(controller, '_restoreMainView').mockResolvedValue();

        await controller.startDownload();

        expect(mocks.DownloadQueueClient.next).toHaveBeenCalled();
        expect(restoreSpy).not.toHaveBeenCalled();
    });

    it('Does not touch the queue from the toolbar popup', async () => {
        const controller = await readyController(false);

        await controller.startDownload();

        expect(mocks.DownloadQueueClient.next).not.toHaveBeenCalled();
    });

    it('Moves on when the title of the download window cannot be loaded', async () => {
        setSearch('?download=true&slug=s&service=nosuch&queueId=q1');
        vi.spyOn(console, 'error').mockImplementation(() => {});

        new PopupController();

        await vi.waitFor(() => expect(mocks.DownloadQueueClient.next).toHaveBeenCalledWith(
            { queueId: 'q1', ok: false, error: 'Unknown service: nosuch', stopped: false }));
    });

    it('Moves on when the chapters of a queued title are not found', async () => {
        setSearch('?download=true&slug=s&service=mangalib&queueId=q1');
        mocks.MangaLibService = class {
            name = 'mangalib';
            getManga = vi.fn(async () => ({ rus_name: 'T', summary: 'S', cover: null, authors: [] }));
        };
        mocks.ChapterController = class {
            rangeNotFound = true;
            loadAndPopulate = vi.fn(async () => 1);
        };

        new PopupController();

        await vi.waitFor(() => expect(mocks.DownloadQueueClient.next).toHaveBeenCalledWith(expect.objectContaining({
            queueId: 'q1', ok: false, error: expect.stringContaining('Выбранные главы не найдены')
        })));
    });
});
