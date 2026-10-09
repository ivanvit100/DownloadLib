import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MSG } from '../../core/messages.js';
import { RATE_LIMIT_STORAGE_KEY } from '../../core/RateLimiter.js';

let RateLimitClient;
let sendMessage;
let local;

/**
 * Загружает модуль заново: у клиента модульное состояние (ожидающие запросы, блокировка).
 * @param {{storage?: object|null}} [options] - storage.local, либо null без него.
 * @returns {Promise<void>}
 */
async function load({ storage } = {}) {
    vi.resetModules();
    sendMessage = vi.fn().mockResolvedValue({ ok: true });
    local = storage === undefined
        ? { data: {}, get: vi.fn(async key => ({ [key]: local.data[key] })), set: vi.fn(async obj => { Object.assign(local.data, obj); }) }
        : storage;
    globalThis.browser = { runtime: { sendMessage }, ...(local ? { storage: { local } } : {}) };
    ({ RateLimitClient } = await import('../../core/RateLimitClient.js'));
}

beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    localStorage.clear();
    await load();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    delete globalThis.browser;
});

describe('RateLimitClient.acquire / isHeldBack', () => {
    it('Asks the background limiter for a grant', async () => {
        await RateLimitClient.acquire('mangalib');
        await RateLimitClient.acquire();
        expect(sendMessage).toHaveBeenNthCalledWith(1, { action: MSG.RATE_ACQUIRE, serviceKey: 'mangalib' });
        expect(sendMessage).toHaveBeenNthCalledWith(2, { action: MSG.RATE_ACQUIRE, serviceKey: 'default' });
    });

    it('Is held back while a grant is pending', async () => {
        let grant;
        sendMessage.mockReturnValue(new Promise(resolve => { grant = resolve; }));
        expect(RateLimitClient.isHeldBack()).toBe(false);

        const request = RateLimitClient.acquire('mangalib');
        expect(RateLimitClient.isHeldBack()).toBe(true);
        expect(RateLimitClient.getStats().queueSize).toBe(1);

        grant({ ok: true });
        await request;
        expect(RateLimitClient.isHeldBack()).toBe(false);
    });

    it('Lets the request through when the background is unavailable', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sendMessage.mockRejectedValue(new Error('no receiver'));
        await expect(RateLimitClient.acquire('mangalib')).resolves.toBeUndefined();
        expect(RateLimitClient.isHeldBack()).toBe(false);
        expect(warn).toHaveBeenCalledWith('[RateLimitClient] Background rate limiter unavailable:', 'no receiver');
    });

    it('Warns when the background refuses the request', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sendMessage.mockResolvedValue({ ok: false, error: 'forbidden' });
        await RateLimitClient.acquire('mangalib');
        expect(warn).toHaveBeenCalledWith('[RateLimitClient] Rate limiter refused the request:', 'forbidden');
    });
});

describe('RateLimitClient.throttle', () => {
    it('Holds this window back at once and reports the block to the background', async () => {
        sendMessage.mockResolvedValue({ ok: true, blockedUntil: Date.now() + 5000 });
        RateLimitClient.throttle(5000);
        expect(RateLimitClient.isHeldBack()).toBe(true);
        expect(RateLimitClient.getStats().throttled).toBe(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(sendMessage).toHaveBeenCalledWith({ action: MSG.RATE_THROTTLE, ms: 5000 });

        await vi.advanceTimersByTimeAsync(5000);
        expect(RateLimitClient.isHeldBack()).toBe(false);
    });

    it('Uses 30 seconds by default', async () => {
        RateLimitClient.throttle();
        await vi.advanceTimersByTimeAsync(0);
        expect(sendMessage).toHaveBeenCalledWith({ action: MSG.RATE_THROTTLE, ms: 30000 });
    });

    it('Extends the local block to the end reported by the background', async () => {
        sendMessage.mockResolvedValue({ ok: true, blockedUntil: Date.now() + 20000 });
        RateLimitClient.throttle(5000);
        await vi.advanceTimersByTimeAsync(10000);
        expect(RateLimitClient.isHeldBack()).toBe(true);
        await vi.advanceTimersByTimeAsync(10000);
        expect(RateLimitClient.isHeldBack()).toBe(false);
    });

    it('Keeps the local block when the background is unavailable', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        sendMessage.mockRejectedValue(new Error('no receiver'));
        RateLimitClient.throttle(5000);
        await vi.advanceTimersByTimeAsync(0);
        expect(RateLimitClient.isHeldBack()).toBe(true);
        expect(warn).toHaveBeenCalledWith('[RateLimitClient] Failed to report throttling:', 'no receiver');
    });

    it('reset lifts the local block', () => {
        RateLimitClient.throttle(5000);
        RateLimitClient.reset();
        expect(RateLimitClient.isHeldBack()).toBe(false);
    });
});

