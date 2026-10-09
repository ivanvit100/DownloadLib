import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SESSION_KEY = 'downloadlib_auth_tokens';

const base64url = value => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const makeJwt = payload => `${base64url({ alg: 'HS256' })}.${base64url(payload)}.signature`;
const inSeconds = s => Math.floor(Date.now() / 1000) + s;

const LIVE = makeJwt({ sub: '1', exp: inSeconds(3600) });
const OTHER = makeJwt({ sub: '2', exp: inSeconds(3600) });
const EXPIRED = makeJwt({ sub: '1', exp: inSeconds(-60) });

let session;
let store;

/**
 * Загружает модуль заново с фейковым storage.session.
 * @param {object} [initial] - Начальное содержимое storage.session.
 * @param {{noSession?: boolean}} [options] - Без storage.session.
 * @returns {Promise<void>}
 */
async function load(initial = {}, { noSession = false } = {}) {
    vi.resetModules();
    session = {
        data: { ...initial },
        get: vi.fn(async key => ({ [key]: session.data[key] })),
        set: vi.fn(async obj => { Object.assign(session.data, obj); })
    };
    globalThis.browser = noSession ? { storage: {} } : { storage: { session } };
    store = await import('../../background/tokenStore.js');
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.browser;
});

describe('jwtExpiry / isTokenUsable', () => {
    beforeEach(() => load());

    it('Reads exp of a JWT in milliseconds', () => {
        const exp = inSeconds(100);
        expect(store.jwtExpiry(makeJwt({ exp }))).toBe(exp * 1000);
    });

    it('Returns null for tokens without a readable exp', () => {
        expect(store.jwtExpiry(makeJwt({ sub: '1' }))).toBeNull();
        expect(store.jwtExpiry('opaque-token')).toBeNull();
        expect(store.jwtExpiry('a.!!!.c')).toBeNull();
        expect(store.jwtExpiry(null)).toBeNull();
    });

    it('Accepts live tokens and tokens without exp', () => {
        expect(store.isTokenUsable(LIVE)).toBe(true);
        expect(store.isTokenUsable('opaque-token')).toBe(true);
    });

    it('Rejects expired tokens, tokens about to expire and non-strings', () => {
        expect(store.isTokenUsable(EXPIRED)).toBe(false);
        expect(store.isTokenUsable(makeJwt({ exp: inSeconds(10) }))).toBe(false);
        expect(store.isTokenUsable('')).toBe(false);
        expect(store.isTokenUsable(undefined)).toBe(false);
    });
});

describe('tokenStore', () => {
    it('Stores tokens per service without overwriting other services', async () => {
        await load();
        expect(await store.setToken('mangalib', LIVE)).toBe(true);
        expect(await store.setToken('hlib', OTHER)).toBe(true);
        expect(await store.getToken('mangalib')).toBe(LIVE);
        expect(await store.getToken('hlib')).toBe(OTHER);
        expect(await store.getToken('ranobelib')).toBeNull();
    });

    it('Reports whether the stored token changed', async () => {
        await load();
        expect(await store.setToken('mangalib', LIVE)).toBe(true);
        expect(await store.setToken('mangalib', LIVE)).toBe(false);
    });

    it('Does not store expired tokens or tokens without a service', async () => {
        await load();
        expect(await store.setToken('mangalib', EXPIRED)).toBe(false);
        expect(await store.setToken('', LIVE)).toBe(false);
        expect(await store.getToken('mangalib')).toBeNull();
    });

    it('Keeps tokens in storage.session so they survive a worker restart', async () => {
        await load();
        await store.setToken('mangalib', LIVE);
        await flush();
        expect(session.set).toHaveBeenLastCalledWith({ [SESSION_KEY]: { mangalib: LIVE } });

        await load(session.data);
        expect(await store.getToken('mangalib')).toBe(LIVE);
    });

    it('Drops a token that expired while stored', async () => {
        await load({ [SESSION_KEY]: { mangalib: EXPIRED, hlib: OTHER } });
        expect(await store.getToken('mangalib')).toBeNull();
        await flush();
        expect(session.data[SESSION_KEY]).toEqual({ hlib: OTHER });
    });

    it('invalidate drops the token of the service', async () => {
        await load({ [SESSION_KEY]: { mangalib: LIVE, hlib: OTHER } });
        await store.invalidate('mangalib');
        await flush();
        expect(await store.getToken('mangalib')).toBeNull();
        expect(session.data[SESSION_KEY]).toEqual({ hlib: OTHER });
    });

    it('invalidate of an unknown service does not write the storage', async () => {
        await load();
        await store.invalidate('mangalib');
        await flush();
        expect(session.set).not.toHaveBeenCalled();
    });

    it('Reads storage.session once', async () => {
        await load();
        await store.getToken('a');
        await store.getToken('b');
        expect(session.get).toHaveBeenCalledTimes(1);
    });

    it('Keeps tokens in memory when storage.session is unavailable', async () => {
        await load({}, { noSession: true });
        await store.setToken('mangalib', LIVE);
        await flush();
        expect(await store.getToken('mangalib')).toBe(LIVE);
    });

    it('Warns and keeps working when storage.session fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await load();
        session.get.mockRejectedValue(new Error('read failed'));
        session.set.mockRejectedValue(new Error('write failed'));
        await store.setToken('mangalib', LIVE);
        await flush();
        expect(await store.getToken('mangalib')).toBe(LIVE);
        expect(warn).toHaveBeenCalledWith('[tokenStore] Failed to read session storage:', 'read failed');
        expect(warn).toHaveBeenCalledWith('[tokenStore] Failed to write session storage:', 'write failed');
    });
});
