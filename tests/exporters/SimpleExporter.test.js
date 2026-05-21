import { describe, it, expect, beforeEach, vi } from 'vitest';

const blobToText = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob, 'utf-8');
});

let SimpleExporter;

beforeEach(async () => {
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

        it('Returns "book" for empty result after sanitization', () => {
            expect(exporter.sanitize('___')).toBe('book');
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

        it('Uses name as title fallback when rus_name absent', async () => {
            const manga = { name: 'FallbackTitle', authors: [] };
            const chapters = [];
            const result = exporter.exportTxt('FallbackTitle', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('FallbackTitle');
        });

        it('Uses passed name when both rus_name and name are absent', async () => {
            const manga = { authors: [] };
            const chapters = [];
            const result = exporter.exportTxt('myname', manga, chapters);
            const text = await blobToText(result.blob);
            expect(text).toContain('myname');
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
            expect(result.filename).toBe('book.txt');
        });
    });
});
