import { describe, it, expect, beforeEach, vi } from 'vitest';

let addEventListenerSpy;
let handler;

async function loadSandbox() {
    vi.resetModules();
    addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    await import('../sandbox.js');
    const calls = addEventListenerSpy.mock.calls.filter(c => c[0] === 'message');
    handler = calls[calls.length - 1][1];
}

describe('sandbox.js', () => {
    beforeEach(async () => {
        await loadSandbox();
    });

    it('exposes BaseService on window', () => {
        const config = { name: 'svc' };
        const instance = new window.BaseService(config);
        expect(instance.config).toBe(config);
        expect(instance.name).toBe('svc');
    });

    it('BaseService handles missing config', () => {
        const instance = new window.BaseService();
        expect(instance.name).toBeUndefined();
    });

    it('exposes BaseExporter with format "unknown"', () => {
        const instance = new window.BaseExporter();
        expect(instance.format).toBe('unknown');
    });

    it('escapeXml escapes special characters', () => {
        const instance = new window.BaseExporter();
        expect(instance.escapeXml('<a>&"\'</a>')).toBe('&lt;a&gt;&amp;&quot;&apos;&lt;/a&gt;');
    });

    it('escapeXml returns empty string for falsy input', () => {
        const instance = new window.BaseExporter();
        expect(instance.escapeXml('')).toBe('');
        expect(instance.escapeXml(null)).toBe('');
    });

    it('escapeHtml escapes special characters', () => {
        const instance = new window.BaseExporter();
        expect(instance.escapeHtml('<a>&"\'</a>')).toBe('&lt;a&gt;&amp;&quot;&#39;&lt;/a&gt;');
    });

    it('escapeHtml returns empty string for falsy input', () => {
        const instance = new window.BaseExporter();
        expect(instance.escapeHtml(0)).toBe('');
    });

    it('sanitizeText trims text', () => {
        const instance = new window.BaseExporter();
        expect(instance.sanitizeText('  hi  ')).toBe('hi');
    });

    it('sanitizeText returns empty string for falsy input', () => {
        const instance = new window.BaseExporter();
        expect(instance.sanitizeText(null)).toBe('');
    });

    it('ExporterRegistry.register stores class and meta', () => {
        class Foo {}
        window.ExporterRegistry.register('EPUB', Foo, { label: 'EPUB' });

        const source = { postMessage: vi.fn() };
        handler({
            data: { _t: 'sb-export', _id: 1, fmt: 'epub', manga: {}, chapters: [], cover: null },
            source
        });
    });

    it('ExporterRegistry.register defaults meta to empty object', () => {
        class Foo {}
        expect(() => window.ExporterRegistry.register('mobi', Foo)).not.toThrow();
    });

    it('message handler ignores unrecognized _t values', () => {
        const source = { postMessage: vi.fn() };
        handler({ data: { _t: 'unknown-type', _id: 1 }, source });
        expect(source.postMessage).not.toHaveBeenCalled();
    });

    it('message handler ignores events with no data', () => {
        expect(() => handler({ data: null, source: { postMessage: vi.fn() } })).not.toThrow();
    });

    it('message handler ignores events with data but no _t', () => {
        const source = { postMessage: vi.fn() };
        handler({ data: { foo: 'bar' }, source });
        expect(source.postMessage).not.toHaveBeenCalled();
    });

    it('sb-exec runs code and posts sb-ok with captured value', () => {
        const source = { postMessage: vi.fn() };
        handler({
            data: { _t: 'sb-exec', _id: 42, code: 'window.ExporterRegistry.register("x", function(){}, {a:1});' },
            source
        });
        expect(source.postMessage).toHaveBeenCalledWith({ _t: 'sb-ok', _id: 42, c: { format: 'x' } }, '*');
    });

    it('sb-exec posts sb-err when code throws', () => {
        const source = { postMessage: vi.fn() };
        handler({
            data: { _t: 'sb-exec', _id: 7, code: 'throw new Error("boom");' },
            source
        });
        expect(source.postMessage).toHaveBeenCalledWith({ _t: 'sb-err', _id: 7, e: 'boom' }, '*');
    });

    it('sb-export posts sb-err when format is not registered', async () => {
        const source = { postMessage: vi.fn() };
        handler({
            data: { _t: 'sb-export', _id: 5, fmt: 'unknown-fmt', manga: {}, chapters: [], cover: null },
            source
        });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(source.postMessage).toHaveBeenCalledWith(
            { _t: 'sb-err', _id: 5, e: 'Format not registered in sandbox: unknown-fmt' }, '*'
        );
    });

    it('sb-export exports via registered class and posts sb-export-ok with transferable buffer', async () => {
        const fakeBuf = new ArrayBuffer(4);
        class FakeExporter {
            async export(manga, chapters, cover) {
                return {
                    blob: { arrayBuffer: async () => fakeBuf },
                    filename: `${manga.title}.epub`,
                    mimeType: 'application/epub+zip'
                };
            }
        }
        window.ExporterRegistry.register('epub', FakeExporter, {});

        const source = { postMessage: vi.fn() };
        handler({
            data: { _t: 'sb-export', _id: 9, fmt: 'EPUB', manga: { title: 'Manga' }, chapters: [], cover: null },
            source
        });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(source.postMessage).toHaveBeenCalledWith(
            { _t: 'sb-export-ok', _id: 9, buf: fakeBuf, filename: 'Manga.epub', mimeType: 'application/epub+zip' },
            '*',
            [fakeBuf]
        );
    });

    it('sb-export posts sb-err when export() throws', async () => {
        class ThrowingExporter {
            async export() {
                throw new Error('export failed');
            }
        }
        window.ExporterRegistry.register('fb2', ThrowingExporter, {});

        const source = { postMessage: vi.fn() };
        handler({
            data: { _t: 'sb-export', _id: 11, fmt: 'fb2', manga: {}, chapters: [], cover: null },
            source
        });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(source.postMessage).toHaveBeenCalledWith(
            { _t: 'sb-err', _id: 11, e: 'export failed' }, '*'
        );
    });
});
