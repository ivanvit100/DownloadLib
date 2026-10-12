import { vi } from 'vitest';

/**
 * Временный мост для тестов PopupController на период перехода (до этапа 9 плана).
 * Контроллер создаёт сервис через serviceRegistry.findServiceKey + createService,
 * а тесты описывают сервис сайта через getServiceByUrl (и переопределяют его
 * в отдельных тестах). Помощник добавляет к моку реестра findServiceKey и
 * createService, которые отдают этот же сервис; встроенные сервисы по ключу —
 * экземпляры globalThis.MangaLibService/RanobeLibService, прочие — getService.
 * @param {{getServiceByUrl: function(string): ?object, getService?: function(string): ?object}} registry -
 * Мок реестра.
 * @returns {object} Тот же мок с findServiceKey и createService.
 */
export function withServiceFactory(registry) {
    let found = null;
    registry.findServiceKey = vi.fn(url => {
        found = registry.getServiceByUrl(url);
        return found?.name ?? null;
    });
    registry.createService = vi.fn(key => {
        if (found && found.name === key) return found;
        if (key === 'mangalib' && globalThis.MangaLibService) return new globalThis.MangaLibService();
        if (key === 'ranobelib' && globalThis.RanobeLibService) return new globalThis.RanobeLibService();
        return registry.getService?.(key) ?? null;
    });
    return registry;
}
