import { describe, it, beforeEach, vi, expect, afterEach } from 'vitest';

describe('App initialization', () => {
    let originalWindow, originalDocument, errorDiv, logSpy, errorSpy;

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();

        originalWindow = global.window;
        originalDocument = global.document;

        errorDiv = { textContent: '', classList: { remove: vi.fn() } };

        const mockWindow = {};
        const mockDocument = {
            body: { innerHTML: '' },
            getElementById: vi.fn(() => errorDiv),
            readyState: 'complete',
            addEventListener: vi.fn(),
        };

        global.window = mockWindow;
        global.document = mockDocument;

        ['EventBus', 'RateLimiter', 'ServiceRegistry', 'DownloadManager', 'BaseService', 'MangaLibService', 'RanobeLibService', 'BaseExporter', 'FB2Exporter', 'EPUBExporter', 'PDFExporter', 'ExporterFactory', 'PopupController']
            .forEach(dep => {
                mockWindow[dep] = {};
            });

        mockWindow.serviceRegistry = {
            register: vi.fn(),
            getAllServices: vi.fn(() => ['MangaLibService', 'RanobeLibService']),
        };
        mockWindow.PopupController = vi.fn();

        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        global.window = originalWindow;
        global.document = originalDocument;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('Initialize and register services when all dependencies are present', async () => {
        await import('../app.js?test1');
        vi.runAllTimers();
        expect(logSpy).toHaveBeenCalledWith('[App] Initializing...');
        expect(logSpy).toHaveBeenCalledWith('[App] All dependencies loaded');
        expect(window.serviceRegistry.register).toHaveBeenCalledTimes(2);
        expect(window.PopupController).toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalledWith('[App] Missing dependencies:', expect.anything());
    });

    it('Show error if dependencies are missing', async () => {
        delete window.EventBus;
        await import('../app.js?test2');
        expect(errorSpy).toHaveBeenCalledWith('[App] Missing dependencies:', expect.arrayContaining(['EventBus']));
        expect(document.body.innerHTML).toContain('Ошибка загрузки модулей');
    });

    it('Handle PopupController initialization error', async () => {
        window.PopupController = vi.fn(() => { throw new Error('fail'); });
        document.getElementById = vi.fn(() => errorDiv);
        await import('../app.js?test3');
        vi.runAllTimers();
        expect(errorSpy).toHaveBeenCalledWith(
            '[App] Failed to initialize PopupController:',
            expect.any(Error)
        );
        expect(errorDiv.textContent).toContain('Ошибка инициализации');
        expect(errorDiv.classList.remove).toHaveBeenCalledWith('hidden');
    });

    it('Call console.error when registering MangaLibService fails', async () => {
        let callCount = 0;
        window.serviceRegistry.register = vi.fn(() => {
            callCount++;
            if (callCount === 1) throw new Error('fail-mangalib');
        });
        await import('../app.js?mangalib-error');
        vi.runAllTimers();
        expect(errorSpy).toHaveBeenCalledWith(
            '[App] Failed to register MangaLibService:',
            expect.any(Error)
        );
    });

    it('Call console.error when registering RanobeLibService fails', async () => {
        let callCount = 0;
        window.serviceRegistry.register = vi.fn(() => {
            callCount++;
            if (callCount === 2) throw new Error('fail-ranobe');
        });
        await import('../app.js?ranobe-error');
        vi.runAllTimers();
        expect(errorSpy).toHaveBeenCalledWith(
            '[App] Failed to register RanobeLibService:',
            expect.any(Error)
        );
    });

    it('Check if document ready state is "loading"', async () => {
        document.readyState = 'loading';
        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
        await import('../app.js?domcontentloaded');
        expect(addEventListenerSpy).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));
    });

    it('Does not force assigning window.chrome from window.browser', async () => {
        const originalBrowser = global.browser;
        const originalChrome = global.chrome;
        const originalWindow = global.window;

        global.window = {};
        global.browser = { foo: 'bar' };
        delete global.chrome;

        await import('../app.js?chrome-test');

        expect(global.window.chrome).toBeUndefined();

        if (originalBrowser !== undefined) global.browser = originalBrowser;
        else delete global.browser;
        if (originalChrome !== undefined) global.chrome = originalChrome;
        else delete global.chrome;
        global.window = originalWindow;
    });

    it('Uses provided extension api resolver when available', async () => {
        vi.resetModules();
        document.body.innerHTML = '<div id="error" class="hidden"></div>';
        window.EventBus = class {};
        window.RateLimiter = class {};
        window.ServiceRegistry = class {};
        window.DownloadManager = class {};
        window.BaseService = class {};
        window.MangaLibService = class {};
        window.RanobeLibService = class {};
        window.BaseExporter = class {};
        window.FB2Exporter = class {};
        window.EPUBExporter = class {};
        window.PDFExporter = class {};
        window.ExporterFactory = class {};
        window.PopupController = class {};
        window.serviceRegistry = { register: vi.fn(), getAllServices: vi.fn(() => []) };
        globalThis.getExtensionApi = vi.fn(() => ({ runtime: {} }));
        globalThis.browser = { runtime: { id: 'browser' } };
        globalThis.chrome = { runtime: { id: 'chrome' } };
        await import('../app.js');
        expect(globalThis.getExtensionApi).toHaveBeenCalledTimes(1);
    });

    it('Uses chrome api fallback when browser is unavailable', async () => {
        vi.resetModules();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        delete globalThis.getExtensionApi;
        delete globalThis.browser;
        let chromeReads = 0;
        Object.defineProperty(globalThis, 'chrome', {
            configurable: true,
            get() {
                chromeReads += 1;
                return { runtime: { id: 'chrome' } };
            }
        });
        await import('../app.js');
        expect(chromeReads).toBeGreaterThan(0);
        expect(warnSpy).not.toHaveBeenCalledWith('[App] Extension API is not available in this context');
        warnSpy.mockRestore();
        delete globalThis.chrome;
    });
});