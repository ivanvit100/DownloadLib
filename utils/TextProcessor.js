'use strict';

(function(global) {
    console.log('[TextProcessor] Loading...');

    class TextProcessor {
        static stripHtml(html) {
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

        static sanitizeFilename(filename) {
            return filename
                .replace(/[<>:"/\\|?*]/g, '_')
                .replace(/\s+/g, '_')
                .substring(0, 200);
        }

        static extractTextFromContent(content) {
            if (typeof content === 'string')
                return this.stripHtml(content);

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
                    return '';
                }).filter(Boolean).join('\n\n');
            }

            return '';
        }
    }

    global.TextProcessor = TextProcessor;
    console.log('[TextProcessor] Loaded');
})(window);