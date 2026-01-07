'use strict';

(function(global) {
    console.log('[EPUBExporter] Loading...');

    class EPUBExporter extends global.BaseExporter {
        constructor() {
            super();
            this.format = 'epub';
        }

        async export(metadata, chapters) {
            if (typeof JSZip === 'undefined')
                throw new Error('JSZip library not loaded');

            const zip = new JSZip();

            zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
            
            zip.file('META-INF/container.xml', this.createContainer());
            
            let manifest = '';
            let spine = '';
            let navPoints = '';

            for (let i = 0; i < chapters.length; i++) {
                const chapter = chapters[i];
                const filename = `chapter${i + 1}.xhtml`;
                
                zip.file(`OEBPS/${filename}`, this.createChapterXHTML(chapter));
                
                manifest += `<item id="chapter${i + 1}" href="${filename}" media-type="application/xhtml+xml"/>`;
                spine += `<itemref idref="chapter${i + 1}"/>`;
                navPoints += this.createNavPoint(chapter.title, filename, i + 1);
            }

            zip.file('OEBPS/content.opf', this.createOPF(metadata, manifest, spine));
            zip.file('OEBPS/toc.ncx', this.createNCX(metadata, navPoints));

            return await zip.generateAsync({
                type: 'blob',
                mimeType: 'application/epub+zip',
                compression: 'DEFLATE'
            });
        }

        createContainer() {
            return `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
        }

        createChapterXHTML(chapter) {
            const title = this.escapeHtml(chapter.title);
            const text = this.extractText(chapter.content);
            const paragraphs = text.split(/\n{2,}/).filter(Boolean);

            let body = '';
            for (const p of paragraphs) {
                body += `<p>${this.escapeHtml(p)}</p>\n`;
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

        createOPF(metadata, manifest, spine) {
            const title = this.escapeXml(metadata.rus_name || metadata.name || 'Без названия');
            const author = this.escapeXml(metadata.authors?.[0]?.name || 'Неизвестно');

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

        createNCX(metadata, navPoints) {
            const title = this.escapeXml(metadata.rus_name || metadata.name || 'Без названия');

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
    </navPoint>`;
        }
    }

    global.EPUBExporter = EPUBExporter;
    console.log('[EPUBExporter] Loaded');
})(window);