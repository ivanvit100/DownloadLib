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
});