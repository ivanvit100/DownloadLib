/**
 * DownloadLib ui module
 * Controls the settings view
 * @module ui/SettingsController
 * @author ivanvit
 * @version 1.1.0
 */

import { createLogger } from '../core/ConsoleLogger.js';
import { PluginManager } from '../core/PluginManager.js';
import { RateLimitClient } from '../core/RateLimitClient.js';
import { $el, createEl, setDisplay } from './DomUtils.js';

const log = createLogger('SettingsController');

const MAX_SIZE_KEY = 'manga_parser_max_size_mb';
const PART_LIMIT_MODE_KEY = 'manga_parser_part_limit_mode';
const MAX_CHAPTERS_KEY = 'manga_parser_max_chapters';
const DEFAULT_MAX_CHAPTERS = '50';
const RANGE_MODE_KEY = 'manga_parser_range_mode';
const FIT_FB2_IMAGES_KEY = 'manga_parser_fit_fb2_images';

/**
 * Синглтон-контроллер экрана настроек расширения.
 * @namespace SettingsController
 */
export const SettingsController = {
    /**
     * Инициализирует экран настроек: отрисовывает все секции и навешивает обработчики.
     * @param {function(): void} onBack - Возврат к главному экрану по кнопке "назад".
     * @returns {void}
     */
    init(onBack) {
        this._renderRateLimit();
        this._renderMaxSize();
        this._renderMaxChapters();
        this._renderPartLimitMode();
        this._renderFitFb2Images();
        this._renderRangeMode();
        this._renderPlugins();
        this._bindEvents(onBack);
    },

    /**
     * Заполняет поле лимита запросов в минуту значением из настроек (storage.local).
     * @returns {Promise<void>}
     */
    async _renderRateLimit() {
        const input = $el('settingsRateLimit');
        if (!input) return;
        input.value = await RateLimitClient.getLimit();
    },

    /**
     * Заполняет поле максимального размера части файла сохранённым значением.
     * @returns {void}
     */
    _renderMaxSize() {
        const input = $el('settingsMaxSize');
        if (!input) return;
        input.value = localStorage.getItem(MAX_SIZE_KEY) || '200';
    },

    /**
     * Заполняет поле максимального числа глав в части файла сохранённым значением.
     * @returns {void}
     */
    _renderMaxChapters() {
        const input = $el('settingsMaxChapters');
        if (!input) return;
        input.value = localStorage.getItem(MAX_CHAPTERS_KEY) || DEFAULT_MAX_CHAPTERS;
    },

    /**
     * Показывает сохранённый режим ограничения части файла (по размеру/по числу глав).
     * @returns {void}
     */
    _renderPartLimitMode() {
        this._applyPartLimitMode(localStorage.getItem(PART_LIMIT_MODE_KEY) === 'chapters' ? 'chapters' : 'size');
    },

    /**
     * Подсвечивает кнопку режима ограничения части файла и показывает поле
     * лимита только для этого режима.
     * @param {'size'|'chapters'} mode - Режим ограничения части файла.
     * @returns {void}
     */
    _applyPartLimitMode(mode) {
        $el('partLimitSize')?.classList.toggle('active', mode === 'size');
        $el('partLimitChapters')?.classList.toggle('active', mode === 'chapters');
        setDisplay('maxSizeRow', mode === 'size' ? '' : 'none');
        setDisplay('maxChaptersRow', mode === 'chapters' ? '' : 'none');
    },

    /**
     * Отмечает чекбокс вписывания изображений FB2 в страницу согласно сохранённому значению.
     * @returns {void}
     */
    _renderFitFb2Images() {
        const checkbox = $el('settingsFitFb2Images');
        if (!checkbox) return;
        checkbox.checked = localStorage.getItem(FIT_FB2_IMAGES_KEY) === 'true';
    },

    /**
     * Подсвечивает активную кнопку режима диапазона (по главам/по томам)
     * согласно сохранённому значению.
     * @returns {void}
     */
    _renderRangeMode() {
        const chaptersBtn = $el('rangeModeChapters');
        const volumesBtn = $el('rangeModeVolumes');
        if (!chaptersBtn || !volumesBtn) return;
        const mode = localStorage.getItem(RANGE_MODE_KEY) === 'volumes' ? 'volumes' : 'chapters';
        chaptersBtn.classList.toggle('active', mode === 'chapters');
        volumesBtn.classList.toggle('active', mode === 'volumes');
    },

    /**
     * Загружает список установленных плагинов через PluginManager и отрисовывает
     * их карточки, либо показывает заглушку, если плагинов нет.
     * @returns {Promise<void>}
     */
    async _renderPlugins() {
        const list = $el('pluginList');
        const empty = $el('pluginEmpty');
        if (!list) return;

        list.replaceChildren();

        const plugins = await PluginManager.list();

        if (!plugins.length) {
            if (empty) empty.style.display = 'block';
            return;
        }

        if (empty) empty.style.display = 'none';
        plugins.forEach(plugin => list.appendChild(this._createPluginCard(plugin)));
    },

    /**
     * Создаёт DOM-карточку плагина с переключателем включения/отключения
     * и кнопкой удаления.
     * @param {{id: string, name: string, enabled?: boolean}} plugin - Данные плагина.
     * @returns {HTMLElement} Собранный DOM-элемент карточки плагина.
     */
    _createPluginCard(plugin) {
        const card = createEl('div', { className: 'plugin-card' });

        const info = createEl('div', { className: 'plugin-info' });
        info.appendChild(createEl('span', { className: 'plugin-name', text: plugin.name }));
        card.appendChild(info);

        const actions = createEl('div', { className: 'plugin-actions' });

        const toggle = createEl('input', {
            className: 'plugin-toggle',
            attrs: { type: 'checkbox', title: 'Включить/отключить' }
        });
        toggle.checked = plugin.enabled !== false;
        toggle.addEventListener('change', async () => {
            await PluginManager.toggle(plugin.id, toggle.checked);
        });

        const removeBtn = createEl('button', {
            className: 'plugin-remove-btn',
            text: '✕',
            attrs: { title: 'Удалить плагин' }
        });
        removeBtn.addEventListener('click', async () => {
            await PluginManager.remove(plugin.id);
            await this._renderPlugins();
        });

        actions.appendChild(toggle);
        actions.appendChild(removeBtn);
        card.appendChild(actions);

        return card;
    },

    /**
     * Навешивает обработчики на все элементы управления экрана настроек: кнопку
     * "назад", сохранение лимита запросов и лимитов части файла (размер и число глав),
     * переключение режима ограничения части, режима диапазона глав/томов и загрузку
     * файла нового плагина.
     * @param {function(): void} onBack - Возврат к главному экрану.
     * @returns {void}
     */
    _bindEvents(onBack) {
        const backBtn = $el('settingsBackBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                if (new URLSearchParams(window.location.search).has('settings'))
                    return window.close();
                const logoInfo = $el('logoInfo');
                if (logoInfo) logoInfo.textContent = '';
                if (onBack) onBack();
                else log.error('onBack callback not provided');
            });
        }

        const saveBtn = $el('saveRateLimitBtn');
        const rateLimitInput = $el('settingsRateLimit');
        if (saveBtn && rateLimitInput) {
            saveBtn.addEventListener('click', () => {
                let val = parseInt(rateLimitInput.value);
                if (isNaN(val) || val < 2) val = 2;
                if (val > 200) val = 200;
                rateLimitInput.value = val;
                RateLimitClient.setLimit(val);

                const original = saveBtn.textContent;
                saveBtn.textContent = '✓ Сохранено';
                saveBtn.disabled = true;
                setTimeout(() => {
                    saveBtn.textContent = original;
                    saveBtn.disabled = false;
                }, 1500);
            });
        }

        const saveMaxSizeBtn = $el('saveMaxSizeBtn');
        const maxSizeInput = $el('settingsMaxSize');
        if (saveMaxSizeBtn && maxSizeInput) {
            saveMaxSizeBtn.addEventListener('click', () => {
                let val = parseInt(maxSizeInput.value);
                if (isNaN(val) || val < 1) val = 1;
                maxSizeInput.value = val;
                localStorage.setItem(MAX_SIZE_KEY, String(val));

                const maxChaptersInput = $el('settingsMaxChapters');
                if (maxChaptersInput) {
                    let chapters = parseInt(maxChaptersInput.value);
                    if (isNaN(chapters) || chapters < 1) chapters = 1;
                    maxChaptersInput.value = chapters;
                    localStorage.setItem(MAX_CHAPTERS_KEY, String(chapters));
                }

                const original = saveMaxSizeBtn.textContent;
                saveMaxSizeBtn.textContent = '✓ Сохранено';
                saveMaxSizeBtn.disabled = true;
                setTimeout(() => {
                    saveMaxSizeBtn.textContent = original;
                    saveMaxSizeBtn.disabled = false;
                }, 1500);
            });
        }

        const fitFb2ImagesCheckbox = $el('settingsFitFb2Images');
        if (fitFb2ImagesCheckbox) {
            fitFb2ImagesCheckbox.addEventListener('change', () =>
                localStorage.setItem(FIT_FB2_IMAGES_KEY, String(fitFb2ImagesCheckbox.checked)));
        }

        const partLimitSize = $el('partLimitSize');
        const partLimitChapters = $el('partLimitChapters');
        if (partLimitSize && partLimitChapters) {
            const setPartLimitMode = (mode) => {
                localStorage.setItem(PART_LIMIT_MODE_KEY, mode);
                this._applyPartLimitMode(mode);
            };
            partLimitSize.addEventListener('click', () => setPartLimitMode('size'));
            partLimitChapters.addEventListener('click', () => setPartLimitMode('chapters'));
        }

        const rangeModeChapters = $el('rangeModeChapters');
        const rangeModeVolumes = $el('rangeModeVolumes');
        if (rangeModeChapters && rangeModeVolumes) {
            const setRangeMode = (mode) => {
                localStorage.setItem(RANGE_MODE_KEY, mode);
                rangeModeChapters.classList.toggle('active', mode === 'chapters');
                rangeModeVolumes.classList.toggle('active', mode === 'volumes');
            };
            rangeModeChapters.addEventListener('click', () => setRangeMode('chapters'));
            rangeModeVolumes.addEventListener('click', () => setRangeMode('volumes'));
        }

        const fileInput = $el('pluginFileInput');
        if (fileInput) {
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files && fileInput.files[0];
                if (!file) return;
                const code = await file.text();
                const name = file.name.replace(/\.js$/i, '');
                await PluginManager.save({
                    id: PluginManager.generateId(),
                    name,
                    code,
                    enabled: true
                });
                fileInput.value = '';
                await this._renderPlugins();
            });
        }
    }
};
