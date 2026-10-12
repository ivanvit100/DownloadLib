import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../core/BrowserApi.js', async () => (await import('../helpers/globalBridge.js'))
    .globalBridge('extensionApi', 'browserEnv'));
vi.mock('../../core/TabNetwork.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('NoServiceTabError'));
vi.mock('../../core/ImageCompressor.js', async () => (await import('../helpers/globalBridge.js'))
    .globalBridge('ImageCompressor', 'PAGE_ASPECT'));
vi.mock('../../exporters/BaseExporter.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('BaseExporter'));
vi.mock('../../exporters/ExporterRegistry.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('ExporterRegistry'));
vi.mock('../../services/BaseService.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('BaseService'));
vi.mock('../../services/ServiceRegistry.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('serviceRegistry'));

let PluginManager;

class MockBaseService {
    constructor(config) { this.config = config; this.name = config?.name; this.extensionApi = null; }
    extractPages(content) { return content || []; }
}

async function loadModule() {
    vi.resetModules();
    ({ PluginManager } = await import('../../core/PluginManager.js'));
}

// Vite фиксирует базовый класс `extends` при загрузке модуля,
// поэтому заглушки BaseService/BaseExporter задаются до импорта.
beforeEach(async () => {
    delete globalThis.extensionApi;
    globalThis.BaseService = MockBaseService;
    globalThis.BaseExporter = class {};
    delete globalThis.ExporterRegistry;
    delete globalThis.serviceRegistry;
    globalThis.browserEnv = { isFirefox: false };
    globalThis.NoServiceTabError = class NoServiceTabError extends Error {};
    globalThis.ImageCompressor = { compress: vi.fn(async (base64, contentType) => ({ base64, contentType })) };
    await loadModule();
});

describe('parseMetadata', () => {
    it('returns nulls for empty code', () => {
        const m = PluginManager.parseMetadata('');
        expect(m.format).toBeNull();
        expect(m.label).toBeNull();
        expect(m.service).toBeNull();
        expect(m.serviceLabel).toBeNull();
        expect(m.hosts).toEqual([]);
        expect(m.serviceConfig).toBeNull();
    });

    it('extracts @dl-format', () => {
        const code = '/**\n * @dl-format myformat\n */';
        expect(PluginManager.parseMetadata(code).format).toBe('myformat');
    });

    it('extracts @dl-label', () => {
        const code = '/**\n * @dl-label My Label\n */';
        expect(PluginManager.parseMetadata(code).label).toBe('My Label');
    });

    it('extracts @dl-service', () => {
        const code = '/**\n * @dl-service myservice\n */';
        expect(PluginManager.parseMetadata(code).service).toBe('myservice');
    });

    it('extracts @dl-service-label', () => {
        const code = '/**\n * @dl-service-label My Service\n */';
        expect(PluginManager.parseMetadata(code).serviceLabel).toBe('My Service');
    });

    it('extracts multiple @dl-host entries', () => {
        const code = '/**\n * @dl-host example.com\n * @dl-host sub.example.com\n */';
        expect(PluginManager.parseMetadata(code).hosts).toEqual(['example.com', 'sub.example.com']);
    });

    it('parses @dl-service-config JSON block', () => {
        const code = `/**
 * @dl-service-config
 * {"baseUrl": "https://ex.com"}
 */`;
        expect(PluginManager.parseMetadata(code).serviceConfig).toEqual({ baseUrl: 'https://ex.com' });
    });

    it('ignores invalid @dl-service-config JSON', () => {
        const code = `/**
 * @dl-service-config
 * {not valid json}
 */`;
        expect(PluginManager.parseMetadata(code).serviceConfig).toBeNull();
    });
});

describe('generateId', () => {
    it('returns unique ids each call', () => {
        const a = PluginManager.generateId();
        const b = PluginManager.generateId();
        expect(a).toMatch(/^plugin_\d+_/);
        expect(a).not.toBe(b);
    });
});

describe('list() / _storageGet', () => {
    it('returns [] when the extension api is unavailable', async () => {
        expect(await PluginManager.list()).toEqual([]);
    });

    it('reads plugins from storage.local of the extension api', async () => {
        globalThis.extensionApi = { storage: { local: { get: vi.fn().mockResolvedValue({ custom_plugins: [{ id: '2' }] }) } } };
        expect(await PluginManager.list()).toEqual([{ id: '2' }]);
    });

    it('returns [] when storage.local.get result has no custom_plugins key', async () => {
        globalThis.extensionApi = { storage: { local: { get: vi.fn().mockResolvedValue({}) } } };
        expect(await PluginManager.list()).toEqual([]);
    });

    it('returns [] and warns when storage.local.get throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.extensionApi = { storage: { local: { get: vi.fn().mockRejectedValue(new Error('fail')) } } };
        expect(await PluginManager.list()).toEqual([]);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('save() — format branch', () => {
    let mockSet, mockGet;
    beforeEach(() => {
        mockGet = vi.fn().mockResolvedValue({});
        mockSet = vi.fn().mockResolvedValue();
        globalThis.extensionApi = { storage: { local: { get: mockGet, set: mockSet } } };
    });

    it('extracts format metadata and stores plugin', async () => {
        const plugin = { id: 'p1', code: '/**\n * @dl-format myfmt\n * @dl-label MyLabel\n */' };
        await PluginManager.save(plugin);
        expect(plugin.format).toBe('myfmt');
        expect(plugin.label).toBe('MyLabel');
        expect(plugin).not.toHaveProperty('service');
        expect(mockSet).toHaveBeenCalled();
    });

    it('uses format.toUpperCase() as label when @dl-label is absent', async () => {
        const plugin = { id: 'p2', code: '/**\n * @dl-format myfmt\n */' };
        await PluginManager.save(plugin);
        expect(plugin.label).toBe('MYFMT');
    });

    it('extracts service metadata and stores plugin', async () => {
        const plugin = { id: 'p3', code: '/**\n * @dl-service mysvc\n * @dl-service-label My Svc\n */' };
        await PluginManager.save(plugin);
        expect(plugin.service).toBe('mysvc');
        expect(plugin.serviceLabel).toBe('My Svc');
        expect(plugin).not.toHaveProperty('format');
    });

    it('uses service.toUpperCase() as serviceLabel when absent', async () => {
        const plugin = { id: 'p4', code: '/**\n * @dl-service mysvc\n */' };
        await PluginManager.save(plugin);
        expect(plugin.serviceLabel).toBe('MYSVC');
    });

    it('applies serviceConfig when present', async () => {
        const plugin = { id: 'p5', code: `/*\n * @dl-service-config\n * {"baseUrl":"https://ex.com"}\n */\n/**\n * @dl-service mysvc\n */` };
        await PluginManager.save(plugin);
        expect(plugin.serviceConfig).toEqual({ name: 'mysvc', baseUrl: 'https://ex.com' });
    });

    it('sets hosts when @dl-host present', async () => {
        const plugin = { id: 'p6', code: '/**\n * @dl-format myfmt\n * @dl-host ex.com\n */' };
        await PluginManager.save(plugin);
        expect(plugin.hosts).toEqual(['ex.com']);
    });

    it('updates existing plugin by id', async () => {
        const existing = { id: 'p7', name: 'old' };
        mockGet.mockResolvedValue({ custom_plugins: [existing] });
        const plugin = { id: 'p7', name: 'new', code: '' };
        await PluginManager.save(plugin);
        const saved = mockSet.mock.calls[0][0].custom_plugins;
        expect(saved[0].name).toBe('new');
        expect(saved.length).toBe(1);
    });

    it('pushes new plugin when id not found', async () => {
        mockGet.mockResolvedValue({ custom_plugins: [{ id: 'x' }] });
        const plugin = { id: 'p8', code: '' };
        await PluginManager.save(plugin);
        expect(mockSet.mock.calls[0][0].custom_plugins.length).toBe(2);
    });

    it('does not modify plugin when code has neither format nor service', async () => {
        const plugin = { id: 'p9', code: '/* no annotations */' };
        await PluginManager.save(plugin);
        expect(plugin).not.toHaveProperty('format');
        expect(plugin).not.toHaveProperty('service');
        expect(mockSet).toHaveBeenCalled();
    });
});

describe('_syncLocalStorage', () => {
    it('writes formats and services to localStorage', () => {
        PluginManager._syncLocalStorage([
            { format: 'fb2', label: 'FB2', enabled: true },
            { service: 'mysvc', serviceLabel: 'MySvc', enabled: true }
        ]);
        expect(JSON.parse(localStorage.getItem('__dl_plugin_formats__'))).toEqual({
            fb2: { label: 'FB2', enabled: true }
        });
        expect(JSON.parse(localStorage.getItem('__dl_plugin_services__'))).toEqual({
            mysvc: { label: 'MySvc', enabled: true }
        });
    });

    it('uses uppercased format/service as label when label absent', () => {
        PluginManager._syncLocalStorage([{ format: 'epub' }, { service: 'svc' }]);
        const f = JSON.parse(localStorage.getItem('__dl_plugin_formats__'));
        expect(f.epub.label).toBe('EPUB');
        const s = JSON.parse(localStorage.getItem('__dl_plugin_services__'));
        expect(s.svc.label).toBe('SVC');
    });

    it('treats enabled:false as disabled', () => {
        PluginManager._syncLocalStorage([{ format: 'fb2', enabled: false }]);
        const f = JSON.parse(localStorage.getItem('__dl_plugin_formats__'));
        expect(f.fb2.enabled).toBe(false);
    });

    it('skips format entry when plugin has no format', () => {
        PluginManager._syncLocalStorage([{ service: 'svc', serviceLabel: 'SVC' }]);
        const f = JSON.parse(localStorage.getItem('__dl_plugin_formats__'));
        expect(Object.keys(f)).toHaveLength(0);
    });

    it('warns and does not throw when localStorage throws', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const orig = globalThis.localStorage;
        globalThis.localStorage = { setItem: () => { throw new Error('quota'); } };
        expect(() => PluginManager._syncLocalStorage([])).not.toThrow();
        expect(warn).toHaveBeenCalled();
        globalThis.localStorage = orig;
        warn.mockRestore();
    });
});

describe('remove()', () => {
    let mockGet, mockSet;
    beforeEach(() => {
        mockGet = vi.fn().mockResolvedValue({ custom_plugins: [{ id: 'a' }, { id: 'b' }] });
        mockSet = vi.fn().mockResolvedValue();
        globalThis.extensionApi = { storage: { local: { get: mockGet, set: mockSet } } };
    });

    it('removes plugin with matching id', async () => {
        await PluginManager.remove('a');
        expect(mockSet.mock.calls[0][0].custom_plugins).toEqual([{ id: 'b' }]);
    });

    it('leaves list unchanged when id not found', async () => {
        await PluginManager.remove('z');
        expect(mockSet.mock.calls[0][0].custom_plugins).toHaveLength(2);
    });

    it('_storageSet returns early when no api.storage.local', async () => {
        globalThis.extensionApi = { runtime: {} };
        await PluginManager.remove('a');
        expect(mockSet).not.toHaveBeenCalled();
    });
});

describe('toggle()', () => {
    let mockGet, mockSet;
    beforeEach(() => {
        mockGet = vi.fn().mockResolvedValue({ custom_plugins: [{ id: 'a', enabled: true }] });
        mockSet = vi.fn().mockResolvedValue();
        globalThis.extensionApi = { storage: { local: { get: mockGet, set: mockSet } } };
    });

    it('sets enabled=false when toggled off', async () => {
        await PluginManager.toggle('a', false);
        expect(mockSet.mock.calls[0][0].custom_plugins[0].enabled).toBe(false);
    });

    it('does nothing when id not found', async () => {
        await PluginManager.toggle('z', false);
        expect(mockSet).not.toHaveBeenCalled();
    });
});

describe('getFormats()', () => {
    it('returns enabled format plugins as {value, label}', async () => {
        globalThis.extensionApi = {
            storage: { local: { get: vi.fn().mockResolvedValue({ custom_plugins: [
                { format: 'fb2', label: 'FB2', enabled: true },
                { format: 'epub', enabled: false },
                { service: 'svc', enabled: true }
            ] }) } }
        };
        const fmts = await PluginManager.getFormats();
        expect(fmts).toEqual([{ value: 'fb2', label: 'FB2' }]);
    });

    it('uses format.toUpperCase() as label when label absent', async () => {
        globalThis.extensionApi = {
            storage: { local: { get: vi.fn().mockResolvedValue({ custom_plugins: [{ format: 'pdf' }] }) } }
        };
        const fmts = await PluginManager.getFormats();
        expect(fmts[0].label).toBe('PDF');
    });
});

describe('_tryScriptingExec()', () => {
    it('returns true when sendMessage responds ok:true', async () => {
        const api = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) } };
        const result = await PluginManager._tryScriptingExec(api, 5, { code: 'x', format: 'fb2' });
        expect(result).toBe(true);
        expect(api.runtime.sendMessage).toHaveBeenCalledWith({ action: 'plugin:exec', tabId: 5, code: 'x' });
    });

    it('returns false and warns when ok:false', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const api = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'nope' }) } };
        const result = await PluginManager._tryScriptingExec(api, 5, { code: 'x', format: 'fb2' });
        expect(result).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('returns false and warns when sendMessage throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const api = { runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('dead')) } };
        const result = await PluginManager._tryScriptingExec(api, 5, { code: 'x', format: 'fb2' });
        expect(result).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('uses plugin.name when format is absent', async () => {
        const api = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) } };
        await PluginManager._tryScriptingExec(api, 1, { code: 'x', name: 'MyPlugin' });
        expect(api.runtime.sendMessage).toHaveBeenCalled();
    });
});

