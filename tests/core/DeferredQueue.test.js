import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    DEFERRED_SETTINGS, DeferredQueue, estimateContentSize, loadImageOrDefer, waitWithDeadline
} from '../../core/DeferredQueue.js';

let saved, warnSpy, logSpy;

const never = () => new Promise(() => {});
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const image = (base64 = 'AAAA') => ({ type: 'image', data: { base64, contentType: 'image/jpeg' } });
const placeholder = (label, running, load = vi.fn()) => ({
    type: 'text',
    text: `[Изображение ${label} загружается в фоне]`,
    pendingImage: { label, load, running, estimatedBytes: 0 }
});
const later = (ms, value) => () => new Promise(r => setTimeout(() => r(value), ms));
const contentOf = chapter => chapter.content.map(b => b.text || b.data.base64);

beforeEach(() => {
    saved = { ...DEFERRED_SETTINGS };
    Object.assign(DEFERRED_SETTINGS, {
        deferAfterMs: 20, backgroundAttemptTimeoutMs: 60, retryDelayMs: 5, maxAttempts: 3,
        maxDeferredChapters: 3, defaultImageBytes: 1000, defaultChapterBytes: 6000, pollIntervalMs: 5
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
    Object.assign(DEFERRED_SETTINGS, saved);
    vi.restoreAllMocks();
});

describe('waitWithDeadline', () => {
    it('Resolves with the value of an operation that finishes in time', async () => {
        await expect(waitWithDeadline(Promise.resolve(5), 20)).resolves.toEqual({ done: true, value: 5 });
    });

    it('Reports an expired deadline while the operation keeps running', async () => {
        await expect(waitWithDeadline(never(), 10)).resolves.toEqual({ done: false });
    });

    it('Extends the deadline while the download is held back', async () => {
        const run = deferred();
        const isHeldBack = vi.fn().mockReturnValueOnce(true).mockImplementationOnce(() => {
            run.resolve('late');
            return true;
        });
        await expect(waitWithDeadline(run.promise, 10, isHeldBack)).resolves.toEqual({ done: true, value: 'late' });
    });
});

describe('estimateContentSize', () => {
    it('Counts text, images and background placeholders by their estimates', () => {
        const block = placeholder(1, never());
        block.pendingImage.estimatedBytes = 5000;
        expect(estimateContentSize({ content: [block, { type: 'text', text: 'ab' }, image('AAAAAAAA')] })).toBe(5010);
        expect(estimateContentSize({ content: [], pendingChapter: { estimatedBytes: 700 } })).toBe(700);
        expect(estimateContentSize({ content: [], pendingChapter: {} })).toBe(0);
        expect(estimateContentSize({ content: [{ type: 'image', data: {} }, { type: 'unknown' }] })).toBe(0);
        expect(estimateContentSize(null)).toBe(0);
        expect(estimateContentSize({ content: 'x' })).toBe(0);
    });
});

describe('loadImageOrDefer', () => {
    it('returns the image when it loads in time', async () => {
        const blocks = [image()];
        expect(await loadImageOrDefer(1, async () => blocks)).toBe(blocks);
    });

    it('rethrows an error that happens in time', async () => {
        await expect(loadImageOrDefer(1, async () => { throw new Error('tab gone'); }))
            .rejects.toThrow('tab gone');
    });

    it('returns a placeholder after the deadline while the load keeps running', async () => {
        const load = later(200, [image()]);
        const [block] = await loadImageOrDefer(2, load);
        expect(block).toEqual({
            type: 'text',
            text: '[Изображение 2 загружается в фоне]',
            pendingImage: { label: 2, load, running: expect.any(Promise), estimatedBytes: 0 }
        });
        expect(warnSpy).toHaveBeenCalledWith('[DeferredQueue] Image 2 not loaded within 0.02 s, ' +
            'temporarily skipped, it keeps loading in background');
    });

    it('does not count time while the download is held back (rate limiter queue, 429, pause)', async () => {
        const run = deferred();
        const blocks = [image()];
        const isHeldBack = vi.fn()
            .mockReturnValueOnce(true)
            .mockImplementationOnce(() => {
                run.resolve(blocks);
                return true;
            })
            .mockReturnValue(false);
        expect(await loadImageOrDefer(1, () => run.promise, isHeldBack)).toBe(blocks);
        expect(isHeldBack).toHaveBeenCalledTimes(2);
    });
});

describe('DeferredQueue', () => {
    it('registers placeholders of a chapter and reserves the average image size for them', () => {
        const queue = new DeferredQueue();
        const first = placeholder(1, never());
        queue.observe({ content: [first] });
        expect(first.pendingImage.estimatedBytes).toBe(1000);
        expect(warnSpy).toHaveBeenLastCalledWith('[DeferredQueue] Chapter: 1 image(s) loading ' +
            'in background (1), ~1 KB each reserved');

        const chapter = {
            title: 'Глава 2',
            content: [image('A'.repeat(4000)), image('A'.repeat(8000)), placeholder(2, never()), placeholder(5, never())]
        };
        queue.observe(chapter);
        queue.observe(chapter);
        queue.observe(null);
        queue.observe({ content: [], pendingChapter: {} });
        expect(chapter.content[2].pendingImage.estimatedBytes).toBe(4500);
        expect(queue.size).toBe(3);
        expect(queue.chapterCount).toBe(2);
        expect(warnSpy).toHaveBeenLastCalledWith('[DeferredQueue] Chapter "Глава 2": 2 image(s) loading ' +
            'in background (2, 5), ~4 KB each reserved');
        queue.observe({ content: [{ type: 'image', data: {} }] });
        expect(queue.imageCount).toBe(2);
        queue.dispose();
    });

    it('inserts an image into place as soon as its original load finishes, without restarting it', async () => {
        const queue = new DeferredQueue();
        const run = deferred();
        const load = vi.fn();
        const chapter = { title: 'Глава 1', content: [image('X'), placeholder(3, run.promise, load), { type: 'text', text: 'after' }] };
        queue.observe(chapter);
        run.resolve([image('Y1'), { type: 'text', text: 'note' }]);
        await vi.waitFor(() => expect(queue.size).toBe(0));
        expect(contentOf(chapter)).toEqual(['X', 'Y1', 'note', 'after']);
        expect(load).not.toHaveBeenCalled();
        expect(queue.imageCount).toBe(2);
        expect(logSpy).toHaveBeenCalledWith('[DeferredQueue] Image 3 of chapter "Глава 1": loaded in background ' +
            '(attempt 1), inserted into place');
        expect(logSpy).toHaveBeenCalledWith('[DeferredQueue] Chapter "Глава 1": all background images inserted');
    });

    it('leaves the content alone when the placeholder is no longer in it', async () => {
        const queue = new DeferredQueue();
        const run = deferred();
        const chapter = { content: [placeholder(1, run.promise)] };
        queue.observe(chapter);
        chapter.content = [{ type: 'text', text: 'replaced' }];
        run.resolve([image('LATE')]);
        await vi.waitFor(() => expect(queue.size).toBe(0));
        expect(contentOf(chapter)).toEqual(['replaced']);
    });

    it('does not report a chapter as complete while it still has background images', async () => {
        const queue = new DeferredQueue();
        const chapter = { content: [placeholder(1, Promise.resolve([image()])), placeholder(2, never())] };
        queue.observe(chapter);
        await vi.waitFor(() => expect(queue.size).toBe(1));
        expect(logSpy).not.toHaveBeenCalledWith('[DeferredQueue] Chapter: all background images inserted');
        queue.dispose();
    });

    it('retries a failed background load after a pause', async () => {
        const queue = new DeferredQueue();
        const load = vi.fn().mockResolvedValue([image('R')]);
        const chapter = { content: [placeholder(1, Promise.resolve(null), load)] };
        queue.observe(chapter);
        await vi.waitFor(() => expect(queue.size).toBe(0));
        expect(contentOf(chapter)).toEqual(['R']);
        expect(load).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith('[DeferredQueue] Image 1: background attempt 1/3 failed ' +
            '(source returned an error), retrying in 0.005 s');
        expect(logSpy).toHaveBeenCalledWith('[DeferredQueue] Image 1: retrying download in background (attempt 2/3)...');
        expect(logSpy).toHaveBeenCalledWith('[DeferredQueue] Image 1: loaded in background (attempt 2), inserted into place');
    });

    it('gives up after the last attempt and leaves an error marker', async () => {
        const queue = new DeferredQueue();
        const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce('oops');
        const block = placeholder(4, Promise.reject(new Error('first')), load);
        queue.observe({ content: [block] });
        await vi.waitFor(() => expect(queue.size).toBe(0));
        expect(block.text).toBe('[Ошибка загрузки изображения 4]');
        expect(block.pendingImage).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalledWith('[DeferredQueue] Image 4: background attempt 1/3 failed (first), retrying in 0.005 s');
        expect(warnSpy).toHaveBeenCalledWith('[DeferredQueue] Image 4: background attempt 2/3 failed (boom), retrying in 0.005 s');
        expect(warnSpy).toHaveBeenCalledWith('[DeferredQueue] Image 4: giving up (oops, 3 attempt(s) made), leaving error marker');
    });

    it('starts another attempt when one hangs too long and accepts whichever finishes first', async () => {
        const queue = new DeferredQueue();
        const first = deferred();
        const second = deferred();
        const third = deferred();
        const load = vi.fn().mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
        const chapter = { content: [placeholder(1, first.promise, load)] };
        queue.observe(chapter);
        await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2), { timeout: 2000 });
        expect(warnSpy).toHaveBeenCalledWith('[DeferredQueue] Image 1: still loading after 0.06 s, ' +
            'starting another attempt, the previous one keeps running');

        first.reject(new Error('late failure'));
        second.resolve(null);
        await tick(10);
        expect(queue.size).toBe(1);
        expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('failed'));

        third.resolve([image('T')]);
        await vi.waitFor(() => expect(queue.size).toBe(0));
        expect(contentOf(chapter)).toEqual(['T']);
    });

    it('ignores results that arrive after the image was already inserted', async () => {
        const queue = new DeferredQueue();
        const first = deferred();
        const second = deferred();
        const chapter = { content: [placeholder(1, first.promise, vi.fn(() => second.promise))] };
        queue.observe(chapter);
        await vi.waitFor(() => expect(queue.entries[0]?.attempts).toBe(2));
        first.resolve([image('OLD')]);
        await vi.waitFor(() => expect(queue.size).toBe(0));
        second.resolve([image('NEW')]);
        await tick(5);
        expect(contentOf(chapter)).toEqual(['OLD']);
    });

    it('gives up when every attempt hangs', async () => {
        const queue = new DeferredQueue();
        const block = placeholder(1, never(), vi.fn(never));
        queue.observe({ content: [block] });
        await vi.waitFor(() => expect(queue.size).toBe(0), { timeout: 2000 });
        expect(block.text).toBe('[Ошибка загрузки изображения 1]');
        expect(warnSpy).toHaveBeenCalledWith('[DeferredQueue] Image 1: giving up ' +
            '(still not loaded 0.06 s after attempt 3), leaving error marker');
    });

    it('does not start another attempt while the download is held back', async () => {
        const isHeldBack = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
        const queue = new DeferredQueue(isHeldBack);
        const load = vi.fn(never);
        queue.observe({ content: [placeholder(1, never(), load)] });
        await tick(90);
        expect(isHeldBack).toHaveBeenCalled();
        expect(load).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
        queue.dispose();
    });

    it('does not retry a load interrupted by a download stop; cancelAll leaves error markers', async () => {
        const queue = new DeferredQueue();
        const aborted = Object.assign(new Error('Download aborted'), { aborted: true });
        const load = vi.fn();
        const block = placeholder(1, Promise.reject(aborted), load);
        queue.observe({ content: [block] });
        await tick(80);
        expect(load).not.toHaveBeenCalled();
        expect(queue.size).toBe(1);

        queue.cancelAll('download stopped');
        expect(block.text).toBe('[Ошибка загрузки изображения 1]');
        expect(logSpy).toHaveBeenCalledWith('[DeferredQueue] Download stopped, cancelling 1 background load(s)');
        expect(warnSpy).toHaveBeenCalledWith('[DeferredQueue] Image 1: giving up (download stopped), leaving error marker');

        logSpy.mockClear();
        queue.cancelAll('download stopped');
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('dispose drops all loads silently', async () => {
        const queue = new DeferredQueue();
        const load = vi.fn();
        const block = placeholder(1, Promise.resolve(null), load);
        queue.observe({ content: [block] });
        queue.dispose();
        await tick(20);
        expect(load).not.toHaveBeenCalled();
        expect(queue.size).toBe(0);
        expect(block.pendingImage).toBeDefined();
    });

    it('defers a chapter, fills it in place when loaded and tracks its own background images', async () => {
        const queue = new DeferredQueue();
        queue.observe({ content: [{ type: 'text', text: 'x'.repeat(500) }] });
        const run = deferred();
        const chapter = queue.deferChapter({ volume: '1', number: '2' }, 'Том 1, Глава 2', vi.fn(), run.promise);
        expect(chapter).toEqual({
            title: 'Том 1, Глава 2',
            content: [{ type: 'text', text: '[Глава загружается в фоне]' }],
            volume: '1',
            number: '2',
            key: 'v1_ch2',
            pendingChapter: { estimatedBytes: 1000 }
        });
        expect(queue.countChapters()).toBe(1);
        expect(queue.countFor([chapter])).toBe(1);
        expect(queue.countFor([{}])).toBe(0);
        expect(warnSpy).toHaveBeenCalledWith('[DeferredQueue] Chapter "Том 1, Глава 2" not loaded within 0.02 s, ' +
            'temporarily skipped, it keeps loading in background (~1 KB reserved)');

        run.resolve({ title: 'Том 1, Глава 2', content: [image('C'), placeholder(1, never())], volume: '1', number: '2' });
        await vi.waitFor(() => expect(queue.countChapters()).toBe(0));
        expect(chapter.pendingChapter).toBeUndefined();
        expect(chapter.content[0].data.base64).toBe('C');
        expect(queue.countFor([chapter])).toBe(1);
        expect(logSpy).toHaveBeenCalledWith('[DeferredQueue] Chapter "Том 1, Глава 2": loaded in background ' +
            '(attempt 1), inserted into place');
        queue.dispose();
    });

    it('leaves an error chapter when a deferred chapter cannot be loaded', async () => {
        const queue = new DeferredQueue();
        const chapter = queue.deferChapter({ volume: '1', number: '3' }, 'Глава 3',
            vi.fn().mockRejectedValue(new Error('api down')), Promise.reject(new Error('api down')));
        await vi.waitFor(() => expect(chapter.pendingChapter).toBeUndefined());
        expect(chapter.content).toEqual([{ type: 'text', text: '[Ошибка загрузки главы: api down]' }]);
        expect(queue.size).toBe(0);
    });

    it('notifies listeners when loads are added and finished until they unsubscribe', async () => {
        const queue = new DeferredQueue();
        const listener = vi.fn();
        const unsubscribe = queue.onChange(listener);
        const run = deferred();
        queue.observe({ content: [placeholder(1, run.promise)] });
        expect(listener).toHaveBeenCalledTimes(1);
        run.resolve([image()]);
        await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
        unsubscribe();
        queue.observe({ content: [placeholder(2, never())] });
        queue.cancelAll('stop');
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('whenSettled resolves without a timer once the given chapters have no background loads', async () => {
        vi.useFakeTimers();
        try {
            const queue = new DeferredQueue();
            await expect(queue.whenSettled(null)).resolves.toBeUndefined();

            const first = deferred();
            const chapter = { content: [placeholder(1, first.promise)] };
            const other = { content: [placeholder(2, never())] };
            queue.observe(chapter);
            queue.observe(other);
            vi.clearAllTimers();

            let settled = false;
            const waiting = queue.whenSettled([chapter]).then(() => { settled = true; });
            let allSettled = false;
            queue.whenSettled(null).then(() => { allSettled = true; });
            expect(vi.getTimerCount()).toBe(0);
            first.resolve([image('A')]);
            await waiting;
            expect(settled).toBe(true);
            expect(allSettled).toBe(false);

            queue.dispose();
            await Promise.resolve();
            expect(allSettled).toBe(true);
            await expect(queue.whenSettled(null)).resolves.toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });
});
