/**
 * DownloadLib ui module
 * Manages chapter list loading, translator branch selection, and chapter selects population
 * @module ui/ChapterController
 * @license MIT
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function(global) {
    console.log('[ChapterController] Loading...');

    class ChapterController {
        constructor() {
            this._allChapters = [];
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
                            toSelect.selectedIndex = filteredChapters.length - 1;

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
            for (const ch of chapters) {
                if (!ch.branches) continue;
                for (const branch of ch.branches) {
                    if (!branchMap.has(branch.branch_id)) {
                        const teamName = (branch.teams && branch.teams[0] && branch.teams[0].name)
                            ? branch.teams[0].name
                            : `Перевод ${branch.branch_id}`;
                        branchMap.set(branch.branch_id, teamName);
                    }
                }
            }

            if (branchMap.size <= 1) {
                translatorContainer.style.display = 'none';
                return branchMap.size === 1 ? [...branchMap.keys()][0] : null;
            }

            translatorSelect.innerHTML = '';
            for (const [id, name] of branchMap) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = name;
                translatorSelect.appendChild(opt);
            }

            const initialBranchId = branchIdFromUrl != null && branchMap.has(Number(branchIdFromUrl))
                ? Number(branchIdFromUrl)
                : [...branchMap.keys()][0];
            translatorSelect.value = initialBranchId;

            translatorSelect.onchange = () => {
                const selectedBranchId = parseInt(translatorSelect.value);
                const filtered = this.getFilteredChapters(selectedBranchId);
                const fromSelect = document.getElementById('chapterFromSelect');
                const toSelect = document.getElementById('chapterToSelect');
                if (fromSelect && toSelect) {
                    this.repopulateSelects(filtered, fromSelect, toSelect);
                    toSelect.selectedIndex = filtered.length - 1;
                }
            };

            translatorContainer.style.display = 'block';
            return initialBranchId;
        }

        getFilteredChapters(branchId) {
            return this._allChapters.filter(
                ch => ch.branches && ch.branches.some(b => b.branch_id === branchId)
            );
        }

        repopulateSelects(filteredChapters, fromSelect, toSelect) {
            fromSelect.innerHTML = '';
            toSelect.innerHTML = '';
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
    }

    global.ChapterController = ChapterController;
    console.log('[ChapterController] Loaded');
})(typeof window !== 'undefined' ? window : self);
