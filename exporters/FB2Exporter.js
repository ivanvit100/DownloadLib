/**
 * DownloadLib exporter module
 * Module to export manga as FB2 files
 * @module exporters/FB2Exporter
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[FB2Exporter] Loading...');

    class FB2Exporter {
        escapeXml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }

        firstNameAuthorDescription(author) {
            return `         <first-name>${this.escapeXml(author || 'Unknown')}</first-name>\n`;
        }

        middleNameAuthorDescription(author) {
            return `         <middle-name>${this.escapeXml(author || 'Unknown')}</middle-name>\n`;
        }

        lastNameAuthorDescription(author) {
            return `         <last-name>${this.escapeXml(author || 'Unknown')}</last-name>\n`;
        }

        unknownNameAuthorDescription() {
            return this.firstNameAuthorDescription(null);
        }
		
        *createAuthorsDescription(author) {
            if(author
                && typeof author === 'string') {
                const descriptions = author.split(' ');
                for(let description = 0; description < descriptions.length; ++description) {
                    if(description === 0) {
                        yield this.firstNameAuthorDescription(descriptions[description]);
                    }
                    if(description === 1) {
                        yield this.lastNameAuthorDescription(descriptions[description]);
                    }
                    if(description === 2) {
                        yield this.middleNameAuthorDescription(descriptions[description]);
                    }
                }
            }
            else {
                yield this.unknownNameAuthorDescription();
            }
        }

        *createAuthorsTag(author) {
            yield '     <author>\n';
            for (const value of this.createAuthorsDescription(author)) {
                yield value;
            }
            yield '     </author>\n';
        }

        *createAuthors(authors) {
            if(Array.isArray(authors)) {
                if(authors.length !== 0) {
                    for (const author of authors) {
                        for(const tag of this.createAuthorsTag(author)) {
                            yield tag;
                        }
                    }
                }
                else {
                    for(const tag of this.createAuthorsTag(null)) {
                        yield tag;
                    }
                }
            }
            else {
                for(const tag of this.createAuthorsTag(authors)) {
                    yield tag;
                }
            }
        }

        *createFB2Stream(manga, chapters, coverBase64) {
            yield '<?xml version="1.0" encoding="utf-8"?>\n';
            yield '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">\n';
            
            yield '<description>\n';
            yield '  <title-info>\n';
            yield `    <genre>prose</genre>\n`;
            for(const description of this.createAuthors(manga.authors)) {
                yield description;
            }
            yield `    <book-title>${this.escapeXml(manga.name || 'Unknown')}</book-title>\n`;
            if (coverBase64) {
                yield '    <coverpage>\n';
                yield '    <image l:href="#cover.jpg"/>\n';
                yield '    </coverpage>\n';
            }
            yield `    <lang>ru</lang>\n`;
            yield '  </title-info>\n';
            yield '</description>\n';
            
            if (coverBase64) {
                const coverId = 'cover.jpg';
                const base64Data = coverBase64.includes(',') ? coverBase64.split(',')[1] : coverBase64;
                yield `<binary id="${coverId}" content-type="image/jpeg">${base64Data}</binary>\n`;
            }
            
            let imageCounter = 0;
            for (const chapter of chapters) {
                if (!chapter.content || !Array.isArray(chapter.content)) continue;
                
                for (const block of chapter.content) {
                    if (block.type === 'image' && block.data && block.data.base64) {
                        imageCounter++;
                        const imageId = `image${imageCounter}`;
                        const contentType = block.data.contentType || 'image/jpeg';
                        
                        yield `<binary id="${imageId}" content-type="${contentType}">${block.data.base64}</binary>\n`;
                        
                        block._fb2ImageId = imageId;
                    }
                }
            }
            
            yield '<body>\n';
            
            if (coverBase64) {
                yield '  <section>\n';
                yield '    <title><p>Обложка</p></title>\n';
                yield '    <p><image l:href="#cover.jpg"/></p>\n';
                yield '  </section>\n';
            }
            
            for (const chapter of chapters) {
                yield '  <section>\n';
                yield `    <title><p>${this.escapeXml(chapter.title)}</p></title>\n`;
                
                if (chapter.content && Array.isArray(chapter.content)) {
                    for (const block of chapter.content) {
                        if (block.type === 'text' && block.text) {
                            const lines = block.text.split('\n');
                            for (const line of lines) {
                                const trimmed = line.trim();
                                trimmed ?
                                    yield `    <p>${this.escapeXml(trimmed)}</p>\n` :
                                    yield `    <empty-line/>\n`;
                            }
                        } else if (block.type === 'image' && block._fb2ImageId) {
                            yield `    <p><image l:href="#${block._fb2ImageId}"/></p>\n`;
                        } else console.warn(`[FB2Exporter] Unsupported block type: ${block.type}`);
                    }
                }
                
                yield '  </section>\n';
            }
            
            yield '</body>\n';
            yield '</FictionBook>';
        }

        async export(manga, chapters, coverBase64) {
            const chunks = [];
            for (const chunk of this.createFB2Stream(manga, chapters, coverBase64))
                chunks.push(chunk);
            
            const content = chunks.join('');
            const blob = new Blob([content], { type: 'application/xml' });
            
            const filename = `${manga.name || 'manga'}.fb2`;
            
            return {
                blob,
                filename,
                mimeType: 'application/xml'
            };
        }

        parseFB2(text, filename) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/xml');

            const titleInfo = doc.querySelector('title-info');
            const bookTitle = titleInfo?.querySelector('book-title')?.textContent || filename;
            
            const authors = [];
            const authorNodes = titleInfo?.querySelectorAll('author') || [];
            authorNodes.forEach(author => {
                const firstName = author.querySelector('first-name')?.textContent || '';
                const lastName = author.querySelector('last-name')?.textContent || '';
                const name = [firstName, lastName].filter(Boolean).join(' ');
                if (name) authors.push(name);
                else authors.push('Unknown');
            });

            let cover = '';
            const binary = doc.querySelector('binary[id*="cover"]');
            if (binary) {
                const contentType = binary.getAttribute('content-type') || 'image/jpeg';
                cover = `data:${contentType};base64,${binary.textContent.trim()}`;
            }

            const chapters = [];
            const sections = doc.querySelectorAll('body > section');
            
            sections.forEach((section, idx) => {
                const titleNode = section.querySelector('title');
                const title = titleNode?.textContent?.trim() || `Глава ${idx + 1}`;
                
                const content = [];
                const paragraphs = section.querySelectorAll('p');
                
                paragraphs.forEach(p => {
                    const text = p.textContent.trim();
                    if (text) content.push({ type: 'text', text });
                    else content.push({ type: 'text', text: '' });
                });

                chapters.push({
                    title,
                    content,
                    number: idx + 1,
                    volume: 1
                });
            });

            return {
                metadata: {
                    name: bookTitle,
                    rus_name: bookTitle,
                    authors,
                    summary: ''
                },
                cover,
                chapters
            };
        }
    }

    global.FB2Exporter = FB2Exporter;
    if (global.ExporterRegistry) global.ExporterRegistry.register('fb2', FB2Exporter, { label: 'FB2' });
    console.log('[FB2Exporter] Loaded');
})(typeof window !== 'undefined' ? window : self);
