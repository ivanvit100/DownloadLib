import { describe, it, expect, beforeEach, vi } from 'vitest';

let DownloadHistory;

beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    await import('../../core/Storage.js');
    await import('../../core/DownloadHistory.js');
    DownloadHistory = (typeof window !== 'undefined' ? window : global).DownloadHistory;
});

describe('DownloadHistory', () => {
    it('getAll returns empty array when nothing stored', () => {
        expect(DownloadHistory.getAll()).toEqual([]);
    });

    it('add stores entry with downloadedAt timestamp', () => {
        const before = Date.now();
        DownloadHistory.add({ slug: 'test', title: 'Test Manga' });
        const after = Date.now();
        const all = DownloadHistory.getAll();
        expect(all).toHaveLength(1);
        expect(all[0].slug).toBe('test');
        expect(all[0].title).toBe('Test Manga');
        expect(all[0].downloadedAt).toBeGreaterThanOrEqual(before);
        expect(all[0].downloadedAt).toBeLessThanOrEqual(after);
    });

    it('add prepends new entries (most recent first)', () => {
        DownloadHistory.add({ slug: 'first' });
        DownloadHistory.add({ slug: 'second' });
        const all = DownloadHistory.getAll();
        expect(all[0].slug).toBe('second');
        expect(all[1].slug).toBe('first');
    });

    it('add trims history to 10 entries', () => {
        for (let i = 0; i < 11; i++)
            DownloadHistory.add({ slug: `manga-${i}` });
        const all = DownloadHistory.getAll();
        expect(all).toHaveLength(10);
        expect(all[0].slug).toBe('manga-10');
        expect(all[9].slug).toBe('manga-1');
    });

    it('clear removes all history', () => {
        DownloadHistory.add({ slug: 'test' });
        DownloadHistory.clear();
        expect(DownloadHistory.getAll()).toEqual([]);
    });
});
