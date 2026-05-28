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
                const { hostname } = new URL(url);
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
                .replace(/&#039;/g, '\'')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        _parseHtmlString(str) {
            const result = [];
            const parts = str.split(/(<img\s[^>]*>)/i);
            for (const part of parts) {
                const imgMatch = part.match(/^<img\s[^>]*src=["']([^"']+)["'][^>]*>$/i);
                if (imgMatch)
                    result.push({ type: 'image', src: imgMatch[1] });
                else {
                    const stripped = this.stripHtml(part);
                    if (stripped.trim()) result.push({ type: 'text', text: stripped });
                }
            }
            return result;
        }

        _extractFromNode(node) {
            if (!node) return '';
            if (typeof node === 'string') return this.stripHtml(node);
            if (node.type === 'text' && node.text) return this.stripHtml(node.text);
            if (node.type === 'hardBreak') return '\n';
            if (Array.isArray(node.content))
                return node.content.map(n => this._extractFromNode(n)).filter(t => t !== '').join('');
            return '';
        }

        _extractImages(attrs) {
            if (!attrs || !Array.isArray(attrs.images)) return [];
            return attrs.images.flatMap(img => {
                if (img.image) return [{ type: 'image', src: img.image }];
                console.warn('[RanobeLibService] Image node missing image attribute:', img);
                return [];
            });
        }

        _extractFromParagraph(item) {
            if (Array.isArray(item.content)) {
                const imageChildren = item.content.filter(child => child && child.type === 'image');
                if (imageChildren.length > 0)
                    return imageChildren.flatMap(child => this._extractImages(child.attrs));
                const text = this._extractFromNode(item);
                return text.trim() ? [{ type: 'text', text }] : [];
            }

            if (typeof item.content === 'string') {
                const text = this.stripHtml(item.content);
                return text.trim() ? [{ type: 'text', text }] : [];
            }
            console.warn('[RanobeLibService] Unexpected paragraph content:', item);
            const text = this._extractFromNode(item);
            /* istanbul ignore next */
            return text.trim() ? [{ type: 'text', text }] : [];
        }

        _extractFromItem(item) {
            if (item.type === 'paragraph') return this._extractFromParagraph(item);
            if (item.type === 'image' && item.attrs && Array.isArray(item.attrs.images))
                return this._extractImages(item.attrs);
            if (item.type === 'horizontalRule') return [{ type: 'text', text: '\n---\n' }];
            if (['heading', 'blockquote', 'bulletList', 'orderedList', 'listItem'].includes(item.type)) {
                const text = this._extractFromNode(item);
                return text.trim() ? [{ type: 'text', text }] : [];
            }
            console.warn('[RanobeLibService] Unknown content node type:', item);
            return [];
        }

        extractText(content) {
            let data = content;

            if (typeof data === 'string') {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    return this._parseHtmlString(data);
                }
            }

            if (data && data.type === 'doc' && Array.isArray(data.content))
                ({ content: data } = data);

            if (!Array.isArray(data)) return [];

            return data
                .filter(item => item && typeof item === 'object')
                .flatMap(item => this._extractFromItem(item));
        }

        _buildAttachmentMap(attachments) {
            if (!Array.isArray(attachments)) return {};
            const map = {};
            for (const att of attachments) {
                if (att.name && att.extension)
                    map[att.name] = att.extension;
            }
            return map;
        }

        _resolveBaseUrl(src, mangaId, chapterId) {
            const srcWithoutExt = src.replace(/\.(jpg|jpeg|png|webp)$/i, '');
            if (/^https?:\/\//i.test(src)) return srcWithoutExt;
            if (/^(?:\/\/|\/)/.test(src)) return new URL(srcWithoutExt, 'https://ranobelib.me').toString();
            return `https://ranobelib.me/uploads/ranobe/${mangaId}/chapters/${chapterId}/${srcWithoutExt}`;
        }

        async _fetchImageWithExt(baseUrl, ext) {
            const url = `${baseUrl}.${ext}`;
            if (!this.extensionApi?.runtime?.sendMessage) {
                console.error('[RanobeLibService] browser.runtime not available!');
                return null;
            }
            const response = await new Promise((resolve, reject) => {
                this.extensionApi.runtime.sendMessage({
                    action: 'fetchImage',
                    url,
                    referer: 'https://ranobelib.me/'
                }).then(resolve).catch(reject);
            });
            if (!response || !response.ok) {
                console.warn(`[RanobeLibService] Failed to fetch ${url}:`, response?.error);
                return null;
            }
            return { base64: response.base64, contentType: response.contentType || 'image/png' };
        }

        async _processImageBlock(block, attachmentMap, mangaId, chapterId) {
            const isFullUrl = /^https?:\/\//i.test(block.src);
            const isAbsolutePath = /^(?:\/\/|\/)/.test(block.src);
            const isPlainUuid = !isFullUrl && !isAbsolutePath && !/\.(?:jpg|jpeg|png|webp)$/i.test(block.src);

            const [, matchedExt] = block.src.match(/\.(jpg|jpeg|png|webp)$/i) || [];
            const originalExt = isPlainUuid && attachmentMap[block.src]
                ? attachmentMap[block.src]
                : matchedExt || 'jpg';

            const baseUrl = this._resolveBaseUrl(block.src, mangaId, chapterId);
            const extensions = [originalExt, ...['jpg', 'jpeg', 'png', 'webp'].filter(e => e !== originalExt)];

            for (const ext of extensions) {
                try {
                    const data = await this._fetchImageWithExt(baseUrl, ext);
                    if (data) return { type: 'image', data };
                } catch (e) {
                    console.warn('[RanobeLibService] Failed ext:', ext, e);
                }
            }
            console.error('[RanobeLibService] Failed to load image:', block.src);
            return null;
        }

        async processChapterContent(extracted, _status, opts = {}) {
            const chapterMeta = opts.chapterMeta || {};
            const mangaId = opts.mangaId || chapterMeta.manga_id;
            const chapterId = chapterMeta.id;
            const attachmentMap = this._buildAttachmentMap(chapterMeta.attachments);

            const result = [];
            for (const block of extracted) {
                if (block.type === 'text') {
                    if (block.text && block.text.trim())
                        result.push(block);
                    else console.warn('[RanobeLibService] Skipping empty text block');
                } else if (block.type === 'image' && block.src) {
                    const imageResult = await this._processImageBlock(block, attachmentMap, mangaId, chapterId);
                    if (imageResult) result.push(imageResult);
                } else console.warn('[RanobeLibService] Unknown block type:', block);
            }
            return result;
        }
    }

    global.RanobeLibService = RanobeLibService;
    if (global.serviceRegistry) global.serviceRegistry.register(RanobeLibService);
    console.log('[RanobeLibService] Loaded');
})(typeof window !== 'undefined' ? window : self);