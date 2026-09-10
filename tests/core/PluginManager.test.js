import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let PluginManager;

async function loadModule() {
    vi.resetModules();
    await import('../../core/PluginManager.js');
    PluginManager = globalThis.PluginManager;
}

beforeEach(async () => {
    delete globalThis.getExtensionApi;
    delete globalThis.browser;
    delete globalThis.chrome;
    delete globalThis.BaseService;
    delete globalThis.BaseExporter;
    delete globalThis.ExporterRegistry;
    delete globalThis.serviceRegistry;
    delete globalThis.ImageCompressor;
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

describe('list() / _getApi / _storageGet', () => {
    it('returns [] when no browser/chrome/getExtensionApi', async () => {
        expect(await PluginManager.list()).toEqual([]);
    });

    it('uses getExtensionApi() when it is a function', async () => {
        const mockGet = vi.fn().mockResolvedValue({ custom_plugins: [{ id: '1' }] });
        globalThis.getExtensionApi = () => ({ storage: { local: { get: mockGet } } });
        const result = await PluginManager.list();
        expect(result).toEqual([{ id: '1' }]);
        delete globalThis.getExtensionApi;
    });

    it('uses browser API', async () => {
        globalThis.browser = { storage: { local: { get: vi.fn().mockResolvedValue({ custom_plugins: [{ id: '2' }] }) } } };
        expect(await PluginManager.list()).toEqual([{ id: '2' }]);
    });

    it('uses chrome API when browser is absent', async () => {
        delete globalThis.browser;
        globalThis.chrome = { storage: { local: { get: vi.fn().mockResolvedValue({ custom_plugins: [{ id: '3' }] }) } } };
        expect(await PluginManager.list()).toEqual([{ id: '3' }]);
        delete globalThis.chrome;
    });

    it('returns [] when storage.local.get result has no custom_plugins key', async () => {
        globalThis.browser = { storage: { local: { get: vi.fn().mockResolvedValue({}) } } };
        expect(await PluginManager.list()).toEqual([]);
    });

    it('returns [] and warns when storage.local.get throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.browser = { storage: { local: { get: vi.fn().mockRejectedValue(new Error('fail')) } } };
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
        globalThis.browser = { storage: { local: { get: mockGet, set: mockSet } } };
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
        globalThis.browser = { storage: { local: { get: mockGet, set: mockSet } } };
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
        globalThis.browser = { runtime: {} };
        await PluginManager.remove('a');
        expect(mockSet).not.toHaveBeenCalled();
    });
});

describe('toggle()', () => {
    let mockGet, mockSet;
    beforeEach(() => {
        mockGet = vi.fn().mockResolvedValue({ custom_plugins: [{ id: 'a', enabled: true }] });
        mockSet = vi.fn().mockResolvedValue();
        globalThis.browser = { storage: { local: { get: mockGet, set: mockSet } } };
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
        globalThis.browser = {
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
        globalThis.browser = {
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

    it('registers sandbox proxy when injectScript/blob fail and format+BaseExporter+ExporterRegistry exist', async () => {
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
    class MockBaseService {
        constructor(config) { this.config = config; this.extensionApi = null; }
        extractPages(content) { return content || []; }
    }
    globalThis.BaseService = MockBaseService;
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

    it('warns and returns when BaseService is absent', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        PluginManager._loadServiceProxy({ service: 'svc' });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('BaseService/serviceRegistry not available'));
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

    it('PluginServiceProxy.loadPageAsBase64: returns null when resolvePageUrl returns null', async () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        inst.resolvePageUrl = () => null;
        expect(await inst.loadPageAsBase64(null)).toBeNull();
    });

    it('PluginServiceProxy.loadPageAsBase64: returns null when no extensionApi', async () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        inst.extensionApi = null;
        expect(await inst.loadPageAsBase64('https://cdn.ex.com/img.jpg')).toBeNull();
    });

    it('PluginServiceProxy.loadPageAsBase64: returns null and warns when response not ok', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        inst.extensionApi = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'err' }) } };
        expect(await inst.loadPageAsBase64('https://cdn.ex.com/img.jpg')).toBeNull();
        expect(warn).toHaveBeenCalled();
    });

    it('PluginServiceProxy.loadPageAsBase64: returns {base64, contentType} when no ImageCompressor', async () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        inst.extensionApi = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'b64', contentType: 'image/jpeg' }) } };
        const result = await inst.loadPageAsBase64('https://cdn.ex.com/img.jpg');
        expect(result).toEqual({ base64: 'b64', contentType: 'image/jpeg' });
    });

    it('PluginServiceProxy._getActiveServer: returns null when no imageServers in config', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        expect(inst._getActiveServer()).toBeNull();
    });

    it('PluginServiceProxy._getActiveServer: uses defaultImageServer when no localStorage key', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: {
            imageServers: { compression: { domain: 'https://img3.cdnlibs.org', compress: true } },
            defaultImageServer: 'compression'
        } });
        const inst = new (getClass())();
        expect(inst._getActiveServer()).toEqual({ domain: 'https://img3.cdnlibs.org', compress: true });
    });

    it('PluginServiceProxy._getActiveServer: falls back to compression when key not found in imageServers', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: {
            imageServers: { compression: { domain: 'https://img3.cdnlibs.org', compress: true } }
        } });
        const inst = new (getClass())();
        localStorage.setItem('svc_image_server', 'nonexistent');
        expect(inst._getActiveServer()).toEqual({ domain: 'https://img3.cdnlibs.org', compress: true });
        localStorage.clear();
    });

    it('PluginServiceProxy._getActiveServer: returns null when imageServers has no matching key and no compression', () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: {
            imageServers: { alt: { domain: 'https://img1.cdnlibs.org', compress: false } }
        } });
        const inst = new (getClass())();
        expect(inst._getActiveServer()).toBeNull();
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

    it('PluginServiceProxy.loadPageAsBase64: returns {base64,contentType} when server.compress === false', async () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: {
            imageServers: { alt: { domain: 'https://img1.cdnlibs.org', compress: false } },
            defaultImageServer: 'alt'
        } });
        const inst = new (getClass())();
        inst.extensionApi = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'raw', contentType: 'image/png' }) } };
        globalThis.ImageCompressor = { compress: vi.fn() };
        const result = await inst.loadPageAsBase64('https://img1.cdnlibs.org/img.jpg');
        expect(result).toEqual({ base64: 'raw', contentType: 'image/png' });
        expect(globalThis.ImageCompressor.compress).not.toHaveBeenCalled();
    });

    it('PluginServiceProxy.fetchChapter: uses scripting.executeScript in service tab when available', async () => {
        class MockBase {
            constructor(config) { this.config = config; this.baseUrl = config?.baseUrl || ''; }
            extractPages() { return []; }
            async fetchChapter() { return null; }
        }
        globalThis.BaseService = MockBase;
        let capturedClass;
        globalThis.serviceRegistry = { register: cls => { capturedClass = cls; } };
        PluginManager._loadServiceProxy({
            service: 'svc', hosts: ['svc.example.com'],
            serviceConfig: { baseUrl: 'https://api.example.com', headers: { 'Site-Id': '4' } }
        });
        const inst = new capturedClass();
        const tabsQuery = vi.fn().mockResolvedValue([{ id: 42 }]);
        const executeScript = vi.fn().mockResolvedValue([{ result: { ok: true, body: '{"data":[]}' } }]);
        inst.extensionApi = {
            runtime: {},
            tabs: { query: tabsQuery },
            scripting: { executeScript }
        };
        const result = await inst.fetchChapter('slug', 1, '1', null, {});
        expect(tabsQuery).toHaveBeenCalledWith({ url: ['*://svc.example.com/*'] });
        expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 42 } }));
        expect(result).toEqual({ data: [] });
        delete globalThis.BaseService;
        delete globalThis.serviceRegistry;
    });

    it('PluginServiceProxy.fetchChapter: injected in-tab fetch func returns body on success, null on HTTP error/throw', async () => {
        class MockBase {
            constructor(config) { this.config = config; this.baseUrl = config?.baseUrl || ''; }
            extractPages() { return []; }
            async fetchChapter() { return null; }
        }
        globalThis.BaseService = MockBase;
        let capturedClass;
        globalThis.serviceRegistry = { register: cls => { capturedClass = cls; } };
        PluginManager._loadServiceProxy({
            service: 'svc', hosts: ['svc.example.com'],
            serviceConfig: { baseUrl: 'https://api.example.com', headers: {} }
        });
        const inst = new capturedClass();
        let capturedFunc;
        const executeScript = vi.fn().mockImplementation(async ({ func }) => {
            capturedFunc = func;
            return [{ result: null }];
        });
        inst.extensionApi = {
            runtime: {},
            tabs: { query: vi.fn().mockResolvedValue([{ id: 42 }]) },
            scripting: { executeScript }
        };
        await inst.fetchChapter('slug', 1, '1', null, {});
        expect(capturedFunc).toBeInstanceOf(Function);

        global.fetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('{"a":1}') });
        await expect(capturedFunc('https://x', {})).resolves.toEqual({ ok: true, body: '{"a":1}' });

        global.fetch = vi.fn().mockResolvedValue({ ok: false });
        await expect(capturedFunc('https://x', {})).resolves.toEqual({ ok: false, body: null });

        global.fetch = vi.fn().mockRejectedValue(new Error('network fail'));
        await expect(capturedFunc('https://x', {})).resolves.toEqual({ ok: false, body: null });

        delete global.fetch;
        delete globalThis.BaseService;
        delete globalThis.serviceRegistry;
    });

    it('PluginServiceProxy.fetchChapter: skips auth injection when Authorization already in headers', async () => {
        class MockBase {
            constructor(config) { this.config = config; this.baseUrl = config?.baseUrl || ''; }
            extractPages() { return []; }
            async fetchChapter() {
                return global.fetch('https://api.example.com/chapter', { headers: this.config.headers });
            }
        }
        globalThis.BaseService = MockBase;
        let capturedClass;
        globalThis.serviceRegistry = { register: cls => { capturedClass = cls; } };
        PluginManager._loadServiceProxy({
            service: 'svc', hosts: [],
            serviceConfig: { headers: { 'Authorization': 'Bearer existing-token' } }
        });
        const inst = new capturedClass();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('{}') });
        const sendMessage = vi.fn();
        inst.extensionApi = { runtime: { sendMessage } };
        await inst.fetchChapter('slug', 1);
        expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'getAuthToken' }));
        delete global.fetch;
        delete globalThis.BaseService;
        delete globalThis.serviceRegistry;
    });

    it('PluginServiceProxy.fetchChapter: calls super without auth when no token in cache', async () => {
        class MockBase {
            constructor(config) { this.config = config; this.baseUrl = config?.baseUrl || ''; }
            extractPages() { return []; }
            async fetchChapter() {
                return global.fetch('x', { headers: this.config.headers });
            }
        }
        globalThis.BaseService = MockBase;
        let capturedClass;
        globalThis.serviceRegistry = { register: cls => { capturedClass = cls; } };
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: { headers: {} } });
        const inst = new capturedClass();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('{}') });
        inst.extensionApi = { runtime: { sendMessage: vi.fn().mockResolvedValue({ token: null }) } };
        await inst.fetchChapter('slug', 1);
        expect(global.fetch.mock.calls[0][1].headers['Authorization']).toBeUndefined();
        delete global.fetch;
        delete globalThis.BaseService;
        delete globalThis.serviceRegistry;
    });

    it('PluginServiceProxy.fetchChapter: calls super without auth when sendMessage throws', async () => {
        class MockBase {
            constructor(config) { this.config = config; this.baseUrl = config?.baseUrl || ''; }
            extractPages() { return []; }
            async fetchChapter() {
                return global.fetch('x', { headers: this.config.headers });
            }
        }
        globalThis.BaseService = MockBase;
        let capturedClass;
        globalThis.serviceRegistry = { register: cls => { capturedClass = cls; } };
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: { headers: {} } });
        const inst = new capturedClass();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('{}') });
        inst.extensionApi = { runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('bg error')) } };
        await inst.fetchChapter('slug', 1);
        expect(global.fetch.mock.calls[0][1].headers['Authorization']).toBeUndefined();
        delete global.fetch;
        delete globalThis.BaseService;
        delete globalThis.serviceRegistry;
    });

    it('PluginServiceProxy.fetchChapter: includes branch_id and extraParams in the in-tab query when provided', async () => {
        class MockBase {
            constructor(config) { this.config = config; this.baseUrl = config?.baseUrl || ''; }
            extractPages() { return []; }
            async fetchChapter() { return null; }
        }
        globalThis.BaseService = MockBase;
        let capturedClass;
        globalThis.serviceRegistry = { register: cls => { capturedClass = cls; } };
        PluginManager._loadServiceProxy({
            service: 'svc', hosts: ['svc.example.com'],
            serviceConfig: { baseUrl: 'https://api.example.com', headers: { 'Site-Id': '4' } }
        });
        const inst = new capturedClass();
        let capturedUrl;
        const executeScript = vi.fn().mockImplementation(async ({ args }) => {
            capturedUrl = args[0];
            return [{ result: { ok: true, body: '{}' } }];
        });
        inst.extensionApi = {
            runtime: {},
            tabs: { query: vi.fn().mockResolvedValue([{ id: 42 }]) },
            scripting: { executeScript }
        };
        await inst.fetchChapter('slug', null, '2', 7, { sort: 'asc' });
        expect(capturedUrl).toContain('branch_id=7');
        expect(capturedUrl).toContain('number=1');
        expect(capturedUrl).toContain('sort=asc');
        delete globalThis.BaseService;
        delete globalThis.serviceRegistry;
    });

    it('PluginServiceProxy.fetchChapter: uses {} headers when serviceConfig.headers is absent', async () => {
        class MockBase {
            constructor(config) { this.config = config; this.baseUrl = config?.baseUrl || ''; }
            extractPages() { return []; }
            async fetchChapter() { return null; }
        }
        globalThis.BaseService = MockBase;
        let capturedClass;
        globalThis.serviceRegistry = { register: cls => { capturedClass = cls; } };
        PluginManager._loadServiceProxy({
            service: 'svc', hosts: ['svc.example.com'],
            serviceConfig: { baseUrl: 'https://api.example.com' }
        });
        const inst = new capturedClass();
        let capturedHeaders;
        const executeScript = vi.fn().mockImplementation(async ({ args }) => {
            capturedHeaders = args[1];
            return [{ result: { ok: true, body: '{}' } }];
        });
        inst.extensionApi = {
            runtime: {},
            tabs: { query: vi.fn().mockResolvedValue([{ id: 42 }]) },
            scripting: { executeScript }
        };
        await inst.fetchChapter('slug', 1, '1', null, {});
        expect(capturedHeaders).toEqual({});
        delete globalThis.BaseService;
        delete globalThis.serviceRegistry;
    });

    it('PluginServiceProxy.fetchChapter: skips in-tab fetch when plugin.hosts is absent', async () => {
        class MockBase {
            constructor(config) { this.config = config; this.baseUrl = config?.baseUrl || ''; }
            extractPages() { return []; }
            async fetchChapter() { return 'super-called'; }
        }
        globalThis.BaseService = MockBase;
        let capturedClass;
        globalThis.serviceRegistry = { register: cls => { capturedClass = cls; } };
        PluginManager._loadServiceProxy({ service: 'svc', serviceConfig: { baseUrl: 'https://api.example.com' } });
        const inst = new capturedClass();
        const tabsQuery = vi.fn();
        const executeScript = vi.fn();
        inst.extensionApi = { runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } };
        const result = await inst.fetchChapter('slug', null, '1', null, {});
        expect(tabsQuery).not.toHaveBeenCalled();
        expect(executeScript).not.toHaveBeenCalled();
        expect(result).toBe('super-called');
        delete globalThis.BaseService;
        delete globalThis.serviceRegistry;
    });

    it('PluginServiceProxy.fetchChapter: calls super without auth when no extensionApi', async () => {
        class MockBase {
            constructor(config) { this.config = config; this.baseUrl = config?.baseUrl || ''; }
            get extensionApi() { return null; }
            extractPages() { return []; }
            async fetchChapter() {
                return global.fetch('x', { headers: this.config.headers });
            }
        }
        globalThis.BaseService = MockBase;
        let capturedClass;
        globalThis.serviceRegistry = { register: cls => { capturedClass = cls; } };
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [], serviceConfig: { headers: {} } });
        const inst = new capturedClass();
        global.fetch = vi.fn().mockResolvedValue({ ok: true, text: vi.fn().mockResolvedValue('{}') });
        await inst.fetchChapter('slug', 1);
        expect(global.fetch.mock.calls[0][1].headers['Authorization']).toBeUndefined();
        delete global.fetch;
        delete globalThis.BaseService;
        delete globalThis.serviceRegistry;
    });

    it('PluginServiceProxy.loadPageAsBase64: uses ImageCompressor when available', async () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        inst.extensionApi = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'b64', contentType: 'image/jpeg' }) } };
        globalThis.ImageCompressor = { compress: vi.fn().mockResolvedValue({ base64: 'compressed', contentType: 'image/jpeg' }) };
        const result = await inst.loadPageAsBase64('https://cdn.ex.com/img.jpg');
        expect(globalThis.ImageCompressor.compress).toHaveBeenCalled();
        expect(result).toEqual({ base64: 'compressed', contentType: 'image/jpeg' });
    });

    it('PluginServiceProxy.processChapterContent: loads pages with concurrency', async () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        inst.extensionApi = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'b64', contentType: 'image/jpeg' }) } };
        const pages = [{ src: 'https://cdn.ex.com/1.jpg' }, { src: 'https://cdn.ex.com/2.jpg' }];
        const result = await inst.processChapterContent(pages, null);
        expect(result).toHaveLength(2);
        expect(result[0].type).toBe('image');
    });

    it('PluginServiceProxy.processChapterContent: inserts error text when page load fails', async () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        inst.extensionApi = { runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('fail')) } };
        const result = await inst.processChapterContent([{ src: 'https://cdn.ex.com/1.jpg' }], null);
        expect(result[0].type).toBe('text');
        expect(result[0].text).toContain('Ошибка');
    });

    it('PluginServiceProxy.processChapterContent: updates status.textContent', async () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        inst.extensionApi = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'b64', contentType: 'image/jpeg' }) } };
        const status = { textContent: '' };
        await inst.processChapterContent([{ src: 'https://cdn.ex.com/1.jpg' }], status);
        expect(status.textContent).toContain('1/1');
    });

    it('PluginServiceProxy.processChapterContent: handles non-array extracted', async () => {
        const getClass = setupBaseService();
        PluginManager._loadServiceProxy({ service: 'svc', hosts: [] });
        const inst = new (getClass())();
        const result = await inst.processChapterContent(null, null);
        expect(result).toEqual([]);
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
        globalThis.browser = {
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
        globalThis.browser = { storage: { local: { get: mockGet } } };
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
        globalThis.browser.tabs.getCurrent = vi.fn().mockRejectedValue(new Error('no tab'));
        const loadViaSW = vi.spyOn(PluginManager, '_loadViaSW').mockResolvedValue();
        await PluginManager.loadAll();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to get current tab ID'));
        expect(loadViaSW).toHaveBeenCalled();
    });

    it('skips scripting exec when ownTabId is null (tab.id absent)', async () => {
        mockGet.mockResolvedValue({ custom_plugins: [{ format: 'fb2', enabled: true }] });
        globalThis.browser.tabs.getCurrent = vi.fn().mockResolvedValue(null);
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
        globalThis.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({ ok: true }),
                getURL: vi.fn(p => `chrome-extension://abc/${p}`)
            }
        };

        vi.spyOn(document.head, 'appendChild').mockImplementation(el => {
            Promise.resolve().then(() => el.onerror?.());
        });

        await PluginManager._loadViaSW(globalThis.browser, { format: 'fb2', code: 'const x=1;', label: 'FB2' });
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

    it('_createSandbox: builds Firefox iframe.srcdoc when getBrowserEnv().isFirefox is true', async () => {
        globalThis.getBrowserEnv = () => ({ isFirefox: true });
        const inst = new CapturedProxy();
        const result = await inst.export({}, [], null);
        expect(result.filename).toBe('out.fb2');
        expect(fakeIframe.srcdoc).toContain('window.addEventListener("message"');
        expect(fakeIframe.srcdoc).toContain('ExporterRegistry');
        delete globalThis.getBrowserEnv;
    });

    it('export() calls sandbox.exec(jsZipCode) when runtimeApi.getURL and fetch succeed', async () => {
        globalThis.browser.runtime.getURL = vi.fn(() => 'chrome-ext://abc/lib/jszip.min.js');
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
        globalThis.browser.runtime.getURL = vi.fn(() => 'chrome-ext://abc/lib/jszip.min.js');
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

    it('export() skips jszip fetch entirely when _getApi() has no runtime.getURL', async () => {
        globalThis.getBrowserEnv = () => ({ isFirefox: true });
        globalThis.browser = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) } };
        const fetchSpy = vi.fn();
        globalThis.fetch = fetchSpy;
        fakeContentWindow.postMessage.mockImplementation(msg => {
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
        const result = await inst.export({}, [], null);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.filename).toBe('out.fb2');
        delete globalThis.fetch;
        delete globalThis.getBrowserEnv;
    });

    it('export() covers fetch throw branch', async () => {
        globalThis.browser.runtime.getURL = vi.fn(() => 'chrome-ext://abc/lib/jszip.min.js');
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
        const inst = new CapturedProxy();
        const exportPromise = inst.export({}, [], null);
        vi.advanceTimersByTime(1);
        await Promise.resolve(); await Promise.resolve();
        vi.advanceTimersByTime(1);
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        vi.advanceTimersByTime(130000);
        await expect(exportPromise).rejects.toThrow('Sandbox export timeout');
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
        const inst = new CapturedProxy();
        const exportPromise = inst.export({}, [], null);
        vi.advanceTimersByTime(1);
        await Promise.resolve(); await Promise.resolve();
        vi.advanceTimersByTime(9000);
        await expect(exportPromise).rejects.toThrow('Sandbox exec timeout');
        vi.useRealTimers();
    });

    it('_createSandbox: rejects when sandbox URL cannot be resolved', async () => {
        const origGetURL = globalThis.browser.runtime.getURL;
        globalThis.browser.runtime.getURL = vi.fn(() => undefined);
        const inst = new CapturedProxy();
        await expect(inst.export({}, [], null)).rejects.toThrow('Cannot resolve sandbox URL');
        globalThis.browser.runtime.getURL = origGetURL;
    });

    it('destroy() removes message listener and removes iframe', async () => {
        const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
        const inst = new CapturedProxy();
        await inst.export({}, [], null);
        expect(fakeIframe.remove).toHaveBeenCalled();
        expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    });
});

