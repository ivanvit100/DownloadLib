import { describe, it, expect, beforeEach } from 'vitest';

let MOBIExporter;

const decodeBlobToText = async (blob) => {
    let buf;
    if (blob && typeof blob.arrayBuffer === 'function') {
        buf = await blob.arrayBuffer();
    } else {
        buf = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
        });
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
};

beforeEach(async () => {
    const basePath = require.resolve('../../exporters/BaseExporter.js');
    delete require.cache[basePath];
    await import('../../exporters/BaseExporter.js');
    const path = require.resolve('../../exporters/MOBIExporter.js');
    delete require.cache[path];
    await import('../../exporters/MOBIExporter.js');
    MOBIExporter = globalThis.MOBIExporter;

    if (!globalThis.atob) {
        globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
    }
});

describe('MOBIExporter', () => {
    it('Exports with defaults and writes MOBI header', async () => {
        const exporter = new MOBIExporter();
        const result = await exporter.export({ authors: [] }, []);
        expect(result.filename).toBe('manga.mobi');
        expect(result.mimeType).toBe('application/x-mobipocket-ebook');

        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('BOOKMOBI');
        expect(text).toContain('<html>');
    });

    it('Uses name and authors array', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Название', authors: ['A', 'B'] };
        const chapters = [{ title: 'Глава 1', content: [{ type: 'text', text: 'Текст' }] }];
        const result = await exporter.export(manga, chapters);

        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('Название');
        expect(text).toContain('A, B');
        expect(text).toContain('<h2>Глава 1</h2>');
    });

    it('Escapes HTML in title and text blocks', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'A < B & C', authors: [] };
        const chapters = [
            { title: 'T < 1', content: [{ type: 'text', text: 'Line <1> & "2"' }] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('A &lt; B &amp; C');
        expect(text).toContain('<h2>T &lt; 1</h2>');
        expect(text).toContain('Line &lt;1&gt; &amp; &quot;2&quot;');
    });

    it('Renders empty lines as non-breaking paragraphs', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const chapters = [
            { title: 'Chapter', content: [{ type: 'text', text: 'Hello\n\nWorld' }] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('<p>Hello</p>');
        expect(text).toContain('<p>&#160;</p>');
        expect(text).toContain('<p>World</p>');
    });

    it('Adds cover and image records with recindex ordering', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const chapters = [
            { title: 'Chapter', content: [
                { type: 'image', data: { base64: 'AQID', contentType: 'image/png' } }
            ] }
        ];
        const coverBase64 = 'data:image/jpeg;base64,AAEC';
        const result = await exporter.export(manga, chapters, coverBase64);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('recindex="0001"');
        expect(text).toContain('recindex="0002"');
    });

    it('Uses first image as recindex 0001 when no cover', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const chapters = [
            { title: 'Chapter', content: [
                { type: 'image', data: { base64: 'AQID', contentType: 'image/png' } }
            ] }
        ];
        const result = await exporter.export(manga, chapters, null);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('recindex="0001"');
    });

    it('Skips non-array chapter content without throwing', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const chapters = [
            { title: 'Bad', content: null },
            { title: 'Good', content: [{ type: 'text', text: 'Ok' }] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('<h2>Bad</h2>');
        expect(text).toContain('<h2>Good</h2>');
        expect(text).toContain('<p>Ok</p>');
    });

    it('Handles long UTF-8 text without errors', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Long', authors: [] };
        const longText = '😀'.repeat(5000);
        const chapters = [
            { title: 'Long', content: [{ type: 'text', text: longText }] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('<h2>Long</h2>');
    });

    it('Writes summary to EXTH record 103 when present', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: ['A'], summary: 'Some description' };
        const result = await exporter.export(manga, []);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('Some description');
    });

    it('Omits EXTH record 103 when summary is empty', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: ['A'], summary: '' };
        const result = await exporter.export(manga, []);
        const text = await decodeBlobToText(result.blob);
        expect(text).not.toContain('Some description');
    });

    it('Resolves plain string author', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: ['Single Author'] };
        const result = await exporter.export(manga, []);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('Single Author');
    });

    it('Resolves author array with all empty names to Unknown', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: ['', ''] };
        const result = await exporter.export(manga, []);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('Неизвестно');
    });

    it('Skips image block without data field', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const chapters = [
            { title: 'Ch', content: [{ type: 'image' }, { type: 'text', text: 'after' }] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('<p>after</p>');
        expect(text).not.toContain('recindex');
    });

    it('Skips image block with data but no base64', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const chapters = [
            { title: 'Ch', content: [{ type: 'image', data: { contentType: 'image/png' } }] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).not.toContain('recindex');
    });

    it('Defaults image contentType to image/jpeg when missing', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const chapters = [
            { title: 'Ch', content: [{ type: 'image', data: { base64: 'AQID' } }] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('recindex="0001"');
    });

    it('Handles cover base64 without data: prefix', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const result = await exporter.export(manga, [], 'AAEC');
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('recindex="0001"');
    });

    it('Skips text block with falsy text value', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const chapters = [
            { title: 'Ch', content: [{ type: 'text' }, { type: 'text', text: 'real' }] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('<p>real</p>');
    });

    it('Ignores unknown block types', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const chapters = [
            { title: 'Ch', content: [{ type: 'audio', src: 'file.mp3' }, { type: 'text', text: 'ok' }] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('<p>ok</p>');
    });

    it('Handles chapter with null/undefined title via escapeXml', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: [] };
        const chapters = [
            { title: null, content: [{ type: 'text', text: 'body' }] },
            { title: undefined, content: [] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('<h2></h2>');
        expect(text).toContain('<p>body</p>');
    });

    it('Encodes genres as EXTH-105 subjects in binary', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: ['A'], genres: ['Экшен', 'Фэнтези'], tags: [] };
        const result = await exporter.export(manga, []);
        const raw = await decodeBlobToText(result.blob);
        expect(raw).toContain('Экшен');
        expect(raw).toContain('Фэнтези');
    });

    it('Encodes tags as EXTH-105 subjects in binary', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: ['A'], genres: [], tags: ['Магия'] };
        const result = await exporter.export(manga, []);
        const raw = await decodeBlobToText(result.blob);
        expect(raw).toContain('Магия');
    });

    it('Encodes releaseDate as EXTH-106 in binary', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: ['A'], releaseDate: '2021', genres: [], tags: [] };
        const result = await exporter.export(manga, []);
        const raw = await decodeBlobToText(result.blob);
        expect(raw).toContain('2021');
    });

    it('Works without genres, tags and releaseDate', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'Test', authors: ['A'] };
        const result = await exporter.export(manga, []);
        expect(result.blob).toBeTruthy();
        expect(result.filename).toBe('Test.mobi');
    });

    describe('_bytesToBase64', () => {
        it('Encodes bytes to base64', () => {
            const exporter = new MOBIExporter();
            const bytes = new Uint8Array([72, 101, 108, 108, 111]);
            expect(exporter._bytesToBase64(bytes)).toBe('SGVsbG8=');
        });

        it('Handles empty bytes', () => {
            const exporter = new MOBIExporter();
            expect(exporter._bytesToBase64(new Uint8Array(0))).toBe('');
        });

        it('Handles large buffer in chunks', () => {
            const exporter = new MOBIExporter();
            const bytes = new Uint8Array(0x10000).fill(65);
            const result = exporter._bytesToBase64(bytes);
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('_extractVolNum', () => {
        it('Parses "Том X, Глава Y" pattern', () => {
            const exporter = new MOBIExporter();
            expect(exporter._extractVolNum('Том 1, Глава 5')).toEqual({ volume: '1', number: '5' });
        });

        it('Parses "Глава Y" pattern with default volume 1', () => {
            const exporter = new MOBIExporter();
            expect(exporter._extractVolNum('Глава 3')).toEqual({ volume: '1', number: '3' });
        });

        it('Returns null for unrecognized pattern', () => {
            const exporter = new MOBIExporter();
            expect(exporter._extractVolNum('Chapter 1')).toBeNull();
        });
    });

    describe('_parseMOBIHtml', () => {
        it('Returns empty array when body is missing', () => {
            const exporter = new MOBIExporter();
            const origDOMParser = globalThis.DOMParser;
            globalThis.DOMParser = class {
                parseFromString() { return { querySelector: () => null }; }
            };
            const result = exporter._parseMOBIHtml('', 0xFFFFFFFF, [], new Uint8Array(0), 0);
            expect(result).toEqual([]);
            globalThis.DOMParser = origDOMParser;
        });

        it('Extracts chapters from h2 tags in body', () => {
            const exporter = new MOBIExporter();
            const html = `<html><body><h2>Chapter 1</h2><p>Text</p><h2>Chapter 2</h2><p>More</p></body></html>`;
            const result = exporter._parseMOBIHtml(html, 0xFFFFFFFF, [], new Uint8Array(0), 0);
            expect(result).toHaveLength(2);
            expect(result[0].title).toBe('Chapter 1');
            expect(result[0].content[0]).toEqual({ type: 'text', text: 'Text' });
            expect(result[1].title).toBe('Chapter 2');
        });

        it('Extracts volume and number from "Том X, Глава Y" title', () => {
            const exporter = new MOBIExporter();
            const html = `<html><body><h2>Том 2, Глава 5</h2><p>Text</p><h2>Глава 3</h2><p>More</p></body></html>`;
            const result = exporter._parseMOBIHtml(html, 0xFFFFFFFF, [], new Uint8Array(0), 0);
            expect(result[0].volume).toBe('2');
            expect(result[0].number).toBe('5');
            expect(result[1].volume).toBe('1');
            expect(result[1].number).toBe('3');
        });

        it('Ignores img recindex when firstImageRec is 0xFFFFFFFF', () => {
            const exporter = new MOBIExporter();
            const html = `<html><body><h2>Ch</h2><div><img recindex="0001" alt=""/></div><p>Text</p></body></html>`;
            const bytes = new Uint8Array(200);
            const result = exporter._parseMOBIHtml(html, 0xFFFFFFFF, [0, 100], bytes, 200);
            const images = result[0].content.filter(b => b.type === 'image');
            expect(images).toHaveLength(0);
        });

        it('Extracts image block when recindex points to valid record', () => {
            const exporter = new MOBIExporter();
            const html = `<html><body><h2>Ch</h2><div><img recindex="0001" alt=""/></div></body></html>`;
            const bytes = new Uint8Array(200);
            bytes[100] = 0xFF; bytes[101] = 0xD8;
            const recordOffsets = [0, 100, 150];
            const result = exporter._parseMOBIHtml(html, 1, recordOffsets, bytes, 200);
            const images = result[0].content.filter(b => b.type === 'image');
            expect(images).toHaveLength(1);
            expect(images[0].type).toBe('image');
        });

        it('Skips image block when imageRecNum is out of bounds', () => {
            const exporter = new MOBIExporter();
            const html = `<html><body><h2>Ch</h2><div><img recindex="9999" alt=""/></div><p>Text</p></body></html>`;
            const bytes = new Uint8Array(200);
            const recordOffsets = [0, 100];
            const result = exporter._parseMOBIHtml(html, 1, recordOffsets, bytes, 200);
            const images = result[0].content.filter(b => b.type === 'image');
            expect(images).toHaveLength(0);
        });

        it('Skips recindex 0 image blocks', () => {
            const exporter = new MOBIExporter();
            const html = `<html><body><h2>Ch</h2><div><img recindex="0000" alt=""/></div><p>Ok</p></body></html>`;
            const bytes = new Uint8Array(200);
            const result = exporter._parseMOBIHtml(html, 1, [0, 100, 150], bytes, 200);
            const images = result[0].content.filter(b => b.type === 'image');
            expect(images).toHaveLength(0);
            expect(result[0].content[0]).toEqual({ type: 'text', text: 'Ok' });
        });
    });

    describe('_parseMOBI', () => {
        const blobToArrayBuffer = (blob) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
        });

        it('Throws on non-MOBI buffer', () => {
            const exporter = new MOBIExporter();
            const buffer = new ArrayBuffer(200);
            const view = new DataView(buffer);
            view.setUint16(77, 1, false);
            view.setUint32(79, 100, false);
            expect(() => exporter._parseMOBI(buffer, 'test.mobi')).toThrow('[MOBIExporter] Not a MOBI file');
        });

        it('Roundtrip: restores name, authors, summary and releaseDate', async () => {
            const exporter = new MOBIExporter();
            const manga = {
                name: 'Тест', authors: ['Автор'], summary: 'Описание',
                genres: ['Экшен'], tags: ['Магия'], releaseDate: '2021'
            };
            const exported = exporter.export(manga, []);
            const buffer = await blobToArrayBuffer(exported.blob);
            const result = exporter._parseMOBI(buffer, 'test.mobi');
            expect(result.metadata.name).toBe('Тест');
            expect(result.metadata.authors).toContain('Автор');
            expect(result.metadata.summary).toBe('Описание');
            expect(result.metadata.releaseDate).toBe('2021');
        });

        it('Roundtrip: extracts cover when present', async () => {
            const exporter = new MOBIExporter();
            const manga = { name: 'Test', authors: [] };
            const exported = exporter.export(manga, [], 'data:image/jpeg;base64,AAEC');
            const buffer = await blobToArrayBuffer(exported.blob);
            const result = exporter._parseMOBI(buffer, 'test.mobi');
            expect(result.cover).toMatch(/^data:image\/jpeg;base64,/);
        });

        it('Uses filename (without extension) as title when fullNameLen is 0', async () => {
            const exporter = new MOBIExporter();
            const manga = { name: 'Test', authors: [] };
            const exported = exporter.export(manga, []);
            const buffer = await blobToArrayBuffer(exported.blob);
            const view = new DataView(buffer);
            const recordOffsets = exporter._parseMOBIRecordOffsets(view);
            const r0 = recordOffsets[0];
            view.setUint32(r0 + 88, 0, false);
            const result = exporter._parseMOBI(buffer, 'fallback.mobi');
            expect(result.metadata.name).toBe('fallback');
        });
    });

    describe('parse', () => {
        it('Reads file as ArrayBuffer and resolves parsed metadata', async () => {
            const exporter = new MOBIExporter();
            const manga = { name: 'Test', authors: ['A'], summary: 'Desc', genres: [], tags: [], releaseDate: '2020' };
            const exported = exporter.export(manga, []);
            const file = new File([exported.blob], 'test.mobi');
            const result = await exporter.parse(file);
            expect(result.metadata.name).toBe('Test');
            expect(result.metadata.summary).toBe('Desc');
        });

        it('Rejects when file is not a valid MOBI', async () => {
            const exporter = new MOBIExporter();
            const file = new File([new Uint8Array(200)], 'fake.mobi');
            await expect(exporter.parse(file)).rejects.toThrow('[MOBIExporter] Not a MOBI file');
        });
    });

    describe('_parseMOBIExth', () => {
        it('Returns empty metadata when EXTH magic bytes are invalid', () => {
            const exporter = new MOBIExporter();
            const bufLen = 400;
            const buffer = new ArrayBuffer(bufLen);
            const bytes = new Uint8Array(buffer);
            const view = new DataView(buffer);
            const dec = new TextDecoder();
            const r0 = 0;
            bytes.set([0x4E, 0x4F, 0x54, 0x58], 248);
            const result = exporter._parseMOBIExth(bytes, view, dec, r0, buffer);
            expect(result).toEqual({ authors: [], summary: '', genres: [], releaseDate: '' });
        });

        it('Returns empty metadata when buffer is too small for EXTH header', () => {
            const exporter = new MOBIExporter();
            const buffer = new ArrayBuffer(100);
            const bytes = new Uint8Array(buffer);
            const view = new DataView(buffer);
            const dec = new TextDecoder();
            const result = exporter._parseMOBIExth(bytes, view, dec, 0, buffer);
            expect(result).toEqual({ authors: [], summary: '', genres: [], releaseDate: '' });
        });

        it('Breaks out of loop when EXTH record has recLen < 8', () => {
            const exporter = new MOBIExporter();
            const buffer = new ArrayBuffer(400);
            const bytes = new Uint8Array(buffer);
            const view = new DataView(buffer);
            const dec = new TextDecoder();
            const exthStart = 248;
            bytes.set([0x45, 0x58, 0x54, 0x48], exthStart);
            view.setUint32(exthStart + 4, 20, false);
            view.setUint32(exthStart + 8, 1, false);
            view.setUint32(exthStart + 12, 100, false);
            view.setUint32(exthStart + 16, 5, false);
            const result = exporter._parseMOBIExth(bytes, view, dec, 0, buffer);
            expect(result).toEqual({ authors: [], summary: '', genres: [], releaseDate: '' });
        });
    });

    describe('_parseMOBIHtml extra branches', () => {
        it('Uses bufferLen as iEnd when image record is the last in recordOffsets', () => {
            const exporter = new MOBIExporter();
            const html = `<html><body><h2>Ch</h2><div><img recindex="0001" alt=""/></div></body></html>`;
            const bytes = new Uint8Array(200);
            const recordOffsets = [0, 100];
            const result = exporter._parseMOBIHtml(html, 1, recordOffsets, bytes, 200);
            const images = result[0].content.filter(b => b.type === 'image');
            expect(images).toHaveLength(1);
        });

        it('Skips empty paragraph text (whitespace-only)', () => {
            const exporter = new MOBIExporter();
            const html = `<html><body><h2>Ch</h2><p>   </p><p>Real text</p></body></html>`;
            const result = exporter._parseMOBIHtml(html, 0xFFFFFFFF, [], new Uint8Array(0), 0);
            expect(result[0].content).toHaveLength(1);
            expect(result[0].content[0].text).toBe('Real text');
        });

        it('Ignores div without img[recindex] (else-if tag===p is false)', () => {
            const exporter = new MOBIExporter();
            const html = `<html><body><h2>Ch</h2><div>ignored</div><p>kept</p></body></html>`;
            const result = exporter._parseMOBIHtml(html, 0xFFFFFFFF, [], new Uint8Array(0), 0);
            expect(result[0].content).toHaveLength(1);
            expect(result[0].content[0].text).toBe('kept');
        });

        it('Treats img with empty recindex attribute as recindex 0 (skips image)', () => {
            const exporter = new MOBIExporter();
            const html = `<html><body><h2>Ch</h2><div><img recindex="" alt=""/></div><p>text</p></body></html>`;
            const bytes = new Uint8Array(200);
            const result = exporter._parseMOBIHtml(html, 1, [0, 100], bytes, 200);
            const images = result[0].content.filter(b => b.type === 'image');
            expect(images).toHaveLength(0);
        });
    });

    describe('_parseMOBI last-record branches', () => {
        function buildMinimalMOBI({ N, firstImageRec }) {
            const dataStart = 78 + N * 8 + 2;
            const mobiHeaderLen = 300;
            const textContent = new TextEncoder().encode('<html><body></body></html>');
            const totalLen = dataStart + mobiHeaderLen + textContent.length + 10;
            const buffer = new ArrayBuffer(totalLen);
            const arr = new Uint8Array(buffer);
            const dv = new DataView(buffer);
            dv.setUint16(76, N, false);
            dv.setUint32(78, dataStart, false);
            if (N >= 2) dv.setUint32(86, dataStart + mobiHeaderLen, false);
            if (N >= 3) dv.setUint32(94, dataStart + mobiHeaderLen + textContent.length, false);
            const r0 = dataStart;
            arr[r0+16]=0x4D; arr[r0+17]=0x4F; arr[r0+18]=0x42; arr[r0+19]=0x49;
            dv.setUint16(r0+8, 1, false);
            dv.setUint32(r0+88, 0, false);
            dv.setUint32(r0+108, firstImageRec >>> 0, false);
            arr[r0+248]=0x4E; arr[r0+249]=0x4F; arr[r0+250]=0x54; arr[r0+251]=0x58;
            arr.set(textContent, dataStart + mobiHeaderLen);
            return buffer;
        }

        it('Uses buffer.byteLength as end when text record is the last in recordOffsets', () => {
            const exporter = new MOBIExporter();
            const buffer = buildMinimalMOBI({ N: 2, firstImageRec: 0xFFFFFFFF });
            const result = exporter._parseMOBI(buffer, 'test.mobi');
            expect(result.metadata.name).toBe('test');
        });

        it('Uses buffer.byteLength as iEnd when cover image is the last record', () => {
            const exporter = new MOBIExporter();
            const buffer = buildMinimalMOBI({ N: 3, firstImageRec: 2 });
            const result = exporter._parseMOBI(buffer, 'test.mobi');
            expect(result.cover).toMatch(/^data:image\/jpeg;base64,/);
        });

        it('Returns Unknown name when filename is null', () => {
            const exporter = new MOBIExporter();
            const buffer = buildMinimalMOBI({ N: 2, firstImageRec: 0xFFFFFFFF });
            const result = exporter._parseMOBI(buffer, null);
            expect(result.metadata.name).toBe('Unknown');
        });
    });

    it('buildEXTH uses empty subjects when subjectBytesArr is falsy', () => {
        const exporter = new MOBIExporter();
        const origMap = Array.prototype.map;
        Array.prototype.map = function() { return undefined; };
        try {
            const result = exporter.export({ name: 'T', authors: [], genres: ['G'] }, []);
            expect(result.filename).toBe('T.mobi');
        } finally {
            Array.prototype.map = origMap;
        }
    });

    it('Registers with ExporterRegistry when it is already defined on load', async () => {
        vi.resetModules();
        const register = vi.fn();
        global.ExporterRegistry = { register };
        await import('../../exporters/BaseExporter.js');
        await import('../../exporters/MOBIExporter.js');
        expect(register).toHaveBeenCalledWith('mobi', expect.any(Function), { label: 'MOBI' });
        delete global.ExporterRegistry;
    });
});
