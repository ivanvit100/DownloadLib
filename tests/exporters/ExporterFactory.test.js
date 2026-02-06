import { describe, it, expect, beforeEach } from 'vitest';

let ExporterFactory;

class DummyFB2 {}
class DummyEPUB {}
class DummyPDF {}

beforeEach(async () => {
    global.FB2Exporter = DummyFB2;
    global.EPUBExporter = DummyEPUB;
    global.PDFExporter = DummyPDF;
    await import('../../exporters/ExporterFactory.js');
    ExporterFactory = global.ExporterFactory;
});

describe('ExporterFactory', () => {
    it('Creates FB2 exporter', () => {
        const exporter = ExporterFactory.create('fb2');
        expect(exporter).toBeInstanceOf(DummyFB2);
    });

    it('Creates EPUB exporter', () => {
        const exporter = ExporterFactory.create('epub');
        expect(exporter).toBeInstanceOf(DummyEPUB);
    });

    it('Creates PDF exporter', () => {
        const exporter = ExporterFactory.create('pdf');
        expect(exporter).toBeInstanceOf(DummyPDF);
    });

    it('Throws on unsupported format', () => {
        expect(() => ExporterFactory.create('txt')).toThrow('Unsupported format: txt');
    });

    it('Is case-insensitive for format', () => {
        const exporter = ExporterFactory.create('PDF');
        expect(exporter).toBeInstanceOf(DummyPDF);
    });

    it('Returns supported formats', () => {
        expect(ExporterFactory.getSupportedFormats()).toEqual(['fb2', 'epub', 'pdf']);
    });
});