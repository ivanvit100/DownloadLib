/**
 * DownloadLib content script
 * Proxies image fetch requests from the background page through the page's tab context
 * @module content/ImageFetcher
 * @license MIT
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function imageFetcher() {
    const _api = (typeof browser !== 'undefined' && browser) || (typeof chrome !== 'undefined' && chrome) || null;
    if (!_api || !_api.runtime) return;

    /**
     * Обрабатывает сообщение 'fetchImageFromTab' от background-скрипта: загружает
     * изображение по URL в контексте вкладки (в обход CORS/rate-limit ограничений
     * фонового контекста) и возвращает его содержимое в виде base64.
     * @param {{action: string, url: string}} message - Сообщение с URL изображения для загрузки.
     * @param {object} _sender - Отправитель сообщения (не используется).
     * @param {function({ok: boolean, base64?: string, contentType?: string, error?: string}): void} sendResponse
     * Функция отправки ответа.
     * @returns {boolean} true, если сообщение обработано и ответ будет отправлен асинхронно;
     * false, если action не 'fetchImageFromTab'.
     */
    _api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message.action !== 'fetchImageFromTab') return false;

        fetch(message.url)
            .then(r => {
                if (!r.ok) { sendResponse({ ok: false, error: `HTTP ${r.status}` }); return; }
                return r.blob();
            })
            .then(blob => {
                if (!blob) return;
                const reader = new FileReader();
                reader.onloadend = () => sendResponse({
                    ok: true,
                    base64: reader.result.split(',')[1],
                    contentType: blob.type || 'image/jpeg'
                });
                reader.readAsDataURL(blob);
            })
            .catch(e => sendResponse({ ok: false, error: String(e) }));

        return true;
    });
})();
