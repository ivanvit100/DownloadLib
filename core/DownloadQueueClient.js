/**
 * DownloadLib core module
 * Client of the background download queue for extension pages
 * @module core/DownloadQueueClient
 * @license MIT
 * @author ivanvit
 * @version 1.1.2
 */

import { extensionApi } from './BrowserApi.js';
import { createLogger } from './ConsoleLogger.js';
import { MSG, QUEUE_STORAGE_KEY } from './MessageTypes.js';

const log = createLogger('DownloadQueueClient');

/**
 * Отправляет сообщение фону очереди.
 * @param {object} message - Сообщение.
 * @returns {Promise<?object>} Ответ фона, либо null, если фон недоступен или отказал.
 */
async function send(message) {
    try {
        const reply = await extensionApi.runtime.sendMessage(message);
        if (reply?.ok === false) log.warn(`Queue refused "${message.action}":`, reply.error);
        return reply ?? null;
    } catch (e) {
        log.warn(`Queue unavailable for "${message.action}":`, e);
        return null;
    }
}

/**
 * Клиент очереди загрузки, которая живёт в фоне. Очередью владеет фон: страницы
 * читают её из storage.local, а меняют только сообщениями.
 * @namespace DownloadQueueClient
 */
export const DownloadQueueClient = {
    /**
     * Просит фон скачать тайтл. Если другое окно уже скачивает, тайтл встаёт
     * в очередь. Иначе окно с inPlace скачивает сам, а без него фон открывает
     * окно загрузки.
     * @param {{params: string, title?: ?string, inPlace?: boolean}} request - Параметры URL
     * окна загрузки, название тайтла и признак загрузки в этом окне.
     * @returns {Promise<?{ok: boolean, queued?: boolean, position?: number}>} Ответ фона,
     * либо null, если фон недоступен.
     */
    request({ params, title = null, inPlace = false }) {
        return send({ action: MSG.DOWNLOAD_REQUEST, params, title, inPlace });
    },

    /**
     * Сообщает фону итог загрузки этого окна и получает следующий тайтл очереди.
     * @param {{queueId?: ?string, ok: boolean, error?: ?string, stopped?: boolean}} result - Итог
     * загрузки: id тайтла очереди, успех, текст ошибки, остановлена ли загрузка.
     * @returns {Promise<?{id: string, params: string}>} Следующий тайтл, либо null.
     */
    async next(result) {
        const reply = await send({ action: MSG.QUEUE_NEXT, ...result });
        return reply?.next ?? null;
    },

    /**
     * Запускает очередь, если никто не скачивает.
     * @returns {Promise<boolean>} true, если окно загрузки открыто.
     */
    async start() {
        const reply = await send({ action: MSG.QUEUE_START });
        return !!reply?.started;
    },

    /**
     * Удаляет тайтл из очереди.
     * @param {string} id - id тайтла очереди.
     * @returns {Promise<void>}
     */
    async remove(id) {
        await send({ action: MSG.QUEUE_REMOVE, id });
    },

    /**
     * Удаляет из очереди все тайтлы, кроме скачиваемого сейчас.
     * @returns {Promise<void>}
     */
    async clear() {
        await send({ action: MSG.QUEUE_CLEAR });
    },

    /**
     * Читает очередь из storage.local.
     * @returns {Promise<object[]>} Элементы очереди: {id, params, title, status, error, addedAt}.
     */
    async list() {
        try {
            const result = await extensionApi?.storage?.local?.get(QUEUE_STORAGE_KEY);
            const items = result?.[QUEUE_STORAGE_KEY];
            return Array.isArray(items) ? items : [];
        } catch (e) {
            log.warn('Failed to read the queue:', e);
            return [];
        }
    },

    /**
     * Подписывается на изменения очереди.
     * @param {function(object[]): void} listener - Получает новую очередь.
     * @returns {function(): void} Отписка.
     */
    onChange(listener) {
        const onChanged = extensionApi?.storage?.onChanged;
        if (!onChanged) return () => {};

        const handler = (changes, area) => {
            if (area !== 'local' || !changes[QUEUE_STORAGE_KEY]) return;
            const items = changes[QUEUE_STORAGE_KEY].newValue;
            listener(Array.isArray(items) ? items : []);
        };

        onChanged.addListener(handler);
        return () => onChanged.removeListener(handler);
    }
};
