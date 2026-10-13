import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../core/BrowserApi.js', async () =>
    (await import('../helpers/globalBridge.js')).globalBridge('extensionApi'));
vi.mock('../../core/TabNetwork.js', async () =>
    (await import('../helpers/globalBridge.js')).globalBridge('requestViaTab', 'fetchViaTab', 'NoServiceTabError'));
vi.mock('../../core/RateLimitClient.js', async () =>
    (await import('../helpers/globalBridge.js')).globalBridge('RateLimitClient'));
vi.mock('../../core/AuthManager.js', async () =>
    (await import('../helpers/globalBridge.js')).globalBridge('AuthManager'));

let BaseService, parseRetryAfter;

const config = { name: 'TestService', baseUrl: 'https://test.com', siteUrl: 'https://test.site', headers: { 'Site-Id': '1' } };

/**
 * Ответ requestViaTab.
 * @param {number} status - HTTP-статус.
 * @param {object} [extra] - Прочие поля.
 * @returns {object}
 */
const reply = (status, extra = {}) => ({ ok: status >= 200 && status < 300, status, text: '', retryAfter: null, noTab: false, ...extra });

beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    globalThis.RateLimitClient = { throttle: vi.fn() };
    globalThis.AuthManager = { invalidate: vi.fn(async () => {}) };
    globalThis.NoServiceTabError = class NoServiceTabError extends Error {};
    globalThis.requestViaTab = vi.fn(async () => reply(200, { text: '{"data":{}}' }));
    globalThis.fetchViaTab = vi.fn();
    ({ BaseService, parseRetryAfter } = await import('../../services/BaseService.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
    ['RateLimitClient', 'AuthManager', 'NoServiceTabError', 'requestViaTab', 'fetchViaTab', 'extensionApi']
        .forEach(name => delete globalThis[name]);
});

/**
 * Сервис без реальных пауз.
 * @param {object} [cfg] - Конфиг.
 * @returns {object} Сервис и шпион delay.
 */
function service(cfg = config) {
    const svc = new BaseService(cfg);
    const delay = vi.spyOn(svc, 'delay').mockResolvedValue();
    return { svc, delay };
}

