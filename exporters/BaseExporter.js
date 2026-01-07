'use strict';

(function(global) {
    console.log('[BaseExporter] Loading...');

    class BaseExporter {
        constructor() {
            this.format = 'unknown';
        }

        async export(metadata, chapters) {
            throw new Error('export method must be implemented');
        }

        sanitizeText(text) {
            if (!text) return '';
            return String(text).trim();
        }

        escapeXml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }

        escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        stripHtml(html) {
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
        }

        extractText(content) {
            if (typeof content === 'string') {
                return this.stripHtml(content);
            }

            if (Array.isArray(content)) {
                return content.map(block => {
                    if (block.type === 'paragraph' && Array.isArray(block.content)) {
                        return block.content
                            .filter(t => t.type === 'text' && t.text)
                            .map(t => t.text)
                            .join('');
                    }
                    if (block.type === 'text' && block.text)
                        return block.text;
                    if (block.type === 'text' && block.content)
                        return String(block.content);
                    return '';
                }).filter(Boolean).join('\n\n');
            }

            return '';
        }
    }

    global.BaseExporter = BaseExporter;
})(window);