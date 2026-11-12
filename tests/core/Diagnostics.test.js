import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({}));

vi.mock('../../core/BrowserApi.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'extensionApi'));

let collectDiagnostics;
let formatDiagnostics;

/**
 * Подменяет navigator: User-Agent и, если заданы, значения userAgentData с высокой энтропией.
 * @param {?object} [uaData] - Результат getHighEntropyValues; без него userAgentData нет, как в Firefox.
 * @param {string} [userAgent] - Строка User-Agent.
 * @returns {void}
 */
function stubNavigator(uaData = null, userAgent = 'TestAgent/1.0') {
    const userAgentData = uaData && { getHighEntropyValues: vi.fn(async () => uaData) };
    vi.stubGlobal('navigator', { userAgent, ...(userAgentData && { userAgentData }) });
}

/**
 * Значение пункта отладочной информации по его названию.
 * @param {string} label - Название пункта.
 * @returns {Promise<string|undefined>}
 */
async function valueOf(label) {
    const items = await collectDiagnostics();
    return items.find(item => item.label === label)?.value;
}

beforeEach(async () => {
    vi.resetModules();
    mocks.extensionApi = { runtime: { getManifest: vi.fn(() => ({ version: '1.1.0' })) } };
    stubNavigator();
    ({ collectDiagnostics, formatDiagnostics } = await import('../../core/Diagnostics.js'));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('collectDiagnostics()', () => {
    it('returns the extension version, browser, OS and User-Agent in this order', async () => {
        mocks.extensionApi.runtime.getBrowserInfo = vi.fn(async () => ({ name: 'Firefox', version: '146.0' }));
        mocks.extensionApi.runtime.getPlatformInfo = vi.fn(async () => ({ os: 'linux', arch: 'x86-64' }));
        expect(await collectDiagnostics()).toEqual([
            { label: 'Версия расширения', value: '1.1.0' },
            { label: 'Браузер', value: 'Firefox 146.0' },
            { label: 'ОС', value: 'Linux' },
            { label: 'User-Agent', value: 'TestAgent/1.0' }
        ]);
    });

    it('reports unknown values when the browser gives nothing', async () => {
        mocks.extensionApi = null;
        stubNavigator(null, '');
        expect((await collectDiagnostics()).map(item => item.value)).toEqual(Array(4).fill('неизвестно'));
    });

    it('reports an unknown extension version when the manifest has none', async () => {
        mocks.extensionApi.runtime.getManifest = vi.fn(() => ({}));
        expect(await valueOf('Версия расширения')).toBe('неизвестно');
    });
});

describe('collectDiagnostics() browser', () => {
    it('adds the Firefox build id to the version', async () => {
        mocks.extensionApi.runtime.getBrowserInfo = vi.fn(async () => ({
            name: 'Firefox', version: '146.0', buildID: '20251201093022'
        }));
        expect(await valueOf('Браузер')).toBe('Firefox 146.0 (20251201093022)');
    });

    it('names the Chromium browser by its brand and adds the engine version', async () => {
        stubNavigator({
            fullVersionList: [
                { brand: 'Not_A Brand', version: '8.0.0.0' },
                { brand: 'Chromium', version: '142.0.7444.60' },
                { brand: 'Google Chrome', version: '142.0.7444.60' }
            ]
        });
        expect(await valueOf('Браузер')).toBe('Google Chrome 142.0.7444.60 (Chromium 142.0.7444.60)');
    });

    it('lists every specific brand of the browser', async () => {
        stubNavigator({
            fullVersionList: [
                { brand: 'YaBrowser', version: '25.10.1.1' },
                { brand: 'Not)A;Brand', version: '99.0.0.0' },
                { brand: 'Yowser', version: '2.5' }
            ]
        });
        expect(await valueOf('Браузер')).toBe('YaBrowser 25.10.1.1, Yowser 2.5');
    });

    it('names the browser Chromium when there is no other brand', async () => {
        stubNavigator({ fullVersionList: [{ brand: 'Chromium', version: '142.0.1' }] });
        expect(await valueOf('Браузер')).toBe('Chromium 142.0.1');
    });

    it('reports an unknown browser when the brand list is empty', async () => {
        stubNavigator({ fullVersionList: [] });
        expect(await valueOf('Браузер')).toBe('неизвестно');
    });

    it('falls back to userAgentData and logs the reason when getBrowserInfo fails', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        mocks.extensionApi.runtime.getBrowserInfo = vi.fn(async () => { throw new Error('denied'); });
        stubNavigator({ fullVersionList: [{ brand: 'Chromium', version: '142.0.1' }] });
        expect(await valueOf('Браузер')).toBe('Chromium 142.0.1');
        expect(debugSpy).toHaveBeenCalledWith('[Diagnostics] Failed to read browser info:', expect.any(Error));
    });

    it('logs the reason and keeps collecting when userAgentData fails', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        mocks.extensionApi.runtime.getBrowserInfo = vi.fn(async () => ({ name: 'Firefox', version: '146.0' }));
        vi.stubGlobal('navigator', {
            userAgent: 'TestAgent/1.0',
            userAgentData: { getHighEntropyValues: vi.fn(async () => { throw new Error('blocked'); }) }
        });
        expect(await valueOf('Браузер')).toBe('Firefox 146.0');
        expect(debugSpy).toHaveBeenCalledWith('[Diagnostics] Failed to read userAgentData:', expect.any(Error));
    });
});

describe('collectDiagnostics() OS', () => {
    it.each([
        ['win', 'Windows'], ['mac', 'macOS'], ['android', 'Android'], ['cros', 'ChromeOS'], ['haiku', 'haiku']
    ])('names the OS "%s" as "%s"', async (os, expected) => {
        mocks.extensionApi.runtime.getPlatformInfo = vi.fn(async () => ({ os }));
        expect(await valueOf('ОС')).toBe(expected);
    });

    it.each([
        ['15.0.0', 'Windows 11 (15.0.0)'],
        ['10.0.0', 'Windows 10 (10.0.0)'],
        ['0.3.0', 'Windows 7/8/8.1 (0.3.0)'],
        ['unknown', 'Windows (unknown)']
    ])('names Windows by the platform version "%s"', async (platformVersion, expected) => {
        mocks.extensionApi.runtime.getPlatformInfo = vi.fn(async () => ({ os: 'win' }));
        stubNavigator({ platform: 'Windows', platformVersion });
        expect(await valueOf('ОС')).toBe(expected);
    });

    it('adds the platform version to other OSes', async () => {
        mocks.extensionApi.runtime.getPlatformInfo = vi.fn(async () => ({ os: 'mac' }));
        stubNavigator({ platform: 'macOS', platformVersion: '15.1.0' });
        expect(await valueOf('ОС')).toBe('macOS 15.1.0');
    });

    it('takes the OS from userAgentData and logs the reason when getPlatformInfo fails', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        mocks.extensionApi.runtime.getPlatformInfo = vi.fn(async () => { throw new Error('denied'); });
        stubNavigator({ platform: 'Linux', platformVersion: '6.5.0' });
        expect(await valueOf('ОС')).toBe('Linux 6.5.0');
        expect(debugSpy).toHaveBeenCalledWith('[Diagnostics] Failed to read platform info:', expect.any(Error));
    });

    it('reports an unknown OS when neither source names it', async () => {
        stubNavigator({ platformVersion: '6.5.0' });
        expect(await valueOf('ОС')).toBe('неизвестно');
    });
});

describe('formatDiagnostics()', () => {
    it('puts every item on its own line as "label: value"', () => {
        expect(formatDiagnostics([
            { label: 'Версия расширения', value: '1.1.0' },
            { label: 'ОС', value: 'Linux' }
        ])).toBe('Версия расширения: 1.1.0\nОС: Linux');
    });

    it('returns an empty string for no items', () => {
        expect(formatDiagnostics([])).toBe('');
    });
});
