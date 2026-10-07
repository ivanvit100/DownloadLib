import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../core/PluginManager.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('PluginManager'));
vi.mock('../../core/RateLimiter.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('globalRateLimiter'));

let SettingsController;

function setupDOM() {
    document.body.innerHTML = `
        <button id="settingsBackBtn"></button>
        <input id="settingsRateLimit" type="number" />
        <button id="saveRateLimitBtn">Сохранить</button>
        <input id="settingsMaxSize" type="number" />
        <button id="saveMaxSizeBtn">Сохранить</button>
        <input id="settingsFitFb2Images" type="checkbox" />
        <button id="rangeModeChapters" class="settings-toggle-btn" data-mode="chapters"></button>
        <button id="rangeModeVolumes" class="settings-toggle-btn" data-mode="volumes"></button>
        <div id="pluginList"></div>
        <div id="pluginEmpty" style="display:none"></div>
        <div id="logoInfo"></div>
        <input id="pluginFileInput" type="file" />
    `;
}

async function loadModule() {
    vi.resetModules();
    globalThis.PluginManager = {
        list: vi.fn().mockResolvedValue([]),
        toggle: vi.fn().mockResolvedValue(),
        remove: vi.fn().mockResolvedValue(),
        save: vi.fn().mockResolvedValue(),
        generateId: vi.fn(() => 'plugin_id')
    };
    globalThis.globalRateLimiter = { setLimit: vi.fn() };
    ({ SettingsController } = await import('../../ui/SettingsController.js'));
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
    it('calls all five sub-methods', () => {
        const spies = ['_renderRateLimit', '_renderMaxSize', '_renderRangeMode', '_renderPlugins', '_bindEvents']
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

describe('_renderFitFb2Images()', () => {
    it('returns early when element absent', () => {
        document.getElementById('settingsFitFb2Images').remove();
        expect(() => SettingsController._renderFitFb2Images()).not.toThrow();
    });

    it('unchecks by default when localStorage empty', () => {
        SettingsController._renderFitFb2Images();
        expect(document.getElementById('settingsFitFb2Images').checked).toBe(false);
    });

    it('checks when stored value is "true"', () => {
        localStorage.setItem('manga_parser_fit_fb2_images', 'true');
        SettingsController._renderFitFb2Images();
        expect(document.getElementById('settingsFitFb2Images').checked).toBe(true);
    });
});

describe('_renderRangeMode()', () => {
    it('returns early when toggle buttons absent', () => {
        document.getElementById('rangeModeChapters').remove();
        expect(() => SettingsController._renderRangeMode()).not.toThrow();
    });

    it('defaults to chapters mode when localStorage empty', () => {
        SettingsController._renderRangeMode();
        expect(document.getElementById('rangeModeChapters').classList.contains('active')).toBe(true);
        expect(document.getElementById('rangeModeVolumes').classList.contains('active')).toBe(false);
    });

    it('activates volumes mode when stored', () => {
        localStorage.setItem('manga_parser_range_mode', 'volumes');
        SettingsController._renderRangeMode();
        expect(document.getElementById('rangeModeChapters').classList.contains('active')).toBe(false);
        expect(document.getElementById('rangeModeVolumes').classList.contains('active')).toBe(true);
    });
});

describe('_renderPlugins()', () => {
    it('returns early when pluginList absent', async () => {
        document.getElementById('pluginList').remove();
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

    it('toggle change calls PluginManager.toggle', async () => {
        globalThis.PluginManager = { toggle: vi.fn().mockResolvedValue() };
        const card = SettingsController._createPluginCard({ id: 'x', name: 'P', enabled: true });
        const toggle = card.querySelector('.plugin-toggle');
        toggle.checked = false;
        toggle.dispatchEvent(new Event('change'));
        await Promise.resolve();
        expect(globalThis.PluginManager.toggle).toHaveBeenCalledWith('x', false);
    });

    it('remove button calls remove and re-renders', async () => {
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

    it('clears logoInfo and calls onBack', () => {
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true,
            configurable: true
        });
        const onBack = vi.fn();
        document.getElementById('logoInfo').textContent = 'info';
        SettingsController._bindEvents(onBack);
        document.getElementById('settingsBackBtn').click();
        expect(onBack).toHaveBeenCalled();
        expect(document.getElementById('logoInfo').textContent).toBe('');
    });

    it('init passes onBack to the back button', () => {
        Object.defineProperty(window, 'location', { value: { search: '' }, writable: true, configurable: true });
        const onBack = vi.fn();
        SettingsController.init(onBack);
        document.getElementById('settingsBackBtn').click();
        expect(onBack).toHaveBeenCalled();
    });

    it('logs error when onBack is not provided', () => {
        Object.defineProperty(window, 'location', {
            value: { search: '' },
            writable: true,
            configurable: true
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        SettingsController._bindEvents();
        document.getElementById('settingsBackBtn').click();
        expect(errorSpy).toHaveBeenCalledWith('[SettingsController] onBack callback not provided');
    });

    it('no error when backBtn present but logoInfo absent', () => {
        Object.defineProperty(window, 'location', { value: { search: '' }, writable: true, configurable: true });
        document.getElementById('logoInfo').remove();
        const onBack = vi.fn();
        SettingsController._bindEvents(onBack);
        expect(() => document.getElementById('settingsBackBtn').click()).not.toThrow();
        expect(onBack).toHaveBeenCalled();
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

    it('saves valid val and calls globalRateLimiter.setLimit', () => {
        SettingsController._bindEvents();
        document.getElementById('settingsRateLimit').value = '50';
        document.getElementById('saveRateLimitBtn').click();
        expect(localStorage.getItem('downloadlib_default_rate_limit')).toBe('50');
        expect(globalThis.globalRateLimiter.setLimit).toHaveBeenCalledWith(50);
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

describe('_bindEvents() fitFb2Images checkbox', () => {
    it('no error when checkbox absent', () => {
        document.getElementById('settingsFitFb2Images').remove();
        expect(() => SettingsController._bindEvents()).not.toThrow();
    });

    it('saves checked state to localStorage on change', () => {
        SettingsController._bindEvents();
        const checkbox = document.getElementById('settingsFitFb2Images');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
        expect(localStorage.getItem('manga_parser_fit_fb2_images')).toBe('true');
    });
});

describe('_bindEvents() rangeMode toggle', () => {
    it('no error when toggle buttons absent', () => {
        document.getElementById('rangeModeChapters').remove();
        document.getElementById('rangeModeVolumes').remove();
        expect(() => SettingsController._bindEvents()).not.toThrow();
    });

    it('clicking volumes button stores mode and updates active classes', () => {
        SettingsController._bindEvents();
        document.getElementById('rangeModeVolumes').click();
        expect(localStorage.getItem('manga_parser_range_mode')).toBe('volumes');
        expect(document.getElementById('rangeModeVolumes').classList.contains('active')).toBe(true);
        expect(document.getElementById('rangeModeChapters').classList.contains('active')).toBe(false);
    });

    it('clicking chapters button stores mode and updates active classes', () => {
        localStorage.setItem('manga_parser_range_mode', 'volumes');
        SettingsController._bindEvents();
        document.getElementById('rangeModeChapters').click();
        expect(localStorage.getItem('manga_parser_range_mode')).toBe('chapters');
        expect(document.getElementById('rangeModeChapters').classList.contains('active')).toBe(true);
        expect(document.getElementById('rangeModeVolumes').classList.contains('active')).toBe(false);
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
