import { describe, it, expect, beforeEach, vi } from 'vitest';

let EPUBExporter;
beforeEach(async () => {
    const basePath = require.resolve('../../exporters/BaseExporter.js');
    delete require.cache[basePath];
    await import('../../exporters/BaseExporter.js');
    const path = require.resolve('../../exporters/EPUBExporter.js');
    delete require.cache[path];
    await import('../../exporters/EPUBExporter.js');
    EPUBExporter = globalThis.EPUBExporter;
});

describe('EPUBExporter', () => {
    let exporter;
    beforeEach(() => {
        exporter = new EPUBExporter();
    });

    it('Escapes XML special chars', () => {
        expect(exporter.escapeXml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&apos;');
        expect(exporter.escapeXml('')).toBe('');
        expect(exporter.escapeXml(null)).toBe('');
    });

    it('Returns valid XML', () => {
        const xml = exporter.createContainer();
        expect(xml).toContain('<container');
        expect(xml).toContain('<rootfile full-path="OEBPS/content.opf"');
    });

    it('Includes cover for first chapter', () => {
        const chapter = { title: 'Title', content: [] };
        const html = exporter.createChapterXHTML(chapter, true);
        expect(html).toContain('images/cover.jpg');
        expect(html).toContain('<h2>Title</h2>');
    });

    it('Creates chapter XHTML and renders text and empty lines', () => {
        const chapter = {
            title: 'Test',
            content: [
                { type: 'text', text: 'Hello\n\nWorld\n ' }
            ]
        };
        const html = exporter.createChapterXHTML(chapter, false);
        expect(html).toContain('<p>Hello</p>');
        expect(html).toContain('<p>&#160;</p>');
        expect(html).toContain('<p>World</p>');
    });

    it('Renders html property of text block splitting on br tags (covers lines 115-117)', () => {
        const chapter = {
            title: 'Ch',
            content: [{ type: 'text', text: 'some', html: '<br/>Bold', align: 'center' }]
        };
        const html = exporter.createChapterXHTML(chapter, false);
        expect(html).toContain('<p>&#160;</p>');
        expect(html).toContain('<p style="text-align: center;">Bold</p>');
    });

    it('Creates chapter XHTML and renders images', () => {
        const chapter = {
            title: 'Test',
            content: [
                { type: 'image', _epubImagePath: 'images/img1.jpg' }
            ]
        };
        const html = exporter.createChapterXHTML(chapter, false);
        expect(html).toContain('src="images/img1.jpg"');
    });

    it('Creates image-only XHTML without heading and with page-image tags', () => {
        const chapter = {
            title: 'Only Images',
            content: [
                { type: 'image', _epubImagePath: 'images/img1.jpg' },
                { type: 'image', _epubImagePath: 'images/img2.jpg' }
            ]
        };
        const html = exporter.createChapterXHTML(chapter, false);
        expect(html).not.toContain('<h2>Only Images</h2>');
        expect(html).toContain('class="page-image"');
        expect(html).toContain('src="images/img1.jpg"');
        expect(html).toContain('src="images/img2.jpg"');
    });

    it('Uses full name authors', () => {
        const opf = exporter.createOPF({ name: 'Test', authors: ['First Last Middle'] });
        expect(opf).toContain('<dc:creator>First Last Middle</dc:creator>');
    });

    it('Uses multiply name authors', () => {
        const opf = exporter.createOPF({ name: 'Test', authors: ['First', 'Middle', 'Last'] });
        expect(opf).toContain('<dc:creator>First</dc:creator>');
        expect(opf).toContain('<dc:creator>Middle</dc:creator>');
        expect(opf).toContain('<dc:creator>Last</dc:creator>');
    });

    it('Uses defaults for missing manga fields', () => {
        const opf = exporter.createOPF({ authors: [''] }, '', '');
        expect(opf).toContain('<dc:title>Без названия</dc:title>');
        expect(opf).toContain('<dc:creator>Неизвестно</dc:creator>');
    });

    it('Includes dc:identifier with manga id', () => {
        const opf = exporter.createOPF({ name: 'Test', authors: ['A'], id: '42' }, '', '');
        expect(opf).toContain('<dc:identifier id="BookId">urn:manga:42</dc:identifier>');
    });

    it('Falls back to name for dc:identifier when id is missing', () => {
        const opf = exporter.createOPF({ name: 'My Book', authors: ['A'] }, '', '');
        expect(opf).toContain('<dc:identifier id="BookId">My Book</dc:identifier>');
    });

    it('NCX dtb:uid matches OPF identifier', () => {
        const ncx = exporter.createNCX({ name: 'My Book', id: '42' }, '');
        expect(ncx).toContain('content="urn:manga:42"');
    });

    it('Writes dc:description when summary is set', () => {
        const opf = exporter.createOPF({ name: 'Test', authors: ['A'], summary: 'Краткое описание' }, '', '');
        expect(opf).toContain('<dc:description>Краткое описание</dc:description>');
    });

    it('Omits dc:description when summary is empty', () => {
        const opf = exporter.createOPF({ name: 'Test', authors: ['A'], summary: '' }, '', '');
        expect(opf).not.toContain('<dc:description>');
    });

    it('Writes cover meta when manifest contains cover-image', () => {
        const manifest = '<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>';
        const opf = exporter.createOPF({ name: 'Test', authors: ['A'] }, manifest, '');
        expect(opf).toContain('<meta name="cover" content="cover-image"/>');
    });

    it('Omits cover meta when manifest has no cover-image', () => {
        const opf = exporter.createOPF({ name: 'Test', authors: ['A'] }, '', '');
        expect(opf).not.toContain('<meta name="cover"');
    });

    it('Uses defaults for missing name in NCX', () => {
        const ncx = exporter.createNCX({}, '');
        expect(ncx).toContain('<docTitle><text>Без названия</text></docTitle>');
    });

    it('Creates NavPoint and escapes title', () => {
        const nav = exporter.createNavPoint('<t>', 'chapter1.xhtml', 1);
        expect(nav).toContain('&lt;t&gt;');
        expect(nav).toContain('chapter1.xhtml');
    });

    it('Throws if JSZip is not loaded', async () => {
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [];
        const origJSZip = global.JSZip;
        global.JSZip = undefined;
        await expect(exporter.export(manga, chapters)).rejects.toThrow('JSZip library not loaded');
        global.JSZip = origJSZip;
    });

    it('Uses "manga" as default filename', async () => {
        global.JSZip = class {
            constructor() { this.files = {}; }
            file(name, content, opts) { this.files[name] = { content, opts }; }
            generateAsync() { return Promise.resolve('blob'); }
        };
        const manga = { authors: [] };
        const chapters = [];
        const result = await exporter.export(manga, chapters);
        expect(result.filename).toBe('manga.epub');
        expect(result.mimeType).toBe('application/epub+zip');
        expect(result.blob).toBe('blob');
    });

    it('Includes cover image', async () => {
        let coverAdded = false;
        global.JSZip = class {
            constructor() { this.files = {}; }
            file(name, content, opts) {
                if (name === 'OEBPS/images/cover.jpg' && content === 'coverdata') coverAdded = true;
                this.files[name] = { content, opts };
            }
            generateAsync() { return Promise.resolve('blob'); }
        };
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [];
        await exporter.export(manga, chapters, 'coverdata');
        expect(coverAdded).toBe(true);
    });

    it('Includes images from chapters', async () => {
        let imageAdded = false;
        global.JSZip = class {
            constructor() { this.files = {}; }
            file(name, content, opts) {
                if (name === 'OEBPS/images/image1.jpg' && content === 'imgdata') imageAdded = true;
                this.files[name] = { content, opts };
            }
            generateAsync() { return Promise.resolve('blob'); }
        };
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'image', data: { base64: 'imgdata', contentType: 'image/jpeg' } }
            ]}
        ];
        await exporter.export(manga, chapters);
        expect(imageAdded).toBe(true);
    });

    it('Includes PNG images from chapters', async () => {
        let pngAdded = false;
        global.JSZip = class {
            constructor() { this.files = {}; }
            file(name, content, opts) {
                if (name === 'OEBPS/images/image1.png' && content === 'imgdata') pngAdded = true;
                this.files[name] = { content, opts };
            }
            generateAsync() { return Promise.resolve('blob'); }
        };
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'image', data: { base64: 'imgdata', contentType: 'image/png' } }
            ]}
        ];
        await exporter.export(manga, chapters);
        expect(pngAdded).toBe(true);
    });

    it('Uses split for data URI cover', async () => {
        global.JSZip = class {
            constructor() { this.files = {}; }
            file(name, content, opts) {
                if (name === 'OEBPS/images/cover.jpg') {
                    expect(content).toBe('coverdata');
                    expect(opts.base64).toBe(true);
                }
                this.files[name] = { content, opts };
            }
            generateAsync() { return Promise.resolve('blob'); }
        };
        const exporter = new EPUBExporter();
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [];
        const coverBase64 = 'data:image/jpeg;base64,coverdata';
        await exporter.export(manga, chapters, coverBase64);
    });

    it('Calls warn for unsupported image block', async () => {
        global.JSZip = class {
            constructor() { this.files = {}; }
            file() {}
            generateAsync() { return Promise.resolve('blob'); }
        };
        const exporter = new EPUBExporter();
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'image' }
            ]}
        ];
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await exporter.export(manga, chapters);
        expect(warnSpy).toHaveBeenCalledWith('[EPUBExporter] Chapter 1 has unsupported image block or missing data');
        warnSpy.mockRestore();
    });

    it('Calls warn for chapter with no content array', async () => {
        global.JSZip = class {
            constructor() { this.files = {}; }
            file() {}
            generateAsync() { return Promise.resolve('blob'); }
        };
        const exporter = new EPUBExporter();
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Chapter 1' }
        ];
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await exporter.export(manga, chapters);
        expect(warnSpy).toHaveBeenCalledWith('[EPUBExporter] Chapter 1 has no content array');
        warnSpy.mockRestore();
    });

    it('Includes cover in first chapter only', async () => {
        let zipInstance;
        global.JSZip = class {
            constructor() { this.files = {}; zipInstance = this; }
            file(name, content, opts) {
                this.files[name] = { content, opts };
            }
            generateAsync() { return Promise.resolve('blob'); }
        };
        const exporter = new EPUBExporter();
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            { title: 'Chapter 1', content: [{ type: 'text', text: 'Hello' }] },
            { title: 'Chapter 2', content: [{ type: 'text', text: 'World' }] }
        ];
        const coverBase64 = 'coverdata';
        await exporter.export(manga, chapters, coverBase64);
        const firstChapter = zipInstance.files['OEBPS/chapter1.xhtml'].content;
        const secondChapter = zipInstance.files['OEBPS/chapter2.xhtml'].content;
        expect(firstChapter).toContain('images/cover.jpg');
        expect(secondChapter).not.toContain('images/cover.jpg');
    });

	it('Uses fallback jpeg media type when image contentType is missing', async () => {
        let zipInstance;
        global.JSZip = class {
            constructor() {
                this.files = {};
                zipInstance = this;
            }
            file(name, content, opts) {
                this.files[name] = { content, opts };
            }
            generateAsync() {
                return Promise.resolve('blob');
            }
        };
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [
            {
                title: 'Chapter 1',
                content: [
                    { type: 'image', data: { base64: 'imgdata' } }
                ]
            }
        ];
        await exporter.export(manga, chapters);
        expect(zipInstance.files['OEBPS/images/image1.jpg'].content).toBe('imgdata');
        expect(zipInstance.files['OEBPS/content.opf'].content).toContain('href="images/image1.jpg" media-type="image/jpeg"');
    });

    it('Renders image-only chapter cover and images without heading', () => {
        const chapter = {
            title: 'Only Images',
            content: [
                { type: 'image', _epubImagePath: 'images/img1.jpg' }
            ]
        };
        const html = exporter.createChapterXHTML(chapter, true);
        expect(html).toContain('<img class="page-image" src="images/cover.jpg" alt="Cover"/>');
        expect(html).toContain('<img class="page-image" src="images/img1.jpg" alt="Image"/>');
        expect(html).toContain('img.page-image{display:block;width:100%;height:auto;margin:0;padding:0;border:0;}');
        expect(html).not.toContain('<h2>Only Images</h2>');
        expect(html).not.toContain('<div style="text-align: center; margin: 20px 0;">');
        expect(html).not.toContain('<div style="text-align: center; margin: 10px 0;">');
    });

    it('Renders centered image wrapper for mixed content chapter', () => {
        const chapter = {
            title: 'Mixed',
            content: [
                { type: 'text', text: 'Line' },
                { type: 'image', _epubImagePath: 'images/img1.jpg' }
            ]
        };
        const html = exporter.createChapterXHTML(chapter, false);
        expect(html).toContain('<h2>Mixed</h2>');
        expect(html).toContain('<div style="text-align: center; margin: 10px 0;">');
        expect(html).toContain('<img src="images/img1.jpg" alt="Image" style="max-width: 100%; height: auto;"/>');
        expect(html).not.toContain('<img class="page-image" src="images/img1.jpg" alt="Image"/>');
    });

    it('Writes dc:subject for each genre and tag', () => {
        const opf = exporter.createOPF(
            { name: 'T', authors: ['A'], genres: ['Экшен', 'Фэнтези'], tags: ['Магия'] }, '', ''
        );
        expect(opf).toContain('<dc:subject>Экшен</dc:subject>');
        expect(opf).toContain('<dc:subject>Фэнтези</dc:subject>');
        expect(opf).toContain('<dc:subject>Магия</dc:subject>');
    });

    it('Omits dc:subject when genres and tags are empty', () => {
        const opf = exporter.createOPF({ name: 'T', authors: ['A'], genres: [], tags: [] }, '', '');
        expect(opf).not.toContain('<dc:subject>');
    });

    it('Writes dc:date when releaseDate is set', () => {
        const opf = exporter.createOPF({ name: 'T', authors: ['A'], releaseDate: '2021' }, '', '');
        expect(opf).toContain('<dc:date>2021</dc:date>');
    });

    it('Omits dc:date when releaseDate is absent', () => {
        const opf = exporter.createOPF({ name: 'T', authors: ['A'] }, '', '');
        expect(opf).not.toContain('<dc:date>');
    });

    it('Writes meta age-rating when rating is set', () => {
        const opf = exporter.createOPF({ name: 'T', authors: ['A'], rating: '18+' }, '', '');
        expect(opf).toContain('<meta name="age-rating" content="18+"/>');
    });

    it('Omits meta age-rating when rating is absent', () => {
        const opf = exporter.createOPF({ name: 'T', authors: ['A'] }, '', '');
        expect(opf).not.toContain('age-rating');
    });

    it('Registers with ExporterRegistry when it is already defined on load', async () => {
        vi.resetModules();
        const register = vi.fn();
        global.ExporterRegistry = { register };
        await import('../../exporters/BaseExporter.js');
        await import('../../exporters/EPUBExporter.js');
        expect(register).toHaveBeenCalledWith('epub', expect.any(Function), { label: 'EPUB' });
        delete global.ExporterRegistry;
    });
});
