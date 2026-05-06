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
        const result = await exporter.export({}, []);
        expect(result.filename).toBe('Книга.mobi');
        expect(result.mimeType).toBe('application/x-mobipocket-ebook');

        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('BOOKMOBI');
        expect(text).toContain('<html>');
    });

    it('Uses rus_name and resolves author array', async () => {
        const exporter = new MOBIExporter();
        const manga = { rus_name: 'Название', authors: [{ name: 'A' }, 'B'] };
        const chapters = [{ title: 'Глава 1', content: [{ type: 'text', text: 'Текст' }] }];
        const result = await exporter.export(manga, chapters);

        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('Название');
        expect(text).toContain('A, B');
        expect(text).toContain('<h2>Глава 1</h2>');
    });

    it('Escapes HTML in title and text blocks', async () => {
        const exporter = new MOBIExporter();
        const manga = { name: 'A < B & C' };
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
        const manga = { name: 'Test' };
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
        const manga = { name: 'Test' };
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
        const manga = { name: 'Test' };
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
        const manga = { name: 'Test' };
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
        const manga = { name: 'Long' };
        const longText = '😀'.repeat(5000);
        const chapters = [
            { title: 'Long', content: [{ type: 'text', text: longText }] }
        ];
        const result = await exporter.export(manga, chapters);
        const text = await decodeBlobToText(result.blob);
        expect(text).toContain('<h2>Long</h2>');
    });
});
