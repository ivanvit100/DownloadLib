'use strict';

(function (global) {
    const fileCreators = {};

    const fetchChapterContent = async function(mangaSlug, volume, number) {
        const url = `https://api.cdnlibs.org/api/manga/${mangaSlug}/chapter?number=${number}&volume=${volume}`;
        console.log('Загрузка главы:', url);
        
        const headers = {
            'Accept': '*/*',
            'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
            'Site-Id': '3',
            'Content-Type': 'application/json',
            'Client-Time-Zone': 'Europe/Moscow',
            'Referer': 'https://ranobelib.me/',
            'Origin': 'https://ranobelib.me',
            'Sec-GPC': '1'
        };
        
        const response = await fetch(url, {
            method: 'GET',
            headers,
            mode: 'cors',
            credentials: 'include',
            cache: 'no-store'
        });
        
        if (!response.ok) {
            throw new Error(`Ошибка загрузки главы: ${response.status}`);
        }
        const data = await response.json();
        console.log('Загружена глава:', data);
        return data;
    };

    const parseChapterContent = function(chapterData) {
        let content = null;
        let attachments = [];

        if (chapterData.data) {
            content = chapterData.data.content;
            attachments = chapterData.data.attachments || [];
        } else if (chapterData.content) {
            content = chapterData.content;
            attachments = chapterData.attachments || [];
        }

        if (typeof content === 'string') {
            try {
                content = JSON.parse(content);
            } catch (e) {
                console.warn('Не удалось распарсить content как JSON:', e);
            }
        }

        if (content && content.content && Array.isArray(content.content))
            content = content.content;

        return { content, attachments };
    };

    function* createFB2Stream(manga, chapters, coverBase64) {
        const escapeXml = (str) => {
            if (!str) return '';
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        };

        const stripHtml = (html) => {
            if (!html) return '';
            return String(html)
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<[^>]+>/g, '\n')
                .replace(/&nbsp;/g, ' ')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        };

        const title = escapeXml(manga.rus_name || manga.name);
        const authors = manga.authors?.map(a => escapeXml(a.name)).join(', ') || 'Неизвестно';
        const annotation = escapeXml(manga.summary || '');

        const allImages = new Map();
        let imageIdCounter = 1;

        if (coverBase64) {
            allImages.set('cover.jpg', {
                data: (coverBase64.indexOf(',') !== -1) ? coverBase64.split(',')[1] : coverBase64,
                contentType: coverBase64.match(/data:(image\/[^;]+);/)?.[1] || 'image/jpeg'
            });
        }

        yield `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
    <description>
        <title-info>
            <genre>prose</genre>
            <author>
                <first-name>${ authors }</first-name>
            </author>
            <book-title>${ title }</book-title>
            <annotation>
                <p>${ annotation }</p>
            </annotation>
            <date>${ manga.releaseDate || '' }</date>
            <lang>ru</lang>
        </title-info>
        <document-info>
            <author>
                <nickname>DownloadLib</nickname>
            </author>
            <date>${ new Date().toISOString().split('T')[0] }</date>
            <program-used>DownloadLib</program-used>
        </document-info>
    </description>
    <body>
        <title>
            <p>${ title }</p>
        </title>`;

        for (const chapter of chapters) {
            let chapterXml = `\n<section>\n<title>\n<p>${escapeXml(chapter.title)}</p>\n</title>`;

            const content = chapter.content;

            if (typeof content === 'string') {
                const cleanText = stripHtml(content);
                const paragraphs = cleanText.split('\n').filter(p => p.trim());
                for (const paragraph of paragraphs)
                    chapterXml += `\n<p>${escapeXml(paragraph.trim())}</p>`;
            } else if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'paragraph' && Array.isArray(block.content)) {
                        let paragraphText = '';
                        for (const textBlock of block.content) {
                            if (textBlock.type === 'text' && textBlock.text)
                                paragraphText += textBlock.text;
                            else if (textBlock.type === 'hardBreak')
                                paragraphText += '\n';
                        }
                        if (paragraphText.trim()) {
                            const lines = paragraphText.split('\n').filter(l => l.trim());
                            for (const line of lines)
                                chapterXml += `\n<p>${escapeXml(line.trim())}</p>`;
                        }
                    } else if (block.type === 'text' && block.text && block.text.trim()) {
                        const cleanText = stripHtml(block.text);
                        const paragraphs = cleanText.split('\n').filter(p => p.trim());
                        for (const paragraph of paragraphs)
                            chapterXml += `\n<p>${escapeXml(paragraph.trim())}</p>`;
                    } else if (block.type === 'image' && block.data) {
                        const imgId = `image_${imageIdCounter++}`;
                        allImages.set(imgId, {
                            data: block.data.base64,
                            contentType: block.data.contentType
                        });
                        chapterXml += `\n<image l:href="#${imgId}" />`;
                    }
                }
            }

            chapterXml += `\n</section>`;
            yield chapterXml;

            if (typeof gc !== 'undefined') gc();
        }

        yield `\n</body>`;

        for (const [id, img] of allImages) {
            yield `\n<binary id="${id}" content-type="${img.contentType}">${img.data}</binary>`;
            if (imageIdCounter % 50 === 0 && typeof gc !== 'undefined') gc();
        }

        yield `\n</FictionBook>`;
    }

    function createFB2(manga, chapters, coverBase64) {
        const parts = [];
        for (const part of createFB2Stream(manga, chapters, coverBase64))
            parts.push(part);
        return parts.join('');
    }

    async function createEPUB(manga, chapters, coverBase64) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip не подключён');
        const zip = new JSZip();

        const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

        const isDataUrl = (s) => /^data:[\w+/.-]+;base64,/.test(s);
        const isHttpUrl = (s) => /^https?:\/\//i.test(s);
        const dataUrlParts = (s) => {
            const m = /^data:([^;]+);base64,(.*)$/.exec(s);
            return m ? { mime: m[1], base64: m[2] } : null;
        };

        const getImageDataUrl = async (data) => {
            if (!data) return null;
            if (typeof data === 'object') {
                if (data.base64 && data.contentType) {
                    return `data:${data.contentType};base64,${data.base64}`;
                }
                if (data.url) return await getImageDataUrl(data.url);
                if (data.src) return await getImageDataUrl(data.src);
            }
            if (typeof data === 'string') {
                if (isDataUrl(data)) return data;
                if (/^[A-Za-z0-9+/=\s]+$/.test(data) && data.length > 100)
                    return 'data:image/jpeg;base64,' + data.replace(/\s+/g, '');
                if (isHttpUrl(data)) {
                    try {
                        const blob = await global.libParser.fetchImageWithRetry(data, null, 3);
                        if (!blob) return null;
                        return await global.libParser.blobToBase64(blob);
                    } catch (e) {
                        return null;
                    }
                }
            }
            return null;
        };

        const getAttachmentUrl = (attachments, imageId) => {
            if (!attachments || !imageId) return null;

            const cleanId = String(imageId).replace(/\.(png|jpg|jpeg|webp)$/i, '');
            const found = attachments.find(a => {
                const aName = String(a.name || '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
                const aFilename = String(a.filename || '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
                return aName === cleanId || aFilename === cleanId || a.name === imageId || a.filename === imageId;
            });

            if (found && found.url) {
                if (found.url.startsWith('/')) return 'https://ranobelib.me' + found.url;
                return found.url;
            }
            return null;
        };

        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

        let coverItem = '', coverMeta = '';
        if (coverBase64) {
            const coverDataUrl = await getImageDataUrl(coverBase64);
            const coverParts = coverDataUrl && dataUrlParts(coverDataUrl);
            if (coverParts) {
                const ext = coverParts.mime === 'image/png' ? 'png' : 'jpg';
                zip.file(`OEBPS/cover.${ext}`, coverParts.base64, { base64: true });
                coverItem = `<item id="cover" href="cover.${ext}" media-type="${coverParts.mime}" properties="cover-image"/>`;
                coverMeta = `<meta name="cover" content="cover"/>`;
            }
        }

        let manifest = `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`;
        let spine = '';
        let items = '';
        let imageCounter = 1;

        for (let idx = 0; idx < chapters.length; idx++) {
            const ch = chapters[idx];
            const attachments = ch.attachments || [];
            let chapterHtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><meta charset="utf-8"/><title>${escapeHtml(ch.title)}</title></head>
  <body><h2>${escapeHtml(ch.title)}</h2>`;

            if (Array.isArray(ch.content)) {
                for (const block of ch.content) {
                    if (block.type === 'paragraph' && Array.isArray(block.content)) {
                        let paragraphText = '';
                        for (const textBlock of block.content) {
                            if (textBlock.type === 'text' && textBlock.text)
                                paragraphText += textBlock.text;
                            else if (textBlock.type === 'hardBreak')
                                paragraphText += '<br/>';
                        }
                        if (paragraphText.trim())
                            chapterHtml += `<p>${paragraphText}</p>`;
                    } else if (block.type === 'text') {
                        const txt = String(block.text || '');
                        if (/[<>]/.test(txt)) {
                            const safe = txt.replace(/<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
                                .replace(/<\s*style[\s\S]*?>[\s\S]*?<\s*\/\s*style\s*>/gi, '');
                            chapterHtml += safe;
                        } else {
                            chapterHtml += `<p>${escapeHtml(txt)}</p>`;
                        }
                    } else if (block.type === 'image') {
                        if (block.attrs && Array.isArray(block.attrs.images)) {
                            for (const imgObj of block.attrs.images) {
                                const imageId = imgObj.image || imgObj.id || imgObj.filename || imgObj.name;
                                if (!imageId) continue;

                                const url = getAttachmentUrl(attachments, imageId);
                                if (url) {
                                    const dataUrl = await getImageDataUrl(url);
                                    const parts = dataUrlParts(dataUrl);
                                    if (parts) {
                                        const ext = parts.mime === 'image/png' ? 'png' : 'jpg';
                                        const imgId = `img_${idx + 1}_${imageCounter++}`;
                                        const imgName = `${imgId}.${ext}`;
                                        zip.file(`OEBPS/${imgName}`, parts.base64, { base64: true });
                                        manifest += `<item id="${imgId}" href="${imgName}" media-type="${parts.mime}"/>`;
                                        chapterHtml += `<div><img src="${imgName}" alt="image"/></div>`;
                                    }
                                }
                            }
                        } else if (block.data) {
                            const dataUrl = await getImageDataUrl(block.data);
                            const parts = dataUrlParts(dataUrl);
                            if (parts) {
                                const ext = parts.mime === 'image/png' ? 'png' : 'jpg';
                                const imgId = `img_${idx + 1}_${imageCounter++}`;
                                const imgName = `${imgId}.${ext}`;
                                zip.file(`OEBPS/${imgName}`, parts.base64, { base64: true });
                                manifest += `<item id="${imgId}" href="${imgName}" media-type="${parts.mime}"/>`;
                                chapterHtml += `<div><img src="${imgName}" alt="image"/></div>`;
                            }
                        }
                    }
                }
            } else if (typeof ch.content === 'string') {
                const paragraphs = ch.content.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
                for (const p of paragraphs) chapterHtml += `<p>${escapeHtml(p)}</p>`;
            }

            chapterHtml += `</body></html>`;
            zip.file(`OEBPS/chapter${idx + 1}.xhtml`, chapterHtml);
            manifest += `<item id="chapter${idx + 1}" href="chapter${idx + 1}.xhtml" media-type="application/xhtml+xml"/>`;
            spine += `<itemref idref="chapter${idx + 1}"/>`;
            items += `<navPoint id="navPoint-${idx + 1}" playOrder="${idx + 1}"><navLabel><text>${escapeHtml(ch.title)}</text></navLabel><content src="chapter${idx + 1}.xhtml"/></navPoint>`;
        }

        zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeHtml(manga.rus_name || manga.name || 'Без названия')}</dc:title>
    <dc:creator>${escapeHtml((manga.authors && manga.authors[0] && manga.authors[0].name) || 'Неизвестно')}</dc:creator>
    <dc:language>ru</dc:language>
    ${coverMeta}
  </metadata>
  <manifest>
    ${coverItem}
    ${manifest}
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
</package>`);

        zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="id"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeHtml(manga.rus_name || manga.name || 'Без названия')}</text></docTitle>
  <navMap>
    ${items}
  </navMap>
</ncx>`);

        const blob = await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/epub+zip',
            compression: 'DEFLATE',
            streamFiles: true
        });

        return blob;
    }

    async function createPDF(manga, chapters, coverBase64) {
        if (typeof html2pdf === 'undefined') throw new Error('html2pdf не подключён');

        const ensureDataUrl = async (input) => {
            if (!input) return null;
            if (/^data:[\w+/.-]+;base64,/.test(input)) return input;
            if (/^[A-Za-z0-9+/=\s]+$/.test(input) && input.length > 100)
                return 'data:image/jpeg;base64,' + input.replace(/\s+/g, '');
            if (/^https?:\/\//i.test(input)) {
                try {
                    const blob = await global.libParser.fetchImageWithRetry(input, null, 3);
                    if (!blob) return null;
                    return await global.libParser.blobToBase64(blob);
                } catch (e) {
                    return null;
                }
            }
            return null;
        };

        const getAttachmentUrl = (attachments, imageId) => {
            if (!attachments || !imageId) return null;
            const cleanId = String(imageId).replace(/\.(png|jpg|jpeg|webp)$/i, '');
            const found = attachments.find(a => {
                const aName = String(a.name || '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
                const aFilename = String(a.filename || '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
                return aName === cleanId || aFilename === cleanId || a.name === imageId || a.filename === imageId;
            });
            if (found && found.url) {
                if (found.url.startsWith('/')) return 'https://ranobelib.me' + found.url;
                return found.url;
            }
            return null;
        };

        const renderTextToCanvas = (text, isTitle = false) => {
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
            let y = margin;

            if (isTitle) {
                ctx.font = 'bold 36px Arial, sans-serif';
                const lines = text.split('\n');
                for (const line of lines) {
                    ctx.fillText(line, width / 2, y, maxWidth);
                    y += 50;
                }
            } else {
                ctx.font = '24px Arial, sans-serif';
                ctx.textAlign = 'left';

                const words = text.split(' ');
                let line = '';

                for (const word of words) {
                    const testLine = line + word + ' ';
                    const metrics = ctx.measureText(testLine);

                    if (metrics.width > maxWidth && line !== '') {
                        ctx.fillText(line, margin, y);
                        line = word + ' ';
                        y += 32;

                        if (y > height - margin) break;
                    } else {
                        line = testLine;
                    }
                }

                if (line && y <= height - margin) {
                    ctx.fillText(line, margin, y);
                }
            }

            return canvas.toDataURL('image/jpeg', 0.9);
        };

        const splitTextIntoPages = (text) => {
            const words = text.split(' ');
            const pages = [];
            let currentPage = '';
            let wordCount = 0;
            const wordsPerPage = 350;

            for (const word of words) {
                currentPage += word + ' ';
                wordCount++;

                if (wordCount >= wordsPerPage) {
                    pages.push(currentPage.trim());
                    currentPage = '';
                    wordCount = 0;
                }
            }

            if (currentPage.trim())
                pages.push(currentPage.trim());

            return pages;
        };

        const worker = html2pdf();
        const pdf = await new Promise((resolve) => {
            worker.set({}).from(document.createElement('div')).toPdf().get('pdf').then(resolve);
        });

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        let isFirstPage = true;

        const titleCanvas = renderTextToCanvas(manga.rus_name || manga.name || 'Без названия', true);
        if (isFirstPage) isFirstPage = false;
        else pdf.addPage();

        pdf.addImage(titleCanvas, 'JPEG', 0, 0, pageWidth, pageHeight);

        if (coverBase64) {
            const coverDataUrl = await ensureDataUrl(coverBase64);
            if (coverDataUrl) {
                pdf.addPage();
                const img = new Image();
                img.src = coverDataUrl;
                await new Promise((resolve) => {
                    img.onload = resolve;
                    img.onerror = resolve;
                });

                const imgRatio = img.width / img.height;
                const maxImgWidth = pageWidth - 40;
                const maxImgHeight = pageHeight - 40;
                let imgWidth = maxImgWidth;
                let imgHeight = imgWidth / imgRatio;

                if (imgHeight > maxImgHeight) {
                    imgHeight = maxImgHeight;
                    imgWidth = imgHeight * imgRatio;
                }

                const x = (pageWidth - imgWidth) / 2;
                const y = (pageHeight - imgHeight) / 2;
                pdf.addImage(coverDataUrl, 'JPEG', x, y, imgWidth, imgHeight);
            }
        }

        for (const ch of chapters) {
            const attachments = ch.attachments || [];

            pdf.addPage();
            const chapterTitleCanvas = renderTextToCanvas(ch.title || '', true);
            pdf.addImage(chapterTitleCanvas, 'JPEG', 0, 0, pageWidth, pageHeight);

            if (Array.isArray(ch.content)) {
                for (const block of ch.content) {
                    if (block.type === 'paragraph' && Array.isArray(block.content)) {
                        let paragraphText = '';
                        for (const textBlock of block.content) {
                            if (textBlock.type === 'text' && textBlock.text) {
                                paragraphText += textBlock.text + ' ';
                            }
                        }
                        if (paragraphText.trim()) {
                            const pages = splitTextIntoPages(paragraphText.trim());
                            for (const pageText of pages) {
                                pdf.addPage();
                                const textCanvas = renderTextToCanvas(pageText, false);
                                pdf.addImage(textCanvas, 'JPEG', 0, 0, pageWidth, pageHeight);
                            }
                        }
                    } else if (block.type === 'text') {
                        const text = String(block.text || '').replace(/<[^>]+>/g, '').trim();
                        if (text) {
                            const pages = splitTextIntoPages(text);
                            for (const pageText of pages) {
                                pdf.addPage();
                                const textCanvas = renderTextToCanvas(pageText, false);
                                pdf.addImage(textCanvas, 'JPEG', 0, 0, pageWidth, pageHeight);
                            }
                        }
                    } else if (block.type === 'image') {
                        let dataUrl = null;

                        if (block.attrs && Array.isArray(block.attrs.images)) {
                            for (const imgObj of block.attrs.images) {
                                const imageId = imgObj.image || imgObj.id || imgObj.filename || imgObj.name;
                                if (!imageId) continue;

                                const url = getAttachmentUrl(attachments, imageId);
                                if (url) {
                                    dataUrl = await ensureDataUrl(url);
                                    if (dataUrl) {
                                        pdf.addPage();
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
                                    }
                                }
                            }
                        } else if (block.data) {
                            dataUrl = await ensureDataUrl(block.data.base64 || block.data);
                            if (dataUrl) {
                                pdf.addPage();
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
                            }
                        }
                    }
                }
            } else if (typeof ch.content === 'string') {
                const text = ch.content.replace(/<[^>]+>/g, '').trim();
                if (text) {
                    const pages = splitTextIntoPages(text);
                    for (const pageText of pages) {
                        pdf.addPage();
                        const textCanvas = renderTextToCanvas(pageText, false);
                        pdf.addImage(textCanvas, 'JPEG', 0, 0, pageWidth, pageHeight);
                    }
                }
            }
        }

        return pdf.output('blob');
    }

    fileCreators.extractChaptersFromFB2 = async function (file) {
        const text = await file.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/xml');
        
        const bookTitle = doc.querySelector('book-title')?.textContent?.trim() || '';
        const sections = doc.querySelectorAll('body > section');
        const chapters = [];
        
        sections.forEach(section => {
            const titleElem = section.querySelector('title > p');
            if (titleElem) {
                chapters.push({
                    title: titleElem.textContent.trim(),
                    element: section
                });
            }
        });
        
        return { bookTitle, chapters, raw: text };
    };

    fileCreators.extractChaptersFromEPUB = async function (file) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip не подключён');
        
        const zip = await JSZip.loadAsync(file);
        const opfFile = zip.file(/OEBPS\/content\.opf$/i)[0] || zip.file(/content\.opf$/i)[0];
        if (!opfFile) throw new Error('content.opf не найден в EPUB');
        
        const opfText = await opfFile.async('text');
        const parser = new DOMParser();
        const opfDoc = parser.parseFromString(opfText, 'text/xml');
        
        const bookTitle = opfDoc.querySelector('title')?.textContent?.trim() || '';
        
        const ncxFile = zip.file(/OEBPS\/toc\.ncx$/i)[0] || zip.file(/toc\.ncx$/i)[0];
        if (!ncxFile) throw new Error('toc.ncx не найден в EPUB');
        
        const ncxText = await ncxFile.async('text');
        const ncxDoc = parser.parseFromString(ncxText, 'text/xml');
        
        const navPoints = ncxDoc.querySelectorAll('navPoint');
        const chapters = [];
        
        navPoints.forEach(nav => {
            const label = nav.querySelector('navLabel text')?.textContent?.trim();
            const src = nav.querySelector('content')?.getAttribute('src');
            if (label && src) chapters.push({ title: label, href: src });
        });
        
        return { bookTitle, chapters, zip };
    };

    fileCreators.extractChaptersFromPDF = async function (file) {
        return { bookTitle: file.name.replace(/\.pdf$/i, ''), chapters: [], message: 'PDF не поддерживает извлечение глав' };
    };

    fileCreators.compareChapters = function (existingChapters, newChapters) {
        const existingTitles = existingChapters.map(ch => ch.title.toLowerCase().trim());
        const newTitles = newChapters.map(ch => (ch.name || ch.title).toLowerCase().trim());
        
        const missing = [];
        newChapters.forEach((ch, idx) => {
            if (!existingTitles.includes(newTitles[idx])) missing.push(ch);
        });
        
        return missing;
    };

    fileCreators.verifyBookMatch = function (fileBookTitle, mangaTitle) {
        const normalize = (s) => s.toLowerCase().replace(/[^a-zа-яё0-9]/g, '');
        return normalize(fileBookTitle).includes(normalize(mangaTitle)) || 
               normalize(mangaTitle).includes(normalize(fileBookTitle));
    };

    fileCreators.updateFB2 = async function (existingFile, missingChapters, manga, coverBase64) {
        const { raw } = await fileCreators.extractChaptersFromFB2(existingFile);
        
        const mangaSlug = manga.slug || manga.id;
        
        const chaptersWithContent = [];
        for (const ch of missingChapters) {
            try {
                console.log('Загружаю главу:', ch);
                const chapterData = await fetchChapterContent(mangaSlug, ch.volume, ch.number);
                const { content, attachments } = parseChapterContent(chapterData);
                
                chaptersWithContent.push({
                    title: ch.name || ch.title,
                    content: content,
                    attachments: attachments
                });
            } catch (e) {
                console.error(`Ошибка загрузки главы "${ch.name || ch.title}":`, e);
                chaptersWithContent.push({ 
                    title: ch.name || ch.title,
                    content: `[Ошибка загрузки: ${e.message}]` 
                });
            }
        }
        
        let newSections = '';
        for (const part of createFB2Stream(manga, chaptersWithContent, null)) {
            if (part.includes('<section>'))
                newSections += part + '\n';
        }
        
        const updated = raw.replace(/<\/body>/, newSections + '</body>');
        return new Blob([updated], { type: 'application/fb2+xml' });
    };

    fileCreators.updateEPUB = async function (existingFile, missingChapters, manga) {
        const { zip, chapters: existingChapters } = await fileCreators.extractChaptersFromEPUB(existingFile);
        
        const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        
        const getImageDataUrl = async (data) => {
            if (!data) return null;
            if (typeof data === 'object') {
                if (data.base64 && data.contentType) {
                    return `data:${data.contentType};base64,${data.base64}`;
                }
                if (data.url) return await getImageDataUrl(data.url);
                if (data.src) return await getImageDataUrl(data.src);
            }
            if (typeof data === 'string') {
                if (/^data:[\w+/.-]+;base64,/.test(data)) return data;
                if (/^[A-Za-z0-9+/=\s]+$/.test(data) && data.length > 100)
                    return 'data:image/jpeg;base64,' + data.replace(/\s+/g, '');
                if (/^https?:\/\//i.test(data)) {
                    try {
                        const blob = await global.libParser.fetchImageWithRetry(data, null, 3);
                        if (!blob) return null;
                        return await global.libParser.blobToBase64(blob);
                    } catch (e) {
                        return null;
                    }
                }
            }
            return null;
        };

        const getAttachmentUrl = (attachments, imageId) => {
            if (!attachments || !imageId) return null;
            const cleanId = String(imageId).replace(/\.(png|jpg|jpeg|webp)$/i, '');
            const found = attachments.find(a => {
                const aName = String(a.name || '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
                const aFilename = String(a.filename || '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
                return aName === cleanId || aFilename === cleanId || a.name === imageId || a.filename === imageId;
            });
            if (found && found.url) {
                if (found.url.startsWith('/')) return 'https://ranobelib.me' + found.url;
                return found.url;
            }
            return null;
        };

        const dataUrlParts = (s) => {
            const m = /^data:([^;]+);base64,(.*)$/.exec(s);
            return m ? { mime: m[1], base64: m[2] } : null;
        };
        
        const mangaSlug = manga.slug || manga.id;
        
        const chaptersWithContent = [];
        for (const ch of missingChapters) {
            try {
                console.log('Загружаю главу:', ch);
                const chapterData = await fetchChapterContent(mangaSlug, ch.volume, ch.number);
                const { content, attachments } = parseChapterContent(chapterData);
                
                chaptersWithContent.push({
                    title: ch.name || ch.title,
                    content: content,
                    attachments: attachments
                });
            } catch (e) {
                console.error(`Ошибка загрузки главы "${ch.name || ch.title}":`, e);
                chaptersWithContent.push({ 
                    title: ch.name || ch.title,
                    content: `[Ошибка загрузки: ${e.message}]` 
                });
            }
        }
        
        let nextChapterIndex = existingChapters.length + 1;
        let newManifestItems = '';
        let newSpineItems = '';
        let newNavPoints = '';
        let imageCounter = 1;
        
        for (let i = 0; i < chaptersWithContent.length; i++) {
            const ch = chaptersWithContent[i];
            const chapterFile = `chapter${nextChapterIndex}.xhtml`;
            const attachments = ch.attachments || [];
            
            let chapterHtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><meta charset="utf-8"/><title>${escapeHtml(ch.title)}</title></head>
  <body><h2>${escapeHtml(ch.title)}</h2>`;
            
            if (Array.isArray(ch.content)) {
                for (const block of ch.content) {
                    if (block.type === 'paragraph' && Array.isArray(block.content)) {
                        let paragraphText = '';
                        for (const textBlock of block.content) {
                            if (textBlock.type === 'text' && textBlock.text)
                                paragraphText += textBlock.text;
                            else if (textBlock.type === 'hardBreak')
                                paragraphText += '<br/>';
                        }
                        if (paragraphText.trim()) {
                            chapterHtml += `<p>${paragraphText}</p>`;
                        }
                    } else if (block.type === 'text') {
                        const txt = String(block.text || '');
                        if (/[<>]/.test(txt)) {
                            const safe = txt.replace(/<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
                                .replace(/<\s*style[\s\S]*?>[\s\S]*?<\s*\/\s*style\s*>/gi, '');
                            chapterHtml += safe;
                        } else {
                            chapterHtml += `<p>${escapeHtml(txt)}</p>`;
                        }
                    } else if (block.type === 'image') {
                        if (block.attrs && Array.isArray(block.attrs.images)) {
                            for (const imgObj of block.attrs.images) {
                                const imageId = imgObj.image || imgObj.id || imgObj.filename || imgObj.name;
                                if (!imageId) continue;

                                const url = getAttachmentUrl(attachments, imageId);
                                if (url) {
                                    const dataUrl = await getImageDataUrl(url);
                                    const parts = dataUrlParts(dataUrl);
                                    if (parts) {
                                        const ext = parts.mime === 'image/png' ? 'png' : 'jpg';
                                        const imgId = `img_${nextChapterIndex}_${imageCounter++}`;
                                        const imgName = `${imgId}.${ext}`;
                                        zip.file(`OEBPS/${imgName}`, parts.base64, { base64: true });
                                        newManifestItems += `<item id="${imgId}" href="${imgName}" media-type="${parts.mime}"/>`;
                                        chapterHtml += `<div><img src="${imgName}" alt="image"/></div>`;
                                    }
                                }
                            }
                        } else if (block.data) {
                            const dataUrl = await getImageDataUrl(block.data);
                            const parts = dataUrlParts(dataUrl);
                            if (parts) {
                                const ext = parts.mime === 'image/png' ? 'png' : 'jpg';
                                const imgId = `img_${nextChapterIndex}_${imageCounter++}`;
                                const imgName = `${imgId}.${ext}`;
                                zip.file(`OEBPS/${imgName}`, parts.base64, { base64: true });
                                newManifestItems += `<item id="${imgId}" href="${imgName}" media-type="${parts.mime}"/>`;
                                chapterHtml += `<div><img src="${imgName}" alt="image"/></div>`;
                            }
                        }
                    }
                }
            } else if (typeof ch.content === 'string') {
                const paragraphs = ch.content.split(/\n{2,}/).filter(Boolean);
                paragraphs.forEach(p => { chapterHtml += `<p>${escapeHtml(p)}</p>`; });
            }
            
            chapterHtml += `</body></html>`;
            zip.file(`OEBPS/${chapterFile}`, chapterHtml);
            
            newManifestItems += `<item id="chapter${nextChapterIndex}" href="${chapterFile}" media-type="application/xhtml+xml"/>`;
            newSpineItems += `<itemref idref="chapter${nextChapterIndex}"/>`;
            newNavPoints += `<navPoint id="navPoint-${nextChapterIndex}" playOrder="${nextChapterIndex}"><navLabel><text>${escapeHtml(ch.title)}</text></navLabel><content src="${chapterFile}"/></navPoint>`;
            
            nextChapterIndex++;
        }
        
        const opfFile = zip.file(/OEBPS\/content\.opf$/i)[0];
        let opfText = await opfFile.async('text');
        opfText = opfText.replace(/<\/manifest>/, newManifestItems + '</manifest>');
        opfText = opfText.replace(/<\/spine>/, newSpineItems + '</spine>');
        zip.file(opfFile.name, opfText);
        
        const ncxFile = zip.file(/OEBPS\/toc\.ncx$/i)[0];
        let ncxText = await ncxFile.async('text');
        ncxText = ncxText.replace(/<\/navMap>/, newNavPoints + '</navMap>');
        zip.file(ncxFile.name, ncxText);
        
        return await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
    };

    fileCreators.updatePDF = async function (existingFile, missingChapters, manga, coverBase64) {
        throw new Error('Обновление PDF не поддерживается. Создайте новый файл.');
    };

    fileCreators.updateFile = async function (existingFile, allChapters, manga, coverBase64, format) {
        let extracted;
        
        if (format === 'fb2') {
            extracted = await fileCreators.extractChaptersFromFB2(existingFile);
        } else if (format === 'epub') {
            extracted = await fileCreators.extractChaptersFromEPUB(existingFile);
        } else if (format === 'pdf') {
            extracted = await fileCreators.extractChaptersFromPDF(existingFile);
            throw new Error('PDF не поддерживает докачку глав');
        } else {
            throw new Error('Неизвестный формат файла');
        }
        
        if (!fileCreators.verifyBookMatch(extracted.bookTitle, manga.rus_name || manga.name))
            throw new Error(`Загруженный файл не соответствует выбранному произведению.\nФайл: "${extracted.bookTitle}"\nПроизведение: "${manga.rus_name || manga.name}"`);
        
        const missingChapters = fileCreators.compareChapters(extracted.chapters, allChapters);
        
        if (missingChapters.length === 0)
            throw new Error('Все главы уже присутствуют в файле');
        
        console.log('Недостающие главы:', missingChapters);
        
        if (format === 'fb2')
            return await fileCreators.updateFB2(existingFile, missingChapters, manga, coverBase64);
        else if (format === 'epub')
            return await fileCreators.updateEPUB(existingFile, missingChapters, manga);
        else if (format === 'pdf')
            return await fileCreators.updatePDF(existingFile, missingChapters, manga, coverBase64);
    };

    fileCreators.createFB2Stream = createFB2Stream;
    fileCreators.createFB2 = createFB2;
    fileCreators.createEPUB = createEPUB;
    fileCreators.createPDF = createPDF;
    fileCreators.fetchChapterContent = fetchChapterContent;
    fileCreators.parseChapterContent = parseChapterContent;

    global.fileCreators = fileCreators;
})(window);