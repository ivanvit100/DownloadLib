import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadBrowserApi() {
    vi.resetModules();
    return import('../../core/BrowserApi.js');
}

function clearBrowserGlobals() {
    delete global.browser;
    delete global.chrome;
    if (typeof window !== 'undefined') {
        delete window.browser;
        delete window.chrome;
    }
}

describe('BrowserApi', () => {
    beforeEach(() => {
        clearBrowserGlobals();
    });

    it('Uses browser native api when available', async () => {
        const browserApi = {
            runtime: { sendMessage: async () => ({ ok: true }) },
            tabs: { query: async () => [] },
            windows: { getCurrent: async () => ({}) }
        };
        global.browser = browserApi;

        const { extensionApi, browserEnv } = await loadBrowserApi();

        expect(extensionApi).toBe(browserApi);
        expect(browserEnv).toEqual({
            nativeName: 'browser',
            isFirefox: true,
            isChromium: false,
            supportsDnr: false
        });
    });

    it('Uses the chrome namespace as is (MV3 chrome.* methods already return promises)', async () => {
        const chromeApi = {
            runtime: { sendMessage: vi.fn(async () => ({ ok: true })) },
            declarativeNetRequest: { updateDynamicRules: () => {} }
        };
        global.chrome = chromeApi;

        const { extensionApi, browserEnv } = await loadBrowserApi();

        expect(extensionApi).toBe(chromeApi);
        await expect(extensionApi.runtime.sendMessage({ a: 1 })).resolves.toEqual({ ok: true });
        expect(browserEnv).toEqual({
            nativeName: 'chrome',
            isFirefox: false,
            isChromium: true,
            supportsDnr: true
        });
    });

    it('Prefers browser over chrome when both namespaces exist', async () => {
        const browserApi = { runtime: {} };
        global.browser = browserApi;
        global.chrome = { runtime: {}, declarativeNetRequest: {} };

        const { extensionApi, browserEnv } = await loadBrowserApi();

        expect(extensionApi).toBe(browserApi);
        expect(browserEnv.nativeName).toBe('browser');
        expect(browserEnv.isFirefox).toBe(false);
        expect(browserEnv.isChromium).toBe(true);
    });

    it('Returns null api and default env when no browser globals exist', async () => {
        const { extensionApi, browserEnv } = await loadBrowserApi();

        expect(extensionApi).toBeNull();
        expect(browserEnv).toEqual({
            nativeName: 'none',
            isFirefox: false,
            isChromium: false,
            supportsDnr: false
        });
    });

    it('Detects firefox mode from browser presence when dnr is not supported', async () => {
        global.browser = { runtime: {} };
        global.chrome = { runtime: {}, tabs: {}, windows: {}, downloads: {}, storage: {} };

        const { browserEnv } = await loadBrowserApi();

        expect(browserEnv.supportsDnr).toBe(false);
        expect(browserEnv.isFirefox).toBe(true);
        expect(browserEnv.isChromium).toBe(false);
    });

    describe('setServiceTab / fetchViaTab', () => {
        async function setupWithBrowser(browserApi) {
            clearBrowserGlobals();
            global.browser = browserApi;
            return loadBrowserApi();
        }

        it('fetchViaTab returns null when scripting API is absent', async () => {
            const api = await setupWithBrowser({ runtime: {}, tabs: { query: async () => [] } });
            expect(await api.fetchViaTab('https://example.com/img.jpg', 'mangalib')).toBeNull();
        });

        it('fetchViaTab returns null when no tab found', async () => {
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'x', contentType: 'image/jpeg' } }]);
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [] },
                scripting: { executeScript }
            });
            expect(await api.fetchViaTab('https://example.com/img.jpg', 'mangalib')).toBeNull();
            expect(executeScript).not.toHaveBeenCalled();
        });

        it('fetchViaTab uses ranobelib URL pattern for ranobelib service', async () => {
            const tabsQuery = vi.fn(async ({ url }) => url[0].includes('ranobelib') ? [{ id: 5 }] : []);
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'xyz', contentType: 'image/png' } }]);
            const api = await setupWithBrowser({ runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } });
            const result = await api.fetchViaTab('https://cdn.example.com/img.jpg', 'ranobelib');
            expect(tabsQuery).toHaveBeenCalledWith({ url: ['*://ranobelib.me/*'] });
            expect(result).toEqual({ ok: true, base64: 'xyz', contentType: 'image/png' });
        });

        it('fetchViaTab uses mangalib URL patterns for other services', async () => {
            const tabsQuery = vi.fn(async () => [{ id: 3 }]);
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'abc', contentType: 'image/jpeg' } }]);
            const api = await setupWithBrowser({ runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } });
            await api.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib');
            expect(tabsQuery).toHaveBeenCalledWith({ url: ['*://mangalib.me/*', '*://mangalib.org/*'] });
        });

        it('fetchViaTab caches found tab ID for subsequent calls', async () => {
            const tabsQuery = vi.fn(async () => [{ id: 9 }]);
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'r', contentType: 'image/jpeg' } }]);
            const api = await setupWithBrowser({ runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } });
            await api.fetchViaTab('https://cdn.example.com/a.jpg', 'mangalib');
            await api.fetchViaTab('https://cdn.example.com/b.jpg', 'mangalib');
            expect(tabsQuery).toHaveBeenCalledTimes(1);
            expect(executeScript).toHaveBeenCalledTimes(2);
        });

        it('fetchViaTab returns null and warns when tabs.query throws', async () => {
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => { throw new Error('tabs error'); } },
                scripting: { executeScript: vi.fn() }
            });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(await api.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib')).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith('[BrowserApi] tabs.query failed:', 'tabs error');
            warnSpy.mockRestore();
        });

        it('fetchViaTab returns null and warns when executeScript throws', async () => {
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [{ id: 7 }] },
                scripting: { executeScript: async () => { throw new Error('script error'); } }
            });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            expect(await api.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib')).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith('[BrowserApi] fetchViaTab failed:', 'script error');
            warnSpy.mockRestore();
        });

        it('fetchViaTab returns null when executeScript returns no result', async () => {
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [{ id: 8 }] },
                scripting: { executeScript: async () => null }
            });
            expect(await api.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib')).toBeNull();
        });

        it('setServiceTab causes fetchViaTab to skip tabs.query', async () => {
            const tabsQuery = vi.fn(async () => []);
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'c', contentType: 'image/jpeg' } }]);
            const api = await setupWithBrowser({ runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } });
            api.setServiceTab(42);
            const result = await api.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib');
            expect(tabsQuery).not.toHaveBeenCalled();
            expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 42 } }));
            expect(result).toEqual({ ok: true, base64: 'c', contentType: 'image/jpeg' });
        });

        it('fetchViaTab re-queries when cached tab has expired', async () => {
            const tabsQuery = vi.fn(async () => [{ id: 77 }]);
            const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'e', contentType: 'image/jpeg' } }]);
            const api = await setupWithBrowser({ runtime: {}, tabs: { query: tabsQuery }, scripting: { executeScript } });

            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(0);
            api.setServiceTab(50);
            nowSpy.mockReturnValue(3600001);

            await api.fetchViaTab('https://cdn.example.com/img.jpg', 'ranobelib');
            expect(tabsQuery).toHaveBeenCalledTimes(1);
            nowSpy.mockRestore();
        });

        describe('fetchViaTab plugin service hosts', () => {
            it('resolves tab patterns from custom_plugins storage for a plugin serviceKey', async () => {
                const storageGet = vi.fn(async () => ({
                    custom_plugins: [
                        { service: 'hlib', hosts: ['hentailib.me', 'hentailib.org'], enabled: true }
                    ]
                }));
                const tabsQuery = vi.fn(async () => [{ id: 11 }]);
                const executeScript = vi.fn(async () => [{ result: { ok: true, base64: 'p', contentType: 'image/png' } }]);
                const api = await setupWithBrowser({
                    runtime: {},
                    tabs: { query: tabsQuery },
                    scripting: { executeScript },
                    storage: { local: { get: storageGet } }
                });
                const result = await api.fetchViaTab('https://img3h.hentaicdn.org/a.png', 'hlib');
                expect(storageGet).toHaveBeenCalledWith('custom_plugins');
                expect(tabsQuery).toHaveBeenCalledWith({ url: ['*://hentailib.me/*', '*://hentailib.org/*'] });
                expect(result).toEqual({ ok: true, base64: 'p', contentType: 'image/png' });
            });

            it('returns null without querying tabs when the plugin is not found in storage', async () => {
                const storageGet = vi.fn(async () => ({ custom_plugins: [] }));
                const tabsQuery = vi.fn(async () => [{ id: 1 }]);
                const api = await setupWithBrowser({
                    runtime: {},
                    tabs: { query: tabsQuery },
                    scripting: { executeScript: vi.fn() },
                    storage: { local: { get: storageGet } }
                });
                const result = await api.fetchViaTab('https://img3h.hentaicdn.org/a.png', 'hlib');
                expect(result).toBeNull();
                expect(tabsQuery).not.toHaveBeenCalled();
            });

            it('returns null when storage has no custom_plugins key at all', async () => {
                const storageGet = vi.fn(async () => ({}));
                const tabsQuery = vi.fn(async () => [{ id: 1 }]);
                const api = await setupWithBrowser({
                    runtime: {},
                    tabs: { query: tabsQuery },
                    scripting: { executeScript: vi.fn() },
                    storage: { local: { get: storageGet } }
                });
                const result = await api.fetchViaTab('https://img3h.hentaicdn.org/a.png', 'hlib');
                expect(result).toBeNull();
                expect(tabsQuery).not.toHaveBeenCalled();
            });

            it('ignores a matching plugin entry that is disabled', async () => {
                const storageGet = vi.fn(async () => ({
                    custom_plugins: [{ service: 'hlib', hosts: ['hentailib.me'], enabled: false }]
                }));
                const api = await setupWithBrowser({
                    runtime: {},
                    tabs: { query: vi.fn() },
                    scripting: { executeScript: vi.fn() },
                    storage: { local: { get: storageGet } }
                });
                const result = await api.fetchViaTab('https://img3h.hentaicdn.org/a.png', 'hlib');
                expect(result).toBeNull();
            });

            it('returns null when storage API is unavailable for a plugin serviceKey', async () => {
                const api = await setupWithBrowser({
                    runtime: {},
                    tabs: { query: vi.fn() },
                    scripting: { executeScript: vi.fn() }
                });
                const result = await api.fetchViaTab('https://img3h.hentaicdn.org/a.png', 'hlib');
                expect(result).toBeNull();
            });

            it('returns null and swallows the error when storage.local.get throws', async () => {
                const storageGet = vi.fn().mockRejectedValue(new Error('storage error'));
                const api = await setupWithBrowser({
                    runtime: {},
                    tabs: { query: vi.fn() },
                    scripting: { executeScript: vi.fn() },
                    storage: { local: { get: storageGet } }
                });
                const result = await api.fetchViaTab('https://img3h.hentaicdn.org/a.png', 'hlib');
                expect(result).toBeNull();
            });
        });

        describe('fetchViaTab inner func (fetch-to-base64)', () => {
            let capturedFunc;

            beforeEach(async () => {
                const api = await setupWithBrowser({
                    runtime: {},
                    tabs: { query: async () => [{ id: 1 }] },
                    scripting: {
                        executeScript: async ({ func }) => {
                            capturedFunc = func;
                            return [{ result: null }];
                        }
                    }
                });
                await api.fetchViaTab('https://cdn.example.com/img.jpg', 'mangalib');
            });

            afterEach(() => {
                vi.unstubAllGlobals();
            });

            it('returns null when fetch response is not ok', async () => {
                vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
                expect(await capturedFunc('https://example.com/img.jpg')).toBeNull();
            });

            it('returns base64 result using blob contentType', async () => {
                vi.stubGlobal('fetch', vi.fn(async () => ({
                    ok: true,
                    blob: async () => ({ type: 'image/png' })
                })));
                vi.stubGlobal('FileReader', vi.fn(function () {
                    this.readAsDataURL = function () {
                        this.result = 'data:image/png;base64,abc123';
                        this.onloadend && this.onloadend();
                    };
                }));
                const result = await capturedFunc('https://example.com/img.jpg');
                expect(result).toEqual({ ok: true, base64: 'abc123', contentType: 'image/png' });
            });

            it('falls back to image/jpeg when blob.type is empty', async () => {
                vi.stubGlobal('fetch', vi.fn(async () => ({
                    ok: true,
                    blob: async () => ({ type: '' })
                })));
                vi.stubGlobal('FileReader', vi.fn(function () {
                    this.readAsDataURL = function () {
                        this.result = 'data:image/jpeg;base64,def456';
                        this.onloadend && this.onloadend();
                    };
                }));
                const result = await capturedFunc('https://example.com/img.jpg');
                expect(result).toEqual({ ok: true, base64: 'def456', contentType: 'image/jpeg' });
            });

            it('returns null when fetch throws (catch branch)', async () => {
                vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network fail'); }));
                expect(await capturedFunc('https://example.com/img.jpg')).toBeNull();
            });
        });
    });

    describe('requestViaTab / hasServiceTab', () => {
        async function setupWithBrowser(browserApi) {
            clearBrowserGlobals();
            global.browser = browserApi;
            return loadBrowserApi();
        }

        it('hasServiceTab returns false when scripting API is absent', async () => {
            const api = await setupWithBrowser({ runtime: {}, tabs: { query: async () => [] } });
            expect(await api.hasServiceTab('mangalib')).toBe(false);
        });

        it('hasServiceTab returns false when no tab found', async () => {
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [] },
                scripting: { executeScript: vi.fn() }
            });
            expect(await api.hasServiceTab('mangalib')).toBe(false);
        });

        it('hasServiceTab returns true when a tab is found', async () => {
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [{ id: 3 }] },
                scripting: { executeScript: vi.fn() }
            });
            expect(await api.hasServiceTab('mangalib')).toBe(true);
        });

        it('requestViaTab returns noTab:true when scripting API is absent', async () => {
            const api = await setupWithBrowser({ runtime: {}, tabs: { query: async () => [] } });
            expect(await api.requestViaTab('https://api.example.com/x', {}, 'mangalib'))
                .toEqual({ ok: false, noTab: true });
        });

        it('requestViaTab returns noTab:true when no tab found', async () => {
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [] },
                scripting: { executeScript: vi.fn() }
            });
            expect(await api.requestViaTab('https://api.example.com/x', {}, 'mangalib'))
                .toEqual({ ok: false, noTab: true });
        });

        it('requestViaTab returns the tab result with noTab:false on success', async () => {
            const executeScript = vi.fn(async () => [{
                result: { ok: true, status: 200, text: '{"a":1}', retryAfter: null }
            }]);
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [{ id: 4 }] },
                scripting: { executeScript }
            });
            const result = await api.requestViaTab('https://api.example.com/x', { method: 'GET' }, 'mangalib');
            expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
                target: { tabId: 4 },
                args: ['https://api.example.com/x', { method: 'GET' }]
            }));
            expect(result).toEqual({ ok: true, status: 200, text: '{"a":1}', retryAfter: null, noTab: false });
        });

        it('requestViaTab defaults options to {} when not provided', async () => {
            const executeScript = vi.fn(async () => [{ result: { ok: true, status: 200, text: '' } }]);
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [{ id: 4 }] },
                scripting: { executeScript }
            });
            await api.requestViaTab('https://api.example.com/x', undefined, 'mangalib');
            expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
                args: ['https://api.example.com/x', {}]
            }));
        });

        it('requestViaTab returns an error result when executeScript yields no result', async () => {
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [{ id: 5 }] },
                scripting: { executeScript: async () => [{ result: null }] }
            });
            const result = await api.requestViaTab('https://api.example.com/x', {}, 'mangalib');
            expect(result).toEqual({ ok: false, noTab: false, error: 'No result from tab' });
        });

        it('requestViaTab returns an error and warns when executeScript throws', async () => {
            const api = await setupWithBrowser({
                runtime: {},
                tabs: { query: async () => [{ id: 6 }] },
                scripting: { executeScript: async () => { throw new Error('script boom'); } }
            });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const result = await api.requestViaTab('https://api.example.com/x', {}, 'mangalib');
            expect(result).toEqual({ ok: false, noTab: false, error: 'Error: script boom' });
            expect(warnSpy).toHaveBeenCalledWith('[BrowserApi] requestViaTab failed:', 'script boom');
            warnSpy.mockRestore();
        });

        describe('requestViaTab inner func (fetch-to-text)', () => {
            let capturedFunc;

            beforeEach(async () => {
                const api = await setupWithBrowser({
                    runtime: {},
                    tabs: { query: async () => [{ id: 1 }] },
                    scripting: {
                        executeScript: async ({ func }) => {
                            capturedFunc = func;
                            return [{ result: { ok: true, status: 200, text: '' } }];
                        }
                    }
                });
                await api.requestViaTab('https://api.example.com/x', {}, 'mangalib');
            });

            afterEach(() => {
                vi.unstubAllGlobals();
            });

            it('returns ok/status/text/retryAfter on success', async () => {
                vi.stubGlobal('fetch', vi.fn(async () => ({
                    ok: true,
                    status: 200,
                    text: async () => '{"a":1}',
                    headers: { get: () => '7' }
                })));
                const result = await capturedFunc('https://api.example.com/x', {});
                expect(result).toEqual({ ok: true, status: 200, text: '{"a":1}', retryAfter: '7' });
            });

            it('returns ok:false with error when fetch throws', async () => {
                vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network fail'); }));
                const result = await capturedFunc('https://api.example.com/x', {});
                expect(result).toEqual({ ok: false, status: 0, text: '', error: 'Error: network fail' });
            });
        });
    });
});

