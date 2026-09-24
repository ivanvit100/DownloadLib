/**
 * DownloadLib ui module
 * Controls the settings view
 * @module ui/SettingsController
 * @author ivanvit
 * @version 1.0.10
 */

'use strict';

(function(global) {
    console.log('[SettingsController] Loading...');

    const RATE_LIMIT_KEY = 'downloadlib_default_rate_limit';
    const MAX_SIZE_KEY = 'manga_parser_max_size_mb';
    const RANGE_MODE_KEY = 'manga_parser_range_mode';

    /**
     * Синглтон-контроллер экрана настроек расширения.
     * @namespace SettingsController
     */
    const SettingsController = {
        /**
         * Инициализирует экран настроек: отрисовывает все секции и навешивает обработчики.
         * @returns {void}
         */
        init() {
            this._renderRateLimit();
            this._renderMaxSize();
            this._renderRangeMode();
            this._renderPlugins();
            this._bindEvents();
        },

        /**
         * Заполняет поле лимита запросов в минуту сохранённым значением.
         * @returns {void}
         */
        _renderRateLimit() {
            const input = document.getElementById('settingsRateLimit');
            if (!input) return;
            input.value = localStorage.getItem(RATE_LIMIT_KEY) || '85';
        },

        /**
         * Заполняет поле максимального размера части файла сохранённым значением.
         * @returns {void}
         */
        _renderMaxSize() {
            const input = document.getElementById('settingsMaxSize');
            if (!input) return;
            input.value = localStorage.getItem(MAX_SIZE_KEY) || '200';
        },

        /**
         * Подсвечивает активную кнопку режима диапазона (по главам/по томам)
         * согласно сохранённому значению.
         * @returns {void}
         */
        _renderRangeMode() {
            const chaptersBtn = document.getElementById('rangeModeChapters');
            const volumesBtn = document.getElementById('rangeModeVolumes');
            if (!chaptersBtn || !volumesBtn) return;
            const mode = localStorage.getItem(RANGE_MODE_KEY) === 'volumes' ? 'volumes' : 'chapters';
            chaptersBtn.classList.toggle('active', mode === 'chapters');
            volumesBtn.classList.toggle('active', mode === 'volumes');
        },

        /**
         * Загружает список установленных плагинов через PluginManager и отрисовывает
         * их карточки, либо показывает заглушку, если плагинов нет или менеджер недоступен.
         * @returns {Promise<void>}
         */
        async _renderPlugins() {
            const list = document.getElementById('pluginList');
            const empty = document.getElementById('pluginEmpty');
            if (!list) return;

            list.innerHTML = '';

            if (!global.PluginManager) {
                if (empty) {
                    empty.textContent = 'PluginManager недоступен';
                    empty.style.display = 'block';
                }
                return;
            }

            const plugins = await global.PluginManager.list();

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
            const card = document.createElement('div');
            card.className = 'plugin-card';

            const info = document.createElement('div');
            info.className = 'plugin-info';

            const name = document.createElement('span');
            name.className = 'plugin-name';
            name.textContent = plugin.name;
            info.appendChild(name);
            card.appendChild(info);

            const actions = document.createElement('div');
            actions.className = 'plugin-actions';

            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.className = 'plugin-toggle';
            toggle.checked = plugin.enabled !== false;
            toggle.title = 'Включить/отключить';
            toggle.addEventListener('change', async () => {
                if (global.PluginManager) await global.PluginManager.toggle(plugin.id, toggle.checked);
            });

            const removeBtn = document.createElement('button');
            removeBtn.className = 'plugin-remove-btn';
            removeBtn.textContent = '✕';
            removeBtn.title = 'Удалить плагин';
            removeBtn.addEventListener('click', async () => {
                if (!global.PluginManager) return;
                await global.PluginManager.remove(plugin.id);
                await this._renderPlugins();
            });

            actions.appendChild(toggle);
            actions.appendChild(removeBtn);
            card.appendChild(actions);

            return card;
        },

        /**
         * Навешивает обработчики на все элементы управления экрана настроек: кнопку
         * "назад", сохранение лимита запросов и максимального размера части, переключение
         * режима диапазона глав/томов и загрузку файла нового плагина.
         * @returns {void}
         */
        _bindEvents() {
            const backBtn = document.getElementById('settingsBackBtn');
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    if (new URLSearchParams(window.location.search).has('settings'))
                        return window.close();
                    const logoInfo = document.getElementById('logoInfo');
                    if (logoInfo) logoInfo.textContent = '';
                    if (global.popupController) global.popupController._restoreMainView();
                    else console.error('[SettingsController] popupController not found');
                });
            }

            const saveBtn = document.getElementById('saveRateLimitBtn');
            const rateLimitInput = document.getElementById('settingsRateLimit');
            if (saveBtn && rateLimitInput) {
                saveBtn.addEventListener('click', () => {
                    let val = parseInt(rateLimitInput.value);
                    if (isNaN(val) || val < 2) val = 2;
                    if (val > 200) val = 200;
                    rateLimitInput.value = val;
                    localStorage.setItem(RATE_LIMIT_KEY, String(val));
                    if (global.globalRateLimiter) global.globalRateLimiter.setLimit(val);

                    const original = saveBtn.textContent;
                    saveBtn.textContent = '✓ Сохранено';
                    saveBtn.disabled = true;
                    setTimeout(() => {
                        saveBtn.textContent = original;
                        saveBtn.disabled = false;
                    }, 1500);
                });
            }

            const saveMaxSizeBtn = document.getElementById('saveMaxSizeBtn');
            const maxSizeInput = document.getElementById('settingsMaxSize');
            if (saveMaxSizeBtn && maxSizeInput) {
                saveMaxSizeBtn.addEventListener('click', () => {
                    let val = parseInt(maxSizeInput.value);
                    if (isNaN(val) || val < 1) val = 1;
                    maxSizeInput.value = val;
                    localStorage.setItem(MAX_SIZE_KEY, String(val));

                    const original = saveMaxSizeBtn.textContent;
                    saveMaxSizeBtn.textContent = '✓ Сохранено';
                    saveMaxSizeBtn.disabled = true;
                    setTimeout(() => {
                        saveMaxSizeBtn.textContent = original;
                        saveMaxSizeBtn.disabled = false;
                    }, 1500);
                });
            }

            const rangeModeChapters = document.getElementById('rangeModeChapters');
            const rangeModeVolumes = document.getElementById('rangeModeVolumes');
            if (rangeModeChapters && rangeModeVolumes) {
                const setRangeMode = (mode) => {
                    localStorage.setItem(RANGE_MODE_KEY, mode);
                    rangeModeChapters.classList.toggle('active', mode === 'chapters');
                    rangeModeVolumes.classList.toggle('active', mode === 'volumes');
                };
                rangeModeChapters.addEventListener('click', () => setRangeMode('chapters'));
                rangeModeVolumes.addEventListener('click', () => setRangeMode('volumes'));
            }

            const fileInput = document.getElementById('pluginFileInput');
            if (fileInput) {
                fileInput.addEventListener('change', async () => {
                    const file = fileInput.files && fileInput.files[0];
                    if (!file || !global.PluginManager) return;
                    const code = await file.text();
                    const name = file.name.replace(/\.js$/i, '');
                    await global.PluginManager.save({
                        id: global.PluginManager.generateId(),
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

    global.SettingsController = SettingsController;
    console.log('[SettingsController] Loaded');
})(typeof window !== 'undefined' ? window : self);
