import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../core/RateLimitClient.js', async () =>
    (await import('../helpers/globalBridge.js')).globalBridge('RateLimitClient'));

let createController, DownloadContext, DEFERRED_SETTINGS;

beforeEach(async () => {
    vi.resetModules();
    globalThis.RateLimitClient = { isHeldBack: vi.fn(() => false) };
    ({ createController, DownloadContext } = await import('../../core/DownloadContext.js'));
    ({ DEFERRED_SETTINGS } = await import('../../core/DeferredQueue.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.RateLimitClient;
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createController', () => {
    it('Starts running, not paused', async () => {
        const controller = createController();
        expect(controller.isPaused()).toBe(false);
        expect(controller.shouldStop()).toBe(false);
        await expect(controller.waitIfPaused()).resolves.toBeUndefined();
    });

    it('waitIfPaused waits for resume without a timer', async () => {
        vi.useFakeTimers();
        try {
            const controller = createController();
            controller.pause();
            let resumed = 0;
            controller.waitIfPaused().then(() => { resumed += 1; });
            controller.waitIfPaused().then(() => { resumed += 1; });
            expect(vi.getTimerCount()).toBe(0);
            await Promise.resolve();
            expect(resumed).toBe(0);

            controller.resume();
            await vi.runAllTimersAsync();
            expect(resumed).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stop releases a paused download and cannot be paused again', async () => {
        const controller = createController();
        controller.pause();
        const waiting = controller.waitIfPaused();
        controller.stop();
        await expect(waiting).resolves.toBeUndefined();
        expect(controller.shouldStop()).toBe(true);
        controller.pause();
        expect(controller.isPaused()).toBe(false);
    });
});

describe('DownloadContext', () => {
    it('Has a default controller, settings and its own deferred queue', () => {
        const first = new DownloadContext();
        const second = new DownloadContext({ settings: { splitPages: true, format: 'epub' } });
        expect(first.settings).toEqual({ splitPages: false, imageFit: null, format: 'fb2' });
        expect(second.settings).toEqual({ splitPages: true, imageFit: null, format: 'epub' });
        expect(first.deferred).not.toBe(second.deferred);
        expect(typeof first.controller.waitIfPaused).toBe('function');
    });

    it('checkpoint waits while paused and throws an aborted error once stopped', async () => {
        const ctx = new DownloadContext();
        ctx.controller.pause();
        let passed = false;
        const check = ctx.checkpoint().then(() => { passed = true; });
        await settle();
        expect(passed).toBe(false);
        ctx.controller.resume();
        await check;
        expect(passed).toBe(true);
        expect(ctx.interrupted).toBe(false);

        ctx.controller.stop();
        await expect(ctx.checkpoint()).rejects.toMatchObject({ message: 'Download aborted', aborted: true });
        expect(ctx.interrupted).toBe(true);
    });

    it('Is held back while paused or while requests wait for the rate limiter', () => {
        const ctx = new DownloadContext();
        expect(ctx.isHeldBack()).toBe(false);
        RateLimitClient.isHeldBack.mockReturnValue(true);
        expect(ctx.isHeldBack()).toBe(true);
        RateLimitClient.isHeldBack.mockReturnValue(false);
        ctx.controller.pause();
        expect(ctx.isHeldBack()).toBe(true);
    });

    it('Defers a slow image only after the time the download was not held back', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { deferAfterMs } = DEFERRED_SETTINGS;
        try {
            const ctx = new DownloadContext();
            await expect(ctx.loadImageOrDefer(1, async () => ['img'])).resolves.toEqual(['img']);

            const deferred = ctx.loadImageOrDefer(2, () => new Promise(() => {}));
            await vi.advanceTimersByTimeAsync(deferAfterMs);
            const [placeholder] = await deferred;
            expect(placeholder.pendingImage.label).toBe(2);

            RateLimitClient.isHeldBack.mockReturnValueOnce(true);
            const slow = () => new Promise(resolve => setTimeout(() => resolve(['late']), deferAfterMs * 1.5));
            const loading = ctx.loadImageOrDefer(3, slow);
            await vi.advanceTimersByTimeAsync(deferAfterMs * 2);
            await expect(loading).resolves.toEqual(['late']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('Passes page progress and 429 waits to the callbacks, if any', () => {
        const onPageProgress = vi.fn();
        const on429 = vi.fn();
        const ctx = new DownloadContext({ onPageProgress, on429 });
        ctx.onPageProgress(1, 4);
        ctx.on429(3000);
        expect(onPageProgress).toHaveBeenCalledWith(1, 4);
        expect(on429).toHaveBeenCalledWith(3000);
        expect(() => new DownloadContext().onPageProgress(1, 1)).not.toThrow();
        expect(() => new DownloadContext().on429(1)).not.toThrow();
    });

    it('Tracks the current download', () => {
        const first = new DownloadContext();
        const second = new DownloadContext();
        expect(DownloadContext.current).toBeNull();
        first.activate();
        second.activate();
        expect(DownloadContext.current).toBe(second);
        first.deactivate();
        expect(DownloadContext.current).toBe(second);
        second.deactivate();
        expect(DownloadContext.current).toBeNull();
    });
});