describe('_loadViaSW()', () => {
    let api;
    beforeEach(() => {
        api = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) } };
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { vi.restoreAllMocks(); });

    function makeScriptInjector(triggerOnload) {
        vi.spyOn(document.head, 'appendChild').mockImplementation(el => {
            Promise.resolve().then(() => triggerOnload ? el.onload?.() : el.onerror?.());
        });
    }

    it('returns after _injectScript succeeds', async () => {
        makeScriptInjector(true);
        const log = console.log;
        await PluginManager._loadViaSW(api, { format: 'fb2', code: 'x', label: 'FB2' });
        expect(log).toHaveBeenCalledWith(expect.stringContaining('Loaded (SW)'));
    });

    it('warns when cache sendMessage returns ok:false', async () => {
        makeScriptInjector(true);
        api.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false, error: 'fail' });
        await PluginManager._loadViaSW(api, { format: 'fb2', code: 'x' });
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Background cache failed'), expect.anything());
    });

    it('warns with "unknown error" when cache sendMessage ok:false has no error field', async () => {
        makeScriptInjector(true);
        api.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });
        await PluginManager._loadViaSW(api, { format: 'fb2', code: 'x' });
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Background cache failed'), 'unknown error');
    });

    it('warns when cache sendMessage throws', async () => {
        makeScriptInjector(true);
        api.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('dead'));
        await PluginManager._loadViaSW(api, { format: 'fb2', code: 'x' });
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Cache request failed'), expect.anything());
    });

    it('_injectFromBlob success: covers Loaded (blob) log and return', async () => {
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = () => 'data:text/javascript,';
        makeScriptInjector(false);
        await PluginManager._loadViaSW(api, { format: 'fb2', code: 'const x=1;' });
        URL.createObjectURL = origCreate;
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Loaded (blob)'));
    });

    it('uses plugin.service as key when format is absent', async () => {
        makeScriptInjector(true);
        await PluginManager._loadViaSW(api, { service: 'mysvc', code: 'x', serviceLabel: 'MySvc' });
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('MySvc'));
    });

    it('logs error when _injectScript and _injectFromBlob both fail and no format', async () => {
        makeScriptInjector(false);
        await PluginManager._loadViaSW(api, { service: 'mysvc', code: 'x' });
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('All load methods failed'));
    });

    it('registers sandbox proxy when injectScript/blob fail for a format plugin', async () => {
        makeScriptInjector(false);
        const mockRegister = vi.fn();
        globalThis.BaseExporter = class { };
        globalThis.ExporterRegistry = { register: mockRegister };
        await PluginManager._loadViaSW(api, { format: 'fb2', code: 'x', label: 'FB2' });
        expect(mockRegister).toHaveBeenCalledWith('fb2', expect.any(Function), { label: 'FB2' });
        delete globalThis.BaseExporter;
        delete globalThis.ExporterRegistry;
    });

    it('uses format.toUpperCase() as label for sandbox proxy when label absent', async () => {
        makeScriptInjector(false);
        const mockRegister = vi.fn();
        globalThis.BaseExporter = class { };
        globalThis.ExporterRegistry = { register: mockRegister };
        await PluginManager._loadViaSW(api, { format: 'fb2', code: 'x' });
        expect(mockRegister).toHaveBeenCalledWith('fb2', expect.any(Function), { label: 'FB2' });
        delete globalThis.BaseExporter;
        delete globalThis.ExporterRegistry;
    });
});

