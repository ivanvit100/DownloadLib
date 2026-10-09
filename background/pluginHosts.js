/**
 * DownloadLib background module
 * Hosts of the service plugins installed by the user
 * @module background/pluginHosts
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from '../core/BrowserApi.js';

let pluginHosts = {};

/**
 * Возвращает хосты сервисов из включённых плагинов: ключ сервиса → список хостов.
 * Обновляется функцией syncPluginHosts.
 * @returns {Object<string, string[]>} Хосты сервисов плагинов.
 */
export function getPluginHosts() {
    return pluginHosts;
}

/**
 * Читает включённые плагины с хостами из storage.local и обновляет хосты сервисов плагинов.
 * @returns {Promise<object[]>} Включённые плагины с непустым списком hosts
 * (и сервисные, и плагины форматов).
 * @throws {Error} Если storage.local не удалось прочитать.
 */
export async function syncPluginHosts() {
    if (!extensionApi?.storage?.local) return [];
    const result = await extensionApi.storage.local.get('custom_plugins');
    const plugins = (result?.custom_plugins || []).filter(
        p => p.enabled !== false && Array.isArray(p.hosts) && p.hosts.length
    );

    const hosts = {};
    for (const p of plugins)
        if (p.service) hosts[p.service] = p.hosts;
    pluginHosts = hosts;

    return plugins;
}
