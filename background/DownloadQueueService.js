/**
 * DownloadLib background module
 * The single owner of the download queue and of the window that downloads it
 * @module background/DownloadQueueService
 * @license MIT
 * @author ivanvit
 * @version 1.1.2
 */

import { extensionApi } from '../core/BrowserApi.js';
import { createLogger } from '../core/ConsoleLogger.js';
import { QUEUE_STATUS, QUEUE_STORAGE_KEY } from '../core/MessageTypes.js';

const log = createLogger('DownloadQueueService');

const WORKER_SESSION_KEY = 'downloadlib_queue_worker';
const STOPPED_ERROR = 'Загрузка остановлена';
const UNKNOWN_ERROR = 'Неизвестная ошибка';
const MAX_TITLE_LENGTH = 200;

let memoryWorker = null;
let lock = Promise.resolve();

/**
 * Выполняет операцию над очередью после завершения предыдущих, чтобы чтение
 * и запись очереди из разных сообщений не перемешивались.
 * @template T
 * @param {function(): Promise<T>} task - Операция над очередью.
 * @returns {Promise<T>} Результат операции.
 */
function serialized(task) {
    const run = lock.then(task);
    lock = run.catch(() => {});
    return run;
}

/**
 * Читает очередь из storage.local.
 * @returns {Promise<object[]>} Элементы очереди; пустой массив, если очереди нет.
 */
async function readItems() {
    try {
        const result = await extensionApi?.storage?.local?.get(QUEUE_STORAGE_KEY);
        const items = result?.[QUEUE_STORAGE_KEY];
        return Array.isArray(items) ? items : [];
    } catch (e) {
        log.warn('Failed to read the queue:', e);
        return [];
    }
}

/**
 * Сохраняет очередь в storage.local.
 * @param {object[]} items - Элементы очереди.
 * @returns {Promise<void>}
 */
async function writeItems(items) {
    try {
        await extensionApi?.storage?.local?.set({ [QUEUE_STORAGE_KEY]: items });
    } catch (e) {
        log.warn('Failed to write the queue:', e);
    }
}

/**
 * Читает id вкладки окна, которое скачивает. Он хранится в storage.session,
 * поэтому переживает выгрузку service worker'а, а без storage.session — в памяти.
 * @returns {Promise<?number>} id вкладки, либо null.
 */
async function readWorker() {
    const session = extensionApi?.storage?.session;
    if (!session) return memoryWorker;
    try {
        const result = await session.get(WORKER_SESSION_KEY);
        return result?.[WORKER_SESSION_KEY] ?? null;
    } catch (e) {
        log.warn('Failed to read the queue window:', e);
        return memoryWorker;
    }
}

/**
 * Запоминает вкладку окна, которое скачивает.
 * @param {?number} tabId - id вкладки, либо null, если никто не скачивает.
 * @returns {Promise<void>}
 */
async function writeWorker(tabId) {
    memoryWorker = tabId;
    try {
        await extensionApi?.storage?.session?.set({ [WORKER_SESSION_KEY]: tabId });
    } catch (e) {
        log.warn('Failed to save the queue window:', e);
    }
}

/**
 * Возвращает тайтлы, которые скачивались, в ожидание: окна, которое их
 * скачивало, больше нет.
 * @returns {Promise<void>}
 */
async function requeueActive() {
    const items = await readItems();
    if (!items.some(item => item.status === QUEUE_STATUS.ACTIVE)) return;
    await writeItems(items.map(item =>
        item.status === QUEUE_STATUS.ACTIVE ? { ...item, status: QUEUE_STATUS.PENDING } : item));
}

/**
 * Возвращает вкладку окна, которое скачивает, если она ещё открыта. Если окно
 * закрыто или его нет, забывает его и возвращает его тайтлы в ожидание.
 * @returns {Promise<?number>} id вкладки, либо null.
 */
async function liveWorker() {
    const tabId = await readWorker();
    if (tabId != null) {
        try {
            await extensionApi.tabs.get(tabId);
            return tabId;
        } catch (e) {
            log.debug('The queue window is closed:', e?.message);
            await writeWorker(null);
        }
    }
    await requeueActive();
    return null;
}

/**
 * Ключ тайтла для поиска повторов: параметры окна загрузки без вкладки сервиса.
 * @param {string} params - Параметры URL окна загрузки.
 * @returns {string} Ключ.
 */
function titleKey(params) {
    const search = new URLSearchParams(params);
    search.delete('tabId');
    search.sort();
    return search.toString();
}

/**
 * Номер тайтла среди ожидающих (с 1); 0 — тайтл уже скачивается.
 * @param {object[]} items - Элементы очереди.
 * @param {object} item - Тайтл.
 * @returns {number} Номер в очереди.
 */
function position(items, item) {
    if (item.status === QUEUE_STATUS.ACTIVE) return 0;
    return items.filter(i => i.status === QUEUE_STATUS.PENDING).indexOf(item) + 1;
}

/**
 * Ставит тайтл в конец очереди. Тайтл с теми же параметрами, который ждёт
 * или скачивается, повторно не добавляется.
 * @param {{params: string, title?: ?string}} entry - Параметры окна загрузки и название.
 * @returns {Promise<number>} Номер тайтла в очереди (см. position).
 */
