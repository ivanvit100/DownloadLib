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
    console.log('[ExportAdapter] Loading...');

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
            return (Array.isArray(manga.authors))?
                (manga.authors).map(author => {
                    if(typeof author === 'object') {
                        return author.name || "";
                    }

                    return author;
                })
            : [""];
        }
    }

    class ExporterAdapter {
        constructor (exporter) {
            this.exporter = exporter;
        }

        async export(manga, chapters, coverBase64) {
            const authors = AuthorApiCompatibilityModule.prepare(manga);
            return this.exporter.export({ ...manga, authors: authors }, chapters, coverBase64);
        }
    }

    global.ExporterAdapter = ExporterAdapter;
    console.log('[ExportAdapter] Loaded');
})(typeof window !== 'undefined' ? window : self);
