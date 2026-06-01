/**
 * DownloadLib exporter module
 * Dual-mode exporter (ZIP contains JPEG and TXT)
 * @module exporters/SimpleExporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[SimpleExporter] Loading...');

    class SimpleExporter extends global.BaseExporter {
        async export(manga, chapters) {
            const name = this.sanitize(manga.name || 'manga');

            if (this.isRanobeLib(chapters))
                return this.exportTxt(name, manga, chapters);
            return await this.exportZip(name, chapters);
        }

        isRanobeLib(chapters) {
            for (const ch of chapters) {
                if (!Array.isArray(ch.content)) continue;
                for (const block of ch.content) {
                    if (block.type === 'text' && block.text && this.sanitizeText(block.text))
                        return true;
                }
            }
            return false;
        }

        exportTxt(name, manga, chapters) {
            const title  = manga.name || 'Без названия';
            const author = manga.authors.filter(Boolean).join(', ');
            const lines  = [];

            lines.push(title);
            if (author) lines.push(author);
            if (manga.releaseDate) lines.push(`Год выхода: ${manga.releaseDate}`);
            if (manga.rating) lines.push(`Возрастное ограничение: ${manga.rating}`);
            const genres = manga.genres || [];
            if (genres.length) lines.push(`Жанры: ${genres.join(', ')}`);
            if (manga.summary) lines.push(manga.summary);
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
            if (typeof global.JSZip === 'undefined')
                throw new Error('[SimpleExporter] JSZip not loaded (include lib/jszip.min.js)');

            const zip = new global.JSZip();

            for (let ci = 0; ci < chapters.length; ci++) {
                const ch  = chapters[ci];
                const vol = ch.volume  != null ? ch.volume  : ci + 1;
                const num = ch.number  != null ? ch.number  : ci + 1;

                if (!Array.isArray(ch.content)) continue;

                let pageIdx = 0;

                for (const block of ch.content) {
                    if (block.type !== 'image') continue;
                    if (!block.data || !block.data.base64) continue;

                    pageIdx += 1;

                    const contentType = block.data.contentType || 'image/jpeg';
                    const ext         = this.mimeToExt(contentType);
                    const filename    = `${name}_volume_${vol}_chapter_${num}_page_${pageIdx}.${ext}`;

                    zip.file(filename, block.data.base64, { base64: true });
                }
            }

            const blob = await zip.generateAsync({
                type:        'blob',
                compression: 'STORE'
            });

            return { blob, filename: `${name}.zip`, mimeType: 'application/zip' };
        }

        parse(file) {
            if (file.name && file.name.toLowerCase().endsWith('.zip'))
                return this.parseZip(file);
            return this.parseTxt(file);
        }

        async parseTxt(file) {
            const text = await this._readText(file);
            const lines = text.split('\n');

            let headerDone = false;
            const headerLines = [];
            const chapters = [];
            let current = null;
            let chapterIdx = 0;

            for (const line of lines) {
                const trimmed = line.trimEnd();
                const m = trimmed.match(/^=== Глава \d+: (.*) ===$/);
                if (m) {
                    headerDone = true;
                    if (current) chapters.push(current);
                    chapterIdx += 1;
                    const title = m[1].trim();
                    const vn = this._extractVolNum(title);
                    current = {
                        title,
                        content: [],
                        number: vn ? vn.number : String(chapterIdx),
                        volume: vn ? vn.volume : '1'
                    };
                } else if (!headerDone)
                    headerLines.push(trimmed);
                else if (current && trimmed) {
                    const last = current.content[current.content.length - 1];
                    if (last && last.type === 'text')
                        last.text += `\n${trimmed}`;
                    else
                        current.content.push({ type: 'text', text: trimmed });
                }
            }
            if (current) chapters.push(current);

            const name = headerLines[0] || (file.name ? file.name.replace(/\.txt$/i, '') : 'Unknown');
            const author = headerLines[1] &&
                !headerLines[1].startsWith('Год') &&
                !headerLines[1].startsWith('Жанры') &&
                !headerLines[1].startsWith('Возраст') &&
                !headerLines[1].startsWith('─') ? headerLines[1] : '';
            const authors = author ? [author] : [];

            return {
                metadata: {
                    name, rus_name: name, authors, summary: '',
                    genres: [], tags: [], releaseDate: '', rating: ''
                },
                cover: '',
                chapters
            };
        }

        async parseZip(file) {
            if (typeof global.JSZip === 'undefined')
                throw new Error('[SimpleExporter] JSZip not loaded');

            const zip = new global.JSZip();
            const zipContent = await zip.loadAsync(file);

            const imageFiles = Object.keys(zipContent.files)
                .filter(f => f.match(/\.(jpe?g|png|webp|gif)$/i))
                .sort();

            const chaptersMap = new Map();
            for (const filename of imageFiles) {
                const m = /_volume_(.+?)_chapter_(.+?)_page_/.exec(filename);
                const key = m ? `v${m[1]}_ch${m[2]}` : 'v1_ch1';
                if (!chaptersMap.has(key))
                    chaptersMap.set(key, { volume: m ? m[1] : '1', number: m ? m[2] : '1', images: [] });
                chaptersMap.get(key).images.push(filename);
            }

            const chapters = [];
            for (const [, info] of chaptersMap) {
                const content = [];
                for (const imgFilename of info.images) {
                    const imgFile = zipContent.file(imgFilename);
                    if (!imgFile) continue;
                    const blob = await imgFile.async('blob');
                    const base64url = await this._blobToBase64(blob);
                    const [, b64] = base64url.split(',');
                    content.push({ type: 'image', data: { base64: b64, contentType: blob.type || 'image/jpeg' } });
                }

                if (content.length > 0) {
                    chapters.push({
                        title: `Том ${info.volume}, Глава ${info.number}`,
                        content,
                        number: info.number,
                        volume: info.volume
                    });
                }
            }

            const name = file.name ? file.name.replace(/\.zip$/i, '') : 'Unknown';
            return {
                metadata: { name, rus_name: name, authors: [], summary: '', genres: [], tags: [] },
                cover: '',
                chapters
            };
        }

        _extractVolNum(title) {
            const m = title.match(/Том\s+([^\s,]+)[,\s]+Глава\s+(\S+)/);
            if (m) return { volume: m[1], number: m[2] };
            const m2 = title.match(/Глава\s+(\S+)/);
            if (m2) return { volume: '1', number: m2[1] };
            return null;
        }

        _readText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsText(file, 'utf-8');
            });
        }

        _blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        mimeToExt(mime) {
            if (mime.includes('png'))  return 'png';
            if (mime.includes('webp')) return 'webp';
            if (mime.includes('gif'))  return 'gif';
            return 'jpg';
        }

        sanitize(str) {
            return String(str)
                .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') // eslint-disable-line no-control-regex
                .replace(/\s+/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_|_$/g, '')
                .substring(0, 180) || 'manga';
        }
    }

    global.SimpleExporter = SimpleExporter;
    if (global.ExporterRegistry) global.ExporterRegistry.register('simple', SimpleExporter, { label: 'TXT/JPEG' });
    console.log('[SimpleExporter] Loaded');
})(typeof window !== 'undefined' ? window : self);