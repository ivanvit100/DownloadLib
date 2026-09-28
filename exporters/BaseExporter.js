/**
 * DownloadLib base exporter module
 * Module to export manga as various formats
 * @module exporters/BaseExporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.0
 */

'use strict';

(function(global) {
    console.log('[BaseExporter] Loading...');

    /**
     * Базовый класс экспортёра форматов: определяет общий контракт export()
     * и набор общих утилит очистки/экранирования текста для подклассов-форматов.
     */
    class BaseExporter {
        /**
         * Создаёт экспортёр с форматом-заглушкой 'unknown' (переопределяется подклассами).
         */
        constructor() {
            this.format = 'unknown';
        }

        /**
         * Экспортирует тайтл в файл формата. Должен быть переопределён в подклассе.
         * @throws {Error} Всегда — метод абстрактный.
         * @returns {Promise<{blob: Blob, filename: string, mimeType: string}>}
         */
        async export() { // eslint-disable-line require-await
            throw new Error('export method must be implemented');
        }

        /**
         * Приводит значение к обрезанной строке, безопасной для вставки в файл.
         * @param {*} text - Исходное значение.
         * @returns {string} Обрезанная строка, либо пустая строка для falsy-значений.
         */
        sanitizeText(text) {
            if (!text) return '';
            return String(text).trim();
        }

        /**
         * Экранирует спецсимволы XML в строке.
         * @param {*} str - Исходное значение.
         * @returns {string} Экранированная строка, либо пустая строка для falsy-значений.
         */
        escapeXml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }

        /**
         * Экранирует спецсимволы HTML в строке.
         * @param {*} str - Исходное значение.
         * @returns {string} Экранированная строка, либо пустая строка для falsy-значений.
         */
        escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        /**
         * Удаляет HTML-разметку из строки, превращая её в чистый текст: вырезает
         * теги script/style целиком, заменяет остальные теги переносами строк
         * и декодирует основные HTML-сущности.
         * @param {*} html - Исходная HTML-строка.
         * @returns {string} Очищенный текст, либо пустая строка для falsy-значений.
         */
        stripHtml(html) {
            if (!html) return '';
            return String(html)
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, '\n')
                .replace(/&nbsp;/g, ' ')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, '\'')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        /**
         * Извлекает и объединяет текстовое содержимое главы: поддерживает как
         * сырую HTML-строку, так и rich-text структуру (массив блоков параграфов/текста).
         * @param {string|Array} content - Исходное содержимое главы.
         * @returns {string} Объединённый текст (абзацы разделены двойным переносом строки).
         */
        extractText(content) {
            if (typeof content === 'string')
                return this.stripHtml(content);

            if (Array.isArray(content)) {
                return content.map(block => {
                    if (block.type === 'paragraph' && Array.isArray(block.content)) {
                        return block.content
                            .filter(t => t.type === 'text' && t.text)
                            .map(t => t.text)
                            .join('');
                    }
                    if (block.type === 'text' && block.text)
                        return block.text;
                    if (block.type === 'text' && block.content)
                        return String(block.content);
                    return '';
                }).filter(Boolean).join('\n\n');
            }

            return '';
        }
    }

    global.BaseExporter = BaseExporter;
})(typeof window !== 'undefined' ? window : self);