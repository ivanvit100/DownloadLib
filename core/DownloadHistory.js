/**
 * DownloadLib history module
 * Persists the 10 most recent successful downloads
 * @module core/DownloadHistory
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function(global) {
    const HISTORY_KEY = 'manga_parser_download_history';
    const MAX_ENTRIES = 10;

    /**
     * Синглтон-хранилище истории последних успешных загрузок (не более MAX_ENTRIES).
     * @namespace DownloadHistory
     */
    const DownloadHistory = {
        _storage: new global.Storage(),

        /**
         * Добавляет запись в начало истории с текущей меткой времени,
         * обрезая список до MAX_ENTRIES самых свежих записей.
         * @param {object} entry - Данные о загрузке (service, slug, title, format и т.д.).
         * @returns {void}
         */
        add(entry) {
            const history = this.getAll();
            history.unshift({ ...entry, downloadedAt: Date.now() });
            this._storage.setJSON(HISTORY_KEY, history.slice(0, MAX_ENTRIES));
        },

        /**
         * Возвращает всю сохранённую историю загрузок.
         * @returns {object[]} Список записей истории (от самой новой к самой старой).
         */
        getAll() {
            return this._storage.getJSON(HISTORY_KEY) || [];
        },

        /**
         * Полностью очищает историю загрузок.
         * @returns {void}
         */
        clear() {
            this._storage.remove(HISTORY_KEY);
        }
    };

    global.DownloadHistory = DownloadHistory;
    console.log('[DownloadHistory] Loaded');
})(typeof window !== 'undefined' ? window : self);
