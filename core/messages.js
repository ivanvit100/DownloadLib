/**
 * DownloadLib core module
 * Runtime message protocol between extension pages, content scripts and the background
 * @module core/messages
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

/**
 * Значения поля `action` runtime-сообщений, которые обрабатывает фон.
 * Строки `openDownloadWindow`, `plugin:exec` и `plugin:cache` также используются
 * вне модулей (content script кнопки загрузки, плагины) и не меняются.
 */
export const MSG = Object.freeze({
    GET_AUTH_TOKEN: 'getAuthToken',
    CACHE_AUTH_TOKEN: 'cacheAuthToken',
    AUTH_INVALIDATE: 'authInvalidate',
    RATE_ACQUIRE: 'rateAcquire',
    RATE_THROTTLE: 'rateThrottle',
    OPEN_DOWNLOAD_WINDOW: 'openDownloadWindow',
    OPEN_WINDOW_WITH_URL: 'openWindowWithUrl',
    PLUGIN_CACHE: 'plugin:cache',
    PLUGIN_EXEC: 'plugin:exec'
});

/**
 * Имя long-lived порта, который окно загрузки держит открытым,
 * чтобы service worker не выгружался во время загрузки.
 */
export const PORT_KEEP_ALIVE = 'downloadKeepAlive';
