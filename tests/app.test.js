import { describe, it, beforeEach, vi, expect, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({}));

vi.mock('../core/BrowserApi.js', async () => (await import('./helpers/ModuleMock.js')).mockExports(mocks, 'extensionApi'));
vi.mock('../core/PluginApi.js', () => ({}));
vi.mock('../services/BuiltinServices.js', () => ({}));
vi.mock('../exporters/BuiltinExporters.js', () => ({}));
vi.mock('../core/PluginManager.js', async () => (await import('./helpers/ModuleMock.js')).mockExports(mocks, 'PluginManager'));
vi.mock('../ui/PopupController.js', async () => (await import('./helpers/ModuleMock.js')).mockExports(mocks, 'PopupController'));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('App initialization', () => {
    let errorDiv, logSpy, errorSpy, readyState;

    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '<div id="error" class="hidden"></div>';
        errorDiv = document.getElementById('error');
        readyState = 'complete';
        vi.spyOn(document, 'readyState', 'get').mockImplementation(() => readyState);

        mocks.PluginManager = { loadAll: vi.fn(async () => {}) };
        mocks.PopupController = vi.fn();
        mocks.extensionApi = null;

        logSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete mocks.PluginManager;
        delete mocks.PopupController;
        delete mocks.extensionApi;
    });

    it('Reads the log level from storage.local before loading plugins', async () => {
        const order = [];
        mocks.extensionApi = {
            storage: {
                local: { get: vi.fn(async () => { order.push('log level'); return { downloadlib_log_level: 'error' }; }) },
                onChanged: { addListener: vi.fn() }
            }
        };
        mocks.PluginManager.loadAll = vi.fn(async () => { order.push('plugins'); });
        await import('../app.js');
        await flush();
        const { getLogLevel } = await import('../core/ConsoleLogger.js');
        expect(order).toEqual(['log level', 'plugins']);
        expect(getLogLevel()).toBe('error');
        expect(mocks.extensionApi.storage.onChanged.addListener).toHaveBeenCalled();
    });

    it('Loads plugins and then creates the popup controller', async () => {
        const order = [];
        mocks.PluginManager.loadAll = vi.fn(async () => { order.push('plugins'); });
        mocks.PopupController = vi.fn(function() { order.push('ui'); });
        await import('../app.js');
        await flush();
        expect(logSpy).toHaveBeenCalledWith('[App] Initializing...');
        expect(order).toEqual(['plugins', 'ui']);
    });

    it('Imports the plugin API and the built-in registrations before starting', async () => {
        const pluginApi = await import('../core/PluginApi.js');
        const services = await import('../services/BuiltinServices.js');
        const exporters = await import('../exporters/BuiltinExporters.js');
        await import('../app.js');
        expect(pluginApi).toBeDefined();
        expect(services).toBeDefined();
        expect(exporters).toBeDefined();
    });

    it('Shows an error when PopupController throws', async () => {
        mocks.PopupController = vi.fn(function() { throw new Error('fail'); });
        await import('../app.js');
        await flush();
        expect(errorSpy).toHaveBeenCalledWith('[App] Failed to initialize PopupController:', expect.any(Error));
        expect(errorDiv.textContent).toContain('Ошибка инициализации: fail');
        expect(errorDiv.classList.contains('hidden')).toBe(false);
    });

    it('Waits for DOMContentLoaded while the document is loading', async () => {
        readyState = 'loading';
        let capturedCb;
        vi.spyOn(document, 'addEventListener').mockImplementation((evt, cb) => {
            if (evt === 'DOMContentLoaded') capturedCb = cb;
        });
        await import('../app.js');
        await flush();
        expect(mocks.PopupController).not.toHaveBeenCalled();
        expect(capturedCb).toBeDefined();
        await capturedCb();
        await flush();
        expect(mocks.PluginManager.loadAll).toHaveBeenCalled();
        expect(mocks.PopupController).toHaveBeenCalled();
    });

    it('Does not publish the popup controller as a global', async () => {
        await import('../app.js');
        await flush();
        expect(window.popupController).toBeUndefined();
    });
});
