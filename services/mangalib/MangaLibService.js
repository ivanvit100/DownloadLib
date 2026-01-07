'use strict';

(function(global) {
    console.log('[MangaLibService] Loading...');

    class MangaLibService extends global.BaseService {
        constructor() {
            super(global.mangalibConfig);
            console.log('[MangaLibService] Instance created');
        }

        static matches(url) {
            try {
                const hostname = new URL(url).hostname;
                return /mangalib\.me$/i.test(hostname) || /imgslib\.link$/i.test(hostname);
            } catch {
                return false;
            }
        }

        async fetchMangaMetadata(slug) {
            const fields = this.config.fields;
            const query = fields.map(f => `fields[]=${f}`).join('&');
            const url = `${this.baseUrl}/api/manga/${slug}?${query}`;
            
            console.log('[MangaLibService] Fetching metadata:', url);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: this.config.headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });
            
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                console.error('[MangaLibService] Error response:', text);
                throw new Error(`Failed to fetch manga: ${response.status}`);
            }
            
            const text = await response.text().catch(() => '');
            return text ? JSON.parse(text) : null;
        }

        async fetchChaptersList(slug) {
            const url = `${this.baseUrl}/api/manga/${slug}/chapters`;
            console.log('[MangaLibService] Fetching chapters:', url);
            
            const response = await fetch(url, {
                method: 'GET',
                headers: this.config.headers,
                mode: 'cors',
                credentials: 'include',
                cache: 'no-store'
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch chapters: ${response.status}`);
            }
            
            const text = await response.text().catch(() => '');
            return text ? JSON.parse(text) : null;
        }

        async fetchChapter(slug, number, volume = '1') {
            const params = new URLSearchParams();
            if (number !== undefined && number !== null) params.set('number', String(number));
            if (volume !== undefined && volume !== null) params.set('volume', String(volume));
            const url = `${this.baseUrl}/api/manga/${slug}/chapter?${params.toString()}`;
            
            console.log('[MangaLibService] Fetching chapter:', url);
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

        resolvePageUrl(filename) {
            if (!filename) return null;
            if (/^https?:\/\//i.test(filename)) return filename;
            if (filename.startsWith('/')) return `${this.config.imagesDomain}${filename}`;
            return `${this.config.imagesDomain}/${filename}`;
        }

        async processChapterContent(chapterData, opts = {}) {
            const pages = this.extractPages(chapterData);
            
            const results = [];
            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];
                const url = this.resolvePageUrl(page);
                
                try {
                    const dataUrl = await this.loadPageAsBase64(url);
                    const base64 = dataUrl.split(',')[1];
                    const contentType = dataUrl.match(/data:([^;]+);/)?.[1] || 'image/jpeg';
                    
                    if (this.config.splitLongImages && global.ImageProcessor) {
                        const parts = await global.ImageProcessor.splitLongImage(base64, contentType);
                        results.push(...parts.map((part, idx) => ({
                            type: 'image',
                            data: part,
                            originalIndex: i,
                            partIndex: idx,
                            totalParts: parts.length
                        })));
                    } else {
                        results.push({
                            type: 'image',
                            data: { base64, contentType },
                            originalIndex: i
                        });
                    }
                } catch (e) {
                    console.error('[MangaLibService] Failed to load page', i, ':', e);
                    results.push({
                        type: 'text',
                        text: `[Ошибка загрузки изображения ${i + 1}]`
                    });
                }
            }
            
            return results;
        }
    }

    global.MangaLibService = MangaLibService;
    console.log('[MangaLibService] Loaded');
})(window);