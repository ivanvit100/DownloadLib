import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const NAMES = ['BaseExporter', 'ExporterRegistry', 'BaseService', 'serviceRegistry'];

describe('core/pluginApi', () => {
    beforeEach(() => {
        vi.resetModules();
        NAMES.forEach(name => delete globalThis[name]);
    });

    afterEach(() => {
        NAMES.forEach(name => delete globalThis[name]);
    });

    it('Publishes plugin base classes and registries on globalThis', async () => {
        await import('../../core/pluginApi.js');
        const { BaseExporter } = await import('../../exporters/BaseExporter.js');
        const { ExporterRegistry } = await import('../../exporters/ExporterRegistry.js');
        const { BaseService } = await import('../../services/BaseService.js');
        const { serviceRegistry } = await import('../../services/ServiceRegistry.js');

        expect(globalThis.BaseExporter).toBe(BaseExporter);
        expect(globalThis.ExporterRegistry).toBe(ExporterRegistry);
        expect(globalThis.BaseService).toBe(BaseService);
        expect(globalThis.serviceRegistry).toBe(serviceRegistry);
    });

    it('Lets a classic plugin script register an exporter', async () => {
        await import('../../core/pluginApi.js');
        class PluginExporter extends globalThis.BaseExporter {}
        globalThis.ExporterRegistry.register('cbz', PluginExporter, { label: 'CBZ' });
        const { ExporterRegistry } = await import('../../exporters/ExporterRegistry.js');
        expect(ExporterRegistry.create('cbz')).toBeInstanceOf(PluginExporter);
    });
});