function setupBaseService() {
    let capturedClass;
    globalThis.serviceRegistry = { register: cls => { capturedClass = cls; } };
    return () => capturedClass;
}

describe('_loadServiceProxy()', () => {
    afterEach(() => {
        delete globalThis.BaseService;
        delete globalThis.serviceRegistry;
        delete globalThis.ImageCompressor;
        vi.restoreAllMocks();
    });

    it('registers PluginServiceProxy with serviceRegistry', () => {
        const getClass = setupBaseService();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        PluginManager._loadServiceProxy({ service: 'svc', hosts: ['ex.com'] });
        expect(getClass()).toBeDefined();
    });

    it('registers when hosts is absent (plugin.hosts || [])', () => {
        const getClass = setupBaseService();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        PluginManager._loadServiceProxy({ service: 'svc' });
        const Proxy = getClass();
        expect(Proxy.matches('https://ex.com/page')).toBe(false);
    });

    it('PluginServiceProxy.matches: exact host', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: ['ex.com'] });
        const Proxy = getClass();
        expect(Proxy.matches('https://ex.com/page')).toBe(true);
    });

    it('PluginServiceProxy.matches: subdomain', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: ['ex.com'] });
        const Proxy = getClass();
        expect(Proxy.matches('https://sub.ex.com/page')).toBe(true);
    });

    it('PluginServiceProxy.matches: no match', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: ['ex.com'] });
        const Proxy = getClass();
        expect(Proxy.matches('https://other.com/page')).toBe(false);
    });

    it('PluginServiceProxy.matches: invalid URL returns false', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: ['ex.com'] });
        const Proxy = getClass();
        expect(Proxy.matches('not-a-url')).toBe(false);
    });

    it('PluginServiceProxy.extractText maps pages to image blocks', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: ['ex.com'] });
        const Proxy = getClass();
        const inst = new Proxy();
        inst.extractPages = () => [{ url: 'img1.jpg' }, { filename: 'img2.jpg' }, { src: 'img3.jpg' }, 'str'];
        const result = inst.extractText('dummy');
        expect(result).toEqual([
            { type: 'image', src: 'img1.jpg' },
            { type: 'image', src: 'img2.jpg' },
            { type: 'image', src: 'img3.jpg' },
            { type: 'image', src: 'str' }
        ]);
    });

    it('PluginServiceProxy.resolvePageUrl: returns null for null ref', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        expect(inst.resolvePageUrl(null)).toBeNull();
    });

    it('PluginServiceProxy.resolvePageUrl: returns absolute URL as-is', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        expect(inst.resolvePageUrl('https://cdn.ex.com/img.jpg')).toBe('https://cdn.ex.com/img.jpg');
    });

    it('PluginServiceProxy.resolvePageUrl: prepends domain for /path', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: { name: 'svc', imagesDomain: 'https://cdn.ex.com' } });
        const inst = new (getClass())();
        expect(inst.resolvePageUrl('/img.jpg')).toBe('https://cdn.ex.com/img.jpg');
    });

    it('PluginServiceProxy.resolvePageUrl: prepends domain/ for relative path', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: { name: 'svc', imagesDomain: 'https://cdn.ex.com' } });
        const inst = new (getClass())();
        expect(inst.resolvePageUrl('img.jpg')).toBe('https://cdn.ex.com/img.jpg');
    });

    it('PluginServiceProxy.resolvePageUrl: uses ref.src when present', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        expect(inst.resolvePageUrl({ src: 'https://cdn.ex.com/img.jpg' })).toBe('https://cdn.ex.com/img.jpg');
    });

    it('PluginServiceProxy.resolvePageUrl: /path with no imagesDomain gives empty domain prefix', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        expect(inst.resolvePageUrl('/img.jpg')).toBe('/img.jpg');
    });

    it('PluginServiceProxy is a CdnLibsService with the config of the plugin', async () => {
        const getClass = setupBaseService();
        const serviceConfig = { name: 'svc', imagesDomain: 'https://cdn.ex.com', splitLongImages: true, maxImageHeight: 1800 };
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig });
        const { CdnLibsService } = await import('../../services/CdnLibsService.js');
        const inst = new (getClass())();
        expect(inst).toBeInstanceOf(CdnLibsService);
        expect(inst.config).toBe(serviceConfig);
        expect(typeof inst.loadPage).toBe('function');
    });

    it('PluginServiceProxy uses the image server chosen for the plugin', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: {
            name: 'svc',
            imageServers: {
                compression: { domain: 'https://img3.cdnlibs.org', compress: true },
                alt: { domain: 'https://img1.cdnlibs.org', compress: false }
            }
        } });
        const inst = new (getClass())();
        localStorage.setItem('svc_image_server', 'alt');
        expect(inst._activeServer()).toEqual({ domain: 'https://img1.cdnlibs.org', compress: false });
        localStorage.clear();
    });

    it('PluginServiceProxy.resolvePageUrl: uses active server domain when imageServers configured', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: {
            imageServers: { compression: { domain: 'https://img3.cdnlibs.org', compress: true } },
            defaultImageServer: 'compression'
        } });
        const inst = new (getClass())();
        expect(inst.resolvePageUrl('/img.jpg')).toBe('https://img3.cdnlibs.org/img.jpg');
    });

    it('PluginServiceProxy.resolvePageUrl: uses imagesDomain when no imageServers configured', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: {
            imagesDomain: 'https://img.example.com'
        } });
        const inst = new (getClass())();
        expect(inst.resolvePageUrl('/img.jpg')).toBe('https://img.example.com/img.jpg');
    });

    it('PluginServiceProxy.resolvePageUrl: prepends empty string when no server and no imagesDomain', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        expect(inst.resolvePageUrl('/img.jpg')).toBe('/img.jpg');
    });

    it('uses plugin.service as config name when serviceConfig absent', () => {
        const getClass = setupBaseService();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        PluginManager._loadServiceProxy({ service: 'svc', hosts: ['ex.com'] });
        const inst = new (getClass())();
        expect(inst.config.name).toBe('svc');
    });

    it('uses plugin.serviceLabel in log message', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', serviceLabel: 'My Svc', hosts: [] });
        expect(log).toHaveBeenCalledWith(expect.stringContaining('My Svc'));
    });
});

