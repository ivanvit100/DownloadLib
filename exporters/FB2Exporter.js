'use strict';

(function(global) {
    console.log('[FB2Exporter] Loading...');

    class FB2Exporter extends global.BaseExporter {
        constructor() {
            super();
            this.format = 'fb2';
        }

        async export(metadata, chapters) {
            const parts = [];
            
            parts.push(this.createHeader(metadata));
            
            for (const chapter of chapters) {
                parts.push(this.createSection(chapter));
            }
            
            parts.push(this.createFooter());
            
            const content = parts.join('\n');
            return new Blob([content], { type: 'application/fb2+xml' });
        }

        createHeader(metadata) {
            const title = this.escapeXml(metadata.rus_name || metadata.name || 'Без названия');
            const author = this.escapeXml(
                metadata.authors?.[0]?.name || 'Неизвестно'
            );
            const annotation = this.escapeXml(metadata.summary || '');

            return `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
    <description>
        <title-info>
            <genre>prose</genre>
            <author>
                <first-name>${author}</first-name>
            </author>
            <book-title>${title}</book-title>
            <annotation>
                <p>${annotation}</p>
            </annotation>
            <date>${metadata.releaseDate || ''}</date>
            <lang>ru</lang>
        </title-info>
        <document-info>
            <author>
                <nickname>MangaParser</nickname>
            </author>
            <date>${new Date().toISOString().split('T')[0]}</date>
            <program-used>MangaParser</program-used>
        </document-info>
    </description>
    <body>
        <title>
            <p>${title}</p>
        </title>`;
        }

        createSection(chapter) {
            let xml = `\n<section>\n<title>\n<p>${this.escapeXml(chapter.title)}</p>\n</title>`;
            
            const text = this.extractText(chapter.content);
            const paragraphs = text.split('\n').filter(p => p.trim());
            
            for (const paragraph of paragraphs) {
                xml += `\n<p>${this.escapeXml(paragraph.trim())}</p>`;
            }
            
            xml += `\n</section>`;
            return xml;
        }

        createFooter() {
            return `\n</body>\n</FictionBook>`;
        }
    }

    global.FB2Exporter = FB2Exporter;
    console.log('[FB2Exporter] Loaded');
})(window);