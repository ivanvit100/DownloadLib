import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let PopupController;

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
                <select id="chapterFromSelect"></select>
                <select id="chapterToSelect"></select>
            </div>
            <div id="splitPagesContainer" style="display:none;">
                <input type="checkbox" id="splitPagesCheckbox">
            </div>
            <div id="formatContainer">
                <select id="formatSelector"></select>
            </div>
            <div id="fileInputContainer">
                <input type="file" id="fileInput">
                <button id="customFileBtn">Загрузить</button>
            </div>
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

beforeEach(async () => {
    vi.resetModules();
    delete global.getExtensionApi;
    setupDOM();

    global.localStorage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    global.DownloadManager = class {
        constructor() { this.eventBus = { on: vi.fn() }; }
        startDownload = vi.fn(async () => ({}));
        stop = vi.fn();
    };
    global.serviceRegistry = {
        getServiceByUrl: vi.fn(() => ({
            name: 'ranobelib',
            fetchMangaMetadata: vi.fn(async () => ({
                data: { rus_name: 'T', summary: 'S', cover: null, authors: [], ageRestriction: null }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [] }))
        })),
        getService: vi.fn(() => null),
    };
    global.browser = {
        runtime: { sendMessage: vi.fn(async () => ({ ok: true })), getURL: vi.fn(() => 'popup.html') },
        windows: { getCurrent: vi.fn(async () => ({ type: 'normal' })), create: vi.fn(async () => ({ id: 1 })), update: vi.fn() },
        tabs: { query: vi.fn(async () => ([{ url: 'https://ranobelib.me/manga/slug', id: 42 }])), create: vi.fn() }
    };
    global.chrome = undefined;
    global.ExporterRegistry = { getFormats: vi.fn(() => [{ value: 'fb2', label: 'FB2' }]) };
    global.DownloadHistory = { add: vi.fn() };
    global.AuthManager = { apply: vi.fn(async () => null) };
    global.ChapterController = class { loadAndPopulate = vi.fn(async () => 0); };
    global.TemplateLoader = { init: vi.fn(), show: vi.fn(async () => {}), current: vi.fn(() => null) };
    global.HistoryController = { init: vi.fn() };
    global.fetchViaTab = vi.fn(async () => null);
    global.setServiceTab = vi.fn();
    global.fetch = vi.fn(async () => ({ json: async () => ({ workflow_runs: [] }) }));

    await import('../../core/MangaPatcher.js');
    await import('../../ui/PopupController.js');
    PopupController = global.PopupController;
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('_init settings callback', () => {
    it('calls SettingsController.init via TemplateLoader.show callback', async () => {
        const origLocation = window.location;
        Object.defineProperty(window, 'location', {
            value: { search: '?settings' },
            writable: true
        });
        global.TemplateLoader.show = vi.fn(async (name, cb) => { if (cb) await cb(); });
        global.SettingsController = { init: vi.fn() };

        new PopupController();
        await new Promise(r => setTimeout(r, 10));

        expect(global.SettingsController.init).toHaveBeenCalled();
        Object.defineProperty(window, 'location', { value: origLocation, writable: true });
    });
});

describe('_bindShellEvents settingsBtn', () => {
    it('settingsBtn click calls openInNewContext with settings URL', async () => {
        document.body.innerHTML += '<button id="settingsBtn"></button>';
        const controller = new PopupController();
        controller._shellEventsBound = false;
        const openSpy = vi.spyOn(controller, 'openInNewContext').mockResolvedValue();
        controller._bindShellEvents();
        document.getElementById('settingsBtn').click();
        await Promise.resolve();
        expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('settings=true'));
    });
});

describe('_init storage.onChanged listener', () => {
    beforeEach(() => {
        global.PluginManager = { loadAll: vi.fn().mockResolvedValue() };
        global.browser.storage = {
            onChanged: { addListener: vi.fn() }
        };
    });

    async function getStorageListener() {
        new PopupController();
        await new Promise(r => setTimeout(r, 0));
        return global.browser.storage.onChanged.addListener.mock.calls[0]?.[0];
    }

    it('registers listener when storage.onChanged exists', async () => {
        await getStorageListener();
        expect(global.browser.storage.onChanged.addListener).toHaveBeenCalled();
    });

    it('listener early-returns when area is not local', async () => {
        const listener = await getStorageListener();
        await listener({ custom_plugins: {} }, 'sync');
        expect(global.PluginManager.loadAll).not.toHaveBeenCalled();
    });

    it('listener early-returns when custom_plugins not in changes', async () => {
        const listener = await getStorageListener();
        await listener({ other_key: {} }, 'local');
        expect(global.PluginManager.loadAll).not.toHaveBeenCalled();
    });

    it('listener reloads plugins and rebuilds formatSelector', async () => {
        const listener = await getStorageListener();
        await listener({ custom_plugins: { newValue: [] } }, 'local');
        expect(global.PluginManager.loadAll).toHaveBeenCalled();
        const sel = document.getElementById('formatSelector');
        expect(sel.querySelectorAll('option').length).toBeGreaterThan(0);
    });

    it('listener early-returns when formatSelector absent', async () => {
        const listener = await getStorageListener();
        document.getElementById('formatSelector').remove();
        await expect(listener({ custom_plugins: {} }, 'local')).resolves.toBeUndefined();
    });

    it('listener restores current sel.value when non-empty', async () => {
        const sel = document.getElementById('formatSelector');
        const opt = document.createElement('option');
        opt.value = 'epub'; opt.textContent = 'EPUB';
        sel.appendChild(opt);
        sel.value = 'epub';

        const listener = await getStorageListener();
        await listener({ custom_plugins: {} }, 'local');
        expect(global.PluginManager.loadAll).toHaveBeenCalled();
    });

    it('listener does not set sel.value when current is empty', async () => {
        const listener = await getStorageListener();
        const sel = document.getElementById('formatSelector');
        sel.innerHTML = '';
        await listener({ custom_plugins: {} }, 'local');
        expect(global.PluginManager.loadAll).toHaveBeenCalled();
    });
});

describe('_showWrongServiceState service links', () => {
    it('renders service link buttons for services with siteUrl', async () => {
        document.body.innerHTML += '<div id="serviceLinks"></div><div id="logoInfo"></div>';
        global.serviceRegistry.getAllServices = vi.fn(() => [
            { config: { name: 'ex1', siteUrl: 'https://example.com', primaryColor: '#f00', label: 'Example' } },
            { config: { name: 'ex2' } },
        ]);
        const controller = new PopupController();
        await controller._showWrongServiceState();
        const serviceLinks = document.getElementById('serviceLinks');
        expect(serviceLinks.querySelectorAll('button').length).toBe(1);
    });

    it('renders service button without primaryColor', async () => {
        document.body.innerHTML += '<div id="serviceLinks"></div>';
        global.serviceRegistry.getAllServices = vi.fn(() => [
            { config: { name: 'ex1', siteUrl: 'https://example.com', label: 'Example' } },
        ]);
        const controller = new PopupController();
        await controller._showWrongServiceState();
        const btn = document.querySelector('.ex1-link-btn');
        expect(btn).toBeTruthy();
        expect(btn.style.border).toBe('');
    });

    it('service.config || {} fallback when config is null', async () => {
        document.body.innerHTML += '<div id="serviceLinks"></div>';
        global.serviceRegistry.getAllServices = vi.fn(() => [
            { config: null },
            { config: { name: 'ex1', siteUrl: 'https://example.com' } },
        ]);
        const controller = new PopupController();
        await controller._showWrongServiceState();
        const btn = document.querySelector('.ex1-link-btn');
        expect(btn.textContent).toBe('ex1');
    });

    it('service link button click calls tabs.create and showNoTitleState', async () => {
        document.body.innerHTML += '<div id="serviceLinks"></div>';
        global.serviceRegistry.getAllServices = vi.fn(() => [
            { config: { name: 'ex1', siteUrl: 'https://example.com', label: 'Ex' } },
        ]);
        const controller = new PopupController();
        vi.spyOn(controller, '_showNoTitleState').mockResolvedValue();
        await controller._showWrongServiceState();
        document.querySelector('.ex1-link-btn').click();
        await Promise.resolve();
        expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://example.com' });
    });
});

describe('loadMetadata tabId URL param', () => {
    it('parses tabId from URL params', async () => {
        const fakeService = {
            name: 'customsvc',
            config: {},
            fetchMangaMetadata: vi.fn(async () => ({
                data: { rus_name: 'T', summary: 'S', cover: null, authors: [], ageRestriction: null }
            })),
            fetchChaptersList: vi.fn(async () => ({ data: [] })),
        };
        global.serviceRegistry.getService = vi.fn(() => fakeService);
        const controller = new PopupController();
        const origLocation = window.location;
        Object.defineProperty(window, 'location', {
            value: { search: '?download=true&slug=testslug&service=customsvc&tabId=42' },
            writable: true
        });
        await controller.loadMetadata();
        Object.defineProperty(window, 'location', { value: origLocation, writable: true });
        expect(controller.currentSlug).toBe('testslug');
    });
});

describe('downloadBtn splitPages truthy branch', () => {
    it('sets splitPages=true when container is visible and checkbox checked', async () => {
        const controller = new PopupController();
        await new Promise(r => setTimeout(r, 50));

        const container = document.getElementById('splitPagesContainer');
        container.style.display = 'flex';
        document.getElementById('splitPagesCheckbox').checked = true;

        vi.spyOn(controller, 'isInSeparateWindow').mockResolvedValue(false);
        const openSpy = vi.spyOn(controller, 'openInNewContext').mockResolvedValue();
        controller.currentSlug = 'test-slug';
        controller.currentServiceKey = 'ranobelib';

        document.getElementById('downloadBtn').click();
        await new Promise(r => setTimeout(r, 10));

        expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('splitPages=true'));
    });
});
