import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(async () => {
    await import('../../exporters/ExportMangaPatcher.js');
    ExportMangaPatcher = global.ExportMangaPatcher;
});

describe('ExportMangaPatcher', () => {
    it('manga authors simple array patch', () => {
        const manga = { authors: [ 'Test' ] }
        const patch = ExportMangaPatcher.patch(manga);

        expect(patch).toMatchObject({
            authors: expect.arrayContaining(['Test']),
        })
    });

    it('manga authors object array patch', () => {
        const manga = { authors: [ { name: 'Test' } ] }
        const patch = ExportMangaPatcher.patch(manga);

        expect(patch).toMatchObject({
            authors: expect.arrayContaining(['Test']),
        })
    });

    it('manga authors string patch', () => {
        const manga = { authors: 'Test' }
        const patch = ExportMangaPatcher.patch(manga);

        expect(patch).toMatchObject({
            authors: expect.arrayContaining(['Test']),
        })
    });

    it('manga empty authors object array patch', () => {
        const manga = { authors: [ ] }
        const patch = ExportMangaPatcher.patch(manga);

        expect(patch).toMatchObject({
            authors: expect.arrayContaining(['']),
        })
    });

    it('manga invalid authors object array patch', () => {
        const manga = { authors: [ { } ] }
        const patch = ExportMangaPatcher.patch(manga);

        expect(patch).toMatchObject({
            authors: expect.arrayContaining(['']),
        })
    });
});
