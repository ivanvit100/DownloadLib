import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let SettingsController;

function setupDOM() {
    document.body.innerHTML = `
        <button id="settingsBackBtn"></button>
        <input id="settingsRateLimit" type="number" />
        <button id="saveRateLimitBtn">Сохранить</button>
        <input id="settingsMaxSize" type="number" />
        <button id="saveMaxSizeBtn">Сохранить</button>
        <div id="pluginList"></div>
        <div id="pluginEmpty" style="display:none"></div>
        <div id="logoInfo"></div>
        <input id="pluginFileInput" type="file" />
    `;
}

async function loadModule() {
    vi.resetModules();
    delete globalThis.PluginManager;
    delete globalThis.popupController;
    delete globalThis.globalRateLimiter;
    await import('../../ui/SettingsController.js');
    SettingsController = globalThis.SettingsController;
}

beforeEach(async () => {
    setupDOM();
    await loadModule();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
});

describe('init()', () => {
    it('calls all four sub-methods', () => {
        const spies = ['_renderRateLimit', '_renderMaxSize', '_renderPlugins', '_bindEvents']
            .map(m => vi.spyOn(SettingsController, m).mockImplementation(() => {}));
        SettingsController.init();
        spies.forEach(s => expect(s).toHaveBeenCalledOnce());
    });
});

describe('_renderRateLimit()', () => {
    it('returns early when element absent', () => {
        document.getElementById('settingsRateLimit').remove();
        expect(() => SettingsController._renderRateLimit()).not.toThrow();
    });

    it('uses default 85 when localStorage empty', () => {
        SettingsController._renderRateLimit();
        expect(document.getElementById('settingsRateLimit').value).toBe('85');
    });

    it('uses stored value from localStorage', () => {
        localStorage.setItem('downloadlib_default_rate_limit', '50');
        SettingsController._renderRateLimit();
        expect(document.getElementById('settingsRateLimit').value).toBe('50');
    });
});

describe('_renderMaxSize()', () => {
    it('returns early when element absent', () => {
        document.getElementById('settingsMaxSize').remove();
        expect(() => SettingsController._renderMaxSize()).not.toThrow();
    });

    it('uses default 200 when localStorage empty', () => {
        SettingsController._renderMaxSize();
        expect(document.getElementById('settingsMaxSize').value).toBe('200');
    });

    it('uses stored value from localStorage', () => {
        localStorage.setItem('manga_parser_max_size_mb', '512');
        SettingsController._renderMaxSize();
        expect(document.getElementById('settingsMaxSize').value).toBe('512');
    });
});

describe('_renderPlugins()', () => {
    it('returns early when pluginList absent', async () => {
        document.getElementById('pluginList').remove();
        await expect(SettingsController._renderPlugins()).resolves.toBeUndefined();
    });

    it('shows unavailable message when PluginManager absent (with empty el)', async () => {
        delete globalThis.PluginManager;
        await SettingsController._renderPlugins();
        const empty = document.getElementById('pluginEmpty');
        expect(empty.textContent).toBe('PluginManager недоступен');
        expect(empty.style.display).toBe('block');
    });

    it('no error when PluginManager absent and empty el absent', async () => {
        delete globalThis.PluginManager;
        document.getElementById('pluginEmpty').remove();
        await expect(SettingsController._renderPlugins()).resolves.toBeUndefined();
    });

    it('shows empty block when plugins list is empty (with empty el)', async () => {
        globalThis.PluginManager = { list: vi.fn().mockResolvedValue([]) };
        await SettingsController._renderPlugins();
        expect(document.getElementById('pluginEmpty').style.display).toBe('block');
    });

    it('no error when plugins empty and empty el absent', async () => {
        globalThis.PluginManager = { list: vi.fn().mockResolvedValue([]) };
        document.getElementById('pluginEmpty').remove();
        await expect(SettingsController._renderPlugins()).resolves.toBeUndefined();
    });

    it('hides empty and renders plugin cards', async () => {
        globalThis.PluginManager = {
            list: vi.fn().mockResolvedValue([
                { id: '1', name: 'PlugA', enabled: true },
                { id: '2', name: 'PlugB', enabled: false }
            ])
        };
        await SettingsController._renderPlugins();
        const list = document.getElementById('pluginList');
        expect(document.getElementById('pluginEmpty').style.display).toBe('none');
        expect(list.querySelectorAll('.plugin-card').length).toBe(2);
    });

    it('no error when plugins exist but empty el absent', async () => {
        document.getElementById('pluginEmpty').remove();
        globalThis.PluginManager = {
            list: vi.fn().mockResolvedValue([{ id: '1', name: 'P', enabled: true }])
        };
        await expect(SettingsController._renderPlugins()).resolves.toBeUndefined();
        expect(document.getElementById('pluginList').querySelectorAll('.plugin-card').length).toBe(1);
    });
});

