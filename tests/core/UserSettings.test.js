import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    DEFAULT_MAX_CHAPTERS, DEFAULT_MAX_SIZE_MB, MAX_CHAPTERS_KEY, MAX_SIZE_KEY, PART_LIMIT_CHAPTERS,
    PART_LIMIT_MODE_KEY, PART_LIMIT_SIZE, RANGE_MODE_CHAPTERS, RANGE_MODE_KEY, RANGE_MODE_VOLUMES,
    readPartLimit, readPartLimitMode, readRangeMode, settingsStorage
} from '../../core/UserSettings.js';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('core/UserSettings', () => {
    it('Keeps the keys of the settings saved by earlier versions', () => {
        expect([MAX_SIZE_KEY, MAX_CHAPTERS_KEY, PART_LIMIT_MODE_KEY, RANGE_MODE_KEY]).toEqual([
            'manga_parser_max_size_mb', 'manga_parser_max_chapters',
            'manga_parser_part_limit_mode', 'manga_parser_range_mode'
        ]);
        expect([DEFAULT_MAX_SIZE_MB, DEFAULT_MAX_CHAPTERS]).toEqual([200, 50]);
    });

    it('Stores the settings in localStorage', () => {
        settingsStorage.set(MAX_SIZE_KEY, 300);
        expect(localStorage.getItem(MAX_SIZE_KEY)).toBe('300');
    });

    describe('readPartLimitMode', () => {
        it.each([
            [null, PART_LIMIT_SIZE],
            ['size', PART_LIMIT_SIZE],
            ['chapters', PART_LIMIT_CHAPTERS],
            ['bogus', PART_LIMIT_SIZE]
        ])('Reads the stored mode %s as %s', (stored, mode) => {
            if (stored !== null) localStorage.setItem(PART_LIMIT_MODE_KEY, stored);
            expect(readPartLimitMode()).toBe(mode);
        });
    });

    describe('readRangeMode', () => {
        it.each([
            [null, RANGE_MODE_CHAPTERS],
            ['chapters', RANGE_MODE_CHAPTERS],
            ['volumes', RANGE_MODE_VOLUMES],
            ['bogus', RANGE_MODE_CHAPTERS]
        ])('Reads the stored mode %s as %s', (stored, mode) => {
            if (stored !== null) localStorage.setItem(RANGE_MODE_KEY, stored);
            expect(readRangeMode()).toBe(mode);
        });
    });

    describe('readPartLimit', () => {
        it('Limits parts by the default size when nothing is stored', () => {
            expect(readPartLimit()).toEqual({ maxSizeMB: 200, maxChapters: 0 });
        });

        it('Limits parts by the stored size and ignores the stored number of chapters in the size mode', () => {
            localStorage.setItem(MAX_SIZE_KEY, '300');
            localStorage.setItem(MAX_CHAPTERS_KEY, '10');
            expect(readPartLimit()).toEqual({ maxSizeMB: 300, maxChapters: 0 });
        });

        it('Limits parts by the stored number of chapters in the chapters mode', () => {
            localStorage.setItem(PART_LIMIT_MODE_KEY, 'chapters');
            localStorage.setItem(MAX_CHAPTERS_KEY, '10');
            expect(readPartLimit()).toEqual({ maxSizeMB: 200, maxChapters: 10 });
        });

        it('Uses the defaults for values that are not numbers', () => {
            localStorage.setItem(PART_LIMIT_MODE_KEY, 'chapters');
            localStorage.setItem(MAX_SIZE_KEY, 'x');
            localStorage.setItem(MAX_CHAPTERS_KEY, 'y');
            expect(readPartLimit()).toEqual({ maxSizeMB: 200, maxChapters: 50 });
        });
    });
});