describe('BaseService', () => {
    it('Constructs with config and logs', () => {
        const svc = new BaseService(config);
        expect(svc.config).toEqual(config);
        expect(svc.name).toBe('TestService');
        expect(svc.baseUrl).toBe('https://test.com');
        expect(svc.ctx).toBeNull();
        expect(console.log).toHaveBeenCalledWith('[BaseService] Created service: TestService');
    });

    it('Copies the config and its headers, so instances do not share auth tokens', () => {
        const shared = { name: 'svc', baseUrl: 'https://api.test', headers: { 'Site-Id': '1' }, imageServers: { a: {} } };
        const first = new BaseService(shared);
        const second = new BaseService(shared);
        first.setAuthToken('token-1');

        expect(first.config.headers).toEqual({ 'Site-Id': '1', Authorization: 'Bearer token-1' });
        expect(second.config.headers).toEqual({ 'Site-Id': '1' });
        expect(shared.headers).toEqual({ 'Site-Id': '1' });
        expect(first.config).not.toBe(shared);
        expect(first.config.imageServers).toBe(shared.imageServers);
    });

    it('Copies a config without headers as is', () => {
        expect(new BaseService({ name: 'svc' }).config).toEqual({ name: 'svc' });
    });

    it('setAuthToken(null) removes the Authorization header', () => {
        const svc = new BaseService(config);
        svc.setAuthToken('t');
        svc.setAuthToken(null);
        expect(svc.config.headers).toEqual({ 'Site-Id': '1' });
    });

    it('attach binds the service to a download and returns it', () => {
        const svc = new BaseService(config);
        const ctx = { checkpoint: vi.fn() };
        expect(svc.attach(ctx)).toBe(svc);
        expect(svc.ctx).toBe(ctx);
        svc.attach(null);
        expect(svc.ctx).toBeNull();
    });

    it('Extract pages correct array for known keys', () => {
        const svc = new BaseService(config);
        expect(svc.extractPages({ pages: [1, 2, 3] })).toEqual([1, 2, 3]);
        expect(svc.extractPages({ images: ['a'] })).toEqual(['a']);
        expect(svc.extractPages({ pages_list: [5] })).toEqual([5]);
        expect(svc.extractPages({ content: ['x', 'y'] })).toEqual(['x', 'y']);
    });

    it('Extract pages returns empty array if no known keys', () => {
        const svc = new BaseService(config);
        expect(svc.extractPages(null)).toEqual([]);
        expect(svc.extractPages({})).toEqual([]);
        expect(svc.extractPages({ foo: [1, 2] })).toEqual([]);
        expect(svc.extractPages({ pages: [] })).toEqual([]);
    });

    it('Static matches returns false without a static config', () => {
        expect(BaseService.matches('https://mangalib.me/')).toBe(false);
    });

    it('Static matches uses the hosts of the subclass static config', () => {
        class SiteService extends BaseService {
            static config = { name: 'site', hosts: ['site.example'] };
        }
        expect(SiteService.matches('https://site.example/manga/x')).toBe(true);
        expect(SiteService.matches('https://cdn.site.example/a.jpg')).toBe(true);
        expect(SiteService.matches('https://othersite.example/')).toBe(false);
        expect(SiteService.matches('not a url')).toBe(false);
    });

    it('extensionApi returns the shared BrowserApi instance', () => {
        const fakeApi = { runtime: {} };
        globalThis.extensionApi = fakeApi;
        expect(new BaseService(config).extensionApi).toBe(fakeApi);
    });

    it('Delay resolves after given ms', async () => {
        const svc = new BaseService(config);
        const spy = vi.spyOn(global, 'setTimeout');
        await svc.delay(10);
        expect(spy).toHaveBeenCalledWith(expect.any(Function), 10);
    });

    it('blobToBase64 returns a data-URL', async () => {
        const svc = new BaseService(config);
        await expect(svc.blobToBase64(new Blob(['abc'], { type: 'text/plain' }))).resolves.toBe('data:text/plain;base64,YWJj');
    });

    it('checkpoint does nothing without a download and delegates to its context', async () => {
        const svc = new BaseService(config);
        await expect(svc.checkpoint()).resolves.toBeUndefined();
        svc.attach({ checkpoint: vi.fn().mockResolvedValue() });
        await svc.checkpoint();
        expect(svc.ctx.checkpoint).toHaveBeenCalledTimes(1);
    });

    it('loadImageOrDefer runs the load without a download and delegates to its context', async () => {
        const svc = new BaseService(config);
        await expect(svc.loadImageOrDefer(1, async () => ['block'])).resolves.toEqual(['block']);
        const ctx = { loadImageOrDefer: vi.fn(async () => ['deferred']) };
        svc.attach(ctx);
        const load = vi.fn();
        await expect(svc.loadImageOrDefer(2, load)).resolves.toEqual(['deferred']);
        expect(ctx.loadImageOrDefer).toHaveBeenCalledWith(2, load);
    });

    it('_reportPages reports to the download and to a legacy status element', () => {
        const svc = new BaseService(config);
        const status = { textContent: '' };
        svc._reportPages(1, 3, status);
        expect(status.textContent).toBe('Загружено страниц: 1/3');
        svc.attach({ onPageProgress: vi.fn() });
        svc._reportPages(2, 3, null);
        expect(svc.ctx.onPageProgress).toHaveBeenCalledWith(2, 3);
    });

    it('interruptibleDelay delegates to delay without gate', async () => {
        const { svc, delay } = service();
        await svc.interruptibleDelay(500);
        expect(delay).toHaveBeenCalledWith(500);
    });

    it('interruptibleDelay sleeps in slices and checks the download afterwards', async () => {
        const svc = new BaseService(config);
        svc.attach({ controller: { shouldStop: () => false }, checkpoint: vi.fn().mockResolvedValue() });
        const delaySpy = vi.spyOn(svc, 'delay').mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5)));
        await svc.interruptibleDelay(30);
        expect(delaySpy).toHaveBeenCalled();
        expect(delaySpy.mock.calls.every(([ms]) => ms <= 250)).toBe(true);
        expect(svc.ctx.checkpoint).toHaveBeenCalledTimes(1);
    });

    it('interruptibleDelay stops sleeping as soon as download is stopped', async () => {
        const { svc, delay } = service();
        const error = Object.assign(new Error('Download aborted'), { aborted: true });
        svc.attach({ controller: { shouldStop: () => true }, checkpoint: vi.fn().mockRejectedValue(error) });
        await expect(svc.interruptibleDelay(30000)).rejects.toBe(error);
        expect(delay).not.toHaveBeenCalled();
    });
});

