/**
 * DownloadLib exporter factory module
 * Module to export manga as various formats
 * @module exporters/ExporterFactory
 * @license MIT
 * @author ivanvit
 * @version 1.0.0
 */

'use strict';

(function(global) {
    console.log('[ExporterFactory] Loading...');

    class ExporterFactory {
        static create(format) {
            const exporters = {
                'fb2': global.FB2Exporter,
                'epub': global.EPUBExporter,
                'pdf': global.PDFExporter
            };

            const ExporterClass = exporters[format.toLowerCase()];
            if (!ExporterClass) {
                throw new Error(`Unsupported format: ${format}`);
            }
            return new ExporterClass();
        }

        static getSupportedFormats() {
            return ['fb2', 'epub', 'pdf'];
        }
    }

    global.ExporterFactory = ExporterFactory;
    console.log('[ExporterFactory] Loaded');
})(window);