/**
 * Контрактный тест сервисного плагина: plugins/HLibService.js устанавливается через
 * PluginManager так же, как из настроек, и работает через PluginServiceProxy.
 * Менять здесь можно только подготовку окружения (например, место подмены сетевого
 * запроса); изменение проверок означает изменение контракта плагинов и требует
 * согласия владельца проекта.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../core/BrowserApi.js', async importOriginal => ({ ...await importOriginal(), requestViaTab: vi.fn() }));

const root = resolve(import.meta.dirname, '../..');
const pluginCode = readFileSync(resolve(root, 'plugins/HLibService.js'), 'utf8');

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
    await import('../../core/pluginApi.js');
    ({ serviceRegistry } = await import('../../services/index.js'));
    ({ PluginManager } = await import('../../core/PluginManager.js'));
    ({ requestViaTab } = await import('../../core/BrowserApi.js'));

    await PluginManager.save({ id: 'plugin_hlib', name: 'HLibService', code: pluginCode, enabled: true });
    await PluginManager.loadAll();
    service = serviceRegistry.getServiceByUrl('https://hentailib.me/ru/manga/x');
});

describe('HLib service plugin (plugins/HLibService.js)', () => {
    it('Is stored as a service plugin with its hosts and config', () => {
        const [record] = storage.custom_plugins;
        expect(record).toMatchObject({
            id: 'plugin_hlib', enabled: true, service: 'hlib', serviceLabel: 'HLib',
            hosts: ['hentailib.me', 'hentailib.org']
        });
        expect(record.serviceConfig).toMatchObject({ name: 'hlib', baseUrl: 'https://api.cdnlibs.org', siteId: '4' });
        expect(JSON.parse(localStorage.getItem('__dl_plugin_services__'))).toEqual({
            hlib: { label: 'HLib', enabled: true }
        });
    });

    it('Registers a service that matches the plugin hosts and their subdomains', () => {
        expect(service).not.toBeNull();
        expect(service.name).toBe('hlib');
        expect(service).toBeInstanceOf(globalThis.BaseService);
        const ServiceClass = service.constructor;
        expect(ServiceClass.matches('https://hentailib.org/ru/manga/x')).toBe(true);
        expect(ServiceClass.matches('https://v2.hentailib.me/')).toBe(true);
        expect(ServiceClass.matches('https://mangalib.me/ru/manga/x')).toBe(false);
        expect(serviceRegistry.getServiceByUrl('https://mangalib.me/ru/manga/x').name).toBe('mangalib');
    });

    it('Exposes the plugin config to the popup (theme, label, long image splitting)', () => {
        expect(service.config).toMatchObject({
            label: 'HLib', primaryColor: '#e53935', secondaryColor: '#c62828',
            siteUrl: 'https://hentailib.me', splitLongImages: true, maxImageHeight: 1800
        });
    });

    it('Builds page URLs from the image server of the plugin config', () => {
        expect(service.resolvePageUrl('/manga/x/chapters/1/01.jpg'))
            .toBe('https://img3h.hentaicdn.org/manga/x/chapters/1/01.jpg');
        expect(service.resolvePageUrl('manga/x/02.jpg')).toBe('https://img3h.hentaicdn.org/manga/x/02.jpg');
        expect(service.resolvePageUrl({ src: 'https://cdn.example/03.jpg' })).toBe('https://cdn.example/03.jpg');
    });

    it('Requests metadata from the plugin API with the plugin headers and returns the parsed response', async () => {
        requestViaTab.mockResolvedValueOnce({ ok: true, status: 200, text: '{"data":{"name":"X"}}', noTab: false });

        await expect(service.fetchMangaMetadata('123--x')).resolves.toEqual({ data: { name: 'X' } });

        const [url, options, serviceKey] = requestViaTab.mock.calls[0];
        expect(url.startsWith('https://api.cdnlibs.org/api/manga/123--x?fields[]=background&fields[]=eng_name')).toBe(true);
        expect(options.headers).toMatchObject({ 'Site-Id': '4', 'X-DL-Service': 'hlib' });
        expect(serviceKey).toBe('hlib');
    });
});
