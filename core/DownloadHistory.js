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

    const DownloadHistory = {
        _storage: new global.Storage(),

        add(entry) {
            const history = this.getAll();
            history.unshift({ ...entry, downloadedAt: Date.now() });
            this._storage.setJSON(HISTORY_KEY, history.slice(0, MAX_ENTRIES));
        },

        getAll() {
            return this._storage.getJSON(HISTORY_KEY) || [];
        },

        clear() {
            this._storage.remove(HISTORY_KEY);
        }
    };

    global.DownloadHistory = DownloadHistory;
    console.log('[DownloadHistory] Loaded');
})(typeof window !== 'undefined' ? window : self);