describe('parseRetryAfter', () => {
    const now = Date.parse('2026-10-09T12:00:00Z');

    it('Reads seconds', () => {
        expect(parseRetryAfter('120', now)).toBe(120000);
        expect(parseRetryAfter(' 5 ', now)).toBe(5000);
    });

    it('Reads an HTTP date', () => {
        expect(parseRetryAfter('Fri, 09 Oct 2026 12:00:30 GMT', now)).toBe(30000);
    });

    it('Returns null for missing, invalid, zero and past values', () => {
        [null, undefined, '', 'soon', '0', '-5', 'Fri, 09 Oct 2026 11:59:00 GMT']
            .forEach(value => expect(parseRetryAfter(value, now), String(value)).toBeNull());
    });
});

describe('BaseService._request', () => {
    it('Sends the API request through the service tab with the config headers', async () => {
        const { svc } = service();
        globalThis.requestViaTab.mockResolvedValue(reply(200, { text: '{"data":{"id":1}}' }));
        await expect(svc._request('https://test.com/api/x', { what: 'тест' })).resolves.toEqual({ data: { id: 1 } });
        expect(globalThis.requestViaTab).toHaveBeenCalledWith(
            'https://test.com/api/x',
            { method: 'GET', headers: { 'Site-Id': '1' }, mode: 'cors', credentials: 'include', cache: 'no-store' },
            'TestService',
            { beforeSend: expect.any(Function) }
        );
    });

    it('Checks the download checkpoint before the request and once the rate limiter grants it', async () => {
        const { svc } = service();
        svc.attach({ checkpoint: vi.fn(async () => {}) });
        globalThis.requestViaTab.mockImplementation(async (url, init, key, { beforeSend }) => {
            await beforeSend();
            return reply(200, { text: '{}' });
        });
        await svc._request('u');
        expect(svc.ctx.checkpoint).toHaveBeenCalledTimes(2);
    });

    it('Returns text or a Response-like object when asked', async () => {
        const { svc } = service();
        globalThis.requestViaTab.mockResolvedValue(reply(404, { text: 'nope', retryAfter: '3' }));
        const response = await svc._request('u', { as: 'response' });
        expect(response).toMatchObject({ ok: false, status: 404 });
        expect(response.text()).toBe('nope');
        expect(response.headers.get('Retry-After')).toBe('3');
        expect(response.headers.get('Content-Type')).toBeNull();

        globalThis.requestViaTab.mockResolvedValue(reply(200, { text: 'plain' }));
        await expect(svc._request('u', { as: 'text' })).resolves.toBe('plain');
    });

    it('Throws NoServiceTabError without a service tab and does not retry', async () => {
        const { svc } = service();
        globalThis.requestViaTab.mockResolvedValue(reply(0, { ok: false, noTab: true }));
        const error = await svc._request('u').catch(e => e);
        expect(error).toBeInstanceOf(globalThis.NoServiceTabError);
        expect(error.message).toBe('Откройте страницу тайтла на https://test.site, чтобы продолжить загрузку');
        expect(globalThis.requestViaTab).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a network error', reply(0, { ok: false, error: 'TypeError: Failed to fetch' })],
        ['a server error', reply(502)]
    ])('Retries %s with a growing pause', async (_case, failure) => {
        const { svc, delay } = service();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.requestViaTab
            .mockResolvedValueOnce(failure)
            .mockResolvedValueOnce(failure)
            .mockResolvedValueOnce(reply(200, { text: '{"ok":1}' }));
        await expect(svc._request('u')).resolves.toEqual({ ok: 1 });
        expect(delay.mock.calls).toEqual([[1000], [2000]]);
    });

    it('Gives up after the last attempt with a clear error', async () => {
        const { svc } = service();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.requestViaTab.mockResolvedValue(reply(0, { ok: false, error: 'TypeError: Failed to fetch' }));
        await expect(svc._request('u', { what: 'список глав' }))
            .rejects.toThrow('Сетевая ошибка при запросе к API (список глав): TypeError: Failed to fetch');
        expect(globalThis.requestViaTab).toHaveBeenCalledTimes(3);

        globalThis.requestViaTab.mockResolvedValue(reply(503));
        await expect(svc._request('u', { what: 'глава', attempts: 2 })).rejects.toThrow('Ошибка API (глава): HTTP 503');
    });

    it('Does not retry client errors', async () => {
        const { svc } = service();
        globalThis.requestViaTab.mockResolvedValue(reply(404));
        await expect(svc._request('u', { what: 'глава' })).rejects.toThrow('Ошибка API (глава): HTTP 404');
        expect(globalThis.requestViaTab).toHaveBeenCalledTimes(1);
    });

    it('On 429 waits Retry-After, holds back all windows, notifies the download and retries', async () => {
        const { svc } = service();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const pause = vi.spyOn(svc, 'interruptibleDelay').mockResolvedValue();
        svc.attach({ on429: vi.fn(), checkpoint: async () => {} });
        globalThis.requestViaTab
            .mockResolvedValueOnce(reply(429, { retryAfter: '2' }))
            .mockResolvedValueOnce(reply(200, { text: '{}' }));
        await expect(svc._request('u')).resolves.toEqual({});
        expect(warn).toHaveBeenCalledWith('[TestService] 429 Too Many Requests (attempt 1/5), waiting 2000ms...');
        expect(svc.ctx.on429).toHaveBeenCalledWith(2000);
        expect(globalThis.RateLimitClient.throttle).toHaveBeenCalledWith(2000);
        expect(pause).toHaveBeenCalledWith(2000);
    });

    it('On 429 understands Retry-After as an HTTP date', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
        try {
            const { svc, delay } = service();
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            globalThis.requestViaTab
                .mockResolvedValueOnce(reply(429, { retryAfter: 'Fri, 09 Oct 2026 12:00:45 GMT' }))
                .mockResolvedValueOnce(reply(200, { text: '{}' }));
            await svc._request('u');
            expect(delay).toHaveBeenCalledWith(45000);
        } finally {
            vi.useRealTimers();
        }
    });

    it('On 429 without a usable Retry-After waits 30 seconds', async () => {
        const { svc, delay } = service();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.requestViaTab
            .mockResolvedValueOnce(reply(429, { retryAfter: 'later' }))
            .mockResolvedValueOnce(reply(200, { text: '{}' }));
        await svc._request('u');
        expect(delay).toHaveBeenCalledWith(30000);
    });

    it('Stops after the last 429 attempt without waiting again', async () => {
        const { svc, delay } = service();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.requestViaTab.mockResolvedValue(reply(429, { retryAfter: '1' }));
        await expect(svc._request('u', { rateLimitAttempts: 3 })).rejects.toThrow('Rate limited after 3 retries (429)');
        expect(globalThis.requestViaTab).toHaveBeenCalledTimes(3);
        expect(delay).toHaveBeenCalledTimes(2);
    });

    it('On 401 drops the token of the instance and of the background and explains what to do', async () => {
        const { svc } = service();
        svc.setAuthToken('stale');
        globalThis.requestViaTab.mockResolvedValue(reply(401));
        await expect(svc._request('u', { what: 'метаданные тайтла' }))
            .rejects.toThrow('Сервер отклонил авторизацию (метаданные тайтла): войдите на https://test.site и повторите');
        expect(globalThis.AuthManager.invalidate).toHaveBeenCalledWith('TestService');
        expect(svc.config.headers.Authorization).toBeUndefined();
        expect(globalThis.requestViaTab).toHaveBeenCalledTimes(1);
    });

    it.each([['an empty body', ''], ['broken JSON', '{"data":']])('Reports %s as a parse error', async (_case, text) => {
        const { svc } = service();
        globalThis.requestViaTab.mockResolvedValue(reply(200, { text }));
        await expect(svc._request('u', { what: 'глава' })).rejects.toThrow('Ошибка разбора ответа API (глава)');
    });
});

