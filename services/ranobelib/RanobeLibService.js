/**
 * DownloadLib service module
 * Module to interact with RanobeLib service
 * @module services/ranobelib/RanobeLibService
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

'use strict';

(function(global) {
    console.log('[RanobeLibService] Loading...');

    /**
     * Сервис-парсер сайта RanobeLib: содержимое главы приходит как ProseMirror-подобное
     * дерево rich-text JSON (или, в некоторых ответах, как готовый HTML-текст),
     * которое приводится к унифицированному формату текстовых/изображений-блоков
     * с сохранением базового инлайнового форматирования (жирный, курсив и т.д.).
     */
    class RanobeLibService extends global.BaseService {
        /**
         * Создаёт сервис с конфигурацией RanobeLib.
         */
        constructor() {
            super(global.ranolibConfig);
            console.log('[RanobeLibService] Instance created');
        }

        /**
         * Проверяет, относится ли URL к хосту RanobeLib.
         * @param {string} url - Проверяемый URL.
         * @returns {boolean} true, если хост URL — ranobelib.me.
         */
        static matches(url) {
            try {
                const { hostname } = new URL(url);
                return /ranobelib\.me$/i.test(hostname);
            } catch {
                return false;
            }
        }

        /**
         * Удаляет HTML-разметку из строки, превращая её в чистый текст: заменяет
         * &lt;br&gt;/&lt;/p&gt; переносами строк, вырезает остальные теги и декодирует
         * основные HTML-сущности.
         * @param {?string} str - Исходная HTML-строка.
         * @returns {string} Очищенный текст, либо пустая строка для falsy-значений.
         */
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

        /**
         * Сопоставляет тип узла/marks ProseMirror-дерева с соответствующим
         * HTML-тегом инлайнового форматирования.
         * @param {string} type - Тип узла или marks (strong, em, underline, strike, code и т.д.).
         * @returns {?string} HTML-тег ('strong', 'em', 'u', 's', 'code'), либо null,
         * если тип не поддерживается.
         */
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

        /**
         * Рекурсивно преобразует узел ProseMirror-дерева (включая текстовые узлы
         * с marks и переносы строк) в эквивалентную HTML-разметку с базовыми
         * инлайновыми тегами форматирования.
         * @param {*} node - Узел содержимого (объект, строка, либо falsy).
         * @returns {string} HTML-представление узла.
         */
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

        /**
         * Проверяет, содержит ли узел (рекурсивно) хоть какое-то инлайновое
         * форматирование, которое нужно сохранить в HTML-представлении блока.
         * @param {*} node - Проверяемый узел содержимого.
         * @returns {boolean} true, если найдено форматирование.
         */
        _hasFormatting(node) {
            if (!node) return false;
            if (Array.isArray(node.marks) && node.marks.length > 0) return true;
            const tag = this._inlineTagFor(node.type);
            if (tag) return true;
            if (Array.isArray(node.content)) return node.content.some(n => this._hasFormatting(n));
            return false;
        }

        /**
         * Очищает произвольный HTML до безопасного ограниченного набора инлайновых
         * тегов (strong/em/s/u/code и br), вырезая script/style, атрибуты и
         * схлопывая избыточные переносы строк.
         * @param {?string} html - Исходный HTML-фрагмент.
         * @returns {string} Очищенный HTML, либо пустая строка для falsy-значений.
         */
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

        /**
         * Разбирает содержимое главы, присланное как готовая HTML-строка (запасной
         * формат, когда данные главы — не JSON-дерево): разделяет текст и изображения
         * &lt;img&gt;, сохраняя инлайновое форматирование, если оно присутствует.
         * @param {string} str - Исходная HTML-строка содержимого главы.
         * @returns {object[]} Список блоков содержимого (текст/изображения).
         */
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

        /**
         * Рекурсивно извлекает и объединяет чистый текст (без HTML) из узла
         * ProseMirror-дерева, преобразуя hardBreak в перенос строки.
         * @param {*} node - Узел содержимого (объект, строка, либо falsy).
         * @returns {string} Извлечённый текст.
         */
        _extractFromNode(node) {
            if (!node) return '';
            if (typeof node === 'string') return this.stripHtml(node);
            if (node.type === 'text' && node.text) return this.stripHtml(node.text);
            if (node.type === 'hardBreak') return '\n';
            if (Array.isArray(node.content))
                return node.content.map(n => this._extractFromNode(n)).filter(t => t !== '').join('');
            return '';
        }

        /**
         * Извлекает блоки изображений из атрибутов узла типа 'image' ProseMirror-дерева.
         * @param {?{images?: Array<{image?: string}>}} attrs - Атрибуты узла изображения.
         * @returns {{type: 'image', src: string}[]} Список блоков изображений
         * (пропускает элементы без поля image).
         */
        _extractImages(attrs) {
            if (!attrs || !Array.isArray(attrs.images)) return [];
            return attrs.images.flatMap(img => {
                if (img.image) return [{ type: 'image', src: img.image }];
                console.warn('[RanobeLibService] Image node missing image attribute:', img);
                return [];
            });
        }

        /**
         * Извлекает содержимое узла-параграфа: изображения, если параграф состоит
         * из них, иначе текстовый блок с сохранением выравнивания (если не левое)
         * и HTML-представления (если есть инлайновое форматирование).
         * @param {object} item - Узел-параграф ProseMirror-дерева.
         * @returns {object[]} Список из 0 или 1 блока содержимого (либо нескольких
         * блоков изображений).
         */
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

        /**
         * Извлекает содержимое одного узла верхнего уровня дерева главы, выбирая
         * обработку по типу узла (параграф, изображение, разделитель, заголовок/
         * список/цитата — как обычный текст).
         * @param {{type: string}} item - Узел содержимого верхнего уровня.
         * @returns {object[]} Список блоков содержимого, извлечённых из узла.
         */
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

        /**
         * Извлекает список текстовых/изображений-блоков главы: парсит content как
         * JSON ProseMirror-дерево (с распаковкой корневого узла 'doc' при наличии),
         * откатываясь на разбор как готового HTML, если content — не валидный JSON.
         * @param {*} content - Сырое содержимое главы от API (JSON-строка, объект дерева, либо HTML-строка).
         * @returns {object[]} Список блоков содержимого главы.
         */
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

        /**
         * Строит карту "имя вложения → расширение файла" из метаданных главы,
         * используемую для определения расширения изображений, ссылки на которые
         * заданы просто по UUID без расширения.
         * @param {?Array<{name?: string, extension?: string}>} attachments - Список вложений главы.
         * @returns {object} Карта имя → расширение.
         */
        _buildAttachmentMap(attachments) {
            if (!Array.isArray(attachments)) return {};
            const map = {};
            for (const att of attachments) {
                if (att.name && att.extension)
                    map[att.name] = att.extension;
            }
            return map;
        }

        /**
         * Строит базовый URL изображения (без расширения) из ссылки: полного URL,
         * абсолютного пути на ranobelib.me, либо UUID, разрешаемого в путь uploads
         * конкретного тайтла/главы.
         * @param {string} src - Ссылка на изображение из содержимого главы.
         * @param {*} mangaId - id тайтла (для построения пути uploads).
         * @param {*} chapterId - id главы (для построения пути uploads).
         * @returns {string} Базовый URL изображения без расширения файла.
         */
        _resolveBaseUrl(src, mangaId, chapterId) {
            const srcWithoutExt = src.replace(/\.(jpg|jpeg|png|webp|gif)$/i, '');
            if (/^https?:\/\//i.test(src)) return srcWithoutExt;
            if (/^(?:\/\/|\/)/.test(src)) return new URL(srcWithoutExt, 'https://ranobelib.me').toString();
            return `https://ranobelib.me/uploads/ranobe/${mangaId}/chapters/${chapterId}/${srcWithoutExt}`;
        }

        /**
         * Пытается загрузить изображение по базовому URL с указанным расширением.
         * @param {string} baseUrl - Базовый URL изображения без расширения.
         * @param {string} ext - Расширение файла для попытки (jpg, png и т.д.).
         * @returns {Promise<?{base64: string, contentType: string}>} Загруженное
         * изображение, либо null, если запрос не удался.
         */
        async _fetchImageWithExt(baseUrl, ext) {
            const url = `${baseUrl}.${ext}`;
            if (!this.extensionApi?.runtime?.sendMessage) {
                console.error('[RanobeLibService] browser.runtime not available!');
                return null;
            }
            const response = await global.fetchPageImage(url, 'ranobelib');
            if (!response || !response.ok) {
                console.warn(`[RanobeLibService] Failed to fetch ${url}:`, response?.error);
                return null;
            }
            return { base64: response.base64, contentType: response.contentType || 'image/png' };
        }

        /**
         * Загружает и сжимает изображение одного блока: определяет вероятное
         * расширение файла (по самой ссылке или карте вложений) и перебирает
         * известные расширения по порядку, пока загрузка не удастся.
         * @param {{src: string}} block - Блок изображения из содержимого главы.
         * @param {object} attachmentMap - Карта имя вложения → расширение (из _buildAttachmentMap).
         * @param {*} mangaId - id тайтла.
         * @param {*} chapterId - id главы.
         * @param {object} [compressOpts] - Опции сжатия изображения.
         * @returns {Promise<?{type: 'image', data: {base64: string, contentType: string}}>}
         * Готовый блок изображения, либо null, если ни одно расширение не подошло.
         */
        async _processImageBlock(block, attachmentMap, mangaId, chapterId, compressOpts = {}) {
            const isFullUrl = /^https?:\/\//i.test(block.src);
            const isAbsolutePath = /^(?:\/\/|\/)/.test(block.src);
            const isPlainUuid = !isFullUrl && !isAbsolutePath && !/\.(?:jpg|jpeg|png|webp|gif)$/i.test(block.src);

            const [, matchedExt] = block.src.match(/\.(jpg|jpeg|png|webp|gif)$/i) || [];
            const originalExt = isPlainUuid && attachmentMap[block.src]
                ? attachmentMap[block.src]
                : matchedExt || 'jpg';

            const baseUrl = this._resolveBaseUrl(block.src, mangaId, chapterId);
            const extensions = [originalExt, ...['jpg', 'jpeg', 'png', 'webp', 'gif'].filter(e => e !== originalExt)];

            for (const ext of extensions) {
                try {
                    const raw = await this._fetchImageWithExt(baseUrl, ext);
                    if (raw) {
                        const data = global.ImageCompressor
                            ? await global.ImageCompressor.compress(raw.base64, raw.contentType, compressOpts)
                            : raw;
                        return { type: 'image', data };
                    }
                } catch (e) {
                    console.warn('[RanobeLibService] Failed ext:', ext, e);
                }
            }
            console.error('[RanobeLibService] Failed to load image:', block.src);
            return null;
        }

        /**
         * Дополняет извлечённые блоки главы фактическими данными изображений:
         * текстовые блоки пропускаются как есть (пустые отбрасываются), блоки
         * изображений догружаются и сжимаются через _processImageBlock.
         * @param {object[]} extracted - Блоки содержимого главы, извлечённые extractText.
         * @param {*} _status - Не используется (сохранён для единообразия сигнатуры с другими сервисами).
         * @param {object} [opts] - Опции обработки (chapterMeta, mangaId, compressionFormat,
         * compressionQuality, imageFit).
         * @returns {Promise<object[]>} Готовые блоки содержимого главы.
         */
        async processChapterContent(extracted, _status, opts = {}) {
            const chapterMeta = opts.chapterMeta || {};
            const mangaId = opts.mangaId || chapterMeta.manga_id;
            const chapterId = chapterMeta.id;
            const attachmentMap = this._buildAttachmentMap(chapterMeta.attachments);
            const compressOpts = {
                format: opts.compressionFormat || 'image/jpeg',
                quality: opts.compressionQuality || 0.92,
                ...opts.imageFit
            };

            const result = [];
            for (const block of extracted) {
                if (block.type === 'text') {
                    if (block.text && block.text.trim())
                        result.push(block);
                    else console.warn('[RanobeLibService] Skipping empty text block');
                } else if (block.type === 'image' && block.src) {
                    const imageResult = await this._processImageBlock(
                        block, attachmentMap, mangaId, chapterId, compressOpts);
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