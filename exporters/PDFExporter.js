'use strict';

(function(global) {
    console.log('[PDFExporter] Loading...');

    class PDFExporter extends global.BaseExporter {
        constructor() {
            super();
            this.format = 'pdf';
        }

        async export(metadata, chapters) {
            if (typeof html2pdf === 'undefined')
                throw new Error('html2pdf library not loaded');

            const content = this.createHtmlContent(metadata, chapters);
            
            const options = {
                margin: 10,
                filename: `${metadata.rus_name || metadata.name || 'book'}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            return await html2pdf().set(options).from(content).outputPdf('blob');
        }

        createHtmlContent(metadata, chapters) {
            const title = metadata.rus_name || metadata.name || 'Без названия';
            const author = metadata.authors?.[0]?.name || 'Неизвестно';

            let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        h1 { text-align: center; margin: 50px 0; }
        h2 { margin-top: 40px; page-break-before: always; }
        p { text-align: justify; margin: 10px 0; }
    </style>
</head>
<body>
    <h1>${this.escapeHtml(title)}</h1>
    <p style="text-align: center;"><em>${this.escapeHtml(author)}</em></p>
`;

            for (const chapter of chapters) {
                html += `\n<h2>${this.escapeHtml(chapter.title)}</h2>\n`;
                
                const text = this.extractText(chapter.content);
                const paragraphs = text.split(/\n{2,}/).filter(Boolean);
                
                for (const p of paragraphs) {
                    html += `<p>${this.escapeHtml(p)}</p>\n`;
                }
            }

            html += '</body></html>';
            return html;
        }
    }

    global.PDFExporter = PDFExporter;
    console.log('[PDFExporter] Loaded');
})(window);