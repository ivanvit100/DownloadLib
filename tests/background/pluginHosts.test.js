import { describe, it, expect, vi, afterEach } from 'vitest';

let pluginHosts;

/**
 * Загружает модуль заново с фейковым storage.local.
 * @param {?function} get - Реализация storage.local.get, либо null без storage.
 * @returns {Promise<void>}
 */
async function load(get) {
    vi.resetModules();
    globalThis.browser = get ? { storage: { local: { get } } } : {};
    pluginHosts = await import('../../background/pluginHosts.js');
}

afterEach(() => {
    delete globalThis.browser;
});

describe('pluginHosts', () => {
    it('Has no hosts before the first sync', async () => {
        await load(vi.fn());
        expect(pluginHosts.getPluginHosts()).toEqual({});
    });

    it('Collects hosts of enabled service plugins and returns all enabled plugins with hosts', async () => {
        const plugins = [
            { service: 'hlib', hosts: ['hentailib.me'] },
            { service: 'off', hosts: ['off.example'], enabled: false },
            { service: 'nohosts', hosts: [] },
            { service: 'badhosts', hosts: 'x.example' },
            { format: 'cbz', hosts: ['cbz.example'] }
        ];
        await load(vi.fn().mockResolvedValue({ custom_plugins: plugins }));

        const enabled = await pluginHosts.syncPluginHosts();
        expect(enabled.map(p => p.service || p.format)).toEqual(['hlib', 'cbz']);
        expect(pluginHosts.getPluginHosts()).toEqual({ hlib: ['hentailib.me'] });
    });

    it('Replaces the hosts on every sync', async () => {
        const get = vi.fn().mockResolvedValue({ custom_plugins: [{ service: 'hlib', hosts: ['hentailib.me'] }] });
        await load(get);
        await pluginHosts.syncPluginHosts();

        get.mockResolvedValue({});
        await pluginHosts.syncPluginHosts();
        expect(pluginHosts.getPluginHosts()).toEqual({});
    });

    it('Returns no plugins without the storage API', async () => {
        await load(null);
        await expect(pluginHosts.syncPluginHosts()).resolves.toEqual([]);
    });

    it('Rejects and keeps the previous hosts when storage cannot be read', async () => {
        const get = vi.fn().mockResolvedValue({ custom_plugins: [{ service: 'hlib', hosts: ['hentailib.me'] }] });
        await load(get);
        await pluginHosts.syncPluginHosts();

        get.mockRejectedValue(new Error('storage error'));
        await expect(pluginHosts.syncPluginHosts()).rejects.toThrow('storage error');
        expect(pluginHosts.getPluginHosts()).toEqual({ hlib: ['hentailib.me'] });
    });
});
