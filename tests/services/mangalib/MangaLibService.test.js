import { describe, it, expect, vi, beforeEach } from 'vitest';

let MangaLibService;

beforeEach(async () => {
    global.mangalibConfig = {
        name: 'MangaLib',
        baseUrl: 'https://mangalib.me',
        headers: { 'X-Test': '1' },
        fields: ['id', 'title'],
        imagesDomain: 'https://imgslib.link'
    };
    const basePath = require.resolve('../../../services/BaseService.js');
    delete require.cache[basePath];
    await import('../../../services/BaseService.js');
    const path = require.resolve('../../../services/mangalib/MangaLibService.js');
    delete require.cache[path];
    await import('../../../services/mangalib/MangaLibService.js');
    MangaLibService = global.MangaLibService;
});

describe('MangaLibService', () => {
    it('Constructs and logs', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const svc = new MangaLibService();
        expect(svc.name).toBe('MangaLib');
        expect(svc.baseUrl).toBe('https://mangalib.me');
        expect(svc._imageCache).toBeInstanceOf(Map);
        expect(logSpy).toHaveBeenCalledWith('[MangaLibService] Instance created');
        logSpy.mockRestore();
    });

    it('Matches returns true for mangalib.me and imgslib.link', () => {
        expect(MangaLibService.matches('https://mangalib.me/book')).toBe(true);
        expect(MangaLibService.matches('https://imgslib.link/')).toBe(true);
    });

    it('Matches returns false for other urls or invalid', () => {
        expect(MangaLibService.matches('https://example.com')).toBe(false);
        expect(MangaLibService.matches('not a url')).toBe(false);
    });

    it('Fetch manga metadata returns parsed result', async () => {
        const svc = new MangaLibService();
        const fakeJson = { id: 123, title: 'Test' };
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockResolvedValue(JSON.stringify(fakeJson))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        const result = await svc.fetchMangaMetadata('slug');
        expect(result).toEqual(fakeJson);
        delete global.fetch;
    });

    it('Fetch manga metadata throws on error response', async () => {
        const svc = new MangaLibService();
        const fakeResponse = {
            ok: false,
            text: vi.fn().mockResolvedValue('fail')
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(svc.fetchMangaMetadata('slug')).rejects.toThrow('Failed to fetch manga:');
        expect(errorSpy).toHaveBeenCalledWith('[MangaLibService] Error response:', 'fail');
        errorSpy.mockRestore();
        delete global.fetch;
    });

    it('Fetch chapters list returns parsed result', async () => {
        const svc = new MangaLibService();
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
        const svc = new MangaLibService();
        const fakeResponse = { ok: false, text: vi.fn().mockResolvedValue('fail') };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        await expect(svc.fetchChaptersList('slug')).rejects.toThrow('Failed to fetch chapters:');
        delete global.fetch;
    });

    it('Fetch chapter returns parsed result', async () => {
        const svc = new MangaLibService();
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
        const svc = new MangaLibService();
        const fakeResponse = { ok: false, text: vi.fn().mockResolvedValue('fail') };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);
        await expect(svc.fetchChapter('slug', 1, 1)).rejects.toThrow('Failed to fetch chapter:');
        delete global.fetch;
    });

    it('Extract pages returns correct array for known keys', () => {
        const svc = new MangaLibService();
        expect(svc.extractPages({ pages: [1, 2, 3] })).toEqual([1, 2, 3]);
        expect(svc.extractPages({ images: ['a'] })).toEqual(['a']);
        expect(svc.extractPages({ pages_list: [5] })).toEqual([5]);
        expect(svc.extractPages({ content: ['x', 'y'] })).toEqual(['x', 'y']);
    });

    it('Extract pages returns empty array if no known keys', () => {
        const svc = new MangaLibService();
        expect(svc.extractPages({})).toEqual([]);
        expect(svc.extractPages({ foo: [1, 2] })).toEqual([]);
        expect(svc.extractPages({ pages: [] })).toEqual([]);
    });

    it('Extract text returns image objects for string pages', () => {
        const svc = new MangaLibService();
        const result = svc.extractText({ pages: ['img1.jpg', 'img2.jpg'] });
        expect(result).toEqual([
            { type: 'image', src: 'img1.jpg' },
            { type: 'image', src: 'img2.jpg' }
        ]);
    });

    it('Extract text returns image objects for page objects', () => {
        const svc = new MangaLibService();
        const result = svc.extractText({ pages: [
            { filename: 'img1.jpg' },
            { url: 'img2.jpg' },
            { src: 'img3.jpg' }
        ] });
        expect(result).toEqual([
            { type: 'image', src: 'img1.jpg' },
            { type: 'image', src: 'img2.jpg' },
            { type: 'image', src: 'img3.jpg' }
        ]);
    });

    it('Extract text returns empty array for no pages', () => {
        const svc = new MangaLibService();
        expect(svc.extractText({ pages: [] })).toEqual([]);
        expect(svc.extractText(null)).toEqual([]);
    });

    it('Resolve page url returns correct url for string', () => {
        const svc = new MangaLibService();
        expect(svc.resolvePageUrl('https://imgslib.link/img.jpg')).toBe('https://imgslib.link/img.jpg');
        expect(svc.resolvePageUrl('/img.jpg')).toBe('https://imgslib.link/img.jpg');
        expect(svc.resolvePageUrl('img.jpg')).toBe('https://imgslib.link/img.jpg');
    });

    it('Resolve page url returns correct url for object', () => {
        const svc = new MangaLibService();
        expect(svc.resolvePageUrl({ filename: 'img1.jpg' })).toBe('https://imgslib.link/img1.jpg');
        expect(svc.resolvePageUrl({ url: '/img2.jpg' })).toBe('https://imgslib.link/img2.jpg');
        expect(svc.resolvePageUrl({ src: 'img3.jpg' })).toBe('https://imgslib.link/img3.jpg');
    });

    it('Resolve page url returns null for falsy', () => {
        const svc = new MangaLibService();
        expect(svc.resolvePageUrl(null)).toBeNull();
        expect(svc.resolvePageUrl(undefined)).toBeNull();
    });

    it('Split long image resolves with one part for normal image', async () => {
        const svc = new MangaLibService();
        global.Image = class {
            set src(val) { setTimeout(() => this.onload(), 0); }
            get height() { return 210; }
            get width() { return 297; }
        };
        global.document = {
            createElement: () => ({
                getContext: () => ({
                    clearRect: () => {},
                    drawImage: () => {}
                }),
                toDataURL: () => 'data:image/jpeg;base64,abc'
            })
        };
        const result = await svc.splitLongImage('abc', 'image/jpeg');
        expect(result).toEqual([{ base64: 'abc', contentType: 'image/jpeg' }]);
        delete global.Image;
        delete global.document;
    });

    it('Split long image resolves with multiple parts for long image', async () => {
        const svc = new MangaLibService();
        global.Image = class {
            set src(val) { setTimeout(() => this.onload(), 0); }
            get height() { return 1000; }
            get width() { return 210; }
        };
        global.document = {
            createElement: () => ({
                getContext: () => ({
                    clearRect: () => {},
                    drawImage: () => {}
                }),
                toDataURL: () => 'data:image/jpeg;base64,part'
            })
        };
        const result = await svc.splitLongImage('abc', 'image/jpeg');
        expect(result.length).toBeGreaterThan(1);
        delete global.Image;
        delete global.document;
    });

    it('Split long image resolves with one part on error', async () => {
        const svc = new MangaLibService();
        global.Image = class {
            set src(val) { setTimeout(() => this.onerror(), 0); }
        };
        global.document = {
            createElement: () => ({
                getContext: () => ({}),
                toDataURL: () => 'data:image/jpeg;base64,abc'
            })
        };
        const result = await svc.splitLongImage('abc', 'image/jpeg');
        expect(result).toEqual([{ base64: 'abc', contentType: 'image/jpeg' }]);
        delete global.Image;
        delete global.document;
    });

    it('Load page as base64 returns null for falsy ref', async () => {
        const svc = new MangaLibService();
        const result = await svc.loadPageAsBase64(null);
        expect(result).toBeNull();
    });

    it('Load page as base64 returns null if url cannot be resolved', async () => {
        const svc = new MangaLibService();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await svc.loadPageAsBase64({});
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith('[MangaLibService] Could not resolve page url for', {});
        warnSpy.mockRestore();
    });

    it('Load page as base64 returns cached image', async () => {
        const svc = new MangaLibService();
        const url = 'https://imgslib.link/img.jpg';
        svc._imageCache.set(url, { base64: 'abc', contentType: 'image/jpeg' });
        const result = await svc.loadPageAsBase64(url);
        expect(result).toEqual({ base64: 'abc', contentType: 'image/jpeg' });
    });

    it('loadPageAsBase64 returns null if browser.runtime not available', async () => {
        const svc = new MangaLibService();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const result = await svc.loadPageAsBase64('img.jpg');
        expect(result).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith('[MangaLibService] browser.runtime not available!');
        errorSpy.mockRestore();
    });

    it('Load page as base64 returns null if response not ok', async () => {
        const svc = new MangaLibService();
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'fail' })
            }
        };
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await svc.loadPageAsBase64('img.jpg');
        expect(result).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith('[MangaLibService] Failed to fetch https://imgslib.link/img.jpg:', 'fail');
        warnSpy.mockRestore();
        delete global.browser;
    });

    it('Load page as base64 returns split images if splitLongImages is true', async () => {
        const svc = new MangaLibService();
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'abc', contentType: 'image/jpeg' })
            }
        };
        svc.splitLongImage = vi.fn().mockResolvedValue([
            { base64: 'part1', contentType: 'image/jpeg' },
            { base64: 'part2', contentType: 'image/jpeg' }
        ]);
        const result = await svc.loadPageAsBase64('img.jpg', { splitLongImages: true });
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(2);
        delete global.browser;
    });

    it('Load page as base64 returns single image if splitLongImages is false', async () => {
        const svc = new MangaLibService();
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'part1', contentType: 'image/jpeg' })
            }
        };
        svc.splitLongImage = vi.fn().mockResolvedValue([
            { base64: 'part1', contentType: 'image/jpeg' }
        ]);
        const result = await svc.loadPageAsBase64('img.jpg', { splitLongImages: false });
        expect(result).toEqual({ base64: 'part1', contentType: 'image/jpeg' });
        delete global.browser;
    });

    it('Load page as base64 returns single image if splitLongImages is true but only one part', async () => {
        const svc = new MangaLibService();
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({ ok: true, base64: 'part1', contentType: 'image/jpeg' })
            }
        };
        svc.splitLongImage = vi.fn().mockResolvedValue([
            { base64: 'part1', contentType: 'image/jpeg' }
        ]);
        const result = await svc.loadPageAsBase64('img.jpg', { splitLongImages: true });
        expect(result).toEqual({ base64: 'part1', contentType: 'image/jpeg' });
        delete global.browser;
    });

    it('Load page as base64 returns null on error', async () => {
        const svc = new MangaLibService();
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockRejectedValue(new Error('fail'))
            }
        };
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const result = await svc.loadPageAsBase64('img.jpg');
        expect(result).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith('[MangaLibService] loadPageAsBase64 error', expect.any(Error));
        errorSpy.mockRestore();
        delete global.browser;
    });

    it('Process chapter content returns image blocks for loaded pages', async () => {
        const svc = new MangaLibService();
        svc.extractPages = vi.fn().mockReturnValue(['img1.jpg', 'img2.jpg']);
        svc.loadPageAsBase64 = vi.fn()
            .mockResolvedValueOnce({ base64: 'abc', contentType: 'image/jpeg' })
            .mockResolvedValueOnce({ base64: 'def', contentType: 'image/jpeg' });
        const result = await svc.processChapterContent([], null, { chapterMeta: { pages: ['img1.jpg', 'img2.jpg'] } });
        expect(result.length).toBe(2);
        expect(result[0].type).toBe('image');
        expect(result[1].type).toBe('image');
    });

    it('Process chapter content returns error text for failed image', async () => {
        const svc = new MangaLibService();
        svc.extractPages = vi.fn().mockReturnValue(['img1.jpg']);
        svc.loadPageAsBase64 = vi.fn().mockResolvedValue(null);
        const result = await svc.processChapterContent([], null, { chapterMeta: { pages: ['img1.jpg'] } });
        expect(result[0].type).toBe('text');
        expect(result[0].text).toMatch(/Ошибка загрузки изображения/);
    });

    it('Process chapter content returns split images as blocks', async () => {
        const svc = new MangaLibService();
        svc.extractPages = vi.fn().mockReturnValue(['img1.jpg']);
        svc.loadPageAsBase64 = vi.fn().mockResolvedValue([
            { base64: 'part1', contentType: 'image/jpeg' },
            { base64: 'part2', contentType: 'image/jpeg' }
        ]);
        const result = await svc.processChapterContent([], null, { chapterMeta: { pages: ['img1.jpg'] } });
        expect(result.length).toBe(2);
        expect(result[0].type).toBe('image');
        expect(result[1].type).toBe('image');
        expect(result[0].data.base64).toBe('part1');
        expect(result[1].data.base64).toBe('part2');
    });

    it('Process chapter content updates status text', async () => {
        const svc = new MangaLibService();
        svc.extractPages = vi.fn().mockReturnValue(['img1.jpg']);
        svc.loadPageAsBase64 = vi.fn().mockResolvedValue({ base64: 'abc', contentType: 'image/jpeg' });
        const status = { textContent: '' };
        await svc.processChapterContent([], status, { chapterMeta: { pages: ['img1.jpg'] } });
        expect(status.textContent).toMatch(/Загружено страниц: 1\/1/);
    });

    it('Process chapter content falls back to extracted src if no pages', async () => {
        const svc = new MangaLibService();
        svc.extractPages = vi.fn().mockReturnValue([]);
        svc.loadPageAsBase64 = vi.fn().mockResolvedValue({ base64: 'abc', contentType: 'image/jpeg' });
        const result = await svc.processChapterContent([{ src: 'img1.jpg' }], null, {});
        expect(result.length).toBe(1);
        expect(result[0].type).toBe('image');
    });

    it('Process chapter content handles empty pages and extracted', async () => {
        const svc = new MangaLibService();
        svc.extractPages = vi.fn().mockReturnValue([]);
        svc.loadPageAsBase64 = vi.fn().mockResolvedValue({ base64: 'abc', contentType: 'image/jpeg' });
        const result = await svc.processChapterContent([], null, {});
        expect(result.length).toBe(0);
    });

    it('Fetch manga metadata catch error', async () => {
        const svc = new MangaLibService();
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

    it('Fetch manga metadata catch when response text throws', async () => {
        const svc = new MangaLibService();
        const fakeResponse = {
            ok: false,
            status: 500,
            text: vi.fn().mockRejectedValue(new Error('text fail'))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(svc.fetchMangaMetadata('slug')).rejects.toThrow('Failed to fetch manga: 500');
        expect(fakeResponse.text).toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith('[MangaLibService] Error response:', '');

        errorSpy.mockRestore();
        delete global.fetch;
    });

    it('Fetch chapters list catch throws', async () => {
        const svc = new MangaLibService();
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

    it('Fetch chapter catch throws', async () => {
        const svc = new MangaLibService();
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

    it('Fetch chapter uses default volume when not provided', async () => {
        const svc = new MangaLibService();
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockResolvedValue(JSON.stringify({ id: 1, pages: [] }))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);

        await svc.fetchChapter('slug', 5);

        const calledUrl = global.fetch.mock.calls[0][0];
        expect(calledUrl).toMatch(/volume=1/);

        delete global.fetch;
    });

    it('Fetch chapter triggers params set defaults', async () => {
        const svc = new MangaLibService();
        const fakeResponse = {
            ok: true,
            text: vi.fn().mockResolvedValue(JSON.stringify({ id: 1, pages: [] }))
        };
        global.fetch = vi.fn().mockResolvedValue(fakeResponse);

        await svc.fetchChapter('slug');

        const calledUrl = global.fetch.mock.calls[0][0];
        expect(calledUrl).toMatch(/numer=1/);

        delete global.fetch;
    });

    it('Extract text returns object for unknown page object', () => {
        const svc = new MangaLibService();
        const result = svc.extractText({ pages: [{ foo: 123 }] });
        expect(result).toEqual([
            { type: 'image', src: '[object Object]' }
        ]);
    });

    it('Resolve page url sets defaults filename for unknown type', () => {
        const svc = new MangaLibService();
        const input = { foo: 123 };
        const result = svc.resolvePageUrl(input);
        expect(result).toBe('https://imgslib.link/[object Object]');
    });

    it('Split long image covers both content type "image/jpeg" branches', async () => {
        const svc = new MangaLibService();

        global.Image = class {
            set src(val) { setTimeout(() => this.onload(), 0); }
            get height() { return 1000; } 
            get width() { return 210; }
        };
        let toDataURLCalls = [];
        global.document = {
            createElement: () => ({
                getContext: () => ({
                    clearRect: () => {},
                    drawImage: () => {}
                }),
                toDataURL: (type) => {
                    toDataURLCalls.push(type);
                    return `data:${type};base64,abc`;
                }
            })
        };

        const result = await svc.splitLongImage('abc');
        expect(toDataURLCalls.every(t => t === 'image/jpeg')).toBe(true);
        expect(result.every(part => part.contentType === 'image/jpeg')).toBe(true);

        delete global.Image;
        delete global.document;
    });

    it('Load page as base64 covers content type  "image/jpeg" branch', async () => {
        const svc = new MangaLibService();
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({
                    ok: true,
                    base64: 'abc'
                })
            }
        };
        svc.splitLongImage = vi.fn().mockResolvedValue([
            { base64: 'abc', contentType: 'image/jpeg' }
        ]);
        const result = await svc.loadPageAsBase64('img.jpg');
        expect(result).toEqual({ base64: 'abc', contentType: 'image/jpeg' });
        delete global.browser;
    });

    it('Load page as base64 works with filename', async () => {
        const svc = new MangaLibService();
        const resolveSpy = vi.spyOn(svc, 'resolvePageUrl').mockReturnValue('https://imgslib.link/img1.jpg');
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({
                    ok: true,
                    base64: 'abc',
                    contentType: 'image/jpeg'
                })
            }
        };
        svc.splitLongImage = vi.fn().mockResolvedValue([
            { base64: 'abc', contentType: 'image/jpeg' }
        ]);
        const result = await svc.loadPageAsBase64({ filename: 'img1.jpg' });
        expect(resolveSpy).toHaveBeenCalledWith('img1.jpg');
        expect(result).toEqual({ base64: 'abc', contentType: 'image/jpeg' });
        delete global.browser;
        resolveSpy.mockRestore();
    });

    it('Load page as base64 works with url', async () => {
        const svc = new MangaLibService();
        const resolveSpy = vi.spyOn(svc, 'resolvePageUrl').mockReturnValue('https://imgslib.link/img2.jpg');
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({
                    ok: true,
                    base64: 'abc',
                    contentType: 'image/jpeg'
                })
            }
        };
        svc.splitLongImage = vi.fn().mockResolvedValue([
            { base64: 'abc', contentType: 'image/jpeg' }
        ]);
        const result1 = await svc.loadPageAsBase64({ url: 'https://imgslib.link/img2.jpg' });
        expect(resolveSpy).not.toHaveBeenCalled();
        expect(result1).toEqual({ base64: 'abc', contentType: 'image/jpeg' });

        const result2 = await svc.loadPageAsBase64({ url: '/img2.jpg' });
        expect(resolveSpy).toHaveBeenCalledWith('/img2.jpg');
        expect(result2).toEqual({ base64: 'abc', contentType: 'image/jpeg' });

        delete global.browser;
        resolveSpy.mockRestore();
    });

    it('Load page as base64 works with src', async () => {
        const svc = new MangaLibService();
        const resolveSpy = vi.spyOn(svc, 'resolvePageUrl').mockReturnValue('https://imgslib.link/img3.jpg');
        global.browser = {
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({
                    ok: true,
                    base64: 'abc',
                    contentType: 'image/jpeg'
                })
            }
        };
        svc.splitLongImage = vi.fn().mockResolvedValue([
            { base64: 'abc', contentType: 'image/jpeg' }
        ]);
        const result = await svc.loadPageAsBase64({ src: 'img3.jpg' });
        expect(resolveSpy).toHaveBeenCalledWith('img3.jpg');
        expect(result).toEqual({ base64: 'abc', contentType: 'image/jpeg' });
        delete global.browser;
        resolveSpy.mockRestore();
    });

    it('Process chapter content uses default when opts not provided', async () => {
        const svc = new MangaLibService();
        svc.extractPages = vi.fn().mockReturnValue(['img1.jpg']);
        svc.loadPageAsBase64 = vi.fn().mockResolvedValue({ base64: 'abc', contentType: 'image/jpeg' });

        const result = await svc.processChapterContent([], null);

        expect(result).toEqual([
            {
                type: 'image',
                id: expect.stringMatching(/^manga_img_/),
                data: { base64: 'abc', contentType: 'image/jpeg' },
                originalIndex: 0
            }
        ]);
        expect(svc.extractPages).toHaveBeenCalledWith({});
    });

    it('Process chapter content triggers extractPages(chapterObj)', async () => {
        const svc = new MangaLibService();
        const extractPagesSpy = vi.spyOn(svc, 'extractPages').mockImplementation(obj => {
            if (obj && obj.fromObj) return ['img_from_obj.jpg'];
            if (Object.keys(obj).length === 0) return null; 
            return null;
        });
        svc.loadPageAsBase64 = vi.fn().mockResolvedValue({ base64: 'abc', contentType: 'image/jpeg' });

        const result = await svc.processChapterContent([], null, { chapterObj: { fromObj: true } });

        expect(extractPagesSpy).toHaveBeenCalledWith({});
        expect(extractPagesSpy).toHaveBeenCalledWith({ fromObj: true });
        expect(result).toEqual([
            {
                type: 'image',
                id: expect.stringMatching(/^manga_img_/),
                data: { base64: 'abc', contentType: 'image/jpeg' },
                originalIndex: 0
            }
        ]);
        extractPagesSpy.mockRestore();
    });

    it('Process chapter content triggers fallback when extractPages returns null', async () => {
        const svc = new MangaLibService();
        const extractPagesSpy = vi.spyOn(svc, 'extractPages').mockReturnValue(null);
        svc.loadPageAsBase64 = vi.fn().mockResolvedValue({ base64: 'abc', contentType: 'image/jpeg' });

        const result = await svc.processChapterContent([], null, {});

        expect(extractPagesSpy).toHaveBeenCalledWith({});
        expect(extractPagesSpy).toHaveBeenCalledWith({});
        expect(result).toEqual([]);

        extractPagesSpy.mockRestore();
    });

    it('Process chapter content sets pages = [] on error', async () => {
        const svc = new MangaLibService();
        svc.extractPages = vi.fn(() => { throw new Error('fail'); });
        svc.loadPageAsBase64 = vi.fn();

        const result = await svc.processChapterContent([], null, { chapterMeta: { pages: ['img1.jpg'] } });

        expect(result).toEqual([]);
        expect(svc.loadPageAsBase64).not.toHaveBeenCalled();
    });

    it('Process chapter content catch for loadPageAsBase64 error', async () => {
        const svc = new MangaLibService();
        svc.extractPages = vi.fn().mockReturnValue(['img1.jpg']);
        svc.loadPageAsBase64 = vi.fn().mockRejectedValue(new Error('fail'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = await svc.processChapterContent([], null, { chapterMeta: { pages: ['img1.jpg'] } });

        expect(result).toEqual([
            { type: 'text', text: expect.stringMatching(/Ошибка загрузки изображения 1/) }
        ]);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('[MangaLibService] Failed to load page 0:'),
            expect.any(Error)
        );

        warnSpy.mockRestore();
    });
});