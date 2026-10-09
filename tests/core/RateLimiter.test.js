import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_RATE_LIMIT, normalizeRateLimit, RateLimiter } from '../../core/RateLimiter.js';

const settle = () => vi.advanceTimersByTimeAsync(0);

/**
 * Запускает n запросов и возвращает функцию, сообщающую, сколько из них уже разрешено.
 * @param {RateLimiter} limiter - Ограничитель.
 * @param {number} n - Число запросов.
 * @returns {{granted: function(): number, requests: Promise[]}}
 */
function startRequests(limiter, n) {
    let granted = 0;
    const requests = Array.from({ length: n }, () => limiter.acquire('svc').then(() => { granted += 1; }));
    return { granted: () => granted, requests };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('normalizeRateLimit', () => {
    it('Clamps the limit to 2..200 without subtracting one', () => {
        expect(normalizeRateLimit(50)).toBe(50);
        expect(normalizeRateLimit('20')).toBe(20);
        expect(normalizeRateLimit(1)).toBe(2);
        expect(normalizeRateLimit(1000)).toBe(200);
    });

    it('Falls back to the default for non-numeric values', () => {
        expect(normalizeRateLimit('abc')).toBe(DEFAULT_RATE_LIMIT);
        expect(normalizeRateLimit(undefined)).toBe(DEFAULT_RATE_LIMIT);
    });
});

describe('RateLimiter', () => {
    it('Grants up to the limit within a minute and the rest when the window slides', async () => {
        const limiter = new RateLimiter({ maxRequestsPerMinute: 3 });
        const { granted } = startRequests(limiter, 5);
        await settle();
        expect(granted()).toBe(3);
        expect(limiter.getStats()).toMatchObject({ requestsInLastMinute: 3, queueSize: 2, maxRequestsPerMinute: 3 });

        await vi.advanceTimersByTimeAsync(59999);
        expect(granted()).toBe(3);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted()).toBe(5);
    });

    it('Uses a single timer for the whole queue instead of polling', async () => {
        const limiter = new RateLimiter({ maxRequestsPerMinute: 2 });
        startRequests(limiter, 10);
        await settle();
        expect(vi.getTimerCount()).toBe(1);
    });

    it('Releases the next request when the oldest grant leaves the window', async () => {
        const limiter = new RateLimiter({ maxRequestsPerMinute: 2 });
        const first = startRequests(limiter, 1);
        await vi.advanceTimersByTimeAsync(20000);
        const rest = startRequests(limiter, 2);
        await settle();
        expect(first.granted() + rest.granted()).toBe(2);

        await vi.advanceTimersByTimeAsync(40000);
        expect(rest.granted()).toBe(2);
    });

    it('setLimit applies the exact limit and releases waiting requests when raised', async () => {
        const limiter = new RateLimiter({ maxRequestsPerMinute: 2 });
        const { granted } = startRequests(limiter, 4);
        await settle();
        expect(granted()).toBe(2);

        limiter.setLimit(4);
        await settle();
        expect(granted()).toBe(4);
        expect(limiter.getStats().maxRequestsPerMinute).toBe(4);
    });

    it('throttle blocks all grants until the block ends', async () => {
        const limiter = new RateLimiter({ maxRequestsPerMinute: 10 });
        limiter.throttle(5000);
        const { granted } = startRequests(limiter, 2);
        await vi.advanceTimersByTimeAsync(4999);
        expect(granted()).toBe(0);
        expect(limiter.getStats().throttled).toBe(true);

        await vi.advanceTimersByTimeAsync(1);
        expect(granted()).toBe(2);
        expect(limiter.getStats().throttled).toBe(false);
    });

    it('throttle extends the block when called again with a later end', async () => {
        const limiter = new RateLimiter({ maxRequestsPerMinute: 10 });
        limiter.throttle(5000);
        await vi.advanceTimersByTimeAsync(3000);
        const until = limiter.throttle(5000);
        expect(until).toBe(Date.now() + 5000);

        const { granted } = startRequests(limiter, 1);
        await vi.advanceTimersByTimeAsync(4999);
        expect(granted()).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted()).toBe(1);
    });

    it('throttle does not shorten a longer block', () => {
        const limiter = new RateLimiter();
        const until = limiter.throttle(30000);
        expect(limiter.throttle(1000)).toBe(until);
    });

    it('recordRequest always counts, even when the limit is reached', async () => {
        const limiter = new RateLimiter({ maxRequestsPerMinute: 2 });
        limiter.recordRequest('page');
        limiter.recordRequest('page');
        limiter.record('page');
        expect(limiter.getStats().requestsInLastMinute).toBe(3);

        const { granted } = startRequests(limiter, 1);
        await settle();
        expect(granted()).toBe(0);
    });

    it('reset rejects waiting requests, clears the window and the block', async () => {
        const limiter = new RateLimiter({ maxRequestsPerMinute: 1 });
        await limiter.acquire('svc');
        limiter.throttle(60000);
        const waiting = limiter.acquire('svc');

        limiter.reset();
        await expect(waiting).rejects.toThrow('Rate limiter reset');
        expect(limiter.getStats()).toMatchObject({ requestsInLastMinute: 0, queueSize: 0, throttled: false });
        expect(vi.getTimerCount()).toBe(0);

        await expect(limiter.acquire('svc')).resolves.toBeUndefined();
    });

    it('execute runs the function after a grant and returns its result', async () => {
        const limiter = new RateLimiter();
        await expect(limiter.execute('svc', () => 42)).resolves.toBe(42);
        expect(limiter.getStats().requestsInLastMinute).toBe(1);
    });

    it('trackRequest is the same as acquire', async () => {
        const limiter = new RateLimiter({ maxRequestsPerMinute: 1 });
        await limiter.trackRequest('svc');
        expect(limiter.getStats().requestsInLastMinute).toBe(1);
    });

    it('snapshot and restore keep the window and the block across restarts', async () => {
        const limiter = new RateLimiter({ maxRequestsPerMinute: 2 });
        await limiter.acquire('svc');
        await limiter.acquire('svc');
        limiter.throttle(10000);
        const snapshot = limiter.snapshot();

        const restored = new RateLimiter({ maxRequestsPerMinute: 2 });
        restored.restore(snapshot);
        expect(restored.getStats()).toMatchObject({ requestsInLastMinute: 2, throttled: true });

        const { granted } = startRequests(restored, 1);
        await vi.advanceTimersByTimeAsync(59999);
        expect(granted()).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(granted()).toBe(1);
    });

    it('restore drops timestamps that already left the window and ignores empty state', () => {
        const limiter = new RateLimiter();
        limiter.restore({ timestamps: [Date.now() - 120000, Date.now() - 1000, 'x'], blockedUntil: 0 });
        expect(limiter.getStats().requestsInLastMinute).toBe(1);
        expect(() => limiter.restore(null)).not.toThrow();
    });

    it('Calls onChange when its state changes', async () => {
        const onChange = vi.fn();
        const limiter = new RateLimiter({ onChange });
        await limiter.acquire('svc');
        limiter.throttle(1000);
        limiter.setLimit(10);
        limiter.recordRequest();
        limiter.reset();
        expect(onChange).toHaveBeenCalledTimes(5);
    });
});
