/**
 * DownloadLib exporter bootstrap
 * Registers the built-in exporters in the exporter registry
 * @module exporters/index
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { ExporterRegistry } from './ExporterRegistry.js';
import { FB2Exporter } from './FB2Exporter.js';
import { EPUBExporter } from './EPUBExporter.js';
import { MOBIExporter } from './MOBIExporter.js';
import { PDFExporter } from './PDFExporter.js';
import { SimpleExporter } from './SimpleExporter.js';

ExporterRegistry.register('fb2', FB2Exporter, { label: 'FB2' });
ExporterRegistry.register('epub', EPUBExporter, { label: 'EPUB' });
ExporterRegistry.register('mobi', MOBIExporter, { label: 'MOBI' });
ExporterRegistry.register('pdf', PDFExporter, { label: 'PDF' });
ExporterRegistry.register('simple', SimpleExporter, { label: 'TXT/JPEG' });

export { ExporterRegistry };
