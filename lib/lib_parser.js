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

    lib.startDownload = async function (contentString, filename, status) {
        try {
            if (status) status.textContent = 'Отправляем на скачивание...';
            
            const result = await lib.sendRuntimeMessage({
                action: 'downloadFb2',
                filename: filename,
                content: contentString
            });
            
            if (result && result.ok) return { ok: true, method: 'background-downloads' };
        } catch (e) { }

        try {
            if (status) status.textContent = 'Фолбек: открываем вкладку...';
            
            const base64 = lib.toBase64Utf8(contentString);
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

    function createFB2(manga, chapters, coverBase64) {
        const escapeXml = (str) => {
            if (!str) return '';
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
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

        let fb2 = `
            <?xml version="1.0" encoding="utf-8"?>
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
            fb2 += `\n<section>\n<title>\n<p>${escapeXml(chapter.title)}</p>\n</title>`;

            const content = chapter.content;

            if (typeof content === 'string') {
                const paragraphs = content.split('\n\n').filter(p => p.trim());
                for (const paragraph of paragraphs) fb2 += `\n<p>${escapeXml(paragraph.trim())}</p>`;
            } else if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'text' && block.text && block.text.trim()) {
                        const paragraphs = block.text.split('\n\n').filter(p => p.trim());
                        for (const paragraph of paragraphs) fb2 += `\n<p>${escapeXml(paragraph.trim())}</p>`;
                    } else if (block.type === 'image' && block.data) {
                        const imgId = `image_${imageIdCounter++}`;
                        allImages.set(imgId, {
                            data: block.data.base64,
                            contentType: block.data.contentType
                        });
                        fb2 += `\n<image l:href="#${imgId}" />`;
                    }
                }
            }

            fb2 += `\n</section>`;
        }

        fb2 += `\n</body>`;

        for (const [id, img] of allImages)
            fb2 += `\n<binary id="${id}" content-type="${img.contentType}">${img.data}</binary>`;

        fb2 += `\n</FictionBook>`;
        return fb2;
    }

    lib.downloadManga = async function (mangaSlug, contentType, status, progress, service) {
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
                        content: processedContent
                    });

                    await delay(500);
                } catch (err) {
                    if (status) status.innerHTML += `<br><span style="color: red;">✗ Глава ${chapterNum}: ${lib.escapeHtml(err.message || String(err))}</span>`;
                    await delay(1000);
                }
            }

            if (chapterContents.length === 0) throw new Error('Не удалось загрузить ни одной главы. Проверьте консоль (F12).');

            if (status) status.innerHTML = `Создаём FB2 файл...<br><small>Загружено глав: ${chapterContents.length}</small>`;
            if (progress) progress.value = 95;

            const fb2Content = createFB2(manga, chapterContents, coverBase64);
            const filename = `${lib.sanitizeFilename(manga.rus_name || manga.name)}.fb2`;

            const result = await lib.startDownload(fb2Content, filename, status);
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
                    content: processedContent
                });

                await delay(500);
            } catch (err) {
                console.error(`Ошибка при загрузке главы ${chapterNum}:`, err);
                if (status) status.innerHTML += `<br><span style="color: red;">✗ Глава ${chapterNum}: ${lib.escapeHtml(err.message || String(err))}</span>`;
                await delay(1000);
            }
        }

        if (chapterContents.length === 0) throw new Error('Не удалось загрузить ни одной главы. Проверьте консоль (F12).');

        if (status) status.innerHTML = `Создаём FB2 файл...<br><small>Загружено глав: ${chapterContents.length}</small>`;
        if (progress) progress.value = 95;

        const fb2Content = createFB2(manga, chapterContents, coverBase64);
        const filename = `${lib.sanitizeFilename(manga.rus_name || manga.name)}.fb2`;

        const result = await lib.startDownload(fb2Content, filename, status);
        if (!result.ok) {
            throw new Error('Не удалось начать скачивание: ' + (result.error || 'все методы ответа неудачны'));
        }
        if (progress) progress.value = 100;

        return { ok: true, filename, method: result.method };
    };

    lib.createFB2 = createFB2;

    global.libParser = lib;
})(window);