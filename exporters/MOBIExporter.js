/**
 * DownloadLib exporter module
 * Exports manga/ranobe as MOBI (Mobipocket 6) for Kindle devices.
 * Pure JavaScript, no WASM, no external libraries.
 * @module exporters/MOBIExporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.5
 */

'use strict';

(function(global) {
    console.log('[MOBIExporter] Loading...');

    class BufWriter {
        constructor() {
            this._chunks = [];
            this._len = 0;
        }

        u8(v) {
            this._chunks.push(new Uint8Array([v & 0xFF]));
            this._len++;
        }

        be16(v) {
            const b = new Uint8Array(2);
            b[0] = (v >> 8) & 0xFF;
            b[1] =  v       & 0xFF;
            this._chunks.push(b);
            this._len += 2;
        }

        be32(v) {
            const b = new Uint8Array(4);
            b[0] = (v >>> 24) & 0xFF;
            b[1] = (v >>> 16) & 0xFF;
            b[2] = (v >>>  8) & 0xFF;
            b[3] =  v         & 0xFF;
            this._chunks.push(b);
            this._len += 4;
        }

        bytes(arr) {
            const u = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
            this._chunks.push(u);
            this._len += u.length;
        }

        zeros(n) {
            this._chunks.push(new Uint8Array(n));
            this._len += n;
        }

        pad4() {
            const r = this._len & 3;
            if (r) this.zeros(4 - r);
        }

        get length() { return this._len; }

        toUint8Array() {
            const out = new Uint8Array(this._len);
            let off = 0;
            for (const c of this._chunks) { out.set(c, off); off += c.length; }
            return out;
        }

        patch32(off, v) {
            const out = this.toUint8Array();
            out[off  ] = (v >>> 24) & 0xFF;
            out[off+1] = (v >>> 16) & 0xFF;
            out[off+2] = (v >>>  8) & 0xFF;
            out[off+3] =  v         & 0xFF;
            this._chunks = [out];
            this._len = out.length;
            return off;
        }
    }

    const _enc = new TextEncoder();
    const _dec = new TextDecoder('utf-8');

    function toUTF8(str) { return _enc.encode(str); }

    function splitUTF8(bytes, maxBytes) {
        const chunks = [];
        let pos = 0;
        while (pos < bytes.length) {
            let end = Math.min(pos + maxBytes, bytes.length);
            // Walk back to start of a UTF-8 char if we're in the middle of one
            while (end > pos && (bytes[end] & 0xC0) === 0x80) end--;
            chunks.push(bytes.slice(pos, end));
            pos = end;
        }
        return chunks;
    }

    function escapeHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function buildHTML(title, chapters, hasCover, imageList) {
        let html = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"'
                 + ' "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n'
                 + '<html><head>'
                 + '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>'
                 + `<title>${escapeHtml(title)}</title>`
                 + '</head><body>\n';

        if (hasCover)
            html += '<div><img recindex="0001" alt="cover"/></div>\n';

        for (const chapter of chapters) {
            html += `<mbp:pagebreak/>\n<h2>${escapeHtml(chapter.title)}</h2>\n`;
            if (!Array.isArray(chapter.content)) continue;

            for (const block of chapter.content) {
                if (block.type === 'text' && block.text) {
                    for (const line of String(block.text).split('\n')) {
                        const t = line.trim();
                        html += t ? `<p>${escapeHtml(t)}</p>\n` : '<p>&#160;</p>\n';
                    }
                } else if (block.type === 'image' && block.data && block.data.base64) {
                    const mime = block.data.contentType || 'image/jpeg';
                    imageList.push({ base64: block.data.base64, contentType: mime });
                    const idx = String(imageList.length).padStart(4, '0');
                    html += `<div><img recindex="${idx}" alt=""/></div>\n`;
                }
            }
        }

        html += '</body></html>';
        return html;
    }

    function buildEXTH(titleBytes, authorBytes) {
        const w = new BufWriter();

        w.bytes([0x45, 0x58, 0x54, 0x48]);
        const lenPos = w.length;
        w.be32(0);
        w.be32(3);

        w.be32(100);
        w.be32(8 + authorBytes.length);
        w.bytes(authorBytes);

        w.be32(503);
        w.be32(8 + titleBytes.length);
        w.bytes(titleBytes);

        w.be32(524);
        w.be32(10);
        w.bytes([0x72, 0x75]);

        w.pad4();
        w.patch32(lenPos, w.length);
        return w.toUint8Array();
    }

    function buildRecord0(titleBytes, authorBytes, textLen, textRecCount, firstImageRec, flisRec, fcisRec) {
        const exth = buildEXTH(titleBytes, authorBytes);
        const MOBI_LEN = 232;
        const fullNameOff = 16 + MOBI_LEN + exth.length;

        const w = new BufWriter();

        w.be16(1);
        w.be16(0);
        w.be32(textLen);
        w.be16(textRecCount);
        w.be16(4096);
        w.be32(0);
        
        w.bytes([0x4D, 0x4F, 0x42, 0x49]);
        w.be32(MOBI_LEN);
        w.be32(2);
        w.be32(65001);
        w.be32(0xABCD1234);
        w.be32(6);
        for (let i = 0; i < 10; i++) w.be32(0xFFFFFFFF); 
        w.be32(textRecCount + 1);
        w.be32(fullNameOff);
        w.be32(titleBytes.length);
        w.be32(0x0419);
        w.be32(0);
        w.be32(0);
        w.be32(6);
        w.be32(firstImageRec);
        w.zeros(16);
        w.be32(0x40);
        w.zeros(12);
        w.be32(0xFFFFFFFF);
        w.zeros(12);
        w.zeros(8);
        w.be16(1);
        w.be16(textRecCount);
        w.be32(1);
        w.be32(flisRec);
        w.be32(1);
        w.be32(fcisRec);
        w.be32(1);
        w.zeros(8);
        w.be32(0);
        w.be32(0xFFFFFFFF);
        w.zeros(36);
        w.be32(0xFFFFFFFF);

        w.bytes(exth);

        w.bytes(titleBytes);
        w.pad4();

        return w.toUint8Array();
    }

    function buildFLIS() {
        const w = new BufWriter();
        w.bytes([0x46, 0x4C, 0x49, 0x53]);
        w.be32(8); w.be16(65); w.be16(0);
        w.be32(0); w.be32(0xFFFFFFFF);
        w.be16(1); w.be16(3); w.be32(3); w.be32(1); w.be32(3);
        return w.toUint8Array();
    }

    function buildFCIS(textLen) {
        const w = new BufWriter();
        w.bytes([0x46, 0x43, 0x49, 0x53]);
        w.be32(20); w.be32(16); w.be32(1);
        w.be32(textLen);
        w.be32(0); w.be32(32); w.be32(8);
        w.be32(0xFFFFFFFF);
        w.be16(1); w.be16(1); w.be32(8);
        return w.toUint8Array();
    }

    function buildPalmDB(titleBytes, records) {
        const N = records.length;
        const HEADER = 78;
        const ENTRY  = 8;
        const dataStart = HEADER + N * ENTRY + 2;

        const offsets = [];
        let cursor = dataStart;
        for (const rec of records) {
            offsets.push(cursor);
            cursor += rec.length;
        }

        const total = cursor;
        const out = new Uint8Array(total);
        let pos = 0;

        const nameRaw = titleBytes.slice(0, 31);
        out.set(nameRaw, pos); pos += 32;

        pos += 4;
        pos += 16;
        pos += 8;

        out[pos++] = 0x42; out[pos++] = 0x4F; out[pos++] = 0x4F; out[pos++] = 0x4B;
        out[pos++] = 0x4D; out[pos++] = 0x4F; out[pos++] = 0x42; out[pos++] = 0x49;
        out[pos++] = 0x12; out[pos++] = 0x34; out[pos++] = 0x56; out[pos++] = 0x78;

        pos += 4;

        out[pos++] = (N >> 8) & 0xFF;
        out[pos++] =  N       & 0xFF;

        for (let i = 0; i < N; i++) {
            const o = offsets[i];
            out[pos++] = (o >>> 24) & 0xFF;
            out[pos++] = (o >>> 16) & 0xFF;
            out[pos++] = (o >>>  8) & 0xFF;
            out[pos++] =  o         & 0xFF;
            out[pos++] = 0;
            out[pos++] = (i >> 16) & 0xFF;
            out[pos++] = (i >>  8) & 0xFF;
            out[pos++] =  i        & 0xFF;
        }

        pos += 2;

        for (const rec of records) {
            out.set(rec, pos);
            pos += rec.length;
        }

        return out;
    }

    function b64toBytes(b64) {
        const bin = atob(b64.replace(/\s/g, ''));
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
    }

    function resolveAuthor(raw) {
        if (!raw) return 'Unknown';
        if (Array.isArray(raw))
            return raw.map(a => (typeof a === 'string' ? a : (a && a.name) || '')).filter(Boolean).join(', ') || 'Unknown';
        return String(raw) || 'Unknown';
    }

    class MOBIExporter {
        async export(manga, chapters, coverBase64) {
            const title  = manga.rus_name || manga.name || 'Книга';
            const author = resolveAuthor(manga.authors);

            const titleBytes  = toUTF8(title);
            const authorBytes = toUTF8(author);

            const imageList = [];

            if (coverBase64) {
                const b64 = coverBase64.includes(',') ? coverBase64.split(',')[1] : coverBase64;
                imageList.push({ base64: b64, contentType: 'image/jpeg' });
            }

            const html      = buildHTML(title, chapters, !!coverBase64, imageList);
            const htmlBytes = toUTF8(html);
            const textLen   = htmlBytes.length;

            const MAX_RECORD = 4096;
            const textChunks = splitUTF8(htmlBytes, MAX_RECORD);
            const T = textChunks.length;
            const I = imageList.length;

            const firstImageRec = I > 0 ? T + 1 : 0xFFFFFFFF;
            const flisRec       = T + I + 1;
            const fcisRec       = T + I + 2;

            const records = [];

            records.push(buildRecord0(
                titleBytes, authorBytes,
                textLen, T,
                firstImageRec, flisRec, fcisRec
            ));

            for (const chunk of textChunks) records.push(chunk);
            for (const img of imageList) records.push(b64toBytes(img.base64));

            records.push(buildFLIS());
            records.push(buildFCIS(textLen));
            records.push(new Uint8Array([0xe9, 0x8e, 0x0d, 0x0a]));

            const palmdb = buildPalmDB(titleBytes, records);
            const blob = new Blob([palmdb], { type: 'application/x-mobipocket-ebook' });

            return {
                blob,
                filename: `${title}.mobi`,
                mimeType: 'application/x-mobipocket-ebook'
            };
        }
    }

    global.MOBIExporter = MOBIExporter;
    console.log('[MOBIExporter] Loaded');
})(typeof window !== 'undefined' ? window : self);