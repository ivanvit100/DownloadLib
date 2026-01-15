/**
 * DownloadLib exporter module
 * Module to export manga as PDF files
 * @module exporters/PDFExporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.0
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
            const maxWidth = width - 2 * margin;
            const maxHeight = height - 2 * margin;
            let y = margin;

            if (titleText) {
                ctx.font = 'bold 48px Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(titleText, width / 2, y, maxWidth);
                y += 100;
                ctx.textAlign = 'left';
            }

            ctx.font = '28px Arial, sans-serif';
            const lineHeight = 40;
            const paragraphs = text.split('\n');
            
            for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
                const paragraph = paragraphs[pIdx].trim();
                
                if (!paragraph) {
                    y += lineHeight * 0.5;
                    continue;
                }

                const words = paragraph.split(/\s+/);
                let line = '';

                for (const word of words) {
                    const testLine = line + word + ' ';
                    const metrics = ctx.measureText(testLine);

                    if (metrics.width > maxWidth && line !== '') {
                        if (y + lineHeight > margin + maxHeight) break;
                        ctx.fillText(line.trim(), margin, y);
                        line = word + ' ';
                        y += lineHeight;
                    } else {
                        line = testLine;
                    }
                }

                if (line.trim() && y + lineHeight <= margin + maxHeight) {
                    ctx.fillText(line.trim(), margin, y);
                    y += lineHeight;
                }

                if (pIdx < paragraphs.length - 1)
                    y += lineHeight * 0.3;
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
            const maxWidth = width - 2 * margin;
            const maxHeight = height - 2 * margin;
            const lineHeight = 40;

            ctx.font = '28px Arial, sans-serif';

            let availableHeight = maxHeight;
            let isFirstPage = true;
            
            if (firstPageTitle)
                availableHeight -= 100;

            const pages = [];
            const paragraphs = text.split('\n');
            
            let currentPageLines = [];
            let currentHeight = 0;
            let maxLinesForPage = Math.floor(availableHeight / lineHeight);

            for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
                const paragraph = paragraphs[pIdx].trim();
                
                if (!paragraph) {
                    if (currentHeight + lineHeight * 0.5 <= maxLinesForPage * lineHeight) {
                        currentPageLines.push('');
                        currentHeight += lineHeight * 0.5;
                    }
                    continue;
                }

                const words = paragraph.split(/\s+/);
                let line = '';
                const paragraphLines = [];

                for (const word of words) {
                    const testLine = line + word + ' ';
                    const metrics = ctx.measureText(testLine);

                    if (metrics.width > maxWidth && line !== '') {
                        paragraphLines.push(line.trim());
                        line = word + ' ';
                    } else {
                        line = testLine;
                    }
                }

                if (line.trim())
                    paragraphLines.push(line.trim());

                const paragraphHeight = paragraphLines.length * lineHeight + 
                    (pIdx < paragraphs.length - 1 ? lineHeight * 0.3 : 0);
                
                if (currentHeight + paragraphHeight > maxLinesForPage * lineHeight && currentPageLines.length > 0) {
                    pages.push(currentPageLines.join('\n'));
                    currentPageLines = [];
                    currentHeight = 0;
                    
                    if (isFirstPage) {
                        isFirstPage = false;
                        availableHeight = maxHeight;
                        maxLinesForPage = Math.floor(availableHeight / lineHeight);
                    }
                }

                currentPageLines.push(...paragraphLines);
                currentHeight += paragraphLines.length * lineHeight;

                if (pIdx < paragraphs.length - 1) {
                    currentPageLines.push('');
                    currentHeight += lineHeight * 0.3;
                }
            }

            if (currentPageLines.length > 0)
                pages.push(currentPageLines.join('\n'));

            canvas.width = 1;
            canvas.height = 1;
            
            return pages.length > 0 ? pages : [text];
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

            if (coverBase64) {
                const coverDataUrl = await this.ensureDataUrl(coverBase64);
                if (coverDataUrl) {
                    if (!isFirst) pdf.addPage();
                    isFirst = false;

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
                }
            }

            for (let chIdx = 0; chIdx < chapters.length; chIdx++) {
                const ch = chapters[chIdx];
                let chapterText = '';
                const chapterImages = [];

                if (Array.isArray(ch.content)) {
                    for (const block of ch.content) {
                        if (block.type === 'text' && block.text) {
                            const text = String(block.text || '').replace(/<[^>]+>/g, '').trim();
                            if (text) {
                                chapterText += (chapterText ? '\n' : '') + text;
                            }
                        } else if (block.type === 'image' && block.data && block.data.base64) {
                            chapterImages.push(block);
                        }
                    }
                }

                if (chapterText) {
                    const chapterTitle = ch.title || `Глава ${chIdx + 1}`;
                    const textPages = this.splitTextIntoPages(chapterText, chapterTitle);
                    
                    for (let i = 0; i < textPages.length; i++) {
                        if (!isFirst) pdf.addPage();
                        isFirst = false;
                        
                        const titleForPage = i === 0 ? chapterTitle : null;
                        const textCanvas = this.renderTextToCanvas(textPages[i], titleForPage);
                        pdf.addImage(textCanvas, 'JPEG', 0, 0, pageWidth, pageHeight);
                        pageCount++;

                        if (pageCount % 10 === 0)
                            await this.delay(50);
                    }
                }

                for (const imageBlock of chapterImages) {
                    pdf.addPage();
                    
                    const dataUrl = `data:${imageBlock.data.contentType};base64,${imageBlock.data.base64}`;
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
                    }
                    pdf.addImage(dataUrl, 'JPEG', (pageWidth - w) / 2, (pageHeight - h) / 2, w, h);
                    pageCount++;

                    img.src = '';

                    if (pageCount % 5 === 0) {
                        await this.delay(50);
                    }
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
})(window);