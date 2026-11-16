/**
 * Контрактный тест сервисного плагина: plugins/ShlibService.js устанавливается через
 * PluginManager так же, как из настроек, и работает через PluginServiceProxy.
 * Менять здесь можно только подготовку окружения (например, место подмены сетевого
 * запроса); изменение проверок означает изменение контракта плагинов и требует
 * согласия владельца проекта.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../core/TabNetwork.js', async importOriginal => ({ ...await importOriginal(), requestViaTab: vi.fn() }));

const root = resolve(import.meta.dirname, '../..');
const pluginCode = readFileSync(resolve(root, 'plugins/ShlibService.js'), 'utf8');

const storage = {};
let PluginManager, serviceRegistry, requestViaTab, service;

beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    globalThis.chrome = {
        runtime: { id: 'ext', sendMessage: vi.fn(async () => ({ ok: true })) },
        tabs: { getCurrent: vi.fn(async () => undefined) },
        storage: {
            local: {
                get: vi.fn(async key => (key in storage ? { [key]: storage[key] } : {})),
                set: vi.fn(async values => { Object.assign(storage, values); })
            }
        }
    };
    await import('../../core/PluginApi.js');
    ({ serviceRegistry } = await import('../../services/BuiltinServices.js'));
    ({ PluginManager } = await import('../../core/PluginManager.js'));
    ({ requestViaTab } = await import('../../core/TabNetwork.js'));

    await PluginManager.save({ id: 'plugin_shlib', name: 'ShlibService', code: pluginCode, enabled: true });
    await PluginManager.loadAll();
    service = serviceRegistry.getServiceByUrl('https://v2.shlib.life/ru/manga/x');
});

describe('HLib service plugin (plugins/ShlibService.js)', () => {
    it('Is stored as a service plugin with its hosts and config', () => {
        const [record] = storage.custom_plugins;
        expect(record).toMatchObject({
            id: 'plugin_shlib', enabled: true, service: 'shlib', serviceLabel: 'Shlib',
            hosts: ['v2.shlib.life']
        });
        expect(record.serviceConfig).toMatchObject({ name: 'shlib', baseUrl: 'https://api.cdnlibs.org', siteId: '2' });
        expect(JSON.parse(localStorage.getItem('__dl_plugin_services__'))).toEqual({
            shlib: { label: 'Shlib', enabled: true }
        });
    });

    it('Registers a service that matches the plugin hosts and their subdomains', () => {
        expect(service).not.toBeNull();
        expect(service.name).toBe('shlib');
        expect(service).toBeInstanceOf(globalThis.BaseService);
        const ServiceClass = service.constructor;
        expect(ServiceClass.matches('https://v2.shlib.life/ru/manga/x')).toBe(true);
        expect(ServiceClass.matches('https://v2.shlib.life/')).toBe(true);
        expect(ServiceClass.matches('https://v2.shlib.life/ru?section=home-updates-3741444')).toBe(true);
        expect(ServiceClass.matches('https://mangalib.me/ru/manga/x')).toBe(false);
        expect(serviceRegistry.getServiceByUrl('https://mangalib.me/ru/manga/x').name).toBe('mangalib');
    });

    it('Exposes the plugin config to the popup (theme, label, long image splitting)', () => {
        expect(service.config).toMatchObject({
            label: 'Shlib', primaryColor: '#e53935', secondaryColor: '#c62828',
            siteUrl: 'https://v2.shlib.life', splitLongImages: true, maxImageHeight: 1800
        });
    });

    it('Uses the inherited BaseService matcher and host config', () => {
        expect(service.constructor.config.hosts).toContain('v2.shlib.life');
        expect(service.constructor.config.imageHosts).toContain('img3.hentaicdn.org');
        expect(service.constructor.matches('https://v2.shlib.life/ru?section=home-updates-3741444')).toBe(true);
    });

    it('Requests metadata from the plugin API with the plugin headers and returns the parsed response', async () => {
        requestViaTab.mockResolvedValueOnce({ ok: true, status: 200, text: '{"data":{"name":"X"}}', noTab: false });

        await expect(service.fetchMangaMetadata('123--x')).resolves.toEqual({ data: { name: 'X' } });

        const [url, options, serviceKey] = requestViaTab.mock.calls[0];
        expect(url.startsWith('https://api.cdnlibs.org/api/manga/123--x?fields[]=background&fields[]=eng_name')).toBe(true);
        expect(options.headers).toMatchObject({ 'Site-Id': '2', 'X-DL-Service': 'shlib' });
        expect(serviceKey).toBe('shlib');
    });
});
