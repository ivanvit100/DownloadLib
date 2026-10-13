/**
 * DownloadLib core module
 * Background (deferred) loading of images and chapters that are too slow to wait for
 * @module core/DeferredQueue
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { chapterKey } from './chapters.js';

/**
 * Параметры фоновой (отложенной) загрузки изображений и глав.
 * deferAfterMs — сколько ждать изображение или главу, прежде чем отложить её
 * и продолжить загрузку остального контента; backgroundAttemptTimeoutMs — сколько
 * ждать фоновую попытку, прежде чем параллельно запустить следующую; retryDelayMs —
 * пауза перед повтором после неудачной фоновой попытки; maxAttempts — сколько всего
 * попыток (включая первую) даётся элементу, прежде чем на его месте останется текст
 * ошибки; maxDeferredChapters — сколько глав может одновременно грузиться в фоне;
 * defaultImageBytes/defaultChapterBytes — оценка размера, пока не загружено ни одного
 * изображения/главы; pollIntervalMs — период проверки остановки загрузки, если её
 * контроллер не умеет сообщать об остановке сам (нет whenStopped).
 */
export const DEFERRED_SETTINGS = {
    deferAfterMs: 30000,
    backgroundAttemptTimeoutMs: 180000,
    retryDelayMs: 15000,
    maxAttempts: 5,
    maxDeferredChapters: 3,
    defaultImageBytes: 300 * 1024,
    defaultChapterBytes: 2 * 1024 * 1024,
    pollIntervalMs: 250
};

/**
 * Переводит миллисекунды в секунды для логов.
 * @param {number} ms - Длительность в миллисекундах.
 * @returns {number} Длительность в секундах.
 */
function seconds(ms) {
    return ms / 1000;
}

/**
 * Подпись главы для логов.
 * @param {{title?: string}} chapter - Глава.
 * @returns {string}
 */
function chapterName(chapter) {
    return chapter.title ? `Chapter "${chapter.title}"` : 'Chapter';
}

/**
 * Ждёт операцию не дольше ms; пока загрузка придержана (isHeldBack), срок продлевается.
 * @param {Promise<*>} promise - Ожидаемая операция.
 * @param {number} ms - Срок ожидания.
 * @param {function(): boolean} [isHeldBack] - Придержана ли загрузка сейчас (пауза,
 * очередь ограничителя запросов): пока да, срок не истекает.
 * @returns {Promise<{done: boolean, value?: *}>} done=true и результат, если операция
 * завершилась в срок; done=false, если срок истёк (операция продолжает выполняться).
 * @throws {*} Ошибку операции, если она завершилась ошибкой до истечения срока.
 */
