import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../core/RateLimitClient.js', async () =>
    (await import('../helpers/globalBridge.js')).globalBridge('RateLimitClient'));

const NO_TAB = { ok: false, status: 0, noTab: true, error: 'No service tab' };
const IMAGE = { ok: true, status: 200, retryAfter: null, base64: 'xyz', contentType: 'image/png' };

let calls;

/**
 * Загружает TabNetwork заново с фейковым API расширения (кэш вкладки — модульное состояние).
 * @param {object} browserApi - Фейковый browser.
 * @returns {Promise<object>} Модуль TabNetwork.
 */
async function load(browserApi) {
    vi.resetModules();
    delete globalThis.chrome;
    globalThis.browser = browserApi;
    return import('../../core/TabNetwork.js');
}

/**
 * Фейковый API с вкладками и scripting.
 * @param {{tabs?: object[]|Function, execute?: Function, storage?: object}} [options] - Поведение.
 * @returns {object} Фейковый browser.
 */
function api({ tabs = [{ id: 3 }], execute = async () => [{ result: IMAGE }], storage } = {}) {
    return {
        runtime: {},
        tabs: { query: vi.fn(typeof tabs === 'function' ? tabs : async () => tabs) },
        scripting: { executeScript: vi.fn(async options => { calls.push(`execute:${options.target.tabId}`); return execute(options); }) },
        ...(storage ? { storage } : {})
    };
}

beforeEach(() => {
    calls = [];
    globalThis.RateLimitClient = { acquire: vi.fn(async key => { calls.push(`acquire:${key}`); }) };
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete globalThis.browser;
    delete globalThis.RateLimitClient;
});

