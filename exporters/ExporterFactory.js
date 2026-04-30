/**
 * DownloadLib exporter factory module
 * Module to export manga as various formats
 * @module exporters/ExporterFactory
 * @license MIT
 * @author ivanvit
 * @version 1.0.5
 */

'use strict';

(function(global) {
    console.log('[ExporterFactory] Loading...');

    class ExporterFactory {
        static create(format) {
            const exporters = {
                'fb2': global.FB2Exporter,
                'epub': global.EPUBExporter,
                'pdf': global.PDFExporter,
                'azw3': global.AZW3Exporter,
                'simple': global.SimpleExporter
            };

            const ExporterClass = exporters[format.toLowerCase()];
            if (!ExporterClass) {
                throw new Error(`Unsupported format: ${format}`);
            }
            return new ExporterClass();
        }

        static getSupportedFormats() {
            return ['fb2', 'epub', 'pdf', 'azw3', 'simple'];
        }
    }

    global.ExporterFactory = ExporterFactory;
    console.log('[ExporterFactory] Loaded');
})(typeof window !== 'undefined' ? window : self);