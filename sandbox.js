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
