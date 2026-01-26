import { describe, it, expect, beforeEach } from 'vitest';

let FB2Exporter;
beforeEach(async () => {
    const path = require.resolve('../../exporters/FB2Exporter.js');
    delete require.cache[path];
    await import('../../exporters/FB2Exporter.js');
    FB2Exporter = globalThis.FB2Exporter;
});

describe('FB2Exporter', () => {
    let exporter;
    beforeEach(() => {
        exporter = new FB2Exporter();
    });

    it('Escape XML special chars', () => {
        expect(exporter.escapeXml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;');
        expect(exporter.escapeXml(null)).toBe('');
        expect(exporter.escapeXml('')).toBe('');
    });

    it('Generate basic FB2 structure', () => {
        const manga = { name: 'Test', authors: 'Author' };
        const chapters = [
            { title: 'Chapter 1', content: [{ type: 'text', text: 'Hello\nWorld' }] }
        ];
        const result = Array.from(exporter.createFB2Stream(manga, chapters));
        expect(result.join('')).toContain('<FictionBook');
        expect(result.join('')).toContain('<book-title>Test</book-title>');
        expect(result.join('')).toContain('<first-name>Author</first-name>');
        expect(result.join('')).toContain('<title><p>Chapter 1</p></title>');
        expect(result.join('')).toContain('<p>Hello</p>');
        expect(result.join('')).toContain('<p>World</p>');
    });

    it('Include cover and images', () => {
        const manga = { name: 'Test', authors: 'Author' };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'image', data: { base64: 'imgdata', contentType: 'image/png' } }
            ]}
        ];
        const coverBase64 = 'data:image/jpeg;base64,coverdata';
        const result = Array.from(exporter.createFB2Stream(manga, chapters, coverBase64)).join('');
        expect(result).toContain('<binary id="cover.jpg" content-type="image/jpeg">coverdata</binary>');
        expect(result).toContain('<binary id="image1" content-type="image/png">imgdata</binary>');
        expect(result).toContain('<image l:href="#cover.jpg"/>');
        expect(result).toContain('<image l:href="#image1"/>');
    });

    it('Return blob, filename and mimeType', async () => {
        const manga = { name: 'Test', authors: 'Author' };
        const chapters = [
            { title: 'Chapter 1', content: [{ type: 'text', text: 'Hello' }] }
        ];
        const result = await exporter.export(manga, chapters);
        expect(result).toHaveProperty('blob');
        expect(result).toHaveProperty('filename');
        expect(result).toHaveProperty('mimeType');
        expect(result.filename).toBe('Test.fb2');
        expect(result.mimeType).toBe('application/xml');
    });

    it('Parse basic FB2', () => {
        const fb2 = `
        <?xml version="1.0" encoding="utf-8"?>
        <FictionBook>
          <description>
            <title-info>
              <genre>prose</genre>
              <author><first-name>Ivan</first-name><last-name>Petrov</last-name></author>
              <book-title>My Book</book-title>
              <lang>ru</lang>
            </title-info>
          </description>
          <body>
            <section>
              <title><p>Глава 1</p></title>
              <p>Hello</p>
              <p>World</p>
            </section>
          </body>
        </FictionBook>
        `;
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        expect(parsed.metadata.name).toBe('file.fb2');
        expect(parsed.metadata.authors).toEqual([]);
        expect(parsed.chapters.length).toBe(0);
    });

    it('Extract cover image', () => {
        const fb2 = `
        <?xml version="1.0" encoding="utf-8"?>
        <FictionBook>
          <description>
            <title-info>
              <book-title>Book</book-title>
            </title-info>
          </description>
          <binary id="cover.jpg" content-type="image/jpeg">abc123</binary>
          <body>
            <section>
              <title><p>Глава 1</p></title>
              <p>Text</p>
            </section>
          </body>
        </FictionBook>
        `;
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        expect(parsed.cover).toBe('');
    });
});