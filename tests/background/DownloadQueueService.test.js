import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const QUEUE_KEY = 'download_queue';
const WORKER_KEY = 'downloadlib_queue_worker';

let local;
let session;
let openTabs;
let onTabRemoved;
let queue;

/**
 * Фейковая область storage с get/set по ключу.
 * @param {object} [initial] - Начальное содержимое.
 * @returns {{data: object, get: Function, set: Function}} Область хранилища.
 */
function fakeArea(initial = {}) {
    const area = {
        data: { ...initial },
        get: vi.fn(async key => ({ [key]: area.data[key] })),
        set: vi.fn(async obj => { Object.assign(area.data, obj); })
    };
    return area;
}

/**
 * Загружает модуль заново с фейковыми storage.local, storage.session и tabs.
 * @param {{items?: object[], worker?: ?number, tabs?: number[], noSession?: boolean}} [state] - Начальная
 * очередь, вкладка скачивающего окна, открытые вкладки, отсутствие storage.session.
 * @returns {Promise<void>}
 */
async function load({ items = [], worker = null, tabs = [], noSession = false } = {}) {
    vi.resetModules();
    local = fakeArea({ [QUEUE_KEY]: items });
    session = fakeArea({ [WORKER_KEY]: worker });
    openTabs = new Set(tabs);
    onTabRemoved = null;
    globalThis.browser = {
        storage: noSession ? { local } : { local, session },
        tabs: {
            get: vi.fn(async id => {
                if (!openTabs.has(id)) throw new Error(`No tab with id: ${id}`);
                return { id };
            }),
            onRemoved: { addListener: vi.fn(cb => { onTabRemoved = cb; }) }
        }
    };
    queue = await import('../../background/DownloadQueueService.js');
}

/**
 * Элемент очереди для начального состояния.
 * @param {string} id - id тайтла.
 * @param {string} status - Состояние.
 * @param {string} [slug] - slug тайтла.
 * @returns {object} Элемент очереди.
 */
const item = (id, status, slug = id) => ({
    id, status, params: `download=true&slug=${slug}&service=mangalib&format=fb2`, title: null, error: null, addedAt: 1
});

const items = () => local.data[QUEUE_KEY];
const entry = (slug, extra = '') => ({ params: `download=true&slug=${slug}&service=mangalib&format=fb2${extra}`, title: slug });

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.browser;
});