describe('RateLimitClient.getLimit / setLimit', () => {
    it('Returns the default limit when nothing is saved', async () => {
        expect(await RateLimitClient.getLimit()).toBe(85);
        expect(local.set).not.toHaveBeenCalled();
    });

    it('Reads the limit from storage.local', async () => {
        local.data[RATE_LIMIT_STORAGE_KEY] = 40;
        expect(await RateLimitClient.getLimit()).toBe(40);
        expect(RateLimitClient.getStats().maxRequestsPerMinute).toBe(40);
    });

    it('Prefers storage.local over the legacy localStorage value', async () => {
        local.data[RATE_LIMIT_STORAGE_KEY] = 40;
        localStorage.setItem(RATE_LIMIT_STORAGE_KEY, '120');
        expect(await RateLimitClient.getLimit()).toBe(40);
    });

    it('Moves the legacy localStorage value to storage.local', async () => {
        localStorage.setItem(RATE_LIMIT_STORAGE_KEY, '120');
        expect(await RateLimitClient.getLimit()).toBe(120);
        expect(local.data[RATE_LIMIT_STORAGE_KEY]).toBe(120);
        expect(localStorage.getItem(RATE_LIMIT_STORAGE_KEY)).toBeNull();
    });

    it('Normalizes the saved value', async () => {
        local.data[RATE_LIMIT_STORAGE_KEY] = 1000;
        expect(await RateLimitClient.getLimit()).toBe(200);
    });

    it('Falls back to localStorage when storage.local cannot be read', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        local.get.mockRejectedValue(new Error('read failed'));
        localStorage.setItem(RATE_LIMIT_STORAGE_KEY, '30');
        expect(await RateLimitClient.getLimit()).toBe(30);
        expect(warn).toHaveBeenCalledWith('[RateLimitClient] Failed to read rate limit:', 'read failed');
    });

    it('Keeps the legacy value where storage.local does not exist', async () => {
        await load({ storage: null });
        localStorage.setItem(RATE_LIMIT_STORAGE_KEY, '30');
        expect(await RateLimitClient.getLimit()).toBe(30);
        expect(localStorage.getItem(RATE_LIMIT_STORAGE_KEY)).toBe('30');
    });

    it('setLimit saves the normalized limit to storage.local and drops the legacy value', async () => {
        localStorage.setItem(RATE_LIMIT_STORAGE_KEY, '30');
        expect(await RateLimitClient.setLimit('1')).toBe(2);
        expect(local.set).toHaveBeenCalledWith({ [RATE_LIMIT_STORAGE_KEY]: 2 });
        expect(localStorage.getItem(RATE_LIMIT_STORAGE_KEY)).toBeNull();
        expect(RateLimitClient.getStats().maxRequestsPerMinute).toBe(2);
    });

    it('setLimit keeps the legacy value when storage.local cannot be written', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        local.set.mockRejectedValue(new Error('write failed'));
        localStorage.setItem(RATE_LIMIT_STORAGE_KEY, '30');
        expect(await RateLimitClient.setLimit(50)).toBe(50);
        expect(localStorage.getItem(RATE_LIMIT_STORAGE_KEY)).toBe('30');
        expect(warn).toHaveBeenCalledWith('[RateLimitClient] Failed to save rate limit:', 'write failed');
    });
});
