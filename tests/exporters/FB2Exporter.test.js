import { describe, it, expect, beforeEach, vi } from 'vitest';

let FB2Exporter;
beforeEach(async () => {
    vi.resetModules();
    ({ FB2Exporter } = await import('../../exporters/FB2Exporter.js'));
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
        expect(result.mimeType).toBe('application/x-fictionbook+xml');
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

    it('Writes <date> and <publish-info> when releaseDate is set', () => {
        const manga = { name: 'Test', authors: ['Author'], releaseDate: '2021' };
        const result = Array.from(exporter.createFB2Stream(manga, [])).join('');
        expect(result).toContain('<date value="2021">2021</date>');
        expect(result).toContain('<publish-info>');
        expect(result).toContain('<year>2021</year>');
    });

    it('Omits <date> and <publish-info> when releaseDate is absent', () => {
        const manga = { name: 'Test', authors: ['Author'] };
        const result = Array.from(exporter.createFB2Stream(manga, [])).join('');
        expect(result).not.toContain('<date');
        expect(result).not.toContain('<publish-info>');
    });

    it('Writes <keywords> from genres and tags', () => {
        const manga = { name: 'Test', authors: ['Author'], genres: ['Экшен', 'Фэнтези'], tags: ['Магия'] };
        const result = Array.from(exporter.createFB2Stream(manga, [])).join('');
        expect(result).toContain('<keywords>Экшен, Фэнтези, Магия</keywords>');
    });

    it('Omits <keywords> when genres and tags are empty', () => {
        const manga = { name: 'Test', authors: ['Author'], genres: [], tags: [] };
        const result = Array.from(exporter.createFB2Stream(manga, [])).join('');
        expect(result).not.toContain('<keywords>');
    });

    it('Writes <custom-info age-rating> when rating is set', () => {
        const manga = { name: 'Test', authors: ['Author'], rating: '18+' };
        const result = Array.from(exporter.createFB2Stream(manga, [])).join('');
        expect(result).toContain('<custom-info info-type="age-rating">18+</custom-info>');
    });

    it('Omits <custom-info> when rating is absent', () => {
        const manga = { name: 'Test', authors: ['Author'] };
        const result = Array.from(exporter.createFB2Stream(manga, [])).join('');
        expect(result).not.toContain('age-rating');
    });

    it('Renders center-aligned HTML block as poem/stanza (covers _htmlToFb2 and _yieldFb2HtmlBlock center)', () => {
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [{
            title: 'Ch1',
            content: [{ type: 'text', text: 'some', html: '<br/><b>Bold</b>', align: 'center' }]
        }];
        const result = Array.from(exporter.createFB2Stream(manga, chapters)).join('');
        expect(result).toContain('<poem><stanza>');
        expect(result).toContain('<v>&#160;</v>');
        expect(result).toContain('<v><strong>Bold</strong></v>');
        expect(result).toContain('</stanza></poem>');
    });

    it('Renders non-centered HTML block with empty-line for blank parts (covers _yieldFb2HtmlBlock else)', () => {
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [{
            title: 'Ch1',
            content: [{ type: 'text', text: 'some', html: '<br/>World' }]
        }];
        const result = Array.from(exporter.createFB2Stream(manga, chapters)).join('');
        expect(result).toContain('<empty-line/>');
        expect(result).toContain('<p>World</p>');
    });

    it('Renders center-aligned text block as poem/stanza (covers _yieldFb2TextBlock center)', () => {
        const manga = { name: 'Test', authors: ['Author'] };
        const chapters = [{
            title: 'Ch1',
            content: [{ type: 'text', text: 'Hello\n\nWorld', align: 'center' }]
        }];
        const result = Array.from(exporter.createFB2Stream(manga, chapters)).join('');
        expect(result).toContain('<poem><stanza>');
        expect(result).toContain('<v>Hello</v>');
        expect(result).toContain('<v>&#160;</v>');
        expect(result).toContain('<v>World</v>');
        expect(result).toContain('</stanza></poem>');
    });

});
