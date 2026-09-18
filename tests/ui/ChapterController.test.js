import { describe, it, expect, beforeEach, vi } from 'vitest';

function setupDOM() {
    document.body.innerHTML = `
        <div id="translatorContainer" style="display:none;">
            <select id="translatorSelect"></select>
            <div id="translatorDropdown" class="translator-dropdown">
                <button type="button" id="translatorDropdownTrigger" aria-haspopup="listbox" aria-expanded="false">
                    <span id="translatorDropdownLabel"></span>
                </button>
                <div id="translatorDropdownList" role="listbox" hidden></div>
            </div>
        </div>
        <div id="chapterRangeContainer" style="display:none;"></div>
        <select id="chapterFromSelect"></select>
        <select id="chapterToSelect"></select>
    `;
}

beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
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

        it('sets toSelect.selectedIndex to the last volume option when range mode is "volumes"', async () => {
            localStorage.setItem('manga_parser_range_mode', 'volumes');
            const chapters = [
                { volume: 1, number: 1, branches: [{ branch_id: 1, teams: [{ name: 'A' }] }] },
                { volume: 1, number: 2, branches: [{ branch_id: 1, teams: [{ name: 'A' }] }] },
                { volume: 2, number: 1, branches: [{ branch_id: 1, teams: [{ name: 'A' }] }] }
            ];
            const svc = { fetchChaptersList: vi.fn(async () => ({ data: chapters })) };
            const cc = new global.ChapterController();
            await cc.loadAndPopulate(svc, 'my-slug', null, null);
            const toSelect = document.getElementById('chapterToSelect');
            expect(toSelect.options.length).toBe(2);
            expect(toSelect.selectedIndex).toBe(1);
            expect(toSelect.value).toBe('2');
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
            expect(opts[0].dataset.top).toBe('true');
            expect(opts[1].dataset.top).toBe('true');
        });

        it('marks only the branch with the most translated chapters and auto-selects it', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] },
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }] },
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }] }
            ];
            const result = cc._setupTranslatorSelector(chapters, null);
            const opts = document.getElementById('translatorSelect').options;
            expect(opts[0].textContent).toBe('Team A');
            expect(opts[0].dataset.top).toBe('true');
            expect(opts[1].textContent).toBe('Team B');
            expect(opts[1].dataset.top).toBeUndefined();
            expect(result).toBe(1);
            expect(document.getElementById('translatorSelect').value).toBe('1');
        });

        it('marks all tied branches when they have the same number of translated chapters', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }] },
                { branches: [{ branch_id: 2, teams: [{ name: 'Team B' }] }] }
            ];
            cc._setupTranslatorSelector(chapters, null);
            const opts = document.getElementById('translatorSelect').options;
            expect(opts[0].dataset.top).toBe('true');
            expect(opts[1].dataset.top).toBe('true');
        });

        it('renders the crown+TOP SVG badge for the top option in the custom dropdown list and trigger label', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] },
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }] }
            ];
            cc._setupTranslatorSelector(chapters, null);

            const list = document.getElementById('translatorDropdownList');
            const items = list.querySelectorAll('.translator-dropdown-option');
            expect(items.length).toBe(2);
            expect(items[0].querySelector('.translator-top-badge svg')).not.toBeNull();
            expect(items[0].textContent).toContain('ТОП');
            expect(items[0].textContent).toContain('Team A');
            expect(items[1].querySelector('.translator-top-badge')).toBeNull();

            const label = document.getElementById('translatorDropdownLabel');
            expect(label.querySelector('.translator-top-badge svg')).not.toBeNull();
            expect(label.textContent).toContain('Team A');
        });

        it('clicking a custom dropdown option selects it, fires change and closes the dropdown', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] },
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }] }
            ];
            cc._setupTranslatorSelector(chapters, null);

            const select = document.getElementById('translatorSelect');
            const wrap = document.getElementById('translatorDropdown');
            const list = document.getElementById('translatorDropdownList');
            const items = list.querySelectorAll('.translator-dropdown-option');

            wrap.dataset.open = 'true';
            items[1].click();

            expect(select.value).toBe('2');
            expect(wrap.dataset.open).toBe('false');
            expect(list.hidden).toBe(true);
            expect(items[1].classList.contains('active')).toBe(true);
            expect(items[0].classList.contains('active')).toBe(false);
        });

        it('trigger click toggles the dropdown open state', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] }
            ];
            cc._setupTranslatorSelector(chapters, null);

            const trigger = document.getElementById('translatorDropdownTrigger');
            const wrap = document.getElementById('translatorDropdown');
            const list = document.getElementById('translatorDropdownList');

            trigger.click();
            expect(wrap.dataset.open).toBe('true');
            expect(list.hidden).toBe(false);
            expect(trigger.getAttribute('aria-expanded')).toBe('true');

            trigger.click();
            expect(wrap.dataset.open).toBe('false');
            expect(list.hidden).toBe(true);
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
        });

        it('Escape key closes the dropdown and refocuses the trigger', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] }
            ];
            cc._setupTranslatorSelector(chapters, null);

            const trigger = document.getElementById('translatorDropdownTrigger');
            const wrap = document.getElementById('translatorDropdown');
            wrap.dataset.open = 'true';
            document.getElementById('translatorDropdownList').hidden = false;

            wrap.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

            expect(wrap.dataset.open).toBe('false');
            expect(document.activeElement).toBe(trigger);
        });

        it('focusout to an element inside the dropdown keeps it open', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] }
            ];
            cc._setupTranslatorSelector(chapters, null);

            const wrap = document.getElementById('translatorDropdown');
            const list = document.getElementById('translatorDropdownList');
            wrap.dataset.open = 'true';
            list.hidden = false;

            wrap.dispatchEvent(new FocusEvent('focusout', { relatedTarget: list.firstElementChild, bubbles: true }));

            expect(wrap.dataset.open).toBe('true');
        });

        it('keydown with a non-Escape key does not close the dropdown', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] }
            ];
            cc._setupTranslatorSelector(chapters, null);

            const wrap = document.getElementById('translatorDropdown');
            wrap.dataset.open = 'true';
            document.getElementById('translatorDropdownList').hidden = false;

            wrap.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

            expect(wrap.dataset.open).toBe('true');
        });

        it('focusout to an element outside the dropdown closes it', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] }
            ];
            cc._setupTranslatorSelector(chapters, null);

            const wrap = document.getElementById('translatorDropdown');
            wrap.dataset.open = 'true';
            document.getElementById('translatorDropdownList').hidden = false;

            wrap.dispatchEvent(new FocusEvent('focusout', { relatedTarget: document.body, bubbles: true }));

            expect(wrap.dataset.open).toBe('false');
        });

        it('does not build the custom dropdown when its DOM elements are missing', async () => {
            const cc = new global.ChapterController();
            document.getElementById('translatorDropdown').remove();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] }
            ];
            expect(() => cc._setupTranslatorSelector(chapters, null)).not.toThrow();
        });

        it('_syncTranslatorDropdown is a no-op when its DOM elements are missing', () => {
            const cc = new global.ChapterController();
            document.getElementById('translatorDropdownLabel').remove();
            const select = document.getElementById('translatorSelect');
            expect(() => cc._syncTranslatorDropdown(select)).not.toThrow();
        });

        it('_toggleTranslatorDropdown is a no-op when the dropdown wrapper is missing', () => {
            const cc = new global.ChapterController();
            document.getElementById('translatorDropdown').remove();
            expect(() => cc._toggleTranslatorDropdown()).not.toThrow();
        });

        it('_openTranslatorDropdown is a no-op when its DOM elements are missing', () => {
            const cc = new global.ChapterController();
            document.getElementById('translatorDropdownTrigger').remove();
            expect(() => cc._openTranslatorDropdown()).not.toThrow();
        });

        it('_closeTranslatorDropdown is a no-op when its DOM elements are missing', () => {
            const cc = new global.ChapterController();
            document.getElementById('translatorDropdownList').remove();
            expect(() => cc._closeTranslatorDropdown()).not.toThrow();
        });

        it('_syncTranslatorDropdown clears the label when the select has no selected option', () => {
            const cc = new global.ChapterController();
            const select = document.getElementById('translatorSelect');
            select.innerHTML = '';
            cc._syncTranslatorDropdown(select);
            const label = document.getElementById('translatorDropdownLabel');
            expect(label.children.length).toBe(0);
            expect(label.textContent).toBe('');
        });

        it('does not rebind trigger/wrap listeners when the dropdown is set up a second time', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }, { branch_id: 2, teams: [{ name: 'Team B' }] }] }
            ];
            cc._setupTranslatorSelector(chapters, null);
            cc._setupTranslatorSelector(chapters, null);

            const wrap = document.getElementById('translatorDropdown');
            const trigger = document.getElementById('translatorDropdownTrigger');
            expect(wrap.dataset.bound).toBe('true');

            trigger.click();
            expect(wrap.dataset.open).toBe('true');
            trigger.click();
            expect(wrap.dataset.open).toBe('false');
        });

        it('explicit branchIdFromUrl still overrides the auto-selected longest translation', async () => {
            const cc = new global.ChapterController();
            const chapters = [
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }] },
                { branches: [{ branch_id: 1, teams: [{ name: 'Team A' }] }] },
                { branches: [{ branch_id: 2, teams: [{ name: 'Team B' }] }] }
            ];
            const result = cc._setupTranslatorSelector(chapters, '2');
            expect(result).toBe(2);
            expect(document.getElementById('translatorSelect').value).toBe('2');
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

        it('groups by volume when range mode is "volumes"', () => {
            localStorage.setItem('manga_parser_range_mode', 'volumes');
            const cc = new global.ChapterController();
            const fromSelect = document.getElementById('chapterFromSelect');
            const toSelect = document.getElementById('chapterToSelect');
            const chapters = [
                { volume: 1, number: 1 },
                { volume: 1, number: 2 },
                { volume: 2, number: 1 },
                { volume: 2, number: 2 },
                { volume: 2, number: 3 }
            ];
            cc.repopulateSelects(chapters, fromSelect, toSelect);

            expect(fromSelect.options.length).toBe(2);
            expect(toSelect.options.length).toBe(2);
            expect(fromSelect.options[0].textContent).toBe('Том 1');
            expect(fromSelect.options[0].value).toBe('0');
            expect(fromSelect.options[1].value).toBe('2');
            expect(toSelect.options[0].value).toBe('1');
            expect(toSelect.options[1].textContent).toBe('Том 2');
            expect(toSelect.options[1].value).toBe('4');
        });

        it('falls back to volume "1" when chapter.volume is null in volume mode', () => {
            localStorage.setItem('manga_parser_range_mode', 'volumes');
            const cc = new global.ChapterController();
            const fromSelect = document.getElementById('chapterFromSelect');
            const toSelect = document.getElementById('chapterToSelect');
            cc.repopulateSelects([{ volume: null, number: 1 }], fromSelect, toSelect);
            expect(fromSelect.options[0].textContent).toBe('Том 1');
        });
    });

    describe('_getRangeMode', () => {
        it('defaults to "chapters" when nothing stored', () => {
            const cc = new global.ChapterController();
            expect(cc._getRangeMode()).toBe('chapters');
        });

        it('returns "volumes" when stored', () => {
            localStorage.setItem('manga_parser_range_mode', 'volumes');
            const cc = new global.ChapterController();
            expect(cc._getRangeMode()).toBe('volumes');
        });

        it('falls back to "chapters" for an unrecognized stored value', () => {
            localStorage.setItem('manga_parser_range_mode', 'bogus');
            const cc = new global.ChapterController();
            expect(cc._getRangeMode()).toBe('chapters');
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
