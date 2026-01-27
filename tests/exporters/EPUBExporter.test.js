import { describe, it, expect, beforeEach, vi } from 'vitest';

let EPUBExporter;
beforeEach(async () => {
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

    it('Escapes HTML special chars', () => {
        expect(exporter.escapeHtml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&apos;');
        expect(exporter.escapeHtml('')).toBe('');
        expect(exporter.escapeHtml(null)).toBe('');
    });

    it('Delegates to escapeHtml', () => {
        expect(exporter.escapeXml('<>&')).toBe('&lt;&gt;&amp;');
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

    it('Creates chapter XHTML and renders images', () => {
        const chapter = {
            title: 'Test',
            content: [
                { type: 'image', _epubImagePath: 'images/img1.jpg' }
            ]
        };
        const html = exporter.createChapterXHTML(chapter, false);
        expect(html).toContain('<img src="images/img1.jpg"');
    });

    it('Uses defaults for missing manga fields', () => {
        const opf = exporter.createOPF({}, '', '');
        expect(opf).toContain('<dc:title>Без названия</dc:title>');
        expect(opf).toContain('<dc:creator>Неизвестно</dc:creator>');
    });

    it('Uses defaults for missing manga fields', () => {
        const ncx = exporter.createNCX({}, '');
        expect(ncx).toContain('<docTitle><text>Без названия</text></docTitle>');
    });

    it('Creates NavPoint and escapes title', () => {
        const nav = exporter.createNavPoint('<t>', 'chapter1.xhtml', 1);
        expect(nav).toContain('&lt;t&gt;');
        expect(nav).toContain('chapter1.xhtml');
    });

    it('Throws if JSZip is not loaded', async () => {
        const manga = { name: 'Test', authors: 'Author' };
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
        const manga = {};
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
        const manga = { name: 'Test', authors: 'Author' };
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
        const manga = { name: 'Test', authors: 'Author' };
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
        const manga = { name: 'Test', authors: 'Author' };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'image', data: { base64: 'imgdata', contentType: 'image/png' } }
            ]}
        ];
        await exporter.export(manga, chapters);
        expect(pngAdded).toBe(true);
    });

    it('Throws if JSZip is not loaded', async () => {
        const origJSZip = global.JSZip;
        global.JSZip = undefined;
        await expect(exporter.parseEPUB({ name: 'file.epub' })).rejects.toThrow('JSZip library not loaded');
        global.JSZip = origJSZip;
    });

    it('Resolves with base64 string', async () => {
        const data = new Uint8Array([72, 73]);
        const blob = new Blob([data], { type: 'text/plain' });
        const result = await exporter.blobToBase64(blob);
        expect(result.startsWith('data:text/plain;base64,')).toBe(true);
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
        const manga = { name: 'Test', authors: 'Author' };
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
        const manga = { name: 'Test', authors: 'Author' };
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
        const manga = { name: 'Test', authors: 'Author' };
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
        const manga = { name: 'Test', authors: 'Author' };
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

    it('Calls new JSZip()', async () => {
        let called = false;
        class FakeZip {
            constructor() { called = true; this.files = {}; }
            async loadAsync() { return this; }
            file() {}
        }
        global.JSZip = FakeZip;
        const exporter = new EPUBExporter();
        await exporter.parseEPUB({ name: 'file.epub' });
        expect(called).toBe(true);
    });

    it('Processes containerXml and sets opfFile from rootfile', async () => {
        let opfFileSet = false;
        class FakeZip {
            async loadAsync(file) { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return {
                        async: async () => `<?xml version="1.0"?>
                                            <container>
                                            <rootfiles>
                                                <rootfile full-path="OEBPS/content.opf"/>
                                            </rootfiles>
                                            </container>`
                    };
                }
                if (name === 'OEBPS/content.opf') {
                    opfFileSet = true;
                    return { async: async () => '<opf></opf>', name: name };
                }
                return undefined;
            }
            get files() { return {}; }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type }).window.document;
            }
        };
        const exporter = new EPUBExporter();
        await exporter.parseEPUB({ name: 'file.epub' });
        expect(opfFileSet).toBe(true);
    });

    it('Calls warn if no full-path attribute', async () => {
        let warned = false;
        class FakeZip {
            async loadAsync(file) { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return {
                        async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile/></rootfiles></container>`
                    };
                }
                return undefined;
            }
            get files() { return {}; }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type }).window.document;
            }
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { warned = true; });
        const exporter = new EPUBExporter();
        await exporter.parseEPUB({ name: 'file.epub' });
        expect(warned).toBe(true);
        warnSpy.mockRestore();
    });

    it('Sets opfFile when filename ends with .opf', async () => {
        class FakeZip {
            async loadAsync(file) { return this; }
            file(name) {
                return null;
            }
            get files() {
                return {
                    'OEBPS/content.opf': {
                        async: async () => '<opf></opf>',
                        name: 'OEBPS/content.opf'
                    }
                };
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str || '', { contentType: type }).window.document;
            }
        };
        const exporter = new EPUBExporter();
        const result = await exporter.parseEPUB({ name: 'file.epub' });
        expect(result.metadata.name).toBe('file');
        expect(result.chapters).toEqual([]);
    });

    it('Calls warn for non-opf files', async () => {
        class FakeZip {
            async loadAsync(file) { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') return null;
                return undefined;
            }
            get files() {
                return {
                    'OEBPS/other.txt': {
                        async: async () => 'other',
                        name: 'OEBPS/other.txt'
                    },
                    'OEBPS/another.xml': {
                        async: async () => 'another',
                        name: 'OEBPS/another.xml'
                    }
                };
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str || '', { contentType: type }).window.document;
            }
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const exporter = new EPUBExporter();
        await exporter.parseEPUB({ name: 'file.epub' });
        expect(warnSpy).toHaveBeenCalledWith('[EPUBExporter] Skipping non-opf file: OEBPS/other.txt');
        expect(warnSpy).toHaveBeenCalledWith('[EPUBExporter] Skipping non-opf file: OEBPS/another.xml');
        warnSpy.mockRestore();
    });

    it('Parses metadata node', async () => {
        class FakeZip {
            async loadAsync(file) { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return {
                        async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`
                    };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata>
                                <dc:title>My Title</dc:title>
                                <dc:creator>Author One</dc:creator>
                                <dc:creator>Author Two</dc:creator>
                                <dc:description>Summary here</dc:description>
                            </metadata>
                            <manifest></manifest>
                            <spine></spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                return undefined;
            }
            get files() { return {}; }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type }).window.document;
            }
        };
        const exporter = new EPUBExporter();
        const result = await exporter.parseEPUB({ name: 'file.epub' });
        expect(result.metadata.name).toBe('My Title');
        expect(result.metadata.rus_name).toBe('My Title');
        expect(result.metadata.authors).toContain('Author One');
        expect(result.metadata.authors).toContain('Author Two');
        expect(result.metadata.summary).toBe('Summary here');
    });

    it('Uses fallback if title is missing in metadata', async () => {
        class FakeZip {
            async loadAsync(file) { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return {
                        async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`
                    };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata>
                                <!-- Нет dc:title -->
                                <dc:creator>Author One</dc:creator>
                            </metadata>
                            <manifest></manifest>
                            <spine></spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                return undefined;
            }
            get files() { return {}; }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type }).window.document;
            }
        };
        const exporter = new EPUBExporter();
        const result = await exporter.parseEPUB({ name: 'file.epub' });
        expect(result.metadata.name).toBe('file');
        expect(result.metadata.rus_name).toBe('file');
        expect(result.metadata.authors).toContain('Author One');
    });

    it('Calls warn if no description found in metadata', async () => {
        class FakeZip {
            async loadAsync(file) { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return {
                        async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`
                    };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata>
                                <dc:title>My Title</dc:title>
                                <dc:creator>Author One</dc:creator>
                            </metadata>
                            <manifest></manifest>
                            <spine></spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                return undefined;
            }
            get files() { return {}; }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type }).window.document;
            }
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const exporter = new EPUBExporter();
        await exporter.parseEPUB({ name: 'file.epub' });
        expect(warnSpy).toHaveBeenCalledWith('[EPUBExporter] No description found in metadata');
        warnSpy.mockRestore();
    });

    it('Extracts cover image when cover is present', async () => {
        let coverBlobCalled = false;
        class FakeZip {
            async loadAsync(file) { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return {
                        async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`
                    };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <manifest>
                                <item id="cover" href="images/cover.jpg" properties="cover-image"/>
                            </manifest>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                if (name === 'OEBPS/images/cover.jpg') {
                    return {
                        async: async (type) => {
                            if (type === 'blob') {
                                coverBlobCalled = true;
                                return new Blob(['coverdata'], { type: 'image/jpeg' });
                            }
                            return null;
                        }
                    };
                }
                return undefined;
            }
            get files() { return {}; }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type }).window.document;
            }
        };
        const exporter = new EPUBExporter();
        exporter.blobToBase64 = async () => 'data:image/jpeg;base64,ZmFrZWNvdmVy';
        const result = await exporter.parseEPUB({ name: 'file.epub' });
        expect(coverBlobCalled).toBe(true);
        expect(result.cover).toBe('data:image/jpeg;base64,ZmFrZWNvdmVy');
    });

    it('Calls warn if cover file not found', async () => {
        class FakeZip {
            async loadAsync(file) { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return {
                        async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`
                    };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <manifest>
                                <item id="cover" href="images/cover.jpg" properties="cover-image"/>
                            </manifest>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                return undefined;
            }
            get files() { return {}; }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type }).window.document;
            }
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const exporter = new EPUBExporter();
        await exporter.parseEPUB({ name: 'file.epub' });
        expect(warnSpy).toHaveBeenCalledWith('[EPUBExporter] Cover file not found in zip:', 'OEBPS/images/cover.jpg');
        warnSpy.mockRestore();
    });

    it('Filters out files with nav. in their name', async () => {
        let htmlFilesChecked;
        class FakeZip {
            async loadAsync(file) { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return {
                        async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`
                    };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata>
                                <dc:title>Book</dc:title>
                            </metadata>
                            <manifest></manifest>
                            <spine></spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                if (name === 'OEBPS/chapter1.xhtml' || name === 'OEBPS/nav.xhtml') {
                    return {
                        async: async () => '<html><body><h2>Chap</h2><p>Text</p></body></html>',
                        name
                    };
                }
                return undefined;
            }
            get files() {
                htmlFilesChecked = {
                    'OEBPS/chapter1.xhtml': { async: async () => '<html><body><h2>Chap</h2><p>Text</p></body></html>', name: 'OEBPS/chapter1.xhtml' },
                    'OEBPS/nav.xhtml': { async: async () => '<html><body><h2>Nav</h2></body></html>', name: 'OEBPS/nav.xhtml' }
                };
                return htmlFilesChecked;
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type === 'text/xml' ? 'application/xml' : 'text/html' }).window.document;
            }
        };
        const exporter = new EPUBExporter();
        const result = await exporter.parseEPUB({ name: 'file.epub' });
        const chapterTitles = result.chapters.map(c => c.title);
        expect(chapterTitles).toContain('Chap');
        expect(chapterTitles).not.toContain('Nav');
    }); 

    it('Orders chapters according to spineOrder', async () => {
        class FakeZip {
            async loadAsync() { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return { async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>` };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata><dc:title>Book</dc:title></metadata>
                            <manifest></manifest>
                            <spine>
                                <itemref idref="chapter2"/>
                                <itemref idref="chapter1"/>
                            </spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                if (name === 'OEBPS/chapter1.xhtml' || name === 'OEBPS/chapter2.xhtml') {
                    return {
                        async: async () => `<html><body><h2>${name.includes('chapter1') ? 'First' : 'Second'}</h2><p>Text</p></body></html>`,
                        name
                    };
                }
                return undefined;
            }
            get files() {
                return {
                    'OEBPS/chapter1.xhtml': { async: async () => `<html><body><h2>First</h2><p>Text</p></body></html>`, name: 'OEBPS/chapter1.xhtml' },
                    'OEBPS/chapter2.xhtml': { async: async () => `<html><body><h2>Second</h2><p>Text</p></body></html>`, name: 'OEBPS/chapter2.xhtml' }
                };
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type === 'text/xml' ? 'application/xml' : 'text/html' }).window.document;
            }
        };
        const exporter = new EPUBExporter();
        const result = await exporter.parseEPUB({ name: 'file.epub' });
        const chapterTitles = result.chapters.map(c => c.title);
        expect(chapterTitles[0]).toBe('Second');
        expect(chapterTitles[1]).toBe('First');
    });

    it('Skips files when htmlFile is missing', async () => {
        class FakeZip {
            async loadAsync() { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return { async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>` };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata><dc:title>Book</dc:title></metadata>
                            <manifest></manifest>
                            <spine>
                                <itemref idref="chapter1"/>
                                <itemref idref="chapter2"/>
                            </spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                if (name === 'OEBPS/chapter1.xhtml') {
                    return {
                        async: async () => `<html><body><h2>First</h2><p>Text</p></body></html>`,
                        name
                    };
                }
                return undefined;
            }
            get files() {
                return {
                    'OEBPS/chapter1.xhtml': { async: async () => `<html><body><h2>First</h2><p>Text</p></body></html>`, name: 'OEBPS/chapter1.xhtml' },
                    'OEBPS/chapter2.xhtml': { async: async () => `<html><body><h2>Second</h2><p>Text</p></body></html>`, name: 'OEBPS/chapter2.xhtml' }
                };
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type === 'text/xml' ? 'application/xml' : 'text/html' }).window.document;
            }
        };
        const exporter = new EPUBExporter();
        const result = await exporter.parseEPUB({ name: 'file.epub' });
        const chapterTitles = result.chapters.map(c => c.title);
        expect(chapterTitles).toContain('First');
        expect(chapterTitles).not.toContain('Second');
    });

    it('Extracts image src', async () => {
        class FakeZip {
            async loadAsync() { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return { async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>` };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata><dc:title>Book</dc:title></metadata>
                            <manifest></manifest>
                            <spine>
                                <itemref idref="chapter1"/>
                            </spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                if (name === 'OEBPS/chapter1.xhtml') {
                    return {
                        async: async () => `<html><body><h2>First</h2><img src="img1.jpg"/></body></html>`,
                        name
                    };
                }
                if (name === 'OEBPS/img1.jpg') {
                    return {
                        async: async () => new Blob(['imgdata'], { type: 'image/jpeg' }),
                        async: async (type) => type === 'blob'
                            ? new Blob(['imgdata'], { type: 'image/jpeg' })
                            : undefined
                    };
                }
                return undefined;
            }
            get files() {
                return {
                    'OEBPS/chapter1.xhtml': { async: async () => `<html><body><h2>First</h2><img src="img1.jpg"/></body></html>`, name: 'OEBPS/chapter1.xhtml' },
                    'OEBPS/img1.jpg': { async: async () => new Blob(['imgdata'], { type: 'image/jpeg' }), name: 'OEBPS/img1.jpg' }
                };
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type === 'text/xml' ? 'application/xml' : 'text/html' }).window.document;
            }
        };
        const exporter = new EPUBExporter();
        exporter.blobToBase64 = async () => 'data:image/jpeg;base64,ZmFrZQ==';
        const result = await exporter.parseEPUB({ name: 'file.epub' });
        const images = result.chapters[0].content.filter(b => b.type === 'image');
        expect(images.length).toBe(1);
        expect(images[0].data.base64).toBe('ZmFrZQ==');
    });

    it('Calls warn when no body found', async () => {
        class FakeZip {
            async loadAsync() { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return { async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>` };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata>
                                <dc:title>Book</dc:title>
                                <dc:description>desc</dc:description>
                            </metadata>
                            <manifest></manifest>
                            <spine>
                                <itemref idref="chapter1"/>
                            </spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                if (name === 'OEBPS/chapter1.xhtml') {
                    return {
                        async: async () => `<html><head></head></html>`,
                        name
                    };
                }
                return undefined;
            }
            get files() {
                return {
                    'OEBPS/chapter1.xhtml': { async: async () => `<html><head></head></html>`, name: 'OEBPS/chapter1.xhtml' }
                };
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                const doc = new JSDOM(str, { contentType: 'text/html' }).window.document;
                const origQuerySelector = doc.querySelector.bind(doc);
                doc.querySelector = (selector) => selector === 'body' ? null : origQuerySelector(selector);
                return doc;
            }
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const exporter = new EPUBExporter();
        await exporter.parseEPUB({ name: 'file.epub' });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No body found in chapter file'));
        warnSpy.mockRestore();
    });

    it('Calls warn for empty paragraph', async () => {
        class FakeZip {
            async loadAsync() { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return { async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>` };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata><dc:title>Book</dc:title></metadata>
                            <manifest></manifest>
                            <spine>
                                <itemref idref="chapter1"/>
                            </spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                if (name === 'OEBPS/chapter1.xhtml') {
                    return {
                        async: async () => `<html><body><h2>First</h2><p>Text</p><p>   </p></body></html>`,
                        name
                    };
                }
                return undefined;
            }
            get files() {
                return {
                    'OEBPS/chapter1.xhtml': { async: async () => `<html><body><h2>First</h2><p>Text</p><p>   </p></body></html>`, name: 'OEBPS/chapter1.xhtml' }
                };
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type === 'text/xml' ? 'application/xml' : 'text/html' }).window.document;
            }
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const exporter = new EPUBExporter();
        await exporter.parseEPUB({ name: 'file.epub' });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Empty paragraph in chapter file'));
        warnSpy.mockRestore();
    });

    it('Calls warn for image with no src attribute', async () => {
        class FakeZip {
            async loadAsync() { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return { async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>` };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata><dc:title>Book</dc:title></metadata>
                            <manifest></manifest>
                            <spine>
                                <itemref idref="chapter1"/>
                            </spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                if (name === 'OEBPS/chapter1.xhtml') {
                    return {
                        async: async () => `<html><body><h2>First</h2><img/></body></html>`,
                        name
                    };
                }
                return undefined;
            }
            get files() {
                return {
                    'OEBPS/chapter1.xhtml': { async: async () => `<html><body><h2>First</h2><img/></body></html>`, name: 'OEBPS/chapter1.xhtml' }
                };
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type === 'text/xml' ? 'application/xml' : 'text/html' }).window.document;
            }
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const exporter = new EPUBExporter();
        await exporter.parseEPUB({ name: 'file.epub' });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Image with no src attribute in chapter file'));
        warnSpy.mockRestore();
    });

    it('Calls warn when image file not found', async () => {
        class FakeZip {
            async loadAsync() { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return { async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>` };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata><dc:title>Book</dc:title></metadata>
                            <manifest></manifest>
                            <spine>
                                <itemref idref="chapter1"/>
                            </spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                if (name === 'OEBPS/chapter1.xhtml') {
                    return {
                        async: async () => `<html><body><h2>First</h2><img src="img1.jpg"/></body></html>`,
                        name
                    };
                }
                return undefined;
            }
            get files() {
                return {
                    'OEBPS/chapter1.xhtml': { async: async () => `<html><body><h2>First</h2><img src="img1.jpg"/></body></html>`, name: 'OEBPS/chapter1.xhtml' }
                };
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: type === 'text/xml' ? 'application/xml' : 'text/html' }).window.document;
            }
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const exporter = new EPUBExporter();
        await exporter.parseEPUB({ name: 'file.epub' });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Image file not found in zip:'));
        warnSpy.mockRestore();
    });

    it('Uses default content type for images', async () => {
        class FakeZip {
            async loadAsync() { return this; }
            file(name) {
                if (name === 'META-INF/container.xml') {
                    return { async: async () => `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>` };
                }
                if (name === 'OEBPS/content.opf') {
                    return {
                        async: async () => `
                            <package xmlns:dc="http://purl.org/dc/elements/1.1/">
                            <metadata>
                                <dc:title>Book</dc:title>
                                <dc:description>desc</dc:description>
                            </metadata>
                            <manifest>
                                <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
                                <item id="img1" href="img1.jpg" media-type="image/jpeg"/>
                            </manifest>
                            <spine>
                                <itemref idref="chapter1"/>
                            </spine>
                            </package>
                        `,
                        name: 'OEBPS/content.opf'
                    };
                }
                if (name === 'OEBPS/chapter1.xhtml') {
                    return {
                        async: async () => `<html><body><h2>First</h2><img src="img1.jpg"/></body></html>`,
                        name
                    };
                }
                if (name === 'OEBPS/img1.jpg') {
                    return {
                        async: async (type) => {
                            if (type === 'blob') {
                                return new Blob(['imgdata']);
                            }
                            return undefined;
                        },
                        name: 'OEBPS/img1.jpg'
                    };
                }
                return undefined;
            }
            get files() {
                return {
                    'OEBPS/chapter1.xhtml': { async: async () => `<html><body><h2>First</h2><img src="img1.jpg"/></body></html>`, name: 'OEBPS/chapter1.xhtml' },
                    'OEBPS/img1.jpg': { async: async () => new Blob(['imgdata']), name: 'OEBPS/img1.jpg' }
                };
            }
        }
        global.JSZip = FakeZip;
        global.DOMParser = class {
            parseFromString(str, type) {
                const { JSDOM } = require('jsdom');
                return new JSDOM(str, { contentType: 'text/html' }).window.document;
            }
        };
        const exporter = new EPUBExporter();
        exporter.blobToBase64 = async () => 'data:;base64,ZmFrZQ==';
        const result = await exporter.parseEPUB({ name: 'file.epub' });
        const images = result.chapters[0].content.filter(b => b.type === 'image');
        expect(images.length).toBe(1);
        expect(images[0].data.contentType).toBe('image/jpeg');
    });
});