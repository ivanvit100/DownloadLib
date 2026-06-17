/**
 * DownloadLib exporter module
 * Exports manga/ranobe as MOBI (Mobipocket 6) for Kindle devices.
 * Pure JavaScript, no WASM, no external libraries.
 * @module exporters/MOBIExporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[MOBIExporter] Loading...');

    class BufWriter {
        constructor() {
            this._chunks = [];
            this._len = 0;
        }

        /* istanbul ignore next */
        u8(v) {
            this._chunks.push(new Uint8Array([v & 0xFF]));
            this._len += 1;
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

    function toUTF8(str) { return _enc.encode(str); }

    function splitUTF8(bytes, maxBytes) {
        const chunks = [];
        let pos = 0;
        while (pos < bytes.length) {
            let end = Math.min(pos + maxBytes, bytes.length);
            while (end > pos && (bytes[end] & 0xC0) === 0x80) end -= 1;
            chunks.push(bytes.slice(pos, end));
            pos = end;
        }
        return chunks;
    }

    function buildEXTH(titleBytes, authorBytes, descBytes, subjectBytesArr, dateBytes) {
        const subjects = subjectBytesArr || [];
        const w = new BufWriter();

        w.bytes([0x45, 0x58, 0x54, 0x48]);
        const lenPos = w.length;
        w.be32(0);

        let count = 3;
        if (descBytes) count += 1;
        count += subjects.length;
        if (dateBytes) count += 1;
        w.be32(count);

        w.be32(100);
        w.be32(8 + authorBytes.length);
        w.bytes(authorBytes);

        if (descBytes) {
            w.be32(103);
            w.be32(8 + descBytes.length);
            w.bytes(descBytes);
        }

        for (const subBytes of subjects) {
            w.be32(105);
            w.be32(8 + subBytes.length);
            w.bytes(subBytes);
        }

        if (dateBytes) {
            w.be32(106);
            w.be32(8 + dateBytes.length);
            w.bytes(dateBytes);
        }

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

    function buildRecord0(
        titleBytes, authorBytes, descBytes, subjectBytesArr, dateBytes,
        textLen, textRecCount, firstImageRec, flisRec, fcisRec
    ) {
        const exth = buildEXTH(titleBytes, authorBytes, descBytes, subjectBytesArr, dateBytes);
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

        out[pos] = 0x42; pos += 1; out[pos] = 0x4F; pos += 1; out[pos] = 0x4F; pos += 1; out[pos] = 0x4B; pos += 1;
        out[pos] = 0x4D; pos += 1; out[pos] = 0x4F; pos += 1; out[pos] = 0x42; pos += 1; out[pos] = 0x49; pos += 1;
        out[pos] = 0x12; pos += 1; out[pos] = 0x34; pos += 1; out[pos] = 0x56; pos += 1; out[pos] = 0x78; pos += 1;

        pos += 4;

        out[pos] = (N >> 8) & 0xFF; pos += 1;
        out[pos] =  N       & 0xFF; pos += 1;

        for (let i = 0; i < N; i++) {
            const o = offsets[i];
            out[pos] = (o >>> 24) & 0xFF; pos += 1;
            out[pos] = (o >>> 16) & 0xFF; pos += 1;
            out[pos] = (o >>>  8) & 0xFF; pos += 1;
            out[pos] =  o         & 0xFF; pos += 1;
            out[pos] = 0;                 pos += 1;
            out[pos] = (i >> 16)  & 0xFF; pos += 1;
            out[pos] = (i >>  8)  & 0xFF; pos += 1;
            out[pos] =  i         & 0xFF; pos += 1;
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

    class MOBIExporter extends global.BaseExporter {
        createHTML(title, chapters, hasCover, imageList) {
            let html = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"'
                     + ' "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n'
                     + '<html><head>'
                     + '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>'
                     + `<title>${this.escapeXml(title)}</title>`
                     + '</head><body>\n';

            if (hasCover)
                html += '<div><img recindex="0001" alt="cover"/></div>\n';

            for (const chapter of chapters) {
                html += `<mbp:pagebreak/>\n<h2>${this.escapeXml(chapter.title)}</h2>\n`;
                if (!Array.isArray(chapter.content)) continue;

                for (const block of chapter.content) {
                    if (block.type === 'text' && block.text) {
                        for (const line of String(block.text).split('\n')) {
                            const t = line.trim();
                            html += t ? `<p>${this.escapeXml(t)}</p>\n` : '<p>&#160;</p>\n';
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

        export(manga, chapters, coverBase64) {
            const title  = manga.name || 'Без названия';
            const author = manga.authors.filter(Boolean).join(', ') || 'Неизвестно';

            const titleBytes      = toUTF8(title);
            const authorBytes     = toUTF8(author);
            const descBytes       = manga.summary ? toUTF8(manga.summary) : null;
            const genres          = [...(manga.genres || []), ...(manga.tags || [])];
            const subjectBytesArr = genres.map(g => toUTF8(g));
            const dateBytes       = manga.releaseDate ? toUTF8(String(manga.releaseDate)) : null;

            const imageList = [];

            if (coverBase64) {
                const b64 = coverBase64.includes(',') ? coverBase64.split(',')[1] : coverBase64;
                imageList.push({ base64: b64, contentType: 'image/jpeg' });
            }

            const html      = this.createHTML(title, chapters, !!coverBase64, imageList);
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
                titleBytes, authorBytes, descBytes, subjectBytesArr, dateBytes,
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
                filename: `${manga.name || 'manga'}.mobi`,
                mimeType: 'application/x-mobipocket-ebook'
            };
        }

        parse(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    try { resolve(this._parseMOBI(reader.result, file.name)); }
                    catch (e) { reject(e); }
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });
        }

        _parseMOBIRecordOffsets(view) {
            const numRecords = view.getUint16(76, false);
            const offsets = [];
            for (let i = 0; i < numRecords; i++)
                offsets.push(view.getUint32(78 + i * 8, false));
            return offsets;
        }

        _parseMOBIExth(bytes, view, dec, r0, buffer) {
            const authors = [], genres = [];
            let summary = '', releaseDate = '';
            const exthStart = r0 + 248;
            if (exthStart + 12 > buffer.byteLength) return { authors, summary, genres, releaseDate };
            if (dec.decode(bytes.slice(exthStart, exthStart + 4)) !== 'EXTH')
                return { authors, summary, genres, releaseDate };

            const exthLen   = view.getUint32(exthStart + 4, false);
            const exthCount = view.getUint32(exthStart + 8, false);
            let pos = exthStart + 12;
            for (let r = 0; r < exthCount && pos + 8 <= exthStart + exthLen; r++) {
                const recType = view.getUint32(pos, false);
                const recLen  = view.getUint32(pos + 4, false);
                if (recLen < 8 || pos + recLen > exthStart + exthLen) break;
                const data = dec.decode(bytes.slice(pos + 8, pos + recLen));
                pos += recLen;
                if (recType === 100)      authors.push(data);
                else if (recType === 103) summary = data;
                else if (recType === 105) genres.push(data);
                else if (recType === 106) releaseDate = data;
            }
            return { authors, summary, genres, releaseDate };
        }

        _parseMOBI(buffer, filename) {
            const bytes = new Uint8Array(buffer);
            const view  = new DataView(buffer);
            const dec   = new TextDecoder('utf-8', { fatal: false });

            const recordOffsets = this._parseMOBIRecordOffsets(view);
            const [r0] = recordOffsets;

            const textRecCount = view.getUint16(r0 + 8, false);

            if (dec.decode(bytes.slice(r0 + 16, r0 + 20)) !== 'MOBI')
                throw new Error('[MOBIExporter] Not a MOBI file');

            const fullNameOff   = view.getUint32(r0 + 84, false);
            const fullNameLen   = view.getUint32(r0 + 88, false);
            const firstImageRec = view.getUint32(r0 + 108, false);

            let title = filename ? filename.replace(/\.mobi$/i, '') : 'Unknown';
            if (fullNameLen > 0 && r0 + fullNameOff + fullNameLen <= buffer.byteLength)
                title = dec.decode(bytes.slice(r0 + fullNameOff, r0 + fullNameOff + fullNameLen));

            const { authors, summary, genres, releaseDate } =
                this._parseMOBIExth(bytes, view, dec, r0, buffer);

            const htmlParts = [];
            for (let i = 1; i <= textRecCount && i < recordOffsets.length; i++) {
                const start = recordOffsets[i];
                const end   = (i + 1 < recordOffsets.length) ? recordOffsets[i + 1] : buffer.byteLength;
                htmlParts.push(dec.decode(bytes.slice(start, end)));
            }
            const html = htmlParts.join('');

            let cover = '';
            if (firstImageRec !== 0xFFFFFFFF && firstImageRec < recordOffsets.length) {
                const iStart = recordOffsets[firstImageRec];
                const iEnd   = (firstImageRec + 1 < recordOffsets.length)
                    ? recordOffsets[firstImageRec + 1] : buffer.byteLength;
                cover = `data:image/jpeg;base64,${this._bytesToBase64(bytes.slice(iStart, iEnd))}`;
            }

            const chapters = this._parseMOBIHtml(
                html, firstImageRec, recordOffsets, bytes, buffer.byteLength
            );

            return {
                metadata: {
                    name: title, rus_name: title, authors, summary,
                    genres, tags: [], releaseDate, rating: ''
                },
                cover,
                chapters
            };
        }

        _parseMOBIHtml(html, firstImageRec, recordOffsets, bytes, bufferLen) {
            const parser = new DOMParser();
            const doc  = parser.parseFromString(html, 'text/html');
            const body = doc.querySelector('body');
            if (!body) return [];

            const chapters = [];
            let current = null;

            for (const node of Array.from(body.childNodes)) {
                const tag = node.tagName ? node.tagName.toLowerCase() : '';

                if (tag === 'h2') {
                    if (current) chapters.push(current);
                    const t = node.textContent.trim();
                    const vn = this._extractVolNum(t);
                    current = {
                        title: t,
                        content: [],
                        number: vn ? vn.number : String(chapters.length + 1),
                        volume: vn ? vn.volume : '1'
                    };
                } else if (current && (tag === 'p' || tag === 'div')) {
                    const img = node.querySelector('img[recindex]');
                    if (img) {
                        const recindex = parseInt(img.getAttribute('recindex') || '0', 10);
                        if (recindex >= 1 && firstImageRec !== 0xFFFFFFFF) {
                            const imageRecNum = firstImageRec + (recindex - 1);
                            if (imageRecNum < recordOffsets.length) {
                                const iStart = recordOffsets[imageRecNum];
                                const iEnd   = (imageRecNum + 1 < recordOffsets.length)
                                    ? recordOffsets[imageRecNum + 1] : bufferLen;
                                current.content.push({
                                    type: 'image',
                                    data: {
                                        base64: this._bytesToBase64(bytes.slice(iStart, iEnd)),
                                        contentType: 'image/jpeg'
                                    }
                                });
                            }
                        }
                    } else if (tag === 'p') {
                        const text = node.textContent.replace(/\xa0/g, ' ').trim();
                        if (text) current.content.push({ type: 'text', text });
                    }
                }
            }

            if (current) chapters.push(current);
            return chapters;
        }

        _extractVolNum(title) {
            const m = title.match(/Том\s+([^\s,]+)[,\s]+Глава\s+(\S+)/);
            if (m) return { volume: m[1], number: m[2] };
            const m2 = title.match(/Глава\s+(\S+)/);
            if (m2) return { volume: '1', number: m2[1] };
            return null;
        }

        _bytesToBase64(bytes) {
            let binary = '';
            const CHUNK = 0x8000;
            for (let i = 0; i < bytes.length; i += CHUNK)
                binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
            return btoa(binary);
        }
    }

    global.MOBIExporter = MOBIExporter;
    if (global.ExporterRegistry) global.ExporterRegistry.register('mobi', MOBIExporter, { label: 'MOBI' });
    console.log('[MOBIExporter] Loaded');
})(typeof window !== 'undefined' ? window : self);