describe('request', () => {
    it('Starts the download and remembers the window when nobody downloads', async () => {
        await load();
        const launch = vi.fn(async () => ({ tabId: 5 }));

        const result = await queue.request(entry('a'), launch);

        expect(result).toEqual({ queued: false, opened: { tabId: 5 } });
        expect(launch).toHaveBeenCalledOnce();
        expect(session.data[WORKER_KEY]).toBe(5);
        expect(items()).toEqual([]);
    });

    it('Queues the title when another window downloads', async () => {
        await load({ worker: 5, tabs: [5] });
        const launch = vi.fn();

        const result = await queue.request(entry('a'), launch);

        expect(result).toEqual({ queued: true, position: 1 });
        expect(launch).not.toHaveBeenCalled();
        expect(items()).toHaveLength(1);
        expect(items()[0]).toMatchObject({ status: 'pending', title: 'a', params: entry('a').params });
    });

    it('Numbers queued titles among the pending ones', async () => {
        await load({ worker: 5, tabs: [5], items: [item('x', 'active'), item('y', 'error')] });

        expect((await queue.request(entry('a'), vi.fn())).position).toBe(1);
        expect((await queue.request(entry('b'), vi.fn())).position).toBe(2);
    });

    it('Does not queue the same title twice, whatever the tab of the service', async () => {
        await load({ worker: 5, tabs: [5] });

        await queue.request(entry('a', '&tabId=1'), vi.fn());
        const result = await queue.request(entry('a', '&tabId=2'), vi.fn());

        expect(result).toEqual({ queued: true, position: 1 });
        expect(items()).toHaveLength(1);
    });

    it('Reports position 0 for a title that is downloading now', async () => {
        await load({ worker: 5, tabs: [5], items: [item('a', 'active')] });

        expect(await queue.request(entry('a'), vi.fn())).toEqual({ queued: true, position: 0 });
    });

    it('Queues a title again after it failed', async () => {
        await load({ worker: 5, tabs: [5], items: [item('a', 'error')] });

        await queue.request(entry('a'), vi.fn());

        expect(items().map(i => i.status)).toEqual(['error', 'pending']);
    });

    it('Lets the downloading window itself start a new download in place', async () => {
        await load({ worker: 5, tabs: [5] });
        const launch = vi.fn(async () => ({ tabId: 5 }));

        expect((await queue.request(entry('a'), launch, 5)).queued).toBe(false);
        expect(launch).toHaveBeenCalledOnce();
    });

    it('Forgets a closed window and returns its title to the queue', async () => {
        await load({ worker: 5, tabs: [], items: [item('x', 'active')] });
        const launch = vi.fn(async () => ({ tabId: 6 }));

        expect((await queue.request(entry('a'), launch)).queued).toBe(false);
        expect(session.data[WORKER_KEY]).toBe(6);
        expect(items()[0].status).toBe('pending');
    });

    it('Does not remember a window that failed to open', async () => {
        await load();

        expect(await queue.request(entry('a'), vi.fn(async () => false))).toEqual({ queued: false, opened: false });
        expect(session.data[WORKER_KEY]).toBeNull();
    });

    it('Keeps the window in memory without storage.session', async () => {
        await load({ noSession: true, tabs: [5] });

        await queue.request(entry('a'), async () => ({ tabId: 5 }));

        expect((await queue.request(entry('b'), vi.fn())).queued).toBe(true);
    });
});

describe('next', () => {
    it('Removes a downloaded title and hands out the next one', async () => {
        await load({ worker: 5, tabs: [5], items: [item('a', 'active'), item('b', 'pending')] });

        const result = await queue.next(5, { queueId: 'a', ok: true });

        expect(result).toEqual({ next: { id: 'b', params: item('b', 'pending').params } });
        expect(items().map(i => [i.id, i.status])).toEqual([['b', 'active']]);
        expect(session.data[WORKER_KEY]).toBe(5);
    });

    it('Keeps a failed title with its error and goes on', async () => {
        await load({ worker: 5, tabs: [5], items: [item('a', 'active'), item('b', 'pending')] });

        const result = await queue.next(5, { queueId: 'a', ok: false, error: 'HTTP 500' });

        expect(result.next.id).toBe('b');
        expect(items()[0]).toMatchObject({ id: 'a', status: 'error', error: 'HTTP 500' });
    });

    it('Uses a generic error text when the error is unknown', async () => {
        await load({ worker: 5, tabs: [5], items: [item('a', 'active')] });

        await queue.next(5, { queueId: 'a', ok: false });

        expect(items()[0].error).toBe('Неизвестная ошибка');
    });

    it('Stops the queue when the download was stopped', async () => {
        await load({ worker: 5, tabs: [5], items: [item('a', 'active'), item('b', 'pending')] });

        const result = await queue.next(5, { queueId: 'a', ok: true, stopped: true });

        expect(result).toEqual({ next: null });
        expect(items().map(i => [i.id, i.status, i.error])).toEqual([
            ['a', 'error', 'Загрузка остановлена'], ['b', 'pending', null]
        ]);
        expect(session.data[WORKER_KEY]).toBeNull();
    });

    it('Releases the window when the queue is empty', async () => {
        await load({ worker: 5, tabs: [5] });

        expect(await queue.next(5, { ok: true })).toEqual({ next: null });
        expect(session.data[WORKER_KEY]).toBeNull();
    });

    it('Hands out the next title after a download that was not queued', async () => {
        await load({ worker: 5, tabs: [5], items: [item('b', 'pending')] });

        expect((await queue.next(5, { ok: true })).next.id).toBe('b');
    });

    it('Gives nothing to a window that is not the downloading one', async () => {
        await load({ worker: 5, tabs: [5, 6], items: [item('a', 'active'), item('b', 'pending')] });

        const result = await queue.next(6, { queueId: 'a', ok: true });

        expect(result).toEqual({ next: null });
        expect(items().map(i => [i.id, i.status])).toEqual([['b', 'pending']]);
        expect(session.data[WORKER_KEY]).toBe(5);
    });

    it('Lets any window take the queue over when nobody downloads', async () => {
        await load({ items: [item('b', 'pending')] });

        expect((await queue.next(6, { ok: true })).next.id).toBe('b');
        expect(session.data[WORKER_KEY]).toBe(6);
    });

    it('Gives nothing to a sender without a tab', async () => {
        await load({ items: [item('b', 'pending')] });

        expect(await queue.next(null, { ok: true })).toEqual({ next: null });
    });
});

