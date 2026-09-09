'use strict';

let _cap = {};
const _reg = {};
const global = window;

global.BaseService = function(c) { this.config = c; this.name = c && c.name; };

global.BaseExporter = function() { this.format = 'unknown'; };

global.BaseExporter.prototype.escapeXml = function(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
};

global.BaseExporter.prototype.escapeHtml = function(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

global.BaseExporter.prototype.sanitizeText = function(t) {
    if (!t) return '';
    return String(t).trim();
};

global.ExporterRegistry = {
    register: function(fmt, Cls, meta) {
        _cap.format = fmt;
        _reg[String(fmt).toLowerCase()] = { Cls: Cls, meta: meta || {} };
    }
};

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
