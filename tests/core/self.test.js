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
        const path = require.resolve('../../services/ServiceRegistry.js');
        delete require.cache[path];
        await import('../../services/ServiceRegistry.js');
        expect(global.self.ServiceRegistry).toBeDefined();
        expect(global.self.serviceRegistry).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches to self in MangaPatcher', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../core/MangaPatcher.js');
        delete require.cache[path];
        await import('../../core/MangaPatcher.js');
        expect(global.self.MangaPatcher).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches to self in Storage', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../core/Storage.js');
        delete require.cache[path];
        await import('../../core/Storage.js');
        expect(global.self.Storage).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches to self in DownloadHistory', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const storagePath = require.resolve('../../core/Storage.js');
        delete require.cache[storagePath];
        await import('../../core/Storage.js');
        const histPath = require.resolve('../../core/DownloadHistory.js');
        delete require.cache[histPath];
        await import('../../core/DownloadHistory.js');
        expect(global.self.DownloadHistory).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches to self in AuthManager', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        const originalBrowser = global.browser;
        delete global.window;
        global.self = global;
        global.browser = { runtime: { sendMessage: async () => ({ token: null }) } };
        const path = require.resolve('../../core/AuthManager.js');
        delete require.cache[path];
        await import('../../core/AuthManager.js');
        expect(global.self.AuthManager).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        else delete global.window;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
        if (originalBrowser !== undefined) global.browser = originalBrowser;
        else delete global.browser;
    });
});