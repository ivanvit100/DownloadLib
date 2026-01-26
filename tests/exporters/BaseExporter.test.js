import { describe, it, expect, beforeEach } from 'vitest';

let BaseExporter;
beforeEach(async () => {
    const path = require.resolve('../../exporters/BaseExporter.js');
    delete require.cache[path];
    await import('../../exporters/BaseExporter.js');
    BaseExporter = globalThis.BaseExporter;
});

describe('BaseExporter', () => {
    let exporter;
    beforeEach(() => {
        exporter = new BaseExporter();
    });

    it('Set format to unknown', () => {
        expect(exporter.format).toBe('unknown');
    });

    it('Export should throw error', async () => {
        await expect(exporter.export({}, [])).rejects.toThrow('export method must be implemented');
    });

    it('Trim string', () => {
        expect(exporter.sanitizeText('  hello  ')).toBe('hello');
    });

    it('Return empty string for falsy', () => {
        expect(exporter.sanitizeText(null)).toBe('');
        expect(exporter.sanitizeText(undefined)).toBe('');
        expect(exporter.sanitizeText('')).toBe('');
    });

    it('Escape XML special chars', () => {
        expect(exporter.escapeXml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;');
    });

    it('Return empty string for falsy', () => {
        expect(exporter.escapeXml(null)).toBe('');
        expect(exporter.escapeXml(undefined)).toBe('');
        expect(exporter.escapeXml('')).toBe('');
    });

    it('Escape HTML special chars', () => {
        expect(exporter.escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
    });

    it('Return empty string for falsy', () => {
        expect(exporter.escapeHtml(null)).toBe('');
        expect(exporter.escapeHtml(undefined)).toBe('');
        expect(exporter.escapeHtml('')).toBe('');
    });

    it('Remove script and style tags', () => {
        const html = '<script>alert(1)</script><style>body{}</style>text';
        expect(exporter.stripHtml(html)).toBe('text');
    });

    it('Replace tags with newlines', () => {
        const html = '<div>foo</div><p>bar</p>';
        expect(exporter.stripHtml(html)).toBe('foo\n\nbar');
    });
    
    it('Decode HTML entities', () => {
        const html = '&lt;tag&gt;&amp;&quot;&apos;&nbsp;';
        expect(exporter.stripHtml(html)).toBe('<tag>&"\'');
    });
    
    it('Collapse multiple newlines', () => {
        const html = '<div>foo</div><br><br><br><div>bar</div>';
        expect(exporter.stripHtml(html)).toBe('foo\n\nbar');
    });
    
    it('Return empty string for falsy', () => {
        expect(exporter.stripHtml(null)).toBe('');
        expect(exporter.stripHtml(undefined)).toBe('');
        expect(exporter.stripHtml('')).toBe('');
    });

    it('Strip HTML from string', () => {
        expect(exporter.extractText('<b>hello</b>')).toBe('hello');
    });

    it('Extract text from array of blocks', () => {
        const arr = [
        { type: 'paragraph', content: [
            { type: 'text', text: 'foo' },
            { type: 'text', text: 'bar' }
        ]},
        { type: 'text', text: 'baz' },
        { type: 'text', content: 123 }
        ];
        expect(exporter.extractText(arr)).toBe('foobar\n\nbaz\n\n123');
    });
    
    it('Return empty string for other/falsy', () => {
        expect(exporter.extractText(null)).toBe('');
        expect(exporter.extractText(undefined)).toBe('');
        expect(exporter.extractText(123)).toBe('');
    });

    it('Return empty string for unknown block type', () => {
        const arr = [
            { type: 'unknown', foo: 'bar' }
        ];
        expect(exporter.extractText(arr)).toBe('');
    });
});