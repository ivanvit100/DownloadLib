import { it, expect, describe } from 'vitest';

describe('Services attaches to self', () => {
    it('Attaches BaseService to self', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const path = require.resolve('../../services/BaseService.js');
        delete require.cache[path];
        await import('../../services/BaseService.js');
        expect(global.self.BaseService).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches RanobeLibService to self', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const basePath = require.resolve('../../services/BaseService.js');
        delete require.cache[basePath];
        await import('../../services/BaseService.js');
        const path = require.resolve('../../services/ranobelib/RanobeLibService.js');
        delete require.cache[path];
        await import('../../services/ranobelib/RanobeLibService.js');
        expect(global.self.RanobeLibService).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });

    it('Attaches MangaLibService to self', async () => {
        const originalWindow = global.window;
        const originalSelf = global.self;
        delete global.window;
        global.self = global;
        const basePath = require.resolve('../../services/BaseService.js');
        delete require.cache[basePath];
        await import('../../services/BaseService.js');
        const path = require.resolve('../../services/mangalib/MangaLibService.js');
        delete require.cache[path];
        await import('../../services/mangalib/MangaLibService.js');
        expect(global.self.MangaLibService).toBeDefined();
        if (originalWindow !== undefined) global.window = originalWindow;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
    });
});