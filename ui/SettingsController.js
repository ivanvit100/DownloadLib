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
import {
    DEFAULT_MAX_CHAPTERS, DEFAULT_MAX_SIZE_MB, FIT_FB2_IMAGES_KEY, MAX_CHAPTERS_KEY, MAX_SIZE_KEY,
    PART_LIMIT_CHAPTERS, PART_LIMIT_MODE_KEY, PART_LIMIT_SIZE, RANGE_MODE_CHAPTERS, RANGE_MODE_KEY,
    RANGE_MODE_VOLUMES, readPartLimitMode, readRangeMode, settingsStorage
} from '../core/UserSettings.js';
import { $el, createEl, setDisplay } from './DomUtils.js';

const log = createLogger('SettingsController');

/** Кнопки переключателя режима выбора диапазона: id кнопки по режиму. */
const RANGE_MODE_BUTTONS = { [RANGE_MODE_CHAPTERS]: 'rangeModeChapters', [RANGE_MODE_VOLUMES]: 'rangeModeVolumes' };

/** Кнопки переключателя ограничения части файла: id кнопки по режиму. */
const PART_LIMIT_BUTTONS = { [PART_LIMIT_SIZE]: 'partLimitSize', [PART_LIMIT_CHAPTERS]: 'partLimitChapters' };

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
        input.value = settingsStorage.get(MAX_SIZE_KEY) || DEFAULT_MAX_SIZE_MB;
    },

    /**
     * Заполняет поле максимального числа глав в части файла сохранённым значением.
     * @returns {void}
     */
    _renderMaxChapters() {
        const input = $el('settingsMaxChapters');
        if (!input) return;
        input.value = settingsStorage.get(MAX_CHAPTERS_KEY) || DEFAULT_MAX_CHAPTERS;
    },

    /**
     * Показывает сохранённый режим ограничения части файла (по размеру/по числу глав).
     * @returns {void}
     */
    _renderPartLimitMode() {
        this._applyPartLimitMode(readPartLimitMode());
    },

    /**
     * Подсвечивает кнопку режима ограничения части файла и показывает поле
     * лимита только для этого режима.
     * @param {'size'|'chapters'} mode - Режим ограничения части файла.
     * @returns {void}
     */
    _applyPartLimitMode(mode) {
        this._highlightMode(PART_LIMIT_BUTTONS, mode);
        setDisplay('maxSizeRow', mode === PART_LIMIT_SIZE ? '' : 'none');
        setDisplay('maxChaptersRow', mode === PART_LIMIT_CHAPTERS ? '' : 'none');
    },

    /**
     * Отмечает чекбокс вписывания изображений FB2 в страницу согласно сохранённому значению.
     * @returns {void}
     */
    _renderFitFb2Images() {
        const checkbox = $el('settingsFitFb2Images');
        if (!checkbox) return;
        checkbox.checked = settingsStorage.get(FIT_FB2_IMAGES_KEY) === 'true';
    },

    /**
     * Подсвечивает активную кнопку режима диапазона (по главам/по томам)
     * согласно сохранённому значению.
     * @returns {void}
     */
    _renderRangeMode() {
        this._highlightMode(RANGE_MODE_BUTTONS, readRangeMode());
    },

    /**
     * Подсвечивает в переключателе кнопку выбранного режима.
     * @param {Object<string, string>} buttons - id кнопки по режиму.
     * @param {string} mode - Выбранный режим.
     * @returns {void}
     */
    _highlightMode(buttons, mode) {
        for (const [value, id] of Object.entries(buttons))
            $el(id)?.classList.toggle('active', value === mode);
    },

    /**
     * Привязывает кнопки переключателя: по клику режим сохраняется в настройки
     * и применяется к экрану.
     * @param {Object<string, string>} buttons - id кнопки по режиму.
     * @param {string} key - Ключ настройки режима.
     * @param {function(string): void} apply - Применяет выбранный режим к экрану.
     * @returns {void}
     */
    _bindModeToggle(buttons, key, apply) {
        for (const [mode, id] of Object.entries(buttons)) {
            $el(id)?.addEventListener('click', () => {
                settingsStorage.set(key, mode);
                apply(mode);
            });
        }
    },

    /**
     * Загружает список установленных плагинов через PluginManager и отрисовывает
     * их карточки, либо показывает заглушку, если плагинов нет.
     * @returns {Promise<void>}
     */
    async _renderPlugins() {
        const list = $el('pluginList');
        if (!list) return;

        list.replaceChildren();

        const plugins = await PluginManager.list();

        if (!plugins.length) {
            setDisplay('pluginEmpty', 'block');
            return;
        }

        setDisplay('pluginEmpty', 'none');
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
            saveBtn.addEventListener('click', async () => {
                rateLimitInput.value = await RateLimitClient.setLimit(rateLimitInput.value);

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
                settingsStorage.set(MAX_SIZE_KEY, val);

                const maxChaptersInput = $el('settingsMaxChapters');
                if (maxChaptersInput) {
                    let chapters = parseInt(maxChaptersInput.value);
                    if (isNaN(chapters) || chapters < 1) chapters = 1;
                    maxChaptersInput.value = chapters;
                    settingsStorage.set(MAX_CHAPTERS_KEY, chapters);
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
                settingsStorage.set(FIT_FB2_IMAGES_KEY, fitFb2ImagesCheckbox.checked));
        }

        this._bindModeToggle(PART_LIMIT_BUTTONS, PART_LIMIT_MODE_KEY, mode => this._applyPartLimitMode(mode));
        this._bindModeToggle(RANGE_MODE_BUTTONS, RANGE_MODE_KEY, mode => this._highlightMode(RANGE_MODE_BUTTONS, mode));

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
