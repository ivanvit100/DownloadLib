/**
 * DownloadLib main module
 * Composition root of the popup: registers built-in services, exporters
 * and user plugins, then starts the UI
 * @module app
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import './core/pluginApi.js';
import './services/index.js';
import './exporters/index.js';
import { extensionApi } from './core/BrowserApi.js';
import { createLogger, watchLogLevel } from './core/logger.js';
import { PluginManager } from './core/PluginManager.js';
import { $el } from './ui/dom.js';
import { PopupController } from './ui/PopupController.js';

const log = createLogger('App');

log.debug('Initializing...');

/**
 * Создаёт главный контроллер попапа и показывает ошибку в UI, если его
 * конструктор выбросил исключение.
 * @returns {void}
 */
function initUI() {
    log.debug('Initializing UI...');

    try {
        new PopupController();
    } catch (e) {
        log.error('Failed to initialize PopupController:', e);
        const errorEl = $el('error');
        errorEl.textContent = `Ошибка инициализации: ${e.message}`;
        errorEl.classList.remove('hidden');
    }
}

/**
 * Точка входа приложения: читает уровень логирования, догружает пользовательские
 * плагины, затем инициализирует UI попапа.
 * @returns {Promise<void>}
 */
async function initApp() {
    await watchLogLevel(extensionApi);
    await PluginManager.loadAll();
    initUI();
}

if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => initApp());
else
    initApp();
