/**
 * DownloadLib ui module
 * Controls the download queue view
 * @module ui/QueueController
 * @license MIT
 * @author ivanvit
 * @version 1.1.2
 */

import { createLogger } from '../core/ConsoleLogger.js';
import { DownloadQueueClient } from '../core/DownloadQueueClient.js';
import { QUEUE_STATUS } from '../core/MessageTypes.js';
import { $el, createEl } from './DomUtils.js';
import { formatLabel, getServiceColor } from './HistoryController.js';

const log = createLogger('QueueController');

const BUSY_MESSAGE_MS = 3000;

/**
 * Синглтон-контроллер экрана очереди загрузки.
 * @namespace QueueController
 */
export const QueueController = {
    _unsubscribe: null,

    /**
     * Инициализирует экран очереди: отрисовывает список, навешивает обработчики
     * и обновляет список при изменении очереди, пока экран открыт.
     * @param {function(): void} onBack - Возврат к главному экрану по кнопке "назад".
     * @returns {Promise<void>}
     */
    async init(onBack) {
        this._bindEvents(onBack);
        this._unsubscribe?.();
        this._unsubscribe = DownloadQueueClient.onChange(items => {
            if ($el('queueList')) this._render(items);
            else this._stopWatching();
        });
        this._render(await DownloadQueueClient.list());
    },

    /**
     * Отписывается от изменений очереди.
     * @returns {void}
     */
    _stopWatching() {
        this._unsubscribe?.();
        this._unsubscribe = null;
    },

    /**
     * Отрисовывает очередь: карточки тайтлов, заглушку для пустой очереди
     * и кнопки запуска (есть ожидающие тайтлы) и очистки (есть что удалить).
     * @param {object[]} items - Элементы очереди.
     * @returns {void}
     */
    _render(items) {
        const list = $el('queueList');
        if (!list) return;
        const hasPending = items.some(item => item.status === QUEUE_STATUS.PENDING);
        const hasRemovable = items.some(item => item.status !== QUEUE_STATUS.ACTIVE);

        list.style.display = items.length ? 'flex' : 'none';
        $el('queueEmpty').style.display = items.length ? 'none' : 'block';
        $el('queueStartBtn').style.display = hasPending ? 'block' : 'none';
        $el('queueClearBtn').style.display = hasRemovable ? 'block' : 'none';

        let position = 0;
        list.replaceChildren(...items.map(item => {
            if (item.status === QUEUE_STATUS.PENDING) position += 1;
            return this._createCard(item, position);
        }));
    },

    /**
     * Создаёт карточку тайтла очереди: название, формат, состояние, текст ошибки
     * и кнопку удаления (кроме скачиваемого сейчас тайтла).
     * @param {{id: string, params: string, title: ?string, status: string, error: ?string}} item - Тайтл очереди.
     * @param {number} position - Номер среди ожидающих тайтлов.
     * @returns {HTMLElement} Карточка.
     */
    _createCard(item, position) {
        const params = new URLSearchParams(item.params);
        const color = getServiceColor(params.get('service'));

        const card = createEl('div', { className: 'history-card' });
        card.style.borderLeftColor = color;
        card.appendChild(createEl('div', {
            className: 'history-card-title',
            text: item.title || params.get('slug') || ''
        }));

        const meta = createEl('div', { className: 'history-card-meta' });
        const badge = createEl('span', { className: 'history-badge', text: formatLabel(params.get('format')) });
        badge.style.borderColor = color;
        badge.style.color = color;
        meta.appendChild(badge);
        meta.appendChild(createEl('span', { className: 'history-date', text: this._statusText(item, position) }));

        if (item.status !== QUEUE_STATUS.ACTIVE) {
            const removeBtn = createEl('button', {
                className: 'queue-remove-btn', text: 'Удалить', attrs: { type: 'button' }
            });
            removeBtn.addEventListener('click', () => DownloadQueueClient.remove(item.id));
            meta.appendChild(removeBtn);
        }
        card.appendChild(meta);

        if (item.status === QUEUE_STATUS.ERROR && item.error)
            card.appendChild(createEl('div', { className: 'queue-card-error', text: item.error }));
        return card;
    },

    /**
     * Текст состояния тайтла очереди.
     * @param {{status: string}} item - Тайтл очереди.
     * @param {number} position - Номер среди ожидающих тайтлов.
     * @returns {string}
     */
    _statusText(item, position) {
        if (item.status === QUEUE_STATUS.ACTIVE) return 'Скачивается';
        if (item.status === QUEUE_STATUS.ERROR) return 'Не скачан';
        return `В очереди: ${position}`;
    },

    /**
     * Навешивает обработчики на кнопки "назад", запуска и очистки очереди.
     * @param {function(): void} onBack - Возврат к главному экрану.
     * @returns {void}
     */
    _bindEvents(onBack) {
        $el('queueBackBtn')?.addEventListener('click', () => {
            this._stopWatching();
            const logoInfo = $el('logoInfo');
            if (logoInfo) logoInfo.textContent = '';
            if (onBack) onBack();
            else log.error('onBack callback not provided');
        });

        const startBtn = $el('queueStartBtn');
        startBtn?.addEventListener('click', async () => {
            startBtn.disabled = true;
            if (await DownloadQueueClient.start()) {
                startBtn.disabled = false;
                return;
            }
            const text = startBtn.textContent;
            startBtn.textContent = 'Очередь уже скачивается';
            setTimeout(() => {
                startBtn.textContent = text;
                startBtn.disabled = false;
            }, BUSY_MESSAGE_MS);
        });

        $el('queueClearBtn')?.addEventListener('click', () => DownloadQueueClient.clear());
    }
};
