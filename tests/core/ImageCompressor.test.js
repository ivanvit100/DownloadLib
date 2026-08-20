import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function makeCanvas({ fillRect = vi.fn(), drawImage = vi.fn(), toDataURL } = {}) {
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: '', fillRect, drawImage }),
        toDataURL: toDataURL || vi.fn(() => 'data:image/jpeg;base64,compressed==')
    };
    return { canvas, fillRect };
}

function makeImage({ naturalWidth = 200, naturalHeight = 400, fail = false } = {}) {
    return class {
        constructor() {
            this.naturalWidth = naturalWidth;
            this.naturalHeight = naturalHeight;
        }
        set src(_) {
            if (fail) setTimeout(() => this.onerror && this.onerror(), 0);
            else setTimeout(() => this.onload && this.onload(), 0);
        }
    };
}

async function freshImport() {
    vi.resetModules();
    delete global.ImageCompressor;
    await import('../../core/ImageCompressor.js');
    return global.ImageCompressor;
}

afterEach(() => {
    delete global.ImageCompressor;
    delete global.Image;
    delete global.document;
});

describe('ImageCompressor — module loading', () => {
    it('registers on global and logs on load', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const cls = await freshImport();
        expect(cls).toBeDefined();
        expect(logSpy).toHaveBeenCalledWith('[ImageCompressor] Loading...');
        expect(logSpy).toHaveBeenCalledWith('[ImageCompressor] Loaded');
        logSpy.mockRestore();
    });
});

describe('ImageCompressor — compress()', () => {
    let ImageCompressor;

    beforeEach(async () => {
        ImageCompressor = await freshImport();
    });

    it('compresses to JPEG by default and extracts base64', async () => {
        const { canvas } = makeCanvas({
            toDataURL: vi.fn(() => 'data:image/jpeg;base64,result==')
        });
        global.Image = makeImage();
        global.document = { createElement: () => canvas };

        const result = await ImageCompressor.compress('input', 'image/png');
        expect(result).toEqual({ base64: 'result==', contentType: 'image/jpeg' });
    });

    it('fills white background when output format is JPEG', async () => {
        const fillRect = vi.fn();
        const { canvas } = makeCanvas({ fillRect });
        global.Image = makeImage();
        global.document = { createElement: () => canvas };

        await ImageCompressor.compress('input', 'image/png', { format: 'image/jpeg' });
        expect(fillRect).toHaveBeenCalledWith(0, 0, expect.any(Number), expect.any(Number));
    });

    it('compresses to WebP when format is specified', async () => {
        const { canvas } = makeCanvas({
            toDataURL: vi.fn(() => 'data:image/webp;base64,webpdata=')
        });
        global.Image = makeImage();
        global.document = { createElement: () => canvas };

        const result = await ImageCompressor.compress('input', 'image/png', { format: 'image/webp' });
        expect(result).toEqual({ base64: 'webpdata=', contentType: 'image/webp' });
    });

    it('does not fill background for non-JPEG format', async () => {
        const fillRect = vi.fn();
        const { canvas } = makeCanvas({
            fillRect,
            toDataURL: vi.fn(() => 'data:image/webp;base64,x')
        });
        global.Image = makeImage();
        global.document = { createElement: () => canvas };

        await ImageCompressor.compress('input', 'image/png', { format: 'image/webp' });
        expect(fillRect).not.toHaveBeenCalled();
    });

    it('sets canvas dimensions from image natural size', async () => {
        const { canvas } = makeCanvas();
        global.Image = makeImage({ naturalWidth: 800, naturalHeight: 1200 });
        global.document = { createElement: () => canvas };

        await ImageCompressor.compress('input', 'image/jpeg');
        expect(canvas.width).toBe(800);
        expect(canvas.height).toBe(1200);
    });

    it('passes specified quality to toDataURL', async () => {
        const toDataURL = vi.fn(() => 'data:image/jpeg;base64,q');
        const { canvas } = makeCanvas({ toDataURL });
        global.Image = makeImage();
        global.document = { createElement: () => canvas };

        await ImageCompressor.compress('input', 'image/jpeg', { quality: 0.75 });
        expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.75);
    });

    it('defaults quality to 0.92', async () => {
        const toDataURL = vi.fn(() => 'data:image/jpeg;base64,q');
        const { canvas } = makeCanvas({ toDataURL });
        global.Image = makeImage();
        global.document = { createElement: () => canvas };

        await ImageCompressor.compress('input', 'image/png');
        expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.92);
    });

    it('sets img.src to the correct data URL', async () => {
        let capturedSrc = null;
        global.Image = class {
            constructor() { this.naturalWidth = 10; this.naturalHeight = 10; }
            set src(v) { capturedSrc = v; setTimeout(() => this.onload && this.onload(), 0); }
        };
        const { canvas } = makeCanvas();
        global.document = { createElement: () => canvas };

        await ImageCompressor.compress('mydata==', 'image/webp');
        expect(capturedSrc).toBe('data:image/webp;base64,mydata==');
    });

    it('resolves with original data when image fails to load', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        global.Image = makeImage({ fail: true });

        const result = await ImageCompressor.compress('original==', 'image/png');
        expect(result).toEqual({ base64: 'original==', contentType: 'image/png' });
        warnSpy.mockRestore();
    });

    it('logs warning when image fails to load', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        global.Image = makeImage({ fail: true });

        await ImageCompressor.compress('input', 'image/jpeg');
        expect(warnSpy).toHaveBeenCalledWith('[ImageCompressor] Failed to load image, keeping original');
        warnSpy.mockRestore();
    });
});
