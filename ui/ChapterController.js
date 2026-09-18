/**
 * DownloadLib ui module
 * Manages chapter list loading, translator branch selection, and chapter selects population
 * @module ui/ChapterController
 * @license MIT
 * @author ivanvit
 * @version 1.0.10
 */

'use strict';

(function(global) {
    console.log('[ChapterController] Loading...');

    const RANGE_MODE_KEY = 'manga_parser_range_mode';

    class ChapterController {
        constructor() {
            this._allChapters = [];
        }

        _getRangeMode() {
            return localStorage.getItem(RANGE_MODE_KEY) === 'volumes' ? 'volumes' : 'chapters';
        }

        async loadAndPopulate(service, slug, chapterFromUrl, chapterToUrl, branchIdFromUrl = null) {
            try {
                const chaptersData = await service.fetchChaptersList(slug);
                const chapters = chaptersData.data || [];
                this._allChapters = chapters;

                const hasMultipleBranches = chapters.some(ch => ch.branches && ch.branches.length > 1);
                let activeBranchId = null;

                if (hasMultipleBranches)
                    activeBranchId = this._setupTranslatorSelector(chapters, branchIdFromUrl);
                else {
                    const translatorContainer = document.getElementById('translatorContainer');
                    if (translatorContainer) translatorContainer.style.display = 'none';
                }

                const filteredChapters = activeBranchId != null
                    ? this.getFilteredChapters(activeBranchId)
                    : chapters;

                if (filteredChapters.length > 0) {
                    const fromSelect = document.getElementById('chapterFromSelect');
                    const toSelect = document.getElementById('chapterToSelect');
                    const chapterRangeContainer = document.getElementById('chapterRangeContainer');

                    if (fromSelect && toSelect && chapterRangeContainer) {
                        this.repopulateSelects(filteredChapters, fromSelect, toSelect);

                        if (chapterFromUrl !== null && chapterToUrl !== null) {
                            fromSelect.value = chapterFromUrl;
                            toSelect.value = chapterToUrl;
                            console.log(`[ChapterController] Restored chapter range: ${chapterFromUrl} - ${chapterToUrl}`);
                        } else
                            toSelect.selectedIndex = toSelect.options.length - 1;

                        chapterRangeContainer.style.display = 'block';
                    }
                }
                return chapters.length;
            } catch (e) {
                console.warn('[ChapterController] Failed to fetch chapters:', e);
                return null;
            }
        }

        _setupTranslatorSelector(chapters, branchIdFromUrl) {
            const translatorContainer = document.getElementById('translatorContainer');
            const translatorSelect = document.getElementById('translatorSelect');
            if (!translatorContainer || !translatorSelect) return null;

            const branchMap = new Map();
            const chapterCounts = new Map();
            for (const ch of chapters) {
                if (!ch.branches) continue;
                for (const branch of ch.branches) {
                    if (!branchMap.has(branch.branch_id)) {
                        const teamName = (branch.teams && branch.teams[0] && branch.teams[0].name)
                            ? branch.teams[0].name
                            : `Перевод ${branch.branch_id}`;
                        branchMap.set(branch.branch_id, teamName);
                    }
                    chapterCounts.set(branch.branch_id, (chapterCounts.get(branch.branch_id) || 0) + 1);
                }
            }

            if (branchMap.size <= 1) {
                translatorContainer.style.display = 'none';
                return branchMap.size === 1 ? [...branchMap.keys()][0] : null;
            }

            const maxCount = Math.max(...chapterCounts.values());
            const longestBranchId = [...branchMap.keys()].find(id => chapterCounts.get(id) === maxCount);

            translatorSelect.innerHTML = '';
            for (const [id, name] of branchMap) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = name;
                if (chapterCounts.get(id) === maxCount) opt.dataset.top = 'true';
                translatorSelect.appendChild(opt);
            }

            const initialBranchId = branchIdFromUrl != null && branchMap.has(Number(branchIdFromUrl))
                ? Number(branchIdFromUrl)
                : longestBranchId;
            translatorSelect.value = initialBranchId;

            translatorSelect.onchange = () => {
                const selectedBranchId = parseInt(translatorSelect.value);
                const filtered = this.getFilteredChapters(selectedBranchId);
                const fromSelect = document.getElementById('chapterFromSelect');
                const toSelect = document.getElementById('chapterToSelect');
                if (fromSelect && toSelect) {
                    this.repopulateSelects(filtered, fromSelect, toSelect);
                    toSelect.selectedIndex = toSelect.options.length - 1;
                }
            };

            this._setupTranslatorDropdown(translatorSelect);

            translatorContainer.style.display = 'block';
            return initialBranchId;
        }

        _topBadgeSvg() {
            const span = document.createElement('span');
            span.className = 'translator-top-badge';
            span.title = 'Самый длинный перевод';
            span.innerHTML = '<svg viewBox="0 0 24 32" width="20" height="26" aria-hidden="true" focusable="false">' +
                '<path d="M2 17 L2 8 L7 12 L12 3 L17 12 L22 8 L22 17 Z" fill="#ffca28" stroke="#c67c00" ' +
                'stroke-width="1" stroke-linejoin="round"/>' +
                '<circle cx="2" cy="8" r="1.6" fill="#ffe082"/>' +
                '<circle cx="12" cy="3" r="1.8" fill="#ffe082"/>' +
                '<circle cx="22" cy="8" r="1.6" fill="#ffe082"/>' +
                '<rect x="2" y="17" width="20" height="3" rx="1" fill="#ffb300" stroke="#c67c00" stroke-width="0.8"/>' +
                '<text x="12" y="30" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" ' +
                'font-weight="700" fill="#ff9100" letter-spacing="0.5">ТОП</text></svg>';
            return span;
        }

        _setupTranslatorDropdown(selectEl) {
            const wrap = document.getElementById('translatorDropdown');
            const trigger = document.getElementById('translatorDropdownTrigger');
            const list = document.getElementById('translatorDropdownList');
            if (!wrap || !trigger || !list) return;

            list.innerHTML = '';
            Array.from(selectEl.options).forEach(opt => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'translator-dropdown-option';
                item.setAttribute('role', 'option');
                item.dataset.value = opt.value;

                if (opt.dataset.top === 'true') item.appendChild(this._topBadgeSvg());

                const text = document.createElement('span');
                text.textContent = opt.textContent;
                item.appendChild(text);

                item.addEventListener('click', () => {
                    selectEl.value = opt.value;
                    selectEl.dispatchEvent(new Event('change'));
                    this._closeTranslatorDropdown();
                });

                list.appendChild(item);
            });

            if (!wrap.dataset.bound) {
                trigger.addEventListener('click', () => this._toggleTranslatorDropdown());
                wrap.addEventListener('focusout', (e) => {
                    if (!wrap.contains(e.relatedTarget)) this._closeTranslatorDropdown();
                });
                wrap.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        this._closeTranslatorDropdown();
                        trigger.focus();
                    }
                });
                selectEl.addEventListener('change', () => this._syncTranslatorDropdown(selectEl));
                wrap.dataset.bound = 'true';
            }

            this._syncTranslatorDropdown(selectEl);
        }

        _syncTranslatorDropdown(selectEl) {
            const label = document.getElementById('translatorDropdownLabel');
            const list = document.getElementById('translatorDropdownList');
            if (!label || !list) return;

            const selectedOpt = selectEl.options[selectEl.selectedIndex];
            label.innerHTML = '';
            if (selectedOpt) {
                if (selectedOpt.dataset.top === 'true') label.appendChild(this._topBadgeSvg());
                const text = document.createElement('span');
                text.textContent = selectedOpt.textContent;
                label.appendChild(text);
            }

            Array.from(list.children).forEach(item => {
                item.classList.toggle('active', item.dataset.value === selectEl.value);
            });
        }

        _toggleTranslatorDropdown() {
            const wrap = document.getElementById('translatorDropdown');
            if (!wrap) return;
            if (wrap.dataset.open === 'true') this._closeTranslatorDropdown();
            else this._openTranslatorDropdown();
        }

        _openTranslatorDropdown() {
            const wrap = document.getElementById('translatorDropdown');
            const trigger = document.getElementById('translatorDropdownTrigger');
            const list = document.getElementById('translatorDropdownList');
            if (!wrap || !trigger || !list) return;
            wrap.dataset.open = 'true';
            list.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
        }

        _closeTranslatorDropdown() {
            const wrap = document.getElementById('translatorDropdown');
            const trigger = document.getElementById('translatorDropdownTrigger');
            const list = document.getElementById('translatorDropdownList');
            if (!wrap || !trigger || !list) return;
            wrap.dataset.open = 'false';
            list.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
        }

        getFilteredChapters(branchId) {
            return this._allChapters.filter(
                ch => ch.branches && ch.branches.some(b => b.branch_id === branchId)
            );
        }

        repopulateSelects(filteredChapters, fromSelect, toSelect) {
            fromSelect.innerHTML = '';
            toSelect.innerHTML = '';

            if (this._getRangeMode() === 'volumes')
                return this._populateByVolume(filteredChapters, fromSelect, toSelect);

            filteredChapters.forEach((ch, idx) => {
                const label = `Том ${ch.volume}, Глава ${ch.number}`;
                const optFrom = document.createElement('option');
                optFrom.value = idx;
                optFrom.textContent = label;
                fromSelect.appendChild(optFrom);

                const optTo = document.createElement('option');
                optTo.value = idx;
                optTo.textContent = label;
                toSelect.appendChild(optTo);
            });
        }

        _populateByVolume(filteredChapters, fromSelect, toSelect) {
            const volumes = [];
            const firstIndex = new Map();
            const lastIndex = new Map();

            filteredChapters.forEach((ch, idx) => {
                const vol = ch.volume != null ? ch.volume : '1';
                if (!firstIndex.has(vol)) {
                    firstIndex.set(vol, idx);
                    volumes.push(vol);
                }
                lastIndex.set(vol, idx);
            });

            volumes.forEach(vol => {
                const label = `Том ${vol}`;

                const optFrom = document.createElement('option');
                optFrom.value = firstIndex.get(vol);
                optFrom.textContent = label;
                fromSelect.appendChild(optFrom);

                const optTo = document.createElement('option');
                optTo.value = lastIndex.get(vol);
                optTo.textContent = label;
                toSelect.appendChild(optTo);
            });
        }
    }

    global.ChapterController = ChapterController;
    console.log('[ChapterController] Loaded');
})(typeof window !== 'undefined' ? window : self);
