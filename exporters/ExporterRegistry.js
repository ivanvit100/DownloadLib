/**
 * DownloadLib exporter registry
 * @module exporters/ExporterRegistry
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[ExporterRegistry] Loading...');
    const EXPORTER_SCRIPTS = [
        '/exporters/BaseExporter.js',
        '/exporters/FB2Exporter.js',
        '/exporters/EPUBExporter.js',
        '/exporters/MOBIExporter.js',
        '/exporters/PDFExporter.js',
        '/exporters/SimpleExporter.js',
    ];

    class ExporterRegistry {
        static #registry = {};

        static register(format, ExporterClass, meta = {}) {
            ExporterRegistry.#registry[format.toLowerCase()] = { ExporterClass, meta };
        }

        static create(format) {
            const entry = ExporterRegistry.#registry[format.toLowerCase()];
            if (!entry) throw new Error(`Unsupported format: ${format}`);
            return new entry.ExporterClass();
        }

        static getSupportedFormats() {
            return Object.keys(ExporterRegistry.#registry);
        }

        static getFormats() {
            return Object.entries(ExporterRegistry.#registry).map(([value, { meta }]) => ({
                value,
                label: meta.label || value.toUpperCase()
            }));
        }

        static _reset() {
            ExporterRegistry.#registry = {};
        }
    }

    global.ExporterRegistry = ExporterRegistry;
    
    if (typeof importScripts === 'function') {
        importScripts(...EXPORTER_SCRIPTS);
    } else if (typeof document !== 'undefined' && document.currentScript !== null) {
        EXPORTER_SCRIPTS.forEach(src => {
            document.write('<script src="' + src + '"><\/script>');
        });
    }

    console.log('[ExporterRegistry] Loaded');
})(typeof window !== 'undefined' ? window : self);
