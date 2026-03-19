/**
 * DownloadLib exporter module
 * Module to export manga as PDF files
 * @module exporters/PDFExporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.2
 */

'use strict';

(function(global) {
    console.log('[PDFExporter] Loading...');

    class PDFExporter {
        sanitizeFilename(filename) {
            return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
        }

        renderTextToCanvas(text, titleText = null) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const width = 1240;
            const height = 1754;
            canvas.width = width;
            canvas.height = height;

            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = 'black';
            ctx.textBaseline = 'top';

            const margin = 80;
            const maxX = width - 2 * margin;
            const maxY = height - margin;
            let y = margin;

            if (titleText) {
                ctx.font = 'bold 48px Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(titleText, width / 2, y, maxX);
                y += 100;
                ctx.textAlign = 'left';
            }

            ctx.font = '28px Arial, sans-serif';
            const lineHeight = 40;
            const emptyLineHeight = lineHeight * 0.5;
            const lines = text.split('\n');

            for (const line of lines) {
                if (!line.trim()) {
                    y += emptyLineHeight;
                    continue;
                }

                if (y + lineHeight > maxY) break;

                ctx.fillText(line, margin, y);
                y += lineHeight;
            }

            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            canvas.width = 1;
            canvas.height = 1;
            return dataUrl;
        }

        splitTextIntoPages(text, firstPageTitle = null) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const width = 1240;
            const height = 1754;
            const margin = 80;
            const maxX = width - 2 * margin;
            const maxHeight = height - 2 * margin;
            const lineHeight = 40;
            const emptyLineHeight = lineHeight * 0.5;

            canvas.width = width;
            canvas.height = height;
            ctx.font = '28px Arial, sans-serif';

            const titleReserve = firstPageTitle ? 100 : 0;
            const allLines = [];
            const paragraphs = text.split('\n');

            for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
                const paragraph = paragraphs[pIdx].trim();

                if (!paragraph) {
                    allLines.push('');
                    continue;
                }

                const words = paragraph.split(/\s+/);
                let line = '';

                for (const word of words) {
                    const testLine = line + word + ' ';
                    const metrics = ctx.measureText(testLine);

                    if (metrics.width > maxX && line !== '') {
                        allLines.push(line.trim());
                        line = word + ' ';
                    } else {
                        line = testLine;
                    }
                }

                /* istanbul ignore next */
                if (line.trim()) allLines.push(line.trim());
                if (pIdx < paragraphs.length - 1) allLines.push('');
            }

            const pages = [];
            let currentPageLines = [];
            let currentHeight = titleReserve;

            for (let i = 0; i < allLines.length; i++) {
                const line = allLines[i];
                const lineH = line === '' ? emptyLineHeight : lineHeight;

                if (currentHeight + lineH > maxHeight && currentPageLines.length > 0) {
                    while (currentPageLines.length > 0 && currentPageLines[currentPageLines.length - 1] === '')
                        currentPageLines.pop();
                    /* istanbul ignore next */
                    if (currentPageLines.length > 0)
                        pages.push(currentPageLines.join('\n'));
                    currentPageLines = [];
                    currentHeight = 0;

                    if (line === '') continue;
                }

                currentPageLines.push(line);
                currentHeight += lineH;
            }

            while (currentPageLines.length > 0 && currentPageLines[currentPageLines.length - 1] === '')
                currentPageLines.pop();
            pages.push(currentPageLines.join('\n'));

            canvas.width = 1;
            canvas.height = 1;

            return pages;
        }

        async ensureDataUrl(input) {
            if (!input) return null;
            if (typeof input === 'string' && /^data:[\w+/.-]+;base64,/.test(input)) return input;
            if (typeof input === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(input) && input.length > 100)
                return 'data:image/jpeg;base64,' + input.replace(/\s+/g, '');
            return null;
        }

        async delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        async export(manga, chapters, coverBase64) {
            if (typeof html2pdf === 'undefined')
                throw new Error('html2pdf library not loaded');

            const worker = html2pdf();
            const pdf = await new Promise((resolve) => {
                worker.set({}).from(document.createElement('div')).toPdf().get('pdf').then(resolve);
            });

            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            let pageCount = 0;
            let isFirst = true;

            const ensurePageForNextContent = () => {
                if (isFirst) {
                    isFirst = false;
                    return;
                }
                pdf.addPage();
            };

            if (coverBase64) {
                const coverDataUrl = await this.ensureDataUrl(coverBase64);
                if (coverDataUrl) {
                    ensurePageForNextContent();

                    const img = new Image();
                    img.src = coverDataUrl;
                    await new Promise((resolve) => {
                        img.onload = resolve;
                        img.onerror = resolve;
                    });

                    const imgRatio = img.width / img.height;
                    const maxW = pageWidth - 20;
                    const maxH = pageHeight - 20;
                    let w = maxW;
                    let h = w / imgRatio;
                    if (h > maxH) {
                        h = maxH;
                        w = h * imgRatio;
                    }
                    pdf.addImage(coverDataUrl, 'JPEG', (pageWidth - w) / 2, (pageHeight - h) / 2, w, h);
                    pageCount++;

                    img.src = '';
                } else console.warn('[PDFExporter] Invalid cover image data, skipping cover page');
            } 

            for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
                const ch = chapters[chIdx];
                let chapterText = '';
                const chapterImages = [];

                if (Array.isArray(ch.content)) {
                    for (const block of ch.content) {
                        if (block.type === 'text' && block.text) {
                            const text = String(block.text).replace(/<[^>]+>/g, '').trim();
                            if (text)
                                chapterText += (chapterText ? '\n' : '') + text;
                            else console.warn('[PDFExporter] Skipping empty text block in chapter content');
                        } else if (block.type === 'image' && block.data && block.data.base64) {
                            chapterImages.push(block);
                        } else console.warn(`[PDFExporter] Unsupported block type in chapter content: ${block.type}`);
                    }
                } else console.warn('[PDFExporter] Chapter content is not an array, skipping chapter content processing');

                if (chapterText) {
                    const chapterTitle = ch.title || `Глава ${chIdx + 1}`;
                    const textPages = this.splitTextIntoPages(chapterText, chapterTitle);
                    
                    for (let i = 0; i < textPages.length; i++) {
                        ensurePageForNextContent();
                        
                        const titleForPage = i === 0 ? chapterTitle : null;
                        const textCanvas = this.renderTextToCanvas(textPages[i], titleForPage);
                        pdf.addImage(textCanvas, 'JPEG', 0, 0, pageWidth, pageHeight);
                        pageCount++;

                        if (pageCount % 10 === 0)
                            await this.delay(50);
                        else console.log(`[PDFExporter] Added text page ${pageCount} for chapter ${chIdx + 1}`);
                    }
                }

                for (const imageBlock of chapterImages) {
                    ensurePageForNextContent();
                    
                    const contentType = imageBlock.data.contentType || 'image/jpeg';
                    const dataUrl = `data:${contentType};base64,${imageBlock.data.base64}`;
                    const img = new Image();
                    img.src = dataUrl;
                    await new Promise((resolve) => {
                        img.onload = resolve;
                        img.onerror = resolve;
                    });

                    const imgRatio = img.width / img.height;
                    const maxW = pageWidth - 20;
                    const maxH = pageHeight - 20;
                    let w = maxW;
                    let h = w / imgRatio;
                    if (h > maxH) {
                        h = maxH;
                        w = h * imgRatio;
                    } else console.warn('[PDFExporter] Image fits within page without resizing');
                    pdf.addImage(dataUrl, 'JPEG', (pageWidth - w) / 2, (pageHeight - h) / 2, w, h);
                    pageCount++;

                    img.src = '';

                    if (pageCount % 5 === 0) await this.delay(50);
                    else console.log(`[PDFExporter] Added image page ${pageCount} for chapter ${chIdx + 1}`);
                }

                await this.delay(100);
            }

            const blob = pdf.output('blob');
            const title = manga.rus_name || manga.name || 'manga';
            const filename = this.sanitizeFilename(`${title}.pdf`);

            return {
                blob,
                filename,
                mimeType: 'application/pdf'
            };
        }
    }

    global.PDFExporter = PDFExporter;
    console.log('[PDFExporter] Loaded');
})(typeof window !== 'undefined' ? window : self);