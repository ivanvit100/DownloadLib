import { it, expect, describe } from 'vitest';

describe('Self Attachment', () => {
    it('Attaches to self in DownloadManager', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../core/DownloadManager.js');
        delete require.cache[path];
        await import('../../core/DownloadManager.js');
        expect(global.self.DownloadManager).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches to self in EventBus', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../core/EventBus.js');
        delete require.cache[path];
        await import('../../core/EventBus.js');
        expect(global.self.EventBus).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches to self in RateLimiter', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../core/RateLimiter.js');
        delete require.cache[path];
        await import('../../core/RateLimiter.js');
        expect(global.self.RateLimiter).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches to self in ServiceRegistry', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../core/ServiceRegistry.js');
        delete require.cache[path];
        await import('../../core/ServiceRegistry.js');
        expect(global.self.ServiceRegistry).toBeDefined();
        expect(global.self.serviceRegistry).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });
});