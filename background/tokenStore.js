/**
 * DownloadLib background module
 * Stores service auth tokens in storage.session and drops expired ones
 * @module background/tokenStore
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from '../core/BrowserApi.js';

const SESSION_KEY = 'downloadlib_auth_tokens';

/** Токен считается истёкшим чуть раньше exp, чтобы не уйти в запрос с умирающим токеном. */
const EXPIRY_MARGIN_MS = 30000;

let tokens = {};
let ready = null;

/**
 * Загружает токены из storage.session (переживают перезапуск service worker'а,
 * но не закрытие браузера). Без storage.session токены живут только в памяти.
 * @returns {Promise<void>}
 */
function load() {
    ready ??= (async () => {
        try {
            const result = await extensionApi?.storage?.session?.get(SESSION_KEY);
            tokens = { ...(result?.[SESSION_KEY] || {}), ...tokens };
        } catch (e) {
            console.warn('[tokenStore] Failed to read session storage:', e?.message || e);
        }
    })();
    return ready;
}

/**
 * Сохраняет токены в storage.session.
 * @returns {void}
 */
function persist() {
    Promise.resolve()
        .then(() => extensionApi?.storage?.session?.set({ [SESSION_KEY]: tokens }))
        .catch(e => console.warn('[tokenStore] Failed to write session storage:', e?.message || e));
}

/**
 * Возвращает момент истечения JWT по полю exp его payload.
 * @param {string} token - Токен.
 * @returns {?number} Момент истечения (мс с эпохи), либо null, если токен
 * не JWT или exp в нём нет.
 */
export function jwtExpiry(token) {
    const payload = typeof token === 'string' ? token.split('.')[1] : null;
    if (!payload) return null;
    try {
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
        const { exp } = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
        return Number.isFinite(exp) ? exp * 1000 : null;
    } catch {
        return null;
    }
}

/**
 * Проверяет, можно ли использовать токен: непустая строка, не истёкший JWT.
 * Токен без exp считается действующим.
 * @param {*} token - Токен.
 * @param {number} [now=Date.now()] - Текущее время.
 * @returns {boolean} true, если токен можно использовать.
 */
export function isTokenUsable(token, now = Date.now()) {
    if (typeof token !== 'string' || !token) return false;
    const expiry = jwtExpiry(token);
    return expiry == null || expiry - EXPIRY_MARGIN_MS > now;
}

/**
 * Возвращает действующий токен сервиса; истёкший токен удаляется.
 * @param {string} serviceKey - Ключ сервиса.
 * @returns {Promise<?string>} Токен, либо null.
 */
export async function getToken(serviceKey) {
    await load();
    const token = tokens[serviceKey];
    if (!token) return null;
    if (isTokenUsable(token)) return token;
    delete tokens[serviceKey];
    persist();
    return null;
}

/**
 * Сохраняет токен сервиса. Истёкший или пустой токен не сохраняется.
 * @param {string} serviceKey - Ключ сервиса.
 * @param {string} token - Токен.
 * @returns {Promise<boolean>} true, если сохранённый токен изменился.
 */
export async function setToken(serviceKey, token) {
    await load();
    if (!serviceKey || !isTokenUsable(token) || tokens[serviceKey] === token) return false;
    tokens[serviceKey] = token;
    persist();
    return true;
}

/**
 * Удаляет токен сервиса (например, после ответа 401).
 * @param {string} serviceKey - Ключ сервиса.
 * @returns {Promise<void>}
 */
export async function invalidate(serviceKey) {
    await load();
    if (!(serviceKey in tokens)) return;
    delete tokens[serviceKey];
    persist();
}
