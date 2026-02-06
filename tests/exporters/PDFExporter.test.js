import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

let PDFExporter;

function mockCanvas() {
    const origCreateElement = document.createElement;
    document.createElement = function(tag) {
        if (tag === 'canvas') {
            return {
                width: 0,
                height: 0,
                getContext: () => ({
                    font: '',
                    fillStyle: '',
                    textBaseline: '',
                    textAlign: '',
                    fillRect: vi.fn(),
                    fillText: vi.fn(),
                    measureText: () => ({ width: 100 }),
                }),
                toDataURL: () => 'data:image/jpeg;base64,canvasdata'
            };
        }
        return origCreateElement.call(document, tag);
    };
    return origCreateElement;
}

beforeEach(async () => {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
    window.document = dom.window.document;
    window.Image = dom.window.Image;
    await import('../../exporters/PDFExporter.js');
    PDFExporter = window.PDFExporter;
});

describe('PDFExporter', () => {
    let exporter;
    beforeEach(() => {
        exporter = new PDFExporter();
    });

    it('Sanitizes filename', () => {
        const unsafe = 'bad:name<>|/\\?*.pdf';
        const safe = exporter.sanitizeFilename(unsafe);
        expect(safe).not.toMatch(/[<>:"/\\|?*]/);
        expect(safe.length).toBeLessThanOrEqual(200);
    });

    it('Renders text to canvas returns data url', () => {
        const origCreateElement = mockCanvas();
        const dataUrl = exporter.renderTextToCanvas('Hello\nWorld', 'Title');
        expect(dataUrl).toContain('data:image/jpeg');
        document.createElement = origCreateElement;
    });

    it('Splits text into pages', () => {
        const origCreateElement = mockCanvas();
        const pages = exporter.splitTextIntoPages('Hello\nWorld\n'.repeat(50), 'Title');
        expect(Array.isArray(pages)).toBe(true);
        expect(pages.length).toBeGreaterThan(0);
        document.createElement = origCreateElement;
    });

    it('Returns input if already data url', async () => {
        const url = 'data:image/jpeg;base64,abc123';
        const result = await exporter.ensureDataUrl(url);
        expect(result).toBe(url);
    });

    it('Returns data url for base64 string', async () => {
        const base64 = 'a'.repeat(120);
        const result = await exporter.ensureDataUrl(base64);
        expect(result).toContain('data:image/jpeg;base64,');
    });

    it('Returns null for invalid input', async () => {
        expect(await exporter.ensureDataUrl('')).toBeNull();
        expect(await exporter.ensureDataUrl(null)).toBeNull();
        expect(await exporter.ensureDataUrl('notbase64')).toBeNull();
    });

    it('Delays for specified ms', async () => {
        const start = Date.now();
        await exporter.delay(10);
        expect(Date.now() - start).toBeGreaterThanOrEqual(9);
    });

    it('Throws if html2pdf is not loaded', async () => {
        window.html2pdf = undefined;
        await expect(exporter.export({}, [], undefined)).rejects.toThrow('html2pdf library not loaded');
    });

    it('Returns blob, filename and mimeType', async () => {
        const origCreateElement = mockCanvas();
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: (type) => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 200
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 200;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test Manga' };
        const chapters = [
            { title: 'Chapter 1', content: [{ type: 'text', text: 'Hello world' }] }
        ];
        const result = await exporter.export(manga, chapters, undefined);
        expect(result.blob).toBe('blob');
        expect(result.filename).toBe('Test Manga.pdf');
        expect(result.mimeType).toBe('application/pdf');
        document.createElement = origCreateElement;
    });

    it('Includes cover image if provided', async () => {
        const origCreateElement = mockCanvas();
        let coverAdded = false;
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: (type) => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 200
                                }
                            },
                            addPage: vi.fn(),
                            addImage: (...args) => {
                                if (args[0].includes('coverdata')) coverAdded = true;
                            },
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 200;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test Manga' };
        const chapters = [];
        await exporter.export(manga, chapters, 'data:image/jpeg;base64,coverdata');
        expect(coverAdded).toBe(true);
        document.createElement = origCreateElement;
    });

    it('Renders chapter text and images', async () => {
        const origCreateElement = mockCanvas();
        let imageAdded = false;
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: (type) => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 200
                                }
                            },
                            addPage: vi.fn(),
                            addImage: (...args) => {
                                if (args[0].includes('imgdata')) imageAdded = true;
                            },
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 200;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test Manga' };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'text', text: 'Hello world' },
                { type: 'image', data: { base64: 'imgdata', contentType: 'image/jpeg' } }
            ]}
        ];
        await exporter.export(manga, chapters, undefined);
        expect(imageAdded).toBe(true);
        document.createElement = origCreateElement;
    });

    it('Renders text to canvas without titleText', () => {
        const origCreateElement = mockCanvas();
        const dataUrl = exporter.renderTextToCanvas('Hello\nWorld');
        expect(dataUrl).toContain('data:image/jpeg');
        document.createElement = origCreateElement;
    });

    it('Handles empty paragraph in renderTextToCanvas', () => {
        const origCreateElement = mockCanvas();
        const dataUrl = exporter.renderTextToCanvas('Hello\n\nWorld');
        expect(dataUrl).toContain('data:image/jpeg');
        document.createElement = origCreateElement;
    });

    it('Triggers line break branch', () => {
        const origCreateElement = mockCanvas();
        let fillTextCalled = false;
        document.createElement = function(tag) {
            if (tag === 'canvas') {
                return {
                    width: 0,
                    height: 0,
                    getContext: () => ({
                        font: '',
                        fillStyle: '',
                        textBaseline: '',
                        textAlign: '',
                        fillRect: vi.fn(),
                        fillText: () => { fillTextCalled = true; },
                        measureText: (str) => ({ width: str.length > 10 ? 2000 : 10 }),
                    }),
                    toDataURL: () => 'data:image/jpeg;base64,canvasdata'
                };
            }
            return origCreateElement.call(document, tag);
        };
        const dataUrl = exporter.renderTextToCanvas('averyverylongword anotherlongword', null);
        expect(dataUrl).toContain('data:image/jpeg');
        expect(fillTextCalled).toBe(true);
        document.createElement = origCreateElement;
    });

    it('Triggers break on page overflow', () => {
        const origCreateElement = mockCanvas();
        document.createElement = function(tag) {
            if (tag === 'canvas') {
                return {
                    width: 0,
                    height: 0,
                    getContext: () => ({
                        font: '',
                        fillStyle: '',
                        textBaseline: '',
                        textAlign: '',
                        fillRect: vi.fn(),
                        fillText: vi.fn(),
                        measureText: (str) => ({
                            width: str.length > 1 ? 2000 : 10
                        }),
                    }),
                    toDataURL: () => 'data:image/jpeg;base64,canvasdata'
                };
            }
            return origCreateElement.call(document, tag);
        };
        const dataUrl = exporter.renderTextToCanvas('word '.repeat(500), null);
        expect(dataUrl).toContain('data:image/jpeg');
        document.createElement = origCreateElement;
    });

    it('Splits text into pages without firstPageTitle', () => {
        const origCreateElement = mockCanvas();
        const pages = exporter.splitTextIntoPages('Hello\nWorld');
        expect(Array.isArray(pages)).toBe(true);
        document.createElement = origCreateElement;
    });

    it('Warns on skipping empty paragraph due to page limit', () => {
        const origCreateElement = mockCanvas();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const origFloor = Math.floor;
        Math.floor = () => 1;
        exporter.splitTextIntoPages('\n\n\n\n\n\n\n\n\n\n');
        expect(warnSpy).toHaveBeenCalledWith('[PDFExporter] Skipping empty paragraph due to page limit');
        Math.floor = origFloor;
        warnSpy.mockRestore();
        document.createElement = origCreateElement;
    });

    it('Pushes line to paragraphLines in splitTextIntoPages', () => {
        const origCreateElement = mockCanvas();
        let pushedLine = null;
        document.createElement = function(tag) {
            if (tag === 'canvas') {
                return {
                    width: 0,
                    height: 0,
                    getContext: () => ({
                        font: '',
                        fillStyle: '',
                        textBaseline: '',
                        textAlign: '',
                        fillRect: vi.fn(),
                        fillText: vi.fn(),
                        measureText: (str) => ({ width: str.length > 5 ? 2000 : 10 }),
                    }),
                    toDataURL: () => 'data:image/jpeg;base64,canvasdata'
                };
            }
            return origCreateElement.call(document, tag);
        };
        const pages = exporter.splitTextIntoPages('longword anotherword');
        expect(Array.isArray(pages)).toBe(true);
        document.createElement = origCreateElement;
    });

    it('Warns on skipping empty line in paragraph', () => {
        const origCreateElement = mockCanvas();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const origSplit = String.prototype.split;
        String.prototype.split = function(...args) {
            const result = origSplit.apply(this, args);
            if (args[0] && args[0].toString() === '/\\s+/') {
                return ['', ''];
            }
            return result;
        };
        exporter.splitTextIntoPages('test');
        expect(warnSpy).toHaveBeenCalledWith('[PDFExporter] Skipping empty line in paragraph');
        String.prototype.split = origSplit;
        warnSpy.mockRestore();
        document.createElement = origCreateElement;
    });

    it('Resizes image if height exceeds maxH in export', async () => {
        const origCreateElement = mockCanvas();
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 50
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 100;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test' };
        const chapters = [];
        await exporter.export(manga, chapters, 'data:image/jpeg;base64,coverdata');
        document.createElement = origCreateElement;
    });

    it('Warns on invalid cover image data in export', async () => {
        const origCreateElement = mockCanvas();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        const manga = { name: 'Test' };
        const chapters = [];
        await exporter.export(manga, chapters, 'invalid_base64_string');
        expect(warnSpy).toHaveBeenCalledWith('[PDFExporter] Invalid cover image data, skipping cover page');
        warnSpy.mockRestore();
        document.createElement = origCreateElement;
    });

    it('Appends newline when chapterText is not empty in export', async () => {
        const origCreateElement = mockCanvas();
        let receivedText = null;
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: (dataUrl, type, x, y, w, h) => {},
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 100;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test' };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'text', text: 'first' },
                { type: 'text', text: 'second' }
            ]}
        ];
        const origSplitTextIntoPages = exporter.splitTextIntoPages;
        exporter.splitTextIntoPages = (text, title) => {
            receivedText = text;
            return [text];
        };
        await exporter.export(manga, chapters, undefined);
        expect(receivedText).toContain('\n');
        exporter.splitTextIntoPages = origSplitTextIntoPages;
        document.createElement = origCreateElement;
    });

    it('Warns on skipping empty text block in chapter content', async () => {
        const origCreateElement = mockCanvas();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 100;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test' };
        const chapters = [
            { title: 'Chapter 1', content: [{ type: 'text', text: null }] }
        ];
        await exporter.export(manga, chapters, undefined);
        expect(warnSpy).toHaveBeenCalledWith('[PDFExporter] Unsupported block type in chapter content: text');
        warnSpy.mockRestore();
        document.createElement = origCreateElement;
    });

    it('Warns on skipping empty text block in chapter content', async () => {
        const origCreateElement = mockCanvas();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 100;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test' };
        const chapters = [
            { title: 'Chapter 1', content: [{ type: 'text', text: '   ' }] }
        ];
        await exporter.export(manga, chapters, undefined);
        expect(warnSpy).toHaveBeenCalledWith('[PDFExporter] Skipping empty text block in chapter content');
        warnSpy.mockRestore();
        document.createElement = origCreateElement;
    });

    it('Warns on chapter content not being an array in export', async () => {
        const origCreateElement = mockCanvas();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 100;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test' };
        const chapters = [
            { title: 'Chapter 1', content: 'not_an_array' }
        ];
        await exporter.export(manga, chapters, undefined);
        expect(warnSpy).toHaveBeenCalledWith('[PDFExporter] Chapter content is not an array, skipping chapter content processing');
        warnSpy.mockRestore();
        document.createElement = origCreateElement;
    });

    it('Uses default chapter title if title is missing in export', async () => {
        const origCreateElement = mockCanvas();
        let receivedTitle = null;
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 100;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test' };
        const chapters = [
            { content: [{ type: 'text', text: 'abc' }] }
        ];
        const origSplitTextIntoPages = exporter.splitTextIntoPages;
        exporter.splitTextIntoPages = (text, title) => {
            receivedTitle = title;
            return [text];
        };
        await exporter.export(manga, chapters, undefined);
        expect(receivedTitle).toBe('Глава 1');
        exporter.splitTextIntoPages = origSplitTextIntoPages;
        document.createElement = origCreateElement;
    });

    it('Passes null as titleForPage for non-first text page in export', async () => {
        const origCreateElement = mockCanvas();
        let receivedTitles = [];
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 100;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test' };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'text', text: 'first page content\n\nsecond page content\n\nthird page content' }
            ]}
        ];
        const origSplitTextIntoPages = exporter.splitTextIntoPages;
        exporter.splitTextIntoPages = (text, title) => {
            return ['page1', 'page2'];
        };
        const origRenderTextToCanvas = exporter.renderTextToCanvas;
        exporter.renderTextToCanvas = (text, titleText) => {
            receivedTitles.push(titleText);
            return 'data:image/jpeg;base64,canvasdata';
        };
        await exporter.export(manga, chapters, undefined);
        expect(receivedTitles[0]).toBe('Chapter 1');
        expect(receivedTitles[1]).toBe(null);
        exporter.splitTextIntoPages = origSplitTextIntoPages;
        exporter.renderTextToCanvas = origRenderTextToCanvas;
        document.createElement = origCreateElement;
    });

    it('Delays after every 5th image page in export', async () => {
        const origCreateElement = mockCanvas();
        let delayCalled = 0;
        const origDelay = exporter.delay;
        exporter.delay = async (ms) => { delayCalled++; return Promise.resolve(); };
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 100;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test' };
        const images = Array(6).fill(null).map(() => ({ 
            type: 'image', 
            data: { base64: 'imgdata', contentType: 'image/jpeg' } 
        }));
        const chapters = [
            { title: 'Chapter 1', content: images }
        ];
        await exporter.export(manga, chapters, undefined);
        expect(delayCalled).toBeGreaterThan(0);
        exporter.delay = origDelay;
        document.createElement = origCreateElement;
    });

    it('Delays after every 10th text page in export', async () => {
        const origCreateElement = mockCanvas();
        let delayCalled = 0;
        const origDelay = exporter.delay;
        exporter.delay = async (ms) => { delayCalled++; return Promise.resolve(); };
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 100;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test' };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'text', text: Array(11).fill('page').join('\n\n') }
            ]}
        ];
        const origSplitTextIntoPages = exporter.splitTextIntoPages;
        exporter.splitTextIntoPages = (text, title) => {
            return Array(11).fill('page');
        };
        await exporter.export(manga, chapters, undefined);
        expect(delayCalled).toBeGreaterThan(0);
        exporter.splitTextIntoPages = origSplitTextIntoPages;
        exporter.delay = origDelay;
        document.createElement = origCreateElement;
    });

    it('Resizes chapter image if height exceeds maxH in export', async () => {
        const origCreateElement = mockCanvas();
        let resizedW = null;
        let resizedH = null;
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: (dataUrl, type, x, y, w, h) => {
                                if (dataUrl.includes('imgdata')) {
                                    resizedW = w;
                                    resizedH = h;
                                }
                            },
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 50;
                this.height = 200;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = { name: 'Test' };
        const chapters = [
            { title: 'Chapter 1', content: [
                { type: 'image', data: { base64: 'imgdata', contentType: 'image/jpeg' } }
            ]}
        ];
        await exporter.export(manga, chapters, undefined);
        expect(resizedH).toBe(80);
        expect(resizedW).toBeLessThan(80);
        document.createElement = origCreateElement;
    });

    it('Uses fallback filename manga if manga name and rus_name are missing in export', async () => {
        const origCreateElement = mockCanvas();
        window.html2pdf = () => ({
            set: () => ({
                from: () => ({
                    toPdf: () => ({
                        get: () => Promise.resolve({
                            internal: {
                                pageSize: {
                                    getWidth: () => 100,
                                    getHeight: () => 100
                                }
                            },
                            addPage: vi.fn(),
                            addImage: vi.fn(),
                            output: () => 'blob'
                        })
                    })
                })
            })
        });
        window.Image = class {
            constructor() {
                this.src = '';
                this.width = 100;
                this.height = 100;
                setTimeout(() => {
                    if (this.onload) this.onload();
                }, 1);
            }
        };
        const manga = {};
        const chapters = [];
        const result = await exporter.export(manga, chapters, undefined);
        expect(result.filename).toBe('manga.pdf');
        document.createElement = origCreateElement;
    });
});