/**
 * DownloadLib service registry
 * @module services/ServiceRegistry
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[ServiceRegistry] Loading...');

    const SERVICE_SCRIPTS = [
        '/services/mangalib/config.js',
        '/services/ranobelib/config.js',
        '/services/BaseService.js',
        '/services/mangalib/MangaLibService.js',
        '/services/ranobelib/RanobeLibService.js',
    ];

    class ServiceRegistry {
        constructor() {
            this.services = new Map();
            console.log('[ServiceRegistry] Instance created');
        }

        register(ServiceClass) {
            try {
                const instance = new ServiceClass();
                this.services.set(instance.name, {
                    class: ServiceClass,
                    instance: instance,
                    matcher: ServiceClass.matches
                });
                console.log(`[ServiceRegistry] Registered: ${instance.name}`);
            } catch (e) {
                console.error(`[ServiceRegistry] Failed to register service:`, e);
            }
        }

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

        getService(name) {
            return this.services.get(name)?.instance || null;
        }

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

        getAllServices() {
            return Array.from(this.services.values()).map(s => s.instance);
        }
    }

    global.ServiceRegistry = ServiceRegistry;
    global.serviceRegistry = new ServiceRegistry();

    if (typeof importScripts === 'function') {
        // Service Worker (Chrome MV3)
        importScripts(...SERVICE_SCRIPTS);
    } else if (typeof document !== 'undefined' && document.currentScript !== null) {
        // Браузерная страница
        SERVICE_SCRIPTS.forEach(src => {
            document.write('<script src="' + src + '"><\/script>');
        });
    }

    console.log('[ServiceRegistry] Loaded');
})(typeof window !== 'undefined' ? window : self);