export function waitWithDeadline(promise, ms, isHeldBack = () => false) {
    return new Promise((resolve, reject) => {
        let timer;
        const arm = () => {
            timer = setTimeout(() => {
                if (isHeldBack()) arm();
                else resolve({ done: false });
            }, ms);
        };
        arm();
        promise.then(value => {
            clearTimeout(timer);
            resolve({ done: true, value });
        }, error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

/**
 * Оценивает приблизительный размер содержимого главы в байтах. Метки фоновых
 * загрузок учитываются по оценочному размеру того, что окажется на их месте.
 * @param {?{content: Array, pendingChapter?: object}} chapter - Обработанное содержимое главы.
 * @returns {number} Оценочный размер в байтах.
 */
export function estimateContentSize(chapter) {
    if (!chapter || !Array.isArray(chapter.content)) return 0;
    if (chapter.pendingChapter) return chapter.pendingChapter.estimatedBytes || 0;
    let bytes = 0;
    for (const block of chapter.content) {
        if (block.pendingImage)
            bytes += block.pendingImage.estimatedBytes || 0;
        else if (block.type === 'text' && block.text)
            bytes += block.text.length * 2;
        else if (block.type === 'image') {
            const b64 = (block.data && block.data.base64) ? block.data.base64 : '';
            if (b64) bytes += Math.ceil(b64.length * 3 / 4);
        }
    }
    return bytes;
}

/**
 * Загружает изображение, не задерживая главу дольше deferAfterMs: если load() не
 * успела, вместо изображения возвращается метка, а загрузка продолжается в фоне.
 * DownloadManager подхватывает метку из содержимого главы и вставляет изображение
 * на её место, как только фоновая загрузка завершится (при неудаче — повторяет её).
 * @param {string|number} label - Подпись изображения (обычно номер страницы).
 * @param {function(): Promise<?object[]>} load - Загрузка изображения: готовые блоки
 * содержимого, либо null при ошибке.
 * @param {function(): boolean} [isHeldBack] - Придержана ли загрузка (см. waitWithDeadline).
 * @returns {Promise<?object[]>} Блоки изображения, null при ошибке, либо [метка].
 * @throws {*} Ошибку load(), если она случилась до истечения срока.
 */
export async function loadImageOrDefer(label, load, isHeldBack) {
    const running = Promise.resolve().then(load);
    const outcome = await waitWithDeadline(running, DEFERRED_SETTINGS.deferAfterMs, isHeldBack);
    if (outcome.done) return outcome.value;
    console.warn(`[DeferredQueue] Image ${label} not loaded within ${seconds(DEFERRED_SETTINGS.deferAfterMs)} s, ` +
        'temporarily skipped, it keeps loading in background');
    return [{
        type: 'text',
        text: `[Изображение ${label} загружается в фоне]`,
        pendingImage: { label, load, running, estimatedBytes: 0 }
    }];
}

/**
 * Фоновые загрузки одной загрузки тайтла — изображения и главы, не успевшие
 * загрузиться за deferAfterMs. Каждая продолжает загружаться в фоне и, как только
 * завершится, вставляется на место своей метки. Неудачная попытка повторяется
 * через retryDelayMs; попытка, висящая дольше backgroundAttemptTimeoutMs, дублируется
 * новой (старая продолжает работать, засчитывается первый успех). После maxAttempts
 * попыток на месте метки остаётся текст ошибки.
 */
export class DeferredQueue {
    /**
     * Создаёт пустую очередь.
     * @param {function(): boolean} [isHeldBack] - Придержана ли загрузка сейчас: пока
     * да, срок фоновой попытки не истекает.
     */
    constructor(isHeldBack = () => false) {
        this.isHeldBack = isHeldBack;
        this.entries = [];
        this.listeners = new Set();
        this.disposed = false;
        this.observed = new WeakSet();
        this.imageBytes = 0;
        this.imageCount = 0;
        this.chapterBytes = 0;
        this.chapterCount = 0;
    }

    /**
     * Количество незавершённых фоновых загрузок.
     * @returns {number}
     */
    get size() {
        return this.entries.length;
    }

    /**
     * Количество незавершённых фоновых загрузок, относящихся к указанным главам.
     * @param {?object[]} chapters - Главы, либо null — все загрузки.
     * @returns {number}
     */
    countFor(chapters) {
        if (!chapters) return this.entries.length;
        const owners = new Set(chapters);
        return this.entries.filter(e => owners.has(e.owner)).length;
    }

    /**
     * Количество глав, загружающихся в фоне целиком.
     * @returns {number}
     */
    countChapters() {
        return this.entries.filter(e => e.kind === 'chapter').length;
    }

    /**
     * Подписывается на изменения очереди: добавление и завершение фоновых загрузок.
     * @param {function(): void} listener - Вызывается после каждого изменения.
     * @returns {function(): void} Отписка.
     */
    onChange(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Сообщает подписчикам об изменении очереди.
     * @returns {void}
     */
    _changed() {
        [...this.listeners].forEach(listener => listener());
    }

    /**
     * Ждёт, пока завершатся фоновые загрузки указанных глав, без опроса по таймеру.
     * Разрешается и при dispose().
     * @param {?object[]} chapters - Главы, либо null — все загрузки.
     * @returns {Promise<void>}
     */
    whenSettled(chapters) {
        if (this.countFor(chapters) === 0) return Promise.resolve();
        return new Promise(resolve => {
            const off = this.onChange(() => {
                if (this.disposed || this.countFor(chapters) === 0) {
                    off();
                    resolve();
                }
            });
        });
    }

    /**
     * Средний размер загруженного изображения в байтах (или оценка по умолчанию).
     * @returns {number}
     */
    averageImageBytes() {
        return this.imageCount > 0
            ? Math.ceil(this.imageBytes / this.imageCount)
            : DEFERRED_SETTINGS.defaultImageBytes;
    }

    /**
     * Средний размер загруженной главы в байтах (или оценка по умолчанию).
     * @returns {number}
     */
    averageChapterBytes() {
        return this.chapterCount > 0
            ? Math.ceil(this.chapterBytes / this.chapterCount)
            : DEFERRED_SETTINGS.defaultChapterBytes;
    }

    /**
     * Учитывает загруженную главу: обновляет средние размеры и ставит в фоновую
     * загрузку её отложенные изображения, резервируя под них оценочный размер.
     * @param {?{content: Array}} chapter - Обработанное содержимое главы.
     * @returns {void}
     */
    observe(chapter) {
        if (!chapter || !Array.isArray(chapter.content) || chapter.pendingChapter) return;
        if (this.observed.has(chapter)) return;
        this.observed.add(chapter);

        const skipped = [];
        for (const block of chapter.content) {
            if (block.type === 'image') this._countImage(block);
            else if (block.pendingImage) {
                block.pendingImage.estimatedBytes = this.averageImageBytes();
                this._addImage(chapter, block);
                skipped.push(block.pendingImage.label);
            }
        }
        this.chapterBytes += estimateContentSize(chapter);
        this.chapterCount += 1;

        if (skipped.length === 0) return;
        const estimateKb = Math.round(this.averageImageBytes() / 1024);
        console.warn(`[DeferredQueue] ${chapterName(chapter)}: ${skipped.length} image(s) loading ` +
            `in background (${skipped.join(', ')}), ~${estimateKb} KB each reserved`);
    }

    /**
     * Добавляет размер блока изображения в статистику среднего размера.
     * @param {object} block - Блок изображения.
     * @returns {void}
     */
    _countImage(block) {
        const b64 = block.data?.base64;
        if (!b64) return;
        this.imageBytes += Math.ceil(b64.length * 3 / 4);
        this.imageCount += 1;
    }

    /**
     * Ставит в фоновую загрузку отложенное изображение главы.
     * @param {object} chapter - Глава, в содержимом которой стоит метка.
     * @param {object} block - Метка изображения.
     * @returns {void}
     */
    _addImage(chapter, block) {
        const { label, load, running } = block.pendingImage;
        this._add({
            kind: 'image',
            owner: chapter,
            name: chapter.title ? `Image ${label} of chapter "${chapter.title}"` : `Image ${label}`,
            load,
            running,
            isSuccess: blocks => Array.isArray(blocks) && blocks.length > 0,
            apply: blocks => {
                const index = chapter.content.indexOf(block);
                if (index !== -1) chapter.content.splice(index, 1, ...blocks);
                blocks.forEach(b => { if (b.type === 'image') this._countImage(b); });
            },
            fail: () => {
                block.text = `[Ошибка загрузки изображения ${label}]`;
                delete block.pendingImage;
            }
        });
    }

    /**
     * Откладывает главу, не загрузившуюся за deferAfterMs: возвращает главу-метку,
     * которая занимает место главы в пакете сохранения и заполняется содержимым,
     * как только фоновая загрузка главы завершится.
     * @param {object} chapter - Метаданные главы (name, volume, number).
     * @param {string} title - Заголовок главы.
     * @param {function(): Promise<object>} load - Загрузка содержимого главы.
     * @param {Promise<object>} running - Уже идущая загрузка главы.
     * @returns {object} Глава-метка.
     */
    deferChapter(chapter, title, load, running) {
        const placeholder = {
            title,
            content: [{ type: 'text', text: '[Глава загружается в фоне]' }],
            volume: chapter.volume,
            number: chapter.number,
            key: chapterKey(chapter),
            pendingChapter: { estimatedBytes: this.averageChapterBytes() }
        };
        console.warn(`[DeferredQueue] ${chapterName(placeholder)} not loaded within ` +
            `${seconds(DEFERRED_SETTINGS.deferAfterMs)} s, temporarily skipped, it keeps loading in background ` +
            `(~${Math.round(placeholder.pendingChapter.estimatedBytes / 1024)} KB reserved)`);
        this._add({
            kind: 'chapter',
            owner: placeholder,
            name: chapterName(placeholder),
            load,
            running,
            isSuccess: result => !!result,
            apply: result => {
                delete placeholder.pendingChapter;
                Object.assign(placeholder, result);
                this.observe(placeholder);
            },
            fail: reason => {
                delete placeholder.pendingChapter;
                placeholder.content = [{ type: 'text', text: `[Ошибка загрузки главы: ${reason}]` }];
            }
        });
        return placeholder;
    }

    /**
     * Регистрирует фоновую загрузку и начинает следить за уже идущей попыткой.
     * @param {object} spec - Описание загрузки (kind, owner, name, load, running,
     * isSuccess, apply, fail).
     * @returns {void}
     */
    _add(spec) {
        const entry = { ...spec, attempts: 1, done: false, timer: null };
        this.entries.push(entry);
        this._watch(entry, spec.running, 1);
        this._changed();
    }

    /**
     * Следит за попыткой загрузки: первый успех вставляется на место метки,
     * неудача последней попытки планирует повтор.
     * @param {object} entry - Фоновая загрузка.
     * @param {Promise<*>} promise - Попытка загрузки.
     * @param {number} attempt - Номер попытки.
     * @returns {void}
     */
    _watch(entry, promise, attempt) {
        promise.then(result => {
            if (entry.done) return;
            if (entry.isSuccess(result)) this._succeed(entry, result, attempt);
            else if (attempt === entry.attempts) this._retryLater(entry, 'source returned an error');
        }, error => {
            if (entry.done || attempt !== entry.attempts) return;
            // Прерванная остановкой загрузка не повторяется: метки снимает cancelAll.
            if (error?.aborted) {
                clearTimeout(entry.timer);
                return;
            }
            this._retryLater(entry, error?.message || String(error));
        });
        this._armAttemptTimeout(entry);
    }

    /**
     * Запускает отсчёт времени текущей попытки: если она висит дольше
     * backgroundAttemptTimeoutMs, параллельно запускается следующая. Таймер
     * снимается при завершении загрузки и заменяется при каждой новой попытке.
     * @param {object} entry - Фоновая загрузка.
     * @returns {void}
     */
    _armAttemptTimeout(entry) {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
            if (this.isHeldBack()) {
                this._armAttemptTimeout(entry);
                return;
            }
            const waited = seconds(DEFERRED_SETTINGS.backgroundAttemptTimeoutMs);
            if (entry.attempts >= DEFERRED_SETTINGS.maxAttempts) {
                this._giveUp(entry, `still not loaded ${waited} s after attempt ${entry.attempts}`);
                return;
            }
            console.warn(`[DeferredQueue] ${entry.name}: still loading after ${waited} s, ` +
                'starting another attempt, the previous one keeps running');
            this._startAttempt(entry);
        }, DEFERRED_SETTINGS.backgroundAttemptTimeoutMs);
    }

    /**
     * Планирует повтор после неудачной попытки, либо сдаётся, если попытки исчерпаны.
     * @param {object} entry - Фоновая загрузка.
     * @param {string} reason - Причина неудачи (для лога).
     * @returns {void}
     */
    _retryLater(entry, reason) {
        const { maxAttempts, retryDelayMs } = DEFERRED_SETTINGS;
        if (entry.attempts >= maxAttempts) {
            this._giveUp(entry, `${reason}, ${entry.attempts} attempt(s) made`, reason);
            return;
        }
        console.warn(`[DeferredQueue] ${entry.name}: background attempt ${entry.attempts}/${maxAttempts} ` +
            `failed (${reason}), retrying in ${seconds(retryDelayMs)} s`);
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => this._startAttempt(entry), retryDelayMs);
    }

    /**
     * Запускает очередную попытку фоновой загрузки.
     * @param {object} entry - Фоновая загрузка.
     * @returns {void}
     */
    _startAttempt(entry) {
        entry.attempts += 1;
        console.log(`[DeferredQueue] ${entry.name}: retrying download in background ` +
            `(attempt ${entry.attempts}/${DEFERRED_SETTINGS.maxAttempts})...`);
        this._watch(entry, Promise.resolve().then(() => entry.load()), entry.attempts);
    }

    /**
     * Вставляет загруженный результат на место метки.
     * @param {object} entry - Фоновая загрузка.
     * @param {*} result - Результат загрузки.
     * @param {number} attempt - Номер успешной попытки.
     * @returns {void}
     */
    _succeed(entry, result, attempt) {
        this._finish(entry);
        entry.apply(result);
        console.log(`[DeferredQueue] ${entry.name}: loaded in background (attempt ${attempt}), inserted into place`);
        if (entry.kind === 'image' && !this.entries.some(e => e.owner === entry.owner))
            console.log(`[DeferredQueue] ${chapterName(entry.owner)}: all background images inserted`);
        this._changed();
    }

    /**
     * Отказывается от фоновой загрузки, оставляя на месте метки текст ошибки.
     * @param {object} entry - Фоновая загрузка.
     * @param {string} reason - Причина отказа (для лога).
     * @param {string} [cause] - Причина для текста ошибки главы (по умолчанию reason).
     * @returns {void}
     */
    _giveUp(entry, reason, cause = reason) {
        this._finish(entry);
        console.warn(`[DeferredQueue] ${entry.name}: giving up (${reason}), leaving error marker`);
        entry.fail(cause);
        this._changed();
    }

    /**
     * Снимает загрузку с учёта и останавливает её таймеры.
     * @param {object} entry - Фоновая загрузка.
     * @returns {void}
     */
    _finish(entry) {
        entry.done = true;
        clearTimeout(entry.timer);
        this.entries = this.entries.filter(e => e !== entry);
    }

    /**
     * Отменяет все фоновые загрузки (при остановке загрузки тайтла), оставляя на
     * местах меток текст ошибки, чтобы уже загруженное можно было сохранить.
     * @param {string} reason - Причина отмены.
     * @returns {void}
     */
    cancelAll(reason) {
        if (this.entries.length === 0) return;
        console.log(`[DeferredQueue] Download stopped, cancelling ${this.entries.length} background load(s)`);
        this.entries.slice().forEach(entry => this._giveUp(entry, reason));
    }

    /**
     * Молча снимает все фоновые загрузки и их таймеры (по завершении загрузки тайтла)
     * и отпускает всех, кто ждёт whenSettled.
     * @returns {void}
     */
    dispose() {
        this.disposed = true;
        this.entries.forEach(entry => {
            entry.done = true;
            clearTimeout(entry.timer);
        });
        this.entries = [];
        this._changed();
        this.listeners.clear();
    }
}