describe('TabNetwork: finding the service tab', () => {
    it('Reports noTab without the scripting API and does not take a rate limit slot', async () => {
        const net = await load({ runtime: {}, tabs: { query: async () => [{ id: 1 }] } });
        await expect(net.fetchViaTab('https://img.example/a.jpg', 'mangalib')).resolves.toEqual(NO_TAB);
        await expect(net.hasServiceTab('mangalib')).resolves.toBe(false);
        expect(globalThis.RateLimitClient.acquire).not.toHaveBeenCalled();
    });

    it('Reports noTab when no service tab is open', async () => {
        const browser = api({ tabs: [] });
        const net = await load(browser);
        await expect(net.fetchViaTab('https://img.example/a.jpg', 'mangalib')).resolves.toEqual(NO_TAB);
        await expect(net.hasServiceTab('mangalib')).resolves.toBe(false);
        expect(browser.scripting.executeScript).not.toHaveBeenCalled();
        expect(globalThis.RateLimitClient.acquire).not.toHaveBeenCalled();
    });

    it('Looks for tabs of the service by the hosts of its config', async () => {
        const browser = api();
        const net = await load(browser);
        await net.fetchViaTab('https://img.example/a.jpg', 'ranobelib');
        expect(browser.tabs.query).toHaveBeenCalledWith({ url: ['*://ranobelib.me/*'] });
        await expect(net.hasServiceTab('ranobelib')).resolves.toBe(true);
    });

    it('Remembers the found tab for an hour', async () => {
        const browser = api({ tabs: [{ id: 9 }] });
        const net = await load(browser);
        const now = vi.spyOn(Date, 'now').mockReturnValue(0);
        await net.fetchViaTab('https://img.example/a.jpg', 'mangalib');
        await net.fetchViaTab('https://img.example/b.jpg', 'mangalib');
        expect(browser.tabs.query).toHaveBeenCalledTimes(1);

        now.mockReturnValue(3600001);
        await net.fetchViaTab('https://img.example/c.jpg', 'mangalib');
        expect(browser.tabs.query).toHaveBeenCalledTimes(2);
    });

    it('setServiceTab makes requests use that tab without tabs.query', async () => {
        const browser = api({ tabs: [] });
        const net = await load(browser);
        net.setServiceTab(42);
        await expect(net.fetchViaTab('https://img.example/a.jpg', 'mangalib')).resolves.toEqual({ ...IMAGE, noTab: false });
        expect(browser.tabs.query).not.toHaveBeenCalled();
        expect(calls).toEqual(['acquire:mangalib', 'execute:42']);
    });

    it('Reports noTab and warns when tabs.query fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const net = await load(api({ tabs: async () => { throw new Error('tabs error'); } }));
        await expect(net.fetchViaTab('https://img.example/a.jpg', 'mangalib')).resolves.toEqual(NO_TAB);
        expect(warn).toHaveBeenCalledWith('[TabNetwork] tabs.query failed:', 'tabs error');
    });

    describe('Service plugins', () => {
        const pluginStorage = get => ({ local: { get } });

        it('Looks for tabs of a plugin service by the hosts saved with the plugin', async () => {
            const get = vi.fn(async () => ({ custom_plugins: [{ service: 'hlib', hosts: ['hentailib.me', 'hentailib.org'] }] }));
            const browser = api({ storage: pluginStorage(get) });
            const net = await load(browser);
            await expect(net.fetchViaTab('https://img3h.hentaicdn.org/a.png', 'hlib')).resolves.toMatchObject({ ok: true });
            expect(get).toHaveBeenCalledWith('custom_plugins');
            expect(browser.tabs.query).toHaveBeenCalledWith({ url: ['*://hentailib.me/*', '*://hentailib.org/*'] });
        });

        it.each([
            ['the plugin is not installed', async () => ({ custom_plugins: [] })],
            ['there are no plugins', async () => ({})],
            ['the plugin is disabled', async () => ({ custom_plugins: [{ service: 'hlib', hosts: ['hentailib.me'], enabled: false }] })],
            ['storage cannot be read', async () => { throw new Error('storage error'); }]
        ])('Reports noTab without querying tabs when %s', async (_case, get) => {
            const browser = api({ storage: pluginStorage(vi.fn(get)) });
            const net = await load(browser);
            await expect(net.fetchViaTab('https://img3h.hentaicdn.org/a.png', 'hlib')).resolves.toEqual(NO_TAB);
            expect(browser.tabs.query).not.toHaveBeenCalled();
        });

        it('Logs why the hosts of a plugin could not be read', async () => {
            const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
            const error = new Error('storage error');
            const net = await load(api({ storage: pluginStorage(vi.fn(async () => { throw error; })) }));
            await net.fetchViaTab('https://img3h.hentaicdn.org/a.png', 'hlib');
            expect(debug).toHaveBeenCalledWith('[TabNetwork] Failed to read the hosts of plugin hlib:', error);
            debug.mockRestore();
        });

        it('Reports noTab for a plugin service without the storage API', async () => {
            const net = await load(api());
            await expect(net.fetchViaTab('https://img3h.hentaicdn.org/a.png', 'hlib')).resolves.toEqual(NO_TAB);
        });
    });
});

describe('TabNetwork: rate limit and cancellation', () => {
    it('Takes a slot of the shared rate limiter before every request', async () => {
        const net = await load(api({ execute: async () => [{ result: { ok: true, status: 200, text: '{}', retryAfter: null } }] }));
        await net.requestViaTab('https://api.example/a', {}, 'mangalib');
        await net.fetchViaTab('https://img.example/a.jpg', 'mangalib');
        expect(calls).toEqual(['acquire:mangalib', 'execute:3', 'acquire:mangalib', 'execute:3']);
    });

    it('Calls beforeSend after the slot is granted and before the request', async () => {
        const net = await load(api());
        await net.fetchViaTab('https://img.example/a.jpg', 'mangalib', { beforeSend: async () => { calls.push('beforeSend'); } });
        expect(calls).toEqual(['acquire:mangalib', 'beforeSend', 'execute:3']);
    });

    it('Does not send the request when beforeSend throws', async () => {
        const browser = api();
        const net = await load(browser);
        const aborted = new Error('Download aborted');
        await expect(net.requestViaTab('https://api.example/a', {}, 'mangalib', { beforeSend: async () => { throw aborted; } }))
            .rejects.toBe(aborted);
        expect(browser.scripting.executeScript).not.toHaveBeenCalled();
    });
});

