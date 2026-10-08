import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mangalibConfig } from '../../services/mangalib/config.js';
import { ranobelibConfig } from '../../services/ranobelib/config.js';

vi.mock('../../core/BrowserApi.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('extensionApi'));
vi.mock('../../core/DownloadHistory.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('DownloadHistory'));
vi.mock('../../services/ServiceRegistry.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('serviceRegistry'));

let HistoryController;

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
    global.extensionApi = { tabs: { create: vi.fn() } };
    global.DownloadHistory = { getAll: vi.fn(() => []), clear: vi.fn() };
    const configs = { mangalib: mangalibConfig, ranobelib: ranobelibConfig };
    global.serviceRegistry = { getService: vi.fn(key => (configs[key] ? { config: configs[key] } : null)) };
    ({ HistoryController } = await import('../../ui/HistoryController.js'));
});

describe('HistoryController', () => {
    describe('_render — empty history', () => {
        it('hides list, shows empty message, hides clearBtn', () => {
            HistoryController.init();
            expect(document.getElementById('historyList').style.display).toBe('none');
            expect(document.getElementById('historyEmpty').style.display).toBe('block');
            expect(document.getElementById('clearHistoryBtn').style.display).toBe('none');
        });

        it('handles missing DOM elements without throwing', () => {
            document.body.innerHTML = '<div></div>';
            expect(() => HistoryController.init()).not.toThrow();
        });
    });

    describe('_render — non-empty history', () => {
        it('shows list, hides empty, shows clearBtn and appends cards', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'My Novel', slug: 'novel', service: 'ranobelib',
                format: 'epub', downloadedAt: Date.now()
            }]);
            HistoryController.init();
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
            HistoryController.init();
            const card = document.querySelector('.history-card');
            expect(card.style.borderLeftColor).toBe('rgb(255, 145, 0)');
        });

        it('uses the primary color of a registered service', () => {
            global.serviceRegistry.getService = vi.fn(key =>
                key === 'mangalib' ? { config: { primaryColor: '#0000ff' } } : null);
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'X', slug: 's', service: 'mangalib',
                format: 'pdf', downloadedAt: Date.now()
            }]);
            HistoryController.init();
            const card = document.querySelector('.history-card');
            expect(card.style.borderLeftColor).toBe('rgb(0, 0, 255)');
        });

        it('uppercases unknown format', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'X', slug: 's', service: 'ranobelib',
                format: 'xyz', downloadedAt: Date.now()
            }]);
            HistoryController.init();
            expect(document.getElementById('historyList').innerHTML).toContain('XYZ');
        });

        it('uses slug as title when title is missing', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                slug: 'my-slug', service: 'ranobelib', format: 'fb2', downloadedAt: Date.now()
            }]);
            HistoryController.init();
            expect(document.querySelector('.history-card-title').textContent).toBe('my-slug');
        });

        it('adds click handler that opens ranobelib URL when tabs API is available', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'Test', slug: 'test-slug', service: 'ranobelib',
                format: 'epub', downloadedAt: Date.now()
            }]);
            HistoryController.init();
            document.querySelector('.history-card-title').click();
            expect(global.extensionApi.tabs.create).toHaveBeenCalledWith({ url: 'https://ranobelib.me/ru/book/test-slug' });
        });

        it('opens mangalib URL for mangalib service', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'Manga', slug: 'manga-slug', service: 'mangalib',
                format: 'fb2', downloadedAt: Date.now()
            }]);
            HistoryController.init();
            document.querySelector('.history-card-title').click();
            expect(global.extensionApi.tabs.create).toHaveBeenCalledWith({ url: 'https://mangalib.me/ru/manga/manga-slug' });
        });

        it('encodes the slug in the title URL', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'Manga', slug: 'a b/c', service: 'mangalib',
                format: 'fb2', downloadedAt: Date.now()
            }]);
            HistoryController.init();
            document.querySelector('.history-card-title').click();
            expect(global.extensionApi.tabs.create).toHaveBeenCalledWith({ url: 'https://mangalib.me/ru/manga/a%20b%2Fc' });
        });

        it('does not link the title of a service without titleUrl', () => {
            global.serviceRegistry.getService = vi.fn(() => ({ config: { name: 'plugin' } }));
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'plugin', format: 'fb2', downloadedAt: Date.now()
            }]);
            HistoryController.init();
            const titleEl = document.querySelector('.history-card-title');
            expect(titleEl.classList.contains('history-card-title--link')).toBe(false);
        });

        it('does not add click handler when the extension api has no tabs', () => {
            global.extensionApi = {};
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'epub', downloadedAt: Date.now()
            }]);
            HistoryController.init();
            const titleEl = document.querySelector('.history-card-title');
            expect(titleEl.classList.contains('history-card-title--link')).toBe(false);
        });

        it('does not add click handler when the extension api is unavailable', () => {
            global.extensionApi = null;
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'epub', downloadedAt: Date.now()
            }]);
            expect(() => HistoryController.init()).not.toThrow();
            const titleEl = document.querySelector('.history-card-title');
            expect(titleEl.classList.contains('history-card-title--link')).toBe(false);
        });

        it('shows chapter range when chapterFrom and chapterTo differ', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'fb2',
                downloadedAt: Date.now(), chapterFrom: 'Ch 1', chapterTo: 'Ch 5'
            }]);
            HistoryController.init();
            expect(document.getElementById('historyList').innerHTML).toContain('Ch 1 — Ch 5');
        });

        it('shows single chapter when chapterFrom equals chapterTo', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'fb2',
                downloadedAt: Date.now(), chapterFrom: 'Ch 3', chapterTo: 'Ch 3'
            }]);
            HistoryController.init();
            const html = document.getElementById('historyList').innerHTML;
            expect(html).toContain('Ch 3');
            expect(html).not.toContain('Ch 3 — Ch 3');
        });

        it('uses dash when chapterFrom is null but chapterTo is set', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'fb2',
                downloadedAt: Date.now(), chapterFrom: null, chapterTo: 'Ch 5'
            }]);
            HistoryController.init();
            expect(document.getElementById('historyList').innerHTML).toContain('— — Ch 5');
        });

        it('uses chapterTo fallback dash when chapterFrom is set but chapterTo is null', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'fb2',
                downloadedAt: Date.now(), chapterFrom: 'Ch 1', chapterTo: null
            }]);
            HistoryController.init();
            expect(document.getElementById('historyList').innerHTML).toContain('Ch 1 — —');
        });

        it('shows translator row when translator is set', () => {
            global.DownloadHistory.getAll = vi.fn(() => [{
                title: 'T', slug: 's', service: 'ranobelib', format: 'fb2',
                downloadedAt: Date.now(), translator: 'Team Alpha'
            }]);
            HistoryController.init();
            expect(document.getElementById('historyList').innerHTML).toContain('Перевод: Team Alpha');
        });
    });

    describe('_bindEvents', () => {
        it('backBtn clears logoInfo and calls onBack', () => {
            const onBack = vi.fn();
            document.getElementById('logoInfo').textContent = 'info';
            HistoryController.init(onBack);
            document.getElementById('backBtn').click();
            expect(document.getElementById('logoInfo').textContent).toBe('');
            expect(onBack).toHaveBeenCalled();
        });

        it('backBtn logs error when onBack is not provided', () => {
            const errorSpy = vi.spyOn(console, 'error');
            HistoryController.init();
            document.getElementById('backBtn').click();
            expect(errorSpy).toHaveBeenCalledWith('[HistoryController] onBack callback not provided');
            errorSpy.mockRestore();
        });

        it('backBtn skips logoInfo clear when logoInfo is null', () => {
            const onBack = vi.fn();
            document.getElementById('logoInfo').remove();
            expect(() => {
                HistoryController.init(onBack);
                document.getElementById('backBtn').click();
            }).not.toThrow();
            expect(onBack).toHaveBeenCalled();
        });

        it('clearBtn calls DownloadHistory.clear and re-renders', () => {
            global.DownloadHistory.getAll = vi.fn()
                .mockReturnValueOnce([{ title: 'T', slug: 's', service: 'ranobelib', format: 'fb2', downloadedAt: Date.now() }])
                .mockReturnValue([]);
            HistoryController.init();
            document.getElementById('clearHistoryBtn').click();
            expect(global.DownloadHistory.clear).toHaveBeenCalled();
            expect(document.getElementById('historyEmpty').style.display).toBe('block');
        });

        it('handles missing backBtn and clearBtn gracefully', () => {
            document.body.innerHTML = '<div id="historyList"></div><div id="historyEmpty"></div>';
            expect(() => HistoryController.init()).not.toThrow();
        });
    });

    it('handles null list/empty/clearBtn in non-empty render branch', () => {
        document.body.innerHTML = '<button id="backBtn"></button>';
        global.DownloadHistory.getAll = vi.fn(() => [{
            title: 'T', slug: 's', service: 'ranobelib', format: 'epub', downloadedAt: Date.now()
        }]);
        expect(() => HistoryController.init()).not.toThrow();
    });
});
