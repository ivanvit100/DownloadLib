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

    function _injectScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => {
                script.remove();
                resolve();
            };

            script.onerror = () => {
                script.remove();
                reject(new Error(`[PluginManager] Failed to load plugin script: ${src}`));
            };
            document.head.appendChild(script);
        });
    }

    class PluginManager {
        static list() {
            return _storageGet();
        }

        static async save(plugin) {
            if (!plugin.format && plugin.code) {
                const meta = PluginManager.parseMetadata(plugin.code);
                if (meta.format) {
                    plugin.format = meta.format;
                    plugin.label  = meta.label || meta.format.toUpperCase();
                }
            }
            const plugins = await _storageGet();
            const idx = plugins.findIndex(p => p.id === plugin.id);
            if (idx >= 0) plugins[idx] = plugin;
            else plugins.push(plugin);
            await _storageSet(plugins);
            PluginManager._syncLocalStorage(plugins);
        }

        static async remove(id) {
            const plugins = await _storageGet();
            const updated = plugins.filter(p => p.id !== id);
            await _storageSet(updated);
            PluginManager._syncLocalStorage(updated);
        }

        static async toggle(id, enabled) {
            const plugins = await _storageGet();
            const plugin  = plugins.find(p => p.id === id);
            if (plugin) {
                plugin.enabled = enabled;
                await _storageSet(plugins);
                PluginManager._syncLocalStorage(plugins);
            }
        }

        static _syncLocalStorage(plugins) {
            try {
                const meta = {};
                plugins.forEach(p => {
                    if (p.format) {
                        meta[p.format] = {
                            label: p.label || p.format.toUpperCase(),
                            enabled: p.enabled !== false
                        };
                    }
                });
                localStorage.setItem('__dl_plugin_formats__', JSON.stringify(meta));
            } catch (e) {
                console.warn('[PluginManager] localStorage sync failed:', e);
            }
        }

        static generateId() {
            return `plugin_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        }

        static parseMetadata(code) {
            const formatMatch = code.match(/^\s*\*\s*@dl-format\s+(\S+)/m);
            const labelMatch  = code.match(/^\s*\*\s*@dl-label\s+(.+)/m);
            return {
                format: formatMatch?.[1]?.trim().toLowerCase() || null,
                label:  labelMatch?.[1]?.trim() || null
            };
        }

        static async getFormats() {
            const plugins = await _storageGet();
            return plugins
                .filter(p => p.enabled !== false && p.format)
                .map(p => ({ value: p.format, label: p.label || p.format.toUpperCase() }));
        }

        static async _tryScriptingExec(api, tabId, plugin) {
            try {
                const res = await api.runtime.sendMessage({
                    action: 'plugin:exec',
                    tabId,
                    code: plugin.code
                });
                if (res?.ok) {
                    console.log(`[PluginManager] Loaded (scripting): ${plugin.name || plugin.format}`);
                    return true;
                }
                console.warn(`[PluginManager] scripting exec failed for ${plugin.format}:`, res?.error);
            } catch (e) {
                console.warn(`[PluginManager] scripting exec error for ${plugin.format}:`, e.message);
            }
            return false;
        }

        static async _loadViaSW(api, plugin) {
            try {
                const res = await api.runtime.sendMessage({
                    action: 'plugin:cache',
                    format: plugin.format,
                    code:   plugin.code
                });
                if (!res?.ok) console.warn(`[PluginManager] Background cache failed for ${plugin.format}:`, res?.error || 'unknown error');
            } catch (e) {
                console.warn(`[PluginManager] Cache request failed for ${plugin.format}:`, e.message);
            }

            try {
                await _injectScript(`/plugin-runtime/${plugin.format}.js`);
                console.log(`[PluginManager] Loaded (SW): ${plugin.name || plugin.format}`);
            } catch (e) {
                console.error(`[PluginManager] Failed to load "${plugin.name || plugin.format}":`, e.message);
            }
        }

        static async loadAll() {
            const plugins = await _storageGet();
            const enabled = plugins.filter(p => p.enabled !== false && p.format);

            if (enabled.length === 0) {
                console.log('[PluginManager] No plugins to load');
                return;
            }

            console.log(`[PluginManager] Loading ${enabled.length} plugin(s)...`);

            const api = _getApi();
            if (!api?.runtime?.sendMessage) {
                console.error('[PluginManager] No runtime.sendMessage — cannot load plugins');
                return;
            }

            let ownTabId = null;
            try {
                const tab = await api.tabs.getCurrent();
                ownTabId = tab?.id ?? null;
            } catch { console.warn('[PluginManager] Failed to get current tab ID'); }

            for (const plugin of enabled) {
                if (ownTabId !== null && await PluginManager._tryScriptingExec(api, ownTabId, plugin))
                    continue;
                await PluginManager._loadViaSW(api, plugin);
            }
        }
    }

    global.PluginManager = PluginManager;
    console.log('[PluginManager] Loaded');
})(typeof window !== 'undefined' ? window : self);
