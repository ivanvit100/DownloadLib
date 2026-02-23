import { it, expect, describe, beforeEach, afterEach, vi } from 'vitest';

describe('PopupController attaches to self', () => {
    let originalWindow;
    let originalSelf;
    let originalDocument;

    beforeEach(() => {
        originalWindow = global.window;
        originalSelf = global.self;
        originalDocument = global.document;
    });

    afterEach(() => {
        if (originalWindow !== undefined) global.window = originalWindow;
        else delete global.window;
        if (originalSelf !== undefined) global.self = originalSelf;
        else delete global.self;
        if (originalDocument !== undefined) global.document = originalDocument;
        else delete global.document;
    });

    it('Attaches PopupController to self when window is undefined', async () => {
        delete global.window;
        global.self = global;

        global.document = {
            getElementById: vi.fn().mockReturnValue(null),
            createElement: vi.fn().mockReturnValue({
                style: {},
                appendChild: vi.fn(),
                addEventListener: vi.fn(),
            }),
            head: { appendChild: vi.fn() },
        };

        global.chrome = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({ ok: true, downloads: [] }),
                getURL: vi.fn((path) => path),
            },
            tabs: {
                query: vi.fn().mockResolvedValue([]),
            },
            windows: {
                getCurrent: vi.fn().mockResolvedValue({ type: 'normal' }),
                create: vi.fn().mockResolvedValue({ id: 1 }),
                update: vi.fn().mockResolvedValue({}),
            },
        };

        const path = require.resolve('../../ui/PopupController.js');
        delete require.cache[path];
        await import('../../ui/PopupController.js');

        expect(global.self.PopupController).toBeDefined();
        expect(typeof global.self.PopupController).toBe('function');

        delete global.chrome;
    });
});