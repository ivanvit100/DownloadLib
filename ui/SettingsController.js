/**
 * DownloadLib ui module
 * Controls the settings view
 * @module ui/SettingsController
 * @author ivanvit
 * @version 1.0.9
 */

'use strict';

(function(global) {
    console.log('[SettingsController] Loading...');

    const RATE_LIMIT_KEY = 'downloadlib_default_rate_limit';
    const MAX_SIZE_KEY = 'manga_parser_max_size_mb';

    const SettingsController = {
        init() {
            this._renderRateLimit();
            this._renderMaxSize();
            this._renderServiceServers();
            this._renderPlugins();
            this._bindEvents();
        },

        _renderRateLimit() {
            const input = document.getElementById('settingsRateLimit');
            if (!input) return;
            input.value = localStorage.getItem(RATE_LIMIT_KEY) || '85';
        },

        _renderMaxSize() {
            const input = document.getElementById('settingsMaxSize');
            if (!input) return;
            input.value = localStorage.getItem(MAX_SIZE_KEY) || '200';
        },

        _renderServiceServers() {
            const container = document.getElementById('serviceServersContainer');
            if (!container) return;
            container.innerHTML = '';

            const services = global.serviceRegistry?.getAllServices() || [];
            const withServers = services.filter(s => s.config?.imageServers);

            for (const service of withServers) {
                const section = this._createServerSection(service);
                container.appendChild(section);
            }

            if (!withServers.length) container.style.display = 'none';
        },

        _createServerSection(service) {
            const { name, config } = service;
            const servers = config.imageServers;
            const storageKey = `${name}_image_server`;
            const saved = localStorage.getItem(storageKey) || config.defaultImageServer || 'compression';

            const section = document.createElement('div');
            section.className = 'settings-section';

            const title = document.createElement('div');
            title.className = 'settings-section-title';
            title.textContent = `${config.label || name} — сервер изображений`;
            section.appendChild(title);

            const row = document.createElement('div');
            row.className = 'settings-row';

            const label = document.createElement('label');
            label.className = 'settings-label';
            label.textContent = 'Сервер загрузки';
            row.appendChild(label);

            const select = document.createElement('select');
            select.className = 'settings-select';
            for (const [key, srv] of Object.entries(servers)) {
                const opt = document.createElement('option');
                opt.value = key;
                opt.textContent = srv.label || key;
                select.appendChild(opt);
            }
            select.value = saved;
            row.appendChild(select);
            section.appendChild(row);

            const hint = document.createElement('div');
            hint.className = 'settings-hint';
            hint.textContent = this._serverHintText(servers[saved]);
            section.appendChild(hint);

            select.addEventListener('change', () => {
                hint.textContent = this._serverHintText(servers[select.value]);
            });

            const btn = document.createElement('button');
            btn.className = 'settings-btn-outline';
            btn.textContent = 'Применить';
            btn.addEventListener('click', () => {
                localStorage.setItem(storageKey, select.value);
                const original = btn.textContent;
                btn.textContent = '✓ Сохранено';
                btn.disabled = true;
                setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
            });
            section.appendChild(btn);

            return section;
        },

        _serverHintText(serverCfg) {
            if (!serverCfg) return '';
            return serverCfg.compress === false
                ? 'Оригинальное качество. Сжатие на стороне расширения отключено.'
                : 'Изображения сжимаются. Сжатие на стороне расширения активно.';
        },

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
