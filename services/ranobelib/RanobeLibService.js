'use strict';

(function(global) {
    console.log('[RanobeLibService] Loading...');

    class RanobeLibService extends global.BaseService {
        constructor() {
            super(global.ranolibConfig);
            console.log('[RanobeLibService] Instance created');
        }

        static matches(url) {
            try {
                const hostname = new URL(url).hostname;
                return /ranobelib\.me$/i.test(hostname);
            } catch {
                return false;
            }
        }

        async fetchMangaMetadata(slug) {
            const fields = this.config.fields;
            const query = fields.map(f => `fields[]=${f}`).join('&');
            const url = `${this.baseUrl}/api/manga/${slug}?${query}`;
            
            console.log('[RanobeLibService] Fetching metadata:', url);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: this.config.headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });
            
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                console.error('[RanobeLibService] Error response:', text);
                throw new Error(`Failed to fetch manga: ${response.status}`);
            }
            
            const text = await response.text().catch(() => '');
            return text ? JSON.parse(text) : null;
        }

        async fetchChaptersList(slug) {
            const url = `${this.baseUrl}/api/manga/${slug}/chapters`;
            console.log('[RanobeLibService] Fetching chapters:', url);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: this.config.headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });
            
            if (!response.ok)
                throw new Error(`Failed to fetch chapters: ${response.status}`);
            
            const text = await response.text().catch(() => '');
            return text ? JSON.parse(text) : null;
        }

        async fetchChapter(slug, number, volume = '1') {
            const params = new URLSearchParams();
            if (number !== undefined && number !== null) params.set('number', String(number));
            if (volume !== undefined && volume !== null) params.set('volume', String(volume));
            const url = `${this.baseUrl}/api/manga/${slug}/chapter?${params.toString()}`;
            
            const response = await fetch(url, {
                method: 'GET',
                headers: this.config.headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });
            
            if (!response.ok)
                throw new Error(`Failed to fetch chapter: ${response.status}`);
            
            const text = await response.text().catch(() => '');
            return text ? JSON.parse(text) : null;
        }

        async processChapterContent(chapterData, opts = {}) {
            const content = this.parseContent(chapterData);
            
            if (Array.isArray(content)) {
                return content.map(block => ({
                    type: block.type || 'paragraph',
                    content: block
                }));
            }
            
            return [{ type: 'text', content: String(content) }];
        }

        parseContent(chapterData) {
            let content = chapterData.content || chapterData;
            
            if (typeof content === 'string') {
                try {
                    content = JSON.parse(content);
                } catch (e) {
                    return content;
                }
            }

            if (content && content.content && Array.isArray(content.content))
                return content.content;
            return content;
        }
    }

    global.RanobeLibService = RanobeLibService;
    console.log('[RanobeLibService] Loaded');
})(window);