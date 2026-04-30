/**
 * DownloadLib exporter module
 * Dual-mode exporter (ZIP contains JPEG and TXT)
 * @module exporters/SimpleExporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.5
 */

'use strict';

(function(global) {
    console.log('[SimpleExporter] Loading...');

    class SimpleExporter {
        async export(manga, chapters, coverBase64) {
            const name = this.sanitize(manga.rus_name || manga.name || 'book');

            if (this.isRanobeLib(chapters))
                return this.exportTxt(name, manga, chapters);
            else
                return this.exportZip(name, chapters);
        }

        isRanobeLib(chapters) {
            for (const ch of chapters) {
                if (!Array.isArray(ch.content)) continue;
                for (const block of ch.content) {
                    if (block.type === 'text' && block.text && String(block.text).trim())
                        return true;
                }
            }
            return false;
        }

        exportTxt(name, manga, chapters) {
            const title  = manga.rus_name || manga.name || name;
            const author = this.resolveAuthor(manga.authors);
            const lines  = [];

            lines.push(title);
            if (author) lines.push(author);
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

        async exportZip(name, chapters) {
            if (typeof JSZip === 'undefined')
                throw new Error('[SimpleExporter] JSZip not loaded (include lib/jszip.min.js)');

            const zip = new JSZip();

            for (let ci = 0; ci < chapters.length; ci++) {
                const ch  = chapters[ci];
                const vol = ch.volume  != null ? ch.volume  : ci + 1;
                const num = ch.number  != null ? ch.number  : ci + 1;

                if (!Array.isArray(ch.content)) continue;

                let pageIdx = 0;

                for (const block of ch.content) {
                    if (block.type !== 'image') continue;
                    if (!block.data || !block.data.base64) continue;

                    pageIdx++;

                    const contentType = block.data.contentType || 'image/jpeg';
                    const ext         = this.mimeToExt(contentType);
                    const filename    = `${name}_volume_${vol}_chapter_${num}_page_${pageIdx}.${ext}`;

                    zip.file(filename, block.data.base64, { base64: true });
                }
            }

            const blob = await zip.generateAsync({
                type:        'blob',
                compression: 'STORE',
            });

            return { blob, filename: `${name}.zip`, mimeType: 'application/zip' };
        }

        mimeToExt(mime) {
            if (mime.includes('png'))  return 'png';
            if (mime.includes('webp')) return 'webp';
            if (mime.includes('gif'))  return 'gif';
            return 'jpg';
        }

        sanitize(str) {
            return String(str)
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
                .replace(/\s+/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '')
                .substring(0, 180) || 'book';
        }

        resolveAuthor(raw) {
            if (!raw) return '';
            if (Array.isArray(raw))
                return raw
                    .map(a => (typeof a === 'string' ? a : (a && a.name) || ''))
                    .filter(Boolean)
                    .join(', ');
            return String(raw);
        }
    }

    global.SimpleExporter = SimpleExporter;
    console.log('[SimpleExporter] Loaded');
})(typeof window !== 'undefined' ? window : self);