async function enqueue({ params, title }) {
    const items = await readItems();
    const key = titleKey(params);
    let item = items.find(i => i.status !== QUEUE_STATUS.ERROR && titleKey(i.params) === key);
    if (!item) {
        item = {
            id: crypto.randomUUID(),
            params: String(params),
            title: title ? String(title).trim().slice(0, MAX_TITLE_LENGTH) : null,
            status: QUEUE_STATUS.PENDING,
            error: null,
            addedAt: Date.now()
        };
        items.push(item);
        await writeItems(items);
        log.info('Queued:', item.title || item.params);
    }
    return position(items, item);
}

/**
 * Принимает просьбу скачать тайтл. Если другое окно уже скачивает, ставит тайтл
 * в очередь. Иначе вызывает launch, который открывает окно загрузки (или запускает
 * загрузку в окне-отправителе), и запоминает вкладку этого окна как скачивающую.
 * @param {{params: string, title?: ?string}} entry - Параметры окна загрузки и название.
 * @param {function(): Promise<?{tabId: ?number}|boolean|null>} launch - Запуск загрузки;
 * возвращает вкладку окна загрузки, false при неудаче или null без windows/tabs API.
 * @param {?number} [selfTabId=null] - Вкладка окна-отправителя: оно не считается занятым.
 * @returns {Promise<{queued: true, position: number}|{queued: false, opened: *}>}
 * Тайтл в очереди с номером, либо результат launch.
 */
export function request(entry, launch, selfTabId = null) {
    return serialized(async () => {
        const worker = await liveWorker();
        if (worker != null && worker !== selfTabId)
            return { queued: true, position: await enqueue(entry) };

        const opened = await launch();
        if (opened?.tabId != null) await writeWorker(opened.tabId);
        return { queued: false, opened };
    });
}

/**
 * Принимает итог загрузки окна и выдаёт ему следующий тайтл. Успешно скачанный
 * тайтл очереди удаляется, неудачный остаётся с ошибкой. Остановленная загрузка
 * останавливает очередь. Следующий тайтл получает только окно, которое скачивает,
 * или любое окно, если скачивающего нет.
 * @param {?number} tabId - Вкладка окна-отправителя.
 * @param {{queueId?: ?string, ok?: boolean, error?: ?string, stopped?: boolean}} result - Итог:
 * id тайтла очереди (если он из очереди), успех, текст ошибки, остановлена ли загрузка.
 * @returns {Promise<{next: ?{id: string, params: string}}>} Следующий тайтл, либо null.
 */
export function next(tabId, { queueId = null, ok = false, error = null, stopped = false } = {}) {
    return serialized(async () => {
        const worker = await liveWorker();
        let items = await readItems();
        if (queueId) {
            items = ok && !stopped
                ? items.filter(item => item.id !== queueId)
                : items.map(item => item.id === queueId
                    ? { ...item, status: QUEUE_STATUS.ERROR, error: stopped ? STOPPED_ERROR : (error || UNKNOWN_ERROR) }
                    : item);
        }

        const isWorker = tabId != null && (worker == null || worker === tabId);
        const following = isWorker && !stopped ? items.find(item => item.status === QUEUE_STATUS.PENDING) : null;
        if (following) following.status = QUEUE_STATUS.ACTIVE;
        await writeItems(items);

        if (following) await writeWorker(tabId);
        else if (isWorker && worker != null) await writeWorker(null);
        return { next: following ? { id: following.id, params: following.params } : null };
    });
}

/**
 * Запускает очередь, если никто не скачивает: открывает окно загрузки первого
 * ожидающего тайтла.
 * @param {function(string): Promise<?{tabId: ?number}|boolean|null>} open - Открывает окно
 * загрузки с параметрами URL.
 * @returns {Promise<{started: boolean}>} Запущена ли очередь.
 */
export function start(open) {
    return serialized(async () => {
        if (await liveWorker() != null) return { started: false };
        const items = await readItems();
        const first = items.find(item => item.status === QUEUE_STATUS.PENDING);
        if (!first) return { started: false };

        const params = new URLSearchParams(first.params);
        params.set('queueId', first.id);
        const opened = await open(params.toString());
        if (!opened) return { started: false };

        first.status = QUEUE_STATUS.ACTIVE;
        await writeItems(items);
        if (opened.tabId != null) await writeWorker(opened.tabId);
        return { started: true };
    });
}

/**
 * Удаляет тайтл из очереди. Скачиваемый сейчас тайтл не удаляется.
 * @param {string} id - id тайтла очереди.
 * @returns {Promise<void>}
 */
export function remove(id) {
    return serialized(async () => {
        const items = await readItems();
        const left = items.filter(item => item.id !== id || item.status === QUEUE_STATUS.ACTIVE);
        if (left.length !== items.length) await writeItems(left);
    });
}

/**
 * Удаляет из очереди все тайтлы, кроме скачиваемого сейчас.
 * @returns {Promise<void>}
 */
export function clear() {
    return serialized(async () => {
        const items = await readItems();
        await writeItems(items.filter(item => item.status === QUEUE_STATUS.ACTIVE));
    });
}

/**
 * Забывает окно, которое скачивало, когда его закрыли, и возвращает его тайтл
 * в ожидание.
 * @param {number} tabId - id закрытой вкладки.
 * @returns {Promise<void>}
 */
function onTabRemoved(tabId) {
    return serialized(async () => {
        if (await readWorker() !== tabId) return;
        await writeWorker(null);
        await requeueActive();
    });
}

extensionApi?.tabs?.onRemoved?.addListener(onTabRemoved);
