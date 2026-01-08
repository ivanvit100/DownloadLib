'use strict';

(function(global) {
    console.log('[RanobeLibService] Loading...');

    class RanobeLibService extends global.BaseService {
        constructor() {
            super(global.ranolibConfig);
            this._mangaIdCache = null;
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
            const result = text ? JSON.parse(text) : null;
            
            if (result && result.data && result.data.id)
                this._mangaIdCache = result.data.id;
            
            return result;
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

        extractText(content) {
            if (typeof content === 'string') {
                try {
                    content = JSON.parse(content);
                } catch (e) {
                    return [{ type: 'text', text: content }];
                }
            }
            
            if (content && content.type === 'doc' && Array.isArray(content.content))
                content = content.content;
            
            if (!Array.isArray(content)) return [];
            
            const result = [];
            
            const extractTextFromNode = (node) => {
                if (!node) return '';
                if (typeof node === 'string') return node;
                if (node.type === 'text' && node.text) return node.text;
                if (node.type === 'image') return '';
                if (Array.isArray(node.content))
                    return node.content.map(extractTextFromNode).filter(t => t !== '').join('');
                return '';
            };
            
            for (const item of content) {
                if (!item || typeof item !== 'object') continue;
                
                if (item.type === 'paragraph') {
                    if (Array.isArray(item.content)) {
                        let hasImage = false;
                        for (const child of item.content) {
                            if (child && child.type === 'image') {
                                hasImage = true;
                                if (child.attrs && Array.isArray(child.attrs.images)) {
                                    for (const img of child.attrs.images) {
                                        if (img.image) {
                                            result.push({ 
                                                type: 'image', 
                                                src: img.image
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        
                        if (!hasImage) {
                            const text = extractTextFromNode(item);
                            if (text.trim()) {
                                result.push({ type: 'text', text: text });
                            }
                        }
                    }
                } else if (item.type === 'image' && item.attrs && Array.isArray(item.attrs.images)) {
                    for (const img of item.attrs.images) {
                        if (img.image) {
                            result.push({ 
                                type: 'image', 
                                src: img.image
                            });
                        }
                    }
                } else if (item.type === 'horizontalRule') {
                    result.push({ type: 'text', text: '\n---\n' });
                }
            }
            
            return result;
        }

        async processChapterContent(extracted, status, opts = {}) {
            const chapterMeta = opts.chapterMeta || {};
            const mangaId = this._mangaIdCache || chapterMeta.manga_id;
            const chapterId = chapterMeta.id;
            
            const result = [];
            
            for (const block of extracted) {
                if (block.type === 'text') {
                    if (block.text && block.text.trim()) {
                        result.push(block);
                    }
                } else if (block.type === 'image' && block.src) {
                    const imageUuid = block.src.replace(/\.(jpg|jpeg|png|webp)$/i, '');
                    
                    const extensions = ['png', 'jpg', 'jpeg', 'webp'];
                    let loaded = false;
                    
                    for (const ext of extensions) {
                        const url = `https://ranobelib.me/uploads/ranobe/${mangaId}/chapters/${chapterId}/${imageUuid}.${ext}`;
                        
                        try {
                            const response = await fetch(url, {
                                method: 'GET',
                                headers: {
                                    'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
                                    'Referer': 'https://ranobelib.me/',
                                    'Sec-Fetch-Dest': 'image',
                                    'Sec-Fetch-Mode': 'no-cors',
                                    'Sec-Fetch-Site': 'same-origin'
                                },
                                mode: 'cors',
                                credentials: 'include'
                            });
                            
                            if (response.ok) {
                                const blob = await response.blob();
                                const reader = new FileReader();
                                const base64 = await new Promise((resolve, reject) => {
                                    reader.onloadend = () => resolve(reader.result);
                                    reader.onerror = reject;
                                    reader.readAsDataURL(blob);
                                });
                                
                                const base64Data = base64.split(',')[1];
                                const contentType = blob.type || 'image/png';
                                
                                result.push({
                                    type: 'image',
                                    data: { base64: base64Data, contentType }
                                });
                                
                                console.log('[RanobeLibService] Image loaded:', ext, 'size:', blob.size);
                                loaded = true;
                                break;
                            }
                        } catch (e) {
                            console.warn('[RanobeLibService] Failed ext:', ext, e);
                        }
                    }
                    
                    if (!loaded) {
                        console.error('[RanobeLibService] Failed to load image:', imageUuid);
                    }
                }
            }
            
            return result;
        }
    }

    global.RanobeLibService = RanobeLibService;
    console.log('[RanobeLibService] Loaded');
})(window);