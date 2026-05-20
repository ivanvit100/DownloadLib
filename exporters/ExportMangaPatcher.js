/**
 * DownloadLib exporter api patch module
 * Module to path exporting manga
 * @module exporters/ExportMangaPatcher
 * @license MIT
 * @author ivanvit
 * @version 1.0.5
 */

'use strict';

(function(global) {
    console.log('[ExportMangaPatcher] Loading...');

    class AuthorApiCompatibilityModule {
        static patch_array(authors) {
            return (authors.length !== 0)? (authors).map(author => {
                if(typeof author === 'object') {
                    return author.name || '';
                }

                return author;
            })
            : [''];
        }

        static patch_other(authors) {
            return (typeof authors === 'string')? [ authors ] : [''];
        }

        static patch(manga) {
            const authors = (Array.isArray(manga.authors))? this.patch_array(manga.authors)
                                                            : this.patch_other(manga.authors);
            return { ...manga, authors: authors };
        }
    }

    class ExportMangaPatcher {
        static patch(pipeline) {
            const pipes = [
                AuthorApiCompatibilityModule
            ];

            for(const pipe of pipes) {
                pipeline = pipe.patch(pipeline);
            }

            return pipeline;
        }
    }

    global.ExportMangaPatcher = ExportMangaPatcher;
    console.log('[ExportMangaPatcher] Loaded');
})(typeof window !== 'undefined' ? window : self);
