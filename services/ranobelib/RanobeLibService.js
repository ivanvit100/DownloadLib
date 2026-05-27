/**
 * DownloadLib service module
 * Module to interact with RanobeLib service
 * @module services/ranobelib/RanobeLibService
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

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

        stripHtml(str) {
            if (!str) return '';
            return str
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p>/gi, '\n')
                .replace(/<[^>]*>/g, '')
                .replace(/&nbsp;/gi, ' ')
                .replace(/&amp;/gi, '&')
                .replace(/&lt;/gi, '<')
                .replace(/&gt;/gi, '>')
                .replace(/&quot;/gi, '"')
                .replace(/&#039;/gi, "'")
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        extractText(content) {
            if (typeof content === 'string') {
                try {
                    content = JSON.parse(content);
                } catch (e) {
                    const result = [];
                    const parts = content.split(/(<img\s[^>]*>)/i);
                    for (const part of parts) {
                        const imgMatch = part.match(/^<img\s[^>]*src=["']([^"']+)["'][^>]*>$/i);
                        if (imgMatch) {
                            result.push({ type: 'image', src: imgMatch[1] });
                        } else {
                            const stripped = this.stripHtml(part);
                            if (stripped.trim()) result.push({ type: 'text', text: stripped });
                        }
                    }
                    return result;
                }
            }

            if (content && content.type === 'doc' && Array.isArray(content.content))
                content = content.content;

            if (!Array.isArray(content)) return [];

            const result = [];

            const extractTextFromNode = (node) => {
                if (!node) return '';
                if (typeof node === 'string') return this.stripHtml(node);
                if (node.type === 'text' && node.text) return this.stripHtml(node.text);
                if (node.type === 'hardBreak') return '\n';
                if (Array.isArray(node.content))
                    return node.content.map(extractTextFromNode).filter(t => t !== '').join('');
                else return '';
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
                                        } else console.warn('[RanobeLibService] Image node missing image attribute:', img);
                                    }
                                }
                            }
                        }

                        if (!hasImage) {
                            const text = extractTextFromNode(item);
                            if (text.trim()) result.push({ type: 'text', text: text });
                        }
                    } else if (typeof item.content === 'string') {
                        const text = this.stripHtml(item.content);
                        if (text.trim()) result.push({ type: 'text', text: text });
                    } else {
                        console.warn('[RanobeLibService] Unexpected paragraph content:', item);
                        const text = extractTextFromNode(item);
                        /* istanbul ignore next */
                        if (text && text.trim()) result.push({ type: 'text', text: text });
                    }
                } else if (item.type === 'image' && item.attrs && Array.isArray(item.attrs.images)) {
                    for (const img of item.attrs.images) {
                        if (img.image) {
                            result.push({
                                type: 'image',
                                src: img.image
                            });
                        } else console.warn('[RanobeLibService] Image node missing image attribute:', img);
                    }
                } else if (item.type === 'horizontalRule') {
                    result.push({ type: 'text', text: '\n---\n' });
                } else if (item.type === 'heading') {
                    const text = extractTextFromNode(item);
                    text.trim() && result.push({ type: 'text', text: text });
                } else if (item.type === 'blockquote') {
                    const text = extractTextFromNode(item);
                    text.trim() && result.push({ type: 'text', text: text });
                } else if (item.type === 'bulletList' || item.type === 'orderedList') {
                    const text = extractTextFromNode(item);
                    text.trim() && result.push({ type: 'text', text: text });
                } else if (item.type === 'listItem') {
                    const text = extractTextFromNode(item);
                    text.trim() && result.push({ type: 'text', text: text });
                } else console.warn('[RanobeLibService] Unknown content node type:', item);
            }

            return result;
        }

        async processChapterContent(extracted, _status, opts = {}) {
            const chapterMeta = opts.chapterMeta || {};
            const mangaId = opts.mangaId || chapterMeta.manga_id;
            const chapterId = chapterMeta.id;

            const attachmentMap = {};
            if (Array.isArray(chapterMeta.attachments)) {
                for (const att of chapterMeta.attachments) {
                    if (att.name && att.extension)
                        attachmentMap[att.name] = att.extension;
                }
            }

            const result = [];

            for (const block of extracted) {
                if (block.type === 'text') {
                    if (block.text && block.text.trim())
                        result.push(block);
                    else console.warn('[RanobeLibService] Skipping empty text block');
                } else if (block.type === 'image' && block.src) {
                    const isFullUrl = /^https?:\/\//i.test(block.src);
                    const isAbsolutePath = /^(\/\/|\/)/.test(block.src);
                    const isPlainUuid = !isFullUrl && !isAbsolutePath && !/\.(jpg|jpeg|png|webp)$/i.test(block.src);

                    let originalExt;
                    if (isPlainUuid && attachmentMap[block.src])
                        originalExt = attachmentMap[block.src];
                    else
                        originalExt = (block.src.match(/\.(jpg|jpeg|png|webp)$/i) || [])[1] || 'jpg';

                    const fallbacks = ['jpg', 'jpeg', 'png', 'webp'].filter(e => e !== originalExt);
                    const extensions = [originalExt, ...fallbacks];

                    const srcWithoutExt = block.src.replace(/\.(jpg|jpeg|png|webp)$/i, '');
                    const baseUrl = isFullUrl
                        ? srcWithoutExt
                        : isAbsolutePath
                            ? new URL(srcWithoutExt, 'https://ranobelib.me').toString()
                            : (() => {
                                const imageUuid = srcWithoutExt;
                                return `https://ranobelib.me/uploads/ranobe/${mangaId}/chapters/${chapterId}/${imageUuid}`;
                            })();

                    let loaded = false;

                    for (const ext of extensions) {
                        const url = `${baseUrl}.${ext}`;

                        try {
                            if (!this.extensionApi || !this.extensionApi.runtime || !this.extensionApi.runtime.sendMessage) {
                                console.error('[RanobeLibService] browser.runtime not available!');
                                continue;
                            }

                            const response = await new Promise((resolve, reject) => {
                                this.extensionApi.runtime.sendMessage({
                                    action: 'fetchImage',
                                    url: url,
                                    referer: 'https://ranobelib.me/'
                                }).then(resolve).catch(reject);
                            });

                            if (!response || !response.ok) {
                                console.warn(`[RanobeLibService] Failed to fetch ${url}:`, response?.error);
                                continue;
                            }

                            result.push({
                                type: 'image',
                                data: { base64: response.base64, contentType: response.contentType || 'image/png' }
                            });

                            loaded = true;
                            break;
                        } catch (e) {
                            console.warn('[RanobeLibService] Failed ext:', ext, e);
                        }
                    }

                    if (!loaded) console.error('[RanobeLibService] Failed to load image:', block.src);
                } else console.warn('[RanobeLibService] Unknown block type:', block);
            }

            return result;
        }
    }

    global.RanobeLibService = RanobeLibService;
    if (global.serviceRegistry) global.serviceRegistry.register(RanobeLibService);
    console.log('[RanobeLibService] Loaded');
})(typeof window !== 'undefined' ? window : self);