describe('_createPluginCard()', () => {
    it('creates card with name, toggle and remove button', () => {
        const card = SettingsController._createPluginCard({ id: 'x', name: 'MyPlugin', enabled: true });
        expect(card.className).toBe('plugin-card');
        expect(card.querySelector('.plugin-name').textContent).toBe('MyPlugin');
        const toggle = card.querySelector('.plugin-toggle');
        expect(toggle.checked).toBe(true);
        expect(card.querySelector('.plugin-remove-btn')).toBeTruthy();
    });

    it('toggle checked=false when plugin.enabled===false', () => {
        const card = SettingsController._createPluginCard({ id: 'x', name: 'P', enabled: false });
        expect(card.querySelector('.plugin-toggle').checked).toBe(false);
    });

    it('toggle change calls PluginManager.toggle when PluginManager present', async () => {
        globalThis.PluginManager = { toggle: vi.fn().mockResolvedValue() };
        const card = SettingsController._createPluginCard({ id: 'x', name: 'P', enabled: true });
        const toggle = card.querySelector('.plugin-toggle');
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(globalThis.PluginManager.toggle).toHaveBeenCalledWith('x', false);
    });

    it('toggle change is no-op when PluginManager absent', async () => {
        delete globalThis.PluginManager;
        const card = SettingsController._createPluginCard({ id: 'x', name: 'P', enabled: true });
        const toggle = card.querySelector('.plugin-toggle');
        toggle.dispatchEvent(new Event('change'));
        await Promise.resolve();
    });

    it('remove button calls remove and re-renders when PluginManager present', async () => {
        globalThis.PluginManager = {
            remove: vi.fn().mockResolvedValue(),
            list: vi.fn().mockResolvedValue([])
        };
        vi.spyOn(SettingsController, '_renderPlugins').mockResolvedValue();
        const card = SettingsController._createPluginCard({ id: 'x', name: 'P', enabled: true });
        card.querySelector('.plugin-remove-btn').click();
        await Promise.resolve(); await Promise.resolve();
        expect(globalThis.PluginManager.remove).toHaveBeenCalledWith('x');
        expect(SettingsController._renderPlugins).toHaveBeenCalled();
    });

    it('remove button is no-op when PluginManager absent', async () => {
        delete globalThis.PluginManager;
        const card = SettingsController._createPluginCard({ id: 'x', name: 'P', enabled: true });
        card.querySelector('.plugin-remove-btn').click();
        await Promise.resolve();
    });
});

