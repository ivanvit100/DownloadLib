import { describe, it, expect, beforeEach, vi } from 'vitest';

let ExporterRegistry;

class DummyFB2 {}
class DummyEPUB {}
class DummyPDF {}
class DummyMOBI {}
class DummySimple {}

beforeEach(async () => {
    vi.resetModules();
    await import('../../exporters/ExporterRegistry.js');
    ExporterRegistry = global.ExporterRegistry;
    ExporterRegistry.register('fb2', DummyFB2, { label: 'FB2' });
    ExporterRegistry.register('epub', DummyEPUB, { label: 'EPUB' });
    ExporterRegistry.register('pdf', DummyPDF, { label: 'PDF' });
    ExporterRegistry.register('mobi', DummyMOBI, { label: 'MOBI' });
    ExporterRegistry.register('simple', DummySimple, { label: 'TXT/JPEG' });
});

describe('ExporterRegistry', () => {
    it('Creates FB2 exporter', () => {
        const exporter = ExporterRegistry.create('fb2');
        expect(exporter).toBeInstanceOf(DummyFB2);
    });

    it('Creates EPUB exporter', () => {
        const exporter = ExporterRegistry.create('epub');
        expect(exporter).toBeInstanceOf(DummyEPUB);
    });

    it('Creates PDF exporter', () => {
        const exporter = ExporterRegistry.create('pdf');
        expect(exporter).toBeInstanceOf(DummyPDF);
    });

    it('Throws on unsupported format', () => {
        expect(() => ExporterRegistry.create('txt')).toThrow('Unsupported format: txt');
    });

    it('Is case-insensitive for format', () => {
        const exporter = ExporterRegistry.create('PDF');
        expect(exporter).toBeInstanceOf(DummyPDF);
    });

    it('Returns supported formats', () => {
        expect(ExporterRegistry.getSupportedFormats()).toEqual(['fb2', 'epub', 'pdf', 'mobi', 'simple']);
    });

    it('Returns formats with labels for UI', () => {
        const formats = ExporterRegistry.getFormats();
        expect(formats).toEqual([
            { value: 'fb2', label: 'FB2' },
            { value: 'epub', label: 'EPUB' },
            { value: 'pdf', label: 'PDF' },
            { value: 'mobi', label: 'MOBI' },
            { value: 'simple', label: 'TXT/JPEG' },
        ]);
    });
});
