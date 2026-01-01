'use strict';

/* ==========================
   Общие вспомогательные функции и загрузчик FB2
   Экспортирует глобальный объект window.libParser
   ========================== */

(function (global) {
    const lib = {};

    lib.queryTabs = (opts) => new Promise((resolve, reject) => {
        if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.query) {
            browser.tabs.query(opts).then(resolve).catch(reject);
            return;
        }
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
            chrome.tabs.query(opts, (tabs) => {
                if (chrome.runtime && chrome.runtime.lastError) return reject(chrome.runtime.lastError);
                resolve(tabs);
            });
            return;
        }
        reject(new Error('tabs API unavailable'));
    });

    lib.createTab = (url) => new Promise((resolve, reject) => {
        if (typeof browser !== 'undefined' && browser.tabs && browser.tabs.create) {
            browser.tabs.create({ url }).then(resolve).catch(reject);
            return;
        }
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({ url }, (tab) => {
                if (chrome.runtime && chrome.runtime.lastError) return reject(chrome.runtime.lastError);
                resolve(tab);
            });
            return;
        }
        try {
            const w = window.open(url, '_blank');
            if (!w) return reject(new Error('window.open blocked'));
            resolve(w);
        } catch (e) {
            reject(e);
        }
    });

    lib.sendRuntimeMessage = (msg) => new Promise((resolve, reject) => {
        try {
            if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage) {
                browser.runtime.sendMessage(msg).then(resolve).catch(reject);
                return;
            }
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage(msg, (resp) => {
                    if (chrome.runtime && chrome.runtime.lastError) return reject(chrome.runtime.lastError);
                    resolve(resp);
                });
                return;
            }
            reject(new Error('runtime.sendMessage unavailable'));
        } catch (e) {
            reject(e);
        }
    });

    lib.toBase64Utf8 = function (str) {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            const chunkSize = 0x8000;
            let index = 0;
            let result = '';
            while (index < str.length) {
                const chunk = str.slice(index, Math.min(index + chunkSize, str.length));
                result += btoa(unescape(encodeURIComponent(chunk)));
                index += chunkSize;
            }
            return result;
        }
    };

    lib.escapeHtml = function (text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    lib.sanitizeFilename = function (filename) {
        return (filename || 'book').replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
    };

    lib.blobToBase64 = function (blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };

    lib.fetchImageWithRetry = async function (url, referer = null, retries = 5) {
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const response = await lib.sendRuntimeMessage({
                    action: 'fetchImage',
                    url: String(url).trim(),
                    referer: referer ? String(referer).trim() : null
                });
            
                if (response && response.ok && response.base64) {
                    const binaryString = atob(response.base64);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++)
                        bytes[i] = binaryString.charCodeAt(i);
                    return new Blob([bytes], { type: response.contentType || 'image/jpeg' });
                }
            
                if (attempt < retries - 1)
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            } catch (e) {
                if (attempt < retries - 1)
                    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
            }
        }
        
        return null;
    };

    lib.openDownloadTabWithBase64 = async function (base64Data, filename) {
        const escapedName = String(filename || 'download.fb2').replace(/"/g, '&quot;');
        const mime = 'application/fb2';
        const fileDataUrl = `data:${mime};base64,${base64Data}`;

        const html = `
            <!doctype html>
            <html>
                <meta charset="utf-8">
                <body>
                    <a id="dwn" href="${ fileDataUrl }" download="${ escapedName }">download</a>
                    <script>
                        try {
                            const a = document.getElementById('dwn');
                            setTimeout(() => { try { a.click(); } catch(e) { console.error(e); } }, 50);
                            setTimeout(() => { try { window.close(); } catch(e) {} }, 5000);
                        } catch (e) { console.error(e); }
                    </script>
                </body>
            </html>`;
        const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);

        try {
            await lib.createTab(dataUrl);
            return true;
        } catch (e) {
            try {
                const w = window.open(dataUrl, '_blank');
                return !!w;
            } catch (e2) {
                return false;
            }
        }
    };

    lib.startDownload = async function (content, filename, status, mime) {
        if (content instanceof Blob) {
            if (status) status.textContent = 'Скачиваем файл...';
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                URL.revokeObjectURL(url);
                a.remove();
            }, 10000);
            return { ok: true, method: 'blob-download' };
        }

        try {
            if (status) status.textContent = 'Отправляем на скачивание...';
            const result = await lib.sendRuntimeMessage({
                action: 'downloadFb2',
                filename: filename,
                content: content
            });
            if (result && result.ok) return { ok: true, method: 'background-downloads' };
        } catch (e) { }

        try {
            if (status) status.textContent = 'Фолбек: открываем вкладку...';
            const base64 = lib.toBase64Utf8(content);
            const opened = await lib.openDownloadTabWithBase64(base64, filename);
            if (opened) return { ok: true, method: 'data-tab' };
            return { ok: false, error: 'data-tab failed' };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    };

    lib.getRefererForService = function (service, contentType) {
        if (service && service === window.mangalib)
            return 'https://mangalib.me/';
        else if (contentType === 'manga')
            return 'https://mangalib.me/';
        return 'https://ranobelib.me/';
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
                                paragraphText += stripHtml(textBlock.text);
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
                        const blob = await lib.fetchImageWithRetry(data, null, 3);
                        if (!blob) return null;
                        return await lib.blobToBase64(blob);
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
                    if (block.type === 'text') {
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
                                        const imgId = `img_${idx+1}_${imageCounter++}`;
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
                                const imgId = `img_${idx+1}_${imageCounter++}`;
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
            zip.file(`OEBPS/chapter${idx+1}.xhtml`, chapterHtml);
            manifest += `<item id="chapter${idx+1}" href="chapter${idx+1}.xhtml" media-type="application/xhtml+xml"/>`;
            spine += `<itemref idref="chapter${idx+1}"/>`;
            items += `<navPoint id="navPoint-${idx+1}" playOrder="${idx+1}"><navLabel><text>${escapeHtml(ch.title)}</text></navLabel><content src="chapter${idx+1}.xhtml"/></navPoint>`;
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
                    const blob = await lib.fetchImageWithRetry(input, null, 3);
                    if (!blob) return null;
                    return await lib.blobToBase64(blob);
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
        if (isFirstPage) {
            isFirstPage = false;
        } else {
            pdf.addPage();
        }
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
                    if (block.type === 'text') {
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

    lib.downloadManga = async function (
        mangaSlug,
        contentType,
        status,
        progress,
        service,
        downloadController,
        format = 'fb2'
    ) {
        const fields = [
            'background', 'eng_name', 'otherNames', 'summary', 'releaseDate', 'type_id',
            'caution', 'views', 'close_view', 'rate_avg', 'rate', 'genres',
            'tags', 'teams', 'user', 'franchise', 'authors', 'publisher',
            'userRating', 'moderated', 'metadata', 'metadata.count',
            'metadata.close_comments', 'manga_status_id', 'chap_count',
            'status_id', 'artists', 'format'
        ];

        if (service && service.fetchMangaMetadata && service.fetchChaptersList && service.fetchChapter) {
            console.log('[lib.downloadManga] Using provided service:', service);

            const mangaData = await service.fetchMangaMetadata(mangaSlug);
            const manga = mangaData.data;

            if (status) status.innerHTML = `Загружаем информацию...<br><small>Тип: ${contentType}</small><br><small>ID: ${mangaSlug}</small>`;
            if (status) status.innerHTML += `<br><span style="color: green;">✓ Название: ${lib.escapeHtml(manga.rus_name || manga.name)}</span>`;

            const referer = lib.getRefererForService(service, contentType);

            let coverBase64 = '';
            if (manga.cover && manga.cover.default) {
                try {
                    if (status) status.innerHTML += `<br>Загружаем обложку...`;
                    const coverBlob = await lib.fetchImageWithRetry(manga.cover.default, referer);
                    if (coverBlob) {
                        coverBase64 = await lib.blobToBase64(coverBlob);
                        if (status) status.innerHTML += `<span style="color: green;"> ✓</span>`;
                    } else {
                        if (status) status.innerHTML += `<span style="color: orange;"> ⚠ не удалось загрузить</span>`;
                    }
                } catch (e) {
                    if (status) status.innerHTML += `<span style="color: orange;"> ⚠ ${lib.escapeHtml(e.message)}</span>`;
                }
            }

            if (status) status.innerHTML = `Получаем список глав...`;
            const chaptersData = await service.fetchChaptersList(mangaSlug);
            const chapters = chaptersData.data || [];
            if (chapters.length === 0) throw new Error('Главы не найдены. Возможно, требуется авторизация.');

            chapters.sort((a, b) => {
                const volA = parseInt(a.volume) || 0;
                const volB = parseInt(b.volume) || 0;
                if (volA !== volB) return volA - volB;
                return (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0);
            });

            const chapterContents = [];
            const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

            for (let i = 0; i < chapters.length; i++) {
                if (downloadController && downloadController.waitIfPaused) await downloadController.waitIfPaused();
                if (downloadController && downloadController.shouldStop && downloadController.shouldStop()) {
                    if (status) status.innerHTML = `<span style="color: orange;">⚠ Загрузка остановлена пользователем</span><br><small>Загружено глав: ${chapterContents.length} из ${chapters.length}</small>`;
                    break;
                }

                const chapter = chapters[i];
                const chapterNum = chapter.number;
                const volume = chapter.volume || '1';

                if (status) status.innerHTML = `Загружаем главу ${i + 1} из ${chapters.length}...<br><small>Том ${volume}, Глава ${chapterNum}</small>`;
                if (progress) progress.value = (i / chapters.length) * 100;

                try {
                    const chapterData = await service.fetchChapter(mangaSlug, chapterNum, volume, {});
                    const extractedContent = service.extractText ? service.extractText(chapterData.data.content) : [];
                    const processedContent = service.processChapterContent ? await service.processChapterContent(extractedContent, status, { chapterMeta: chapterData.data, chapterObj: chapter, mangaSlug }) : extractedContent;

                    chapterContents.push({
                        title: chapter.name || `Том ${volume}, Глава ${chapterNum}`,
                        volume,
                        number: chapterNum,
                        content: processedContent,
                        attachments: chapterData.data.attachments || []
                    });

                    await delay(500);
                } catch (err) {
                    if (status) status.innerHTML += `<br><span style="color: red;">✗ Глава ${chapterNum}: ${lib.escapeHtml(err.message || String(err))}</span>`;
                    await delay(1000);
                }
            }

            if (chapterContents.length === 0) throw new Error('Не удалось загрузить ни одной главы. Проверьте консоль (F12).');

            let fileContent, filename, mime;
            if (format === 'epub') {
                if (status) status.innerHTML = `Создаём EPUB файл...<br><small>Загружено глав: ${chapterContents.length}</small>`;
                if (progress) progress.value = 95;
                fileContent = await createEPUB(manga, chapterContents, coverBase64);
                filename = `${lib.sanitizeFilename(manga.rus_name || manga.name)}.epub`;
                mime = 'application/epub+zip';
            } else if (format === 'pdf') {
                if (status) status.innerHTML = `Создаём PDF файл...<br><small>Загружено глав: ${chapterContents.length}</small>`;
                if (progress) progress.value = 95;
                fileContent = await createPDF(manga, chapterContents, coverBase64);
                filename = `${lib.sanitizeFilename(manga.rus_name || manga.name)}.pdf`;
                mime = 'application/pdf';
            } else {
                if (status) status.innerHTML = `Создаём FB2 файл...<br><small>Загружено глав: ${chapterContents.length}</small>`;
                if (progress) progress.value = 95;
                const fb2String = createFB2(manga, chapterContents, coverBase64);
                fileContent = new Blob([fb2String], { type: 'application/fb2+xml' });
                filename = `${lib.sanitizeFilename(manga.rus_name || manga.name)}.fb2`;
                mime = 'application/fb2+xml';
            }

            const result = await lib.startDownload(fileContent, filename, status, mime);
            if (!result.ok) throw new Error('Не удалось начать скачивание: ' + (result.error || 'все методы ответа неудачны'));
            if (progress) progress.value = 100;

            return { ok: true, filename, method: result.method };
        }

        const mangaUrl = `https://api.cdnlibs.org/api/manga/${mangaSlug}?${fields.map(f => `fields[]=${f}`).join('&')}`;

        if (status) status.innerHTML = `Загружаем информацию...<br><small>Тип: ${contentType}</small><br><small>ID: ${mangaSlug}</small>`;
        console.log('Fetching:', mangaUrl);

        const mangaResponse = await fetch(mangaUrl, {
            method: 'GET',
            headers: {
                'Accept': '*/*',
                'Site-Id': '3',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!mangaResponse.ok) {
            const errorText = await mangaResponse.text().catch(() => 'Не удалось получить текст ошибки');
            throw new Error(`Ошибка загрузки: ${mangaResponse.status}. Ответ: ${errorText.substring(0, 300)}`);
        }

        const mangaData = await mangaResponse.json();
        const manga = mangaData.data;
        if (status) status.innerHTML += `<br><span style="color: green;">✓ Название: ${lib.escapeHtml(manga.rus_name || manga.name)}</span>`;

        let coverBase64 = '';
        if (manga.cover && manga.cover.default) {
            try {
                if (status) status.innerHTML += `<br>Загружаем обложку...`;
                const coverBlob = await lib.fetchImageWithRetry(manga.cover.default, 'https://ranobelib.me/');
                if (coverBlob) {
                    coverBase64 = await lib.blobToBase64(coverBlob);
                    if (status) status.innerHTML += `<span style="color: green;"> ✓</span>`;
                } else {
                    if (status) status.innerHTML += `<span style="color: orange;"> ⚠ не удалось загрузить</span>`;
                }
            } catch (e) {
                if (status) status.innerHTML += `<span style="color: orange;"> ⚠ ${lib.escapeHtml(e.message)}</span>`;
            }
        }

        if (status) status.innerHTML = `Получаем список глав...`;
        const chaptersUrl = `https://api.cdnlibs.org/api/manga/${mangaSlug}/chapters`;
        const chaptersResponse = await fetch(chaptersUrl, {
            headers: { 
                'Accept': '*/*', 
                'Site-Id': '3', 
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!chaptersResponse.ok) {
            const errorText = await chaptersResponse.text().catch(() => 'Не удалось получить текст ошибки');
            throw new Error(`Ошибка загрузки глав: ${chaptersResponse.status}. Ответ: ${errorText.substring(0, 200)}`);
        }

        const chaptersData = await chaptersResponse.json();
        const chapters = chaptersData.data || [];
        if (chapters.length === 0) throw new Error('Главы не найдены. Возможно, требуется авторизация.');

        chapters.sort((a, b) => {
            const volA = parseInt(a.volume) || 0;
            const volB = parseInt(b.volume) || 0;
            if (volA !== volB) return volA - volB;
            return (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0);
        });

        const chapterContents = [];
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        for (let i = 0; i < chapters.length; i++) {
            if (downloadController && downloadController.waitIfPaused)
                await downloadController.waitIfPaused();
            if (downloadController && downloadController.shouldStop && downloadController.shouldStop()) {
                if (status) status.innerHTML = `<span style="color: orange;">⚠ Загрузка остановлена пользователем</span><br><small>Загружено глав: ${chapterContents.length} из ${chapters.length}</small>`;
                break;
            }

            const chapter = chapters[i];
            const chapterNum = chapter.number;
            const volume = chapter.volume || '1';

            if (status) status.innerHTML = `Загружаем главу ${i + 1} из ${chapters.length}...<br><small>Том ${volume}, Глава ${chapterNum}</small>`;
            if (progress) progress.value = (i / chapters.length) * 100;

            try {
                const chapterUrl = `https://api.cdnlibs.org/api/manga/${mangaSlug}/chapter?number=${chapterNum}&volume=${volume}`;
                const chapterResponse = await fetch(chapterUrl, {
                    headers: {
                        'Accept': '*/*',
                        'Site-Id': '3',
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });

                if (chapterResponse.status === 429) {
                    if (status) status.innerHTML = `<span style="color: orange;">⚠ Превышен лимит запросов</span><br>Ждём 60 секунд...`;
                    await delay(60000);
                    i--;
                    continue;
                }

                if (!chapterResponse.ok) {
                    console.error(`Ошибка загрузки главы ${chapterNum}: ${chapterResponse.status}`);
                    if (status) status.innerHTML += `<br><span style="color: red;">✗ Глава ${chapterNum}: ошибка ${chapterResponse.status}</span>`;
                    await delay(1000);
                    continue;
                }

                const chapterData = await chapterResponse.json();
                const extractedContent = window.ranobelib ? window.ranobelib.extractText(chapterData.data.content) : (typeof chapterData.data.content === 'string' ? chapterData.data.content : []);
                const processedContent = window.ranobelib ? await window.ranobelib.processChapterContent(extractedContent, status, { chapterMeta: chapterData.data, chapterObj: chapter, mangaSlug }) : extractedContent;

                chapterContents.push({
                    title: chapter.name || `Том ${volume}, Глава ${chapterNum}`,
                    volume,
                    number: chapterNum,
                    content: processedContent,
                    attachments: chapterData.data.attachments || []
                });

                await delay(500);
            } catch (err) {
                console.error(`Ошибка при загрузке главы ${chapterNum}:`, err);
                if (status) status.innerHTML += `<br><span style="color: red;">✗ Глава ${chapterNum}: ${lib.escapeHtml(err.message || String(err))}</span>`;
                await delay(1000);
            }
        }

        if (chapterContents.length === 0) throw new Error('Не удалось загрузить ни одной главы. Проверьте консоль (F12).');

        let fileContent, filename, mime;
        if (format === 'epub') {
            if (status) status.innerHTML = `Создаём EPUB файл...<br><small>Загружено глав: ${chapterContents.length}</small>`;
            if (progress) progress.value = 95;
            fileContent = await createEPUB(manga, chapterContents, coverBase64);
            filename = `${lib.sanitizeFilename(manga.rus_name || manga.name)}.epub`;
            mime = 'application/epub+zip';
        } else if (format === 'pdf') {
            if (status) status.innerHTML = `Создаём PDF файл...<br><small>Загружено глав: ${chapterContents.length}</small>`;
            if (progress) progress.value = 95;
            fileContent = await createPDF(manga, chapterContents, coverBase64);
            filename = `${lib.sanitizeFilename(manga.rus_name || manga.name)}.pdf`;
            mime = 'application/pdf';
        } else {
            if (status) status.innerHTML = `Создаём FB2 файл...<br><small>Загружено глав: ${chapterContents.length}</small>`;
            if (progress) progress.value = 95;
            const fb2String = createFB2(manga, chapterContents, coverBase64);
            fileContent = new Blob([fb2String], { type: 'application/fb2+xml' });
            filename = `${lib.sanitizeFilename(manga.rus_name || manga.name)}.fb2`;
            mime = 'application/fb2+xml';
        }

        const result = await lib.startDownload(fileContent, filename, status, mime);
        if (!result.ok) {
            throw new Error('Не удалось начать скачивание: ' + (result.error || 'все методы ответа неудачны'));
        }
        if (progress) progress.value = 100;

        return { ok: true, filename, method: result.method };
    };

    lib.createFB2 = createFB2;
    lib.createFB2Stream = createFB2Stream;

    global.libParser = lib;
})(window);