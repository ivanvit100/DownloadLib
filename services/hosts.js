/**
 * DownloadLib service hosts
 * Pure lookups over the built-in service configs and plugin hosts:
 * which service a URL belongs to, tab and webRequest patterns, slugs
 * @module services/hosts
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { mangalibConfig } from './mangalib/config.js';
import { ranobelibConfig } from './ranobelib/config.js';

/**
 * Конфиги встроенных сервисов — единственный источник их доменов. Порядок важен:
 * если хост указан у нескольких сервисов, URL относится к первому из них.
 * Поля конфига, которые читает модуль:
 * - `hosts` — сайты сервиса (хост вместе с поддоменами);
 * - `imageHosts` — CDN изображений (хост вместе с поддоменами);
 * - `baseUrl` — адрес API;
 * - `siteId` — значение заголовка Site-Id в запросах к API.
 * @type {object[]}
 */
export const serviceConfigs = [mangalibConfig, ranobelibConfig];

/**
 * Хосты сервисов из плагинов: ключ сервиса → список хостов.
 * @typedef {Object<string, string[]>} PluginHosts
 */

/**
 * Возвращает имя хоста URL в нижнем регистре.
 * @param {*} url - Проверяемый URL.
 * @returns {?string} Имя хоста, либо null, если URL некорректен.
 */
function hostnameOf(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * Проверяет, относится ли URL к одному из хостов: хост совпадает или является его поддоменом.
 * @param {*} url - Проверяемый URL.
 * @param {string[]} [hosts] - Список хостов.
 * @returns {boolean} true, если хост URL совпадает с одним из хостов или является его поддоменом.
 */
export function matchesHosts(url, hosts = []) {
    const hostname = hostnameOf(url);
    if (!hostname) return false;
    return hosts.some(host => {
        const h = host.toLowerCase();
        return hostname === h || hostname.endsWith(`.${h}`);
    });
}

/**
 * Возвращает конфиг встроенного сервиса по ключу.
 * @param {?string} serviceKey - Ключ сервиса.
 * @returns {?object} Конфиг сервиса, либо null, если сервис не встроенный.
 */
export function serviceConfig(serviceKey) {
    return serviceConfigs.find(config => config.name === serviceKey) ?? null;
}

/**
 * Определяет сервис, к сайту или CDN изображений которого относится URL. Сначала
 * проверяются встроенные сервисы, затем хосты плагинов.
 * @param {*} url - Проверяемый URL.
 * @param {PluginHosts} [pluginHosts] - Хосты сервисов из плагинов.
 * @returns {?string} Ключ сервиса, либо null, если URL не относится ни к одному сервису.
 */
export function serviceKeyForUrl(url, pluginHosts = {}) {
    const builtin = serviceConfigs.find(config =>
        matchesHosts(url, config.hosts) || matchesHosts(url, config.imageHosts));
    if (builtin) return builtin.name;
    return Object.entries(pluginHosts).find(([, hosts]) => matchesHosts(url, hosts))?.[0] ?? null;
}

/**
 * Проверяет, относится ли URL к сайту одного из сервисов (CDN изображений не учитываются).
 * @param {*} url - Проверяемый URL.
 * @param {PluginHosts} [pluginHosts] - Хосты сервисов из плагинов.
 * @returns {boolean} true, если URL относится к сайту сервиса.
 */
export function isServiceHost(url, pluginHosts = {}) {
    return serviceConfigs.some(config => matchesHosts(url, config.hosts)) ||
        Object.values(pluginHosts).some(hosts => matchesHosts(url, hosts));
}

/**
 * Проверяет, относится ли URL к CDN изображений одного из встроенных сервисов.
 * @param {*} url - Проверяемый URL.
 * @returns {boolean} true, если хост URL входит в imageHosts одного из сервисов.
 */
export function isImageHost(url) {
    return serviceConfigs.some(config => matchesHosts(url, config.imageHosts));
}

/**
 * Проверяет, обращается ли URL к API одного из встроенных сервисов (хост из baseUrl).
 * @param {*} url - Проверяемый URL.
 * @returns {boolean} true, если хост URL совпадает с хостом API сервиса.
 */
export function isApiUrl(url) {
    const hostname = hostnameOf(url);
    return !!hostname && serviceConfigs.some(config => hostnameOf(config.baseUrl) === hostname);
}

/**
 * Определяет встроенный сервис по значению заголовка Site-Id.
 * @param {*} siteId - Значение заголовка.
 * @returns {?string} Ключ сервиса, либо null, если такого siteId нет.
 */
export function serviceKeyForSiteId(siteId) {
    const id = String(siteId ?? '').trim();
    if (!id) return null;
    return serviceConfigs.find(config => String(config.siteId) === id)?.name ?? null;
}

/**
 * Строит match-паттерны для поиска открытой вкладки сервиса (tabs.query).
 * @param {?string} serviceKey - Ключ сервиса.
 * @param {PluginHosts} [pluginHosts] - Хосты сервисов из плагинов.
 * @returns {string[]} Паттерны вида '*://host/*', либо пустой список для неизвестного сервиса.
 */
export function tabPatterns(serviceKey, pluginHosts = {}) {
    const hosts = serviceConfig(serviceKey)?.hosts ?? pluginHosts[serviceKey] ?? [];
    return hosts.map(host => `*://${host}/*`);
}

/**
 * Строит фильтр URL для слушателей webRequest: сайты, CDN изображений и API
 * всех встроенных сервисов вместе с поддоменами.
 * @returns {string[]} Паттерны вида 'https://*.host/*' без повторов.
 */
export function webRequestUrls() {
    const hosts = new Set();
    for (const config of serviceConfigs) {
        config.hosts.forEach(host => hosts.add(host));
        (config.imageHosts || []).forEach(host => hosts.add(host));
        const apiHost = hostnameOf(config.baseUrl);
        if (apiHost) hosts.add(apiHost);
    }
    return [...hosts].map(host => `https://*.${host}/*`);
}

/**
 * Возвращает origin сайтов сервиса, либо всех встроенных сервисов.
 * @param {?string} [serviceKey] - Ключ сервиса; без него — все встроенные сервисы.
 * @returns {string[]} Список origin вида 'https://host'.
 */
export function serviceOrigins(serviceKey) {
    const configs = serviceKey ? [serviceConfig(serviceKey)].filter(Boolean) : serviceConfigs;
    return configs.flatMap(config => config.hosts.map(host => `https://${host}`));
}

/**
 * Подставляет slug в шаблон адреса страницы тайтла (поле конфига titleUrl).
 * @param {?string} template - Шаблон с плейсхолдером '{slug}'.
 * @param {string} slug - Slug тайтла.
 * @returns {?string} Адрес страницы тайтла, либо null, если шаблона нет.
 */
export function buildTitleUrl(template, slug) {
    return template ? template.replace('{slug}', encodeURIComponent(slug)) : null;
}

/**
 * Извлекает slug тайтла из URL страницы манги или книги.
 * @param {*} url - URL страницы тайтла.
 * @returns {?string} Slug тайтла, либо null, если URL не похож на страницу тайтла.
 */
export function extractSlug(url) {
    const match = typeof url === 'string' ? url.match(/\/(?:manga|book)\/([^/?#]+)/) : null;
    return match ? match[1] : null;
}
