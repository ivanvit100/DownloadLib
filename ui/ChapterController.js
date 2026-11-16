/**
 * DownloadLib ui module
 * Manages chapter list loading, translator branch selection, and chapter selects population
 * @module ui/ChapterController
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { chapterKey, filterByBranch } from '../core/ChapterList.js';
import { createLogger } from '../core/ConsoleLogger.js';
import { $el, createEl } from './DomUtils.js';

const log = createLogger('ChapterController');

const RANGE_MODE_KEY = 'manga_parser_range_mode';

/**
 * Выбирает в select опцию с указанным значением, если она есть.
 * @param {HTMLSelectElement} select - Элемент выбора.
 * @param {string} value - Значение опции.
 * @returns {boolean} true, если опция найдена и выбрана.
 */
function selectOption(select, value) {
    const index = Array.from(select.options).findIndex(opt => opt.value === String(value));
    if (index === -1) return false;
    select.selectedIndex = index;
    return true;
}

/**
 * Загружает список глав тайтла, настраивает выбор переводчика (ветки) и заполняет
 * select-элементы диапазона глав/томов на странице попапа.
 */
export class ChapterController {
    /**
     * Создаёт контроллер с пустым кэшем загруженных глав. rangeNotFound — диапазон
     * из URL не нашёлся в списке глав при последнем loadAndPopulate (выбран весь
     * диапазон, автоматически скачивать его нельзя).
     */
    constructor() {
        this._allChapters = [];
        this.rangeNotFound = false;
    }

    /**
     * Возвращает текущий режим построения диапазона, сохранённый в localStorage.
     * @returns {'chapters'|'volumes'} Режим диапазона: по главам или по томам.
     */
    _getRangeMode() {
        return localStorage.getItem(RANGE_MODE_KEY) === 'volumes' ? 'volumes' : 'chapters';
    }

    /**
     * Все главы тайтла в порядке чтения, загруженные последним loadAndPopulate.
     * Их передают в загрузку, чтобы не запрашивать список повторно.
     * @returns {object[]}
     */
    getChapters() {
        return this._allChapters;
    }

    /**
     * Загружает список глав тайтла у сервиса (в порядке чтения), при наличии
     * нескольких переводов настраивает селектор переводчика и заполняет
     * select-элементы диапазона. Если ключей диапазона из URL нет в списке,
     * выбирает весь диапазон и выставляет rangeNotFound.
     * @param {object} service - Экземпляр сервиса с методом fetchChapters.
     * @param {string} slug - Slug тайтла.
     * @param {?string} chapterFromUrl - Ключ первой главы диапазона из URL (или null).
     * @param {?string} chapterToUrl - Ключ последней главы диапазона из URL (или null).
     * @param {?number} [branchIdFromUrl] - Заранее выбранный id ветки перевода из URL.
     * @returns {Promise<?number>} Количество загруженных глав, либо null при ошибке загрузки.
     */
    async loadAndPopulate(service, slug, chapterFromUrl, chapterToUrl, branchIdFromUrl = null) {
        this.rangeNotFound = false;
        try {
            const chapters = await service.fetchChapters(slug);
            this._allChapters = chapters;

            const hasMultipleBranches = chapters.some(ch => ch.branches && ch.branches.length > 1);
            let activeBranchId = null;

            if (hasMultipleBranches)
                activeBranchId = this._setupTranslatorSelector(chapters, branchIdFromUrl);
            else {
                const translatorContainer = $el('translatorContainer');
                if (translatorContainer) translatorContainer.style.display = 'none';
            }

            const filteredChapters = activeBranchId != null
                ? this.getFilteredChapters(activeBranchId)
                : chapters;

            if (filteredChapters.length > 0) {
                const fromSelect = $el('chapterFromSelect');
                const toSelect = $el('chapterToSelect');
                const chapterRangeContainer = $el('chapterRangeContainer');

                if (fromSelect && toSelect && chapterRangeContainer) {
                    this.repopulateSelects(filteredChapters, fromSelect, toSelect);

                    toSelect.selectedIndex = toSelect.options.length - 1;
                    if (chapterFromUrl != null && chapterToUrl != null) {
                        if (selectOption(fromSelect, chapterFromUrl) && selectOption(toSelect, chapterToUrl))
                            log.debug(`Restored chapter range: ${chapterFromUrl} - ${chapterToUrl}`);
                        else {
                            log.warn(`Chapter range ${chapterFromUrl} - ${chapterToUrl} ` +
                                'not found in the chapter list, using the full range');
                            fromSelect.selectedIndex = 0;
                            toSelect.selectedIndex = toSelect.options.length - 1;
                            this.rangeNotFound = true;
                        }
                    }

                    chapterRangeContainer.style.display = 'block';
                }
            }
            return chapters.length;
        } catch (e) {
            log.warn('Failed to fetch chapters:', e);
            return null;
        }
    }

