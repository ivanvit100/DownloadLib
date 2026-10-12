/**
 * DownloadLib core module
 * Compresses, fits and splits images without touching the DOM
 * @module core/ImageCompressor
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { base64ToBytes, blobToBase64 } from './encoding.js';

console.log('[ImageCompressor] Loading...');

/** Соотношение высоты к ширине страницы A4: по нему режутся длинные изображения. */
export const PAGE_ASPECT = 297 / 210;

/** Насколько часть может быть выше предела, прежде чем изображение режется. */
const SPLIT_TOLERANCE = 1.1;

/**
 * Делит изображение по высоте на части не выше предела: min(ширина × splitAspect,
 * maxPartHeight). Изображение, превышающее предел не больше чем на 10%, не режется.
 * Части одинаковой высоты, последняя забирает остаток.
 * @param {number} width - Ширина изображения.
 * @param {number} height - Высота изображения.
 * @param {?number} splitAspect - Отношение высоты части к ширине, либо null — без ограничения.
 * @param {number} maxPartHeight - Максимальная высота части в пикселях.
 * @returns {{y: number, h: number}[]} Части: смещение и высота.
 */
function splitPlan(width, height, splitAspect, maxPartHeight) {
    const limit = Math.min(splitAspect ? width * splitAspect : Infinity, maxPartHeight);
    if (!Number.isFinite(limit) || limit <= 0 || height <= limit * SPLIT_TOLERANCE) return [{ y: 0, h: height }];
    const count = Math.ceil(height / limit);
    const partHeight = Math.floor(height / count);
    return Array.from({ length: count }, (_, i) => ({
        y: i * partHeight,
        h: i === count - 1 ? height - i * partHeight : partHeight
    }));
}

/**
 * Утилита обработки изображений: декодирует один раз через createImageBitmap,
 * вписывает в габариты, режет длинные изображения на части и кодирует каждую часть
 * один раз через OffscreenCanvas.convertToBlob. Не использует document и не
 * блокирует главный поток кодированием.
 */
export class ImageCompressor {
    /**
     * Обрабатывает изображение: при необходимости режет его по высоте на части,
     * вписывает каждую часть в габариты (без увеличения) и перекодирует.
     * Если изображение не удалось декодировать, возвращает его без изменений.
     * @param {string} base64 - Исходное изображение в base64 (без префикса data:).
     * @param {string} contentType - MIME-тип исходного изображения.
     * @param {{maxWidth?: number, maxHeight?: number, splitAspect?: ?number,
     * maxPartHeight?: number, format?: string, quality?: number}} [options] - Габариты,
     * в которые вписывается каждая часть; правило нарезки (см. splitPlan; без
     * splitAspect и maxPartHeight изображение не режется); формат и качество кодирования.
     * @returns {Promise<{base64: string, contentType: string}[]>} Части изображения
     * (одна, если нарезка не потребовалась).
     */
    static async process(base64, contentType, {
        maxWidth = Infinity, maxHeight = Infinity, splitAspect = null, maxPartHeight = Infinity,
        format = 'image/jpeg', quality = 0.92
    } = {}) {
        let bitmap;
        try {
            bitmap = await createImageBitmap(new Blob([base64ToBytes(base64)], { type: contentType }));
        } catch (e) {
            console.warn('[ImageCompressor] Failed to decode image, keeping original:', e?.message || e);
            return [{ base64, contentType }];
        }

        try {
            const { width, height } = bitmap;
            const parts = splitPlan(width, height, splitAspect, maxPartHeight);
            if (parts.length > 1)
                console.log(`[ImageCompressor] Split ${width}x${height} image into ${parts.length} parts`);

            const result = [];
            for (const { y, h } of parts) {
                const scale = Math.min(1, maxWidth / width, maxHeight / h);
                const outWidth = Math.max(1, Math.round(width * scale));
                const outHeight = Math.max(1, Math.round(h * scale));
                const canvas = new OffscreenCanvas(outWidth, outHeight);
                const ctx = canvas.getContext('2d');
                if (format === 'image/jpeg') {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, outWidth, outHeight);
                }
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(bitmap, 0, y, width, h, 0, 0, outWidth, outHeight);
                const blob = await canvas.convertToBlob({ type: format, quality });
                result.push({ base64: await blobToBase64(blob), contentType: blob.type || format });
            }
            return result;
        } finally {
            bitmap.close?.();
        }
    }

    /**
     * Перекодирует изображение с заданным качеством/форматом, при необходимости
     * пропорционально уменьшая его (не увеличивая) до габаритов. Без нарезки.
     * При ошибке декодирования возвращает исходное изображение без изменений.
     * @param {string} base64 - Исходное содержимое изображения в base64 (без префикса data:).
     * @param {string} contentType - MIME-тип исходного изображения.
     * @param {{quality?: number, format?: string, maxWidth?: number, maxHeight?: number}} [options]
     * Качество сжатия (0-1), целевой MIME-тип и необязательные габариты.
     * @returns {Promise<{base64: string, contentType: string}>} Сжатое (или исходное
     * при ошибке) содержимое изображения и его MIME-тип.
     */
    static async compress(base64, contentType, options = {}) {
        const { quality, format, maxWidth, maxHeight } = options;
        const [image] = await ImageCompressor.process(base64, contentType, { quality, format, maxWidth, maxHeight });
        return image;
    }
}

console.log('[ImageCompressor] Loaded');
