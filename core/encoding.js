/**
 * DownloadLib core module
 * Conversions between Blob, data-URL, base64 and bytes
 * @module core/encoding
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

/**
 * Читает Blob как data-URL.
 * @param {Blob} blob - Исходный Blob.
 * @returns {Promise<string>} data-URL вида 'data:<type>;base64,<данные>'.
 * @throws {Error} Если чтение не удалось или было прервано.
 */
export function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(`Failed to read blob: ${reader.error?.message || reader.error || 'unknown error'}`));
        reader.onabort = () => reject(new Error('Failed to read blob: aborted'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Кодирует Blob в base64 (без префикса data:).
 * @param {Blob} blob - Исходный Blob.
 * @returns {Promise<string>} Содержимое в base64.
 * @throws {Error} Если чтение не удалось или было прервано.
 */
export async function blobToBase64(blob) {
    const dataUrl = await blobToDataUrl(blob);
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/**
 * Декодирует base64 в байты. Пробельные символы допустимы и пропускаются.
 * @param {string} base64 - Строка base64 (без префикса data:).
 * @returns {Uint8Array} Декодированные байты.
 */
export function base64ToBytes(base64) {
    const binary = atob(String(base64).replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}