describe('BaseService request wrappers kept for plugins', () => {
    it('fetchWithRetry returns a Response-like object for any status', async () => {
        const { svc } = service();
        globalThis.requestViaTab.mockResolvedValue(reply(404, { text: 'body' }));
        const response = await svc.fetchWithRetry('u', { method: 'POST' });
        expect(response).toMatchObject({ ok: false, status: 404 });
        expect(await response.text()).toBe('body');
        expect(globalThis.requestViaTab.mock.calls[0][1]).toEqual({ method: 'POST' });
    });

    it('fetchWithRetry limits the attempts after network errors', async () => {
        const { svc } = service();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.requestViaTab.mockResolvedValue(reply(0, { ok: false }));
        await expect(svc.fetchWithRetry('u', {}, 2)).resolves.toMatchObject({ status: 0 });
        expect(globalThis.requestViaTab).toHaveBeenCalledTimes(2);
    });

    it('fetchWithRateLimitRetry limits the attempts after 429', async () => {
        const { svc } = service();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.requestViaTab
            .mockResolvedValueOnce(reply(429, { retryAfter: '1' }))
            .mockResolvedValueOnce(reply(200, { text: 'ok' }));
        const response = await svc.fetchWithRateLimitRetry('u', {}, 2);
        expect(response.status).toBe(200);

        globalThis.requestViaTab.mockResolvedValue(reply(429, { retryAfter: '1' }));
        await expect(svc.fetchWithRateLimitRetry('u', {}, 2)).rejects.toThrow('Rate limited after 2 retries (429)');
    });
});

