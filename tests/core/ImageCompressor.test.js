import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let ImageCompressor, PAGE_ASPECT;
let canvases;
let bitmap;

/**
 * Подменяет createImageBitmap и OffscreenCanvas: каждый холст запоминает размер
 * и вызовы рисования, а convertToBlob возвращает Blob с описанием части.
 * @param {{width?: number, height?: number, decodeFails?: boolean, blobType?: string}} [options] -
 * Размер декодированного изображения, ошибка декодирования, тип результата.
 * @returns {void}
 */
function stubCanvas({ width = 800, height = 1000, decodeFails = false, blobType } = {}) {
    canvases = [];
    bitmap = { width, height, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
        if (decodeFails) throw new Error('bad image');
        return bitmap;
    }));
    vi.stubGlobal('OffscreenCanvas', class {
        constructor(w, h) {
            this.width = w;
            this.height = h;
            this.ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '', imageSmoothingQuality: '' };
            canvases.push(this);
        }
        getContext() { return this.ctx; }
        async convertToBlob({ type, quality }) {
            return new Blob([`${this.width}x${this.height}@${quality}`], { type: blobType ?? type });
        }
    });
}

const decode = base64 => atob(base64);

beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    ({ ImageCompressor, PAGE_ASPECT } = await import('../../core/ImageCompressor.js'));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('ImageCompressor.process', () => {
    it('Decodes the image once and encodes it once with the format and quality', async () => {
        stubCanvas();
        const parts = await ImageCompressor.process(btoa('raw'), 'image/png', { format: 'image/webp', quality: 0.8 });
        expect(parts).toHaveLength(1);
        expect(parts[0].contentType).toBe('image/webp');
        expect(decode(parts[0].base64)).toBe('800x1000@0.8');
        expect(createImageBitmap).toHaveBeenCalledTimes(1);
        const [blob] = createImageBitmap.mock.calls[0];
        expect(blob.type).toBe('image/png');
        expect(bitmap.close).toHaveBeenCalled();
    });

    it('Fills the background white for JPEG only', async () => {
        stubCanvas();
        await ImageCompressor.process(btoa('raw'), 'image/png');
        expect(canvases[0].ctx.fillStyle).toBe('#ffffff');
        expect(canvases[0].ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 1000);

        await ImageCompressor.process(btoa('raw'), 'image/png', { format: 'image/png' });
        expect(canvases[1].ctx.fillRect).not.toHaveBeenCalled();
    });

    it('Fits the image into the box without upscaling', async () => {
        stubCanvas({ width: 1000, height: 2000 });
        await ImageCompressor.process(btoa('raw'), 'image/jpeg', { maxWidth: 560, maxHeight: 740 });
        expect([canvases[0].width, canvases[0].height]).toEqual([370, 740]);

        await ImageCompressor.process(btoa('raw'), 'image/jpeg', { maxWidth: 5000, maxHeight: 5000 });
        expect([canvases[1].width, canvases[1].height]).toEqual([1000, 2000]);
    });

    it('Does not split an image that fits the page aspect (with 10% tolerance)', async () => {
        stubCanvas({ width: 1000, height: Math.floor(1000 * PAGE_ASPECT * 1.1) });
        const parts = await ImageCompressor.process(btoa('raw'), 'image/jpeg', { splitAspect: PAGE_ASPECT });
        expect(parts).toHaveLength(1);
    });

    it('Splits a long image into equal parts no taller than an A4 page', async () => {
        stubCanvas({ width: 1000, height: 5000 });
        const parts = await ImageCompressor.process(btoa('raw'), 'image/jpeg', { splitAspect: PAGE_ASPECT });
        expect(parts).toHaveLength(4);
        expect(canvases.map(c => c.height)).toEqual([1250, 1250, 1250, 1250]);
        expect(canvases[1].ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 1250, 1000, 1250, 0, 0, 1000, 1250);
        expect(createImageBitmap).toHaveBeenCalledTimes(1);
    });

    it('Gives the remainder to the last part', async () => {
        stubCanvas({ width: 100, height: 1001 });
        await ImageCompressor.process(btoa('raw'), 'image/jpeg', { splitAspect: 2 });
        expect(canvases.map(c => c.height)).toEqual([166, 166, 166, 166, 166, 171]);
    });

    it('Limits the part height by maxPartHeight for wide images', async () => {
        stubCanvas({ width: 2000, height: 7200 });
        const parts = await ImageCompressor.process(btoa('raw'), 'image/jpeg', { splitAspect: PAGE_ASPECT, maxPartHeight: 1800 });
        expect(parts).toHaveLength(4);
        expect(canvases.every(c => c.height === 1800)).toBe(true);
    });

    it('Fits every part into the box', async () => {
        stubCanvas({ width: 1000, height: 5000 });
        await ImageCompressor.process(btoa('raw'), 'image/jpeg', { splitAspect: PAGE_ASPECT, maxWidth: 500 });
        expect(canvases.map(c => [c.width, c.height])).toEqual([[500, 625], [500, 625], [500, 625], [500, 625]]);
    });

    it('Uses the type of the encoded blob (the browser may fall back to PNG)', async () => {
        stubCanvas({ blobType: 'image/png' });
        const [part] = await ImageCompressor.process(btoa('raw'), 'image/jpeg', { format: 'image/webp' });
        expect(part.contentType).toBe('image/png');
    });

    it('Keeps the original image when it cannot be decoded', async () => {
        stubCanvas({ decodeFails: true });
        const parts = await ImageCompressor.process('b3JpZw==', 'image/gif', { splitAspect: PAGE_ASPECT });
        expect(parts).toEqual([{ base64: 'b3JpZw==', contentType: 'image/gif' }]);
        expect(console.warn).toHaveBeenCalledWith('[ImageCompressor] Failed to decode image, keeping original:', 'bad image');
    });

    it('Does not need document', async () => {
        stubCanvas();
        vi.stubGlobal('document', undefined);
        await expect(ImageCompressor.process(btoa('raw'), 'image/png')).resolves.toHaveLength(1);
    });
});

describe('ImageCompressor.compress', () => {
    it('Keeps its signature and returns one image', async () => {
        stubCanvas({ width: 1000, height: 5000 });
        const result = await ImageCompressor.compress(btoa('raw'), 'image/png', { quality: 0.5, maxWidth: 100 });
        expect(result.contentType).toBe('image/jpeg');
        expect(decode(result.base64)).toBe('100x500@0.5');
        expect(canvases).toHaveLength(1);
    });

    it('Defaults to JPEG with quality 0.92', async () => {
        stubCanvas();
        const result = await ImageCompressor.compress(btoa('raw'), 'image/png');
        expect(decode(result.base64)).toBe('800x1000@0.92');
        expect(result.contentType).toBe('image/jpeg');
    });

    it('Returns the original image when it cannot be decoded', async () => {
        stubCanvas({ decodeFails: true });
        await expect(ImageCompressor.compress('b3JpZw==', 'image/png')).resolves.toEqual({ base64: 'b3JpZw==', contentType: 'image/png' });
    });
});
