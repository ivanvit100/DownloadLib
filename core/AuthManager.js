/**
 * DownloadLib core module
 * Manages authorization token extraction and caching
 * @module core/AuthManager
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from './BrowserApi.js';
import { MSG } from './messages.js';

console.log('[AuthManager] Loading...');

/**
 * Ищет действующий JWT в local/sessionStorage страницы. Внедряется во вкладку
 * сервиса, поэтому самодостаточна. Принимает только JWT с не истёкшим exp и
 * сначала проверяет ключи, похожие на хранилище токена (/auth|token/i).
 * @returns {?string} Найденный JWT, либо null.
 */
function findTokenInPageStorage() {
    const JWT = /^eyJ[\w\-+=/]+\.eyJ[\w\-+=/]+\.[\w\-+=/]+$/;
    const KEY_HINT = /auth|token/i;
    const EXPIRY_MARGIN_MS = 30000;

    /**
     * Проверяет, что exp в payload JWT ещё не наступил.
     * @param {string} token - JWT.
     * @returns {boolean}
     */
    function isLive(token) {
        try {
            const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const { exp } = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
            return Number.isFinite(exp) && exp * 1000 - EXPIRY_MARGIN_MS > Date.now();
        } catch {
            return false;
        }
    }

    /**
     * Ищет действующий JWT в строке: в чистом виде, с префиксом Bearer или внутри JSON.
     * @param {*} val - Проверяемое значение.
     * @returns {?string} Найденный JWT, либо null.
     */
    function findJwt(val) {
        if (typeof val !== 'string' || !val) return null;
        const bare = val.startsWith('Bearer ') ? val.slice(7) : val;
        if (JWT.test(bare)) return isLive(bare) ? bare : null;
        try { return scanObj(JSON.parse(val)); } catch { return null; }
    }

    /**
     * Рекурсивно обходит значения объекта в поисках действующего JWT.
     * @param {*} o - Проверяемый объект.
     * @returns {?string} Найденный JWT, либо null.
     */
    function scanObj(o) {
        if (!o || typeof o !== 'object') return null;
        for (const v of Object.values(o)) {
            const found = typeof v === 'string' ? findJwt(v) : scanObj(v);
            if (found) return found;
        }
        return null;
    }

    const preferred = [];
    const others = [];
    for (const storage of [localStorage, sessionStorage]) {
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            (KEY_HINT.test(key) ? preferred : others).push(storage.getItem(key));
        }
    }

    for (const value of [...preferred, ...others]) {
        const found = findJwt(value);
        if (found) return found;
    }
    return null;
}

/**
 * Синглтон-менеджер извлечения и кэширования токена авторизации сервиса.
 * @namespace AuthManager
 */
export const AuthManager = {
    /**
     * Получает токен авторизации сервиса: сначала из хранилища токенов фона,
     * а если там его нет и передан tabId — ищет действующий JWT в local/sessionStorage
     * вкладки через scripting.executeScript и сохраняет найденный токен в фоне.
     * @param {string} serviceKey - Ключ сервиса.
     * @param {?number} [tabId] - id вкладки, из которой можно извлечь токен напрямую.
     * @returns {Promise<?string>} Найденный токен, либо null, если токен не найден.
     */
    async getToken(serviceKey, tabId = null) {
        try {
            const cached = await extensionApi.runtime.sendMessage({ action: MSG.GET_AUTH_TOKEN, serviceKey });
            if (cached && cached.token) return cached.token;
        } catch (e) {
            console.warn('[AuthManager] Failed to get cached auth token:', e);
        }

        if (tabId != null && extensionApi.scripting) {
            try {
                const results = await extensionApi.scripting.executeScript({
                    target: { tabId },
                    func: findTokenInPageStorage
                });
                if (results && results[0] && results[0].result) {
                    const token = results[0].result;
                    extensionApi.runtime.sendMessage({ action: MSG.CACHE_AUTH_TOKEN, serviceKey, token })
                        .catch(() => {});
                    return token;
                }
            } catch (e) {
                console.warn('[AuthManager] Failed to extract auth token via executeScript:', e);
            }
        }

        return null;
    },

    /**
     * Получает токен авторизации сервиса и, если он найден, подставляет его
     * в заголовок Authorization конфигурации переданного сервиса.
     * @param {string} serviceKey - Ключ сервиса.
     * @param {?number} activeTabId - id активной вкладки для извлечения токена.
     * @param {object} service - Экземпляр сервиса, в config.headers которого
     * будет подставлен токен.
     * @returns {Promise<?string>} Применённый токен, либо null, если токен не найден.
     */
    async apply(serviceKey, activeTabId, service) {
        try {
            const token = await this.getToken(serviceKey, activeTabId);
            if (token) {
                service.config = service.config || {};
                service.config.headers = { ...service.config.headers, 'Authorization': `Bearer ${token}` };
                console.log('[AuthManager] Auth token applied');
                return token;
            }
        } catch (e) {
            console.warn('[AuthManager] Could not get auth token:', e);
        }
        return null;
    },

    /**
     * Удаляет сохранённый в фоне токен сервиса, например после ответа 401:
     * при следующем getToken токен будет найден заново.
     * @param {string} serviceKey - Ключ сервиса.
     * @returns {Promise<void>}
     */
    async invalidate(serviceKey) {
        try {
            await extensionApi.runtime.sendMessage({ action: MSG.AUTH_INVALIDATE, serviceKey });
        } catch (e) {
            console.warn('[AuthManager] Failed to invalidate auth token:', e);
        }
    }
};

console.log('[AuthManager] Loaded');
