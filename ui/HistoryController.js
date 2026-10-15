/**
 * DownloadLib ui module
 * Controls the download history view
 * @module ui/HistoryController
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from '../core/BrowserApi.js';
import { DownloadHistory } from '../core/DownloadHistory.js';
import { ExporterRegistry } from '../exporters/ExporterRegistry.js';
import { buildTitleUrl } from '../services/hosts.js';
import { serviceRegistry } from '../services/ServiceRegistry.js';
import { $el, createEl } from './dom.js';

const DEFAULT_COLOR = '#ff9100';

/**
 * Подпись формата для бейджа карточки: та же, что в списке форматов попапа
 * (включая форматы плагинов), а для неизвестного формата — его ключ заглавными.
 * @param {string} format - Ключ формата.
 * @returns {string}
 */
function formatLabel(format) {
    const known = ExporterRegistry.getFormats().find(({ value }) => value === format);
    return known ? known.label : String(format || '').toUpperCase();
}

/**
 * Возвращает фирменный цвет сервиса для оформления карточки истории.
 * @param {string} serviceKey - Ключ сервиса.
 * @returns {string} CSS-цвет сервиса или DEFAULT_COLOR, если сервис не найден.
 */
function getServiceColor(serviceKey) {
    return serviceRegistry.getService(serviceKey)?.config?.primaryColor || DEFAULT_COLOR;
}

/**
 * Форматирует timestamp в локализованную дату/время формата ru-RU.
 * @param {number} ts - Unix-время в миллисекундах.
 * @returns {string} Отформатированная строка даты и времени.
 */
function formatDate(ts) {
    return new Date(ts).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

/**
 * Синглтон-контроллер экрана истории загрузок.
 * @namespace HistoryController
 */
export const HistoryController = {
    /**
     * Инициализирует экран истории: отрисовывает список и навешивает обработчики.
     * @param {function(): void} onBack - Возврат к главному экрану по кнопке "назад".
     * @returns {void}
     */
    init(onBack) {
        this._render();
        this._bindEvents(onBack);
    },

    /**
     * Отрисовывает список записей истории загрузок, либо показывает заглушку
     * "пусто", если история не содержит записей.
     * @returns {void}
     */
    _render() {
        const history = DownloadHistory.getAll();
        const list = $el('historyList');
        const empty = $el('historyEmpty');
        const clearBtn = $el('clearHistoryBtn');

        if (!history.length) {
            if (list) list.style.display = 'none';
            if (empty) empty.style.display = 'block';
            if (clearBtn) clearBtn.style.display = 'none';
            return;
        }

        if (list) { list.style.display = 'flex'; list.replaceChildren(); }
        if (empty) empty.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'block';
        history.forEach(entry => { if (list) list.appendChild(this._createCard(entry)); });
    },

    /**
     * Создаёт DOM-карточку одной записи истории загрузок: заголовок (со ссылкой
     * на страницу тайтла при наличии), бейдж формата, дату, диапазон глав и переводчика.
     * @param {object} entry - Запись истории (service, slug, title, format, downloadedAt,
     * chapterFrom, chapterTo, translator).
     * @returns {HTMLElement} Собранный DOM-элемент карточки.
     */
    _createCard(entry) {
        const color = getServiceColor(entry.service);

        const card = createEl('div', { className: 'history-card' });
        card.style.borderLeftColor = color;

        const titleRow = createEl('div', { className: 'history-card-title', text: entry.title || entry.slug });

        const titleUrl = buildTitleUrl(serviceRegistry.getService(entry.service)?.config?.titleUrl, entry.slug);
        if (titleUrl && extensionApi?.tabs) {
            titleRow.classList.add('history-card-title--link');
            titleRow.style.setProperty('--entry-color', color);
            titleRow.addEventListener('click', () => extensionApi.tabs.create({ url: titleUrl }));
        }

        const meta = createEl('div', { className: 'history-card-meta' });

        const badge = createEl('span', { className: 'history-badge', text: formatLabel(entry.format) });
        badge.style.borderColor = color;
        badge.style.color = color;

        meta.appendChild(badge);
        meta.appendChild(createEl('span', { className: 'history-date', text: formatDate(entry.downloadedAt) }));
        card.appendChild(titleRow);
        card.appendChild(meta);

        if (entry.chapterFrom || entry.chapterTo) {
            const from = entry.chapterFrom || '—';
            const to = entry.chapterTo || '—';
            card.appendChild(createEl('div', {
                className: 'history-chapters',
                text: from === to ? from : `${from} — ${to}`
            }));
        }

        if (entry.translator)
            card.appendChild(createEl('div', { className: 'history-translator', text: `Перевод: ${entry.translator}` }));

        return card;
    },

    /**
     * Навешивает обработчики на кнопку "назад" (возврат к главному экрану)
     * и на кнопку очистки истории загрузок.
     * @param {function(): void} onBack - Возврат к главному экрану.
     * @returns {void}
     */
    _bindEvents(onBack) {
        const backBtn = $el('backBtn');
        const clearBtn = $el('clearHistoryBtn');

        if (backBtn) {
            backBtn.addEventListener('click', () => {
                const logoInfo = $el('logoInfo');
                if (logoInfo) logoInfo.textContent = '';
                if (onBack) onBack();
                else console.error('[HistoryController] onBack callback not provided');
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                DownloadHistory.clear();
                this._render();
            });
        }
    }
};

console.log('[HistoryController] Loaded');