describe('_bindEvents() backBtn', () => {
    it('no error when backBtn absent', () => {
        document.getElementById('settingsBackBtn').remove();
        expect(() => SettingsController._bindEvents()).not.toThrow();
    });

    it('calls window.close() when URL has ?settings param', () => {
        Object.defineProperty(window, 'location', {
            value: { search: '?settings=1' },
            writable: true,
            configurable: true
        });
        const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});
        SettingsController._bindEvents();
        document.getElementById('settingsBackBtn').click();
        expect(closeSpy).toHaveBeenCalled();
    });

    it('calls popupController._restoreMainView() when present', () => {
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true,
            configurable: true
        });
        const restore = vi.fn();
        globalThis.popupController = { _restoreMainView: restore };
        SettingsController._bindEvents();
        document.getElementById('settingsBackBtn').click();
        expect(restore).toHaveBeenCalled();
        expect(document.getElementById('logoInfo').textContent).toBe('');
    });

    it('logs error when popupController absent', () => {
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true,
            configurable: true
        });
        delete globalThis.popupController;
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        SettingsController._bindEvents();
        document.getElementById('settingsBackBtn').click();
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('popupController not found'));
    });

    it('no error when backBtn present but logoInfo absent (popupController present)', () => {
        Object.defineProperty(window, 'location', { value: { search: '' }, writable: true, configurable: true });
        document.getElementById('logoInfo').remove();
        globalThis.popupController = { _restoreMainView: vi.fn() };
        SettingsController._bindEvents();
        expect(() => document.getElementById('settingsBackBtn').click()).not.toThrow();
    });

    it('logoInfo cleared even when logoInfo el absent', () => {
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true,
            configurable: true
        });
        document.getElementById('logoInfo').remove();
        globalThis.popupController = { _restoreMainView: vi.fn() };
        SettingsController._bindEvents();
        expect(() => document.getElementById('settingsBackBtn').click()).not.toThrow();
    });
});

describe('_bindEvents() saveRateLimitBtn', () => {
    it('no error when saveBtn or rateLimitInput absent', () => {
        document.getElementById('saveRateLimitBtn').remove();
        expect(() => SettingsController._bindEvents()).not.toThrow();
    });

    it('clamps val to 2 when NaN', () => {
        SettingsController._bindEvents();
        const input = document.getElementById('settingsRateLimit');
        input.value = 'abc';
        document.getElementById('saveRateLimitBtn').click();
        expect(input.value).toBe('2');
        expect(localStorage.getItem('downloadlib_default_rate_limit')).toBe('2');
    });

    it('clamps val to 2 when below 2', () => {
        SettingsController._bindEvents();
        document.getElementById('settingsRateLimit').value = '1';
        document.getElementById('saveRateLimitBtn').click();
        expect(document.getElementById('settingsRateLimit').value).toBe('2');
    });

    it('clamps val to 200 when above 200', () => {
        SettingsController._bindEvents();
        document.getElementById('settingsRateLimit').value = '999';
        document.getElementById('saveRateLimitBtn').click();
        expect(document.getElementById('settingsRateLimit').value).toBe('200');
    });

    it('saves valid val and calls globalRateLimiter.setLimit when present', () => {
        globalThis.globalRateLimiter = { setLimit: vi.fn() };
        SettingsController._bindEvents();
        document.getElementById('settingsRateLimit').value = '50';
        document.getElementById('saveRateLimitBtn').click();
        expect(localStorage.getItem('downloadlib_default_rate_limit')).toBe('50');
        expect(globalThis.globalRateLimiter.setLimit).toHaveBeenCalledWith(50);
    });

    it('saves valid val without calling setLimit when globalRateLimiter absent', () => {
        delete globalThis.globalRateLimiter;
        SettingsController._bindEvents();
        document.getElementById('settingsRateLimit').value = '75';
        document.getElementById('saveRateLimitBtn').click();
        expect(localStorage.getItem('downloadlib_default_rate_limit')).toBe('75');
    });

    it('saveBtn shows confirmation then restores after timeout', () => {
        vi.useFakeTimers();
        SettingsController._bindEvents();
        const btn = document.getElementById('saveRateLimitBtn');
        const original = btn.textContent;
        document.getElementById('settingsRateLimit').value = '50';
        btn.click();
        expect(btn.textContent).toBe('✓ Сохранено');
        expect(btn.disabled).toBe(true);
        vi.advanceTimersByTime(1500);
        expect(btn.textContent).toBe(original);
        expect(btn.disabled).toBe(false);
    });
});

