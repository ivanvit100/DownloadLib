import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

describe('ImageFetcher', () => {
    let capturedMessageCb;

    beforeEach(async () => {
        vi.resetModules();
        capturedMessageCb = null;

        global.FileReader = class {
            readAsDataURL() {
                setTimeout(() => {
                    this.result = 'data:image/jpeg;base64,AAAA';
                    this.onloadend();
                }, 0);
            }
        };

        global.browser = {
            runtime: {
                onMessage: {
                    addListener: vi.fn(cb => { capturedMessageCb = cb; })
                }
            }
        };

        await import('../../content/ImageFetcher.js');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
    });

    it('Registers onMessage listener', () => {
        expect(capturedMessageCb).not.toBeNull();
    });

    it('Returns false for non-fetchImageFromTab messages', () => {
        const result = capturedMessageCb({ action: 'other' }, {}, vi.fn());
        expect(result).toBe(false);
    });

    it('Fetches image and returns base64 on success', async () => {
        const blob = new Blob(['img'], { type: 'image/jpeg' });
        global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) });

        const sendResponse = vi.fn();
        capturedMessageCb({ action: 'fetchImageFromTab', url: 'https://img.mixlib.me/a.jpg' }, {}, sendResponse);

        await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({ ok: true, base64: expect.any(String), contentType: 'image/jpeg' })
        );
    });

    it('Returns error when fetch response is not ok', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });

        const sendResponse = vi.fn();
        capturedMessageCb({ action: 'fetchImageFromTab', url: 'https://img.mixlib.me/a.jpg' }, {}, sendResponse);

        await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
        expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'HTTP 403' });
    });

    it('Falls back to image/jpeg when blob type is empty', async () => {
        const blob = new Blob(['img'], { type: '' });
        global.fetch = vi.fn().mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) });

        const sendResponse = vi.fn();
        capturedMessageCb({ action: 'fetchImageFromTab', url: 'https://img.mixlib.me/a.jpg' }, {}, sendResponse);

        await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
        expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image/jpeg' }));
    });

    it('Returns error when fetch throws', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

        const sendResponse = vi.fn();
        capturedMessageCb({ action: 'fetchImageFromTab', url: 'https://img.mixlib.me/a.jpg' }, {}, sendResponse);

        await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
        expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: expect.stringContaining('network error') });
    });

    it('Does not register listener when no runtime API available', async () => {
        vi.resetModules();
        delete global.browser;
        delete global.chrome;

        const previousCb = capturedMessageCb;
        await import('../../content/ImageFetcher.js');
        expect(capturedMessageCb).toBe(previousCb);
    });

    it('Uses chrome API when browser is not defined', async () => {
        vi.resetModules();
        delete global.browser;

        let chromeCb = null;
        global.chrome = {
            runtime: {
                onMessage: { addListener: vi.fn(cb => { chromeCb = cb; }) }
            }
        };

        await import('../../content/ImageFetcher.js');
        expect(chromeCb).not.toBeNull();
    });
});