describe('extensionOrigin / isExtensionUrl', () => {
    beforeEach(() => {
        clearBrowserGlobals();
    });

    it.each([
        ['moz-extension://uuid/', 'moz-extension://uuid'],
        ['chrome-extension://abcdef/', 'chrome-extension://abcdef']
    ])('Takes the origin from runtime.getURL(%s) without URL.origin', async (base, origin) => {
        global.browser = { runtime: { getURL: path => `${base}${path}` } };
        const { extensionOrigin } = await loadBrowserApi();
        expect(extensionOrigin()).toBe(origin);
    });

    it('Returns null without a runtime', async () => {
        const { extensionOrigin, isExtensionUrl } = await loadBrowserApi();
        expect(extensionOrigin()).toBeNull();
        expect(isExtensionUrl('moz-extension://uuid/popup.html')).toBe(false);
    });

    it('Accepts only pages of this extension', async () => {
        global.browser = { runtime: { getURL: path => `moz-extension://uuid/${path}` } };
        const { isExtensionUrl } = await loadBrowserApi();
        expect(isExtensionUrl('moz-extension://uuid/popup.html?download=true')).toBe(true);
        expect(isExtensionUrl('moz-extension://uuid.evil/popup.html')).toBe(false);
        expect(isExtensionUrl('moz-extension://other/popup.html')).toBe(false);
        expect(isExtensionUrl('https://mangalib.me/')).toBe(false);
        expect(isExtensionUrl('null')).toBe(false);
        expect(isExtensionUrl(undefined)).toBe(false);
    });
});
