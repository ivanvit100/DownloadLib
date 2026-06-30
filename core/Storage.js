/**
 * DownloadLib storage module
 * Safe localStorage wrapper with availability check
 * @module core/Storage
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function(global) {
    class Storage {
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

        isAvailable() {
            return this._available;
        }

        get(key) {
            if (!this._available) return null;
            try {
                return localStorage.getItem(key);
            } catch (e) {
                console.warn('[Storage] get failed for key:', key, e);
                return null;
            }
        }

        getJSON(key) {
            const raw = this.get(key);
            if (raw === null) return null;
            try {
                return JSON.parse(raw);
            } catch {
                return null;
            }
        }

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
