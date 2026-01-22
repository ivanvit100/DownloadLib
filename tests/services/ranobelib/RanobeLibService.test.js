import { describe, it, expect, vi, beforeEach } from 'vitest';

let RanobeLibService;

beforeEach(async () => {
    global.ranolibConfig = {
        name: 'RanobeLib',
        baseUrl: 'https://ranobelib.me',
        headers: { 'X-Test': '1' },
        fields: ['id', 'title']
    };
    const basePath = require.resolve('../../../services/BaseService.js');
    delete require.cache[basePath];
    await import('../../../services/BaseService.js');
    const path = require.resolve('../../../services/ranobelib/RanobeLibService.js');
    delete require.cache[path];
    await import('../../../services/ranobelib/RanobeLibService.js');
    RanobeLibService = global.RanobeLibService;
});

describe('RanobeLibService', () => {
    it('Constructs and logs', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const svc = new RanobeLibService();
        expect(svc.name).toBe('RanobeLib');
        expect(svc.baseUrl).toBe('https://ranobelib.me');
        expect(svc._mangaIdCache).toBeNull();
        expect(logSpy).toHaveBeenCalledWith('[RanobeLibService] Instance created');
        logSpy.mockRestore();
    });

    it('Matches returns true for ranobelib.me url', () => {
        expect(RanobeLibService.matches('https://ranobelib.me/book')).toBe(true);
        expect(RanobeLibService.matches('https://www.ranobelib.me/')).toBe(true);
    });

    it('Matches returns false for other urls or invalid', () => {
        expect(RanobeLibService.matches('https://example.com')).toBe(false);
        expect(RanobeLibService.matches('not a url')).toBe(false);
    });

    it('Fetch manga metadata returns parsed result and caches id', async () => {
        const svc = new RanobeLibService();
        const fakeJson = { data: { id: 123, title: 'Test' } };
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockResolvedValue(JSON.stringify(fakeJson))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        const result = await svc.fetchMangaMetadata('slug');
        expect(result).toEqual(fakeJson);
        expect(svc._mangaIdCache).toBe(123);
        delete global.fetch;
    });

    it('Fetch manga metadata throws on error response', async () => {
        const svc = new RanobeLibService();
        const fakeResponse = {
            ok: false,
            text: vi.fn().mockResolvedValue('fail')
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(svc.fetchMangaMetadata('slug')).rejects.toThrow('Failed to fetch manga:');
        expect(errorSpy).toHaveBeenCalledWith('[RanobeLibService] Error response:', 'fail');
        errorSpy.mockRestore();
        delete global.fetch;
    });

    it('Fetch chapters list returns parsed result', async () => {
        const svc = new RanobeLibService();
        const fakeJson = [{ id: 1 }];
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockResolvedValue(JSON.stringify(fakeJson))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        const result = await svc.fetchChaptersList('slug');
        expect(result).toEqual(fakeJson);
        delete global.fetch;
    });

    it('Fetch chapters list throws on error response', async () => {
        const svc = new RanobeLibService();
        const fakeResponse = { ok: false, text: vi.fn().mockResolvedValue('fail') };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        await expect(svc.fetchChaptersList('slug')).rejects.toThrow('Failed to fetch chapters:');
        delete global.fetch;
    });

    it('Fetch chapter returns parsed result', async () => {
        const svc = new RanobeLibService();
        const fakeJson = { id: 1, pages: [] };
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockResolvedValue(JSON.stringify(fakeJson))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        const result = await svc.fetchChapter('slug', 2, 3);
        expect(result).toEqual(fakeJson);
        delete global.fetch;
    });

    it('Fetch chapter throws on error response', async () => {
        const svc = new RanobeLibService();
        const fakeResponse = { ok: false, text: vi.fn().mockResolvedValue('fail') };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        await expect(svc.fetchChapter('slug', 1, 1)).rejects.toThrow('Failed to fetch chapter:');
        delete global.fetch;
    });

    it('Extract text parses text and image blocks', () => {
        const svc = new RanobeLibService();
        const content = [
            { type: 'paragraph', content: [{ type: 'text', text: 'abc' }] },
            { type: 'image', attrs: { images: [{ image: 'img1.png' }] } },
            { type: 'horizontalRule' }
        ];
        const result = svc.extractText(content);
        expect(result).toEqual([
            { type: 'text', text: 'abc' },
            { type: 'image', src: 'img1.png' },
            { type: 'text', text: '\n---\n' }
        ]);
    });

    it('Extract text handles stringified JSON', () => {
        const svc = new RanobeLibService();
        const content = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }]);
        const result = svc.extractText(content);
        expect(result).toEqual([{ type: 'text', text: 'abc' }]);
    });

    it('Extract text returns text node for plain string', () => {
        const svc = new RanobeLibService();
        const result = svc.extractText('plain text');
        expect(result).toEqual([{ type: 'text', text: 'plain text' }]);
    });

    it('Extract text returns empty array for invalid', () => {
        const svc = new RanobeLibService();
        expect(svc.extractText(null)).toEqual([]);
        expect(svc.extractText({})).toEqual([]);
    });

    it('Process chapter content returns text blocks as is', async () => {
        const svc = new RanobeLibService();
        const extracted = [{ type: 'text', text: 'abc' }];
        const result = await svc.processChapterContent(extracted, {});
        expect(result).toEqual([{ type: 'text', text: 'abc' }]);
    });

    it('Process chapter content tries all extensions and pushes image', async () => {
        const svc = new RanobeLibService();
        const extracted = [{ type: 'image', src: 'img123.jpg' }];
        svc._mangaIdCache = 1;
        const chapterMeta = { id: 2, manga_id: 1 };
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({
                    ok: true,
                    base64: 'data',
                    contentType: 'image/png'
                })
            }
        };
        const result = await svc.processChapterContent(extracted, {}, { chapterMeta });
        expect(result).toEqual([
            { type: 'image', data: { base64: 'data', contentType: 'image/png' } }
        ]);
        delete global.browser;
    });

    it('Process chapter content logs error', async () => {
        const svc = new RanobeLibService();
        const extracted = [{ type: 'image', src: 'img123.jpg' }];
        svc._mangaIdCache = 1;
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const result = await svc.processChapterContent(extracted, {}, { chapterMeta: { id: 2, manga_id: 1 } });
        expect(errorSpy).toHaveBeenCalledWith('[RanobeLibService] browser.runtime not available!');
        expect(result).toEqual([]);
        errorSpy.mockRestore();
    });

    it('Process chapter content logs error if all image loads fail', async () => {
        const svc = new RanobeLibService();
        const extracted = [{ type: 'image', src: 'img123.jpg' }];
        svc._mangaIdCache = 1;
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockRejectedValue(new Error('fail'))
            }
        };
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await svc.processChapterContent(extracted, {}, { chapterMeta: { id: 2, manga_id: 1 } });
        expect(errorSpy).toHaveBeenCalledWith('[RanobeLibService] Failed to load image:', 'img123');
        expect(result).toEqual([]);
        errorSpy.mockRestore();
        warnSpy.mockRestore();
        delete global.browser;
    });

    it('Fetch manga metadata catch is triggered on error', async () => {
        const svc = new RanobeLibService();
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockRejectedValue(new Error('text fail'))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);

        const result = await svc.fetchMangaMetadata('slug');
        expect(result).toBeNull();
        expect(fakeResponse.text).toHaveBeenCalled();

        delete global.fetch;
    });

    it('Fetch manga metadata catch on error when !response.ok', async () => {
        const svc = new RanobeLibService();
        const fakeResponse = {
            ok: false,
            text: vi.fn().mockRejectedValue(new Error('text fail'))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(svc.fetchMangaMetadata('slug')).rejects.toThrow('Failed to fetch manga:');

        expect(fakeResponse.text).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith('[RanobeLibService] Error response:', '');

        errorSpy.mockRestore();
        delete global.fetch;
    });

    it('Fetch chapters list catch on error', async () => {
        const svc = new RanobeLibService();
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockRejectedValue(new Error('text fail'))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);

        const result = await svc.fetchChaptersList('slug');
        expect(result).toBeNull();
        expect(fakeResponse.text).toHaveBeenCalled();

        delete global.fetch;
    });

    it('Fetch chapter catch on error', async () => {
        const svc = new RanobeLibService();
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockRejectedValue(new Error('text fail'))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);

        const result = await svc.fetchChapter('slug', 1, 1);
        expect(result).toBeNull();
        expect(fakeResponse.text).toHaveBeenCalled();

        delete global.fetch;
    });

    it("Sets volume = '1' when volume is undefined", async () => {
        const svc = new RanobeLibService();
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockResolvedValue(JSON.stringify({ id: 1, pages: [] }))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);

        await svc.fetchChapter('slug', 2);
        const calledUrl = global.fetch.mock.calls[0][0];
        expect(calledUrl).toMatch(/volume=1/);

        delete global.fetch;
    });

    it("Sets number = '1' and volume = '1' when both are undefined", async () => {
        const svc = new RanobeLibService();
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockResolvedValue(JSON.stringify({ id: 1, pages: [] }))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);

        await svc.fetchChapter('slug');
        const calledUrl = global.fetch.mock.calls[0][0];
        expect(calledUrl).toMatch(/number=1/);
        expect(calledUrl).toMatch(/volume=1/);

        delete global.fetch;
    });

    it('Extract text returns [] for non-array', () => {
        const svc = new RanobeLibService();
        const result = svc.extractText({ type: 'doc', content: {} });

        expect(Array.isArray({})).toBe(false);
        expect(result).toEqual([]);
    });

    it('Extract text triggers content = content.content', () => {
        const svc = new RanobeLibService();
        const innerArray = [
            { type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }
        ];
        const result = svc.extractText({ type: 'doc', content: innerArray });

        expect(result).toEqual([{ type: 'text', text: 'abc' }]);
    });

    it("Extract text for cycle trigger", () => {
        const svc = new RanobeLibService();
        const result = svc.extractText([null]);
        expect(result).toEqual([]);
    });

    it("Extract text returns empty string for null child", () => {
        const svc = new RanobeLibService();
        const result = svc.extractText([
            { type: 'paragraph', content: [null] }
        ]);
        expect(result).toEqual([]);
    });

    it("Extract text returns node for string node", () => {
        const svc = new RanobeLibService();
        const result = svc.extractText([
            { type: 'paragraph', content: ['hello world'] }
        ]);
        expect(result).toEqual([{ type: 'text', text: 'hello world' }]);
    });

    it("Extract text returns empty string image", () => {
        const svc = new RanobeLibService();
        const result = svc.extractText([
            { type: 'paragraph', content: [{ type: 'image' }] }
        ]);
        expect(result).toEqual([]);
    });

    it("Extract text returns empty string for object without content", () => {
        const svc = new RanobeLibService();
        const result = svc.extractText([
            { type: 'paragraph', content: [{ foo: 'bar' }] }
        ]);
        expect(result).toEqual([]);
    });

    it("Extract text checks for image in paragraph", () => {
        const svc = new RanobeLibService();
        const result = svc.extractText([
            {
                type: 'paragraph',
                content: [
                    {
                        type: 'image',
                        attrs: {
                            images: [
                                { image: 'img1.png' },
                                { image: 'img2.png' }
                            ]
                        }
                    }
                ]
            }
        ]);
        expect(result).toEqual([
            { type: 'image', src: 'img1.png' },
            { type: 'image', src: 'img2.png' }
        ]);
    });

    it("Extract text missing image attribute", () => {
        const svc = new RanobeLibService();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        svc.extractText([
            {
                type: 'paragraph',
                content: [
                    {
                        type: 'image',
                        attrs: {
                            images: [
                                { notImage: 'nope' }
                            ]
                        }
                    }
                ]
            }
        ]);
        expect(warnSpy).toHaveBeenCalledWith(
            '[RanobeLibService] Image node missing image attribute:',
            { notImage: 'nope' }
        );
        warnSpy.mockRestore();
    });

    it("Extract textwarn for unexpected paragraph content", () => {
        const svc = new RanobeLibService();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        svc.extractText([
            {
                type: 'paragraph',
                content: 'not-an-array'
            }
        ]);
        expect(warnSpy).toHaveBeenCalledWith(
            '[RanobeLibService] Unexpected paragraph content:',
            { type: 'paragraph', content: 'not-an-array' }
        );
        warnSpy.mockRestore();
    });

    it("Extract text warn for image node missing image attribute", () => {
        const svc = new RanobeLibService();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        svc.extractText([
            {
                type: 'image',
                attrs: {
                    images: [
                        { notImage: 'nope' }
                    ]
                }
            }
        ]);
        expect(warnSpy).toHaveBeenCalledWith(
            '[RanobeLibService] Image node missing image attribute:',
            { notImage: 'nope' }
        );
        warnSpy.mockRestore();
    });

    it("Extract text warn for unknown content node type", () => {
        const svc = new RanobeLibService();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        svc.extractText([
            { type: 'foobar', foo: 123 }
        ]);
        expect(warnSpy).toHaveBeenCalledWith(
            '[RanobeLibService] Unknown content node type:',
            { type: 'foobar', foo: 123 }
        );
        warnSpy.mockRestore();
    });

    it("Process chapter content warn for empty text block", async () => {
        const svc = new RanobeLibService();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await svc.processChapterContent([{ type: 'text', text: '   ' }], {});
        expect(warnSpy).toHaveBeenCalledWith('[RanobeLibService] Skipping empty text block');
        warnSpy.mockRestore();
    });

    it("Process chapter content warn for unknown block type", async () => {
        const svc = new RanobeLibService();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await svc.processChapterContent([{ type: 'foobar', foo: 123 }], {});
        expect(warnSpy).toHaveBeenCalledWith(
            '[RanobeLibService] Unknown block type:',
            { type: 'foobar', foo: 123 }
        );
        warnSpy.mockRestore();
    });

    it("Process chapter content warn for no response", async () => {
        const svc = new RanobeLibService();
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'fail' })
            }
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await svc.processChapterContent([{ type: 'image', src: 'img123' }], {}, { chapterMeta: { id: 1, manga_id: 2 } });
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[RanobeLibService] Failed to fetch'),
            'fail'
        );
        warnSpy.mockRestore();
        delete global.browser;
    });

    it("Process chapter content uses default content type if not provided", async () => {
        const svc = new RanobeLibService();
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({
                    ok: true,
                    base64: 'somebase64'
                })
            }
        };
        const result = await svc.processChapterContent(
            [{ type: 'image', src: 'img123.jpg' }],
            {},
            { chapterMeta: { id: 1, manga_id: 2 } }
        );
        expect(result).toEqual([
            {
                type: 'image',
                data: { base64: 'somebase64', contentType: 'image/png' }
            }
        ]);
        delete global.browser;
    });
});