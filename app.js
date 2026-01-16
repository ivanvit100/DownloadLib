/**
 * DownloadLib main module
 * Initializes the application, registers services, and sets up the UI
 * @license MIT
 * @author ivanvit
 * @version 1.0.0
 */

'use strict';

(function() {
    console.log('[App] Initializing...');

    if (typeof browser !== 'undefined' && typeof chrome === 'undefined')
        (typeof window !== 'undefined' ? window : self).chrome = browser;

    const dependencies = [
        'EventBus',
        'RateLimiter',
        'ServiceRegistry',
        'DownloadManager',
        'BaseService',
        'MangaLibService',
        'RanobeLibService',
        'BaseExporter',
        'FB2Exporter',
        'EPUBExporter',
        'PDFExporter',
        'ExporterFactory',
        'PopupController'
    ];

    const missing = dependencies.filter(dep => typeof window[dep] === 'undefined');
    
    if (missing.length > 0) {
        console.error('[App] Missing dependencies:', missing);
        document.body.innerHTML = '<div style="padding: 20px; color: red;">Ошибка загрузки модулей: ' + missing.join(', ') + '</div>';
        return;
    }

    console.log('[App] All dependencies loaded');
    try {
        (typeof window !== 'undefined' ? window : self).serviceRegistry.register((typeof window !== 'undefined' ? window : self).MangaLibService);
    } catch (e) {
        console.error('[App] Failed to register MangaLibService:', e);
    }

    try {
        (typeof window !== 'undefined' ? window : self).serviceRegistry.register((typeof window !== 'undefined' ? window : self).RanobeLibService);
    } catch (e) {
        console.error('[App] Failed to register RanobeLibService:', e);
    }

    const services = (typeof window !== 'undefined' ? window : self).serviceRegistry.getAllServices();

    function initUI() {
        console.log('[App] Initializing UI...');
        
        try {
            (typeof window !== 'undefined' ? window : self).popupController = new (typeof window !== 'undefined' ? window : self).PopupController();
        } catch (e) {
            console.error('[App] Failed to initialize PopupController:', e);
            document.getElementById('error').textContent = 'Ошибка инициализации: ' + e.message;
            document.getElementById('error').classList.remove('hidden');
        }
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', initUI);
    else
        setTimeout(initUI, 100);
})();