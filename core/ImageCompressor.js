/**
 * DownloadLib core module
 * Compresses images via canvas with minimal perceptible quality loss
 * @module core/ImageCompressor
 * @license MIT
 * @author ivanvit
 * @version 1.0.9
 */

'use strict';

(function(global) {
    console.log('[ImageCompressor] Loading...');

    class ImageCompressor {
        static compress(base64, contentType, options = {}) {
            const { quality = 0.92, format = 'image/jpeg' } = options;

            return new Promise((resolve) => {
                const img = new Image();

                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');

                    if (format === 'image/jpeg') {
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }

                    ctx.drawImage(img, 0, 0);

                    const dataUrl = canvas.toDataURL(format, quality);
                    const [, compressed] = dataUrl.split(',');
                    resolve({ base64: compressed, contentType: format });
                };

                img.onerror = () => {
                    console.warn('[ImageCompressor] Failed to load image, keeping original');
                    resolve({ base64, contentType });
                };

                img.src = `data:${contentType};base64,${base64}`;
            });
        }
    }

    global.ImageCompressor = ImageCompressor;
    console.log('[ImageCompressor] Loaded');
})(typeof window !== 'undefined' ? window : self);
