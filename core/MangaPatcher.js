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

    /**
     * Приводит название тайтла к единому полю name, выбирая первое непустое
     * значение из rus_name/name/slug.
     */
    class TitleResolutionModule {
        /**
         * @param {object} manga - Сырой объект тайтла из API.
         * @returns {object} Копия manga с нормализованным полем name.
         */
        static patch(manga) {
            const name = manga.rus_name || manga.name || manga.slug || '';
            return { ...manga, name };
        }
    }

    /**
     * Приводит список авторов тайтла к единому массиву строк независимо
     * от формата исходных данных (массив объектов/строк, одна строка, и т.д.).
     */
    class AuthorsResolutionModule {
        /**
         * Нормализует массив авторов: извлекает имя из объекта или использует строку как есть.
         * @param {Array<object|string>} authors - Исходный массив авторов.
         * @returns {string[]} Массив имён авторов (непустой, минимум один элемент).
         */
        static patchArray(authors) {
            if (authors.length === 0) return [''];
            return authors.map(author => {
                if (author !== null && typeof author === 'object')
                    return author.name || author.rus_name || author.title || '';
                if (typeof author === 'string')
                    return author;
                return '';
            });
        }

        /**
         * Нормализует поле authors, не являющееся массивом (строка или иное значение).
         * @param {*} authors - Исходное значение поля authors.
         * @returns {string[]} Массив из одной строки (либо пустой строки, если authors не строка).
         */
        static patchOther(authors) {
            if (typeof authors === 'string') return [authors];
            return [''];
        }

        /**
         * @param {object} manga - Сырой (или частично нормализованный) объект тайтла.
         * @returns {object} Копия manga с нормализованным полем authors.
         */
        static patch(manga) {
            const authors = Array.isArray(manga.authors)
                ? this.patchArray(manga.authors)
                : this.patchOther(manga.authors);
            return { ...manga, authors };
        }
    }

    /**
     * Приводит описание тайтла к единой строке, разворачивая rich-text структуру
     * (массив блоков контента) в plain text при необходимости.
     */
    class SummaryResolutionModule {
        /**
         * @param {object} manga - Сырой (или частично нормализованный) объект тайтла.
         * @returns {object} Копия manga с нормализованным строковым полем summary.
         */
        static patch(manga) {
            let summary = '';
            if (typeof manga.summary === 'string')
                ({ summary } = manga);
            else if (manga.summary !== null &&
                typeof manga.summary === 'object' &&
                Array.isArray(manga.summary.content))
                summary = manga.summary.content.flatMap(p => p.content?.map(t => t.text) ?? []).join('');
            return { ...manga, summary };
        }
    }

    /**
     * Приводит обложку тайтла к единой строке URL независимо от формата исходных
     * данных (строка, объект с вариантами размеров, либо запасное поле image).
     */
    class CoverResolutionModule {
        /**
         * @param {object} manga - Сырой (или частично нормализованный) объект тайтла.
         * @returns {object} Копия manga с нормализованным строковым полем cover.
         */
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

    /**
     * Нормализует числовой возрастной рейтинг и текстовую метку возрастного
     * ограничения тайтла.
     */
    class AgeRatingResolutionModule {
        /**
         * @param {object} manga - Сырой (или частично нормализованный) объект тайтла.
         * @returns {object} Копия manga с полями ageRating (number) и rating (строка).
         */
        static patch(manga) {
            const ageRating = typeof manga.caution === 'number' ? manga.caution : 0;
            const rating = (manga.ageRestriction && manga.ageRestriction.label)
                ? String(manga.ageRestriction.label)
                : '';
            return { ...manga, ageRating, rating };
        }
    }

    /**
     * Нормализует списки жанров и тегов тайтла в массивы строковых названий.
     */
    class GenresResolutionModule {
        /**
         * Извлекает названия из массива объектов/строк, отбрасывая пустые значения.
         * @param {Array<object|string>} arr - Исходный массив жанров или тегов.
         * @returns {string[]} Массив непустых названий.
         */
        static patchNames(arr) {
            if (!Array.isArray(arr) || arr.length === 0) return [];
            return arr.map(item => {
                if (typeof item === 'string') return item;
                if (item !== null && typeof item === 'object')
                    return item.name || item.rus_name || item.title || '';
                return '';
            }).filter(Boolean);
        }

        /**
         * @param {object} manga - Сырой (или частично нормализованный) объект тайтла.
         * @returns {object} Копия manga с нормализованными полями genres и tags.
         */
        static patch(manga) {
            return {
                ...manga,
                genres: this.patchNames(manga.genres),
                tags: this.patchNames(manga.tags)
            };
        }
    }

    /**
     * Приводит список художников тайтла к единому массиву строк, отбрасывая пустые значения.
     */
    class ArtistsResolutionModule {
        /**
         * @param {object} manga - Сырой (или частично нормализованный) объект тайтла.
         * @returns {object} Копия manga с нормализованным полем artists.
         */
        static patch(manga) {
            const artists = Array.isArray(manga.artists)
                ? manga.artists.map(a => {
                    if (a !== null && typeof a === 'object')
                        return a.name || a.rus_name || a.title || '';
                    if (typeof a === 'string') return a;
                    return '';
                }).filter(Boolean)
                : [];
            return { ...manga, artists };
        }
    }

    /**
     * Приводит дату выхода тайтла к единой строке, выбирая первое непустое
     * значение из нескольких возможных полей исходных данных.
     */
    class ReleaseDateResolutionModule {
        /**
         * @param {object} manga - Сырой (или частично нормализованный) объект тайтла.
         * @returns {object} Копия manga с нормализованным строковым полем releaseDate.
         */
        static patch(manga) {
            const raw = manga.releaseDate || manga.releaseDateString || manga.release_date
                || manga.published || manga.year || manga.date || '';
            return { ...manga, releaseDate: raw ? String(raw) : '' };
        }
    }

    /**
     * Пропускает сырой объект тайтла из API через цепочку модулей нормализации,
     * приводя его к единому контракту, ожидаемому экспортёрами и UI.
     */
    class MangaPatcher {
        /**
         * Последовательно применяет все модули нормализации к объекту тайтла.
         * @param {object} pipeline - Сырой объект тайтла из API сервиса.
         * @returns {object} Нормализованный объект тайтла (name, authors, summary,
         * cover, ageRating, rating, releaseDate, genres, tags, artists).
         */
        static patch(pipeline) {
            const pipes = [
                TitleResolutionModule,
                AuthorsResolutionModule,
                SummaryResolutionModule,
                CoverResolutionModule,
                AgeRatingResolutionModule,
                ReleaseDateResolutionModule,
                GenresResolutionModule,
                ArtistsResolutionModule
            ];

            let result = pipeline;

            for (const pipe of pipes)
                result = pipe.patch(result);

            return result;
        }
    }

    global.MangaPatcher = MangaPatcher;
    console.log('[MangaPatcher] Loaded');
})(typeof window !== 'undefined' ? window : self);
