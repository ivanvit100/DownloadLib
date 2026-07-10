import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let StorageClass;

beforeEach(async () => {
    vi.resetModules();
    await import('../../core/Storage.js');
    StorageClass = (typeof window !== 'undefined' ? window : global).Storage;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('Storage', () => {
    describe('constructor / isAvailable', () => {
        it('is available when localStorage works', () => {
            expect(new StorageClass().isAvailable()).toBe(true);
        });

        it('is not available when localStorage.setItem throws', () => {
            vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota'); }, removeItem: vi.fn(), getItem: vi.fn() });
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const s = new StorageClass();
            expect(s.isAvailable()).toBe(false);
            expect(console.warn).toHaveBeenCalledWith('[Storage] localStorage is not available:', expect.any(Error));
        });
    });

    describe('when not available', () => {
        let s;

        beforeEach(() => {
            vi.stubGlobal('localStorage', { setItem: () => { throw new Error('unavail'); }, removeItem: vi.fn(), getItem: vi.fn() });
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            s = new StorageClass();
            vi.unstubAllGlobals();
            vi.restoreAllMocks();
        });

        it('get returns null', () => { expect(s.get('k')).toBeNull(); });
        it('set returns false', () => { expect(s.set('k', 'v')).toBe(false); });
        it('setJSON returns false', () => { expect(s.setJSON('k', {})).toBe(false); });
        it('remove does nothing without throwing', () => { expect(() => s.remove('k')).not.toThrow(); });
    });

    describe('get', () => {
        it('returns stored value', () => {
            const s = new StorageClass();
            localStorage.setItem('testKey', 'hello');
            expect(s.get('testKey')).toBe('hello');
            localStorage.removeItem('testKey');
        });

        it('returns null when key is absent', () => {
            expect(new StorageClass().get('__nonexistent__')).toBeNull();
        });

        it('returns null and warns when localStorage.getItem throws', () => {
            const s = new StorageClass();
            vi.stubGlobal('localStorage', { setItem: vi.fn(), removeItem: vi.fn(), getItem: () => { throw new Error('get fail'); } });
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(s.get('key')).toBeNull();
            expect(console.warn).toHaveBeenCalledWith('[Storage] get failed for key:', 'key', expect.any(Error));
        });
    });

    describe('getJSON', () => {
        it('returns parsed object', () => {
            const s = new StorageClass();
            localStorage.setItem('j', JSON.stringify({ a: 1 }));
            expect(s.getJSON('j')).toEqual({ a: 1 });
            localStorage.removeItem('j');
        });

        it('returns null when key is absent', () => {
            expect(new StorageClass().getJSON('__nonexistent__')).toBeNull();
        });

        it('returns null for invalid JSON', () => {
            const s = new StorageClass();
            localStorage.setItem('bad', 'not{valid');
            expect(s.getJSON('bad')).toBeNull();
            localStorage.removeItem('bad');
        });
    });

    describe('set', () => {
        it('stores value as string and returns true', () => {
            const s = new StorageClass();
            expect(s.set('numKey', 42)).toBe(true);
            expect(localStorage.getItem('numKey')).toBe('42');
            localStorage.removeItem('numKey');
        });

        it('returns false and warns when localStorage.setItem throws', () => {
            const s = new StorageClass();
            vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota'); }, removeItem: vi.fn(), getItem: vi.fn() });
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(s.set('key', 'val')).toBe(false);
            expect(console.warn).toHaveBeenCalledWith('[Storage] set failed for key:', 'key', expect.any(Error));
        });
    });

    describe('setJSON', () => {
        it('serialises value and returns true', () => {
            const s = new StorageClass();
            expect(s.setJSON('arr', [1, 2])).toBe(true);
            expect(JSON.parse(localStorage.getItem('arr'))).toEqual([1, 2]);
            localStorage.removeItem('arr');
        });

        it('returns false and warns when localStorage.setItem throws', () => {
            const s = new StorageClass();
            vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota'); }, removeItem: vi.fn(), getItem: vi.fn() });
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(s.setJSON('key', {})).toBe(false);
            expect(console.warn).toHaveBeenCalledWith('[Storage] setJSON failed for key:', 'key', expect.any(Error));
        });
    });

    describe('remove', () => {
        it('deletes the stored item', () => {
            const s = new StorageClass();
            localStorage.setItem('gone', 'val');
            s.remove('gone');
            expect(localStorage.getItem('gone')).toBeNull();
        });

        it('warns when localStorage.removeItem throws', () => {
            const s = new StorageClass();
            vi.stubGlobal('localStorage', { setItem: vi.fn(), removeItem: () => { throw new Error('rm fail'); }, getItem: vi.fn() });
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            s.remove('key');
            expect(console.warn).toHaveBeenCalledWith('[Storage] remove failed for key:', 'key', expect.any(Error));
        });
    });
});