describe('BaseService API methods', () => {
    it('fetchMangaMetadata requests the fields from the config and returns the parsed response', async () => {
        const { svc } = service({ ...config, fields: ['summary', 'authors'] });
        globalThis.requestViaTab.mockResolvedValue(reply(200, { text: '{"data":{"name":"X"}}' }));
        await expect(svc.fetchMangaMetadata('slug')).resolves.toEqual({ data: { name: 'X' } });
        expect(globalThis.requestViaTab.mock.calls[0][0]).toBe('https://test.com/api/manga/slug?fields[]=summary&fields[]=authors');
    });

    it('fetchMangaMetadata falls back to other URLs on 403/404', async () => {
        const { svc } = service({ ...config, fields: ['summary'] });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.requestViaTab
            .mockResolvedValueOnce(reply(403))
            .mockResolvedValueOnce(reply(404))
            .mockResolvedValueOnce(reply(200, { text: '{"data":{"id":7}}' }));
        await expect(svc.fetchMangaMetadata('7--title')).resolves.toEqual({ data: { id: 7 } });
        expect(globalThis.requestViaTab.mock.calls.map(([url]) => url)).toEqual([
            'https://test.com/api/manga/7--title?fields[]=summary',
            'https://test.com/api/manga/7--title',
            'https://test.com/api/manga/7'
        ]);
    });

    it('fetchMangaMetadata throws a clear error when the last URL fails', async () => {
        const { svc } = service();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        globalThis.requestViaTab.mockResolvedValue(reply(404, { text: 'not found' }));
        await expect(svc.fetchMangaMetadata('slug')).rejects.toThrow('Ошибка API (метаданные тайтла): HTTP 404');
    });

    it('fetchMangaMetadata returns null when there is no URL to try', async () => {
        const { svc } = service({ ...config, fields: [] });
        const origPush = Array.prototype.push;
        Array.prototype.push = function() { return 0; };
        try {
            await expect(svc.fetchMangaMetadata('slug')).resolves.toBeNull();
        } finally {
            Array.prototype.push = origPush;
        }
    });

    it('fetchChaptersList returns the parsed response', async () => {
        const { svc } = service();
        globalThis.requestViaTab.mockResolvedValue(reply(200, { text: '{"data":[{"id":1}]}' }));
        await expect(svc.fetchChaptersList('slug')).resolves.toEqual({ data: [{ id: 1 }] });
        expect(globalThis.requestViaTab.mock.calls[0][0]).toBe('https://test.com/api/manga/slug/chapters');
    });

    it('fetchChapter builds the query from number, volume, branch and extra params', async () => {
        const { svc } = service();
        globalThis.requestViaTab.mockResolvedValue(reply(200, { text: '{"data":{}}' }));
        await svc.fetchChapter('slug', '2', '3', 123, { server: 'compress' });
        await svc.fetchChapter('slug');
        expect(globalThis.requestViaTab.mock.calls.map(([url]) => url)).toEqual([
            'https://test.com/api/manga/slug/chapter?number=2&volume=3&branch_id=123&server=compress',
            'https://test.com/api/manga/slug/chapter?number=1&volume=1'
        ]);
    });

    it('getManga, getChapterList and getChapter return the data of the response', async () => {
        const { svc } = service();
        globalThis.requestViaTab
            .mockResolvedValueOnce(reply(200, { text: '{"data":{"name":"X"}}' }))
            .mockResolvedValueOnce(reply(200, { text: '{"data":[{"id":1}]}' }))
            .mockResolvedValueOnce(reply(200, { text: '{"data":{"content":[]}}' }));
        await expect(svc.getManga('slug')).resolves.toEqual({ name: 'X' });
        await expect(svc.getChapterList('slug')).resolves.toEqual([{ id: 1 }]);
        await expect(svc.getChapter('slug', '1', '1', 5)).resolves.toEqual({ content: [] });
        expect(globalThis.requestViaTab.mock.calls[2][0]).toContain('branch_id=5');
    });

    it('get* methods use the overridden fetch* methods of subclasses', async () => {
        class PluginService extends BaseService {
            async fetchMangaMetadata() { return { name: 'no wrapper' }; }
            async fetchChaptersList() { return { data: null }; }
            async fetchChapter(...args) { return { data: { args } }; }
        }
        const svc = new PluginService(config);
        await expect(svc.getManga('s')).resolves.toEqual({ name: 'no wrapper' });
        await expect(svc.getChapterList('s')).resolves.toEqual([]);
        await expect(svc.getChapter('s', '1', '2', null)).resolves.toEqual({ args: ['s', '1', '2', null] });
        expect(globalThis.requestViaTab).not.toHaveBeenCalled();
    });

    it('fetchChapters returns the chapter list in reading order', async () => {
        class PluginService extends BaseService {
            async fetchChaptersList() {
                return { data: [{ volume: '2', number: '1' }, { volume: '1', number: '10' }, { volume: '1', number: '9' }] };
            }
        }
        const chapters = await new PluginService(config).fetchChapters('s');
        expect(chapters.map(ch => `${ch.volume}/${ch.number}`)).toEqual(['1/9', '1/10', '2/1']);
    });
});