describe('loadAll()', () => {
    let mockGet;
    beforeEach(() => {
        mockGet = vi.fn().mockResolvedValue({});
        globalThis.extensionApi = {
            storage: { local: { get: mockGet } },
            runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) },
            tabs: { getCurrent: vi.fn().mockResolvedValue({ id: 5 }) }
        };
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('logs and returns when no enabled plugins', async () => {
        await PluginManager.loadAll();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No plugins to load'));
    });

    it('filters out disabled and format-less plugins', async () => {
        mockGet.mockResolvedValue({ custom_plugins: [{ enabled: false, format: 'fb2' }, { enabled: true }] });
        await PluginManager.loadAll();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No plugins to load'));
    });

    it('logs error when no api.runtime.sendMessage', async () => {
        mockGet.mockResolvedValue({ custom_plugins: [{ format: 'fb2', enabled: true }] });
        globalThis.extensionApi = { storage: { local: { get: mockGet } } };
        await PluginManager.loadAll();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No runtime.sendMessage'));
    });

    it('calls _loadServiceProxy for service-only plugin and continues', async () => {
        mockGet.mockResolvedValue({ custom_plugins: [{ service: 'svc', enabled: true }] });
        const spy = vi.spyOn(PluginManager, '_loadServiceProxy').mockImplementation(() => {});
        await PluginManager.loadAll();
        expect(spy).toHaveBeenCalledWith(expect.objectContaining({ service: 'svc' }));
    });

    it('warns and sets ownTabId=null when tabs.getCurrent throws', async () => {
        mockGet.mockResolvedValue({ custom_plugins: [{ format: 'fb2', enabled: true }] });
        globalThis.extensionApi.tabs.getCurrent = vi.fn().mockRejectedValue(new Error('no tab'));
        const loadViaSW = vi.spyOn(PluginManager, '_loadViaSW').mockResolvedValue();
        await PluginManager.loadAll();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to get current tab ID'));
        expect(loadViaSW).toHaveBeenCalled();
    });

    it('skips scripting exec when ownTabId is null (tab.id absent)', async () => {
        mockGet.mockResolvedValue({ custom_plugins: [{ format: 'fb2', enabled: true }] });
        globalThis.extensionApi.tabs.getCurrent = vi.fn().mockResolvedValue(null);
        const loadViaSW = vi.spyOn(PluginManager, '_loadViaSW').mockResolvedValue();
        const scriptingExec = vi.spyOn(PluginManager, '_tryScriptingExec');
        await PluginManager.loadAll();
        expect(scriptingExec).not.toHaveBeenCalled();
        expect(loadViaSW).toHaveBeenCalled();
    });

    it('skips _loadViaSW when _tryScriptingExec returns true', async () => {
        mockGet.mockResolvedValue({ custom_plugins: [{ format: 'fb2', enabled: true }] });
        vi.spyOn(PluginManager, '_tryScriptingExec').mockResolvedValue(true);
        const loadViaSW = vi.spyOn(PluginManager, '_loadViaSW').mockResolvedValue();
        await PluginManager.loadAll();
        expect(loadViaSW).not.toHaveBeenCalled();
    });

    it('calls _loadViaSW when _tryScriptingExec returns false', async () => {
        mockGet.mockResolvedValue({ custom_plugins: [{ format: 'fb2', enabled: true }] });
        vi.spyOn(PluginManager, '_tryScriptingExec').mockResolvedValue(false);
        const loadViaSW = vi.spyOn(PluginManager, '_loadViaSW').mockResolvedValue();
        await PluginManager.loadAll();
        expect(loadViaSW).toHaveBeenCalled();
    });
});

