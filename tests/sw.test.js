import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let installHandler, activateHandler, fetchHandler;

function setupSelf() {
    global.self = {
        addEventListener: vi.fn((event, handler) => {
            if (event === 'install') installHandler = handler;
            else if (event === 'activate') activateHandler = handler;
            else if (event === 'fetch') fetchHandler = handler;
        }),
        skipWaiting: vi.fn(),
        clients: { claim: vi.fn().mockResolvedValue() },
    };
}

function makeIDBOpen({ openFails = false, getFails = false, resultCode = null, triggerUpgrade = false } = {}) {
    let req = {};
    global.indexedDB = {
        open: vi.fn(() => {
            Promise.resolve().then(() => {
                if (openFails) {
                    req.onerror?.();
                    return;
                }
                if (triggerUpgrade) {
                    const upgradeDb = { createObjectStore: vi.fn() };
                    req.onupgradeneeded?.({ target: { result: upgradeDb } });
                }
                const db = { transaction: null, close: vi.fn() };
                const getReq = {};
                const objectStore = { get: vi.fn(() => getReq) };
                const tx = { objectStore: vi.fn(() => objectStore) };
                db.transaction = vi.fn(() => tx);
                req.onsuccess?.({ target: { result: db } });
                Promise.resolve().then(() => {
                    if (getFails) {
                        getReq.onerror?.();
                    } else {
                        getReq.onsuccess?.({ target: { result: resultCode ? { code: resultCode } : undefined } });
                    }
                });
            });
            return req;
        }),
    };
    return req;
}

beforeEach(async () => {
    vi.resetModules();
    installHandler = activateHandler = fetchHandler = undefined;
    setupSelf();
    await import('../sw.js');
});

afterEach(() => {
    vi.restoreAllMocks();
    delete global.indexedDB;
});

describe('service worker lifecycle', () => {
    it('install event calls self.skipWaiting', () => {
        expect(installHandler).toBeDefined();
        installHandler();
        expect(global.self.skipWaiting).toHaveBeenCalled();
    });

    it('activate event calls clients.claim via waitUntil', () => {
        expect(activateHandler).toBeDefined();
        const waitUntil = vi.fn();
        activateHandler({ waitUntil });
        expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
    });
});

describe('fetch handler non-plugin URL', () => {
    it('returns without calling respondWith for non-plugin paths', () => {
        const respondWith = vi.fn();
        fetchHandler({ request: { url: 'https://example.com/other/path' }, respondWith });
        expect(respondWith).not.toHaveBeenCalled();
    });
});

describe('fetch handler plugin URL - code found', () => {
    it('responds with JS code when IDB has the plugin', async () => {
        makeIDBOpen({ resultCode: 'const x = 1;' });
        const respondWith = vi.fn();
        fetchHandler({ request: { url: 'https://ext/plugin-runtime/fb2.js' }, respondWith });
        await new Promise(r => setTimeout(r, 20));
        expect(respondWith).toHaveBeenCalled();
        const response = await respondWith.mock.calls[0][0];
        expect(response.status).not.toBe(404);
    });
});

describe('fetch handler plugin URL - code not found', () => {
    it('responds with 404 when IDB has no plugin', async () => {
        makeIDBOpen({ resultCode: null });
        const respondWith = vi.fn();
        fetchHandler({ request: { url: 'https://ext/plugin-runtime/epub' }, respondWith });
        await new Promise(r => setTimeout(r, 20));
        expect(respondWith).toHaveBeenCalled();
        const response = await respondWith.mock.calls[0][0];
        expect(response.status).toBe(404);
    });
});

describe('_getPluginFromIDB get.onerror', () => {
    it('resolves null when get request errors', async () => {
        makeIDBOpen({ getFails: true });
        const respondWith = vi.fn();
        fetchHandler({ request: { url: 'https://ext/plugin-runtime/cbz' }, respondWith });
        await new Promise(r => setTimeout(r, 20));
        const response = await respondWith.mock.calls[0][0];
        expect(response.status).toBe(404);
    });
});

describe('_getPluginFromIDB req.onerror (open fails)', () => {
    it('resolves null when indexedDB.open errors', async () => {
        makeIDBOpen({ openFails: true });
        const respondWith = vi.fn();
        fetchHandler({ request: { url: 'https://ext/plugin-runtime/pdf' }, respondWith });
        await new Promise(r => setTimeout(r, 20));
        const response = await respondWith.mock.calls[0][0];
        expect(response.status).toBe(404);
    });
});

describe('_getPluginFromIDB onupgradeneeded', () => {
    it('createObjectStore is called during upgrade', async () => {
        let upgradeDb;
        let req = {};
        global.indexedDB = {
            open: vi.fn(() => {
                Promise.resolve().then(() => {
                    upgradeDb = { createObjectStore: vi.fn() };
                    req.onupgradeneeded?.({ target: { result: upgradeDb } });
                    const db = { transaction: null, close: vi.fn() };
                    const getReq = {};
                    const tx = { objectStore: vi.fn(() => ({ get: vi.fn(() => getReq) })) };
                    db.transaction = vi.fn(() => tx);
                    req.onsuccess?.({ target: { result: db } });
                    Promise.resolve().then(() => {
                        getReq.onsuccess?.({ target: { result: undefined } });
                    });
                });
                return req;
            }),
        };
        const respondWith = vi.fn();
        fetchHandler({ request: { url: 'https://ext/plugin-runtime/test' }, respondWith });
        await new Promise(r => setTimeout(r, 20));
        expect(upgradeDb.createObjectStore).toHaveBeenCalledWith('plugins', { keyPath: 'format' });
    });
});
