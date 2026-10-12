import { describe, it, expect, vi, afterEach } from 'vitest';
import { base64ToBytes, blobToBase64, blobToDataUrl } from '../../core/encoding.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

/**
 * Подменяет FileReader: readAsDataURL вызывает указанный обработчик.
 * @param {'onerror'|'onabort'} event - Событие.
 * @param {object} [fields] - Поля читателя.
 * @returns {void}
 */
function stubReader(event, fields = {}) {
    vi.stubGlobal('FileReader', vi.fn(function FakeReader() {
        this.readAsDataURL = () => {
            Object.assign(this, fields);
            this[event]();
        };
    }));
}

describe('encoding', () => {
    it('blobToDataUrl reads a Blob as a data-URL', async () => {
        await expect(blobToDataUrl(new Blob(['hi'], { type: 'text/plain' }))).resolves.toBe('data:text/plain;base64,aGk=');
    });

    it('blobToBase64 returns base64 without the data: prefix', async () => {
        await expect(blobToBase64(new Blob(['hi'], { type: 'text/plain' }))).resolves.toBe('aGk=');
    });

    it('Rejects when FileReader fails', async () => {
        stubReader('onerror', { error: new Error('disk') });
        await expect(blobToDataUrl(new Blob(['x']))).rejects.toThrow('Failed to read blob: disk');
    });

    it('Rejects when FileReader is aborted', async () => {
        stubReader('onabort');
        await expect(blobToBase64(new Blob(['x']))).rejects.toThrow('Failed to read blob: aborted');
    });

    it('base64ToBytes decodes base64 and skips whitespace', () => {
        expect([...base64ToBytes('aGk=')]).toEqual([104, 105]);
        expect([...base64ToBytes(' AAE\nC/w== ')]).toEqual([0, 1, 2, 255]);
        expect(base64ToBytes('')).toEqual(new Uint8Array(0));
    });
});
