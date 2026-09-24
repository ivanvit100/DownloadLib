/**
 * DownloadLib ui module
 * Loads HTML template fragments into the anchor element
 * @module ui/TemplateLoader
 * @license MIT
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function(global) {
    /**
     * Синглтон-загрузчик HTML-фрагментов шаблонов в элемент-якорь на странице.
     * @namespace TemplateLoader
     */
    const TemplateLoader = {
        _anchor: null,
        _current: null,

        /**
         * Находит и запоминает элемент-якорь, в который будут загружаться шаблоны.
         * @param {string} anchorId - id элемента-якоря в DOM.
         * @returns {void}
         */
        init(anchorId) {
            this._anchor = document.getElementById(anchorId);
            if (!this._anchor)
                console.error('[TemplateLoader] Anchor element not found:', anchorId);
        },

        /**
         * Загружает HTML-фрагмент шаблона по имени и вставляет его в элемент-якорь.
         * @param {string} templateName - Имя шаблона (без расширения) из папки templates/.
         * @param {?function(): void} [onReady] - Колбэк, вызываемый после успешной вставки шаблона.
         * @returns {Promise<void>}
         */
        async show(templateName, onReady = null) {
            if (!this._anchor) {
                console.error('[TemplateLoader] Anchor not initialized');
                return;
            }

            try {
                const res = await fetch(`templates/${templateName}.html`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                this._anchor.innerHTML = await res.text();
                this._current = templateName;
                if (onReady) onReady();
            } catch (e) {
                console.error('[TemplateLoader] Failed to load template:', templateName, e);
            }
        },

        /**
         * Возвращает имя текущего загруженного шаблона.
         * @returns {?string} Имя шаблона или null, если ни один шаблон ещё не загружен.
         */
        current() {
            return this._current;
        }
    };

    global.TemplateLoader = TemplateLoader;
    console.log('[TemplateLoader] Loaded');
})(typeof window !== 'undefined' ? window : self);
