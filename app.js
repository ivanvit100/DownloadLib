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
import { PluginManager } from './core/PluginManager.js';
import { PopupController } from './ui/PopupController.js';

console.log('[App] Initializing...');

/**
 * Создаёт главный контроллер попапа и показывает ошибку в UI, если его
 * конструктор выбросил исключение.
 * @returns {void}
 */
function initUI() {
    console.log('[App] Initializing UI...');

    try {
        new PopupController();
    } catch (e) {
        console.error('[App] Failed to initialize PopupController:', e);
        document.getElementById('error').textContent = `Ошибка инициализации: ${e.message}`;
        document.getElementById('error').classList.remove('hidden');
    }
}

/**
 * Точка входа приложения: догружает пользовательские плагины, затем
 * инициализирует UI попапа.
 * @returns {Promise<void>}
 */
async function initApp() {
    await PluginManager.loadAll();
    initUI();
}

if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => initApp());
else
    initApp();
