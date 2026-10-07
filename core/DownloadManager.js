/**
 * DownloadLib core module
 * Manages manga downloads from various services
 * @module core/DownloadManager
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi, fetchViaTab, hasServiceTab, NoServiceTabError } from './BrowserApi.js';
import { EventBus } from './EventBus.js';
import { ImageCompressor } from './ImageCompressor.js';
import { MangaPatcher } from './MangaPatcher.js';
import { PluginManager } from './PluginManager.js';
import { globalRateLimiter } from './RateLimiter.js';
import { ExporterRegistry } from '../exporters/ExporterRegistry.js';
import { serviceRegistry } from '../services/ServiceRegistry.js';

console.log('[DownloadManager] Loading...');

let activeGate = null;

/**
 * Габариты, в которые вписываются изображения FB2 при включённой настройке.
 * Okular вёрстает FB2 на страницы 600×800 с полями 20px и режет картинки,
 * не помещающиеся по высоте; запас по высоте — на отступы абзаца и строки.
 */
const FB2_IMAGE_FIT = { maxWidth: 560, maxHeight: 740 };

/**
 * Параметры фоновой (отложенной) загрузки изображений и глав.
 * deferAfterMs — сколько ждать изображение или главу, прежде чем отложить её
 * и продолжить загрузку остального контента; backgroundAttemptTimeoutMs — сколько
 * ждать фоновую попытку, прежде чем параллельно запустить следующую; retryDelayMs —
 * пауза перед повтором после неудачной фоновой попытки; maxAttempts — сколько всего
 * попыток (включая первую) даётся элементу, прежде чем на его месте останется текст
 * ошибки; maxDeferredChapters — сколько глав может одновременно грузиться в фоне;
 * defaultImageBytes/defaultChapterBytes — оценка размера, пока не загружено ни одного
 * изображения/главы; pollIntervalMs — период проверки при ожидании фоновых загрузок.
 */
