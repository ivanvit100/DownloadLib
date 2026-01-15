/**
 * DownloadLib core module
 * Module to manage services (MangaLib, Ranobelib, etc.)
 * @module core/ServiceRegistry
 * @license MIT
 * @author ivanvit
 * @version 1.0.0
 */

'use strict';

(function(global) {
    console.log('[ServiceRegistry] Loading...');

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

        getAllServices() {
            return Array.from(this.services.values()).map(s => s.instance);
        }
    }

    global.ServiceRegistry = ServiceRegistry;
    global.serviceRegistry = new ServiceRegistry();
})(window);