describe('FormatSandboxProxy.export() + _createSandbox', () => {
    let CapturedProxy;
    let fakeIframe, fakeContentWindow, getCapturedOnMsg;

    function setupIframeMock(responseFactory) {
        let capturedOnMsg;
        fakeContentWindow = {
            postMessage: vi.fn(msg => {
                setTimeout(() => {
                    if (!capturedOnMsg) return;
                    const resp = responseFactory(msg);
                    if (resp) capturedOnMsg({ source: fakeContentWindow, data: resp });
                }, 0);
            })
        };
        let capturedLoadListener;
        fakeIframe = {
            setAttribute: vi.fn(),
            style: { cssText: '' },
            srcdoc: '',
            contentWindow: fakeContentWindow,
            addEventListener: (evt, cb) => { if (evt === 'load') capturedLoadListener = cb; },
            remove: vi.fn()
        };
        const origCreateEl = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation(tag =>
            tag === 'iframe' ? fakeIframe : origCreateEl(tag)
        );
        vi.spyOn(document.body, 'appendChild').mockImplementation(el => {
            if (el === fakeIframe) setTimeout(() => capturedLoadListener?.(), 0);
        });
        const origWinAddListener = window.addEventListener.bind(window);
        vi.spyOn(window, 'addEventListener').mockImplementation((evt, cb, ...rest) => {
            if (evt === 'message') capturedOnMsg = cb;
            origWinAddListener(evt, cb, ...rest);
        });
        getCapturedOnMsg = () => capturedOnMsg;
    }

    beforeEach(async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        setupIframeMock(msg => {
            if (msg._t === 'sb-exec')
                return { _t: 'sb-ok', _id: msg._id, c: {} };
            if (msg._t === 'sb-export')
                return { _t: 'sb-export-ok', _id: msg._id, buf: new ArrayBuffer(4), filename: 'out.fb2', mimeType: 'application/xml' };
        });

        const mockRegister = vi.fn((_fmt, Cls) => { CapturedProxy = Cls; });
        globalThis.BaseExporter = class {};
        globalThis.ExporterRegistry = { register: mockRegister };
        globalThis.extensionApi = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({ ok: true }),
                getURL: vi.fn(p => `chrome-extension://abc/${p}`)
            }
        };

        vi.spyOn(document.head, 'appendChild').mockImplementation(el => {
            Promise.resolve().then(() => el.onerror?.());
        });

        await PluginManager._loadViaSW(globalThis.extensionApi, { format: 'fb2', code: 'const x=1;', label: 'FB2' });
    });

    afterEach(() => {
        delete globalThis.BaseExporter;
        delete globalThis.ExporterRegistry;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('export() resolves with blob via sandbox', async () => {
        const inst = new CapturedProxy();
        const result = await inst.export({}, [], null);
        expect(result.filename).toBe('out.fb2');
        expect(result.mimeType).toBe('application/xml');
        expect(result.blob).toBeInstanceOf(Blob);
    });

    it('_createSandbox: builds the Firefox iframe.srcdoc from sandbox.js of the extension', async () => {
        globalThis.browserEnv = { isFirefox: true };
        const sandboxCode = 'global.ExporterRegistry = {}; /* </script> */';
        vi.stubGlobal('fetch', vi.fn(async url => (url === 'chrome-extension://abc/sandbox.js'
            ? { ok: true, status: 200, text: async () => sandboxCode }
            : { ok: false, status: 404 })));
        const inst = new CapturedProxy();
        const result = await inst.export({}, [], null);
        expect(result.filename).toBe('out.fb2');
        expect(fetch).toHaveBeenCalledWith('chrome-extension://abc/sandbox.js');
        expect(fakeIframe.srcdoc).toBe(
            '<!DOCTYPE html><html><body><script>global.ExporterRegistry = {}; /* <\\/script> */</script></body></html>');
        vi.unstubAllGlobals();
        delete globalThis.browserEnv;
    });

    it('_createSandbox: fails when sandbox.js cannot be read in Firefox', async () => {
        globalThis.browserEnv = { isFirefox: true };
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
        const inst = new CapturedProxy();
        await expect(inst.export({}, [], null)).rejects.toThrow('Failed to load sandbox.js: HTTP 404');
        vi.unstubAllGlobals();
        delete globalThis.browserEnv;
    });

    it('export() calls sandbox.exec(jsZipCode) when runtimeApi.getURL and fetch succeed', async () => {
        globalThis.extensionApi.runtime.getURL = vi.fn(() => 'chrome-ext://abc/lib/jszip.min.js');
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => 'jszip-code' });
        const execCalls = [];
        fakeContentWindow.postMessage.mockImplementation(msg => {
            execCalls.push(msg);
            setTimeout(() => {
                const onMsg = getCapturedOnMsg();
                if (!onMsg) return;
                if (msg._t === 'sb-exec')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-ok', _id: msg._id, c: {} } });
                if (msg._t === 'sb-export')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-export-ok', _id: msg._id, buf: new ArrayBuffer(4), filename: 'out.fb2', mimeType: 'application/xml' } });
            }, 0);
        });
        const inst = new CapturedProxy();
        await inst.export({}, [], null);
        expect(execCalls.filter(m => m._t === 'sb-exec').length).toBe(2);
        delete globalThis.fetch;
    });

    it('export() skips jszip when runtimeApi has no getURL', async () => {
        const execCalls = [];
        fakeContentWindow.postMessage.mockImplementation(msg => {
            execCalls.push(msg);
            setTimeout(() => {
                const onMsg = getCapturedOnMsg();
                if (!onMsg) return;
                if (msg._t === 'sb-exec')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-ok', _id: msg._id, c: {} } });
                if (msg._t === 'sb-export')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-export-ok', _id: msg._id, buf: new ArrayBuffer(4), filename: 'out.fb2', mimeType: 'application/xml' } });
            }, 0);
        });
        const inst = new CapturedProxy();
        await inst.export({}, [], null);
        expect(execCalls.filter(m => m._t === 'sb-exec').length).toBe(1);
    });

    it('export() covers resp.ok=false branch (jszip not loaded)', async () => {
        globalThis.extensionApi.runtime.getURL = vi.fn(() => 'chrome-ext://abc/lib/jszip.min.js');
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
        const execCalls = [];
        fakeContentWindow.postMessage.mockImplementation(msg => {
            execCalls.push(msg);
            setTimeout(() => {
                const onMsg = getCapturedOnMsg();
                if (!onMsg) return;
                if (msg._t === 'sb-exec')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-ok', _id: msg._id, c: {} } });
                if (msg._t === 'sb-export')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-export-ok', _id: msg._id, buf: new ArrayBuffer(4), filename: 'out.fb2', mimeType: 'application/xml' } });
            }, 0);
        });
        const inst = new CapturedProxy();
        await inst.export({}, [], null);
        expect(execCalls.filter(m => m._t === 'sb-exec').length).toBe(1);
        delete globalThis.fetch;
    });

    it('export() fails clearly without runtime.getURL and fetches nothing', async () => {
        globalThis.browserEnv = { isFirefox: true };
        globalThis.extensionApi = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) } };
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const inst = new CapturedProxy();
        await expect(inst.export({}, [], null)).rejects.toThrow('Cannot resolve sandbox URL');
        expect(fetchSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
        delete globalThis.browserEnv;
    });

    it('export() covers fetch throw branch', async () => {
        globalThis.extensionApi.runtime.getURL = vi.fn(() => 'chrome-ext://abc/lib/jszip.min.js');
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
        const inst = new CapturedProxy();
        await inst.export({}, [], null);
        delete globalThis.fetch;
    });

    it('sandbox exportVia: sb-err response rejects exportVia promise', async () => {
        fakeContentWindow.postMessage.mockImplementation(msg => {
            setTimeout(() => {
                const onMsg = getCapturedOnMsg();
                if (!onMsg) return;
                if (msg._t === 'sb-exec')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-ok', _id: msg._id, c: {} } });
                if (msg._t === 'sb-export')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-err', _id: msg._id, e: 'export failed' } });
            }, 0);
        });
        const inst = new CapturedProxy();
        await expect(inst.export({}, [], null)).rejects.toThrow('export failed');
    });

    it('sandbox exportVia: export timeout rejects after 120s', async () => {
        vi.useFakeTimers();
        let capturedLoadListener3;
        vi.spyOn(document.body, 'appendChild').mockImplementation(el => {
            if (el === fakeIframe) setTimeout(() => capturedLoadListener3?.(), 0);
        });
        fakeIframe.addEventListener = (evt, cb) => { if (evt === 'load') capturedLoadListener3 = cb; };
        fakeContentWindow.postMessage = vi.fn(msg => {
            setTimeout(() => {
                const onMsg = getCapturedOnMsg();
                if (!onMsg) return;
                if (msg._t === 'sb-exec')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-ok', _id: msg._id, c: {} } });
            }, 0);
        });
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        const inst = new CapturedProxy();
        const settled = expect(inst.export({}, [], null)).rejects.toThrow('Sandbox export timeout');
        await vi.advanceTimersByTimeAsync(130000);
        await settled;
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('sandbox exec: sb-err response rejects exec promise', async () => {
        fakeContentWindow.postMessage.mockImplementation(msg => {
            setTimeout(() => {
                const onMsg = getCapturedOnMsg();
                if (onMsg && msg._t === 'sb-exec')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-err', _id: msg._id, e: 'exec error' } });
            }, 0);
        });
        const inst = new CapturedProxy();
        await expect(inst.export({}, [], null)).rejects.toThrow('exec error');
    });

    it('sandbox exec: sb-err with no e field uses Sandbox error', async () => {
        fakeContentWindow.postMessage.mockImplementation(msg => {
            setTimeout(() => {
                const onMsg = getCapturedOnMsg();
                if (onMsg && msg._t === 'sb-exec')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-err', _id: msg._id } });
            }, 0);
        });
        const inst = new CapturedProxy();
        await expect(inst.export({}, [], null)).rejects.toThrow('Sandbox error');
    });

    it('onMsg ignores messages from other sources', async () => {
        let resolveExport;
        const exportPromise = new Promise(r => { resolveExport = r; });
        fakeContentWindow.postMessage.mockImplementation(msg => {
            setTimeout(() => {
                const onMsg = getCapturedOnMsg();
                if (!onMsg) return;
                onMsg({ source: {}, data: { _t: 'sb-ok', _id: msg._id, c: {} } });
                if (msg._t === 'sb-exec')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-ok', _id: msg._id, c: {} } });
                if (msg._t === 'sb-export')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-export-ok', _id: msg._id, buf: new ArrayBuffer(4), filename: 'out.fb2', mimeType: 'application/xml' } });
            }, 0);
        });
        const inst = new CapturedProxy();
        const result = await inst.export({}, [], null);
        expect(result.filename).toBe('out.fb2');
    });

    it('onMsg ignores messages with unknown _id', async () => {
        fakeContentWindow.postMessage.mockImplementation(msg => {
            setTimeout(() => {
                const onMsg = getCapturedOnMsg();
                if (!onMsg) return;
                onMsg({ source: fakeContentWindow, data: { _t: 'sb-ok', _id: 9999, c: {} } });
                if (msg._t === 'sb-exec')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-ok', _id: msg._id, c: {} } });
                if (msg._t === 'sb-export')
                    onMsg({ source: fakeContentWindow, data: { _t: 'sb-export-ok', _id: msg._id, buf: new ArrayBuffer(4), filename: 'out.fb2', mimeType: 'application/xml' } });
            }, 0);
        });
        const inst = new CapturedProxy();
        const result = await inst.export({}, [], null);
        expect(result.filename).toBe('out.fb2');
    });

    it('_createSandbox: sandbox load timeout rejects', async () => {
        vi.useFakeTimers();
        vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});
        const inst = new CapturedProxy();
        const exportPromise = inst.export({}, [], null);
        vi.advanceTimersByTime(6000);
        await expect(exportPromise).rejects.toThrow('Sandbox load timeout');
        vi.useRealTimers();
    });

    it('_createSandbox exec: exec timeout rejects', async () => {
        vi.useFakeTimers();
        fakeContentWindow.postMessage = vi.fn();
        let capturedLoadListener2;
        vi.spyOn(document.body, 'appendChild').mockImplementation(el => {
            if (el === fakeIframe) setTimeout(() => capturedLoadListener2?.(), 0);
        });
        fakeIframe.addEventListener = (evt, cb) => { if (evt === 'load') capturedLoadListener2 = cb; };
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        const inst = new CapturedProxy();
        const settled = expect(inst.export({}, [], null)).rejects.toThrow('Sandbox exec timeout');
        await vi.advanceTimersByTimeAsync(9000);
        await settled;
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('_createSandbox: rejects when sandbox URL cannot be resolved', async () => {
        const origGetURL = globalThis.extensionApi.runtime.getURL;
        globalThis.extensionApi.runtime.getURL = vi.fn(() => undefined);
        const inst = new CapturedProxy();
        await expect(inst.export({}, [], null)).rejects.toThrow('Cannot resolve sandbox URL');
        globalThis.extensionApi.runtime.getURL = origGetURL;
    });

    it('destroy() removes message listener and removes iframe', async () => {
        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
        const inst = new CapturedProxy();
        await inst.export({}, [], null);
        expect(fakeIframe.remove).toHaveBeenCalled();
        expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    });
});

