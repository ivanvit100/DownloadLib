import { describe, it, expect, beforeEach, vi } from 'vitest';

let FB2Exporter;
beforeEach(async () => {
    const basePath = require.resolve('../../exporters/BaseExporter.js');
    delete require.cache[basePath];
    await import('../../exporters/BaseExporter.js');
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
        const manga = { name: 'Test', authors: ['Author'] };
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
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'image', data: { base64: 'imgdata', contentType: 'image/png' } }
            ]}
        ];
        const coverBase64 = 'data:image/jpeg;base64,coverdata';
        const result = Array.from(exporter.createFB2Stream(manga, chapters, coverBase64)).join('');
        expect(result).toContain('<binary id="cover.jpg" content-type="image/jpeg">coverdata</binary>');
        expect(result).toContain('<binary id="image1" content-type="image/png">imgdata</binary>');
        expect(result).toContain('<p><image l:href="#cover.jpg"/></p>');
        expect(result).toContain('<p><image l:href="#image1"/></p>');
    });

    it('Places binary elements after body', () => {
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Ch', content: [
                { type: 'image', data: { base64: 'imgdata', contentType: 'image/jpeg' } }
            ]}
        ];
        const result = Array.from(exporter.createFB2Stream(manga, chapters, 'coverdata')).join('');
        const bodyEnd = result.indexOf('</body>');
        const binaryPos = result.indexOf('<binary');
        expect(binaryPos).toBeGreaterThan(bodyEnd);
    });

    it('Writes annotation when summary is set', () => {
        const manga = { name: 'Test', authors: ['Author'], summary: 'Описание книги' };
        const result = Array.from(exporter.createFB2Stream(manga, [])).join('');
        expect(result).toContain('<annotation><p>Описание книги</p></annotation>');
    });

    it('Omits annotation when summary is empty', () => {
        const manga = { name: 'Test', authors: ['Author'], summary: '' };
        const result = Array.from(exporter.createFB2Stream(manga, [])).join('');
        expect(result).not.toContain('<annotation>');
    });

    it('Return blob, filename and mimeType', async () => {
        const manga = { name: 'Test', authors: ['Author'] };
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

    it('Uses Неизвестно for missing authors', () => {
        const exporter = new FB2Exporter();
        const manga = { name: 'Test', authors: [''] };
        const chapters = [];
        const result = Array.from(exporter.createFB2Stream(manga, chapters)).join('');
        expect(result).toContain('<first-name>Неизвестно</first-name>');
    });

    it('Uses full name authors', () => {
        const exporter = new FB2Exporter();
        const manga = { name: 'Test', authors: ['First Middle Last'] };
        const chapters = [];
        const result = Array.from(exporter.createFB2Stream(manga, chapters)).join('');
        expect(result).toContain('<first-name>First</first-name>');
        expect(result).toContain('<middle-name>Middle</middle-name>');
        expect(result).toContain('<last-name>Last</last-name>');
    });

    it('Uses multiply name authors', () => {
        const exporter = new FB2Exporter();
        const manga = { name: 'Test', authors: ['First', 'Middle', 'Last'] };
        const chapters = [];
        const result = Array.from(exporter.createFB2Stream(manga, chapters)).join('');
        expect(result).toContain('<first-name>First</first-name>');
        expect(result).toContain('<first-name>Middle</first-name>');
        expect(result).toContain('<first-name>Last</first-name>');
    });

    it('Uses Без названия for missing name', () => {
        const exporter = new FB2Exporter();
        const manga = { authors: ['Author'] };
        const chapters = [];
        const result = Array.from(exporter.createFB2Stream(manga, chapters)).join('');
        expect(result).toContain('<book-title>Без названия</book-title>');
    });

    it('Uses coverBase64 as is if no comma present', () => {
        const exporter = new FB2Exporter();
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [];
        const coverBase64 = 'plainbase64data';
        const result = Array.from(exporter.createFB2Stream(manga, chapters, coverBase64)).join('');
        expect(result).toContain('<binary id="cover.jpg" content-type="image/jpeg">plainbase64data</binary>');
    });

    it('Uses "image/jpeg" as default contentType for image blocks', () => {
        const exporter = new FB2Exporter();
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'image', data: { base64: 'imgdata' } }
            ]}
        ];
        const result = Array.from(exporter.createFB2Stream(manga, chapters)).join('');
        expect(result).toContain('<binary id="image1" content-type="image/jpeg">imgdata</binary>');
    });

    it('Skips blocks for chapters without valid content', () => {
        const exporter = new FB2Exporter();
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Chapter 1' },
            { title: 'Chapter 2', content: 'not-an-array' },
            { title: 'Chapter 3', content: [{ type: 'text', text: 'Hello' }] }
        ];
        const result = Array.from(exporter.createFB2Stream(manga, chapters)).join('');
        expect(result).toContain('<title><p>Chapter 1</p></title>');
        expect(result).toContain('<title><p>Chapter 2</p></title>');
        expect(result).toContain('<title><p>Chapter 3</p></title>');
        expect(result).toContain('<p>Hello</p>');
    });

    it('Use yields for empty lines in text blocks', () => {
        const exporter = new FB2Exporter();
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'text', text: 'Hello\n\nWorld\n ' }
            ]}
        ];
        const result = Array.from(exporter.createFB2Stream(manga, chapters)).join('');
        expect(result).toContain('<p>Hello</p>');
        expect(result).toContain('<empty-line/>');
        expect(result).toContain('<p>World</p>');
    });

    it('Calls console.warn for unsupported block type', () => {
        const exporter = new FB2Exporter();
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'unsupported', foo: 'bar' }
            ]}
        ];
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        Array.from(exporter.createFB2Stream(manga, chapters));
        expect(warnSpy).toHaveBeenCalledWith('[FB2Exporter] Unsupported block type: unsupported');
        warnSpy.mockRestore();
    });

    it('Uses "manga" as default filename', async () => {
        const exporter = new FB2Exporter();
        const manga = { authors: [] };
        const chapters = [];
        const result = await exporter.export(manga, chapters);
        expect(result.filename).toBe('manga.fb2');
    });

    it('Extracts authors from authorNodes', () => {
        const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                      <FictionBook>
                        <description>
                          <title-info>
                            <author>
                              <first-name>Ivan</first-name>
                              <last-name>Petrov</last-name>
                            </author>
                            <author>
                              <first-name>Anna</first-name>
                              <last-name>Ivanova</last-name>
                            </author>
                            <book-title>Book</book-title>
                          </title-info>
                        </description>
                        <body>
                          <section>
                            <title><p>Глава 1</p></title>
                            <p>Text</p>
                          </section>
                        </body>
                      </FictionBook>
                      `;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        expect(parsed.metadata.authors).toContain('Ivan Petrov');
        expect(parsed.metadata.authors).toContain('Anna Ivanova');
        expect(parsed.metadata.authors.length).toBe(2);
    });

    it('Uses empty string for missing first-name and last-name', () => {
        const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                    <FictionBook>
                      <description>
                        <title-info>
                          <author>
                            <first-name></first-name>
                            <last-name></last-name>
                          </author>
                          <author>
                          </author>
                          <book-title>Book</book-title>
                        </title-info>
                      </description>
                      <body>
                        <section>
                          <title><p>Глава 1</p></title>
                          <p>Text</p>
                        </section>
                      </body>
                    </FictionBook>
                    `;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        expect(parsed.metadata.authors).toEqual(['Неизвестно', 'Неизвестно']);
    });

    it('Uses getAttribute for cover content-type', () => {
    const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                <FictionBook>
                  <description>
                    <title-info>
                      <book-title>Book</book-title>
                    </title-info>
                  </description>
                  <binary id="cover.jpg" content-type="image/png">abc123</binary>
                  <body>
                    <section>
                      <title><p>Глава 1</p></title>
                      <p>Text</p>
                    </section>
                  </body>
                </FictionBook>
                `;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        expect(parsed.cover).toBe('data:image/png;base64,abc123');
    });

    it('Uses "image/jpeg" as default cover content-type', () => {
    const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                <FictionBook>
                  <description>
                    <title-info>
                      <book-title>Book</book-title>
                    </title-info>
                  </description>
                  <binary id="cover.jpg">abc123</binary>
                  <body>
                    <section>
                      <title><p>Глава 1</p></title>
                      <p>Text</p>
                    </section>
                  </body>
                </FictionBook>
                `;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        expect(parsed.cover).toBe('data:image/jpeg;base64,abc123');
    });

    it('Uses default chapter title', () => {
    const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                <FictionBook>
                  <description>
                    <title-info>
                      <book-title>Book</book-title>
                    </title-info>
                  </description>
                  <body>
                    <section>
                      <p>Text</p>
                    </section>
                    <section>
                      <p>More text</p>
                    </section>
                  </body>
                </FictionBook>
                `;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        expect(parsed.chapters[0].title).toBe('Глава 1');
        expect(parsed.chapters[1].title).toBe('Глава 2');
    });

    it('Pushes empty text block for empty paragraph', () => {
        const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                    <FictionBook>
                      <description>
                        <title-info>
                          <book-title>Book</book-title>
                        </title-info>
                      </description>
                      <body>
                        <section>
                          <title><p>Глава 1</p></title>
                          <p>Text</p>
                          <p>   </p>
                          <p></p>
                        </section>
                      </body>
                    </FictionBook>
                    `;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        const chapter = parsed.chapters[0];
        expect(chapter.content).toContainEqual({ type: 'text', text: '' });
        const emptyBlocks = chapter.content.filter(b => b.text === '');
        expect(emptyBlocks.length).toBe(2);
    });

    it('Skips cover section on roundtrip', () => {
        const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                    <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
                      <description>
                        <title-info><book-title>Book</book-title></title-info>
                      </description>
                      <body>
                        <section>
                          <title><p>Обложка</p></title>
                          <p><image l:href="#cover.jpg"/></p>
                        </section>
                        <section>
                          <title><p>Глава 1</p></title>
                          <p>Text</p>
                        </section>
                      </body>
                      <binary id="cover.jpg" content-type="image/jpeg">abc</binary>
                    </FictionBook>`;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        expect(parsed.chapters.length).toBe(1);
        expect(parsed.chapters[0].title).toBe('Глава 1');
    });

    it('Extracts image blocks from sections', () => {
        const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                    <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
                      <description>
                        <title-info><book-title>Book</book-title></title-info>
                      </description>
                      <binary id="image1" content-type="image/png">abc123</binary>
                      <body>
                        <section>
                          <title><p>Ch 1</p></title>
                          <p>Hello</p>
                          <p><image l:href="#image1"/></p>
                          <p>World</p>
                        </section>
                      </body>
                    </FictionBook>`;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        const content = parsed.chapters[0].content;
        expect(content[0]).toEqual({ type: 'text', text: 'Hello' });
        expect(content[1]).toEqual({ type: 'image', data: { base64: 'abc123', contentType: 'image/png' } });
        expect(content[2]).toEqual({ type: 'text', text: 'World' });
    });

    it('Skips image block when binary not found', () => {
        const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                    <FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
                      <description>
                        <title-info><book-title>Book</book-title></title-info>
                      </description>
                      <body>
                        <section>
                          <title><p>Ch 1</p></title>
                          <p><image l:href="#missing"/></p>
                          <p>Text</p>
                        </section>
                      </body>
                    </FictionBook>`;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        const content = parsed.chapters[0].content;
        expect(content).toEqual([{ type: 'text', text: 'Text' }]);
    });

    it('Extracts middle-name from author nodes', () => {
        const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                    <FictionBook>
                      <description>
                        <title-info>
                          <author>
                            <first-name>Ivan</first-name>
                            <middle-name>Ivanovich</middle-name>
                            <last-name>Petrov</last-name>
                          </author>
                          <book-title>Book</book-title>
                        </title-info>
                      </description>
                      <body><section><title><p>Ch</p></title><p>Text</p></section></body>
                    </FictionBook>`;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        expect(parsed.metadata.authors).toEqual(['Ivan Ivanovich Petrov']);
    });

    it('Extracts summary from annotation', () => {
        const fb2 = `<?xml version="1.0" encoding="utf-8"?>
                    <FictionBook>
                      <description>
                        <title-info>
                          <book-title>Book</book-title>
                          <annotation><p>Some description</p></annotation>
                        </title-info>
                      </description>
                      <body><section><title><p>Ch</p></title><p>Text</p></section></body>
                    </FictionBook>`;
        global.DOMParser = class {
            parseFromString(str) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/xml' }).window.document;
            }
        };
        const exporter = new FB2Exporter();
        const parsed = exporter.parseFB2(fb2, 'file.fb2');
        expect(parsed.metadata.summary).toBe('Some description');
    });
});
