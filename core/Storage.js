/**
 * DownloadLib storage module
 * Safe localStorage wrapper with availability check
 * @module core/Storage
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function(global) {
    /**
     * Безопасная обёртка над localStorage с проверкой доступности и защитой
     * всех операций от исключений (приватный режим, квота, отключённое хранилище).
     */
    class Storage {
        /**
         * Проверяет доступность localStorage в текущем окружении и запоминает результат.
         */
        constructor() {
            this._available = false;
            try {
                const test = '__storage_test__';
                localStorage.setItem(test, '1');
                localStorage.removeItem(test);
                this._available = true;
            } catch (e) {
                console.warn('[Storage] localStorage is not available:', e);
            }
        }

        /**
         * Сообщает, доступен ли localStorage в текущем окружении.
         * @returns {boolean} true, если localStorage доступен для чтения/записи.
         */
        isAvailable() {
            return this._available;
        }

        /**
         * Читает строковое значение по ключу.
         * @param {string} key - Ключ localStorage.
         * @returns {?string} Значение, либо null при недоступности хранилища или ошибке чтения.
         */
        get(key) {
            if (!this._available) return null;
            try {
                return localStorage.getItem(key);
            } catch (e) {
                console.warn('[Storage] get failed for key:', key, e);
                return null;
            }
        }

        /**
         * Читает и парсит JSON-значение по ключу.
         * @param {string} key - Ключ localStorage.
         * @returns {*} Разобранное значение, либо null, если ключ отсутствует
         * или его содержимое не является валидным JSON.
         */
        getJSON(key) {
            const raw = this.get(key);
            if (raw === null) return null;
            try {
                return JSON.parse(raw);
            } catch {
                return null;
            }
        }

        /**
         * Записывает строковое значение по ключу.
         * @param {string} key - Ключ localStorage.
         * @param {*} value - Значение (приводится к строке через String()).
         * @returns {boolean} true при успешной записи, false при недоступности
         * хранилища или ошибке записи (например, превышена квота).
         */
        set(key, value) {
            if (!this._available) return false;
            try {
                localStorage.setItem(key, String(value));
                return true;
            } catch (e) {
                console.warn('[Storage] set failed for key:', key, e);
                return false;
            }
        }

        /**
         * Сериализует значение в JSON и записывает по ключу.
         * @param {string} key - Ключ localStorage.
         * @param {*} value - Сериализуемое значение.
         * @returns {boolean} true при успешной записи, false при недоступности
         * хранилища или ошибке записи.
         */
        setJSON(key, value) {
            if (!this._available) return false;
            try {
                localStorage.setItem(key, JSON.stringify(value));
                return true;
            } catch (e) {
                console.warn('[Storage] setJSON failed for key:', key, e);
                return false;
            }
        }

        /**
         * Удаляет значение по ключу.
         * @param {string} key - Ключ localStorage.
         * @returns {void}
         */
        remove(key) {
            if (!this._available) return;
            try {
                localStorage.removeItem(key);
            } catch (e) {
                console.warn('[Storage] remove failed for key:', key, e);
            }
        }
    }

    global.Storage = Storage;
    console.log('[Storage] Loaded');
})(typeof window !== 'undefined' ? window : self);
