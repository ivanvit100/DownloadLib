import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('services/index', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('Registers the built-in services', async () => {
        const { serviceRegistry } = await import('../../services/index.js');
        expect([...serviceRegistry.services.keys()]).toEqual(['mangalib', 'ranobelib']);
    });

    it('Re-exports the shared registry from ServiceRegistry.js', async () => {
        const { serviceRegistry } = await import('../../services/index.js');
        const { serviceRegistry: direct } = await import('../../services/ServiceRegistry.js');
        expect(serviceRegistry).toBe(direct);
    });

    it('Resolves services by URL', async () => {
        const { serviceRegistry } = await import('../../services/index.js');
        expect(serviceRegistry.getServiceByUrl('https://mangalib.me/ru/manga/test')?.name).toBe('mangalib');
        expect(serviceRegistry.getServiceByUrl('https://ranobelib.me/ru/book/test')?.name).toBe('ranobelib');
        expect(serviceRegistry.getServiceByUrl('https://example.com/')).toBeNull();
    });
});
