/**
 * DownloadLib exporter module
 * Dual-mode exporter (ZIP contains JPEG and TXT)
 * @module exporters/SimpleExporter
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

'use strict';

(function(global) {
    console.log('[SimpleExporter] Loading...');

    /**
     * Двухрежимный экспортёр: сохраняет главы как ZIP-архив с изображениями страниц
     * (для тайтлов-манги), либо как обычный TXT-файл (для тайтлов с текстовым
     * содержимым, например RanobeLib); умеет разбирать оба формата обратно.
     */
    class SimpleExporter extends global.BaseExporter {
        /**
         * Экспортирует тайтл в TXT (если главы содержат текст) или ZIP (если изображения).
         * @param {object} manga - Нормализованные метаданные тайтла.
         * @param {object[]} chapters - Содержимое глав.
         * @returns {Promise<{blob: Blob, filename: string, mimeType: string}>} Результат экспорта.
         */
        async export(manga, chapters) {
            const name = this.sanitize(manga.name || 'manga');

            if (this.isRanobeLib(chapters))
                return this.exportTxt(name, manga, chapters);
            return await this.exportZip(name, chapters);
        }

        /**
         * Определяет, является ли тайтл текстовым (содержит непустые текстовые блоки),
         * в отличие от тайтла-манги с изображениями страниц.
         * @param {object[]} chapters - Содержимое глав.
         * @returns {boolean} true, если хотя бы одна глава содержит непустой текстовый блок.
         */
        isRanobeLib(chapters) {
            for (const ch of chapters) {
                if (!Array.isArray(ch.content)) continue;
                for (const block of ch.content) {
                    if (block.type === 'text' && block.text && this.sanitizeText(block.text))
                        return true;
                }
            }
            return false;
        }

        /**
         * Собирает содержимое тайтла в единый TXT-файл: заголовок с метаданными,
         * затем текст каждой главы под заголовком "=== Глава N: title ===".
         * @param {string} name - Санитизированное имя файла (без расширения).
         * @param {object} manga - Нормализованные метаданные тайтла.
         * @param {object[]} chapters - Содержимое глав.
         * @returns {{blob: Blob, filename: string, mimeType: string}} Результат экспорта.
         */
        exportTxt(name, manga, chapters) {
            const title  = manga.name || 'Без названия';
            const author = manga.authors.filter(Boolean).join(', ');
            const lines  = [];

            lines.push(title);
            if (author) lines.push(author);
            if (manga.releaseDate) lines.push(`Год выхода: ${manga.releaseDate}`);
            if (manga.rating) lines.push(`Возрастное ограничение: ${manga.rating}`);
            const genres = manga.genres || [];
            if (genres.length) lines.push(`Жанры: ${genres.join(', ')}`);
            if (manga.summary) lines.push(manga.summary);
            lines.push('─'.repeat(60));
            lines.push('');

            for (let ci = 0; ci < chapters.length; ci++) {
                const ch = chapters[ci];
                lines.push(`=== Глава ${ci + 1}: ${ch.title || ''} ===`);
                lines.push('');

                if (!Array.isArray(ch.content)) {
                    lines.push('');
                    continue;
                }

                for (const block of ch.content) {
                    if (block.type !== 'text' || !block.text) continue;
                    for (const line of String(block.text).split('\n'))
                        lines.push(line);
                    lines.push('');
                }

                lines.push('');
            }

            const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
            return { blob, filename: `${name}.txt`, mimeType: 'text/plain' };
        }

        /**
         * Собирает страницы всех глав в ZIP-архив с именами файлов, кодирующими
         * том, главу и номер страницы.
         * @param {string} name - Санитизированное имя файла (без расширения).
         * @param {object[]} chapters - Содержимое глав.
         * @returns {Promise<{blob: Blob, filename: string, mimeType: string}>} Результат экспорта.
         * @throws {Error} Если библиотека JSZip не загружена.
         */
        async exportZip(name, chapters) {
            if (typeof global.JSZip === 'undefined')
                throw new Error('[SimpleExporter] JSZip not loaded (include lib/jszip.min.js)');

            const zip = new global.JSZip();

            for (let ci = 0; ci < chapters.length; ci++) {
                const ch  = chapters[ci];
                const vol = ch.volume  != null ? ch.volume  : ci + 1;
                const num = ch.number  != null ? ch.number  : ci + 1;

                if (!Array.isArray(ch.content)) continue;

                let pageIdx = 0;

                for (const block of ch.content) {
                    if (block.type !== 'image') continue;
                    if (!block.data || !block.data.base64) continue;

                    pageIdx += 1;

                    const contentType = block.data.contentType || 'image/jpeg';
                    const ext         = this.mimeToExt(contentType);
                    const filename    = `${name}_volume_${vol}_chapter_${num}_page_${pageIdx}.${ext}`;

                    zip.file(filename, block.data.base64, { base64: true });
                }
            }

            const blob = await zip.generateAsync({
                type:        'blob',
                compression: 'STORE'
            });

            return { blob, filename: `${name}.zip`, mimeType: 'application/zip' };
        }

        /**
         * Определяет расширение файла изображения по MIME-типу.
         * @param {string} mime - MIME-тип изображения.
         * @returns {string} Расширение файла ('png', 'webp', 'gif' или 'jpg' по умолчанию).
         */
        mimeToExt(mime) {
            if (mime.includes('png'))  return 'png';
            if (mime.includes('webp')) return 'webp';
            if (mime.includes('gif'))  return 'gif';
            return 'jpg';
        }

        /**
         * Очищает строку для использования в качестве имени файла: заменяет
         * запрещённые символы и пробелы на подчёркивания и обрезает длину.
         * @param {*} str - Исходная строка.
         * @returns {string} Строка, безопасная для имени файла (не длиннее 180 символов).
         */
        sanitize(str) {
            return String(str)
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') // eslint-disable-line no-control-regex
                .replace(/\s+/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '')
                .substring(0, 180) || 'manga';
        }
    }

    global.SimpleExporter = SimpleExporter;
    if (global.ExporterRegistry) global.ExporterRegistry.register('simple', SimpleExporter, { label: 'TXT/JPEG' });
    console.log('[SimpleExporter] Loaded');
})(typeof window !== 'undefined' ? window : self);