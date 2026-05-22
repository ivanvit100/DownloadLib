/**
 * DownloadLib manga metadata normalization module
 * Normalizes raw API manga object into a unified contract for exporters and UI
 * @module core/MangaPatcher
 * @author Dordovel, ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[MangaPatcher] Loading...');

    class TitleResolutionModule {
        static patch(manga) {
            const name = manga.rus_name || manga.name || manga.slug || '';
            return { ...manga, name };
        }
    }

    class AuthorsResolutionModule {
        static patch_array(authors) {
            if (authors.length === 0) return [''];
            return authors.map(author => {
                if (author !== null && typeof author === 'object')
                    return author.name || author.rus_name || author.title || '';
                if (typeof author === 'string')
                    return author;
                return '';
            });
        }

        static patch_other(authors) {
            if (typeof authors === 'string') return [authors];
            return [''];
        }

        static patch(manga) {
            const authors = Array.isArray(manga.authors)
                ? this.patch_array(manga.authors)
                : this.patch_other(manga.authors);
            return { ...manga, authors };
        }
    }

    class SummaryResolutionModule {
        static patch(manga) {
            let summary = '';
            if (typeof manga.summary === 'string')
                summary = manga.summary;
            else if (manga.summary !== null && typeof manga.summary === 'object' && Array.isArray(manga.summary.content))
                summary = manga.summary.content.flatMap(p => p.content?.map(t => t.text) ?? []).join('');
            return { ...manga, summary };
        }
    }

    class CoverResolutionModule {
        static patch(manga) {
            const raw = manga.cover;
            let cover = '';
            if (typeof raw === 'string')
                cover = raw;
            else if (raw !== null && typeof raw === 'object')
                cover = raw.default || raw.thumbnail || raw.md || raw.url || '';
            if (!cover && manga.image)
                cover = manga.image;
            return { ...manga, cover };
        }
    }

    class AgeRatingResolutionModule {
        static patch(manga) {
            const ageRating = typeof manga.caution === 'number' ? manga.caution : 0;
            const rating = (manga.ageRestriction && manga.ageRestriction.label)
                ? String(manga.ageRestriction.label)
                : '';
            return { ...manga, ageRating, rating };
        }
    }

    class ReleaseDateResolutionModule {
        static patch(manga) {
            const raw = manga.releaseDate || manga.releaseDateString || manga.release_date
                || manga.published || manga.year || manga.date || '';
            return { ...manga, releaseDate: raw ? String(raw) : '' };
        }
    }

    class MangaPatcher {
        static patch(pipeline) {
            const pipes = [
                TitleResolutionModule,
                AuthorsResolutionModule,
                SummaryResolutionModule,
                CoverResolutionModule,
                AgeRatingResolutionModule,
                ReleaseDateResolutionModule
            ];

            for (const pipe of pipes)
                pipeline = pipe.patch(pipeline);

            return pipeline;
        }
    }

    global.MangaPatcher = MangaPatcher;
    console.log('[MangaPatcher] Loaded');
})(typeof window !== 'undefined' ? window : self);