describe('_bindEvents() saveMaxSizeBtn', () => {
    it('no error when saveMaxSizeBtn absent', () => {
        document.getElementById('saveMaxSizeBtn').remove();
        expect(() => SettingsController._bindEvents()).not.toThrow();
    });

    it('clamps to 1 when NaN', () => {
        SettingsController._bindEvents();
        document.getElementById('settingsMaxSize').value = 'x';
        document.getElementById('saveMaxSizeBtn').click();
        expect(document.getElementById('settingsMaxSize').value).toBe('1');
        expect(localStorage.getItem('manga_parser_max_size_mb')).toBe('1');
    });

    it('clamps to 1 when below 1', () => {
        SettingsController._bindEvents();
        document.getElementById('settingsMaxSize').value = '0';
        document.getElementById('saveMaxSizeBtn').click();
        expect(document.getElementById('settingsMaxSize').value).toBe('1');
    });

    it('saves valid val', () => {
        SettingsController._bindEvents();
        document.getElementById('settingsMaxSize').value = '300';
        document.getElementById('saveMaxSizeBtn').click();
        expect(localStorage.getItem('manga_parser_max_size_mb')).toBe('300');
    });

    it('saveMaxSizeBtn shows confirmation then restores after timeout', () => {
        vi.useFakeTimers();
        SettingsController._bindEvents();
        const btn = document.getElementById('saveMaxSizeBtn');
        const original = btn.textContent;
        document.getElementById('settingsMaxSize').value = '300';
        btn.click();
        expect(btn.textContent).toBe('✓ Сохранено');
        expect(btn.disabled).toBe(true);
        vi.advanceTimersByTime(1500);
        expect(btn.textContent).toBe(original);
        expect(btn.disabled).toBe(false);
    });
});

describe('_bindEvents() fileInput', () => {
    it('no error when fileInput absent', () => {
        document.getElementById('pluginFileInput').remove();
        expect(() => SettingsController._bindEvents()).not.toThrow();
    });

    it('returns early when no file selected', async () => {
        globalThis.PluginManager = { save: vi.fn(), generateId: vi.fn(), list: vi.fn().mockResolvedValue([]) };
        SettingsController._bindEvents();
        const fileInput = document.getElementById('pluginFileInput');
        fileInput.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(globalThis.PluginManager.save).not.toHaveBeenCalled();
    });

    it('returns early when PluginManager absent', async () => {
        delete globalThis.PluginManager;
        SettingsController._bindEvents();
        const fileInput = document.getElementById('pluginFileInput');
        Object.defineProperty(fileInput, 'files', {
            value: [new File(['code'], 'plugin.js', { type: 'text/javascript' })],
            configurable: true
        });
        fileInput.dispatchEvent(new Event('change'));
        await Promise.resolve();
    });

    it('saves plugin from file and re-renders', async () => {
        globalThis.PluginManager = {
            save: vi.fn().mockResolvedValue(),
            generateId: vi.fn().mockReturnValue('gen-id'),
            list: vi.fn().mockResolvedValue([])
        };
        vi.spyOn(SettingsController, '_renderPlugins').mockResolvedValue();
        SettingsController._bindEvents();
        const fileInput = document.getElementById('pluginFileInput');
        const file = { name: 'myplugin.js', text: vi.fn().mockResolvedValue('const x=1;') };
        Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
        fileInput.dispatchEvent(new Event('change'));
        await new Promise(r => setTimeout(r, 0));
        expect(globalThis.PluginManager.save).toHaveBeenCalledWith({
            id: 'gen-id',
            name: 'myplugin',
            code: 'const x=1;',
            enabled: true
        });
        expect(SettingsController._renderPlugins).toHaveBeenCalled();
    });
});
