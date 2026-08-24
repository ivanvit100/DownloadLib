/**
 * DownloadLib — пример плагина формата
 * Экспортирует мангу в формат CBZ (Comic Book ZIP) с метаданными ComicInfo.xml
 * @module plugins/CBZExporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.9
 *
 * Установка: открыть настройки DownloadLib → Плагины → Добавить плагин → выбрать этот файл
 * Требует: JSZip (входит в состав DownloadLib)
 *
 * --- ТЕГИ МЕТАДАННЫХ ПЛАГИНА ---
 * Оба JSDoc-тега ОБЯЗАТЕЛЬНЫ. PluginManager.parseMetadata() читает их,
 * чтобы зарегистрировать формат в хранилище и добавить его в список форматов в UI.
 * Без @dl-format плагин будет полностью проигнорирован.
 * Строка формата должна быть в нижнем регистре и уникальной среди встроенных и плагинных форматов.
 *
 * @dl-format cbz
 * @dl-label CBZ
 */

'use strict';

// Каждый плагин ОБЯЗАН быть обёрнут в IIFE.
// Параметр `global` разрешается в `window` в контексте popup-страницы и в `self`
// в контексте service worker. Всегда обращайтесь к глобалам DownloadLib через него —
// не полагайтесь на прямой доступ к `window`.
(function(global) {
    // Защита: DownloadLib загружает BaseExporter до плагинов, но пользователь может
    // запустить файл отдельно. Лучше упасть с явной ошибкой, чем с непонятным TypeError.
    if (!global.BaseExporter) {
        console.error('[CBZExporter] BaseExporter not found — load after DownloadLib');
        return;
    }

    // Класс экспортера ОБЯЗАН наследоваться от global.BaseExporter.
    // BaseExporter предоставляет вспомогательные методы, используемые ниже.
    class CBZExporter extends global.BaseExporter {
        // export() — единственный обязательный метод.
        // Сигнатура: async export(manga, chapters, coverBase64) → { blob, filename, mimeType }
        //
        // manga        — объект метаданных (структура описана ниже в _buildComicInfo)
        // chapters     — массив глав: { volume, number, content: Block[] }
        //                Block: { type: 'image'|'text'|…, data: { base64, contentType } }
        //                Данные изображения содержат только блоки с type === 'image' и data.base64.
        // coverBase64  — необязательная обложка в виде строки base64 (может содержать data-URL префикс)
        //
        // Возвращаемое значение ОБЯЗАНО иметь вид { blob: Blob, filename: string, mimeType: string }.
        // DownloadManager передаёт его напрямую в браузерный download API.
        async export(manga, chapters, coverBase64) {
            if (typeof global.JSZip === 'undefined')
                throw new Error('[CBZExporter] JSZip not available');

            const zip  = new global.JSZip();
            const name = this._sanitize(manga.name || 'manga');

            zip.file('ComicInfo.xml', this._buildComicInfo(manga));

            if (coverBase64) {
                const b64 = coverBase64.includes(',') ? coverBase64.split(',')[1] : coverBase64;
                zip.file('000_cover.jpg', b64, { base64: true });
            }

            for (let ci = 0; ci < chapters.length; ci++) {
                const ch = chapters[ci];
                if (!Array.isArray(ch.content)) continue;

                const vol = String(ch.volume != null ? ch.volume : ci + 1).padStart(2, '0');
                const num = String(ch.number != null ? ch.number : ci + 1).padStart(3, '0');
                const dir = `v${vol}_c${num}/`;

                let page = 0;
                for (const block of ch.content) {
                    if (block.type !== 'image' || !block.data?.base64) continue;
                    page += 1;
                    const ext = this._mimeToExt(block.data.contentType || 'image/jpeg');
                    const filename = `${dir}${String(page).padStart(4, '0')}.${ext}`;
                    zip.file(filename, block.data.base64, { base64: true });
                }
            }

            const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
            return { blob, filename: `${name}.cbz`, mimeType: 'application/vnd.comicbook+zip' };
        }

        _buildComicInfo(manga) {
            const e    = s => this.escapeXml(String(s || ''));
            const lines = [
                '<?xml version="1.0" encoding="utf-8"?>',
                '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
                '           xmlns:xsd="http://www.w3.org/2001/XMLSchema">'
            ];

            lines.push(`  <Title>${e(manga.name)}</Title>`);
            lines.push(`  <Series>${e(manga.name)}</Series>`);

            if (manga.rus_name && manga.rus_name !== manga.name)
                lines.push(`  <LocalizedSeries>${e(manga.rus_name)}</LocalizedSeries>`);

            const authors = (manga.authors || []).filter(Boolean);
            if (authors.length)
                lines.push(`  <Writer>${e(authors.join(', '))}</Writer>`);

            if (manga.summary)
                lines.push(`  <Summary>${e(manga.summary)}</Summary>`);

            if (manga.releaseDate)
                lines.push(`  <Year>${e(manga.releaseDate)}</Year>`);

            const genres = (manga.genres || []).filter(Boolean);
            if (genres.length)
                lines.push(`  <Genre>${e(genres.join(', '))}</Genre>`);

            const tags = (manga.tags || []).filter(Boolean);
            if (tags.length)
                lines.push(`  <Tags>${e(tags.join(', '))}</Tags>`);

            if (manga.rating)
                lines.push(`  <AgeRating>${e(manga.rating)}</AgeRating>`);

            lines.push('  <LanguageISO>ru</LanguageISO>');
            lines.push('</ComicInfo>');
            return lines.join('\n');
        }

        _mimeToExt(mime) {
            if (mime.includes('png'))  return 'png';
            if (mime.includes('webp')) return 'webp';
            if (mime.includes('gif'))  return 'gif';
            return 'jpg';
        }

        _sanitize(str) {
            return String(str)
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') // eslint-disable-line no-control-regex
                .replace(/\s+/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '')
                .substring(0, 180) || 'manga';
        }
    }

    // Защита: ExporterRegistry должен быть доступен для регистрации плагина.
    // В нормальном popup DownloadLib он всегда есть, но плагин, загруженный вне
    // порядка (например, при тестировании), должен явно сообщить об ошибке.
    if (!global.ExporterRegistry) {
        console.error('[CBZExporter] ExporterRegistry not found — plugin will not be available');
        return;
    }

    // Регистрация: первый аргумент ОБЯЗАН совпадать с @dl-format дословно.
    // Поле label в meta — это то, что видит пользователь в выпадающем списке форматов.
    global.ExporterRegistry.register('cbz', CBZExporter, { label: 'CBZ' });
    console.log('[CBZExporter] Plugin loaded');
})(typeof window !== 'undefined' ? window : self);
