'use strict';

(function(global) {
    console.log('[ImageProcessor] Loading...');

    class ImageProcessor {
        static async splitLongImage(base64Data, contentType) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                const dataUrl = `data:${contentType};base64,${base64Data}`;
                
                img.onload = () => {
                    const A4_RATIO = 297 / 210;
                    const imgRatio = img.height / img.width;
                    
                    if (imgRatio <= A4_RATIO * 1.1) {
                        resolve([{ base64: base64Data, contentType }]);
                        return;
                    }
                    
                    const numParts = Math.ceil(imgRatio / A4_RATIO);
                    const partHeight = Math.floor(img.height / numParts);
                    
                    const parts = [];
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    canvas.width = img.width;
                    
                    for (let i = 0; i < numParts; i++) {
                        const y = i * partHeight;
                        const h = (i === numParts - 1) ? (img.height - y) : partHeight;
                        
                        canvas.height = h;
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, y, img.width, h, 0, 0, img.width, h);
                        
                        const partDataUrl = canvas.toDataURL(contentType || 'image/jpeg', 0.95);
                        const partBase64 = partDataUrl.split(',')[1];
                        
                        parts.push({
                            base64: partBase64,
                            contentType: contentType || 'image/jpeg'
                        });
                    }
                    
                    resolve(parts);
                };
                
                img.onerror = () => {
                    console.warn('[ImageProcessor] Failed to load image');
                    resolve([{ base64: base64Data, contentType }]);
                };
                
                img.src = dataUrl;
            });
        }

        static async blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        static async urlToBase64(url, headers = {}) {
            const response = await fetch(url, { headers });
            const blob = await response.blob();
            return this.blobToBase64(blob);
        }
    }

    global.ImageProcessor = ImageProcessor;
    console.log('[ImageProcessor] Loaded');
})(window);