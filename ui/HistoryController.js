/**
 * DownloadLib ui module
 * Controls the download history view
 * @module ui/HistoryController
 * @license MIT
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function(global) {
    const browserAPI = typeof global.getExtensionApi === 'function'
        ? global.getExtensionApi()
        : ((typeof global.browser !== 'undefined' && global.browser) ||
            (typeof global.chrome !== 'undefined' && global.chrome) ||
            null);

    const FORMAT_LABELS = { epub: 'EPUB', fb2: 'FB2', pdf: 'PDF', mobi: 'MOBI' };
    const SERVICE_COLORS = { ranobelib: '#2196f3', mangalib: '#ff9100' };
    const SERVICE_URLS = {
        mangalib: slug => `https://mangalib.me/ru/manga/${slug}`,
        ranobelib: slug => `https://ranobelib.me/ru/book/${slug}`
    };

    function formatDate(ts) {
        return new Date(ts).toLocaleString('ru-RU', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    }

    const HistoryController = {
        init() {
            this._render();
            this._bindEvents();
        },

        _render() {
            const history = global.DownloadHistory.getAll();
            const list = document.getElementById('historyList');
            const empty = document.getElementById('historyEmpty');
            const clearBtn = document.getElementById('clearHistoryBtn');

            if (!history.length) {
                if (list) list.style.display = 'none';
                if (empty) empty.style.display = 'block';
                if (clearBtn) clearBtn.style.display = 'none';
                return;
            }

            if (list) { list.style.display = 'flex'; list.innerHTML = ''; }
            if (empty) empty.style.display = 'none';
            if (clearBtn) clearBtn.style.display = 'block';
            history.forEach(entry => { if (list) list.appendChild(this._createCard(entry)); });
        },

        _createCard(entry) {
            const color = SERVICE_COLORS[entry.service] || '#ff9100';

            const card = document.createElement('div');
            card.className = 'history-card';
            card.style.borderLeftColor = color;

            const titleRow = document.createElement('div');
            titleRow.className = 'history-card-title';
            titleRow.textContent = entry.title || entry.slug;

            const urlBuilder = SERVICE_URLS[entry.service];
            if (urlBuilder && browserAPI?.tabs) {
                titleRow.classList.add('history-card-title--link');
                titleRow.style.setProperty('--entry-color', color);
                titleRow.addEventListener('click', () => browserAPI.tabs.create({ url: urlBuilder(entry.slug) }));
            }

            const meta = document.createElement('div');
            meta.className = 'history-card-meta';

            const badge = document.createElement('span');
            badge.className = 'history-badge';
            badge.textContent = FORMAT_LABELS[entry.format] || entry.format.toUpperCase();
            badge.style.borderColor = color;
            badge.style.color = color;

            const date = document.createElement('span');
            date.className = 'history-date';
            date.textContent = formatDate(entry.downloadedAt);

            meta.appendChild(badge);
            meta.appendChild(date);
            card.appendChild(titleRow);
            card.appendChild(meta);

            if (entry.chapterFrom || entry.chapterTo) {
                const ch = document.createElement('div');
                ch.className = 'history-chapters';
                const from = entry.chapterFrom || '—';
                const to = entry.chapterTo || '—';
                ch.textContent = from === to ? from : `${from} — ${to}`;
                card.appendChild(ch);
            }

            if (entry.translator) {
                const tr = document.createElement('div');
                tr.className = 'history-translator';
                tr.textContent = `Перевод: ${entry.translator}`;
                card.appendChild(tr);
            }

            return card;
        },

        _bindEvents() {
            const backBtn = document.getElementById('backBtn');
            const clearBtn = document.getElementById('clearHistoryBtn');

            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    const logoInfo = document.getElementById('logoInfo');
                    if (logoInfo) logoInfo.textContent = '';
                    if (global.popupController)
                        global.popupController._restoreMainView();
                    else console.error('[HistoryController] popupController not found');
                });
            }

            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    global.DownloadHistory.clear();
                    this._render();
                });
            }
        }
    };

    global.HistoryController = HistoryController;
    console.log('[HistoryController] Loaded');
})(typeof window !== 'undefined' ? window : self);
