import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Модули вне background/, которые может загружать фон: без экспортёров, JSZip, классов сервисов. */
const BACKGROUND_ALLOWED = [
    /^background\//,
    /^core\/(BrowserApi|ConsoleLogger|MessageTypes|RateLimiter)\.js$/,
    /^services\/ServiceHosts\.js$/,
    /^services\/[^/]+\/config\.js$/
];

/**
 * Собирает статический граф относительных импортов модуля.
 * @param {string} entry - Путь модуля от корня проекта.
 * @returns {string[]} Пути всех модулей графа от корня проекта.
 */
function importGraph(entry) {
    const seen = new Set();
    const walk = file => {
        if (seen.has(file)) return;
        seen.add(file);
        const source = readFileSync(join(ROOT, file), 'utf8');
        const imports = source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm);
        for (const [, from, bare] of imports) {
            const spec = from || bare;
            if (spec.startsWith('.')) walk(relative(ROOT, normalize(join(ROOT, dirname(file), spec))));
        }
    };
    walk(entry);
    return [...seen];
}

/** Первый импорт всех модулей попапа под инструментированием покрытия занимает больше 5 с. */
const FIRST_IMPORT_TIMEOUT_MS = 30000;

const INTERNAL_GLOBALS = [
    'DownloadManager', 'PopupController', 'popupController', 'PluginManager', 'AuthManager',
    'DownloadHistory', 'TemplateLoader', 'ChapterController', 'HistoryController', 'SettingsController',
    'DeferredQueue', 'deferredLoadSettings', 'detectServiceByUrl', 'authTokenStore', 'pluginServiceHosts'
];

const SUPPORTED_PLUGIN_GLOBALS = ['BaseExporter', 'ExporterRegistry', 'BaseService', 'serviceRegistry'];

let publishedNames = [];

describe('ES module graph', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        [...publishedNames, 'chrome'].forEach(name => delete globalThis[name]);
        publishedNames = [];
    });

    it('Evaluates every popup module and publishes only the plugin API', async () => {
        const { pluginApi, legacyPluginGlobals } = await import('../core/PluginApi.js');
        publishedNames = [...Object.keys(pluginApi), ...Object.keys(legacyPluginGlobals)];
        const { serviceRegistry } = await import('../services/BuiltinServices.js');
        const { ExporterRegistry } = await import('../exporters/BuiltinExporters.js');
        const { PluginManager } = await import('../core/PluginManager.js');
        const { PopupController } = await import('../ui/PopupController.js');

        expect(typeof PopupController).toBe('function');
        expect(typeof PluginManager.loadAll).toBe('function');
        expect([...serviceRegistry.services.keys()]).toEqual(['mangalib', 'ranobelib']);
        expect(ExporterRegistry.getSupportedFormats()).toEqual(['fb2', 'epub', 'mobi', 'pdf', 'simple']);
        expect(Object.keys(pluginApi)).toEqual(SUPPORTED_PLUGIN_GLOBALS);
        expect(globalThis.serviceRegistry).toBe(serviceRegistry);
        expect(globalThis.ExporterRegistry).toBe(ExporterRegistry);
        INTERNAL_GLOBALS.forEach(name => expect(globalThis[name], name).toBeUndefined());
    }, FIRST_IMPORT_TIMEOUT_MS);

    it('Evaluates the background entry point and installs its listeners and rules', async () => {
        const { legacyPluginGlobals } = await vi.importActual('../core/PluginApi.js');
        const pluginNames = [...SUPPORTED_PLUGIN_GLOBALS, ...Object.keys(legacyPluginGlobals)];
        pluginNames.forEach(name => delete globalThis[name]);
        vi.resetModules();

        globalThis.chrome = {
            runtime: {
                id: 'ext',
                onMessage: { addListener: vi.fn() },
                onConnect: { addListener: vi.fn() },
                onStartup: { addListener: vi.fn() }
            },
            webRequest: {
                onBeforeSendHeaders: { addListener: vi.fn() },
                onBeforeRequest: { addListener: vi.fn() }
            },
            declarativeNetRequest: {
                getSessionRules: vi.fn().mockResolvedValue([]),
                updateSessionRules: vi.fn().mockResolvedValue()
            }
        };

        await import('../background/BackgroundMain.js');
        await vi.waitFor(() => expect(globalThis.chrome.declarativeNetRequest.updateSessionRules).toHaveBeenCalled());

        expect(globalThis.chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
        expect(globalThis.chrome.runtime.onConnect.addListener).toHaveBeenCalledTimes(1);
        expect(globalThis.chrome.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
        expect(globalThis.chrome.webRequest.onBeforeSendHeaders.addListener).toHaveBeenCalledTimes(1);
        expect(globalThis.chrome.webRequest.onBeforeRequest.addListener).not.toHaveBeenCalled();
        [...INTERNAL_GLOBALS, ...pluginNames].forEach(name => expect(globalThis[name], name).toBeUndefined());
    });

    it('Keeps the background thin: no exporters, JSZip, MangaPatcher or service classes', () => {
        const graph = importGraph('background/BackgroundMain.js');
        expect(graph).toEqual(expect.arrayContaining([
            'background/RateLimitService.js', 'background/TokenStore.js', 'background/PluginHosts.js',
            'background/RequestInterceptor.js', 'background/MessageRouter.js', 'background/AdBlockRules.js',
            'core/MessageTypes.js', 'core/RateLimiter.js', 'services/ServiceHosts.js'
        ]));
        const unexpected = graph.filter(file => !BACKGROUND_ALLOWED.some(pattern => pattern.test(file)));
        expect(unexpected).toEqual([]);
    });
});
