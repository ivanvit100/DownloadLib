/**
 * DownloadLib exporter module
 * Module to export manga as EPUB files
 * @module exporters/EPUBExporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
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
                    body += '<img class="page-image" src="images/cover.jpg" alt="Cover"/>\n';
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
                            body += `<img class="page-image" src="${block._epubImagePath}" alt="Image"/>\n`;
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
    ${isImageOnlyChapter ? '<style type="text/css">html,body{margin:0;padding:0;} body{line-height:0;font-size:0;} img.page-image{display:block;width:100%;height:auto;margin:0;padding:0;border:0;}</style>' : ''}
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

        /**
         * Находит файл content.opf внутри EPUB-архива: сначала по пути,
         * указанному в META-INF/container.xml, а если это не удалось —
         * перебором файлов с расширением .opf.
         * @param {object} zipContent - Загруженный JSZip-архив EPUB-файла.
         * @returns {Promise<?object>} Найденный файл .opf внутри архива, либо null.
         */
        async _resolveOpfFile(zipContent) {
            const containerXml = await zipContent.file('META-INF/container.xml')?.async('text');

            if (containerXml) {
                const parser = new DOMParser();
                const containerDoc = parser.parseFromString(containerXml, 'text/xml');
                const rootfile = containerDoc.querySelector('rootfile');
                const opfPath = rootfile?.getAttribute('full-path');
                if (opfPath) return zipContent.file(opfPath);
                console.warn('[EPUBExporter] No full-path attribute found in container.xml');
            }

            for (const filename of Object.keys(zipContent.files)) {
                if (filename.endsWith('.opf'))
                    return zipContent.files[filename];
                console.warn(`[EPUBExporter] Skipping non-opf file: ${filename}`);
            }

            return null;
        }

        /**
         * Разбирает content.opf: дополняет объект metadata найденными полями
         * (title, authors, description, genres, releaseDate, rating), извлекает
         * обложку по ссылке из манифеста и порядок чтения глав из spine.
         * @param {?object} opfFile - Файл content.opf внутри архива (из _resolveOpfFile).
         * @param {object} metadata - Объект метаданных, дополняемый на месте.
         * @param {object} zipContent - Загруженный JSZip-архив EPUB-файла.
         * @returns {Promise<{cover: string, spineOrder: string[]}>} Обложка
         * в виде data-URL и список id глав в порядке чтения (spine), либо пустые значения,
         * если opfFile не передан.
         */
        async _parseOpfFile(opfFile, metadata, zipContent) {
            if (!opfFile) return { cover: '', spineOrder: [] };

            const opfText = await opfFile.async('text');
            const parser = new DOMParser();
            const opfDoc = parser.parseFromString(opfText, 'text/xml');
            const metadataNode = opfDoc.querySelector('metadata');

            if (metadataNode) {
                const title = metadataNode.querySelector('dc\\:title, title')?.textContent || metadata.name;
                metadata.name = title;
                metadata.rus_name = title;

                const authorNodes = metadataNode.querySelectorAll('dc\\:creator, creator');
                metadata.authors = Array.from(authorNodes).map(a => a.textContent.trim()).filter(Boolean);

                const description = metadataNode.querySelector('dc\\:description, description')?.textContent;
                if (description) metadata.summary = description;
                else console.warn('[EPUBExporter] No description found in metadata');

                const subjectNodes = metadataNode.querySelectorAll('dc\\:subject, subject');
                metadata.genres = Array.from(subjectNodes).map(s => s.textContent.trim()).filter(Boolean);

                const dateNode = metadataNode.querySelector('dc\\:date, date');
                if (dateNode) metadata.releaseDate = dateNode.textContent.trim();

                const ageMeta = metadataNode.querySelector('meta[name="age-rating"]');
                if (ageMeta) metadata.rating = ageMeta.getAttribute('content') || '';
            }

            const manifest = opfDoc.querySelector('manifest');
            const coverItem = manifest?.querySelector(`item[properties*="cover-image"], item[id="cover"], item[id="cover-image"]`);
            let cover = '';

            if (coverItem) {
                const coverHref = coverItem.getAttribute('href');
                const opfDir = opfFile.name.substring(0, opfFile.name.lastIndexOf('/') + 1);
                const coverPath = opfDir + coverHref;
                const coverFile = zipContent.file(coverPath);
                if (coverFile) {
                    const coverBlob = await coverFile.async('blob');
                    cover = await this.blobToBase64(coverBlob);
                } else console.warn('[EPUBExporter] Cover file not found in zip:', coverPath);
            }

            let spineOrder = [];
            const spine = opfDoc.querySelector('spine');
            if (spine) {
                const itemrefs = spine.querySelectorAll('itemref');
                spineOrder = Array.from(itemrefs).map(ref => ref.getAttribute('idref'));
            }

            return { cover, spineOrder };
        }

        /**
         * Разбирает произвольный EPUB-файл (не обязательно созданный этим же
         * экспортёром) обратно в унифицированную структуру: метаданные, обложку
         * и главы с текстом и изображениями, в порядке spine (или по имени файла,
         * если spine недоступен).
         * @param {File} file - EPUB-файл для разбора.
         * @returns {Promise<{metadata: object, cover: string, chapters: object[]}>} Разобранное содержимое.
         * @throws {Error} Если библиотека JSZip не загружена.
         */
        async parseEPUB(file) {
            if (typeof JSZip === 'undefined')
                throw new Error('JSZip library not loaded. Include it in popup.html');

            const zip = new global.JSZip();
            const zipContent = await zip.loadAsync(file);

            const metadata = {
                name: file.name.replace('.epub', ''),
                rus_name: file.name.replace('.epub', ''),
                authors: [],
                summary: ''
            };

            const opfFile = await this._resolveOpfFile(zipContent);
            const { cover, spineOrder } = await this._parseOpfFile(opfFile, metadata, zipContent);

            const chapters = [];
            const htmlFiles = Object.keys(zipContent.files).filter(f =>
                f.match(/\.(x?html?)$/i) && !f.includes('nav.') && !f.includes('toc.')
            );

            const sortedFiles = spineOrder.length > 0
                ? spineOrder.map(id => {
                    const item = htmlFiles.find(f => f.includes(id) || f.endsWith(`${id}.html`) || f.endsWith(`${id}.xhtml`));
                    return item;
                }).filter(Boolean)
                : htmlFiles.sort();

            for (let i = 0; i < sortedFiles.length; i++) {
                const filename = sortedFiles[i];
                const htmlFile = zipContent.file(filename);
                if (!htmlFile) continue;

                const htmlText = await htmlFile.async('text');
                const parser = new DOMParser();
                const htmlDoc = parser.parseFromString(htmlText, 'text/html');
                const h1 = htmlDoc.querySelector('h1, h2');
                const title = h1?.textContent?.trim() || `Глава ${i + 1}`;

                const chapterContent = [];
                const body = htmlDoc.querySelector('body');
                if (body) {
                    const paragraphs = body.querySelectorAll('p');
                    paragraphs.forEach(p => {
                        const text = p.textContent.trim();
                        if (text) chapterContent.push({ type: 'text', text });
                        else console.warn(`[EPUBExporter] Empty paragraph in chapter file: ${filename}`);
                    });

                    const images = body.querySelectorAll('img');
                    for (const img of images) {
                        const src = img.getAttribute('src');
                        if (src) {
                            const fileDir = filename.substring(0, filename.lastIndexOf('/') + 1);
                            const imgPath = fileDir + src;
                            const imgFile = zipContent.file(imgPath);
                            if (imgFile) {
                                const imgBlob = await imgFile.async('blob');
                                const imgBase64 = await this.blobToBase64(imgBlob);
                                const [ , base64Data] = imgBase64.split(',');
                                chapterContent.push({
                                    type: 'image',
                                    data: {
                                        base64: base64Data,
                                        contentType: imgBlob.type || 'image/jpeg'
                                    }
                                });
                            } else console.warn(`[EPUBExporter] Image file not found in zip: ${imgPath}`);
                        } else console.warn(`[EPUBExporter] Image with no src attribute in chapter file: ${filename}`);
                    }
                } else console.warn(`[EPUBExporter] No body found in chapter file: ${filename}`);

                if (chapterContent.length > 0) {
                    const vn = this._extractVolNum(title);
                    chapters.push({
                        title,
                        content: chapterContent,
                        number: vn ? vn.number : i + 1,
                        volume: vn ? vn.volume : 1
                    });
                }
            }

            return {
                metadata,
                cover,
                chapters
            };
        }

        /**
         * Извлекает номер тома и главы из строки заголовка вида "Том X, Глава Y".
         * @param {string} title - Заголовок главы.
         * @returns {?{volume: string, number: string}} Найденные том/номер главы,
         * либо null, если заголовок не соответствует ожидаемому формату.
         */
        _extractVolNum(title) {
            const m = title.match(/Том\s+([^\s,]+)[,\s]+Глава\s+(\S+)/);
            if (m) return { volume: m[1], number: m[2] };
            const m2 = title.match(/Глава\s+(\S+)/);
            if (m2) return { volume: '1', number: m2[1] };
            return null;
        }

        /**
         * Кодирует Blob в data-URL с base64-содержимым.
         * @param {Blob} blob - Исходный Blob.
         * @returns {Promise<string>} data-URL с base64-содержимым.
         */
        blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
    }

    global.EPUBExporter = EPUBExporter;
    if (global.ExporterRegistry) global.ExporterRegistry.register('epub', EPUBExporter, { label: 'EPUB' });
    console.log('[EPUBExporter] Loaded');
})(typeof window !== 'undefined' ? window : self);
