/**
 * DownloadLib core module
 * Cross-browser API adapter for Firefox and Chromium
 * @module core/BrowserApi
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { createLogger } from './ConsoleLogger.js';

/**
 * Promise-based API расширения текущего браузера: нативный browser (Firefox) либо
 * chrome (в MV3 методы chrome.* без колбэка сами возвращают промисы, поэтому
 * отдельная обёртка не нужна).
 * @type {?object}
 */
export const extensionApi = globalThis.browser ?? globalThis.chrome ?? null;

/**
 * Определяет характеристики текущего браузерного окружения. Наличие пространства
 * имён browser само по себе не означает Firefox (Chrome тоже его предоставляет) —
 * признаком служит поддержка chrome.declarativeNetRequest.
 * @returns {{nativeName: 'browser'|'chrome'|'none', isFirefox: boolean,
 * isChromium: boolean, supportsDnr: boolean}} Флаги окружения.
 */
function resolveEnv() {
    const hasChrome = !!globalThis.chrome;
    const hasBrowser = !!globalThis.browser;
    const supportsDnr = !!(hasChrome && globalThis.chrome.declarativeNetRequest);
    const isFirefox = hasBrowser && !supportsDnr;
    const isChromium = hasChrome && !isFirefox;

    let nativeName = 'none';
    if (hasBrowser) nativeName = 'browser';
    else if (hasChrome) nativeName = 'chrome';

    return { nativeName, isFirefox, isChromium, supportsDnr };
}

/**
 * Характеристики текущего браузерного окружения (вычисляются один раз при загрузке).
 * @type {{nativeName: string, isFirefox: boolean, isChromium: boolean, supportsDnr: boolean}}
 */
export const browserEnv = resolveEnv();

/**
 * Возвращает origin страниц расширения ('moz-extension://<uuid>', 'chrome-extension://<id>').
 * Вычисляется из runtime.getURL, а не через URL.origin: по стандарту origin
 * нестандартных схем непрозрачен ('null'), и сравнение через него ненадёжно.
 * @returns {?string} Origin расширения, либо null, если runtime недоступен.
 */
export function extensionOrigin() {
    const base = extensionApi?.runtime?.getURL?.('');
    return typeof base === 'string' && base ? base.replace(/\/+$/, '') : null;
}

/**
 * Проверяет, что URL указывает на страницу самого расширения.
 * @param {*} url - Проверяемый URL.
 * @returns {boolean}
 */
export function isExtensionUrl(url) {
    const origin = extensionOrigin();
    return !!origin && typeof url === 'string' && url.startsWith(`${origin}/`);
}

createLogger('BrowserApi').debug('Browser:', browserEnv.nativeName);