describe('TabNetwork: results', () => {
    it('fetchViaTab runs tabFetch in base64 mode and returns its result', async () => {
        const browser = api();
        const net = await load(browser);
        await expect(net.fetchViaTab('https://img.example/a.jpg', 'mangalib', { init: { cache: 'no-store' } }))
            .resolves.toEqual({ ...IMAGE, noTab: false });
        expect(browser.scripting.executeScript).toHaveBeenCalledWith({
            target: { tabId: 3 }, func: net.tabFetch, args: ['https://img.example/a.jpg', { cache: 'no-store' }, 'base64']
        });
    });

    it('requestViaTab runs tabFetch in text mode and returns its result', async () => {
        const result = { ok: false, status: 429, text: 'slow down', retryAfter: '7' };
        const browser = api({ execute: async () => [{ result }] });
        const net = await load(browser);
        await expect(net.requestViaTab('https://api.example/a', { method: 'GET' }, 'mangalib'))
            .resolves.toEqual({ ...result, noTab: false });
        expect(browser.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
            args: ['https://api.example/a', { method: 'GET' }, 'text']
        }));
    });

    it('requestViaTab defaults the fetch options and always has text and retryAfter', async () => {
        const browser = api({ tabs: [] });
        const net = await load(browser);
        await expect(net.requestViaTab('https://api.example/a', undefined, 'mangalib'))
            .resolves.toEqual({ ...NO_TAB, text: '', retryAfter: null });

        net.setServiceTab(4);
        await net.requestViaTab('https://api.example/a', undefined, 'mangalib');
        expect(browser.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ args: ['https://api.example/a', {}, 'text'] }));
    });

    it('Returns an error result instead of null when the tab returns nothing', async () => {
        const net = await load(api({ execute: async () => [{ result: null }] }));
        await expect(net.fetchViaTab('https://img.example/a.jpg', 'mangalib'))
            .resolves.toEqual({ ok: false, status: 0, noTab: false, error: 'No result from tab' });
    });

    it('Forgets a closed tab and repeats the request through another service tab', async () => {
        const browser = api({
            tabs: [{ id: 7 }],
            execute: async ({ target }) => {
                if (target.tabId === 42) throw new Error('No tab with id: 42');
                return [{ result: IMAGE }];
            }
        });
        const net = await load(browser);
        net.setServiceTab(42);
        await expect(net.fetchViaTab('https://img.example/a.jpg', 'mangalib')).resolves.toEqual({ ...IMAGE, noTab: false });
        expect(calls).toEqual(['acquire:mangalib', 'execute:42', 'execute:7']);

        await net.fetchViaTab('https://img.example/b.jpg', 'mangalib');
        expect(calls.at(-1)).toBe('execute:7');
    });

    it('Reports noTab when the closed tab was the last service tab', async () => {
        const net = await load(api({ tabs: [], execute: async () => { throw new Error('No tab with id: 42'); } }));
        net.setServiceTab(42);
        await expect(net.fetchViaTab('https://img.example/a.jpg', 'mangalib')).resolves.toEqual(NO_TAB);
    });

    it.each([
        ['the same tab is found again', [{ id: 7 }]],
        ['another tab fails too', [{ id: 8 }]]
    ])('Returns an error result and warns when %s', async (_case, tabs) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const net = await load(api({ tabs, execute: async () => { throw new Error('script boom'); } }));
        net.setServiceTab(7);
        await expect(net.requestViaTab('https://api.example/a', {}, 'mangalib'))
            .resolves.toEqual({ ok: false, status: 0, noTab: false, error: 'script boom', text: '', retryAfter: null });
        expect(warn).toHaveBeenCalledWith('[TabNetwork] executeScript failed:', 'script boom');
    });
});

