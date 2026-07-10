import { describe, it, expect, beforeEach, vi } from 'vitest';

function setupDOM() {
    document.body.innerHTML = `
        <div id="translatorContainer" style="display:none;">
            <select id="translatorSelect"></select>
        </div>
        <div id="chapterRangeContainer" style="display:none;"></div>
        <select id="chapterFromSelect"></select>
        <select id="chapterToSelect"></select>
    `;
}

beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    await import('../../ui/ChapterController.js');
});

function makeChapters(n = 3) {
    return Array.from({ length: n }, (_, i) => ({
        volume: 1, number: i + 1,
        branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }]
    }));
}

describe('ChapterController', () => {
    it('registers on global', () => {
        expect(global.ChapterController).toBeDefined();
    });

    describe('loadAndPopulate', () => {
        it('returns chapter count and populates selects', async () => {
            const chapters = makeChapters(3);
            const svc = { fetchChaptersList: vi.fn(async () => ({ data: chapters })) };
            const cc = new global.ChapterController();
            const result = await cc.loadAndPopulate(svc, 'my-slug', null, null);
            expect(result).toBe(3);
            expect(document.getElementById('chapterFromSelect').options.length).toBe(3);
            expect(document.getElementById('chapterToSelect').options.length).toBe(3);
            expect(document.getElementById('chapterRangeContainer').style.display).toBe('block');
        });

        it('sets fromSelect and toSelect values when chapterFromUrl and chapterToUrl are not null', async () => {
            const chapters = makeChapters(3);
            const svc = { fetchChaptersList: vi.fn(async () => ({ data: chapters })) };
            const cc = new global.ChapterController();
            await cc.loadAndPopulate(svc, 'my-slug', '0', '2');
            expect(document.getElementById('chapterFromSelect').value).toBe('0');
            expect(document.getElementById('chapterToSelect').value).toBe('2');
        });

        it('sets toSelect.selectedIndex to last chapter when URLs are null', async () => {
            const chapters = makeChapters(3);
            const svc = { fetchChaptersList: vi.fn(async () => ({ data: chapters })) };
            const cc = new global.ChapterController();
            await cc.loadAndPopulate(svc, 'my-slug', null, null);
            expect(document.getElementById('chapterToSelect').selectedIndex).toBe(2);
        });

        it('hides translatorContainer when chapters have single branch', async () => {
            const chapters = makeChapters(2);
            const svc = { fetchChaptersList: vi.fn(async () => ({ data: chapters })) };
            const cc = new global.ChapterController();
            await cc.loadAndPopulate(svc, 'slug', null, null);
            expect(document.getElementById('translatorContainer').style.display).toBe('none');
        });

        it('returns null and logs warn when fetchChaptersList throws', async () => {
            const warnSpy = vi.spyOn(console, 'warn');
            const svc = { fetchChaptersList: vi.fn(async () => { throw new Error('network fail'); }) };
            const cc = new global.ChapterController();
            const result = await cc.loadAndPopulate(svc, 'slug', null, null);
            expect(result).toBeNull();
            expect(warnSpy).toHaveBeenCalledWith('[ChapterController] Failed to fetch chapters:', expect.any(Error));
            warnSpy.mockRestore();
        });

        it('returns 0 when chaptersData has no data field', async () => {
            const svc = { fetchChaptersList: vi.fn(async () => ({})) };
            const cc = new global.ChapterController();
            const result = await cc.loadAndPopulate(svc, 'slug', null, null);
            expect(result).toBe(0);
        });

        it('does not show chapterRangeContainer when selects are missing', async () => {
            document.body.innerHTML = '<div id="translatorContainer"><select id="translatorSelect"></select></div><div id="chapterRangeContainer"></div>';
            const chapters = makeChapters(2);
            const svc = { fetchChaptersList: vi.fn(async () => ({ data: chapters })) };
            const cc = new global.ChapterController();
            await cc.loadAndPopulate(svc, 'slug', null, null);
            expect(document.getElementById('chapterRangeContainer').style.display).toBe('');
        });

        it('shows translator selector and filters chapters with multiple branches', async () => {
            const chapters = [
                { volume: 1, number: 1, branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] },
                { volume: 1, number: 2, branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }] }
            ];
            const svc = { fetchChaptersList: vi.fn(async () => ({ data: chapters })) };
            const cc = new global.ChapterController();
            await cc.loadAndPopulate(svc, 'slug', null, null);
            expect(document.getElementById('translatorContainer').style.display).toBe('block');
            expect(document.getElementById('translatorSelect').options.length).toBe(2);
        });

        it('restores branchId from URL when multiple branches', async () => {
            const chapters = [
                { volume: 1, number: 1, branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] },
            ];
            const svc = { fetchChaptersList: vi.fn(async () => ({ data: chapters })) };
            const cc = new global.ChapterController();
            await cc.loadAndPopulate(svc, 'slug', null, null, '2');
            expect(document.getElementById('translatorSelect').value).toBe('2');
        });
    });

    describe('_setupTranslatorSelector', () => {
        it('returns null and hides container when no branches in chapters', async () => {
            const cc = new global.ChapterController();
            cc._allChapters = [{ volume: 1, number: 1 }];
            const chapters = [{ volume: 1, number: 1 }];
            const result = cc._setupTranslatorSelector(chapters, null);
            expect(result).toBeNull();
            expect(document.getElementById('translatorContainer').style.display).toBe('none');
        });

        it('hides container and returns branchId when only one branch', async () => {
            const cc = new global.ChapterController();
            const chapters = [{ branches: [{ branch_id: 42, teams: [{ name: 'Solo' }] }] }];
            const result = cc._setupTranslatorSelector(chapters, null);
            expect(result).toBe(42);
            expect(document.getElementById('translatorContainer').style.display).toBe('none');
        });

        it('uses fallback name when branch has no teams', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 10 }, { branch_id: 20 }] }
            ];
            cc._setupTranslatorSelector(chapters, null);
            const opts = document.getElementById('translatorSelect').options;
            expect(opts[0].textContent).toBe('Перевод 10');
            expect(opts[1].textContent).toBe('Перевод 20');
        });

        it('returns null when translatorContainer is missing', () => {
            document.body.innerHTML = '';
            const cc = new global.ChapterController();
            const chapters = [{ branches: [{ branch_id: 1, teams: [] }, { branch_id: 2, teams: [] }] }];
            expect(cc._setupTranslatorSelector(chapters, null)).toBeNull();
        });

        it('translatorSelect.onchange repopulates selects', async () => {
            const chapters = [
                { volume: 1, number: 1, branches: [{ branch_id: 1, teams: [{ name: 'A' }] }, { branch_id: 2, teams: [{ name: 'B' }] }] },
                { volume: 1, number: 2, branches: [{ branch_id: 1, teams: [{ name: 'A' }] }] }
            ];
            const svc = { fetchChaptersList: vi.fn(async () => ({ data: chapters })) };
            const cc = new global.ChapterController();
            await cc.loadAndPopulate(svc, 'slug', null, null);
            const sel = document.getElementById('translatorSelect');
            sel.value = '2';
            sel.onchange();
            expect(document.getElementById('chapterFromSelect').options.length).toBe(1);
        });
    });

    describe('getFilteredChapters', () => {
        it('returns chapters matching the branchId', () => {
            const cc = new global.ChapterController();
            cc._allChapters = [
                { branches: [{ branch_id: 1 }] },
                { branches: [{ branch_id: 2 }] },
                { branches: [{ branch_id: 1 }, { branch_id: 2 }] }
            ];
            expect(cc.getFilteredChapters(1).length).toBe(2);
            expect(cc.getFilteredChapters(2).length).toBe(2);
        });

        it('returns empty array for unknown branchId', () => {
            const cc = new global.ChapterController();
            cc._allChapters = [{ branches: [{ branch_id: 1 }] }];
            expect(cc.getFilteredChapters(99)).toHaveLength(0);
        });
    });

    describe('repopulateSelects', () => {
        it('fills both selects with options', () => {
            const cc = new global.ChapterController();
            const fromSelect = document.getElementById('chapterFromSelect');
            const toSelect = document.getElementById('chapterToSelect');
            const chapters = [
                { volume: 1, number: 1 },
                { volume: 2, number: 5 }
            ];
            cc.repopulateSelects(chapters, fromSelect, toSelect);
            expect(fromSelect.options.length).toBe(2);
            expect(toSelect.options.length).toBe(2);
            expect(fromSelect.options[0].textContent).toBe('Том 1, Глава 1');
            expect(toSelect.options[1].textContent).toBe('Том 2, Глава 5');
        });
    });

    it('attaches to self when window is undefined', async () => {
        vi.resetModules();
        const originalWindow = global.window;
        delete global.window;
        global.self = global;
        await import('../../ui/ChapterController.js');
        expect(global.self.ChapterController).toBeDefined();
        global.window = originalWindow;
    });
});
