import { it, expect } from 'vitest';

it('Attaches to self when window is undefined', async () => {
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