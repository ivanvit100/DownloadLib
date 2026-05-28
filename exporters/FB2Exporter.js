/**
 * DownloadLib exporter module
 * Module to export manga as FB2 files
 * @module exporters/FB2Exporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[FB2Exporter] Loading...');

    class FB2Exporter extends global.BaseExporter {
        createAuthorsDescription(author) {
            if (author) {
                const parts = author.split(' ');
                let result = `         <first-name>${this.escapeXml(parts[0])}</first-name>\n`;
                if (parts[1]) result += `         <middle-name>${this.escapeXml(parts[1])}</middle-name>\n`;
                if (parts[2]) result += `         <last-name>${this.escapeXml(parts[2])}</last-name>\n`;
                return result;
            }
            return `         <first-name>Неизвестно</first-name>\n`;
        }

        createAuthorsTag(author) {
            return `     <author>\n${this.createAuthorsDescription(author)}     </author>\n`;
        }

        createAuthors(authors) {
            return authors.map(author => this.createAuthorsTag(author)).join('');
        }

        *_yieldChapterContent(chapter) {
            if (!chapter.content || !Array.isArray(chapter.content)) return;

            for (const block of chapter.content) {
                if (block.type === 'text' && block.text) {
                    const lines = block.text.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed)
                            yield `    <p>${this.escapeXml(trimmed)}</p>\n`;
                        else
                            yield '    <empty-line/>\n';
                    }
                } else if (block.type === 'image' && block._fb2ImageId)
                    yield `    <p><image l:href="#${block._fb2ImageId}"/></p>\n`;
                else console.warn(`[FB2Exporter] Unsupported block type: ${block.type}`);
            }
        }

        *createFB2Stream(manga, chapters, coverBase64) {
            yield '<?xml version="1.0" encoding="utf-8"?>\n';
            yield `<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">\n`;

            yield '<description>\n';
            yield '  <title-info>\n';
            yield `    <genre>prose</genre>\n`;
            yield this.createAuthors(manga.authors);
            yield `    <book-title>${this.escapeXml(manga.name || 'Без названия')}</book-title>\n`;
            if (manga.summary)
                yield `    <annotation><p>${this.escapeXml(manga.summary)}</p></annotation>\n`;
            if (coverBase64) {
                yield '    <coverpage>\n';
                yield '      <image l:href="#cover.jpg"/>\n';
                yield '    </coverpage>\n';
            }
            yield `    <lang>ru</lang>\n`;
            yield '  </title-info>\n';
            yield '</description>\n';

            const binaries = [];
            let imageCounter = 0;

            if (coverBase64) {
                const base64Data = coverBase64.includes(',') ? coverBase64.split(',')[1] : coverBase64;
                binaries.push(`<binary id="cover.jpg" content-type="image/jpeg">${base64Data}</binary>\n`);
            }

            for (const chapter of chapters) {
                if (!chapter.content || !Array.isArray(chapter.content)) continue;
                for (const block of chapter.content) {
                    if (block.type === 'image' && block.data && block.data.base64) {
                        imageCounter += 1;
                        const imageId = `image${imageCounter}`;
                        const contentType = block.data.contentType || 'image/jpeg';
                        binaries.push(`<binary id="${imageId}" content-type="${contentType}">${block.data.base64}</binary>\n`);
                        block._fb2ImageId = imageId;
                    }
                }
            }

            yield '<body>\n';

            if (coverBase64) {
                yield '  <section>\n';
                yield '    <title><p>Обложка</p></title>\n';
                yield '    <p><image l:href="#cover.jpg"/></p>\n';
                yield '  </section>\n';
            }

            for (const chapter of chapters) {
                yield '  <section>\n';
                yield `    <title><p>${this.escapeXml(chapter.title)}</p></title>\n`;

                yield* this._yieldChapterContent(chapter);

                yield '  </section>\n';
            }

            yield '</body>\n';

            for (const binary of binaries)
                yield binary;

            yield '</FictionBook>';
        }

        export(manga, chapters, coverBase64) {
            const chunks = [];
            for (const chunk of this.createFB2Stream(manga, chapters, coverBase64))
                chunks.push(chunk);

            const content = chunks.join('');
            const blob = new Blob([content], { type: 'application/xml' });
            const filename = `${manga.name || 'manga'}.fb2`;

            return {
                blob,
                filename,
                mimeType: 'application/xml'
            };
        }

        parseFB2(text, filename) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/xml');

            const titleInfo = doc.querySelector('title-info');
            const bookTitle = titleInfo?.querySelector('book-title')?.textContent || filename;

            const authors = [];
            const authorNodes = titleInfo?.querySelectorAll('author') || [];
            authorNodes.forEach(author => {
                const firstName = author.querySelector('first-name')?.textContent || '';
                const middleName = author.querySelector('middle-name')?.textContent || '';
                const lastName = author.querySelector('last-name')?.textContent || '';
                const name = [firstName, middleName, lastName].filter(Boolean).join(' ');
                if (name) authors.push(name);
                else authors.push('Неизвестно');
            });

            let cover = '';
            const binary = doc.querySelector('binary[id*="cover"]');
            if (binary) {
                const contentType = binary.getAttribute('content-type') || 'image/jpeg';
                cover = `data:${contentType};base64,${binary.textContent.trim()}`;
            }

            const chapters = [];
            const sections = doc.querySelectorAll('body > section');
            const hasCover = !!doc.querySelector('binary[id*="cover"]');

            sections.forEach((section, idx) => {
                const titleNode = section.querySelector('title');
                const title = titleNode?.textContent?.trim() || `Глава ${idx + 1}`;

                if (hasCover && title === 'Обложка') return;

                const content = [];
                const paragraphs = Array.from(section.querySelectorAll('p')).filter(
                    p => !p.closest('title')
                );

                paragraphs.forEach(p => {
                    const imageEl = p.querySelector('image');
                    if (imageEl) {
                        const href = imageEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
                            || imageEl.getAttribute('l:href')
                            || '';
                        const binaryId = href.startsWith('#') ? href.slice(1) : href;
                        const binaryEl = doc.querySelector(`binary[id="${binaryId}"]`);
                        if (binaryEl) {
                            const contentType = binaryEl.getAttribute('content-type') || 'image/jpeg';
                            const base64 = binaryEl.textContent.trim();
                            content.push({ type: 'image', data: { base64, contentType } });
                        }
                    } else {
                        const pText = p.textContent.trim();
                        if (pText) content.push({ type: 'text', text: pText });
                        else content.push({ type: 'text', text: '' });
                    }
                });

                chapters.push({
                    title,
                    content,
                    number: idx + 1,
                    volume: 1
                });
            });

            const annotation = titleInfo?.querySelector('annotation');
            const summary = annotation?.textContent?.trim() || '';

            return {
                metadata: {
                    name: bookTitle,
                    rus_name: bookTitle,
                    authors,
                    summary
                },
                cover,
                chapters
            };
        }
    }

    global.FB2Exporter = FB2Exporter;
    if (global.ExporterRegistry) global.ExporterRegistry.register('fb2', FB2Exporter, { label: 'FB2' });
    console.log('[FB2Exporter] Loaded');
})(typeof window !== 'undefined' ? window : self);
