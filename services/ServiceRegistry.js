/**
 * DownloadLib service registry
 * @module services/ServiceRegistry
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

console.log('[ServiceRegistry] Loading...');

/**
 * Реестр доступных сервисов-парсеров сайтов (встроенных и добавленных плагинами):
 * связывает имя сервиса с его классом, экземпляром-синглтоном и статическим
 * методом matches для определения сервиса по URL страницы. Встроенные сервисы
 * регистрирует services/index.js.
 */
export class ServiceRegistry {
    /**
     * Создаёт реестр с пустой картой сервисов.
     */
    constructor() {
        this.services = new Map();
        console.log('[ServiceRegistry] Instance created');
    }

    /**
     * Регистрирует класс сервиса: создаёт его экземпляр-синглтон и сохраняет
     * вместе с классом и статическим методом matches.
     * @param {function} ServiceClass - Класс сервиса (наследник BaseService),
     * реализующий статический метод matches(url).
     * @returns {void}
     */
    register(ServiceClass) {
        try {
            const instance = new ServiceClass();
            this.services.set(instance.name, {
                class: ServiceClass,
                instance: instance,
                matcher: url => ServiceClass.matches(url)
            });
            console.log(`[ServiceRegistry] Registered: ${instance.name}`);
        } catch (e) {
            console.error(`[ServiceRegistry] Failed to register service:`, e);
        }
    }

    /**
     * Находит зарегистрированный сервис-синглтон, чей matcher соответствует URL.
     * @param {string} url - Проверяемый URL страницы.
     * @returns {?object} Экземпляр-синглтон подходящего сервиса, либо null,
     * если ни один сервис не совпал.
     */
    getServiceByUrl(url) {
        for (const [name, { instance, matcher }] of this.services) {
            console.log(name, matcher);
            try {
                if (matcher(url)) return instance;
            } catch (e) {
                console.error(`[ServiceRegistry] Error checking matcher for ${name}:`, e);
            }
        }
        return null;
    }

    /**
     * Возвращает зарегистрированный экземпляр-синглтон сервиса по имени.
     * @param {string} name - Имя сервиса.
     * @returns {?object} Экземпляр-синглтон сервиса, либо null, если не зарегистрирован.
     */
    getService(name) {
        return this.services.get(name)?.instance || null;
    }

    /**
     * Создаёт новый (не общий) экземпляр сервиса по имени — используется там,
     * где нужен изолированный от синглтона объект (например, чтобы безопасно
     * подставить в него собственный токен авторизации).
     * @param {string} name - Имя сервиса.
     * @returns {?object} Новый экземпляр сервиса, либо null, если сервис
     * не зарегистрирован или его конструктор выбросил исключение.
     */
    createService(name) {
        const entry = this.services.get(name);
        if (!entry) return null;
        try {
            return new entry.class();
        } catch (e) {
            console.error(`[ServiceRegistry] Failed to create service: ${name}`, e);
            return null;
        }
    }

    /**
     * Возвращает экземпляры-синглтоны всех зарегистрированных сервисов.
     * @returns {object[]} Список экземпляров сервисов.
     */
    getAllServices() {
        return Array.from(this.services.values()).map(s => s.instance);
    }
}

/**
 * Общий реестр сервисов текущего контекста.
 * @type {ServiceRegistry}
 */
export const serviceRegistry = new ServiceRegistry();

console.log('[ServiceRegistry] Loaded');
