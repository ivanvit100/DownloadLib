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

    /**
     * Экспортёр и парсер формата FB2 (FictionBook 2.0): собирает XML-документ
     * потоково через генераторы, чтобы не держать весь текст книги в памяти
     * целиком, и умеет разбирать ранее экспортированный FB2-файл обратно.
     */
    class FB2Exporter extends global.BaseExporter {
        /**
         * Строит XML-теги имени автора (first/middle/last-name) из полного имени.
         * @param {?string} author - Полное имя автора, разделённое пробелами.
         * @returns {string} XML-фрагмент с тегами имени.
         */
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

        /**
         * Оборачивает описание одного автора в тег &lt;author&gt;.
         * @param {?string} author - Полное имя автора.
         * @returns {string} XML-фрагмент тега author.
         */
        createAuthorsTag(author) {
            return `     <author>\n${this.createAuthorsDescription(author)}     </author>\n`;
        }

        /**
         * Строит XML-фрагмент со всеми тегами author тайтла.
         * @param {string[]} authors - Список имён авторов.
         * @returns {string} Объединённый XML-фрагмент тегов author.
         */
        createAuthors(authors) {
            return authors.map(author => this.createAuthorsTag(author)).join('');
        }

        /**
         * Преобразует ограниченное подмножество inline HTML-тегов (b/strong, i/em,
         * s/strike/del, code) в соответствующие теги FB2, удаляя остальную разметку.
         * @param {?string} html - Исходный HTML-фрагмент.
         * @returns {string} Текст с FB2-тегами вместо HTML.
         */
        _htmlToFb2(html) {
            if (!html) return '';
            const m = '\x00';
            return String(html)
                .replace(/<(?:strong|b)\b[^>]*>/gi,    `${m}strong>`)
                .replace(/<\/(?:strong|b)>/gi,          `${m}/strong>`)
                .replace(/<(?:em|i)\b[^>]*>/gi,         `${m}emphasis>`)
                .replace(/<\/(?:em|i)>/gi,              `${m}/emphasis>`)
                .replace(/<(?:s|strike|del)\b[^>]*>/gi, `${m}strikethrough>`)
                .replace(/<\/(?:s|strike|del)>/gi,      `${m}/strikethrough>`)
                .replace(/<code\b[^>]*>/gi,             `${m}code>`)
                .replace(/<\/code>/gi,                  `${m}/code>`)
                .replace(/<[^>]*>/g, '')
                .replace(/\0/g, '<');
        }

        /**
         * Генерирует XML-строки FB2 для HTML-блока текста, разбивая его по &lt;br&gt;
         * на параграфы (или строки стихотворения при выравнивании по центру).
         * @param {string} html - HTML-содержимое блока.
         * @param {?string} align - Выравнивание блока ('center' для стихотворной формы).
         * @yields {string} Строки XML-разметки FB2.
         */
        *_yieldFb2HtmlBlock(html, align) {
            const parts = html.split(/<br\s*\/?>/i);
            if (align === 'center') {
                yield '    <poem><stanza>\n';
                for (const part of parts) {
                    const content = this._htmlToFb2(part).trim();
                    yield content
                        ? `        <v>${content}</v>\n`
                        : '        <v>&#160;</v>\n';
                }
                yield '    </stanza></poem>\n';
            } else {
                for (const part of parts) {
                    const content = this._htmlToFb2(part).trim();
                    if (content)
                        yield `    <p>${content}</p>\n`;
                    else
                        yield '    <empty-line/>\n';
                }
            }
        }

        /**
         * Генерирует XML-строки FB2 для plain-текстового блока, разбивая его
         * по переносам строк на параграфы (или строки стихотворения при выравнивании по центру).
         * @param {string} text - Текстовое содержимое блока.
         * @param {?string} align - Выравнивание блока ('center' для стихотворной формы).
         * @yields {string} Строки XML-разметки FB2.
         */
        *_yieldFb2TextBlock(text, align) {
            const lines = text.split('\n');
            if (align === 'center') {
                yield '    <poem><stanza>\n';
                for (const line of lines) {
                    const trimmed = line.trim();
                    yield trimmed
                        ? `        <v>${this.escapeXml(trimmed)}</v>\n`
                        : '        <v>&#160;</v>\n';
                }
                yield '    </stanza></poem>\n';
            } else {
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed)
                        yield `    <p>${this.escapeXml(trimmed)}</p>\n`;
                    else
                        yield '    <empty-line/>\n';
                }
            }
        }

        /**
         * Генерирует XML-строки FB2 для всего содержимого главы: текстовые блоки
         * (HTML или plain text) и изображения, ранее зарегистрированные в
         * createFB2Stream с присвоенным block._fb2ImageId.
         * @param {{content?: Array}} chapter - Содержимое главы.
         * @yields {string} Строки XML-разметки FB2.
         */
        *_yieldChapterContent(chapter) {
            if (!chapter.content || !Array.isArray(chapter.content)) return;

            for (const block of chapter.content) {
                if (block.type === 'text' && block.text) {
                    if (block.html)
                        yield* this._yieldFb2HtmlBlock(block.html, block.align);
                    else
                        yield* this._yieldFb2TextBlock(block.text, block.align);
                } else if (block.type === 'image' && block._fb2ImageId)
                    yield `    <p><image l:href="#${block._fb2ImageId}"/></p>\n`;
                else console.warn(`[FB2Exporter] Unsupported block type: ${block.type}`);
            }
        }

        /**
         * Генерирует XML-строки блока &lt;description&gt; FB2: title-info с авторами,
         * названием, аннотацией и обложкой, а также publish-info и возрастной рейтинг.
         * @param {object} manga - Нормализованные метаданные тайтла.
         * @param {?string} coverBase64 - Обложка тайтла в base64 (наличие влияет на coverpage).
         * @yields {string} Строки XML-разметки FB2.
         */
        *_yieldDescriptionBlock(manga, coverBase64) {
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
            if (manga.releaseDate)
                yield `    <date value="${this.escapeXml(String(manga.releaseDate))}">${this.escapeXml(String(manga.releaseDate))}</date>\n`;
            const keywords = [...(manga.genres || []), ...(manga.tags || [])];
            if (keywords.length)
                yield `    <keywords>${this.escapeXml(keywords.join(', '))}</keywords>\n`;
            yield '  </title-info>\n';
            if (manga.releaseDate || manga.rating) {
                yield '  <publish-info>\n';
                if (manga.releaseDate)
                    yield `    <year>${this.escapeXml(String(manga.releaseDate))}</year>\n`;
                yield '  </publish-info>\n';
            }
            if (manga.rating)
                yield `  <custom-info info-type="age-rating">${this.escapeXml(manga.rating)}</custom-info>\n`;
        }

        /**
         * Генерирует полный FB2-документ потоково: описание, тело со всеми главами
         * (и секцией обложки, если она есть) и блок бинарных вложений (обложка
         * и изображения страниц) в конце документа.
         * @param {object} manga - Нормализованные метаданные тайтла.
         * @param {object[]} chapters - Содержимое глав.
         * @param {?string} coverBase64 - Обложка тайтла в base64.
         * @yields {string} Части итогового FB2-документа.
         */
        *createFB2Stream(manga, chapters, coverBase64) {
            yield '<?xml version="1.0" encoding="utf-8"?>\n';
            yield `<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">\n`;

            yield '<description>\n';
            yield* this._yieldDescriptionBlock(manga, coverBase64);
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

        /**
         * Собирает поток createFB2Stream в единый Blob FB2-файла.
         * @param {object} manga - Нормализованные метаданные тайтла.
         * @param {object[]} chapters - Содержимое глав.
         * @param {?string} coverBase64 - Обложка тайтла в base64.
         * @returns {{blob: Blob, filename: string, mimeType: string}} Результат экспорта.
         */
        export(manga, chapters, coverBase64) {
            const chunks = [];
            for (const chunk of this.createFB2Stream(manga, chapters, coverBase64))
                chunks.push(chunk);

            const content = chunks.join('');
            const blob = new Blob([content], { type: 'application/x-fictionbook+xml' });
            const filename = `${manga.name || 'manga'}.fb2`;

            return {
                blob,
                filename,
                mimeType: 'application/x-fictionbook+xml'
            };
        }

        /**
         * Извлекает список имён авторов из тега title-info FB2-документа.
         * @param {?Element} titleInfo - Элемент title-info распарсенного FB2-документа.
         * @returns {string[]} Список имён авторов (не короче одного элемента).
         */
        _parseFB2Authors(titleInfo) {
            const authors = [];
            const authorNodes = titleInfo?.querySelectorAll('author') || [];
            authorNodes.forEach(author => {
                const firstName = author.querySelector('first-name')?.textContent || '';
                const middleName = author.querySelector('middle-name')?.textContent || '';
                const lastName = author.querySelector('last-name')?.textContent || '';
                const name = [firstName, middleName, lastName].filter(Boolean).join(' ');
                authors.push(name || 'Неизвестно');
            });
            return authors;
        }

        /**
         * Разбирает один параграф FB2 в элемент содержимого главы: текстовый блок,
         * либо изображение, найденное по ссылке на соответствующий тег binary.
         * @param {Element} p - Элемент &lt;p&gt; секции.
         * @param {Document} doc - Весь распарсенный FB2-документ (для поиска binary по id).
         * @returns {?{type: 'text', text: string}|{type: 'image', data: {base64: string,
         * contentType: string}}} Элемент содержимого, либо null, если изображение
         * ссылается на несуществующий binary.
         */
        _parseFB2ParagraphContent(p, doc) {
            const imageEl = p.querySelector('image');
            if (!imageEl) {
                const pText = p.textContent.trim();
                return { type: 'text', text: pText };
            }
            const href = imageEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
                || imageEl.getAttribute('l:href')
                || '';
            const binaryId = href.startsWith('#') ? href.slice(1) : href;
            const binaryEl = doc.querySelector(`binary[id="${binaryId}"]`);
            if (!binaryEl) return null;
            const contentType = binaryEl.getAttribute('content-type') || 'image/jpeg';
            const base64 = binaryEl.textContent.trim();
            return { type: 'image', data: { base64, contentType } };
        }

        /**
         * Извлекает номер тома и главы из строки заголовка вида "Том X, Глава Y".
         * @param {string} title - Заголовок главы/секции.
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
         * Разбирает все секции верхнего уровня FB2-документа в список глав,
         * пропуская служебную секцию обложки, если она была добавлена при экспорте.
         * @param {Document} doc - Распарсенный FB2-документ.
         * @param {boolean} hasCover - Содержит ли документ секцию обложки для пропуска.
         * @returns {object[]} Список разобранных глав.
         */
        _parseFB2Sections(doc, hasCover) {
            const chapters = [];
            const sections = doc.querySelectorAll('body > section');
            sections.forEach((section, idx) => {
                const titleNode = section.querySelector('title');
                const title = titleNode?.textContent?.trim() || `Глава ${idx + 1}`;
                if (hasCover && title === 'Обложка') return;

                const content = Array.from(section.querySelectorAll('p'))
                    .filter(p => !p.closest('title'))
                    .map(p => this._parseFB2ParagraphContent(p, doc))
                    .filter(Boolean);

                const volNum = this._extractVolNum(title);
                chapters.push({
                    title,
                    content,
                    number: volNum ? volNum.number : idx + 1,
                    volume: volNum ? volNum.volume : 1
                });
            });
            return chapters;
        }

        /**
         * Извлекает дату выхода тайтла из тега date title-info, либо из
         * publish-info/year как запасной вариант.
         * @param {?Element} titleInfo - Элемент title-info распарсенного FB2-документа.
         * @param {Document} doc - Весь распарсенный FB2-документ.
         * @returns {string} Найденная дата выхода, либо пустая строка.
         */
        _parseFB2ReleaseDate(titleInfo, doc) {
            const dateEl = titleInfo ? titleInfo.querySelector('date') : null;
            if (dateEl) {
                const attr = dateEl.getAttribute('value');
                if (attr) return attr;
                const text = dateEl.textContent.trim();
                if (text) return text;
            }
            const yearEl = doc.querySelector('publish-info > year');
            return yearEl ? yearEl.textContent.trim() : '';
        }

        /**
         * Извлекает описание, дату выхода, жанры (из keywords) и возрастной рейтинг
         * из title-info и остального FB2-документа.
         * @param {?Element} titleInfo - Элемент title-info распарсенного FB2-документа.
         * @param {Document} doc - Весь распарсенный FB2-документ.
         * @returns {{summary: string, releaseDate: string, genres: string[], rating: string}}
         * Извлечённые метаданные тайтла.
         */
        _parseFB2Metadata(titleInfo, doc) {
            const summary = titleInfo?.querySelector('annotation')?.textContent?.trim() || '';
            const releaseDate = this._parseFB2ReleaseDate(titleInfo, doc);
            const keywordsText = titleInfo?.querySelector('keywords')?.textContent?.trim() || '';
            const genres = keywordsText
                ? keywordsText.split(',').map(s => s.trim()).filter(Boolean)
                : [];
            const rating = doc.querySelector('custom-info[info-type="age-rating"]')?.textContent?.trim() || '';
            return { summary, releaseDate, genres, rating };
        }

        /**
         * Разбирает FB2-документ обратно в унифицированную структуру: метаданные,
         * обложку и главы.
         * @param {string} text - Текстовое содержимое FB2-файла (XML).
         * @param {string} filename - Имя файла (используется как запасное название,
         * если тег book-title отсутствует).
         * @returns {{metadata: object, cover: string, chapters: object[]}} Разобранное содержимое.
         */
        parseFB2(text, filename) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/xml');
            const titleInfo = doc.querySelector('title-info');
            const hasCover = !!doc.querySelector('binary[id*="cover"]');
            const bookTitle = titleInfo?.querySelector('book-title')?.textContent || filename;

            let cover = '';
            const binary = doc.querySelector('binary[id*="cover"]');
            if (binary) {
                const contentType = binary.getAttribute('content-type') || 'image/jpeg';
                cover = `data:${contentType};base64,${binary.textContent.trim()}`;
            }

            return {
                metadata: {
                    name: bookTitle,
                    rus_name: bookTitle,
                    authors: this._parseFB2Authors(titleInfo),
                    ...this._parseFB2Metadata(titleInfo, doc)
                },
                cover,
                chapters: this._parseFB2Sections(doc, hasCover)
            };
        }
    }

    global.FB2Exporter = FB2Exporter;
    if (global.ExporterRegistry) global.ExporterRegistry.register('fb2', FB2Exporter, { label: 'FB2' });
    console.log('[FB2Exporter] Loaded');
})(typeof window !== 'undefined' ? window : self);
