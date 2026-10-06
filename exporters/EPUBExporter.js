/**
 * DownloadLib exporter module
 * Module to export manga as EPUB files
 * @module exporters/EPUBExporter
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

'use strict';

(function(global) {
    console.log('[EPUBExporter] Loading...');

    /**
     * Экспортёр и парсер формата EPUB 2.0: собирает ZIP-контейнер со стандартной
     * структурой (mimetype, META-INF/container.xml, OEBPS с главами-XHTML,
     * изображениями, content.opf и toc.ncx) и умеет разбирать сторонние EPUB-файлы обратно.
     */
    class EPUBExporter extends global.BaseExporter {
        /**
         * Собирает EPUB-файл: обложку, изображения страниц, главы в виде XHTML-файлов
         * и служебные файлы пакета (container.xml, content.opf, toc.ncx).
         * @param {object} manga - Нормализованные метаданные тайтла.
         * @param {object[]} chapters - Содержимое глав.
         * @param {?string} coverBase64 - Обложка тайтла в base64.
         * @returns {Promise<{blob: Blob, filename: string, mimeType: string}>} Результат экспорта.
         * @throws {Error} Если библиотека JSZip не загружена.
         */
        async export(manga, chapters, coverBase64) {
            if (typeof JSZip === 'undefined')
                throw new Error('JSZip library not loaded');

            const zip = new global.JSZip();

            zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
            zip.file('META-INF/container.xml', this.createContainer());

            let manifest = '';
            let spine = '';
            let navPoints = '';
            let imageCounter = 0;

            if (coverBase64) {
                const base64Data = coverBase64.includes(',') ? coverBase64.split(',')[1] : coverBase64;
                zip.file('OEBPS/images/cover.jpg', base64Data, { base64: true });
                manifest += '<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>\n';
            }

            for (let i = 0; i < chapters.length; i++) {
                const chapter = chapters[i];

                if (chapter.content && Array.isArray(chapter.content)) {
                    for (const block of chapter.content) {
                        if (block.type === 'image' && block.data && block.data.base64) {
                            imageCounter += 1;
                            const imageId = `image${imageCounter}`;
                            const contentType = block.data.contentType || 'image/jpeg';
                            const ext = contentType === 'image/png' ? 'png' : 'jpg';
                            const filename = `images/${imageId}.${ext}`;

                            zip.file(`OEBPS/${filename}`, block.data.base64, { base64: true });
                            manifest += `<item id="${imageId}" href="${filename}" media-type="${contentType}"/>\n`;

                            block._epubImagePath = filename;
                        } else console.warn(`[EPUBExporter] Chapter ${i + 1} has unsupported image block or missing data`);
                    }
                } else console.warn(`[EPUBExporter] Chapter ${i + 1} has no content array`);
            }

            for (let i = 0; i < chapters.length; i++) {
                const chapter = chapters[i];
                const filename = `chapter${i + 1}.xhtml`;

                zip.file(`OEBPS/${filename}`, this.createChapterXHTML(chapter, coverBase64 && i === 0));

                manifest += `<item id="chapter${i + 1}" href="${filename}" media-type="application/xhtml+xml"/>\n`;
                spine += `<itemref idref="chapter${i + 1}"/>\n`;
                navPoints += this.createNavPoint(chapter.title, filename, i + 1);
            }

            zip.file('OEBPS/content.opf', this.createOPF(manga, manifest, spine));
            zip.file('OEBPS/toc.ncx', this.createNCX(manga, navPoints));

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const filename = `${manga.name || 'manga'}.epub`;

            return {
                blob: zipBlob,
                filename,
                mimeType: 'application/epub+zip'
            };
        }

        /**
         * Строит содержимое META-INF/container.xml, указывающего на content.opf.
         * @returns {string} XML-содержимое container.xml.
         */
        createContainer() {
            return `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
        }

        /**
         * Строит XHTML-документ одной главы: заголовок, обложку (для первой главы)
         * и содержимое (текст и/или изображения страниц); для глав, состоящих
         * только из изображений, использует упрощённую разметку без отступов.
         * @param {object} chapter - Содержимое главы (title, content с block._epubImagePath
         * для изображений, проставленным на этапе export()).
         * @param {boolean} includeCover - Нужно ли включить в главу изображение обложки.
         * @returns {string} XHTML-содержимое главы.
         */
        createChapterXHTML(chapter, includeCover) {
            const title = this.escapeXml(chapter.title);
            const blocks = Array.isArray(chapter.content) ? chapter.content : [];
            const hasTextBlocks = blocks.some(block =>
                block && block.type === 'text' && block.text && String(block.text).trim());
            const hasImageBlocks = blocks.some(block => block && block.type === 'image' && block._epubImagePath);
            const isImageOnlyChapter = !hasTextBlocks && hasImageBlocks;

            let body = '';

            if (includeCover) {
                if (isImageOnlyChapter)
                    body += '<div class="page"><img class="page-image" src="images/cover.jpg" alt="Cover"/></div>\n';
                else {
                    body += '<div style="text-align: center; margin: 20px 0;">\n';
                    body += '<img src="images/cover.jpg" alt="Cover" style="max-width: 100%; height: auto;"/>\n';
                    body += '</div>\n';
                }
            }

            if (blocks.length) {
                for (const block of blocks) {
                    if (block.type === 'text' && block.text) {
                        const style = block.align ? ` style="text-align: ${this.escapeXml(block.align)};"` : '';
                        if (block.html) {
                            for (const part of block.html.split(/<br\s*\/?>/i)) {
                                const trimmed = part.trim();
                                body += trimmed ? `<p${style}>${trimmed}</p>\n` : '<p>&#160;</p>\n';
                            }
                        } else {
                            const lines = block.text.split('\n');
                            for (const line of lines) {
                                const trimmed = line.trim();
                                body += trimmed ?
                                    `<p${style}>${this.escapeXml(trimmed)}</p>\n` :
                                    '<p>&#160;</p>\n';
                            }
                        }
                    } else if (block.type === 'image' && block._epubImagePath) {
                        if (isImageOnlyChapter)
                            body += `<div class="page"><img class="page-image" src="${block._epubImagePath}" alt="Image"/></div>\n`;
                        else {
                            body += '<div style="text-align: center; margin: 10px 0;">\n';
                            body += `<img src="${block._epubImagePath}" alt="Image" style="max-width: 100%; height: auto;"/>\n`;
                            body += '</div>\n';
                        }
                    }
                }
            }

            return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="utf-8"/>
    <title>${title}</title>
    ${isImageOnlyChapter ? '<style type="text/css">html,body{margin:0;padding:0;} div.page{margin:0;padding:0;} img.page-image{display:block;width:100%;height:auto;margin:0;padding:0;border:0;}</style>' : ''}
</head>
<body>
    ${isImageOnlyChapter ? '' : `<h2>${title}</h2>`}
    ${body}
</body>
</html>`;
        }

        /**
         * Строит тег dc:creator для одного автора.
         * @param {?string} author - Имя автора.
         * @returns {string} XML-тег dc:creator.
         */
        createAuthorsDescription(author) {
            return `<dc:creator>${this.escapeXml(author || 'Неизвестно')}</dc:creator>`;
        }

        /**
         * Строит блок тегов dc:creator для всех авторов тайтла.
         * @param {string[]} authors - Список имён авторов.
         * @returns {string} Объединённый XML-фрагмент тегов dc:creator.
         */
        createAuthors(authors) {
            return authors.map(author => this.createAuthorsDescription(author)).join('\n    ');
        }

        /**
         * Строит содержимое OEBPS/content.opf: метаданные, дублинское ядро
         * (title, creator, description, subject, date), манифест файлов и spine
         * порядка чтения глав.
         * @param {object} manga - Нормализованные метаданные тайтла.
         * @param {string} manifest - Накопленный XML-фрагмент тегов &lt;item&gt; манифеста.
         * @param {string} spine - Накопленный XML-фрагмент тегов &lt;itemref&gt; spine.
         * @returns {string} XML-содержимое content.opf.
         */
        createOPF(manga, manifest, spine) {
            const title = this.escapeXml(manga.name || 'Без названия');
            const authors = this.createAuthors(manga.authors);
            const identifier = this.escapeXml(manga.id ? `urn:manga:${manga.id}` : (manga.name || 'unknown'));
            const description = manga.summary
                ? `\n    <dc:description>${this.escapeXml(manga.summary)}</dc:description>` : '';
            const coverMeta = manifest && manifest.includes('id="cover-image"')
                ? '\n    <meta name="cover" content="cover-image"/>' : '';
            const genres = [...(manga.genres || []), ...(manga.tags || [])];
            const subjects = genres.map(g => `\n    <dc:subject>${this.escapeXml(g)}</dc:subject>`).join('');
            const dateMeta = manga.releaseDate
                ? `\n    <dc:date>${this.escapeXml(String(manga.releaseDate))}</dc:date>` : '';
            const ageMeta = manga.rating
                ? `\n    <meta name="age-rating" content="${this.escapeXml(manga.rating)}"/>` : '';

            return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${identifier}</dc:identifier>
    <dc:title>${title}</dc:title>
    ${authors}
    <dc:language>ru</dc:language>${description}${subjects}${dateMeta}${ageMeta}${coverMeta}
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifest}
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
</package>`;
        }

        /**
         * Строит содержимое OEBPS/toc.ncx — оглавление EPUB 2.0 (навигационную карту).
         * @param {object} manga - Нормализованные метаданные тайтла.
         * @param {string} navPoints - Накопленный XML-фрагмент тегов &lt;navPoint&gt;.
         * @returns {string} XML-содержимое toc.ncx.
         */
        createNCX(manga, navPoints) {
            const title = this.escapeXml(manga.name || 'Без названия');
            const identifier = this.escapeXml(manga.id ? `urn:manga:${manga.id}` : (manga.name || 'unknown'));

            return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${identifier}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`;
        }

        /**
         * Строит один тег &lt;navPoint&gt; оглавления для главы.
         * @param {string} title - Заголовок главы.
         * @param {string} href - Путь к XHTML-файлу главы.
         * @param {number} order - Порядковый номер главы (playOrder).
         * @returns {string} XML-фрагмент тега navPoint.
         */
        createNavPoint(title, href, order) {
            return `<navPoint id="navPoint-${order}" playOrder="${order}">
      <navLabel><text>${this.escapeXml(title)}</text></navLabel>
      <content src="${href}"/>
    </navPoint>\n`;
        }
    }

    global.EPUBExporter = EPUBExporter;
    if (global.ExporterRegistry) global.ExporterRegistry.register('epub', EPUBExporter, { label: 'EPUB' });
    console.log('[EPUBExporter] Loaded');
})(typeof window !== 'undefined' ? window : self);
