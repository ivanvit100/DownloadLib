import { describe, it, expect } from 'vitest';
import { chapterKey, filterByBranch, selectRange, sortChapters } from '../../core/ChapterList.js';

describe('chapterKey', () => {
    it('Uses the chapter id, otherwise the volume and the number', () => {
        expect(chapterKey({ id: 15, volume: '1', number: '2' })).toBe('15');
        expect(chapterKey({ id: 'abc' })).toBe('abc');
        expect(chapterKey({ id: 0, volume: '1', number: '2' })).toBe('0');
        expect(chapterKey({ id: null, volume: '1', number: '2.5' })).toBe('v1_ch2.5');
        expect(chapterKey({ id: '', volume: 3, number: 4 })).toBe('v3_ch4');
        expect(chapterKey({ number: '7' })).toBe('v_ch7');
        expect(chapterKey(null)).toBe('v_ch');
    });
});

describe('sortChapters', () => {
    it('Sorts by volume, then by number, without changing the given array', () => {
        const chapters = [
            { volume: '2', number: '1' },
            { volume: '10', number: '1' },
            { volume: '1', number: '10' },
            { volume: '1', number: '2.5' },
            { volume: '1', number: '2' }
        ];
        const copy = [...chapters];
        const sorted = sortChapters(chapters);
        expect(sorted.map(ch => `${ch.volume}/${ch.number}`)).toEqual(['1/2', '1/2.5', '1/10', '2/1', '10/1']);
        expect(chapters).toEqual(copy);
        expect(sorted).not.toBe(chapters);
    });

    it('Treats missing, empty and non-numeric volumes and numbers as 0', () => {
        const sorted = sortChapters([
            { volume: '1', number: '2' },
            { volume: 'NaN', number: '3' },
            { volume: '', number: 'x' },
            { volume: undefined, number: undefined },
            { volume: '1', number: 'NaN' }
        ]);
        expect(sorted.map(ch => `${ch.volume}/${ch.number}`))
            .toEqual(['/x', 'undefined/undefined', 'NaN/3', '1/NaN', '1/2']);
    });
});

describe('filterByBranch', () => {
    const chapters = [
        { id: 1, branches: [{ branch_id: 5 }, { branch_id: 9 }] },
        { id: 2, branches: [{ branch_id: 9 }] },
        { id: 3 },
        { id: 4, branches: [{ branch_id: 5 }] }
    ];

    it('Returns the list as is without a branch', () => {
        expect(filterByBranch(chapters, null)).toBe(chapters);
        expect(filterByBranch(chapters, undefined)).toBe(chapters);
    });

    it('Keeps the chapters of the branch and marks them with it', () => {
        expect(filterByBranch(chapters, 5)).toEqual([
            { ...chapters[0], branchId: 5 },
            { ...chapters[3], branchId: 5 }
        ]);
        expect(chapters[0].branchId).toBeUndefined();
        expect(filterByBranch(chapters, 1)).toEqual([]);
    });
});

describe('selectRange', () => {
    const chapters = [
        { id: 10, volume: '1', number: '1' },
        { volume: '1', number: '2' },
        { id: 12, volume: '2', number: '3' }
    ];

    it('Returns all chapters without a range', () => {
        expect(selectRange(chapters, null)).toBe(chapters);
    });

    it('Selects the chapters between the keys, both included', () => {
        expect(selectRange(chapters, { fromKey: '10', toKey: 'v1_ch2' })).toEqual(chapters.slice(0, 2));
        expect(selectRange(chapters, { fromKey: 'v1_ch2', toKey: 'v1_ch2' })).toEqual([chapters[1]]);
        expect(selectRange(chapters, { fromKey: 10, toKey: 12 })).toEqual(chapters);
    });

    it('Throws a clear error for an unknown key or a reversed range', () => {
        expect(() => selectRange(chapters, { fromKey: '0', toKey: '12' })).toThrow('Выбранные главы не найдены');
        expect(() => selectRange(chapters, { fromKey: '10', toKey: '99' })).toThrow('Выбранные главы не найдены');
        expect(() => selectRange(chapters, { fromKey: '12', toKey: '10' })).toThrow('Начало диапазона глав позже его конца');
    });
});
