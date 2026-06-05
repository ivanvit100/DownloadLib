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

    it('_reset clears the registry', () => {
        ExporterRegistry._reset();
        expect(ExporterRegistry.getSupportedFormats()).toEqual([]);
    });

    it('getFormats uses format key as uppercase label when meta has no label', () => {
        ExporterRegistry._reset();
        ExporterRegistry.register('xyz', class {}, {});
        const formats = ExporterRegistry.getFormats();
        expect(formats).toEqual([{ value: 'xyz', label: 'XYZ' }]);
    });

    it('register uses default empty meta when third argument is omitted', () => {
        ExporterRegistry._reset();
        class DummyX {}
        ExporterRegistry.register('x', DummyX);
        expect(ExporterRegistry.getSupportedFormats()).toEqual(['x']);
        const formats = ExporterRegistry.getFormats();
        expect(formats).toEqual([{ value: 'x', label: 'X' }]);
    });

    it('Calls importScripts when importScripts is defined as a function', async () => {
        vi.resetModules();
        const called = [];
        globalThis.importScripts = (...scripts) => { called.push(...scripts); };
        await import('../../exporters/ExporterRegistry.js');
        ExporterRegistry = global.ExporterRegistry;
        expect(called.some(s => s.includes('BaseExporter.js'))).toBe(true);
        delete globalThis.importScripts;
        ExporterRegistry._reset();
    });

    it('Calls document.write when document.currentScript is not null', async () => {
        vi.resetModules();
        const written = [];
        const origWrite = document.write?.bind(document);
        document.write = (str) => { written.push(str); };
        Object.defineProperty(document, 'currentScript', {
            get: () => ({ tagName: 'SCRIPT' }),
            configurable: true
        });
        await import('../../exporters/ExporterRegistry.js');
        ExporterRegistry = global.ExporterRegistry;
        expect(written.some(s => s.includes('BaseExporter.js'))).toBe(true);
        if (origWrite) document.write = origWrite;
        Object.defineProperty(document, 'currentScript', {
            get: () => null,
            configurable: true
        });
        ExporterRegistry._reset();
    });
});
