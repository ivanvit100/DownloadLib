import { vi } from 'vitest';

/**
 * Дополняет мок реестра сервисов для тестов PopupController. Контроллер создаёт
 * сервис через serviceRegistry.findServiceKey + createService, а тесты описывают
 * сервис сайта через getServiceByUrl (и переопределяют его в отдельных тестах).
 * Помощник добавляет к моку реестра findServiceKey и createService, которые отдают
 * этот же сервис; встроенные сервисы по ключу — экземпляры классов из хранилища
 * моков теста (MangaLibService/RanobeLibService), прочие — getService.
 * @param {{getServiceByUrl: function(string): ?object, getService?: function(string): ?object}} registry -
 * Мок реестра.
 * @param {{MangaLibService?: function, RanobeLibService?: function}} [classes] - Хранилище
 * моков теста с классами встроенных сервисов; читается в момент вызова createService.
 * @returns {object} Тот же мок с findServiceKey и createService.
 */
export function withServiceFactory(registry, classes = {}) {
    let found = null;
    registry.findServiceKey = vi.fn(url => {
        found = registry.getServiceByUrl(url);
        return found?.name ?? null;
    });
    registry.createService = vi.fn(key => {
        if (found && found.name === key) return found;
        if (key === 'mangalib' && classes.MangaLibService) return new classes.MangaLibService();
        if (key === 'ranobelib' && classes.RanobeLibService) return new classes.RanobeLibService();
        return registry.getService?.(key) ?? null;
    });
    return registry;
}