const DEFERRED_SETTINGS = {
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
 * Проверяет, что загрузка сейчас медленная по нашей же причине: она на паузе,
 * либо запросы ждут своей очереди в rate limiter'е (в т.ч. после ответа 429).
 * Пока это так, сроки ожидания не истекают — откладывать контент из-за
 * собственного ограничения бессмысленно.
 * @returns {boolean}
 */
function isHeldBack() {
    if (activeGate?.controller?.isPaused?.()) return true;
    const stats = globalRateLimiter.getStats();
    return !!stats && (stats.queueSize > 0 || stats.throttled === true);
}

/**
 * Ждёт операцию не дольше ms; пока загрузка придержана (isHeldBack), срок продлевается.
 * @param {Promise<*>} promise - Ожидаемая операция.
 * @param {number} ms - Срок ожидания.
 * @returns {Promise<{done: boolean, value?: *}>} done=true и результат, если операция
 * завершилась в срок; done=false, если срок истёк (операция продолжает выполняться).
 * @throws {*} Ошибку операции, если она завершилась ошибкой до истечения срока.
 */
function waitWithDeadline(promise, ms) {
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
function estimateContentSize(chapter) {
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
 * @returns {Promise<?object[]>} Блоки изображения, null при ошибке, либо [метка].
 * @throws {*} Ошибку load(), если она случилась до истечения срока.
 */
export async function loadImageOrDefer(label, load) {
    const running = Promise.resolve().then(load);
    const outcome = await waitWithDeadline(running, DEFERRED_SETTINGS.deferAfterMs);
    if (outcome.done) return outcome.value;
    console.warn(`[DownloadManager] Image ${label} not loaded within ${seconds(DEFERRED_SETTINGS.deferAfterMs)} s, ` +
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
     */
    constructor() {
        this.entries = [];
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
        console.warn(`[DownloadManager] ${chapterName(chapter)}: ${skipped.length} image(s) loading ` +
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
            pendingChapter: { estimatedBytes: this.averageChapterBytes() }
        };
        console.warn(`[DownloadManager] ${chapterName(placeholder)} not loaded within ` +
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
            if (isHeldBack()) {
                this._armAttemptTimeout(entry);
                return;
            }
            const waited = seconds(DEFERRED_SETTINGS.backgroundAttemptTimeoutMs);
            if (entry.attempts >= DEFERRED_SETTINGS.maxAttempts) {
                this._giveUp(entry, `still not loaded ${waited} s after attempt ${entry.attempts}`);
                return;
            }
            console.warn(`[DownloadManager] ${entry.name}: still loading after ${waited} s, ` +
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
        console.warn(`[DownloadManager] ${entry.name}: background attempt ${entry.attempts}/${maxAttempts} ` +
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
        console.log(`[DownloadManager] ${entry.name}: retrying download in background ` +
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
        console.log(`[DownloadManager] ${entry.name}: loaded in background (attempt ${attempt}), inserted into place`);
        if (entry.kind === 'image' && !this.entries.some(e => e.owner === entry.owner))
            console.log(`[DownloadManager] ${chapterName(entry.owner)}: all background images inserted`);
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
        console.warn(`[DownloadManager] ${entry.name}: giving up (${reason}), leaving error marker`);
        entry.fail(cause);
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
        console.log(`[DownloadManager] Download stopped, cancelling ${this.entries.length} background load(s)`);
        this.entries.slice().forEach(entry => this._giveUp(entry, reason));
    }

    /**
     * Молча снимает все фоновые загрузки и их таймеры (по завершении загрузки тайтла).
     * @returns {void}
     */
    dispose() {
        this.entries.forEach(entry => {
            entry.done = true;
            clearTimeout(entry.timer);
        });
        this.entries = [];
    }
}

/**
 * Функция, прерывающая загрузку при паузе или завершении загрузки.
 * @param { DownloadManager } controller - Контроллер загрузки,
 * предоставляющий методы для проверки состояния загрузки.
 * @returns {interrupted: boolean, checkpoint: function(): Promise<void> } - Флаги состояния загрузки
 * и функция для проверки состояния загрузки.
 */
function createGate(controller) {
    const gate = {
        controller,
        interrupted: false,
        async checkpoint() {
            await controller.waitIfPaused();
            if (controller.shouldStop()) {
                gate.interrupted = true;
                const error = new Error('Download aborted');
                error.aborted = true;
                throw error;
            }
        }
    };
    return gate;
}

/**
 * Оркестрирует полный жизненный цикл загрузки тайтла с сервиса: получение
 * метаданных и глав, скачивание содержимого с учётом паузы/остановки,
 * разбиение результата на файлы по лимиту размера и сохранение готовых файлов.
 */
export class DownloadManager {
    /**
     * Создаёт менеджер с пустой картой активных загрузок и собственной шиной событий.
     */
    constructor() {
        this.activeDownloads = new Map();
        this.eventBus = new EventBus();
        console.log('[DownloadManager] Instance created');
    }

    /**
     * Создаёт экспортёр указанного формата, при необходимости предварительно
     * догружая плагины (если формат не зарегистрирован стандартными экспортёрами).
     * @param {string} format - Ключ формата экспорта.
     * @returns {Promise<object>} Экземпляр экспортёра.
     */
    async _createExporter(format) {
        if (!ExporterRegistry.getSupportedFormats().includes(format.toLowerCase())) {
            console.log(`[DownloadManager] Format "${format}" not registered, loading plugins...`);
            await PluginManager.loadAll();
        }
        return ExporterRegistry.create(format);
    }

    /**
     * Определяет экземпляр сервиса по ключу или по URL и, при наличии токена,
     * подставляет его в заголовок Authorization конфигурации сервиса.
     * @param {?string} serviceKey - Ключ сервиса (приоритетнее url).
     * @param {?string} url - URL тайтла, используется, если serviceKey не передан.
     * @param {?string} authToken - Токен авторизации для подстановки в заголовки.
     * @returns {object} Экземпляр сервиса.
     */
    _resolveService(serviceKey, url, authToken) {
        let service;
        if (serviceKey) {
            service = serviceRegistry.createService(serviceKey);
            if (!service) throw new Error(`Unknown service: ${serviceKey}`);
        } else if (url)
            service = serviceRegistry.getServiceByUrl(url);
        else
            throw new Error('Either serviceKey or url must be provided');

        if (!service) throw new Error('Unsupported service');

        if (authToken)
            service.config.headers = { ...service.config.headers, 'Authorization': `Bearer ${authToken}` };

        return service;
    }

    /**
     * Строит начальное состояние новой загрузки на основе переданных опций.
     * @param {object} options - Опции запуска загрузки (см. startDownload).
     * @param {object} service - Разрешённый экземпляр сервиса.
     * @returns {object} Начальное состояние загрузки, регистрируемое в activeDownloads.
     */
    _createDownloadState(options, service) {
        const { url, format = 'fb2', slug, serviceKey, controller,
            maxSizeMB = 200, splitPages = true, fitFb2Images = false } = options;
        const downloadId = this.generateId();
        return {
            id: downloadId,
            service: service.name,
            serviceKey,
            slug: slug || this.extractSlug(url),
            format,
            maxSizeMB,
            splitPages,
            imageFit: fitFb2Images && format === 'fb2' ? FB2_IMAGE_FIT : null,
            status: 'initializing',
            progress: 0,
            controller: controller || this.createController(),
            manga: null,
            mangaId: null,
            coverBase64: null,
            chapterContents: [],
            chapters: [],
            currentChapterIndex: 0,
            deferred: new DeferredQueue()
        };
    }

    /**
     * Ставит в фоновую загрузку отложенные изображения загруженной главы.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {object} chapterResult - Обработанное содержимое главы.
     * @returns {void}
     */
    _trackDeferred(downloadState, chapterResult) {
        downloadState.deferred?.observe(chapterResult);
    }

    /**
     * Ждёт завершения фоновых загрузок указанных глав (или всех), не загружая
     * ничего сам. Если загрузку остановили, отменяет фоновые загрузки, оставляя
     * на их местах текст ошибки, чтобы уже загруженное можно было сохранить.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {?object[]} chapters - Главы, загрузки которых нужно дождаться, либо null — все.
     * @param {{report?: boolean, progress?: number}} [opts] - report — показывать в статусе,
     * сколько загрузок осталось; progress — процент прогресса для статуса.
     * @returns {Promise<void>}
     */
    async _waitForDeferred(downloadState, chapters, { report = false, progress = 95 } = {}) {
        const queue = downloadState.deferred;
        if (!queue || queue.countFor(chapters) === 0) return;
        console.log(`[DownloadManager] Waiting for ${queue.countFor(chapters)} background load(s)`);
        let reported = -1;
        for (;;) {
            const count = queue.countFor(chapters);
            if (count === 0) return;
            if (downloadState.controller.shouldStop()) {
                queue.cancelAll('download stopped');
                return;
            }

            if (report && count !== reported) {
                reported = count;
                this.updateStatus(downloadState.id, `Дозагрузка в фоне: осталось ${count}...`, progress);
            }
            await new Promise(resolve => setTimeout(resolve, DEFERRED_SETTINGS.pollIntervalMs));
        }
    }

    /**
     * Строит статус загрузки главы с числом фоновых загрузок, если они есть.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {string} message - Базовый текст статуса.
     * @returns {string} Текст статуса.
     */
    _withPendingInfo(downloadState, message) {
        const pending = downloadState.deferred?.size || 0;
        return pending > 0 ? `${message} (в фоне: ${pending})` : message;
    }

    /**
     * Загружает список глав тайтла у сервиса, сортирует их и фильтрует
     * по ветке перевода и/или диапазону индексов.
     * @param {object} service - Экземпляр сервиса.
     * @param {object} downloadState - Текущее состояние загрузки (используется slug).
     * @param {?number} branchId - id ветки перевода для фильтрации, либо null.
     * @param {?{from: number, to: number}} chapterRange - Диапазон индексов глав, либо null.
     * @returns {Promise<object[]>} Отфильтрованный и отсортированный список глав.
     */
    async _fetchAndFilterChapters(service, downloadState, branchId, chapterRange) {
        const chaptersData = await service.fetchChaptersList(downloadState.slug);
        let chapters = this.sortChapters(chaptersData.data || []);

        if (branchId != null) {
            chapters = chapters
                .filter(ch => ch.branches && ch.branches.some(b => b.branch_id === branchId))
                .map(ch => ({ ...ch, branchId }));
            console.log(`[DownloadManager] Filtered chapters by branch ${branchId}: ${chapters.length}`);
        }

        if (chapterRange && 'from' in chapterRange && 'to' in chapterRange) {
            chapters = chapters.slice(chapterRange.from, chapterRange.to + 1);
            console.log(`[DownloadManager] Filtered chapters: ${chapters.length} from ${chapterRange.from} to ${chapterRange.to}`);
        }

        return chapters;
    }

    /**
     * Открывает и поддерживает long-lived порт подключения к background-скрипту
     * (с автопереподключением при разрыве), чтобы service worker не выгружался
     * во время длительной загрузки.
     * @returns {?{stopped: boolean, port: ?object, interval: ?number,
     * reconnectTimer: ?number}} Объект состояния keep-alive, либо null,
     * если runtime.connect недоступен.
     */
    _startKeepAlive() {
        if (!extensionApi?.runtime?.connect) return null;

        const state = { stopped: false, port: null, interval: null, reconnectTimer: null };

        const connect = () => {
            if (state.stopped) return;
            try {
                const port = extensionApi.runtime.connect({ name: 'downloadKeepAlive' });
                state.port = port;
                state.interval = setInterval(() => {
                    try {
                        port.postMessage({ type: 'ping' });
                    } catch (e) {
                        clearInterval(state.interval);
                    }
                }, 20000);
                port.onDisconnect?.addListener?.(() => {
                    clearInterval(state.interval);
                    if (state.stopped) return;
                    state.reconnectTimer = setTimeout(connect, 2000);
                });
            } catch (e) {
                console.warn('[DownloadManager] Failed to start keep-alive port:', e.message);
            }
        };

        connect();
        return state;
    }

    /**
     * Останавливает keep-alive порт: снимает таймеры и отключает соединение.
     * @param {?object} keepAlive - Объект состояния, возвращённый _startKeepAlive.
     * @returns {void}
     */
    _stopKeepAlive(keepAlive) {
        if (!keepAlive) return;
        keepAlive.stopped = true;
        clearInterval(keepAlive.interval);
        clearTimeout(keepAlive.reconnectTimer);
        try {
            keepAlive.port?.disconnect();
        } catch (e) {  }
    }

    /**
     * Запускает полный цикл новой загрузки тайтла: разрешает сервис, создаёт
     * состояние загрузки и keep-alive порт, затем последовательно загружает
     * метаданные, обложку, список глав и содержимое глав с разбиением
     * на файлы по лимиту размера.
     * @param {{url?: string, format?: string, chapterRange?: {from: number, to: number},
     * branchId?: number, maxSizeMB?: number, authToken?: string,
     * serviceKey?: string, slug?: string, controller?: object, splitPages?: boolean,
     * fitFb2Images?: boolean}} options
     * Параметры загрузки.
     * @returns {Promise<{success: boolean, downloadId: string}>} Результат загрузки.
     * @throws {Error} При ошибке на любом из этапов загрузки (после эмиссии download:failed).
     */
    async startDownload(options) {
        console.log('[DownloadManager] Starting download with options:', options);
        const { url, format = 'fb2', chapterRange, branchId = null, maxSizeMB = 200,
            authToken = null, serviceKey } = options;

        const service = this._resolveService(serviceKey, url, authToken);
        console.log('[DownloadManager] Using service:', service.name);

        const downloadState = this._createDownloadState(options, service);
        const { id: downloadId } = downloadState;

        this.activeDownloads.set(downloadId, downloadState);
        this.eventBus.emit('download:started', downloadState);

        const keepAlive = this._startKeepAlive();
        const gate = createGate(downloadState.controller);
        downloadState.gate = gate;
        service._gate = gate;
        activeGate = gate;

        try {
            this.updateStatus(downloadId, 'Загрузка метаданных...', 5);
            const metadata = await service.fetchMangaMetadata(downloadState.slug);
            console.log('[DownloadManager] Metadata:', metadata);

            const patched = MangaPatcher.patch(metadata.data || metadata);
            downloadState.manga = patched;
            downloadState.mangaId = patched.id || null;

            this.updateStatus(downloadId, 'Загружаем обложку...', 7);
            const coverPromise = this._fetchCoverBase64(service, patched.cover, downloadState.imageFit)
                .then(cover => {
                    downloadState.coverBase64 = cover;
                    return cover;
                });

            this.updateStatus(downloadId, 'Загрузка списка глав...', 10);
            const chapters = await this._fetchAndFilterChapters(service, downloadState, branchId, chapterRange);
            downloadState.chapters = chapters;

            await this.downloadWithSizeLimit(downloadState,
                service, chapters, patched, coverPromise, format, maxSizeMB);

            this.updateStatus(downloadId, 'Готово!', 100);
            this.eventBus.emit('download:completed', downloadState);
            return { success: true, downloadId };
        } catch (error) {
            console.error('[DownloadManager] Error:', error);
            this.updateStatus(downloadId, `Ошибка: ${error.message}`, -1);
            this.eventBus.emit('download:failed', { downloadState, error });
            throw error;
        } finally {
            downloadState.deferred.dispose();
            if (activeGate === gate) activeGate = null;
            if (service._gate === gate) service._gate = null;
            this._stopKeepAlive(keepAlive);
            setTimeout(() => this.activeDownloads.delete(downloadId), 5000);
        }
    }

    /**
     * Загружает обложку тайтла и кодирует её в data-URL с base64-содержимым.
     * @param {object} service - Экземпляр сервиса (используется для rate limiting по имени).
     * @param {?string} cover - URL обложки.
     * @param {?{maxWidth: number, maxHeight: number}} [imageFit] - Габариты, в которые
     * вписывается обложка; без них обложка сохраняется как есть.
     * @returns {Promise<string>} data-URL с обложкой, либо пустая строка при
     * отсутствии URL или ошибке загрузки.
     */
    async _fetchCoverBase64(service, cover, imageFit = null) {
        if (!cover || typeof cover !== 'string') return '';
        try {
            const result = await fetchViaTab(cover, service.name);
            if (result?.ok) {
                const { base64, contentType } = imageFit
                    ? await ImageCompressor.compress(result.base64, result.contentType, imageFit)
                    : result;
                return `data:${contentType};base64,${base64}`;
            }
            console.warn('[DownloadManager] fetchViaTab returned no result for cover');
            return '';
        } catch (e) {
            console.warn('[DownloadManager] Failed to load cover:', e);
            return '';
        }
    }

    /**
     * Оценивает приблизительный размер содержимого главы в байтах (для решения
     * о необходимости разбиения файла по лимиту размера). Метки отложенных
     * изображений учитываются по оценочному размеру будущего изображения.
     * @param {?{content: Array}} chapter - Обработанное содержимое главы.
     * @returns {number} Оценочный размер в байтах.
     */
    estimateChapterSize(chapter) {
        return estimateContentSize(chapter);
    }

    /**
     * Возвращает номер тома главы (или '1', если том не указан).
     * @param {{volume?: *}} chapter - Глава.
     * @returns {*} Номер тома.
     */
    _chapterVolume(chapter) {
        return chapter.volume || '1';
    }

    /**
     * Строит суффикс названия файла тома, добавляя номер части при разбиении
     * тома на несколько файлов из-за превышения лимита размера.
     * @param {*} volume - Номер тома.
     * @param {number} partIndex - Порядковый номер части (1 — единственная/первая часть).
     * @returns {string} Суффикс вида " Том N" или " Том N (Часть M)".
     */
    _buildVolumeSuffix(volume, partIndex) {
        return partIndex > 1 ? ` Том ${volume} (Часть ${partIndex})` : ` Том ${volume}`;
    }

    /**
     * Создаёт последовательную очередь сохранения пакетов глав. Сохранение пакета
     * ждёт фоновые загрузки его глав (и обложку), но не задерживает загрузку
     * следующих глав; файлы сохраняются строго в порядке постановки в очередь.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {object} exporter - Экспортёр формата.
     * @param {object} manga - Нормализованные метаданные тайтла.
     * @param {string|Promise<string>} coverBase64 - Обложка (или промис её фоновой загрузки).
     * @returns {{enqueue: function(object[], *, number, number): void, done: function(): Promise<void>}}
     * Очередь сохранения: enqueue(пакет, том, номер части, прогресс) и done() — ожидание всех сохранений.
     */
    _createBatchSaver(downloadState, exporter, manga, coverBase64) {
        let chain = Promise.resolve();
        let cover = null;

        /**
         * Дожидается фоновой загрузки обложки (не дольше backgroundAttemptTimeoutMs).
         * @returns {Promise<string>} Обложка, либо пустая строка, если она так и не загрузилась.
         */
        const resolveCover = async () => {
            if (cover !== null) return cover;
            const outcome = await waitWithDeadline(Promise.resolve(coverBase64),
                DEFERRED_SETTINGS.backgroundAttemptTimeoutMs);
            if (!outcome.done) console.warn('[DownloadManager] Cover is still not loaded, saving without it');
            cover = outcome.done ? outcome.value : '';
            return cover;
        };

        return {
            enqueue: (batch, volume, partIndex, progress) => {
                const suffix = this._buildVolumeSuffix(volume, partIndex);
                chain = chain.then(async () => {
                    await this._waitForDeferred(downloadState, batch);
                    this.updateStatus(downloadState.id,
                        `Сохранение тома ${volume}${partIndex > 1 ? `, часть ${partIndex}` : ''}...`, progress);
                    const batchCover = await resolveCover();
                    const file = await exporter.export({ ...manga, name: manga.name + suffix }, batch, batchCover);
                    await this.saveFile(file.blob, file.filename);
                });
                chain.catch(() => {});
            },
            done: () => chain
        };
    }

    /**
     * Загружает содержимое всех глав по порядку и сохраняет результат несколькими
     * файлами — новый файл начинается при смене тома или при превышении лимита
     * размера текущего накопленного файла. Главы и изображения, не загрузившиеся
     * за deferAfterMs, догружаются в фоне, не задерживая остальные главы; файл
     * сохраняется, когда фоновые загрузки его глав завершатся.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {object} service - Экземпляр сервиса.
     * @param {object[]} chapters - Список глав для загрузки.
     * @param {object} manga - Нормализованные метаданные тайтла.
     * @param {string|Promise<string>} coverBase64 - Обложка тайтла в base64 (или промис её загрузки).
     * @param {string} format - Формат экспорта.
     * @param {number} maxSizeMB - Максимальный размер одного файла в мегабайтах.
     * @returns {Promise<void>}
     */
    async downloadWithSizeLimit(downloadState, service, chapters, manga, coverBase64, format, maxSizeMB) {
        const { id: downloadId } = downloadState;
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        const exporter = await this._createExporter(format);
        const saver = this._createBatchSaver(downloadState, exporter, manga, coverBase64);
        let currentBatch = [];
        let currentVolume = null;
        let volumePartIndex = 0;

        /**
         * Ставит накопленный пакет глав текущего тома в очередь сохранения
         * и начинает новый пакет.
         * @param {number} progress - Процент прогресса для отображения статуса.
         * @returns {void}
         */
        const flushBatch = (progress) => {
            if (currentBatch.length === 0) return;
            volumePartIndex += 1;
            saver.enqueue(currentBatch, currentVolume, volumePartIndex, progress);
            currentBatch = [];
        };

        service._on429 = () => {
            const dl = this.activeDownloads.get(downloadId);
            this.updateStatus(downloadId, 'Ожидание разрешения от сервера...', dl ? dl.progress : 0);
        };

        try {
            for (let i = 0; i < chapters.length; i++) {
                await downloadState.controller.waitIfPaused();
                if (downloadState.controller.shouldStop()) break;

                downloadState.currentChapterIndex = i;
                const chapter = chapters[i];
                const progress = Math.floor((i / chapters.length) * 80) + 10;
                this.updateStatus(downloadId, this._withPendingInfo(downloadState,
                    `Глава ${i + 1}/${chapters.length}: ${chapter.name || chapter.number}`), progress);

                const chapterResult = await this._downloadChapterOrDefer(service, downloadState, chapter);
                if (downloadState.gate?.interrupted) break;
                this._trackDeferred(downloadState, chapterResult);
                const chapterSize = this.estimateChapterSize(chapterResult);
                const chapterVolume = this._chapterVolume(chapter);
                const currentSize = currentBatch.reduce((sum, ch) => sum + this.estimateChapterSize(ch), 0);
                const volumeChanged = currentBatch.length > 0 && chapterVolume !== currentVolume;
                const sizeExceeded = currentBatch.length > 0 && currentSize + chapterSize > maxSizeBytes;

                if (volumeChanged || sizeExceeded) {
                    flushBatch(progress);
                    if (volumeChanged) volumePartIndex = 0;
                }

                if (currentBatch.length === 0) currentVolume = chapterVolume;
                currentBatch.push(chapterResult);

                downloadState.chapterContents.push(chapterResult);
            }
        } finally {
            service._on429 = null;
        }

        if (downloadState.controller.shouldStop() || downloadState.gate?.interrupted)
            downloadState.deferred?.cancelAll('download stopped');
        flushBatch(95);
        await this._waitForDeferred(downloadState, null, { report: true, progress: 95 });
        await saver.done();
    }

    /**
     * Заголовок главы для экспортёра.
     * @param {{name?: string, volume?: *, number?: *}} chapter - Метаданные главы.
     * @returns {string}
     */
    _chapterTitle(chapter) {
        return chapter.name || `Том ${chapter.volume}, Глава ${chapter.number}`;
    }

    /**
     * Строит главу-заглушку с текстом ошибки загрузки.
     * @param {object} chapter - Метаданные главы.
     * @param {Error} error - Ошибка загрузки.
     * @returns {{title: string, content: Array, volume: *, number: *}}
     */
    _errorChapter(chapter, error) {
        return {
            title: this._chapterTitle(chapter),
            content: [{ type: 'text', text: `[Ошибка загрузки главы: ${error.message}]` }],
            volume: chapter.volume,
            number: chapter.number
        };
    }

    /**
     * Загружает и обрабатывает содержимое одной главы: получает сырые данные
     * от сервиса, извлекает страницы/текст и прогоняет через обработку контента.
     * @param {object} service - Экземпляр сервиса.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {object} chapter - Метаданные главы (number, volume, branchId, name).
     * @returns {Promise<{title: string, content: Array, volume: *, number: *}>}
     * Готовое содержимое главы для экспортёра.
     * @throws {Error} При ошибке загрузки главы.
     */
    async _loadChapter(service, downloadState, chapter) {
        const fetchArgs = [downloadState.slug, chapter.number, chapter.volume || '1'];
        if (chapter.branchId != null) fetchArgs.push(chapter.branchId);
        const chapterData = await service.fetchChapter(...fetchArgs);

        const rawContent = chapterData.data || chapterData;
        const contentToExtract = rawContent.content || rawContent;

        const extractedContent = service.extractText
            ? service.extractText(contentToExtract)
            : contentToExtract;

        const processedContent = service.processChapterContent
            ? await service.processChapterContent(
                extractedContent,
                document.getElementById('status'),
                {
                    chapterMeta: rawContent,
                    chapterObj: chapter,
                    mangaSlug: downloadState.slug,
                    mangaId: downloadState.mangaId,
                    splitLongImages: downloadState.splitPages && downloadState.format !== 'simple',
                    imageFit: downloadState.imageFit
                }
              )
            : extractedContent;

        return {
            title: this._chapterTitle(chapter),
            content: processedContent,
            volume: chapter.volume,
            number: chapter.number
        };
    }

    /**
     * Загружает главу, не задерживая загрузку дольше deferAfterMs: если глава не
     * успела, она откладывается (возвращается глава-метка) и догружается в фоне.
     * Пока в фоне уже грузится maxDeferredChapters глав, глава ждётся как обычно.
     * @param {object} service - Экземпляр сервиса.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {object} chapter - Метаданные главы.
     * @returns {Promise<object>} Содержимое главы, либо глава-метка.
     * @throws {Error} При ошибке загрузки главы до истечения срока.
     */
    async _loadChapterOrDefer(service, downloadState, chapter) {
        const queue = downloadState.deferred;
        const load = () => this._loadChapter(service, downloadState, chapter);
        if (!queue) return load();

        const running = load();
        for (;;) {
            const outcome = await waitWithDeadline(running, DEFERRED_SETTINGS.deferAfterMs);
            if (outcome.done) return outcome.value;
            if (queue.countChapters() < DEFERRED_SETTINGS.maxDeferredChapters)
                return queue.deferChapter(chapter, this._chapterTitle(chapter), load, running);
            console.log(`[DownloadManager] ${queue.countChapters()} chapters are already loading in background, ` +
                `keep waiting for chapter "${this._chapterTitle(chapter)}"`);
        }
    }

    /**
     * То же, что _loadChapterOrDefer, но при ошибке возвращает главу с текстом
     * ошибки вместо содержимого, не прерывая общую загрузку.
     * @param {object} service - Экземпляр сервиса.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {object} chapter - Метаданные главы.
     * @returns {Promise<object>} Содержимое главы, глава-метка либо глава с текстом ошибки.
     */
    async _downloadChapterOrDefer(service, downloadState, chapter) {
        try {
            return await this._loadChapterOrDefer(service, downloadState, chapter);
        } catch (error) {
            console.error(`[DownloadManager] Failed to download chapter ${chapter.number}:`, error);
            return this._errorChapter(chapter, error);
        }
    }

    /**
     * Загружает и обрабатывает содержимое одной главы (без откладывания в фон).
     * При ошибке возвращает главу с текстом-заглушкой вместо содержимого,
     * не прерывая общую загрузку.
     * @param {object} service - Экземпляр сервиса.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {object} chapter - Метаданные главы (number, volume, branchId, name).
     * @returns {Promise<{title: string, content: Array, volume: *, number: *}>}
     * Готовое содержимое главы для экспортёра.
     */
    async downloadSingleChapter(service, downloadState, chapter) {
        try {
            return await this._loadChapter(service, downloadState, chapter);
        } catch (error) {
            console.error(`[DownloadManager] Failed to download chapter ${chapter.number}:`, error);
            return this._errorChapter(chapter, error);
        }
    }

    /**
     * Возвращает публичный снимок состояния активной загрузки (без служебных
     * полей вроде controller и gate).
     * @param {string} downloadId - id загрузки.
     * @returns {?object} Снимок состояния загрузки, либо null, если загрузка не найдена.
     */
    getDownloadState(downloadId) {
        const state = this.activeDownloads.get(downloadId);
        if (!state) return null;

        return {
            slug: state.slug,
            serviceKey: state.serviceKey,
            format: state.format,
            manga: state.manga,
            coverBase64: state.coverBase64,
            chapterContents: state.chapterContents,
            chapters: state.chapters,
            currentChapterIndex: state.currentChapterIndex,
            currentStatus: state.status,
            currentProgress: state.progress
        };
    }

    /**
     * Загружает содержимое списка глав по порядку с учётом паузы/остановки,
     * не выполняя разбиение на файлы по размеру (используется вызывающей
     * стороной, которая сама управляет сохранением файлов).
     * @param {object} service - Экземпляр сервиса.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {object[]} chapters - Главы для загрузки в этом вызове.
     * @param {?function} onProgress - Не используется напрямую (прогресс идёт через updateStatus);
     * оставлено для совместимости сигнатуры.
     * @param {number} [startIndex=0] - Смещение для расчёта общего прогресса и currentChapterIndex.
     * @param {?number} [totalChapters] - Общее число глав для расчёта процента (по умолчанию chapters.length).
     * @returns {Promise<object[]>} Список загруженного содержимого глав.
     */
    async downloadChapters(service, downloadState, chapters, onProgress, startIndex = 0, totalChapters = null) {
        const results = [];
        const total = totalChapters || chapters.length;

        service._on429 = () => {
            const dl = this.activeDownloads.get(downloadState.id);
            this.updateStatus(downloadState.id, 'Ожидание разрешения от сервера...', dl ? dl.progress : 0);
        };

        try {
            for (let i = 0; i < chapters.length; i++) {
                await downloadState.controller.waitIfPaused();
                if (downloadState.controller.shouldStop()) break;

                downloadState.currentChapterIndex = startIndex + i;

                const chapter = chapters[i];
                const globalIndex = startIndex + i;
                const progress = Math.floor((globalIndex / total) * 80) + 10;

                this.updateStatus(
                    downloadState.id,
                    `Глава ${globalIndex + 1}/${total}: ${chapter.name || chapter.number}`,
                    progress
                );

                const chapterResult = await this._downloadChapterOrDefer(service, downloadState, chapter);
                if (downloadState.gate?.interrupted) break;
                this._trackDeferred(downloadState, chapterResult);
                results.push(chapterResult);
                downloadState.chapterContents.push(chapterResult);
            }
        } finally {
            service._on429 = null;
        }

        await this._waitForDeferred(downloadState, results, { report: true, progress: 90 });
        return results;
    }

    /**
     * Создаёт контроллер паузы/остановки по умолчанию для загрузки, запущенной
     * без собственного controller в опциях.
     * @returns {{pause: function(): void, resume: function(): void, stop: function(): void,
     * isPaused: function(): boolean, shouldStop: function(): boolean,
     * waitIfPaused: function(): Promise<void>}} Контроллер загрузки.
     */
    createController() {
        let paused = false;
        let stopped = false;

        const isPaused = () => paused;
        const shouldStop = () => stopped;

        return {
            pause: () => { paused = true; },
            resume: () => { paused = false; },
            stop: () => { stopped = true; },
            isPaused,
            shouldStop,
            waitIfPaused: async () => {
                while (isPaused() && !shouldStop())
                    await new Promise(resolve => setTimeout(resolve, 100));
            }
        };
    }

    /**
     * Обновляет статус и прогресс активной загрузки и эмитит событие download:progress.
     * @param {string} downloadId - id загрузки.
     * @param {string} message - Текст статуса.
     * @param {number} progress - Процент выполнения (0-100, -1 при ошибке).
     * @returns {void}
     */
    updateStatus(downloadId, message, progress) {
        const download = this.activeDownloads.get(downloadId);
        if (download) {
            download.status = message;
            download.progress = progress;
            this.eventBus.emit('download:progress', download);
        }
    }

    /**
     * Сортирует главы по возрастанию номера тома, а внутри тома — по номеру главы.
     * @param {object[]} chapters - Список глав (сортируется на месте).
     * @returns {object[]} Тот же массив, отсортированный.
     */
    sortChapters(chapters) {
        return chapters.sort((a, b) => {
            const volA = parseInt(a.volume) || 0;
            const volB = parseInt(b.volume) || 0;
            if (volA !== volB) return volA - volB;
            return (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0);
        });
    }

    /**
     * Извлекает slug тайтла из URL страницы манги/книги.
     * @param {string} url - URL страницы тайтла.
     * @returns {?string} Slug тайтла, либо null, если URL не соответствует ожидаемому формату.
     */
    extractSlug(url) {
        const match = url.match(/\/(?:manga|book)\/([^/?]+)/);
        return match ? match[1] : null;
    }

    /**
     * Генерирует уникальный id новой загрузки.
     * @returns {string} Строка вида "download_<timestamp>_<random>".
     */
    generateId() {
        return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Сохраняет готовый файл: через FileUtils.downloadBlob, если доступен,
     * иначе через временную ссылку-скачивание.
     * @param {Blob} blob - Содержимое файла.
     * @param {string} filename - Имя сохраняемого файла.
     * @returns {Promise<void>}
     */
    async saveFile(blob, filename) {
        if (globalThis.FileUtils)
            await globalThis.FileUtils.downloadBlob(blob, filename);
        else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                URL.revokeObjectURL(url);
                a.remove();
            }, 10000);
        }
    }

    /**
     * Ставит активную загрузку на паузу и эмитит событие download:paused.
     * @param {string} downloadId - id загрузки.
     * @returns {void}
     */
    pause(downloadId) {
        const download = this.activeDownloads.get(downloadId);
        if (download) {
            download.controller.pause();
            this.eventBus.emit('download:paused', download);
        } else console.log(`[DownloadManager] No active download with ID: ${downloadId}`);
    }

    /**
     * Снимает загрузку с паузы и эмитит событие download:resumed.
     * @param {string} downloadId - id загрузки.
     * @returns {void}
     */
    resume(downloadId) {
        const download = this.activeDownloads.get(downloadId);
        if (download) {
            download.controller.resume();
            this.eventBus.emit('download:resumed', download);
        } else console.log(`[DownloadManager] No active download with ID: ${downloadId}`);
    }

    /**
     * Останавливает активную загрузку и эмитит событие download:stopped.
     * @param {string} downloadId - id загрузки.
     * @returns {void}
     */
    stop(downloadId) {
        const download = this.activeDownloads.get(downloadId);
        if (download) {
            download.controller.stop();
            this.eventBus.emit('download:stopped', download);
        } else console.log(`[DownloadManager] No active download with ID: ${downloadId}`);
    }

    /**
     * Возвращает полное (в т.ч. служебное) внутреннее состояние загрузки.
     * @param {string} downloadId - id загрузки.
     * @returns {?object} Внутреннее состояние загрузки, либо null, если не найдена.
     */
    getStatus(downloadId) {
        return this.activeDownloads.get(downloadId) || null;
    }
}

/**
 * Загружает изображение страницы с проверкой контрольных точек прерывания
 * загрузки до и после сетевого запроса (позволяет прервать загрузку максимально
 * быстро, не дожидаясь завершения уже начатого запроса изображения).
 * @param {string} url - URL изображения.
 * @param {string} serviceKey - Ключ сервиса (для rate limiting).
 * @returns {Promise<{ok: boolean, base64?: string, contentType?: string, error?: string}>}
 * Результат загрузки изображения.
 */
export async function fetchPageImage(url, serviceKey) {
    const gate = activeGate;
    if (gate) await gate.checkpoint();
    const result = await fetchPageImageUngated(url, serviceKey);
    if (gate) await gate.checkpoint();
    return result;
}

/**
 * Загружает изображение страницы без проверки контрольных точек прерывания:
 * учитывает запрос в общем rate limiter'е и загружает его через вкладку сервиса
 * (fetchViaTab), чтобы браузер сам поставил настоящие Referer/Origin. Если открытой
 * вкладки сервиса нет вообще — бросает NoServiceTabError (а не тихо откатывается на
 * fetch из контекста расширения с подделанными заголовками); если вкладка есть,
 * но сама загрузка не удалась — возвращает ok:false для мягкой постраничной деградации.
 * @param {string} url - URL изображения.
 * @param {string} serviceKey - Ключ сервиса (для rate limiting и выбора вкладки).
 * @returns {Promise<{ok: boolean, base64?: string, contentType?: string, error?: string}>}
 * Результат загрузки изображения.
 * @throws {Error} NoServiceTabError, если не найдено открытой вкладки сервиса.
 */
async function fetchPageImageUngated(url, serviceKey) {
    await globalRateLimiter.trackRequest(serviceKey || 'image');
    if (activeGate) await activeGate.checkpoint();

    const viaTab = await fetchViaTab(url, serviceKey);
    if (viaTab?.ok) return viaTab;

    if (!await hasServiceTab(serviceKey))
        throw new NoServiceTabError('Откройте страницу сервиса в отдельной вкладке, чтобы продолжить загрузку');

    return { ok: false, error: 'Image fetch failed' };
}

export { DEFERRED_SETTINGS as deferredLoadSettings };

console.log('[DownloadManager] Loaded');
