/**
 * DownloadLib core module
 * Escaping, entity decoding and file name cleanup shared by services and exporters
 * @module core/TextUtils
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

/**
 * Экранирует спецсимволы XML.
 * @param {*} value - Исходное значение.
 * @returns {string} Экранированная строка, либо пустая строка для falsy-значений.
 */
export function escapeXml(value) {
    if (!value) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Экранирует спецсимволы HTML.
 * @param {*} value - Исходное значение.
 * @returns {string} Экранированная строка, либо пустая строка для falsy-значений.
 */
export function escapeHtml(value) {
    if (!value) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Раскодирует основные HTML-сущности. &amp;amp; раскодируется последним, поэтому
 * экранированная сущность (например, &amp;amp;lt;) превращается в текст «&lt;»,
 * а не в «<».
 * @param {*} text - Текст с сущностями.
 * @returns {string} Текст без сущностей, либо пустая строка для falsy-значений.
 */
export function decodeEntities(text) {
    if (!text) return '';
    return String(text)
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&(?:apos|#0*39);/gi, '\'')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&');
}

/**
 * Очищает строку для использования в качестве имени файла: заменяет запрещённые
 * в именах файлов и управляющие символы на подчёркивания и обрезает длину.
 * @param {*} name - Исходное имя файла.
 * @param {number} [maxLength=200] - Максимальная длина результата.
 * @returns {string} Имя, безопасное для файловой системы.
 */
export function sanitizeFilename(name, maxLength = 200) {
    return String(name ?? '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') // eslint-disable-line no-control-regex
        .substring(0, maxLength);
}
