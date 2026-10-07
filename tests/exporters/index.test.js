import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('exporters/index', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('Registers all built-in exporters in order', async () => {
        const { ExporterRegistry } = await import('../../exporters/index.js');
        expect(ExporterRegistry.getFormats()).toEqual([
            { value: 'fb2', label: 'FB2' },
            { value: 'epub', label: 'EPUB' },
            { value: 'mobi', label: 'MOBI' },
            { value: 'pdf', label: 'PDF' },
            { value: 'simple', label: 'TXT/JPEG' }
        ]);
    });

    it('Re-exports the same registry class as ExporterRegistry.js', async () => {
        const { ExporterRegistry } = await import('../../exporters/index.js');
        const { ExporterRegistry: Direct } = await import('../../exporters/ExporterRegistry.js');
        expect(ExporterRegistry).toBe(Direct);
    });

    it('Creates instances of the registered classes', async () => {
        const { ExporterRegistry } = await import('../../exporters/index.js');
        const { SimpleExporter } = await import('../../exporters/SimpleExporter.js');
        expect(ExporterRegistry.create('simple')).toBeInstanceOf(SimpleExporter);
    });
});
