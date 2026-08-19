/**
 * DownloadLib core module
 * Manages user-defined plugin scripts (custom services and exporters)
 * @module core/PluginManager
 * @license MIT
 * @author ivanvit
 * @version 1.0.9
 */

'use strict';

(function(global) {
    console.log('[PluginManager] Loading...');

    const STORAGE_KEY = 'custom_plugins';

    function _getApi() {
        return typeof global.getExtensionApi === 'function'
            ? global.getExtensionApi()
            : ((typeof global.browser !== 'undefined' && global.browser) ||
               (typeof global.chrome !== 'undefined' && global.chrome) ||
               null);
    }

    async function _storageGet() {
        const api = _getApi();
        if (!api?.storage?.local) return [];
        try {
            const result = await api.storage.local.get(STORAGE_KEY);
            return (result && result[STORAGE_KEY]) || [];
        } catch (e) {
            console.warn('[PluginManager] Failed to read storage:', e);
            return [];
        }
    }

    async function _storageSet(plugins) {
        const api = _getApi();
        if (!api?.storage?.local) return;
        await api.storage.local.set({ [STORAGE_KEY]: plugins });
    }

    function _injectScript(code) {
        return new Promise((resolve, reject) => {
            const blob = new Blob([code], { type: 'text/javascript' });
            const url = URL.createObjectURL(blob);
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => {
                URL.revokeObjectURL(url);
                script.remove();
                resolve();
            };

            script.onerror = (e) => {
                URL.revokeObjectURL(url);
                script.remove();
                reject(e);
            };
            document.head.appendChild(script);
        });
    }

    class PluginManager {
        static list() {
            return _storageGet();
        }

        static async save(plugin) {
            const plugins = await _storageGet();
            const idx = plugins.findIndex(p => p.id === plugin.id);
            if (idx >= 0) plugins[idx] = plugin;
            else plugins.push(plugin);
            await _storageSet(plugins);
        }

        static async remove(id) {
            const plugins = await _storageGet();
            await _storageSet(plugins.filter(p => p.id !== id));
        }

        static async toggle(id, enabled) {
            const plugins = await _storageGet();
            const plugin = plugins.find(p => p.id === id);
            if (plugin) {
                plugin.enabled = enabled;
                await _storageSet(plugins);
            }
        }

        static generateId() {
            return `plugin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        static async loadAll() {
            const plugins = await _storageGet();
            const enabled = plugins.filter(p => p.enabled !== false);

            if (enabled.length === 0) {
                console.log('[PluginManager] No plugins to load');
                return;
            }

            console.log(`[PluginManager] Loading ${enabled.length} plugin(s)...`);

            for (const plugin of enabled) {
                try {
                    await _injectScript(plugin.code);
                    console.log(`[PluginManager] Loaded: ${plugin.name}`);
                } catch (e) {
                    console.error(`[PluginManager] Failed to load "${plugin.name}":`, e);
                }
            }
        }
    }

    global.PluginManager = PluginManager;
    console.log('[PluginManager] Loaded');
})(typeof window !== 'undefined' ? window : self);