describe('tabFetch (runs inside the service tab)', () => {
    let tabFetch;

    beforeEach(async () => {
        ({ tabFetch } = await load(api()));
    });

    const response = ({ ok = true, status = 200, retryAfter = null, text = '', blob = { type: 'image/png' } } = {}) => ({
        ok, status, headers: { get: name => (name === 'Retry-After' ? retryAfter : null) },
        text: async () => text, blob: async () => blob
    });

    /**
     * Подменяет FileReader: readAsDataURL вызывает указанный обработчик.
     * @param {'onload'|'onerror'|'onabort'} event - Событие.
     * @param {object} [fields] - Поля читателя (result, error).
     * @returns {void}
     */
    function stubReader(event, fields = {}) {
        vi.stubGlobal('FileReader', vi.fn(function FakeReader() {
            this.readAsDataURL = () => {
                Object.assign(this, fields);
                this[event]();
            };
        }));
    }

    it('Returns the text body with the status and Retry-After in text mode', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response({ ok: false, status: 429, retryAfter: '7', text: 'slow' })));
        await expect(tabFetch('https://api.example/a', { method: 'GET' }, 'text'))
            .resolves.toEqual({ ok: false, status: 429, retryAfter: '7', text: 'slow' });
        expect(fetch).toHaveBeenCalledWith('https://api.example/a', { method: 'GET' });
    });

    it('Returns the body in base64 with its content type in base64 mode', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response()));
        stubReader('onload', { result: 'data:image/png;base64,abc123' });
        await expect(tabFetch('https://img.example/a.png', {}, 'base64'))
            .resolves.toEqual({ ok: true, status: 200, retryAfter: null, base64: 'abc123', contentType: 'image/png' });
    });

    it('Falls back to image/jpeg when the blob has no type', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response({ blob: { type: '' } })));
        stubReader('onload', { result: 'data:;base64,def' });
        await expect(tabFetch('https://img.example/a', {}, 'base64')).resolves.toMatchObject({ contentType: 'image/jpeg', base64: 'def' });
    });

    it('Returns the HTTP status without reading the body of a failed image response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response({ ok: false, status: 404 })));
        await expect(tabFetch('https://img.example/a.png', {}, 'base64'))
            .resolves.toEqual({ ok: false, status: 404, retryAfter: null, error: 'HTTP 404' });
    });

    it('Returns an error when FileReader fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response()));
        stubReader('onerror', { error: new Error('read failed') });
        await expect(tabFetch('https://img.example/a.png', {}, 'base64'))
            .resolves.toEqual({ ok: false, status: 200, retryAfter: null, error: 'FileReader: read failed' });
    });

    it('Returns an error when FileReader is aborted', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => response()));
        stubReader('onabort');
        await expect(tabFetch('https://img.example/a.png', {}, 'base64'))
            .resolves.toMatchObject({ ok: false, error: 'FileReader: aborted' });
    });

    it('Returns status 0 with the error when fetch throws', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
        await expect(tabFetch('https://api.example/a', {}, 'text'))
            .resolves.toEqual({ ok: false, status: 0, error: 'TypeError: Failed to fetch' });
    });

    it('Is self-contained, so it can be injected into a tab', async ctx => {
        if (String(tabFetch).includes('cov_')) ctx.skip();
        const injected = new Function(`return (${String(tabFetch)})`)(); // eslint-disable-line no-new-func
        vi.stubGlobal('fetch', vi.fn(async () => response({ text: 'ok' })));
        await expect(injected('https://api.example/a', {}, 'text')).resolves.toMatchObject({ ok: true, text: 'ok' });
    });
});
