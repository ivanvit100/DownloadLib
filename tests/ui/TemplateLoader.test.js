import { describe, it, expect, beforeEach, vi } from 'vitest';

let TemplateLoader;

beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="anchor"></div>';
    ({ TemplateLoader } = await import('../../ui/TemplateLoader.js'));
});

describe('TemplateLoader', () => {
    it('exports the loader', () => {
        expect(TemplateLoader).toBeDefined();
    });

    it('init sets _anchor when element exists', () => {
        TemplateLoader.init('anchor');
        expect(TemplateLoader._anchor).toBe(document.getElementById('anchor'));
    });

    it('init logs error and leaves _anchor null when element not found', () => {
        const errorSpy = vi.spyOn(console, 'error');
        TemplateLoader.init('does-not-exist');
        expect(errorSpy).toHaveBeenCalledWith('[TemplateLoader] Anchor element not found:', 'does-not-exist');
        expect(TemplateLoader._anchor).toBeNull();
        errorSpy.mockRestore();
    });

    it('show logs error and returns early when anchor not initialized', async () => {
        const errorSpy = vi.spyOn(console, 'error');
        await TemplateLoader.show('title');
        expect(errorSpy).toHaveBeenCalledWith('[TemplateLoader] Anchor not initialized');
        errorSpy.mockRestore();
    });

    it('show fetches template, sets innerHTML and _current', async () => {
        TemplateLoader.init('anchor');
        global.fetch = vi.fn(async () => ({ ok: true, text: async () => '<p>content</p>' }));
        await TemplateLoader.show('title');
        expect(document.getElementById('anchor').innerHTML).toBe('<p>content</p>');
        expect(TemplateLoader.current()).toBe('title');
        delete global.fetch;
    });

    it('show calls onReady callback after loading', async () => {
        TemplateLoader.init('anchor');
        global.fetch = vi.fn(async () => ({ ok: true, text: async () => '<p>x</p>' }));
        const cb = vi.fn();
        await TemplateLoader.show('history', cb);
        expect(cb).toHaveBeenCalled();
        delete global.fetch;
    });

    it('show skips onReady when not provided', async () => {
        TemplateLoader.init('anchor');
        global.fetch = vi.fn(async () => ({ ok: true, text: async () => '' }));
        await expect(TemplateLoader.show('x', null)).resolves.not.toThrow();
        delete global.fetch;
    });

    it('show logs error on non-ok response', async () => {
        TemplateLoader.init('anchor');
        global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));
        const errorSpy = vi.spyOn(console, 'error');
        await TemplateLoader.show('missing');
        expect(errorSpy).toHaveBeenCalledWith(
            '[TemplateLoader] Failed to load template:', 'missing', expect.any(Error)
        );
        errorSpy.mockRestore();
        delete global.fetch;
    });

    it('current returns null initially', () => {
        expect(TemplateLoader.current()).toBeNull();
    });
});
