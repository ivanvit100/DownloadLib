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

        _inlineTagFor(type) {
            const map = {
                strong: 'strong', bold: 'strong', b: 'strong',
                em: 'em', italic: 'em', i: 'em',
                underline: 'u', u: 'u',
                strike: 's', s: 's', strikethrough: 's',
                code: 'code'
            };
            return map[type] || null;
        }

        _nodeToHtml(node) {
            if (!node) return '';
            if (typeof node === 'string')
                return String(node).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            if (node.type === 'text') {
                if (!node.text) return '';
                let escaped = node.text
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                if (Array.isArray(node.marks)) {
                    for (const mark of node.marks) {
                        const tag = this._inlineTagFor(mark.type);
                        if (tag) escaped = `<${tag}>${escaped}</${tag}>`;
                    }
                }
                return escaped;
            }
            if (node.type === 'hardBreak') return '<br/>';
            if (Array.isArray(node.content)) {
                const inner = node.content.map(n => this._nodeToHtml(n)).join('');
                const tag = this._inlineTagFor(node.type);
                return tag ? `<${tag}>${inner}</${tag}>` : inner;
            }
            return '';
        }

        _hasFormatting(node) {
            if (!node) return false;
            if (Array.isArray(node.marks) && node.marks.length > 0) return true;
            const tag = this._inlineTagFor(node.type);
            if (tag) return true;
            if (Array.isArray(node.content)) return node.content.some(n => this._hasFormatting(n));
            return false;
        }

        _sanitizeInlineHtml(html) {
            if (!html) return '';
            const br = '\x00br\x00';
            const result = String(html)
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<p\b[^>]*>/gi, '')
                .replace(/<\/p\s*>/gi, br)
                .replace(/<br\s*\/?>/gi, br)
                .replace(/<(\/?)(?:strong|b)\b[^>]*>/gi, (_, s) => `<${s}strong>`)
                .replace(/<(\/?)(?:em|i)\b[^>]*>/gi, (_, s) => `<${s}em>`)
                .replace(/<(\/?)(?:s|strike|del)\b[^>]*>/gi, (_, s) => `<${s}s>`)
                .replace(/<(\/?)u\b[^>]*>/gi, (_, s) => `<${s}u>`)
                .replace(/<(\/?)code\b[^>]*>/gi, (_, s) => `<${s}code>`)
                .replace(/<[^>]*>/g, '')
                .replace(/\0br\0/g, '<br/>')
                .replace(/(?:<br\/>){3,}/g, '<br/><br/>')
                .replace(/(?:<br\/>)+$/, '')
                .trim();
            return result;
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
                    if (!stripped.trim()) continue;
                    const block = { type: 'text', text: stripped };
                    if (/<(?:strong|em|code|strike|del|[bius])\b/i.test(part))
                        block.html = this._sanitizeInlineHtml(part);
                    result.push(block);
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
            const align = item.attrs?.textAlign;
            if (Array.isArray(item.content)) {
                const imageChildren = item.content.filter(child => child && child.type === 'image');
                if (imageChildren.length > 0)
                    return imageChildren.flatMap(child => this._extractImages(child.attrs));
                const text = this._extractFromNode(item);
                if (!text.trim()) return [];
                const block = { type: 'text', text };
                if (align && align !== 'left') block.align = align;
                if (item.content.some(n => this._hasFormatting(n)))
                    block.html = this._nodeToHtml(item);
                return [block];
            }

            if (typeof item.content === 'string') {
                const text = this.stripHtml(item.content);
                if (!text.trim()) return [];
                const block = { type: 'text', text };
                if (align && align !== 'left') block.align = align;
                return [block];
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
            const response = await this.extensionApi.runtime.sendMessage({
                action: 'fetchImage',
                url,
                referer: 'https://ranobelib.me/'
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