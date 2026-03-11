import { describe, it, expect, vi, beforeEach } from 'vitest';

let RateLimiter;

describe('RateLimiter global instance log', () => {
    it('Logs when using existing global RateLimiter instance', async () => {
        const path = require.resolve('../../core/RateLimiter.js');
        delete require.cache[path];

        global.RateLimiter = undefined;
        global.globalRateLimiter = { test: true };

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        await import('../../core/RateLimiter.js');

        expect(
            logSpy.mock.calls.some(
                call => String(call[0]).includes('[RateLimiter] Using existing global RateLimiter instance')
            )
        ).toBe(true);

        logSpy.mockRestore();

        delete global.globalRateLimiter;
    });
});

describe('RateLimiter', () => {
    beforeEach(async () => {
        const path = require.resolve('../../core/RateLimiter.js');
        delete require.cache[path];
        delete global.globalRateLimiter;
        await import('../../core/RateLimiter.js');
        RateLimiter = global.RateLimiter;
        if (!global.globalRateLimiter) {
            global.globalRateLimiter = new RateLimiter({ maxRequestsPerMinute: 99 });
        }
    });

    it('Initializes with default limit', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const rl = new RateLimiter();
        expect(rl._maxRequestsPerMinute).toBe(85);
        logSpy.mockRestore();
    });

    it('Initializes with custom limit', () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 10 });
        expect(rl._maxRequestsPerMinute).toBe(10);
    });

    it('Set limit enforces minimum and logs', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const rl = new RateLimiter({ maxRequestsPerMinute: 10 });
        rl.setLimit(1);
        expect(rl._maxRequestsPerMinute).toBe(1);
        rl.setLimit(20);
        expect(rl._maxRequestsPerMinute).toBe(19);
        expect(logSpy).toHaveBeenCalledWith('[RateLimiter] Rate limit set to: 1 requests/minute');
        expect(logSpy).toHaveBeenCalledWith('[RateLimiter] Rate limit set to: 19 requests/minute');
        logSpy.mockRestore();
    });

    it('Track request resolves and increments stats', async () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const before = rl.getStats().requestsInLastMinute;
        await rl.trackRequest('test');
        expect(rl.getStats().requestsInLastMinute).toBe(before + 1);
    });

    it('Acquire is alias for trackRequest', async () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const spy = vi.spyOn(rl, 'trackRequest');
        await rl.acquire('svc');
        expect(spy).toHaveBeenCalledWith('svc');
    });

    it('Execute waits for slot and calls fn', async () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const fn = vi.fn(() => 42);
        const result = await rl.execute('svc', fn);
        expect(result).toBe(42);
        expect(fn).toHaveBeenCalled();
    });

    it('Get stats returns correct structure', () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const stats = rl.getStats();
        expect(stats).toHaveProperty('requestsInLastMinute');
        expect(stats).toHaveProperty('maxRequestsPerMinute');
        expect(stats).toHaveProperty('queueSize');
        expect(stats).toHaveProperty('timestamps');
        expect(Array.isArray(stats.timestamps)).toBe(true);
    });

    it('Reset clears stats and logs', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        rl._requestsInLastMinute = 3;
        rl._requestTimestamps = [1, 2, 3];
        rl._pendingQueue = [1, 2];
        rl._isProcessing = true;
        rl.reset();
        expect(rl._requestsInLastMinute).toBe(0);
        expect(rl._requestTimestamps).toEqual([]);
        expect(rl._pendingQueue).toEqual([]);
        expect(rl._isProcessing).toBe(false);
        expect(logSpy).toHaveBeenCalledWith('[RateLimiter] Reset completed');
        logSpy.mockRestore();
    });

    it('Decrements stats and logs on request expiration', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.useFakeTimers();
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        await rl.trackRequest();
        expect(rl._requestsInLastMinute).toBe(1);

        vi.advanceTimersByTime(60000);
        await Promise.resolve();
        vi.useRealTimers();

        expect(rl._requestsInLastMinute).toBe(0);
        expect(
            debugSpy.mock.calls.some(
                call => call[0] && call[0].includes('[RateLimiter] Request expired:')
            )
        ).toBe(true);
        debugSpy.mockRestore();
    });

    it('Logs and waits when rate limit is reached', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.useFakeTimers();
        const rl = new RateLimiter({ maxRequestsPerMinute: 2 });
        await rl.trackRequest();
        await rl.trackRequest();
        const promise = rl.trackRequest();
        expect(
            debugSpy.mock.calls.some(
                call => call[0] && call[0].includes('[RateLimiter] Rate limit reached:')
            )
        ).toBe(true);
        let done = false;
        promise.then(() => { done = true; });
        while (!done) {
            vi.runOnlyPendingTimers();
            await Promise.resolve();
        }
        vi.useRealTimers();
        debugSpy.mockRestore();
    });

    it('Returns immediately if request is processing', async () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        rl._isProcessing = true;
        rl._pendingQueue = [{ source: 'test', resolve: vi.fn() }];
        await rl._processQueue();
        expect(rl._pendingQueue).toEqual([{ source: 'test', resolve: expect.any(Function) }]);
    });

    it('Skips processing when request is falsy', async () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        rl._pendingQueue = [null, { source: 'test', resolve: vi.fn() }];
        const resolveSpy = rl._pendingQueue[1].resolve;
        await rl._processQueue();
        expect(resolveSpy).toHaveBeenCalled();
    });

    it('Acquire uses default service name when not provided', async () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const spy = vi.spyOn(rl, 'trackRequest');
        await rl.acquire();
        expect(spy).toHaveBeenCalledWith('default');
    });

    it('globalRateLimiter is defined and is instance of RateLimiter', () => {
        expect(global.globalRateLimiter).toBeInstanceOf(RateLimiter);
    });

    it('Blocks requests and unblocks after duration when throttle is called', async () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const processSpy = vi.spyOn(rl, '_processQueue').mockImplementation(() => {});
        vi.useFakeTimers();
        rl.throttle(1234);
        expect(rl._throttled).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith('[RateLimiter] 429 detected: blocking ALL requests for 1234ms');
        vi.advanceTimersByTime(1234);
        expect(rl._throttled).toBe(false);
        expect(logSpy).toHaveBeenCalledWith('[RateLimiter] Throttle lifted, resuming queue');
        expect(processSpy).toHaveBeenCalled();
        vi.useRealTimers();
        warnSpy.mockRestore();
        logSpy.mockRestore();
        processSpy.mockRestore();
    });

    it('Ignores duplicate throttle calls when already throttled', () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        rl._throttled = true;
        rl.throttle(5000);
        expect(warnSpy).toHaveBeenCalledWith('[RateLimiter] Already throttled, ignoring duplicate');
        expect(rl._throttled).toBe(true);
        warnSpy.mockRestore();
    });

    it('Clears previous throttle timer if throttle is called again before timeout', () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const clearSpy = vi.spyOn(global, 'clearTimeout');
        const timer = setTimeout(() => {}, 10000);
        rl._throttleTimer = timer;
        rl._throttled = false;
        rl.throttle(1000);
        expect(clearSpy).toHaveBeenCalledWith(timer);
        clearSpy.mockRestore();
    });

    it('Uses default duration 30000 when throttle is called without argument', () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const processSpy = vi.spyOn(rl, '_processQueue').mockImplementation(() => {});
        vi.useFakeTimers();
        rl.throttle();
        expect(warnSpy).toHaveBeenCalledWith('[RateLimiter] 429 detected: blocking ALL requests for 30000ms');
        vi.advanceTimersByTime(30000);
        expect(logSpy).toHaveBeenCalledWith('[RateLimiter] Throttle lifted, resuming queue');
        expect(processSpy).toHaveBeenCalled();
        vi.useRealTimers();
        warnSpy.mockRestore();
        logSpy.mockRestore();
        processSpy.mockRestore();
    });

    it('Logs debug message when throttled', async () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        rl._pendingQueue = [{ source: 'test', resolve: vi.fn() }];
        rl._throttled = true;
        const processPromise = rl._processQueue();
        await Promise.resolve();
        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[RateLimiter] Throttled (429). Queue size: 1. Waiting...'));
        rl._throttled = false;
        await processPromise;
        debugSpy.mockRestore();
    });

    it('Records external request, logs debug and decrements after timeout', async () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        vi.useFakeTimers();
        rl.recordRequest('svc');
        expect(rl._requestsInLastMinute).toBe(1);
        expect(rl._requestTimestamps.length).toBe(1);
        expect(debugSpy).toHaveBeenCalledWith('[RateLimiter] Recorded external request (svc): 1/5');
        vi.advanceTimersByTime(60000);
        await Promise.resolve();
        expect(rl._requestsInLastMinute).toBe(0);
        expect(rl._requestTimestamps.length).toBe(0);
        vi.useRealTimers();
        debugSpy.mockRestore();
    });

    it('Does nothing and returns immediately if requestsInLastMinute exceeds maxRequestsPerMinute', () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 2 });
        rl._requestsInLastMinute = 2;
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        rl.recordRequest('svc');
        expect(rl._requestsInLastMinute).toBe(2);
        expect(rl._requestTimestamps.length).toBe(0);
        expect(debugSpy).not.toHaveBeenCalled();
        debugSpy.mockRestore();
    });

    it('Uses default source unknown when recordRequest is called without argument', () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        rl.recordRequest();
        expect(debugSpy).toHaveBeenCalledWith('[RateLimiter] Recorded external request (unknown): 1/5');
        debugSpy.mockRestore();
    });

    it('Clears throttle timer and sets it to null when reset is called with active timer', () => {
        const rl = new RateLimiter({ maxRequestsPerMinute: 5 });
        const clearSpy = vi.spyOn(global, 'clearTimeout');
        const timer = setTimeout(() => {}, 10000);
        rl._throttleTimer = timer;
        rl.reset();
        expect(clearSpy).toHaveBeenCalledWith(timer);
        expect(rl._throttleTimer).toBeNull();
        clearSpy.mockRestore();
    });
});