describe('BaseService.fetchChapterBlocks', () => {
    const chapter = { volume: '2', number: '5', branchId: 7 };
    const options = { slug: 's', mangaId: 3, splitLongImages: true, imageFit: { maxWidth: 1 } };

    it('Requests the chapter, extracts it and processes its content with the download options', async () => {
        const raw = { id: 1, content: ['page'] };
        class Service extends BaseService {
            fetchChapter = vi.fn(async () => ({ data: raw }));
            extractText = vi.fn(content => content.map(src => ({ src })));
            processChapterContent = vi.fn(async extracted => [{ type: 'text', text: extracted[0].src }]);
        }
        const svc = new Service(config);
        await expect(svc.fetchChapterBlocks(chapter, options)).resolves.toEqual([{ type: 'text', text: 'page' }]);
        expect(svc.fetchChapter).toHaveBeenCalledWith('s', '5', '2', 7);
        expect(svc.extractText).toHaveBeenCalledWith(['page']);
        expect(svc.processChapterContent).toHaveBeenCalledWith([{ src: 'page' }], null, {
            chapterMeta: raw, chapterObj: chapter, mangaSlug: 's', mangaId: 3,
            splitLongImages: true, imageFit: { maxWidth: 1 }
        });
    });

    it('Uses volume "1" and no branch by default and skips the steps the service does not have', async () => {
        class Service extends BaseService {
            fetchChapter = vi.fn(async () => ({ data: { pages: [1] } }));
        }
        const svc = new Service(config);
        await expect(svc.fetchChapterBlocks({ number: '3' }, { slug: 's' })).resolves.toEqual({ pages: [1] });
        expect(svc.fetchChapter).toHaveBeenCalledWith('s', '3', '1', null);
    });

    it('Passes the response without a data wrapper and without content as is', async () => {
        class Service extends BaseService {
            fetchChapter = vi.fn(async () => ({ content: [{ type: 'text', text: 'direct' }] }));
            processChapterContent = vi.fn(async (extracted, status, opts) => ({ extracted, opts }));
        }
        const svc = new Service(config);
        const result = await svc.fetchChapterBlocks({ number: '1', volume: '1' }, { slug: 's' });
        expect(result.extracted).toEqual([{ type: 'text', text: 'direct' }]);
        expect(result.opts).toMatchObject({ mangaId: null, splitLongImages: false, imageFit: null });
    });
});

