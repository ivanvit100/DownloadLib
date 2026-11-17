/**
 * DownloadLib core module
 * Runtime message protocol between extension pages, content scripts and the background
 * @module core/MessageTypes
 * @license MIT
 * @author ivanvit
 * @version 1.1.2
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
    DOWNLOAD_REQUEST: 'downloadRequest',
    QUEUE_NEXT: 'queueNext',
    QUEUE_REMOVE: 'queueRemove',
    QUEUE_CLEAR: 'queueClear',
    QUEUE_START: 'queueStart',
    PLUGIN_CACHE: 'plugin:cache',
    PLUGIN_EXEC: 'plugin:exec'
});

/**
 * Имя long-lived порта, который окно загрузки держит открытым,
 * чтобы service worker не выгружался во время загрузки.
 */
export const PORT_KEEP_ALIVE = 'downloadKeepAlive';

/**
 * Ключ storage.local, в котором фон хранит очередь загрузки. Страницы расширения
 * только читают его, изменения идут через сообщения QUEUE_*.
 */
export const QUEUE_STORAGE_KEY = 'download_queue';

/**
 * Состояния тайтла в очереди загрузки: ждёт, скачивается, не скачался.
 */
export const QUEUE_STATUS = Object.freeze({
    PENDING: 'pending',
    ACTIVE: 'active',
    ERROR: 'error'
});
