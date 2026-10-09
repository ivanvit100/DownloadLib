import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RATE_LIMIT_STORAGE_KEY } from '../../core/RateLimiter.js';

const SESSION_KEY = 'downloadlib_rate_limiter_state';

let service;
let session;
let local;
let onStorageChanged;

/**
 * Загружает модуль заново с фейковыми storage.session и storage.local.
 * @param {{session?: object, local?: object, noStorage?: boolean}} [options] - Начальные данные.
 * @returns {Promise<void>}
 */
async function load({ session: sessionData = {}, local: localData = {}, noStorage = false } = {}) {
    vi.resetModules();
    session = {
        data: { ...sessionData },
        get: vi.fn(async key => ({ [key]: session.data[key] })),
        set: vi.fn(async obj => { Object.assign(session.data, obj); })
    };
    local = { get: vi.fn(async key => ({ [key]: localData[key] })) };
    onStorageChanged = null;
    globalThis.browser = noStorage ? {} : {
        storage: { session, local, onChanged: { addListener: vi.fn(cb => { onStorageChanged = cb; }) } }
    };
    service = await import('../../background/rateLimitService.js');
}

/**
 * Запускает n запросов и возвращает функцию, сообщающую, сколько из них уже разрешено.
 * @param {number} n - Число запросов.
 * @returns {function(): number}
 */
function startRequests(n) {
    let granted = 0;
    for (let i = 0; i < n; i += 1) service.acquire('mangalib').then(() => { granted += 1; });
    return () => granted;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.browser;
});

describe('rateLimitService', () => {
    it('Uses the default limit when none is saved', async () => {
        await load();
        expect((await service.getStats()).maxRequestsPerMinute).toBe(85);
    });

    it('Applies the limit saved in storage.local before the first grant', async () => {
        await load({ local: { [RATE_LIMIT_STORAGE_KEY]: 2 } });
        const granted = startRequests(3);
        await vi.advanceTimersByTimeAsync(0);
        expect(granted()).toBe(2);

        await vi.advanceTimersByTimeAsync(60000);
        expect(granted()).toBe(3);
    });

    it('Follows changes of the limit in storage.local', async () => {
        await load();
        await service.getStats();

        onStorageChanged({ [RATE_LIMIT_STORAGE_KEY]: { newValue: 10 } }, 'local');
        expect((await service.getStats()).maxRequestsPerMinute).toBe(10);

        onStorageChanged({ [RATE_LIMIT_STORAGE_KEY]: { newValue: 30 } }, 'sync');
        onStorageChanged({ other: { newValue: 30 } }, 'local');
        expect((await service.getStats()).maxRequestsPerMinute).toBe(10);

        onStorageChanged({ [RATE_LIMIT_STORAGE_KEY]: {} }, 'local');
        expect((await service.getStats()).maxRequestsPerMinute).toBe(85);
    });

    it('throttle blocks all grants and returns the end of the block', async () => {
        await load();
        expect(await service.throttle(5000)).toEqual({ blockedUntil: Date.now() + 5000 });

        const granted = startRequests(1);
        await vi.advanceTimersByTimeAsync(4999);
        expect(granted()).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted()).toBe(1);
    });

    it('Saves its state to storage.session once per burst of changes', async () => {
        await load();
        await service.acquire('a');
        await service.acquire('b');
        await service.throttle(10000);
        expect(session.set).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1000);
        expect(session.set).toHaveBeenCalledTimes(1);
        expect(session.data[SESSION_KEY]).toEqual({
            timestamps: [Date.now() - 1000, Date.now() - 1000],
            blockedUntil: Date.now() + 9000
        });
    });

    it('Restores its state after a worker restart', async () => {
        const now = Date.now();
        await load({
            local: { [RATE_LIMIT_STORAGE_KEY]: 2 },
            session: { [SESSION_KEY]: { timestamps: [now - 1000, now - 1000], blockedUntil: 0 } }
        });
        expect((await service.getStats()).requestsInLastMinute).toBe(2);

        const granted = startRequests(1);
        await vi.advanceTimersByTimeAsync(58999);
        expect(granted()).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted()).toBe(1);
    });

    it('Works without the storage API', async () => {
        await load({ noStorage: true });
        await expect(service.acquire('mangalib')).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(1000);
        expect((await service.getStats()).requestsInLastMinute).toBe(1);
    });

    it('Warns and keeps working when storage fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.resetModules();
        globalThis.browser = {
            storage: {
                session: {
                    get: vi.fn().mockRejectedValue(new Error('session read')),
                    set: vi.fn().mockRejectedValue(new Error('session write'))
                },
                local: { get: vi.fn().mockRejectedValue(new Error('local read')) }
            }
        };
        service = await import('../../background/rateLimitService.js');

        await expect(service.acquire('mangalib')).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(1000);
        expect(warn).toHaveBeenCalledWith('[rateLimitService] Failed to restore limiter state:', 'session read');
        expect(warn).toHaveBeenCalledWith('[rateLimitService] Failed to read rate limit:', 'local read');
        expect(warn).toHaveBeenCalledWith('[rateLimitService] Failed to save limiter state:', 'session write');
    });
});