describe('BaseService.loadPageAsBase64', () => {
    it('Loads the page through the service tab and returns a data-URL', async () => {
        const { svc } = service();
        globalThis.fetchViaTab.mockResolvedValue({ ok: true, status: 200, noTab: false, base64: 'abc', contentType: 'image/png' });
        await expect(svc.loadPageAsBase64('https://img.test/1.png', { cache: 'no-store' })).resolves.toBe('data:image/png;base64,abc');
        expect(globalThis.fetchViaTab).toHaveBeenCalledWith('https://img.test/1.png', 'TestService', {
            init: { cache: 'no-store' }, beforeSend: expect.any(Function)
        });
    });

    it('Throws NoServiceTabError without a service tab', async () => {
        const { svc } = service();
        globalThis.fetchViaTab.mockResolvedValue({ ok: false, status: 0, noTab: true });
        await expect(svc.loadPageAsBase64('u')).rejects.toBeInstanceOf(globalThis.NoServiceTabError);
    });

    it('Throws when the page cannot be loaded', async () => {
        const { svc } = service();
        globalThis.fetchViaTab.mockResolvedValue({ ok: false, status: 404, noTab: false, error: 'HTTP 404' });
        await expect(svc.loadPageAsBase64('https://img.test/1.png')).rejects.toThrow('Не удалось загрузить страницу https://img.test/1.png: HTTP 404');
    });
});

describe('BaseService.fetchImage', () => {
    const image = { ok: true, status: 200, noTab: false, base64: 'abc', contentType: 'image/png' };

    it('Loads the image through the service tab and returns the result', async () => {
        const { svc } = service();
        globalThis.fetchViaTab.mockResolvedValue(image);
        await expect(svc.fetchImage('https://img.test/1.png')).resolves.toBe(image);
        expect(globalThis.fetchViaTab).toHaveBeenCalledWith('https://img.test/1.png', 'TestService', {
            init: undefined, beforeSend: expect.any(Function)
        });
    });

    it('Returns a failed result for the caller to handle', async () => {
        const { svc } = service();
        const failure = { ok: false, status: 404, noTab: false, error: 'HTTP 404' };
        globalThis.fetchViaTab.mockResolvedValue(failure);
        await expect(svc.fetchImage('u')).resolves.toBe(failure);
    });

    it('Throws NoServiceTabError without a service tab', async () => {
        const { svc } = service();
        globalThis.fetchViaTab.mockResolvedValue({ ok: false, status: 0, noTab: true });
        await expect(svc.fetchImage('u')).rejects.toBeInstanceOf(globalThis.NoServiceTabError);
    });

    it('Checks the download before, after the rate limit grant and after the response', async () => {
        const { svc } = service();
        const calls = [];
        svc.attach({ checkpoint: vi.fn(async () => { calls.push('checkpoint'); }) });
        globalThis.fetchViaTab.mockImplementation(async (url, key, { beforeSend }) => {
            await beforeSend();
            calls.push('fetch');
            return image;
        });
        await svc.fetchImage('u');
        expect(calls).toEqual(['checkpoint', 'checkpoint', 'fetch', 'checkpoint']);
    });

    it('Stops before the request when the download is stopped', async () => {
        const { svc } = service();
        const aborted = Object.assign(new Error('Download aborted'), { aborted: true });
        svc.attach({ checkpoint: vi.fn().mockRejectedValue(aborted) });
        await expect(svc.fetchImage('u')).rejects.toBe(aborted);
        expect(globalThis.fetchViaTab).not.toHaveBeenCalled();
    });
});
