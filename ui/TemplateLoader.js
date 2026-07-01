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
    const TemplateLoader = {
        _anchor: null,
        _current: null,

        init(anchorId) {
            this._anchor = document.getElementById(anchorId);
            if (!this._anchor)
                console.error('[TemplateLoader] Anchor element not found:', anchorId);
        },

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

        current() {
            return this._current;
        }
    };

    global.TemplateLoader = TemplateLoader;
    console.log('[TemplateLoader] Loaded');
})(typeof window !== 'undefined' ? window : self);
