import { describe, it, expect, vi, beforeEach } from 'vitest';

let ServiceRegistry;

beforeEach(async () => {
    const path = require.resolve('../../services/ServiceRegistry.js');
    delete require.cache[path];
    await import('../../services/ServiceRegistry.js');
    ServiceRegistry = global.ServiceRegistry;
});

describe('ServiceRegistry', () => {
    it('Creates an instance and logs', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const registry = new ServiceRegistry();
        expect(registry).toBeInstanceOf(ServiceRegistry);
        expect(logSpy).toHaveBeenCalledWith('[ServiceRegistry] Instance created');
        logSpy.mockRestore();
    });

    it('Registers a service and logs', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        class DummyService {
            constructor() { this.name = 'Dummy'; }
            static matches(url) { return url.includes('dummy'); }
        }
        const registry = new ServiceRegistry();
        registry.register(DummyService);
        expect(registry.getService('Dummy')).toBeInstanceOf(DummyService);
        expect(logSpy).toHaveBeenCalledWith('[ServiceRegistry] Registered: Dummy');
        logSpy.mockRestore();
    });

    it('Handles registration errors and logs', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        class BadService {
            constructor() { throw new Error('fail'); }
            static matches() { return false; }
        }
        const registry = new ServiceRegistry();
        registry.register(BadService);
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('Returns correct instance in getServiceByUrl', () => {
        class DummyService {
            constructor() { this.name = 'Dummy'; }
            static matches(url) { return url.includes('dummy'); }
        }
        class OtherService {
            constructor() { this.name = 'Other'; }
            static matches(url) { return url.includes('other'); }
        }
        const registry = new ServiceRegistry();
        registry.register(DummyService);
        registry.register(OtherService);
        expect(registry.getServiceByUrl('http://dummy.com')).toBeInstanceOf(DummyService);
        expect(registry.getServiceByUrl('http://other.com')).toBeInstanceOf(OtherService);
        expect(registry.getServiceByUrl('http://none.com')).toBeNull();
    });

    it('Handles matcher errors in getServiceByUrl', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        class BadMatcherService {
            constructor() { this.name = 'Bad'; }
            static matches() { throw new Error('matcher fail'); }
        }
        const registry = new ServiceRegistry();
        registry.register(BadMatcherService);
        expect(registry.getServiceByUrl('http://bad.com')).toBeNull();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('Returns null for unknown service', () => {
        const registry = new ServiceRegistry();
        expect(registry.getService('Unknown')).toBeNull();
    });

    it('Returns all registered instances in getAllServices', () => {
        class S1 { constructor() { this.name = 'S1'; } static matches() { return false; } }
        class S2 { constructor() { this.name = 'S2'; } static matches() { return false; } }
        const registry = new ServiceRegistry();
        registry.register(S1);
        registry.register(S2);
        const all = registry.getAllServices();
        expect(all.length).toBe(2);
        expect(all.some(s => s instanceof S1)).toBe(true);
        expect(all.some(s => s instanceof S2)).toBe(true);
    });

    it('Global serviceRegistry is defined', () => {
        expect(global.serviceRegistry).toBeInstanceOf(ServiceRegistry);
    });

    it('createService returns new instance by name', () => {
        class DummyService {
            constructor() { this.name = 'Dummy'; }
            static matches() { return false; }
        }
        const registry = new ServiceRegistry();
        registry.register(DummyService);
        const instance = registry.createService('Dummy');
        expect(instance).toBeInstanceOf(DummyService);
    });

    it('createService returns null for unknown name', () => {
        const registry = new ServiceRegistry();
        expect(registry.createService('Unknown')).toBeNull();
    });

    it('createService returns a fresh instance each call', () => {
        class DummyService {
            constructor() { this.name = 'Dummy'; }
            static matches() { return false; }
        }
        const registry = new ServiceRegistry();
        registry.register(DummyService);
        const a = registry.createService('Dummy');
        const b = registry.createService('Dummy');
        expect(a).not.toBe(b);
    });

    it('createService returns null and logs error when constructor throws', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        let calls = 0;
        class BadService {
            constructor() {
                if (++calls > 1) throw new Error('fail');
                this.name = 'Bad';
            }
            static matches() { return false; }
        }
        const registry = new ServiceRegistry();
        registry.register(BadService);
        expect(registry.createService('Bad')).toBeNull();
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('Сalls importScripts in service worker context', async () => {
        vi.resetModules();
        const importScriptsMock = vi.fn();
        global.importScripts = importScriptsMock;
        await import('../../services/ServiceRegistry.js');
        expect(importScriptsMock).toHaveBeenCalled();
        delete global.importScripts;
    });

    it('Сalls document.write in browser page context', async () => {
        vi.resetModules();
        delete global.importScripts;
        const writeMock = vi.spyOn(document, 'write').mockImplementation(() => {});
        Object.defineProperty(document, 'currentScript', {
            get: () => document.createElement('script'),
            configurable: true
        });
        await import('../../services/ServiceRegistry.js');
        expect(writeMock).toHaveBeenCalled();
        writeMock.mockRestore();
        delete document.currentScript;
    });
});