describe('start', () => {
    it('Opens the window of the first pending title', async () => {
        await load({ items: [item('x', 'error'), item('a', 'pending'), item('b', 'pending')] });
        const open = vi.fn(async () => ({ tabId: 7 }));

        expect(await queue.start(open)).toEqual({ started: true });

        const params = new URLSearchParams(open.mock.calls[0][0]);
        expect(params.get('slug')).toBe('a');
        expect(params.get('queueId')).toBe('a');
        expect(items().map(i => i.status)).toEqual(['error', 'active', 'pending']);
        expect(session.data[WORKER_KEY]).toBe(7);
    });

    it('Does nothing while another window downloads', async () => {
        await load({ worker: 5, tabs: [5], items: [item('a', 'pending')] });
        const open = vi.fn();

        expect(await queue.start(open)).toEqual({ started: false });
        expect(open).not.toHaveBeenCalled();
    });

    it('Does nothing without pending titles', async () => {
        await load({ items: [item('x', 'error')] });

        expect(await queue.start(vi.fn())).toEqual({ started: false });
    });

    it('Keeps the title pending when the window fails to open', async () => {
        await load({ items: [item('a', 'pending')] });

        expect(await queue.start(vi.fn(async () => null))).toEqual({ started: false });
        expect(items()[0].status).toBe('pending');
    });
});

describe('remove and clear', () => {
    it('Removes a title but not the downloading one', async () => {
        await load({ items: [item('a', 'active'), item('b', 'pending')] });

        await queue.remove('b');
        await queue.remove('a');

        expect(items().map(i => i.id)).toEqual(['a']);
    });

    it('Clears everything except the downloading title', async () => {
        await load({ items: [item('a', 'error'), item('b', 'active'), item('c', 'pending')] });

        await queue.clear();

        expect(items().map(i => i.id)).toEqual(['b']);
    });
});

describe('closing the window', () => {
    it('Releases the closed downloading window and returns its title to the queue', async () => {
        await load({ worker: 5, tabs: [5], items: [item('a', 'active')] });

        await onTabRemoved(5);

        expect(session.data[WORKER_KEY]).toBeNull();
        expect(items()[0].status).toBe('pending');
    });

    it('Ignores other closed tabs', async () => {
        await load({ worker: 5, tabs: [5], items: [item('a', 'active')] });

        await onTabRemoved(9);

        expect(session.data[WORKER_KEY]).toBe(5);
        expect(items()[0].status).toBe('active');
    });
});

describe('storage failures', () => {
    it('Treats an unreadable queue as empty and keeps working', async () => {
        await load();
        local.get.mockRejectedValue(new Error('broken'));
        local.set.mockRejectedValue(new Error('broken'));
        session.get.mockRejectedValue(new Error('broken'));
        session.set.mockRejectedValue(new Error('broken'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect((await queue.request(entry('a'), async () => ({ tabId: 5 }))).queued).toBe(false);
        await expect(queue.clear()).resolves.toBeUndefined();
        expect(console.warn).toHaveBeenCalled();
    });
});
