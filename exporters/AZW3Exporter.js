/**
 * DownloadLib exporter module
 * Exports manga/ranobe as AZW3 (KF8) using a WASM binary writer.
 * @module exporters/AZW3Exporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.5
 */

'use strict';

(function(global) {
    console.log('[AZW3Exporter] Loading...');

    let _wasmExports = null;
    let _wasmMemory  = null;

    async function _loadWasm() {
        if (_wasmExports) return _wasmExports;

        const api = typeof global.getExtensionApi === 'function'
            ? global.getExtensionApi()
            : ((typeof browser !== 'undefined' && browser) ||
               (typeof chrome  !== 'undefined' && chrome)  || null);

        const getURL = api && api.runtime && api.runtime.getURL
            ? (p) => api.runtime.getURL(p)
            : (p) => p;

        const response = await fetch(getURL('lib/kf8.wasm'));
        if (!response.ok)
            throw new Error(`[AZW3Exporter] Failed to fetch kf8.wasm: ${response.status}`);

        const bytes = await response.arrayBuffer();

        const { instance } = await WebAssembly.instantiate(bytes, {
            env: {
                abort(msg, file, line, col) {
                    console.error(`[kf8.wasm] abort at ${line}:${col}`);
                }
            }
        });

        _wasmExports = instance.exports;
        _wasmMemory  = _wasmExports.memory;
        console.log('[AZW3Exporter] WASM loaded');
        return _wasmExports;
    }

    function _writeUTF8(ex, str) {
        const bytes = new TextEncoder().encode(str);
        const ptr   = ex.alloc(bytes.length || 1);
        new Uint8Array(_wasmMemory.buffer).set(bytes, ptr);
        return { ptr, len: bytes.length };
    }

    function _writeBase64(ex, b64) {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const ptr = ex.alloc(arr.length || 1);
        if (arr.length) new Uint8Array(_wasmMemory.buffer).set(arr, ptr);
        return { ptr, len: arr.length };
    }

    function _resolveAuthor(raw) {
        if (!raw) return 'Неизвестно';
        if (Array.isArray(raw))
            return raw.map(a => (typeof a === 'string' ? a : (a && a.name) || ''))
                      .filter(Boolean).join(', ') || 'Неизвестно';
        return String(raw) || 'Неизвестно';
    }

    function _buildHTML(title, chapters, coverBase64, imageStore) {
        const esc = s => String(s || '')
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');

        let html = '<?xml version="1.0" encoding="utf-8"?>\n'
                 + `<html><head><meta charset="utf-8"/><title>${esc(title)}</title></head><body>\n`;

        if (coverBase64) {
            const b64 = coverBase64.includes(',') ? coverBase64.split(',')[1] : coverBase64;
            imageStore.push({ base64: b64, contentType: 'image/jpeg' });
            html += '<div><img src="kindle:embed:0001?mime=image/jpeg" alt="cover"/></div>\n';
        }

        for (const chapter of chapters) {
            html += `<mbp:pagebreak/>\n<h2>${esc(chapter.title)}</h2>\n`;
            if (!Array.isArray(chapter.content)) continue;

            for (const block of chapter.content) {
                if (block.type === 'text' && block.text) {
                    for (const line of String(block.text).split('\n')) {
                        const t = line.trim();
                        html += t ? `<p>${esc(t)}</p>\n` : '<p>&#160;</p>\n';
                    }
                } else if (block.type === 'image' && block.data && block.data.base64) {
                    const mime = block.data.contentType || 'image/jpeg';
                    imageStore.push({ base64: block.data.base64, contentType: mime });
                    const recIdx = String(imageStore.length).padStart(4, '0');
                    html += `<div><img src="kindle:embed:${recIdx}?mime=${esc(mime)}" alt=""/></div>\n`;
                }
            }
        }

        return html + '</body></html>';
    }

    class AZW3Exporter {
        async export(manga, chapters, coverBase64) {
            const ex     = await _loadWasm();
            const title  = manga.rus_name || manga.name || 'Книга';
            const author = _resolveAuthor(manga.authors);

            const imageStore = [];
            const html       = _buildHTML(title, chapters, coverBase64, imageStore);

            ex.reset();

            const tBuf = _writeUTF8(ex, title);
            const aBuf = _writeUTF8(ex, author);
            ex.setTitle (tBuf.ptr, tBuf.len);
            ex.setAuthor(aBuf.ptr, aBuf.len);

            const hBuf = _writeUTF8(ex, html);
            ex.setHtml(hBuf.ptr, hBuf.len);

            for (const img of imageStore) {
                const iBuf = _writeBase64(ex, img.base64);
                ex.addImage(iBuf.ptr, iBuf.len);
            }

            const outPtr = ex.build();
            const outLen = ex.getResultLen();
            if (!outLen) throw new Error('[AZW3Exporter] WASM returned empty result');

            const bytes = new Uint8Array(_wasmMemory.buffer, outPtr, outLen).slice();
            ex.reset();
            ex.__collect();

            return {
                blob:     new Blob([bytes], { type: 'application/x-mobipocket-ebook' }),
                filename: `${title}.azw3`,
                mimeType: 'application/x-mobipocket-ebook'
            };
        }
    }

    global.AZW3Exporter = AZW3Exporter;
    console.log('[AZW3Exporter] Loaded');
})(typeof window !== 'undefined' ? window : self);
