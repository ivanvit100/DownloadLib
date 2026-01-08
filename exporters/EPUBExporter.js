'use strict';

(function(global) {
    console.log('[EPUBExporter] Loading...');

    class EPUBExporter {
        escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }

        escapeXml(str) {
            return this.escapeHtml(str);
        }

        async export(manga, chapters, coverBase64) {
            if (typeof JSZip === 'undefined')
                throw new Error('JSZip library not loaded');

            const zip = new JSZip();

            zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
            zip.file('META-INF/container.xml', this.createContainer());
            
            let manifest = '';
            let spine = '';
            let navPoints = '';
            let imageCounter = 0;

            if (coverBase64) {
                const base64Data = coverBase64.includes(',') ? coverBase64.split(',')[1] : coverBase64;
                zip.file('OEBPS/images/cover.jpg', base64Data, { base64: true });
                manifest += '<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/>\n';
            }

            for (let i = 0; i < chapters.length; i++) {
                const chapter = chapters[i];
                
                if (chapter.content && Array.isArray(chapter.content)) {
                    for (const block of chapter.content) {
                        if (block.type === 'image' && block.data && block.data.base64) {
                            imageCounter++;
                            const imageId = `image${imageCounter}`;
                            const ext = block.data.contentType === 'image/png' ? 'png' : 'jpg';
                            const filename = `images/${imageId}.${ext}`;
                            
                            zip.file(`OEBPS/${filename}`, block.data.base64, { base64: true });
                            manifest += `<item id="${imageId}" href="${filename}" media-type="${block.data.contentType}"/>\n`;
                            
                            block._epubImagePath = filename;
                        }
                    }
                }
            }

            for (let i = 0; i < chapters.length; i++) {
                const chapter = chapters[i];
                const filename = `chapter${i + 1}.xhtml`;
                
                zip.file(`OEBPS/${filename}`, this.createChapterXHTML(chapter, coverBase64 && i === 0));
                
                manifest += `<item id="chapter${i + 1}" href="${filename}" media-type="application/xhtml+xml"/>\n`;
                spine += `<itemref idref="chapter${i + 1}"/>\n`;
                navPoints += this.createNavPoint(chapter.title, filename, i + 1);
            }

            zip.file('OEBPS/content.opf', this.createOPF(manga, manifest, spine));
            zip.file('OEBPS/toc.ncx', this.createNCX(manga, navPoints));

            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const filename = `${manga.rus_name || manga.name || 'manga'}.epub`;

            return {
                blob: zipBlob,
                filename,
                mimeType: 'application/epub+zip'
            };
        }

        createContainer() {
            return `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
        }

        createChapterXHTML(chapter, includeCover) {
            const title = this.escapeHtml(chapter.title);
            
            let body = '';
            
            if (includeCover) {
                body += '<div style="text-align: center; margin: 20px 0;">\n';
                body += '<img src="images/cover.jpg" alt="Cover" style="max-width: 100%; height: auto;"/>\n';
                body += '</div>\n';
            }

            if (chapter.content && Array.isArray(chapter.content)) {
                for (const block of chapter.content) {
                    if (block.type === 'text' && block.text) {
                        const lines = block.text.split('\n');
                        for (const line of lines) {
                            const trimmed = line.trim();
                            body += trimmed ? 
                                `<p>${this.escapeHtml(trimmed)}</p>\n` :
                                '<p>&#160;</p>\n';
                        }
                    } else if (block.type === 'image' && block._epubImagePath) {
                        body += '<div style="text-align: center; margin: 10px 0;">\n';
                        body += `<img src="${block._epubImagePath}" alt="Image" style="max-width: 100%; height: auto;"/>\n`;
                        body += '</div>\n';
                    }
                }
            }

            return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="utf-8"/>
    <title>${title}</title>
</head>
<body>
    <h2>${title}</h2>
    ${body}
</body>
</html>`;
        }

        createOPF(manga, manifest, spine) {
            const title = this.escapeXml(manga.rus_name || manga.name || 'Без названия');
            const author = this.escapeXml(manga.authors || 'Неизвестно');

            return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>ru</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifest}
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
</package>`;
        }

        createNCX(manga, navPoints) {
            const title = this.escapeXml(manga.rus_name || manga.name || 'Без названия');

            return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="id"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
    ${navPoints}
  </navMap>
</ncx>`;
        }

        createNavPoint(title, href, order) {
            return `<navPoint id="navPoint-${order}" playOrder="${order}">
      <navLabel><text>${this.escapeXml(title)}</text></navLabel>
      <content src="${href}"/>
    </navPoint>\n`;
        }
    }

    global.EPUBExporter = EPUBExporter;
    console.log('[EPUBExporter] Loaded');
})(window);