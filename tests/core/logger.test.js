import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let logger;

beforeEach(async () => {
    vi.resetModules();
    logger = await import('../../core/logger.js');
    for (const level of ['debug', 'info', 'warn', 'error']) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('logger', () => {
    it('Starts at the level of the test environment, warn by default in the extension', () => {
        expect(logger.DEFAULT_LOG_LEVEL).toBe('warn');
        expect(logger.LOG_LEVEL_KEY).toBe('downloadlib_log_level');
        expect(logger.getLogLevel()).toBe('debug');
    });

    it('Prefixes messages with the scope and writes them with the console method of their level', () => {
        const log = logger.createLogger('Scope');
        const error = new Error('boom');
        log.debug('Loading...');
        log.info('Value:', 5);
        log.warn('Failed', error);
        log.error({ code: 1 });
        expect(console.debug).toHaveBeenCalledWith('[Scope] Loading...');
        expect(console.info).toHaveBeenCalledWith('[Scope] Value:', 5);
        expect(console.warn).toHaveBeenCalledWith('[Scope] Failed', error);
        expect(console.error).toHaveBeenCalledWith('[Scope]', { code: 1 });
    });

    it('Drops messages below the current level', () => {
        const log = logger.createLogger('Scope');
        logger.setLogLevel('warn');
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        expect(console.debug).not.toHaveBeenCalled();
        expect(console.info).not.toHaveBeenCalled();
        expect(console.warn).toHaveBeenCalledWith('[Scope] w');
        expect(console.error).toHaveBeenCalledWith('[Scope] e');

        logger.setLogLevel('error');
        log.warn('w2');
        expect(console.warn).toHaveBeenCalledTimes(1);
    });

    it('Falls back to the initial level for an empty or unknown level', () => {
        logger.setLogLevel('error');
        logger.setLogLevel('verbose');
        expect(logger.getLogLevel()).toBe('debug');
        logger.setLogLevel('info');
        logger.setLogLevel(undefined);
        expect(logger.getLogLevel()).toBe('debug');
        logger.setLogLevel('toString');
        expect(logger.getLogLevel()).toBe('debug');
    });

    it('Reads the level from storage.local and follows its changes', async () => {
        let onChanged;
        const api = {
            storage: {
                local: { get: vi.fn(async () => ({ downloadlib_log_level: 'error' })) },
                onChanged: { addListener: vi.fn(listener => { onChanged = listener; }) }
            }
        };
        await logger.watchLogLevel(api);
        expect(api.storage.local.get).toHaveBeenCalledWith('downloadlib_log_level');
        expect(logger.getLogLevel()).toBe('error');

        onChanged({ downloadlib_log_level: { newValue: 'info' } }, 'local');
        expect(logger.getLogLevel()).toBe('info');
        onChanged({ downloadlib_log_level: { newValue: 'warn' } }, 'session');
        onChanged({ other: { newValue: 'warn' } }, 'local');
        expect(logger.getLogLevel()).toBe('info');
        onChanged({ downloadlib_log_level: {} }, 'local');
        expect(logger.getLogLevel()).toBe('debug');
    });

    it('Keeps the level without storage and when reading it fails', async () => {
        await expect(logger.watchLogLevel(null)).resolves.toBeUndefined();
        await expect(logger.watchLogLevel({ storage: {} })).resolves.toBeUndefined();
        const failing = { storage: { local: { get: vi.fn(async () => { throw new Error('no access'); }) } } };
        await logger.watchLogLevel(failing);
        expect(logger.getLogLevel()).toBe('debug');
        expect(console.debug).toHaveBeenCalledWith('[Logger] Failed to read the log level:', expect.any(Error));
    });
});
