'use strict';

let _cap = {};
const _reg = {};
const global = window;

global.BaseService = function(c) { this.config = c; this.name = c && c.name; };

global.BaseExporter = function() { this.format = 'unknown'; };

/**
 * Экранирует спецсимволы XML в строке.
 * @param {*} s - Исходное значение.
 * @returns {string} Экранированная строка, либо пустая строка для falsy-значений.
 */
global.BaseExporter.prototype.escapeXml = function(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
};

/**
 * Экранирует спецсимволы HTML в строке.
 * @param {*} s - Исходное значение.
 * @returns {string} Экранированная строка, либо пустая строка для falsy-значений.
 */
global.BaseExporter.prototype.escapeHtml = function(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

/**
 * Приводит значение к обрезанной строке, безопасной для вставки в файл.
 * @param {*} t - Исходное значение.
 * @returns {string} Обрезанная строка, либо пустая строка для falsy-значений.
 */
global.BaseExporter.prototype.sanitizeText = function(t) {
    if (!t) return '';
    return String(t).trim();
};

/**
 * Удаляет HTML-разметку из строки, как BaseExporter.stripHtml расширения:
 * вырезает script/style, заменяет теги переносами строк и раскодирует основные
 * HTML-сущности (&amp;amp; — последней).
 * @param {*} html - Исходная HTML-строка.
 * @returns {string} Очищенный текст, либо пустая строка для falsy-значений.
 */
global.BaseExporter.prototype.stripHtml = function(html) {
    if (!html) return '';
    return String(html)
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '\n')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&(?:apos|#0*39);/gi, '\'')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

/**
 * Извлекает текст главы, как BaseExporter.extractText расширения: HTML-строку
 * очищает от разметки, rich-text блоки объединяет через пустую строку.
 * @param {string|Array} content - Исходное содержимое главы.
 * @returns {string} Объединённый текст.
 */
global.BaseExporter.prototype.extractText = function(content) {
    if (typeof content === 'string') return this.stripHtml(content);
    if (!Array.isArray(content)) return '';
    return content.map(block => {
        if (block.type === 'paragraph' && Array.isArray(block.content)) {
            return block.content
                .filter(t => t.type === 'text' && t.text)
                .map(t => t.text)
                .join('');
        }
        if (block.type === 'text' && block.text) return block.text;
        if (block.type === 'text' && block.content) return String(block.content);
        return '';
    }).filter(Boolean).join('\n\n');
};

global.ExporterRegistry = {
    /**
     * Регистрирует класс экспортёра плагина в локальном реестре песочницы
     * и запоминает формат в _cap для передачи родительскому окну после sb-exec.
     * @param {string} fmt - Ключ формата.
     * @param {function} Cls - Класс экспортёра плагина.
     * @param {object} [meta] - Метаданные формата.
     * @returns {void}
     */
    register: function(fmt, Cls, meta) {
        _cap.format = fmt;
        _reg[String(fmt).toLowerCase()] = { Cls: Cls, meta: meta || {} };
    }
};

/**
 * Обрабатывает postMessage-команды от родительского окна (PluginManager):
 * 'sb-exec' выполняет произвольный код плагина внутри песочницы и возвращает
 * зарегистрированные им метаданные; 'sb-export' вызывает export() ранее
 * зарегистрированного экспортёра и возвращает результат (буфер файла).
 * @param {MessageEvent} e - Событие сообщения от родительского окна.
 * @returns {void}
 */
window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || !m._t) return;
    if (m._t === 'sb-exec') {
        _cap = {};
        try {
            (new Function(m.code))();
            e.source.postMessage({ _t: 'sb-ok', _id: m._id, c: _cap }, '*');
        } catch (err) {
            e.source.postMessage({ _t: 'sb-err', _id: m._id, e: err.message }, '*');
        }
    } else if (m._t === 'sb-export') {
        (async function() {
            try {
                const entry = _reg[String(m.fmt).toLowerCase()];
                if (!entry) throw new Error(`Format not registered in sandbox: ${m.fmt}`);
                const inst = new entry.Cls();
                const result = await inst.export(m.manga, m.chapters, m.cover);
                const buf = await result.blob.arrayBuffer();
                e.source.postMessage({
                    _t: 'sb-export-ok', _id: m._id, buf,
                    filename: result.filename, mimeType: result.mimeType
                }, '*', [buf]);
            } catch (ex) {
                e.source.postMessage({ _t: 'sb-err', _id: m._id, e: ex.message }, '*');
            }
        })();
    }
});
