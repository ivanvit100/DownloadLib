import { describe, it, beforeEach, vi, expect, afterEach } from 'vitest';

vi.mock('../core/pluginApi.js', () => ({}));
vi.mock('../services/index.js', () => ({}));
vi.mock('../exporters/index.js', () => ({}));
vi.mock('../core/PluginManager.js', async () => (await import('./helpers/globalBridge.js')).globalBridge('PluginManager'));
vi.mock('../ui/PopupController.js', async () => (await import('./helpers/globalBridge.js')).globalBridge('PopupController'));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('App initialization', () => {
    let errorDiv, logSpy, errorSpy, readyState;

    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '<div id="error" class="hidden"></div>';
        errorDiv = document.getElementById('error');
        readyState = 'complete';
        vi.spyOn(document, 'readyState', 'get').mockImplementation(() => readyState);

        global.PluginManager = { loadAll: vi.fn(async () => {}) };
        global.PopupController = vi.fn();

        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete global.PluginManager;
        delete global.PopupController;
    });

    it('Loads plugins and then creates the popup controller', async () => {
        const order = [];
        global.PluginManager.loadAll = vi.fn(async () => { order.push('plugins'); });
        global.PopupController = vi.fn(function() { order.push('ui'); });
        await import('../app.js');
        await flush();
        expect(logSpy).toHaveBeenCalledWith('[App] Initializing...');
        expect(order).toEqual(['plugins', 'ui']);
    });

    it('Imports the plugin API and the built-in registrations before starting', async () => {
        const pluginApi = await import('../core/pluginApi.js');
        const services = await import('../services/index.js');
        const exporters = await import('../exporters/index.js');
        await import('../app.js');
        expect(pluginApi).toBeDefined();
        expect(services).toBeDefined();
        expect(exporters).toBeDefined();
    });

    it('Shows an error when PopupController throws', async () => {
        global.PopupController = vi.fn(function() { throw new Error('fail'); });
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
        expect(global.PopupController).not.toHaveBeenCalled();
        expect(capturedCb).toBeDefined();
        await capturedCb();
        await flush();
        expect(global.PluginManager.loadAll).toHaveBeenCalled();
        expect(global.PopupController).toHaveBeenCalled();
    });

    it('Does not publish the popup controller as a global', async () => {
        await import('../app.js');
        await flush();
        expect(window.popupController).toBeUndefined();
    });
});
