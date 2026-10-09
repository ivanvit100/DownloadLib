/**
 * Контрактный тест плагина формата: код plugins/CBZExporter.js исполняется как есть,
 * так же как его исполняет попап (классический скрипт после core/pluginApi.js).
 * Менять здесь можно только подготовку окружения; изменение проверок означает
 * изменение контракта плагинов и требует согласия владельца проекта.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const pluginCode = readFileSync(resolve(root, 'plugins/CBZExporter.js'), 'utf8');
const runClassicScript = code => (0, eval)(code); // eslint-disable-line no-eval

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let PluginManager;

beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    globalThis.chrome = { runtime: { id: 'ext' } };
    runClassicScript(readFileSync(resolve(root, 'lib/jszip.min.js'), 'utf8'));
    await import('../../core/pluginApi.js');
    await import('../../exporters/index.js');
    ({ PluginManager } = await import('../../core/PluginManager.js'));
    runClassicScript(pluginCode);
});

describe('CBZ format plugin (plugins/CBZExporter.js)', () => {
    it('Has metadata that PluginManager recognises as a format plugin', () => {
        const meta = PluginManager.parseMetadata(pluginCode);
        expect(meta.format).toBe('cbz');
        expect(meta.label).toBe('CBZ');
        expect(meta.service).toBeNull();
    });

    it('Registers its format in ExporterRegistry next to the built-in ones', () => {
        expect(globalThis.ExporterRegistry.getFormats()).toContainEqual({ value: 'cbz', label: 'CBZ' });
        expect(globalThis.ExporterRegistry.create('cbz')).toBeInstanceOf(globalThis.BaseExporter);
    });

    it('Exports a CBZ archive with ComicInfo.xml, the cover and the chapter pages', async () => {
        const manga = {
            name: 'Тест <манга>',
            authors: ['Автор'],
            summary: 'Описание',
            genres: ['Драма'],
            tags: ['Школа'],
            releaseDate: '2020',
            rating: '16+',
            cover: 'https://cover.example/c.jpg'
        };
        const chapters = [
            {
                title: 'Глава 1', volume: '1', number: '1',
                content: [
                    { type: 'image', id: 'img_1', data: { base64: PNG_1x1, contentType: 'image/png' }, originalIndex: 0 },
                    { type: 'text', text: '[Ошибка загрузки изображения 2]' },
                    { type: 'image', id: 'img_3', data: { base64: PNG_1x1, contentType: 'image/jpeg' }, originalIndex: 2 }
                ]
            },
            { title: 'Глава 2', volume: '1', number: '2', content: [] }
        ];

        const result = await globalThis.ExporterRegistry.create('cbz').export(manga, chapters, `data:image/png;base64,${PNG_1x1}`);

        expect(result.filename).toBe('Тест_манга.cbz');
        expect(result.mimeType).toBe('application/vnd.comicbook+zip');
        expect(result.blob).toBeInstanceOf(Blob);

        const zip = await globalThis.JSZip.loadAsync(result.blob);
        expect(Object.keys(zip.files).sort()).toEqual([
            '000_cover.jpg', 'ComicInfo.xml', 'v01_c001/', 'v01_c001/0001.png', 'v01_c001/0002.jpg'
        ]);
        const comicInfo = await zip.file('ComicInfo.xml').async('string');
        expect(comicInfo).toContain('<Title>Тест &lt;манга&gt;</Title>');
        expect(comicInfo).toContain('<Writer>Автор</Writer>');
        expect(comicInfo).toContain('<AgeRating>16+</AgeRating>');
        expect(await zip.file('v01_c001/0001.png').async('base64')).toBe(PNG_1x1);
    });
});
