import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({}));

vi.mock('../../core/BrowserApi.js', async () => (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'extensionApi'));

const TIME = Date.UTC(2026, 10, 14, 17, 3, 11, 123);

let history;
let logger;
let log;
let stored;

/**
 * Хранилище storage.local в памяти.
 * @param {object} [initial] - Начальное содержимое.
 * @returns {{get: Function, set: Function}}
 */
function memoryStorage(initial = {}) {
    stored = { ...initial };
    return {
        get: vi.fn(async key => ({ [key]: stored[key] })),
        set: vi.fn(async items => { Object.assign(stored, items); })
    };
}

/**
 * Ждёт, пока журнал допишет записи в хранилище.
 * @returns {Promise<void>}
 */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Тексты записей журнала в хранилище.
 * @returns {string[]}
 */
const storedTexts = () => (stored.downloadlib_log_history || []).map(entry => entry.text);

beforeEach(async () => {
    vi.resetModules();
    for (const level of ['debug', 'info', 'warn', 'error']) vi.spyOn(console, level).mockImplementation(() => {});
    vi.spyOn(Date, 'now').mockReturnValue(TIME);
    vi.stubGlobal('navigator', {});
    mocks.extensionApi = { storage: { local: memoryStorage() } };
    history = await import('../../core/LogHistory.js');
    logger = await import('../../core/ConsoleLogger.js');
    log = logger.createLogger('Scope');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('startLogHistory()', () => {
    it('saves warnings and errors of all loggers to storage.local', async () => {
        history.startLogHistory();
        log.warn('Slow page:', 3);
        logger.createLogger('Other').error('Failed');
        await settle();
        expect(history.LOG_HISTORY_KEY).toBe('downloadlib_log_history');
        expect(stored.downloadlib_log_history).toEqual([
            { time: TIME, level: 'warn', text: '[Scope] Slow page: 3' },
            { time: TIME, level: 'error', text: '[Other] Failed' }
        ]);
    });

    it('does not save debug and info records', async () => {
        history.startLogHistory();
        log.debug('d');
        log.info('i');
        await settle();
        expect(mocks.extensionApi.storage.local.set).not.toHaveBeenCalled();
    });

    it('saves warnings even when the console shows only errors', async () => {
        history.startLogHistory();
        logger.setLogLevel('error');
        log.warn('hidden in the console');
        await settle();
        expect(console.warn).not.toHaveBeenCalled();
        expect(storedTexts()).toEqual(['[Scope] hidden in the console']);
    });

    it('does not start without storage.local', async () => {
        const get = vi.fn(async () => ({}));
        mocks.extensionApi = { storage: { local: { get } } };
        history.startLogHistory();
        log.error('e');
        await settle();
        expect(get).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith('[Scope] e');
        mocks.extensionApi = null;
        expect(() => history.startLogHistory()).not.toThrow();
    });

    it('keeps only the latest 20 entries after the stored ones', async () => {
        const old = ['a', 'b', 'c'].map(text => ({ time: 1, level: 'warn', text }));
        mocks.extensionApi.storage.local = memoryStorage({ downloadlib_log_history: old });
        history.startLogHistory();
        for (let i = 0; i < 18; i++) log.warn(`w${i}`);
        await settle();
        expect(history.LOG_HISTORY_LIMIT).toBe(20);
        expect(storedTexts()).toEqual(['b', 'c', ...Array.from({ length: 18 }, (_, i) => `[Scope] w${i}`)]);
    });

    it('saves entries logged together in one write', async () => {
        history.startLogHistory();
        log.warn('one');
        log.warn('two');
        log.error('three');
        await settle();
        expect(mocks.extensionApi.storage.local.set).toHaveBeenCalledOnce();
        expect(storedTexts()).toEqual(['[Scope] one', '[Scope] two', '[Scope] three']);
    });

    it('saves entries logged during a write in the next pass', async () => {
        const writes = [];
        const { local } = mocks.extensionApi.storage;
        local.set = vi.fn(items => new Promise(resolve => writes.push(() => {
            Object.assign(stored, items);
            resolve();
        })));
        history.startLogHistory();
        log.warn('first');
        await settle();
        log.warn('second');
        await settle();
        expect(local.set).toHaveBeenCalledOnce();
        writes[0]();
        await settle();
        expect(local.set).toHaveBeenCalledTimes(2);
        writes[1]();
        await settle();
        expect(storedTexts()).toEqual(['[Scope] first', '[Scope] second']);
    });

    it('writes under a Web Lock shared by the extension pages when it is available', async () => {
        const request = vi.fn((name, task) => task());
        vi.stubGlobal('navigator', { locks: { request } });
        history.startLogHistory();
        log.warn('w');
        await settle();
        expect(request).toHaveBeenCalledWith('downloadlib-log-history', expect.any(Function));
        expect(storedTexts()).toEqual(['[Scope] w']);
    });

    it('logs a failed write at debug level only and keeps saving later entries', async () => {
        const { local } = mocks.extensionApi.storage;
        local.set.mockRejectedValueOnce(new Error('quota'));
        history.startLogHistory();
        log.warn('lost');
        await settle();
        expect(console.debug).toHaveBeenCalledWith('[LogHistory] Failed to save the log history:', expect.any(Error));
        expect(local.set).toHaveBeenCalledOnce();
        log.warn('kept');
        await settle();
        expect(storedTexts()).toEqual(['[Scope] kept']);
    });
});

describe('entry text', () => {
    beforeEach(() => {
        history.startLogHistory();
    });

    it('describes errors, objects and other values the way the console shows them', async () => {
        log.warn('Failed:', new TypeError('bad'), { code: 1 }, undefined, null, 42);
        await settle();
        expect(storedTexts()).toEqual(['[Scope] Failed: TypeError: bad {"code":1} undefined null 42']);
    });

    it('falls back to a plain string for objects JSON cannot describe', async () => {
        const circular = {};
        circular.self = circular;
        log.warn('circular', circular);
        await settle();
        expect(storedTexts()).toEqual(['[Scope] circular [object Object]']);
        expect(console.debug).toHaveBeenCalledWith('[LogHistory] Failed to serialize a log argument:', expect.any(TypeError));
    });

    it('masks authorization tokens', async () => {
        log.warn('Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', {
            headers: { Authorization: 'Bearer abc.def-ghi~/+==' }
        });
        await settle();
        expect(storedTexts()).toEqual(['[Scope] Token <token> {"headers":{"Authorization":"Bearer <token>"}}']);
    });

    it('cuts text longer than 500 characters', async () => {
        log.warn('x'.repeat(492));
        log.warn('y'.repeat(600));
        await settle();
        const [exact, long] = storedTexts();
        expect(exact).toBe(`[Scope] ${'x'.repeat(492)}`);
        expect(long).toBe(`[Scope] ${'y'.repeat(492)}...`);
    });
});

describe('readLogHistory()', () => {
    it('returns the stored entries', async () => {
        const entries = [{ time: TIME, level: 'error', text: '[Scope] e' }];
        mocks.extensionApi.storage.local = memoryStorage({ downloadlib_log_history: entries });
        expect(await history.readLogHistory()).toEqual(entries);
        expect(mocks.extensionApi.storage.local.get).toHaveBeenCalledWith('downloadlib_log_history');
    });

    it('returns an empty list without storage.local or saved entries', async () => {
        expect(await history.readLogHistory()).toEqual([]);
        mocks.extensionApi.storage.local = memoryStorage({ downloadlib_log_history: 'broken' });
        expect(await history.readLogHistory()).toEqual([]);
        mocks.extensionApi = { storage: {} };
        expect(await history.readLogHistory()).toEqual([]);
        mocks.extensionApi = null;
        expect(await history.readLogHistory()).toEqual([]);
    });

    it('passes a read error to the caller', async () => {
        mocks.extensionApi.storage.local.get = vi.fn(async () => { throw new Error('denied'); });
        await expect(history.readLogHistory()).rejects.toThrow('denied');
    });
});

describe('formatLogEntry()', () => {
    it('puts the UTC time, the level and the text on one line', () => {
        expect(history.formatLogEntry({ time: TIME, level: 'warn', text: '[Scope] Slow page' }))
            .toBe('2026-11-14T17:03:11.123Z WARN [Scope] Slow page');
    });
});
