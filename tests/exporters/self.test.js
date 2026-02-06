import { describe, it, expect, beforeEach } from 'vitest';

describe('Exporters self branch', () => {
    it('Attaches BaseExporter to self', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../exporters/BaseExporter.js');
        delete require.cache[path];
        await import('../../exporters/BaseExporter.js');
        expect(global.self.BaseExporter).toBeDefined();
        const exporter = new global.self.BaseExporter();
        expect(exporter.format).toBe('unknown');
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches FB2Exporter to self', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../exporters/FB2Exporter.js');
        delete require.cache[path];
        await import('../../exporters/FB2Exporter.js');
        expect(global.self.FB2Exporter).toBeDefined();
        const exporter = new global.self.FB2Exporter();
        expect(exporter.escapeXml('<>&')).toBe('&lt;&gt;&amp;');
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches EPUBExporter to self', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../exporters/EPUBExporter.js');
        delete require.cache[path];
        await import('../../exporters/EPUBExporter.js');
        expect(global.self.EPUBExporter).toBeDefined();
        const exporter = new global.self.EPUBExporter();
        expect(typeof exporter.escapeHtml).toBe('function');
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches PDFExporter to self', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../exporters/PDFExporter.js');
        delete require.cache[path];
        await import('../../exporters/PDFExporter.js');
        expect(global.self.PDFExporter).toBeDefined();
        const exporter = new global.self.PDFExporter();
        expect(typeof exporter.export).toBe('function');
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches ExporterFactory to self', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../exporters/ExporterFactory.js');
        delete require.cache[path];
        await import('../../exporters/ExporterFactory.js');
        expect(global.self.ExporterFactory).toBeDefined();
        const factory = global.self.ExporterFactory;
        expect(typeof factory.create).toBe('function');
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });
});