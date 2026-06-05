import { describe, it, expect, beforeEach, vi } from 'vitest';

const blobToText = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob, 'utf-8');
});

let SimpleExporter;

beforeEach(async () => {
    const basePath = require.resolve('../../exporters/BaseExporter.js');
    delete require.cache[basePath];
    await import('../../exporters/BaseExporter.js');
    const path = require.resolve('../../exporters/SimpleExporter.js');
    delete require.cache[path];
    await import('../../exporters/SimpleExporter.js');
    SimpleExporter = globalThis.SimpleExporter;
});

describe('SimpleExporter', () => {
    let exporter;
    beforeEach(() => {
        exporter = new SimpleExporter();
    });

    describe('sanitize', () => {
        it('Replaces forbidden characters with underscores', () => {
            expect(exporter.sanitize('file<>name')).toBe('file_name');
            expect(exporter.sanitize('a:b')).toBe('a_b');
        });

        it('Replaces whitespace sequences with a single underscore', () => {
            expect(exporter.sanitize('hello   world')).toBe('hello_world');
        });

        it('Collapses multiple underscores into one', () => {
            expect(exporter.sanitize('a___b')).toBe('a_b');
        });

        it('Trims leading and trailing underscores', () => {
            expect(exporter.sanitize('_hello_')).toBe('hello');
        });

        it('Returns "manga" for empty result after sanitization', () => {
            expect(exporter.sanitize('___')).toBe('manga');
        });

        it('Truncates to 180 characters', () => {
            const long = 'a'.repeat(300);
            expect(exporter.sanitize(long).length).toBe(180);
        });

        it('Converts non-string input via String()', () => {
            expect(exporter.sanitize(42)).toBe('42');
        });

        it('Replaces control characters (\\x00-\\x1F)', () => {
            expect(exporter.sanitize('a\x01b\x1Fc')).toBe('a_b_c');
        });
    });

    describe('isRanobeLib', () => {
        it('Returns true when a chapter has a non-empty text block', () => {
            const chapters = [
                { content: [{ type: 'text', text: 'Hello' }] }
            ];
            expect(exporter.isRanobeLib(chapters)).toBe(true);
        });

        it('Returns false when text block has only whitespace', () => {
            const chapters = [
                { content: [{ type: 'text', text: '   ' }] }
            ];
            expect(exporter.isRanobeLib(chapters)).toBe(false);
        });

        it('Returns false when text block has empty text', () => {
            const chapters = [
                { content: [{ type: 'text', text: '' }] }
            ];
            expect(exporter.isRanobeLib(chapters)).toBe(false);
        });

        it('Returns false when text block has no text property', () => {
            const chapters = [
                { content: [{ type: 'text' }] }
            ];
            expect(exporter.isRanobeLib(chapters)).toBe(false);
        });

        it('Returns false when all blocks are image type', () => {
            const chapters = [
                { content: [{ type: 'image', data: { base64: 'abc' } }] }
            ];
            expect(exporter.isRanobeLib(chapters)).toBe(false);
        });

        it('Skips chapters whose content is not an array', () => {
            const chapters = [
                { content: 'not-an-array' },
                { content: [{ type: 'text', text: 'Hi' }] }
            ];
            expect(exporter.isRanobeLib(chapters)).toBe(true);
        });

        it('Returns false for empty chapters array', () => {
            expect(exporter.isRanobeLib([])).toBe(false);
        });
    });

    describe('exportTxt', () => {
        it('Returns blob, filename and mimeType', () => {
            const manga = { name: 'Книга', authors: ['Author'] };
            const chapters = [
                { title: 'Глава 1', content: [{ type: 'text', text: 'Hello\nWorld' }] }
            ];
            const result = exporter.exportTxt('Книга', manga, chapters);
            expect(result).toHaveProperty('blob');
            expect(result).toHaveProperty('filename', 'Книга.txt');
            expect(result).toHaveProperty('mimeType', 'text/plain');
        });

        it('Includes title and separator in output', async () => {
            const manga = { name: 'Книга', authors: [] };
            const chapters = [];
            const result = exporter.exportTxt('Книга', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('Книга');
            expect(text).toContain('─'.repeat(60));
        });

        it('Includes author when present', async () => {
            const manga = { name: 'Book', authors: ['Author Name'] };
            const chapters = [];
            const result = exporter.exportTxt('Book', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('Author Name');
        });

        it('Omits author line when resolveAuthor returns empty string', async () => {
            const manga = { name: 'Book', authors: [] };
            const chapters = [];
            const result = exporter.exportTxt('Book', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).not.toContain('null');
        });

        it('Writes chapter heading and text content', async () => {
            const manga = { name: 'Book', authors: [] };
            const chapters = [
                { title: 'Intro', content: [{ type: 'text', text: 'Line1\nLine2' }] }
            ];
            const result = exporter.exportTxt('Book', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('=== Глава 1: Intro ===');
            expect(text).toContain('Line1');
            expect(text).toContain('Line2');
        });

        it('Skips non-text blocks in content', async () => {
            const manga = { name: 'Book', authors: [] };
            const chapters = [
                { title: 'Ch', content: [{ type: 'image', data: {} }, { type: 'text', text: 'Real' }] }
            ];
            const result = exporter.exportTxt('Book', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('Real');
        });

        it('Skips text blocks with falsy text', async () => {
            const manga = { name: 'Book', authors: [] };
            const chapters = [
                { title: 'Ch', content: [{ type: 'text', text: '' }, { type: 'text', text: null }] }
            ];
            const result = exporter.exportTxt('Book', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('=== Глава 1: Ch ===');
        });

        it('Handles chapter with no content array', async () => {
            const manga = { name: 'Book', authors: [] };
            const chapters = [{ title: 'Empty' }];
            const result = exporter.exportTxt('Book', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('=== Глава 1: Empty ===');
        });

        it('Uses empty string for missing chapter title', async () => {
            const manga = { name: 'Book', authors: [] };
            const chapters = [{ content: [{ type: 'text', text: 'Text' }] }];
            const result = exporter.exportTxt('Book', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('=== Глава 1:  ===');
        });

        it('Includes summary in TXT output when present', async () => {
            const manga = { name: 'Book', authors: [], summary: 'Краткое описание' };
            const result = exporter.exportTxt('Book', manga, []);
            const text = await blobToText(result.blob);
            expect(text).toContain('Краткое описание');
        });

        it('Omits summary line when summary is empty', async () => {
            const manga = { name: 'Book', authors: [], summary: '' };
            const result = exporter.exportTxt('Book', manga, []);
            const text = await blobToText(result.blob);
            expect(text).not.toContain('Краткое описание');
        });

        it('Uses name as title fallback when rus_name absent', async () => {
            const manga = { name: 'FallbackTitle', authors: [] };
            const chapters = [];
            const result = exporter.exportTxt('FallbackTitle', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('FallbackTitle');
        });

        it('Uses Без названия when manga name is absent', async () => {
            const manga = { authors: [] };
            const chapters = [];
            const result = exporter.exportTxt('myname', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('Без названия');
        });
    });

    describe('mimeToExt', () => {
        it('Returns "png" for image/png', () => {
            expect(exporter.mimeToExt('image/png')).toBe('png');
        });

        it('Returns "webp" for image/webp', () => {
            expect(exporter.mimeToExt('image/webp')).toBe('webp');
        });

        it('Returns "gif" for image/gif', () => {
            expect(exporter.mimeToExt('image/gif')).toBe('gif');
        });

        it('Returns "jpg" for image/jpeg and unknown types', () => {
            expect(exporter.mimeToExt('image/jpeg')).toBe('jpg');
            expect(exporter.mimeToExt('application/octet-stream')).toBe('jpg');
        });
    });

    describe('exportZip', () => {
        it('Throws when JSZip is not available', async () => {
            const savedJSZip = globalThis.JSZip;
            delete globalThis.JSZip;
            await expect(exporter.exportZip('book', [])).rejects.toThrow('[SimpleExporter] JSZip not loaded');
            if (savedJSZip !== undefined) globalThis.JSZip = savedJSZip;
        });

        it('Returns blob, filename and mimeType when JSZip is available', async () => {
            const mockBlob = new Blob(['zip'], { type: 'application/zip' });
            const mockFile = vi.fn();
            const mockGenerateAsync = vi.fn().mockResolvedValue(mockBlob);
            globalThis.JSZip = class { constructor() { this.file = mockFile; this.generateAsync = mockGenerateAsync; } };

            const result = await exporter.exportZip('mybook', []);
            expect(result.filename).toBe('mybook.zip');
            expect(result.mimeType).toBe('application/zip');
            expect(result.blob).toBe(mockBlob);

            delete globalThis.JSZip;
        });

        it('Adds image pages to zip with correct filenames', async () => {
            const mockBlob = new Blob(['zip'], { type: 'application/zip' });
            const mockFile = vi.fn();
            const mockGenerateAsync = vi.fn().mockResolvedValue(mockBlob);
            globalThis.JSZip = class { constructor() { this.file = mockFile; this.generateAsync = mockGenerateAsync; } };

            const chapters = [
                {
                    volume: 1,
                    number: 2,
                    content: [
                        { type: 'image', data: { base64: 'abc', contentType: 'image/png' } },
                        { type: 'image', data: { base64: 'def', contentType: 'image/webp' } },
                    ]
                }
            ];
            await exporter.exportZip('mybook', chapters);

            expect(mockFile).toHaveBeenCalledWith('mybook_volume_1_chapter_2_page_1.png', 'abc', { base64: true });
            expect(mockFile).toHaveBeenCalledWith('mybook_volume_1_chapter_2_page_2.webp', 'def', { base64: true });

            delete globalThis.JSZip;
        });

        it('Uses index+1 as volume/number when absent', async () => {
            const mockBlob = new Blob(['zip']);
            const mockFile = vi.fn();
            const mockGenerateAsync = vi.fn().mockResolvedValue(mockBlob);
            globalThis.JSZip = class { constructor() { this.file = mockFile; this.generateAsync = mockGenerateAsync; } };

            const chapters = [
                {
                    content: [
                        { type: 'image', data: { base64: 'img', contentType: 'image/jpeg' } }
                    ]
                }
            ];
            await exporter.exportZip('book', chapters);
            expect(mockFile).toHaveBeenCalledWith('book_volume_1_chapter_1_page_1.jpg', 'img', { base64: true });

            delete globalThis.JSZip;
        });

        it('Skips chapters without content array', async () => {
            const mockBlob = new Blob(['zip']);
            const mockFile = vi.fn();
            const mockGenerateAsync = vi.fn().mockResolvedValue(mockBlob);
            globalThis.JSZip = class { constructor() { this.file = mockFile; this.generateAsync = mockGenerateAsync; } };

            const chapters = [{ title: 'NoContent' }];
            await exporter.exportZip('book', chapters);
            expect(mockFile).not.toHaveBeenCalled();

            delete globalThis.JSZip;
        });

        it('Skips non-image blocks and blocks without base64', async () => {
            const mockBlob = new Blob(['zip']);
            const mockFile = vi.fn();
            const mockGenerateAsync = vi.fn().mockResolvedValue(mockBlob);
            globalThis.JSZip = class { constructor() { this.file = mockFile; this.generateAsync = mockGenerateAsync; } };

            const chapters = [
                {
                    content: [
                        { type: 'text', text: 'hello' },
                        { type: 'image', data: null },
                        { type: 'image' },
                        { type: 'image', data: { contentType: 'image/jpeg' } },
                    ]
                }
            ];
            await exporter.exportZip('book', chapters);
            expect(mockFile).not.toHaveBeenCalled();

            delete globalThis.JSZip;
        });

        it('Uses image/jpeg as default contentType for image blocks', async () => {
            const mockBlob = new Blob(['zip']);
            const mockFile = vi.fn();
            const mockGenerateAsync = vi.fn().mockResolvedValue(mockBlob);
            globalThis.JSZip = class { constructor() { this.file = mockFile; this.generateAsync = mockGenerateAsync; } };

            const chapters = [
                {
                    content: [
                        { type: 'image', data: { base64: 'x' } }
                    ]
                }
            ];
            await exporter.exportZip('book', chapters);
            expect(mockFile).toHaveBeenCalledWith(
                expect.stringMatching(/\.jpg$/), 'x', { base64: true }
            );

            delete globalThis.JSZip;
        });
    });

    describe('export', () => {
        it('Calls exportTxt when isRanobeLib returns true', async () => {
            const chapters = [{ content: [{ type: 'text', text: 'Hello' }] }];
            const manga = { name: 'Книга', authors: [] };
            const result = await exporter.export(manga, chapters, null);
            expect(result.mimeType).toBe('text/plain');
            expect(result.filename).toMatch(/\.txt$/);
        });

        it('Calls exportZip when isRanobeLib returns false', async () => {
            const mockBlob = new Blob(['zip']);
            const mockFile = vi.fn();
            const mockGenerateAsync = vi.fn().mockResolvedValue(mockBlob);
            globalThis.JSZip = class { constructor() { this.file = mockFile; this.generateAsync = mockGenerateAsync; } };

            const chapters = [{ content: [{ type: 'image', data: { base64: 'x', contentType: 'image/jpeg' } }] }];
            const manga = { name: 'MyManga', authors: [] };
            const result = await exporter.export(manga, chapters, null);
            expect(result.mimeType).toBe('application/zip');
            expect(result.filename).toMatch(/\.zip$/);

            delete globalThis.JSZip;
        });

        it('Falls back to "book" when manga has no name', async () => {
            const chapters = [{ content: [{ type: 'text', text: 'Hi' }] }];
            const manga = { authors: [] };
            const result = await exporter.export(manga, chapters, null);
            expect(result.filename).toBe('manga.txt');
        });

        it('Includes releaseDate in TXT header', async () => {
            const manga = { name: 'Test', authors: ['A'], releaseDate: '2021', genres: [], summary: '' };
            const chapters = [{ title: 'Ch1', content: [{ type: 'text', text: 'text' }] }];
            const result = await exporter.export(manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('Год выхода: 2021');
        });

        it('Includes rating in TXT header', async () => {
            const manga = { name: 'Test', authors: ['A'], rating: '18+', genres: [], summary: '' };
            const chapters = [{ title: 'Ch1', content: [{ type: 'text', text: 'text' }] }];
            const result = await exporter.export(manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('Возрастное ограничение: 18+');
        });

        it('Includes genres in TXT header', async () => {
            const manga = { name: 'Test', authors: ['A'], genres: ['Экшен', 'Фэнтези'], summary: '' };
            const chapters = [{ title: 'Ch1', content: [{ type: 'text', text: 'text' }] }];
            const result = await exporter.export(manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('Жанры: Экшен, Фэнтези');
        });

        it('Omits releaseDate line when releaseDate is absent', async () => {
            const manga = { name: 'Test', authors: ['A'], genres: [], summary: '' };
            const chapters = [{ title: 'Ch1', content: [{ type: 'text', text: 'text' }] }];
            const result = await exporter.export(manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).not.toContain('Год выхода:');
        });

        it('Omits genres line when genres is empty', async () => {
            const manga = { name: 'Test', authors: ['A'], genres: [], summary: '' };
            const chapters = [{ title: 'Ch1', content: [{ type: 'text', text: 'text' }] }];
            const result = await exporter.export(manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).not.toContain('Жанры:');
        });
    });

    describe('parse', () => {
        it('Routes .zip files to parseZip', () => {
            exporter.parseZip = vi.fn().mockResolvedValue({ metadata: {}, cover: '', chapters: [] });
            const file = { name: 'test.zip' };
            exporter.parse(file);
            expect(exporter.parseZip).toHaveBeenCalledWith(file);
        });

        it('Routes .ZIP (uppercase) files to parseZip', () => {
            exporter.parseZip = vi.fn().mockResolvedValue({ metadata: {}, cover: '', chapters: [] });
            const file = { name: 'test.ZIP' };
            exporter.parse(file);
            expect(exporter.parseZip).toHaveBeenCalledWith(file);
        });

        it('Routes non-zip files to parseTxt', () => {
            exporter.parseTxt = vi.fn().mockResolvedValue({ metadata: {}, cover: '', chapters: [] });
            const file = { name: 'test.txt' };
            exporter.parse(file);
            expect(exporter.parseTxt).toHaveBeenCalledWith(file);
        });

        it('Routes files with no name to parseTxt', () => {
            exporter.parseTxt = vi.fn().mockResolvedValue({ metadata: {}, cover: '', chapters: [] });
            exporter.parse({});
            expect(exporter.parseTxt).toHaveBeenCalled();
        });
    });

    describe('_extractVolNum', () => {
        it('Parses "Том X, Глава Y" pattern', () => {
            expect(exporter._extractVolNum('Том 1, Глава 5')).toEqual({ volume: '1', number: '5' });
        });

        it('Parses "Том X Глава Y" pattern with space separator', () => {
            expect(exporter._extractVolNum('Том 2 Глава 10')).toEqual({ volume: '2', number: '10' });
        });

        it('Parses "Глава Y" pattern with default volume 1', () => {
            expect(exporter._extractVolNum('Глава 3')).toEqual({ volume: '1', number: '3' });
        });

        it('Returns null for unrecognized pattern', () => {
            expect(exporter._extractVolNum('Chapter 1')).toBeNull();
        });
    });

    describe('_readText', () => {
        it('Reads text from a File', async () => {
            const file = new File(['Hello World'], 'test.txt', { type: 'text/plain' });
            const result = await exporter._readText(file);
            expect(result).toBe('Hello World');
        });

        it('Reads UTF-8 text correctly', async () => {
            const file = new File(['Привет мир'], 'test.txt', { type: 'text/plain' });
            const result = await exporter._readText(file);
            expect(result).toBe('Привет мир');
        });
    });

    describe('_blobToBase64', () => {
        it('Converts blob to base64 data URL', async () => {
            const blob = new Blob(['ABC'], { type: 'text/plain' });
            const result = await exporter._blobToBase64(blob);
            expect(result).toMatch(/^data:text\/plain;base64,/);
        });

        it('Converts binary blob to base64 data URL', async () => {
            const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
            const result = await exporter._blobToBase64(blob);
            expect(result).toMatch(/^data:image\/jpeg;base64,/);
        });
    });

    describe('parseTxt', () => {
        const sep = '─'.repeat(60);

        it('Parses title and author from header', async () => {
            const content = `Book Title\nAuthor Name\n${sep}\n\n=== Глава 1: Intro ===\n\nText\n\n`;
            const file = new File([content], 'book.txt', { type: 'text/plain' });
            const result = await exporter.parseTxt(file);
            expect(result.metadata.name).toBe('Book Title');
            expect(result.metadata.authors).toContain('Author Name');
        });

        it('Parses chapter heading and content', async () => {
            const content = `Title\n${sep}\n\n=== Глава 1: Intro ===\n\nSome text\n\n`;
            const file = new File([content], 'book.txt');
            const result = await exporter.parseTxt(file);
            expect(result.chapters).toHaveLength(1);
            expect(result.chapters[0].title).toBe('Intro');
        });

        it('Accumulates multiple lines into a single text block', async () => {
            const content = `Title\n${sep}\n\n=== Глава 1: Ch1 ===\n\nLine1\nLine2\n\n`;
            const file = new File([content], 'book.txt');
            const result = await exporter.parseTxt(file);
            expect(result.chapters[0].content[0].text).toContain('Line1');
            expect(result.chapters[0].content[0].text).toContain('Line2');
        });

        it('Handles multiple chapters', async () => {
            const content = `Title\n${sep}\n\n=== Глава 1: Ch1 ===\n\nText1\n\n=== Глава 2: Ch2 ===\n\nText2\n\n`;
            const file = new File([content], 'book.txt');
            const result = await exporter.parseTxt(file);
            expect(result.chapters).toHaveLength(2);
            expect(result.chapters[1].title).toBe('Ch2');
        });

        it('Extracts volume and number from "Том X, Глава Y" chapter title', async () => {
            const content = `Title\n${sep}\n\n=== Глава 1: Том 2, Глава 5 ===\n\nText\n\n`;
            const file = new File([content], 'book.txt');
            const result = await exporter.parseTxt(file);
            expect(result.chapters[0].volume).toBe('2');
            expect(result.chapters[0].number).toBe('5');
        });

        it('Extracts number from "Глава Y" chapter title', async () => {
            const content = `Title\n${sep}\n\n=== Глава 1: Глава 3 ===\n\nText\n\n`;
            const file = new File([content], 'book.txt');
            const result = await exporter.parseTxt(file);
            expect(result.chapters[0].number).toBe('3');
            expect(result.chapters[0].volume).toBe('1');
        });

        it('Uses chapter index as number when title has no pattern', async () => {
            const content = `Title\n${sep}\n\n=== Глава 1: Random Title ===\n\nText\n\n`;
            const file = new File([content], 'book.txt');
            const result = await exporter.parseTxt(file);
            expect(result.chapters[0].number).toBe('1');
            expect(result.chapters[0].volume).toBe('1');
        });

        it('Uses filename as name when header is empty', async () => {
            const content = `=== Глава 1: Ch1 ===\n\nText\n\n`;
            const file = new File([content], 'mybook.txt');
            const result = await exporter.parseTxt(file);
            expect(result.metadata.name).toBe('mybook');
        });

        it('Ignores header line starting with "Год" as author', async () => {
            const content = `Title\nГод выхода: 2020\n${sep}\n\n=== Глава 1: Ch1 ===\n\nText\n\n`;
            const file = new File([content], 'book.txt');
            const result = await exporter.parseTxt(file);
            expect(result.metadata.authors).toEqual([]);
        });

        it('Ignores header line starting with "Жанры" as author', async () => {
            const content = `Title\nЖанры: Экшен\n${sep}\n\n=== Глава 1: Ch1 ===\n\nText\n\n`;
            const file = new File([content], 'book.txt');
            const result = await exporter.parseTxt(file);
            expect(result.metadata.authors).toEqual([]);
        });

        it('Ignores separator line as author', async () => {
            const content = `Title\n${sep}\n\n=== Глава 1: Ch1 ===\n\nText\n\n`;
            const file = new File([content], 'book.txt');
            const result = await exporter.parseTxt(file);
            expect(result.metadata.authors).toEqual([]);
        });

        it('Returns empty chapters and correct metadata structure', async () => {
            const content = `Title\n${sep}\n\n`;
            const file = new File([content], 'book.txt');
            const result = await exporter.parseTxt(file);
            expect(result).toHaveProperty('metadata');
            expect(result).toHaveProperty('cover', '');
            expect(result).toHaveProperty('chapters');
            expect(result.metadata.genres).toEqual([]);
            expect(result.metadata.tags).toEqual([]);
        });
    });

    describe('parseZip', () => {
        it('Throws when JSZip not loaded', async () => {
            const saved = globalThis.JSZip;
            delete globalThis.JSZip;
            await expect(exporter.parseZip({ name: 'test.zip' })).rejects.toThrow('[SimpleExporter] JSZip not loaded');
            if (saved !== undefined) globalThis.JSZip = saved;
        });

        it('Parses zip with patterned filename into chapters with volume/number', async () => {
            const mockBlob = new Blob(['imgdata'], { type: 'image/jpeg' });
            const mockImageFile = { async: vi.fn().mockResolvedValue(mockBlob) };
            const zipContent = {
                files: { 'book_volume_1_chapter_2_page_1.jpg': {} },
                file: vi.fn().mockReturnValue(mockImageFile)
            };
            globalThis.JSZip = class { loadAsync = vi.fn().mockResolvedValue(zipContent); };
            exporter._blobToBase64 = vi.fn().mockResolvedValue('data:image/jpeg;base64,aW1n');
            const file = new File(['zip'], 'mybook.zip');
            const result = await exporter.parseZip(file);
            expect(result.chapters).toHaveLength(1);
            expect(result.chapters[0].volume).toBe('1');
            expect(result.chapters[0].number).toBe('2');
            expect(result.chapters[0].content[0].type).toBe('image');
            delete globalThis.JSZip;
        });

        it('Uses default volume/number when filename has no pattern', async () => {
            const mockBlob = new Blob(['imgdata'], { type: 'image/jpeg' });
            const mockImageFile = { async: vi.fn().mockResolvedValue(mockBlob) };
            const zipContent = {
                files: { 'random_image.jpg': {} },
                file: vi.fn().mockReturnValue(mockImageFile)
            };
            globalThis.JSZip = class { loadAsync = vi.fn().mockResolvedValue(zipContent); };
            exporter._blobToBase64 = vi.fn().mockResolvedValue('data:image/jpeg;base64,xxx');
            const file = new File(['zip'], 'book.zip');
            const result = await exporter.parseZip(file);
            expect(result.chapters[0].volume).toBe('1');
            expect(result.chapters[0].number).toBe('1');
            delete globalThis.JSZip;
        });

        it('Skips image files that are null in zip', async () => {
            const zipContent = {
                files: { 'book_volume_1_chapter_1_page_1.jpg': {} },
                file: vi.fn().mockReturnValue(null)
            };
            globalThis.JSZip = class { loadAsync = vi.fn().mockResolvedValue(zipContent); };
            const file = new File(['zip'], 'book.zip');
            const result = await exporter.parseZip(file);
            expect(result.chapters).toHaveLength(0);
            delete globalThis.JSZip;
        });

        it('Skips non-image files', async () => {
            const zipContent = {
                files: { 'readme.txt': {}, 'image.jpg': {} },
                file: vi.fn().mockReturnValue({ async: vi.fn().mockResolvedValue(new Blob(['data'])) })
            };
            globalThis.JSZip = class { loadAsync = vi.fn().mockResolvedValue(zipContent); };
            exporter._blobToBase64 = vi.fn().mockResolvedValue('data:image/jpeg;base64,xxx');
            const file = new File(['zip'], 'book.zip');
            const result = await exporter.parseZip(file);
            expect(result.chapters[0].content).toHaveLength(1);
            delete globalThis.JSZip;
        });

        it('Uses filename without extension as metadata name', async () => {
            const zipContent = { files: {}, file: vi.fn() };
            globalThis.JSZip = class { loadAsync = vi.fn().mockResolvedValue(zipContent); };
            const file = new File(['zip'], 'mybook.zip');
            const result = await exporter.parseZip(file);
            expect(result.metadata.name).toBe('mybook');
            expect(result.metadata.rus_name).toBe('mybook');
            delete globalThis.JSZip;
        });

        it('Generates correct chapter title from volume and number', async () => {
            const mockBlob = new Blob(['d'], { type: 'image/jpeg' });
            const mockImageFile = { async: vi.fn().mockResolvedValue(mockBlob) };
            const zipContent = {
                files: { 'b_volume_3_chapter_7_page_1.jpg': {} },
                file: vi.fn().mockReturnValue(mockImageFile)
            };
            globalThis.JSZip = class { loadAsync = vi.fn().mockResolvedValue(zipContent); };
            exporter._blobToBase64 = vi.fn().mockResolvedValue('data:image/jpeg;base64,xxx');
            const file = new File(['zip'], 'b.zip');
            const result = await exporter.parseZip(file);
            expect(result.chapters[0].title).toBe('Том 3, Глава 7');
            delete globalThis.JSZip;
        });

        it('Adds multiple images to same chapter when they share volume/chapter key', async () => {
            const mockBlob = new Blob(['d'], { type: 'image/jpeg' });
            const mockImageFile = { async: vi.fn().mockResolvedValue(mockBlob) };
            const zipContent = {
                files: {
                    'b_volume_1_chapter_1_page_1.jpg': {},
                    'b_volume_1_chapter_1_page_2.jpg': {}
                },
                file: vi.fn().mockReturnValue(mockImageFile)
            };
            globalThis.JSZip = class { loadAsync = vi.fn().mockResolvedValue(zipContent); };
            exporter._blobToBase64 = vi.fn().mockResolvedValue('data:image/jpeg;base64,xxx');
            const file = new File(['zip'], 'b.zip');
            const result = await exporter.parseZip(file);
            expect(result.chapters).toHaveLength(1);
            expect(result.chapters[0].content).toHaveLength(2);
            delete globalThis.JSZip;
        });

        it('Falls back to Unknown when file has no name', async () => {
            const zipContent = { files: {}, file: vi.fn() };
            globalThis.JSZip = class { loadAsync = vi.fn().mockResolvedValue(zipContent); };
            const file = new File(['zip'], '');
            const result = await exporter.parseZip(file);
            expect(result.metadata.name).toBe('Unknown');
            delete globalThis.JSZip;
        });
    });

    it('parseTxt falls back to Unknown when file has no name and no header', async () => {
        const file = new File(['=== Глава 1: Title ===\nSome text\n'], '', { type: 'text/plain' });
        const result = await exporter.parseTxt(file);
        expect(result.metadata.name).toBe('Unknown');
    });

    it('Registers with ExporterRegistry when it is already defined on load', async () => {
        vi.resetModules();
        const register = vi.fn();
        global.ExporterRegistry = { register };
        await import('../../exporters/BaseExporter.js');
        await import('../../exporters/SimpleExporter.js');
        expect(register).toHaveBeenCalledWith('simple', expect.any(Function), { label: 'TXT/JPEG' });
        delete global.ExporterRegistry;
    });
});
