import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const LEGACY_GLOBALS = [
    'DownloadManager', 'PopupController', 'EventBus', 'RateLimiter', 'globalRateLimiter',
    'MangaPatcher', 'AuthManager', 'PluginManager', 'fetchViaTab', 'getExtensionApi',
    'getBrowserEnv', 'detectServiceByUrl', 'authTokenStore', 'pluginServiceHosts'
];

describe('ES module graph', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        ['BaseExporter', 'ExporterRegistry', 'BaseService', 'serviceRegistry', 'chrome']
            .forEach(name => delete globalThis[name]);
    });

    it('Evaluates every popup module and publishes only the plugin API', async () => {
        await import('../core/pluginApi.js');
        const { serviceRegistry } = await import('../services/index.js');
        const { ExporterRegistry } = await import('../exporters/index.js');
        const { PluginManager } = await import('../core/PluginManager.js');
        const { PopupController } = await import('../ui/PopupController.js');

        expect(typeof PopupController).toBe('function');
        expect(typeof PluginManager.loadAll).toBe('function');
        expect([...serviceRegistry.services.keys()]).toEqual(['mangalib', 'ranobelib']);
        expect(ExporterRegistry.getSupportedFormats()).toEqual(['fb2', 'epub', 'mobi', 'pdf', 'simple']);
        expect(globalThis.serviceRegistry).toBe(serviceRegistry);
        expect(globalThis.ExporterRegistry).toBe(ExporterRegistry);
        LEGACY_GLOBALS.forEach(name => expect(globalThis[name], name).toBeUndefined());
    });

    it('Evaluates the background entry point and installs its listeners', async () => {
        globalThis.chrome = {
            runtime: { id: 'ext', onMessage: { addListener: vi.fn() }, onConnect: { addListener: vi.fn() } },
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onBeforeRequest: { addListener: vi.fn() }
            },
            declarativeNetRequest: {}
        };

        await import('../background/main.js');

        expect(globalThis.chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
        expect(globalThis.chrome.runtime.onConnect.addListener).toHaveBeenCalledTimes(1);
        expect(globalThis.chrome.webRequest.onBeforeSendHeaders.addListener).toHaveBeenCalledTimes(1);
        LEGACY_GLOBALS.forEach(name => expect(globalThis[name], name).toBeUndefined());
    });
});
