import { describe, it, expect, beforeEach, vi } from 'vitest';

function setupDOM() {
    document.body.innerHTML = `
        <div id="historyList" style="display:none;"></div>
        <div id="historyEmpty" style="display:none;"></div>
        <button id="clearHistoryBtn" style="display:none;"></button>
        <button id="backBtn"></button>
        <div id="logoInfo"></div>
    `;
}

beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    global.browser = { tabs: { create: vi.fn() } };
    global.chrome = undefined;
    global.DownloadHistory = { getAll: vi.fn(() => []), clear: vi.fn() };
    global.popupController = null;
    delete global.getExtensionApi;
    await import('../../ui/HistoryController.js');
});

describe('HistoryController', () => {
    describe('_render — empty history', () => {
        it('hides list, shows empty message, hides clearBtn', () => {
            global.HistoryController.init();
            expect(document.getElementById('historyList').style.display).toBe('none');
            expect(document.getElementById('historyEmpty').style.display).toBe('block');
            expect(document.getElementById('clearHistoryBtn').style.display).toBe('none');
        });

        it('handles missing DOM elements without throwing', () => {
            document.body.innerHTML = '<div></div>';
            expect(() => global.HistoryController.init()).not.toThrow();
        });
    });

    describe('_render — non-empty history', () => {
        it('shows list, hides empty, shows clearBtn and appends cards', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'My Novel', slug: 'novel', service: 'ranobelib',
                format: 'epub', downloadedAt: Date.now()
            }]);
            global.HistoryController.init();
            expect(document.getElementById('historyList').style.display).toBe('flex');
            expect(document.getElementById('historyEmpty').style.display).toBe('none');
            expect(document.getElementById('clearHistoryBtn').style.display).toBe('block');
            expect(document.querySelector('.history-card')).not.toBeNull();
        });
    });

    describe('_createCard', () => {
        it('uses fallback color #ff9100 for unknown service', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'X', slug: 's', service: 'unknown',
                format: 'pdf', downloadedAt: Date.now()
            }]);
            global.HistoryController.init();
            const card = document.querySelector('.history-card');
            expect(card.style.borderLeftColor).toBe('rgb(255, 145, 0)');
        });

        it('uppercases unknown format', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'X', slug: 's', service: 'ranobelib',
                format: 'xyz', downloadedAt: Date.now()
            }]);
            global.HistoryController.init();
            expect(document.getElementById('historyList').innerHTML).toContain('XYZ');
        });

        it('uses slug as title when title is missing', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                slug: 'my-slug', service: 'ranobelib', format: 'fb2', downloadedAt: Date.now()
            }]);
            global.HistoryController.init();
            expect(document.querySelector('.history-card-title').textContent).toBe('my-slug');
        });

        it('adds click handler that opens ranobelib URL when tabs API is available', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'Test', slug: 'test-slug', service: 'ranobelib',
                format: 'epub', downloadedAt: Date.now()
            }]);
            global.HistoryController.init();
            document.querySelector('.history-card-title').click();
            expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://ranobelib.me/ru/book/test-slug' });
        });

        it('opens mangalib URL for mangalib service', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'Manga', slug: 'manga-slug', service: 'mangalib',
                format: 'fb2', downloadedAt: Date.now()
            }]);
            global.HistoryController.init();
            document.querySelector('.history-card-title').click();
            expect(global.browser.tabs.create).toHaveBeenCalledWith({ url: 'https://mangalib.me/ru/manga/manga-slug' });
        });

        it('does not add click handler when browserAPI has no tabs', async () => {
            vi.resetModules();
            setupDOM();
            global.browser = {};
            global.chrome = undefined;
            global.DownloadHistory = { getAll: vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'epub', downloadedAt: Date.now()
            }]), clear: vi.fn() };
            global.popupController = null;
            delete global.getExtensionApi;
            await import('../../ui/HistoryController.js');
            global.HistoryController.init();
            const titleEl = document.querySelector('.history-card-title');
            expect(titleEl.classList.contains('history-card-title--link')).toBe(false);
        });

        it('shows chapter range when chapterFrom and chapterTo differ', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'fb2',
                downloadedAt: Date.now(), chapterFrom: 'Ch 1', chapterTo: 'Ch 5'
            }]);
            global.HistoryController.init();
            expect(document.getElementById('historyList').innerHTML).toContain('Ch 1 — Ch 5');
        });

        it('shows single chapter when chapterFrom equals chapterTo', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'fb2',
                downloadedAt: Date.now(), chapterFrom: 'Ch 3', chapterTo: 'Ch 3'
            }]);
            global.HistoryController.init();
            const html = document.getElementById('historyList').innerHTML;
            expect(html).toContain('Ch 3');
            expect(html).not.toContain('Ch 3 — Ch 3');
        });

        it('uses dash when chapterFrom is null but chapterTo is set', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'fb2',
                downloadedAt: Date.now(), chapterFrom: null, chapterTo: 'Ch 5'
            }]);
            global.HistoryController.init();
            expect(document.getElementById('historyList').innerHTML).toContain('— — Ch 5');
        });

        it('shows translator row when translator is set', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'fb2',
                downloadedAt: Date.now(), translator: 'Team Alpha'
            }]);
            global.HistoryController.init();
            expect(document.getElementById('historyList').innerHTML).toContain('Перевод: Team Alpha');
        });
    });

    describe('_bindEvents', () => {
        it('backBtn clears logoInfo and calls popupController._restoreMainView', () => {
            global.popupController = { _restoreMainView: vi.fn() };
            global.HistoryController.init();
            document.getElementById('backBtn').click();
            expect(document.getElementById('logoInfo').textContent).toBe('');
            expect(global.popupController._restoreMainView).toHaveBeenCalled();
        });

        it('backBtn logs error when popupController is not set', () => {
            const errorSpy = vi.spyOn(console, 'error');
            global.HistoryController.init();
            document.getElementById('backBtn').click();
            expect(errorSpy).toHaveBeenCalledWith('[HistoryController] popupController not found');
            errorSpy.mockRestore();
        });

        it('backBtn skips logoInfo clear when logoInfo is null', () => {
            global.popupController = { _restoreMainView: vi.fn() };
            document.getElementById('logoInfo').remove();
            expect(() => {
                global.HistoryController.init();
                document.getElementById('backBtn').click();
            }).not.toThrow();
        });

        it('clearBtn calls DownloadHistory.clear and re-renders', () => {
            global.DownloadHistory.getAll = vi.fn()
                .mockReturnValueOnce([{ title: 'T', slug: 's', service: 'ranobelib', format: 'fb2', downloadedAt: Date.now() }])
                .mockReturnValue([]);
            global.HistoryController.init();
            document.getElementById('clearHistoryBtn').click();
            expect(global.DownloadHistory.clear).toHaveBeenCalled();
            expect(document.getElementById('historyEmpty').style.display).toBe('block');
        });

        it('handles missing backBtn and clearBtn gracefully', () => {
            document.body.innerHTML = '<div id="historyList"></div><div id="historyEmpty"></div>';
            expect(() => global.HistoryController.init()).not.toThrow();
        });
    });

    it('uses getExtensionApi when available', async () => {
        vi.resetModules();
        setupDOM();
        const fakeApi = { tabs: { create: vi.fn() } };
        global.getExtensionApi = vi.fn(() => fakeApi);
        global.browser = undefined;
        global.chrome = undefined;
        global.DownloadHistory = { getAll: vi.fn(() => [{
            title: 'T', slug: 's', service: 'ranobelib', format: 'epub', downloadedAt: Date.now()
        }]), clear: vi.fn() };
        global.popupController = null;
        await import('../../ui/HistoryController.js');
        global.HistoryController.init();
        expect(global.getExtensionApi).toHaveBeenCalled();
        document.querySelector('.history-card-title').click();
        expect(fakeApi.tabs.create).toHaveBeenCalled();
        delete global.getExtensionApi;
    });

    it('uses chrome API when browser is not defined', async () => {
        vi.resetModules();
        setupDOM();
        global.browser = undefined;
        global.chrome = { tabs: { create: vi.fn() } };
        global.DownloadHistory = { getAll: vi.fn(() => [{
            title: 'T', slug: 's', service: 'mangalib', format: 'fb2', downloadedAt: Date.now()
        }]), clear: vi.fn() };
        global.popupController = null;
        delete global.getExtensionApi;
        await import('../../ui/HistoryController.js');
        global.HistoryController.init();
        document.querySelector('.history-card-title').click();
        expect(global.chrome.tabs.create).toHaveBeenCalled();
    });

    it('uses null browserAPI when no browser, chrome, or getExtensionApi', async () => {
        vi.resetModules();
        setupDOM();
        global.browser = undefined;
        global.chrome = undefined;
        delete global.getExtensionApi;
        global.DownloadHistory = { getAll: vi.fn(() => []), clear: vi.fn() };
        global.popupController = null;
        await import('../../ui/HistoryController.js');
        expect(() => global.HistoryController.init()).not.toThrow();
    });

    it('handles null list/empty/clearBtn in non-empty render branch', async () => {
        document.body.innerHTML = '<button id="backBtn"></button>';
        global.DownloadHistory.getAll = vi.fn(() => [{
            title: 'T', slug: 's', service: 'ranobelib', format: 'epub', downloadedAt: Date.now()
        }]);
        expect(() => global.HistoryController.init()).not.toThrow();
    });

    it('uses chapterTo fallback dash when chapterFrom is set but chapterTo is null', () => {
        global.DownloadHistory.getAll = vi.fn(() => [{
            title: 'T', slug: 's', service: 'ranobelib', format: 'fb2',
            downloadedAt: Date.now(), chapterFrom: 'Ch 1', chapterTo: null
        }]);
        global.HistoryController.init();
        expect(document.getElementById('historyList').innerHTML).toContain('Ch 1 — —');
    });

    it('attaches to self when window is undefined', async () => {
        vi.resetModules();
        setupDOM();
        const originalWindow = global.window;
        delete global.window;
        global.self = global;
        global.browser = { tabs: { create: vi.fn() } };
        global.DownloadHistory = { getAll: vi.fn(() => []), clear: vi.fn() };
        global.popupController = null;
        await import('../../ui/HistoryController.js');
        expect(global.self.HistoryController).toBeDefined();
        global.window = originalWindow;
    });
});
