/**
 * Контрактный тест данных export(): что настоящий DownloadManager передаёт
 * экспортёру-плагину и что принимает от него обратно.
 * Менять здесь можно только подготовку окружения (фейковый сервис, подмена сети
 * и сохранения файла); изменение проверок означает изменение контракта плагинов
 * и требует согласия владельца проекта. Новые поля в главах и блоках допустимы,
 * поэтому проверки сделаны через toMatchObject.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('../../core/BrowserApi.js', async importOriginal => ({
    ...await importOriginal(),
    fetchViaTab: vi.fn(async () => ({ ok: true, base64: 'COVER', contentType: 'image/jpeg' }))
}));

const probePlugin = `(function(global) {
    class ProbeExporter extends global.BaseExporter {
        async export(manga, chapters, coverBase64) {
            global.__probeExports.push(structuredClone({ manga, chapters, coverBase64 }));
            return { blob: new Blob(['probe']), filename: 'probe.prb', mimeType: 'application/x-probe' };
        }
    }
    global.ExporterRegistry.register('probe', ProbeExporter, { label: 'PROBE' });
})(typeof window !== 'undefined' ? window : self);`;

const rawManga = {
    rus_name: 'Проба',
    eng_name: 'Probe',
    authors: [{ name: 'Автор' }],
    summary: 'Описание',
    cover: { default: 'https://cover.example/c.jpg' },
    ageRestriction: { label: '16+' },
    releaseDate: '2020',
    genres: [{ name: 'Драма' }],
    tags: [{ name: 'Школа' }]
};

const textBlock = { type: 'text', text: 'Первый абзац' };
const imageBlock = { type: 'image', id: 'img_1', data: { base64: 'AAAA', contentType: 'image/png' }, originalIndex: 0 };

let DownloadManager, MangaPatcher;

beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.__probeExports = [];
    await import('../../core/pluginApi.js');
    await import('../../exporters/index.js');
    ({ DownloadManager } = await import('../../core/DownloadManager.js'));
    ({ MangaPatcher } = await import('../../core/MangaPatcher.js'));
    (0, eval)(probePlugin); // eslint-disable-line no-eval

    class ProbeService extends globalThis.BaseService {
        static config = { name: 'probe', hosts: ['probe.example'] };
        constructor() { super({ name: 'probe', baseUrl: 'https://api.probe.example', headers: {} }); }
        async fetchMangaMetadata() { return { data: structuredClone(rawManga) }; }
        async fetchChaptersList() {
            return { data: [
                { id: 12, volume: '1', number: '2', name: null },
                { id: 11, volume: '1', number: '1', name: 'Начало' }
            ] };
        }
        async fetchChapter(slug, number) { return { data: { content: [`page-${number}`] } }; }
        extractText(content) { return content; }
        async processChapterContent() { return [{ ...textBlock }, structuredClone(imageBlock)]; }
    }
    globalThis.serviceRegistry.register(ProbeService);
});

describe('Data passed to a plugin exporter', () => {
    it('Receives the normalized manga, the chapters and the cover, and its result is saved', async () => {
        const dm = new DownloadManager();
        dm.saveFile = vi.fn(async () => {});

        await dm.startDownload({ serviceKey: 'probe', slug: 'probe-slug', format: 'probe' });

        expect(globalThis.__probeExports).toHaveLength(1);
        const [{ manga, chapters, coverBase64 }] = globalThis.__probeExports;

        const patched = MangaPatcher.patch(structuredClone(rawManga));
        expect(manga).toEqual({ ...patched, name: `${patched.name} Том 1` });
        expect(typeof manga.name).toBe('string');
        expect(manga.authors.every(author => typeof author === 'string')).toBe(true);

        expect(chapters).toMatchObject([
            { title: 'Начало', volume: '1', number: '1', content: [textBlock, imageBlock] },
            { title: 'Том 1, Глава 2', volume: '1', number: '2', content: [textBlock, imageBlock] }
        ]);
        expect(coverBase64).toBe('data:image/jpeg;base64,COVER');

        expect(dm.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'probe.prb');
    });
});
