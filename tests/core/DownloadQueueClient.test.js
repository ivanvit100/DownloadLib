import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let client;
let sendMessage;
let storageGet;
let listeners;

/**
 * Загружает клиент заново с фейковыми runtime и storage.
 * @param {{reply?: *, noOnChanged?: boolean}} [options] - Ответ фона и отсутствие storage.onChanged.
 * @returns {Promise<void>}
 */
async function load({ reply = { ok: true }, noOnChanged = false } = {}) {
    vi.resetModules();
    sendMessage = vi.fn(async () => reply);
    storageGet = vi.fn(async () => ({ download_queue: [{ id: 'a' }] }));
    listeners = new Set();
    globalThis.browser = {
        runtime: { sendMessage },
        storage: {
            local: { get: storageGet },
            onChanged: noOnChanged ? undefined : {
                addListener: vi.fn(cb => listeners.add(cb)),
                removeListener: vi.fn(cb => listeners.delete(cb))
            }
        }
    };
    ({ DownloadQueueClient: client } = await import('../../core/DownloadQueueClient.js'));
}

/**
 * Рассылает изменение storage подписчикам.
 * @param {object} changes - Изменения.
 * @param {string} [area='local'] - Область хранилища.
 * @returns {void}
 */
const emit = (changes, area = 'local') => listeners.forEach(cb => cb(changes, area));

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.browser;
});

describe('DownloadQueueClient', () => {
    it('Asks the background to download a title', async () => {
        await load({ reply: { ok: true, queued: true, position: 2 } });

        const reply = await client.request({ params: 'slug=a', title: 'A', inPlace: true });

        expect(reply).toEqual({ ok: true, queued: true, position: 2 });
        expect(sendMessage).toHaveBeenCalledWith({ action: 'downloadRequest', params: 'slug=a', title: 'A', inPlace: true });
    });

    it('Returns null when the background is unavailable', async () => {
        await load();
        sendMessage.mockRejectedValue(new Error('no receiver'));

        expect(await client.request({ params: 'slug=a' })).toBeNull();
        expect(console.warn).toHaveBeenCalled();
    });

    it('Warns when the background refuses', async () => {
        await load({ reply: { ok: false, error: 'forbidden' } });

        expect(await client.request({ params: 'slug=a' })).toEqual({ ok: false, error: 'forbidden' });
        expect(console.warn).toHaveBeenCalled();
    });

    it('Reports the result of a download and returns the next title', async () => {
        await load({ reply: { next: { id: 'b', params: 'slug=b' } } });

        const next = await client.next({ queueId: 'a', ok: false, error: 'E', stopped: false });

        expect(next).toEqual({ id: 'b', params: 'slug=b' });
        expect(sendMessage).toHaveBeenCalledWith({ action: 'queueNext', queueId: 'a', ok: false, error: 'E', stopped: false });
    });

    it('Returns no next title when the background does not answer', async () => {
        await load({ reply: undefined });

        expect(await client.next({ ok: true })).toBeNull();
    });

    it('Starts, removes and clears through messages', async () => {
        await load({ reply: { ok: true, started: true } });

        expect(await client.start()).toBe(true);
        await client.remove('a');
        await client.clear();

        expect(sendMessage.mock.calls.map(([m]) => m)).toEqual([
            { action: 'queueStart' }, { action: 'queueRemove', id: 'a' }, { action: 'queueClear' }
        ]);
    });

    it('Reads the queue from storage.local', async () => {
        await load();

        expect(await client.list()).toEqual([{ id: 'a' }]);

        storageGet.mockResolvedValue({});
        expect(await client.list()).toEqual([]);

        storageGet.mockRejectedValue(new Error('broken'));
        expect(await client.list()).toEqual([]);
    });

    it('Notifies about queue changes until unsubscribed', async () => {
        await load();
        const listener = vi.fn();

        const unsubscribe = client.onChange(listener);
        emit({ download_queue: { newValue: [{ id: 'b' }] } });
        emit({ download_queue: { newValue: undefined } });
        emit({ other: { newValue: 1 } });
        emit({ download_queue: { newValue: [] } }, 'session');
        unsubscribe();
        emit({ download_queue: { newValue: [] } });

        expect(listener.mock.calls).toEqual([[[{ id: 'b' }]], [[]]]);
    });

    it('Subscribes to nothing without storage.onChanged', async () => {
        await load({ noOnChanged: true });

        expect(() => client.onChange(vi.fn())()).not.toThrow();
    });
});
