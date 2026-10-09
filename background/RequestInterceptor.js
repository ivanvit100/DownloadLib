/**
 * DownloadLib background module
 * Watches network requests to the services: captures auth tokens and, in Firefox,
 * adds CORS headers to image responses for requests made from service tabs
 * @module background/RequestInterceptor
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { browserEnv, extensionApi, extensionOrigin } from '../core/BrowserApi.js';
import {
    isApiUrl, isImageHost, serviceKeyForSiteId, serviceKeyForUrl, serviceOrigins, webRequestUrls
} from '../services/hosts.js';
import { getPluginHosts } from './pluginHosts.js';
import { setToken } from './tokenStore.js';

console.log('[RequestInterceptor] Script loading...');

const isFirefox = !!browserEnv.isFirefox;

console.log('[RequestInterceptor] Detected browser:', isFirefox ? 'Firefox' : 'Chrome');

const WEBREQUEST_URLS = webRequestUrls();

/** Origin запросов изображений до получения ответа (только Firefox): requestId → Origin. */
const pendingOrigins = new Map();

/**
 * Возвращает значение заголовка по имени без учёта регистра.
 * @param {?Array<{name: string, value: string}>} headers - Заголовки.
 * @param {string} name - Имя заголовка в нижнем регистре.
 * @returns {?string} Значение заголовка, либо undefined.
 */
function headerValue(headers, name) {
    return (headers || []).find(h => h.name.toLowerCase() === name)?.value;
}

/**
 * Проверяет, относится ли URL к запросу изображения: CDN изображений сервиса
 * или путь обложек/загрузок на сайте.
 * @param {string} url - Проверяемый URL запроса.
 * @returns {boolean} true, если URL соответствует одному из известных хостов/путей изображений.
 */
function isImageRequest(url) {
    return isImageHost(url) || url.includes('/covers/') || url.includes('/uploads/');
}

/**
 * Определяет сервис, к которому относится запрос к API: по заголовку Site-Id
 * встроенного сервиса, иначе по хосту страницы, сделавшей запрос (включая сайты
 * сервисных плагинов).
 * @param {object} details - Данные запроса из webRequest.
 * @returns {?string} Ключ сервиса, либо null, если определить не удалось.
 */
function serviceOfRequest(details) {
    const bySiteId = serviceKeyForSiteId(headerValue(details.requestHeaders, 'site-id'));
    if (bySiteId) return bySiteId;
    const pageUrl = details.originUrl || details.initiator || details.documentUrl;
    return serviceKeyForUrl(pageUrl, getPluginHosts());
}

/**
 * Сохраняет Bearer-токен из заголовка Authorization запроса страницы к API сервиса.
 * Если сервис запроса определить не удалось, токен не сохраняется.
 * @param {object} details - Данные запроса из webRequest, включая requestHeaders.
 * @returns {void}
 */
function captureAuthToken(details) {
    if (!isApiUrl(details.url)) return;
    const auth = headerValue(details.requestHeaders, 'authorization');
    if (!auth?.startsWith('Bearer ')) return;
    const serviceKey = serviceOfRequest(details);
    if (!serviceKey) return;
    setToken(serviceKey, auth.slice(7)).then(changed => {
        if (changed) console.log(`[RequestInterceptor] Captured auth token for ${serviceKey}`);
    });
}

/**
 * Неблокирующий обработчик onBeforeSendHeaders (оба браузера): захватывает токены
 * авторизации, а в Firefox запоминает Origin запросов изображений для onHeadersReceived.
 * @param {object} details - Данные запроса из webRequest, включая requestHeaders.
 * @returns {void}
 */
function onBeforeSendHeaders(details) {
    if (isFirefox && isImageRequest(details.url)) {
        const origin = headerValue(details.requestHeaders, 'origin');
        if (origin) pendingOrigins.set(details.requestId, origin);
    }
    captureAuthToken(details);
}

/**
 * Выбирает значение Access-Control-Allow-Origin для ответа на запрос изображения.
 * Произвольный Origin никогда не отражается: разрешены только сайты встроенных
 * сервисов (с credentials) и страницы самого расширения (без credentials).
 * @param {object} details - Данные ответа из webRequest.
 * @param {?string} requestOrigin - Origin запроса, если он был.
 * @returns {?{origin: string, credentials: boolean}} Разрешение, либо null.
 */
function allowedOrigin(details, requestOrigin) {
    const ownOrigin = extensionOrigin();
    if (requestOrigin) {
        if (serviceOrigins().includes(requestOrigin)) return { origin: requestOrigin, credentials: true };
        if (requestOrigin === ownOrigin) return { origin: requestOrigin, credentials: false };
        return null;
    }
    if (details.tabId === -1) return ownOrigin ? { origin: ownOrigin, credentials: false } : null;
    const origin = serviceOrigins(serviceKeyForUrl(details.url))[0] ?? serviceOrigins()[0];
    return origin ? { origin, credentials: true } : null;
}

/**
 * Блокирующий обработчик onHeadersReceived (Firefox): добавляет CORS-заголовки
 * к ответам на запросы изображений, у которых их нет, чтобы загрузка из контекста
 * вкладки сервиса могла прочитать содержимое.
 * @param {object} details - Данные ответа из webRequest, включая responseHeaders.
 * @returns {{responseHeaders?: Array<{name: string, value: string}>}} Заголовки ответа.
 */
function onHeadersReceived(details) {
    const requestOrigin = pendingOrigins.get(details.requestId);
    pendingOrigins.delete(details.requestId);
    if (!isImageRequest(details.url)) return {};

    const headers = details.responseHeaders || [];
    if (headers.some(h => h.name.toLowerCase() === 'access-control-allow-origin'))
        return { responseHeaders: headers };

    const allowed = allowedOrigin(details, requestOrigin);
    if (allowed) {
        headers.push({ name: 'Access-Control-Allow-Origin', value: allowed.origin });
        if (allowed.credentials) headers.push({ name: 'Access-Control-Allow-Credentials', value: 'true' });
    }
    return { responseHeaders: headers };
}

/**
 * Забывает Origin запроса, который завершился, не дойдя до onHeadersReceived.
 * @param {{requestId: string}} details - Данные запроса из webRequest.
 * @returns {void}
 */
function forgetRequest(details) {
    pendingOrigins.delete(details.requestId);
}

/**
 * Регистрирует слушатели webRequest: захват токенов в обоих браузерах и, в Firefox,
 * исправление CORS ответов изображений с очисткой запомненных Origin.
 * @returns {void}
 */
function setupListeners() {
    const webRequest = extensionApi?.webRequest;
    if (!webRequest) return;

    webRequest.onBeforeSendHeaders.addListener(onBeforeSendHeaders, { urls: WEBREQUEST_URLS }, ['requestHeaders']);
    console.log('[RequestInterceptor] Auth token capture installed');

    if (!isFirefox) return;
    webRequest.onHeadersReceived.addListener(
        onHeadersReceived, { urls: WEBREQUEST_URLS }, ['blocking', 'responseHeaders']);
    webRequest.onCompleted?.addListener(forgetRequest, { urls: WEBREQUEST_URLS });
    webRequest.onErrorOccurred?.addListener(forgetRequest, { urls: WEBREQUEST_URLS });
    console.log('[RequestInterceptor] Firefox: image CORS fix installed');
}

setupListeners();

console.log('[RequestInterceptor] Script loaded');
