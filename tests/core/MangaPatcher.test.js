import { describe, it, expect, beforeEach } from 'vitest';

let MangaPatcher;

beforeEach(async () => {
    const path = require.resolve('../../core/MangaPatcher.js');
    delete require.cache[path];
    await import('../../core/MangaPatcher.js');
    MangaPatcher = global.MangaPatcher;
});

describe('MangaPatcher', () => {
    describe('TitleResolutionModule', () => {
        it('Resolves name from rus_name', () => {
            const patch = MangaPatcher.patch({ rus_name: 'Русское', name: 'English', authors: [] });
            expect(patch.name).toBe('Русское');
        });

        it('Falls back to name when rus_name absent', () => {
            const patch = MangaPatcher.patch({ name: 'English', authors: [] });
            expect(patch.name).toBe('English');
        });

        it('Falls back to name when rus_name is empty string', () => {
            const patch = MangaPatcher.patch({ rus_name: '', name: 'English', authors: [] });
            expect(patch.name).toBe('English');
        });

        it('Falls back to slug when rus_name and name absent', () => {
            const patch = MangaPatcher.patch({ slug: 'my-slug', authors: [] });
            expect(patch.name).toBe('my-slug');
        });

        it('Falls back to slug when name is empty string', () => {
            const patch = MangaPatcher.patch({ name: '', slug: 'my-slug', authors: [] });
            expect(patch.name).toBe('my-slug');
        });

        it('Resolves name to empty string when all absent', () => {
            const patch = MangaPatcher.patch({ authors: [] });
            expect(patch.name).toBe('');
        });
    });

    describe('AuthorsResolutionModule', () => {
        it('Keeps string array as is', () => {
            const patch = MangaPatcher.patch({ authors: ['Test'] });
            expect(patch.authors).toEqual(['Test']);
        });

        it('Keeps multiple strings in array as is', () => {
            const patch = MangaPatcher.patch({ authors: ['Alice', 'Bob'] });
            expect(patch.authors).toEqual(['Alice', 'Bob']);
        });

        it('Extracts name from object array', () => {
            const patch = MangaPatcher.patch({ authors: [{ name: 'Test' }] });
            expect(patch.authors).toEqual(['Test']);
        });

        it('Wraps plain string in array', () => {
            const patch = MangaPatcher.patch({ authors: 'Test' });
            expect(patch.authors).toEqual(['Test']);
        });

        it('Returns [""] for empty array', () => {
            const patch = MangaPatcher.patch({ authors: [] });
            expect(patch.authors).toEqual(['']);
        });

        it('Returns empty string for object without name', () => {
            const patch = MangaPatcher.patch({ authors: [{}] });
            expect(patch.authors).toEqual(['']);
        });

        it('Returns empty string for object with empty name', () => {
            const patch = MangaPatcher.patch({ authors: [{ name: '' }] });
            expect(patch.authors).toEqual(['']);
        });

        it('Returns empty string for null element in array', () => {
            const patch = MangaPatcher.patch({ authors: [null] });
            expect(patch.authors).toEqual(['']);
        });

        it('Returns empty string for numeric element in array', () => {
            const patch = MangaPatcher.patch({ authors: [42] });
            expect(patch.authors).toEqual(['']);
        });

        it('Returns [""] for null authors', () => {
            const patch = MangaPatcher.patch({ authors: null });
            expect(patch.authors).toEqual(['']);
        });

        it('Returns [""] for undefined authors', () => {
            const patch = MangaPatcher.patch({});
            expect(patch.authors).toEqual(['']);
        });

        it('Returns [""] for boolean authors', () => {
            const patch = MangaPatcher.patch({ authors: false });
            expect(patch.authors).toEqual(['']);
        });

        it('Returns [""] for numeric authors', () => {
            const patch = MangaPatcher.patch({ authors: 42 });
            expect(patch.authors).toEqual(['']);
        });

        it('Handles mixed valid and invalid entries', () => {
            const patch = MangaPatcher.patch({ authors: [{ name: 'A' }, null, 'B', 42, {}] });
            expect(patch.authors).toEqual(['A', '', 'B', '', '']);
        });

        it('Falls back to rus_name when name absent in object', () => {
            const patch = MangaPatcher.patch({ authors: [{ rus_name: 'Иванов' }] });
            expect(patch.authors).toEqual(['Иванов']);
        });

        it('Falls back to title when name and rus_name absent in object', () => {
            const patch = MangaPatcher.patch({ authors: [{ title: 'Редактор' }] });
            expect(patch.authors).toEqual(['Редактор']);
        });

        it('Prefers name over rus_name and title', () => {
            const patch = MangaPatcher.patch({ authors: [{ name: 'A', rus_name: 'Б', title: 'В' }] });
            expect(patch.authors).toEqual(['A']);
        });
    });

    describe('SummaryResolutionModule', () => {
        it('Keeps existing string summary', () => {
            const patch = MangaPatcher.patch({ authors: [], summary: 'Описание' });
            expect(patch.summary).toBe('Описание');
        });

        it('Keeps empty string summary as is', () => {
            const patch = MangaPatcher.patch({ authors: [], summary: '' });
            expect(patch.summary).toBe('');
        });

        it('Resolves to empty string when summary absent', () => {
            const patch = MangaPatcher.patch({ authors: [] });
            expect(patch.summary).toBe('');
        });

        it('Resolves to empty string for null summary', () => {
            const patch = MangaPatcher.patch({ authors: [], summary: null });
            expect(patch.summary).toBe('');
        });

        it('Resolves to empty string for non-string summary', () => {
            const patch = MangaPatcher.patch({ authors: [], summary: 123 });
            expect(patch.summary).toBe('');
        });

        it('Extracts text from ProseMirror structured object', () => {
            const patch = MangaPatcher.patch({ authors: [], summary: { content: [
                { content: [{ text: 'Hello' }, { text: ' world' }] },
                { content: [{ text: '!' }] }
            ] } });
            expect(patch.summary).toBe('Hello world!');
        });

        it('Handles paragraph without content in structured object', () => {
            const patch = MangaPatcher.patch({ authors: [], summary: { content: [
                { content: [{ text: 'Hello' }] },
                {}
            ] } });
            expect(patch.summary).toBe('Hello');
        });

        it('Resolves to empty string for structured object with empty content array', () => {
            const patch = MangaPatcher.patch({ authors: [], summary: { content: [] } });
            expect(patch.summary).toBe('');
        });

        it('Resolves to empty string for object without content array', () => {
            const patch = MangaPatcher.patch({ authors: [], summary: { foo: 'bar' } });
            expect(patch.summary).toBe('');
        });
    });

    describe('CoverResolutionModule', () => {
        it('Keeps string cover as is', () => {
            const patch = MangaPatcher.patch({ authors: [], cover: 'https://example.com/cover.jpg' });
            expect(patch.cover).toBe('https://example.com/cover.jpg');
        });

        it('Resolves cover.default from object', () => {
            const patch = MangaPatcher.patch({ authors: [], cover: { default: 'https://a.com/d.jpg', thumbnail: 'https://a.com/t.jpg' } });
            expect(patch.cover).toBe('https://a.com/d.jpg');
        });

        it('Falls back to cover.thumbnail when default absent', () => {
            const patch = MangaPatcher.patch({ authors: [], cover: { thumbnail: 'https://a.com/t.jpg', md: 'https://a.com/m.jpg' } });
            expect(patch.cover).toBe('https://a.com/t.jpg');
        });

        it('Falls back to cover.md when default and thumbnail absent', () => {
            const patch = MangaPatcher.patch({ authors: [], cover: { md: 'https://a.com/m.jpg' } });
            expect(patch.cover).toBe('https://a.com/m.jpg');
        });

        it('Falls back to cover.url when other keys absent', () => {
            const patch = MangaPatcher.patch({ authors: [], cover: { url: 'https://a.com/u.jpg' } });
            expect(patch.cover).toBe('https://a.com/u.jpg');
        });

        it('Prefers cover.md over cover.url', () => {
            const patch = MangaPatcher.patch({ authors: [], cover: { md: 'https://a.com/m.jpg', url: 'https://a.com/u.jpg' } });
            expect(patch.cover).toBe('https://a.com/m.jpg');
        });

        it('Resolves to empty string for object with no known keys', () => {
            const patch = MangaPatcher.patch({ authors: [], cover: { foo: 'bar' } });
            expect(patch.cover).toBe('');
        });

        it('Resolves to empty string when cover absent', () => {
            const patch = MangaPatcher.patch({ authors: [] });
            expect(patch.cover).toBe('');
        });

        it('Resolves to empty string for null cover', () => {
            const patch = MangaPatcher.patch({ authors: [], cover: null });
            expect(patch.cover).toBe('');
        });

        it('Falls back to image field when cover absent', () => {
            const patch = MangaPatcher.patch({ authors: [], image: 'https://a.com/i.jpg' });
            expect(patch.cover).toBe('https://a.com/i.jpg');
        });
        
        it('Falls back to image field when cover object has no known keys', () => {
            const patch = MangaPatcher.patch({ authors: [], cover: { foo: 'bar' }, image: 'https://a.com/i.jpg' });
            expect(patch.cover).toBe('https://a.com/i.jpg');
        });
        
        it('Prefers cover over image field', () => {
            const patch = MangaPatcher.patch({ authors: [], cover: 'https://a.com/c.jpg', image: 'https://a.com/i.jpg' });
            expect(patch.cover).toBe('https://a.com/c.jpg');
        });
    });

    describe('AgeRatingResolutionModule', () => {
        it('Keeps numeric caution as ageRating', () => {
            const patch = MangaPatcher.patch({ authors: [], caution: 2 });
            expect(patch.ageRating).toBe(2);
        });

        it('Keeps zero caution as ageRating', () => {
            const patch = MangaPatcher.patch({ authors: [], caution: 0 });
            expect(patch.ageRating).toBe(0);
        });

        it('Resolves to 0 when caution absent', () => {
            const patch = MangaPatcher.patch({ authors: [] });
            expect(patch.ageRating).toBe(0);
        });

        it('Resolves to 0 for null caution', () => {
            const patch = MangaPatcher.patch({ authors: [], caution: null });
            expect(patch.ageRating).toBe(0);
        });

        it('Resolves to 0 for non-numeric caution', () => {
            const patch = MangaPatcher.patch({ authors: [], caution: '18+' });
            expect(patch.ageRating).toBe(0);
        });

        it('Extracts rating from ageRestriction.label', () => {
            const patch = MangaPatcher.patch({ authors: [], ageRestriction: { label: '18+' } });
            expect(patch.rating).toBe('18+');
        });

        it('Coerces numeric ageRestriction.label to string', () => {
            const patch = MangaPatcher.patch({ authors: [], ageRestriction: { label: 18 } });
            expect(patch.rating).toBe('18');
        });

        it('Resolves rating to empty string when ageRestriction absent', () => {
            const patch = MangaPatcher.patch({ authors: [] });
            expect(patch.rating).toBe('');
        });

        it('Resolves rating to empty string when ageRestriction.label absent', () => {
            const patch = MangaPatcher.patch({ authors: [], ageRestriction: {} });
            expect(patch.rating).toBe('');
        });
    });

    describe('ReleaseDateResolutionModule', () => {
        it('Uses releaseDate field', () => {
            const patch = MangaPatcher.patch({ authors: [], releaseDate: '2020-01-01' });
            expect(patch.releaseDate).toBe('2020-01-01');
        });

        it('Falls back to releaseDateString', () => {
            const patch = MangaPatcher.patch({ authors: [], releaseDateString: '2020' });
            expect(patch.releaseDate).toBe('2020');
        });

        it('Falls back to release_date', () => {
            const patch = MangaPatcher.patch({ authors: [], release_date: '2021' });
            expect(patch.releaseDate).toBe('2021');
        });

        it('Falls back to published', () => {
            const patch = MangaPatcher.patch({ authors: [], published: '2019' });
            expect(patch.releaseDate).toBe('2019');
        });

        it('Falls back to year', () => {
            const patch = MangaPatcher.patch({ authors: [], year: 2018 });
            expect(patch.releaseDate).toBe('2018');
        });

        it('Falls back to date', () => {
            const patch = MangaPatcher.patch({ authors: [], date: '2017-06-15' });
            expect(patch.releaseDate).toBe('2017-06-15');
        });

        it('Resolves to empty string when all date fields absent', () => {
            const patch = MangaPatcher.patch({ authors: [] });
            expect(patch.releaseDate).toBe('');
        });

        it('Prefers releaseDate over all fallbacks', () => {
            const patch = MangaPatcher.patch({ authors: [], releaseDate: '2022', year: 2000, date: '1999' });
            expect(patch.releaseDate).toBe('2022');
        });
    });

    describe('MangaPatcher', () => {
        it('Runs all modules in a single pass', () => {
            const patch = MangaPatcher.patch({
                rus_name: 'Название',
                authors: [{ name: 'Автор' }],
                summary: 'Описание',
                cover: { default: 'https://a.com/cover.jpg' },
                caution: 18
            });
            expect(patch.name).toBe('Название');
            expect(patch.authors).toEqual(['Автор']);
            expect(patch.summary).toBe('Описание');
            expect(patch.cover).toBe('https://a.com/cover.jpg');
            expect(patch.ageRating).toBe(18);
        });

        it('Preserves unrelated fields', () => {
            const patch = MangaPatcher.patch({ authors: [], slug: 'test', releaseDate: '2020', extra: 42 });
            expect(patch.slug).toBe('test');
            expect(patch.releaseDate).toBe('2020');
            expect(patch.extra).toBe(42);
        });
    });
});
