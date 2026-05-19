/**
 * DownloadLib core module
 * Manages manga downloads from various services
 * @module core/PrepareManager
 * @license MIT
 * @author ivanvit
 * @version 1.0.0
 */

'use strict';

(function(global) {
    console.log('[ExporterMangaPrepareProxy] Loading...');

    class AuthorApiCompatibilityModule {
        static prepare(manga) {
            /*
            * manga authors has stucture
            * Array [
            *   Object {
            *       ...,
            *       name: 'full author name',
            *       ...
            *   },
            *   ...
            * ]
            */
            /*
             * prepare manga authors
            */
            const authors = (Array.isArray(manga.authors))?
                (manga.authors).map(author => {
                    if(typeof author === 'object') {
                        return author.name || "";
                    }

                    return author;
                })
            : [""];

            return { ...manga, authors: authors };
        }
    }

    class ExporterMangaPrepareProxy {
        constructor (exporter) {
            this.exporter = exporter;

            this.pipes = [
                AuthorApiCompatibilityModule
            ];
        }

        async export(manga, chapters, coverBase64) {
            let pipeline = manga;
            for(const pipe of this.pipes) {
                pipeline = pipe.prepare(pipeline);
            }

            return this.exporter.export(pipeline, chapters, coverBase64);
        }
    }

    global.ExporterMangaPrepareProxy = ExporterMangaPrepareProxy;
    console.log('[ExporterMangaPrepareProxy] Loaded');
})(typeof window !== 'undefined' ? window : self);
