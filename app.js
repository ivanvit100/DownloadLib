/**
 * DownloadLib main module
 * Initializes the application, registers services, and sets up the UI
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function() {
    console.log('[App] Initializing...');

    const extensionApi = typeof getExtensionApi === 'function'
        ? getExtensionApi()
        : ((typeof browser !== 'undefined' && browser) || (typeof chrome !== 'undefined' && chrome) || null);

    if (!extensionApi)
        console.warn('[App] Extension API is not available in this context');

    const dependencies = [
        'EventBus',
        'RateLimiter',
        'ServiceRegistry',
        'DownloadManager',
        'MangaPatcher',
        'ExporterRegistry',
        'PopupController'
    ];

    const missing = dependencies.filter(dep => typeof window[dep] === 'undefined');

    if (missing.length > 0) {
        console.error('[App] Missing dependencies:', missing);
        document.body.innerHTML = `<div style="padding: 20px; color: red;">Ошибка загрузки модулей: ${missing.join(', ')}</div>`;
        return;
    }

    console.log('[App] All dependencies loaded');

    function initUI() {
        console.log('[App] Initializing UI...');

        try {
            window.popupController = new window.PopupController();
        } catch (e) {
            console.error('[App] Failed to initialize PopupController:', e);
            document.getElementById('error').textContent = `Ошибка инициализации: ${e.message}`;
            document.getElementById('error').classList.remove('hidden');
        }
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', initUI);
    else
        setTimeout(initUI, 100);
})();