    /**
     * Строит карту переводческих веток (branch_id → название команды) и заполняет
     * ими селектор переводчика, выбирая либо ветку из URL, либо ветку с наибольшим
     * числом глав. Если ветка всего одна, скрывает селектор.
     * @param {object[]} chapters - Список глав с полем branches.
     * @param {?number} branchIdFromUrl - Заранее выбранный id ветки перевода из URL.
     * @returns {?number} id выбранной ветки перевода, либо null, если веток нет.
     */
    _setupTranslatorSelector(chapters, branchIdFromUrl) {
        const translatorContainer = $el('translatorContainer');
        const translatorSelect = $el('translatorSelect');
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

        translatorSelect.replaceChildren();
        for (const [id, name] of branchMap) {
            const opt = createEl('option', { text: name, attrs: { value: id } });
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
            const fromSelect = $el('chapterFromSelect');
            const toSelect = $el('chapterToSelect');
            if (fromSelect && toSelect) {
                this.repopulateSelects(filtered, fromSelect, toSelect);
                toSelect.selectedIndex = toSelect.options.length - 1;
            }
        };

        this._setupTranslatorDropdown(translatorSelect);

        translatorContainer.style.display = 'block';
        return initialBranchId;
    }

    /**
     * Создаёт SVG-значок "ТОП" для отметки ветки перевода с наибольшим числом глав.
     * Разметка значка — постоянная строка расширения, данных сайта в ней нет.
     * @returns {HTMLElement} span-элемент со значком.
     */
    _topBadgeSvg() {
        const span = createEl('span', { className: 'translator-top-badge', attrs: { title: 'Самый длинный перевод' } });
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

    /**
     * Строит кастомный выпадающий список для селектора переводчика (кнопка-триггер
     * + список опций поверх нативного select) и один раз навешивает обработчики
     * открытия/закрытия и синхронизации с select'ом.
     * @param {HTMLSelectElement} selectEl - Нативный select переводчика, на основе
     * options которого строится кастомный список.
     * @returns {void}
     */
    _setupTranslatorDropdown(selectEl) {
        const wrap = $el('translatorDropdown');
        const trigger = $el('translatorDropdownTrigger');
        const list = $el('translatorDropdownList');
        if (!wrap || !trigger || !list) return;

        list.replaceChildren();
        Array.from(selectEl.options).forEach(opt => {
            const item = createEl('button', {
                className: 'translator-dropdown-option',
                attrs: { type: 'button', role: 'option' }
            });
            item.dataset.value = opt.value;

            if (opt.dataset.top === 'true') item.appendChild(this._topBadgeSvg());
            item.appendChild(createEl('span', { text: opt.textContent }));

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

    /**
     * Синхронизирует отображаемую метку кастомного дропдауна и подсветку активного
     * пункта списка с текущим выбранным значением нативного select'а переводчика.
     * @param {HTMLSelectElement} selectEl - Нативный select переводчика.
     * @returns {void}
     */
    _syncTranslatorDropdown(selectEl) {
        const label = $el('translatorDropdownLabel');
        const list = $el('translatorDropdownList');
        if (!label || !list) return;

        const selectedOpt = selectEl.options[selectEl.selectedIndex];
        label.replaceChildren();
        if (selectedOpt) {
            if (selectedOpt.dataset.top === 'true') label.appendChild(this._topBadgeSvg());
            label.appendChild(createEl('span', { text: selectedOpt.textContent }));
        }

        Array.from(list.children).forEach(item => {
            item.classList.toggle('active', item.dataset.value === selectEl.value);
        });
    }

    /**
     * Переключает состояние кастомного дропдауна переводчика (открыт/закрыт).
     * @returns {void}
     */
    _toggleTranslatorDropdown() {
        const wrap = $el('translatorDropdown');
        if (!wrap) return;
        if (wrap.dataset.open === 'true') this._closeTranslatorDropdown();
        else this._openTranslatorDropdown();
    }

    /**
     * Открывает кастомный дропдаун переводчика.
     * @returns {void}
     */
    _openTranslatorDropdown() {
        const wrap = $el('translatorDropdown');
        const trigger = $el('translatorDropdownTrigger');
        const list = $el('translatorDropdownList');
        if (!wrap || !trigger || !list) return;
        wrap.dataset.open = 'true';
        list.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
    }

    /**
     * Закрывает кастомный дропдаун переводчика.
     * @returns {void}
     */
    _closeTranslatorDropdown() {
        const wrap = $el('translatorDropdown');
        const trigger = $el('translatorDropdownTrigger');
        const list = $el('translatorDropdownList');
        if (!wrap || !trigger || !list) return;
        wrap.dataset.open = 'false';
        list.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    }

    /**
     * Фильтрует ранее загруженные главы, оставляя только те, что относятся
     * к указанной ветке перевода (см. ChapterList.filterByBranch).
     * @param {number} branchId - id ветки перевода.
     * @returns {object[]} Отфильтрованный список глав.
     */
    getFilteredChapters(branchId) {
        return filterByBranch(this._allChapters, branchId);
    }

    /**
     * Очищает и заново заполняет select-элементы "от"/"до" опциями глав или томов,
     * в зависимости от текущего режима диапазона. Значение опции — ключ главы
     * (ChapterList.chapterKey), а не её позиция в списке.
     * @param {object[]} filteredChapters - Главы (уже отфильтрованные по ветке перевода).
     * @param {HTMLSelectElement} fromSelect - Select начала диапазона.
     * @param {HTMLSelectElement} toSelect - Select конца диапазона.
     * @returns {void}
     */
    repopulateSelects(filteredChapters, fromSelect, toSelect) {
        fromSelect.replaceChildren();
        toSelect.replaceChildren();

        if (this._getRangeMode() === 'volumes')
            return this._populateByVolume(filteredChapters, fromSelect, toSelect);

        filteredChapters.forEach(ch => {
            const label = `Том ${ch.volume}, Глава ${ch.number}`;
            const key = chapterKey(ch);
            fromSelect.appendChild(createEl('option', { text: label, attrs: { value: key } }));
            toSelect.appendChild(createEl('option', { text: label, attrs: { value: key } }));
        });
    }

    /**
     * Заполняет select-элементы "от"/"до" опциями по томам вместо отдельных глав:
     * для каждого тома добавляет опцию с ключом его первой/последней главы.
     * @param {object[]} filteredChapters - Главы (уже отфильтрованные по ветке перевода).
     * @param {HTMLSelectElement} fromSelect - Select начала диапазона.
     * @param {HTMLSelectElement} toSelect - Select конца диапазона.
     * @returns {void}
     */
    _populateByVolume(filteredChapters, fromSelect, toSelect) {
        const volumes = [];
        const firstKey = new Map();
        const lastKey = new Map();

        filteredChapters.forEach(ch => {
            const vol = ch.volume != null ? ch.volume : '1';
            const key = chapterKey(ch);
            if (!firstKey.has(vol)) {
                firstKey.set(vol, key);
                volumes.push(vol);
            }
            lastKey.set(vol, key);
        });

        volumes.forEach(vol => {
            const label = `Том ${vol}`;
            fromSelect.appendChild(createEl('option', { text: label, attrs: { value: firstKey.get(vol) } }));
            toSelect.appendChild(createEl('option', { text: label, attrs: { value: lastKey.get(vol) } }));
        });
    }
}
