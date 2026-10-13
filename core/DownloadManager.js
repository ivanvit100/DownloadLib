/**
 * DownloadLib core module
 * Manages manga downloads from various services
 * @module core/DownloadManager
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from './BrowserApi.js';
import { chapterKey, filterByBranch, selectRange } from './chapters.js';
import { DEFERRED_SETTINGS, estimateContentSize, waitWithDeadline } from './DeferredQueue.js';
import { createController, DownloadContext } from './DownloadContext.js';
import { EventBus } from './EventBus.js';
import { ImageCompressor } from './ImageCompressor.js';
import { MangaPatcher } from './MangaPatcher.js';
import { PORT_KEEP_ALIVE } from './messages.js';
import { PluginManager } from './PluginManager.js';
import { sanitizeFilename } from './text.js';
import { ExporterRegistry } from '../exporters/ExporterRegistry.js';
import { extractSlug } from '../services/hosts.js';
import { serviceRegistry } from '../services/ServiceRegistry.js';

console.log('[DownloadManager] Loading...');

/**
 * Габариты, в которые вписываются изображения FB2 при включённой настройке.
 * Okular вёрстает FB2 на страницы 600×800 с полями 20px и режет картинки,
 * не помещающиеся по высоте; запас по высоте — на отступы абзаца и строки.
 */
const FB2_IMAGE_FIT = { maxWidth: 560, maxHeight: 740 };

/** Наибольшая длина имени сохраняемого файла вместе с расширением. */
const MAX_FILENAME_LENGTH = 200;

/**
 * Через сколько освободить blob-URL сохранённого файла, если браузер так и не
 * сообщил о завершении загрузки.
 */
const REVOKE_FALLBACK_MS = 10 * 60 * 1000;

/**
 * Очищает имя сохраняемого файла: убирает недопустимые символы, а также пробелы
 * и точки по краям и ограничивает длину, сохраняя расширение.
 * @param {?string} name - Имя файла от экспортёра.
 * @returns {string} Безопасное имя файла.
 */
export function safeFilename(name) {
    const raw = String(name ?? '').trim();
    const extension = /\.[a-z0-9]{1,8}$/i.exec(raw)?.[0] || '';
    const base = sanitizeFilename(raw.slice(0, raw.length - extension.length), MAX_FILENAME_LENGTH - extension.length)
        .replace(/^[\s.]+|[\s.]+$/g, '');
    return (base || 'download') + extension;
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
     * Создаёт собственный экземпляр сервиса загрузки (по ключу или по URL тайтла)
     * и, при наличии токена, подставляет его в заголовки этого экземпляра.
     * @param {?string} serviceKey - Ключ сервиса (приоритетнее url).
     * @param {?string} url - URL тайтла, используется, если serviceKey не передан.
     * @param {?string} authToken - Токен авторизации.
     * @returns {object} Новый экземпляр сервиса.
     */
    _resolveService(serviceKey, url, authToken) {
        if (!serviceKey && !url) throw new Error('Either serviceKey or url must be provided');
        const key = serviceKey || serviceRegistry.findServiceKey(url);
        if (!key) throw new Error('Unsupported service');

        const service = serviceRegistry.createService(key);
        if (!service) throw new Error(`Unknown service: ${key}`);
        if (authToken) service.setAuthToken(authToken);
        return service;
    }

    /**
     * Строит начальное состояние новой загрузки на основе переданных опций.
     * @param {object} options - Опции запуска загрузки (см. startDownload).
     * @param {object} service - Разрешённый экземпляр сервиса.
     * @returns {object} Начальное состояние загрузки, регистрируемое в activeDownloads.
     */
    _createDownloadState(options, service) {
        const { url, format = 'fb2', slug, serviceKey, controller = this.createController(),
            maxSizeMB = 200, splitPages = true, fitFb2Images = false } = options;
        const downloadId = this.generateId();
        const imageFit = fitFb2Images && format === 'fb2' ? FB2_IMAGE_FIT : null;
        const state = {
            id: downloadId,
            service: service.name,
            serviceKey,
            slug: slug || extractSlug(url),
            format,
            maxSizeMB,
            splitPages,
            imageFit,
            status: 'initializing',
            progress: 0,
            controller,
            manga: null,
            mangaId: null,
            coverBase64: null,
            chapters: [],
            currentChapterIndex: 0
        };
        state.ctx = new DownloadContext({
            controller,
            settings: { splitPages, imageFit, format },
            onPageProgress: (done, total) => this.eventBus.emit('download:pages', { id: downloadId, done, total }),
            on429: () => this.updateStatus(downloadId, 'Ожидание разрешения от сервера...', state.progress)
        });
        state.deferred = state.ctx.deferred;
        return state;
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
     * ничего сам и не опрашивая очередь по таймеру. Если загрузку остановили,
     * отменяет фоновые загрузки, оставляя на их местах текст ошибки, чтобы уже
     * загруженное можно было сохранить.
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
        const showRemaining = () => {
            const count = queue.countFor(chapters);
            if (count === 0 || count === reported) return;
            reported = count;
            this.updateStatus(downloadState.id, `Дозагрузка в фоне: осталось ${count}...`, progress);
        };
        const unsubscribe = report ? queue.onChange(showRemaining) : null;
        if (report) showRemaining();

        try {
            const stopped = await Promise.race([
                queue.whenSettled(chapters).then(() => false),
                downloadState.ctx.whenStopped().then(() => true)
            ]);
            if (stopped) queue.cancelAll('download stopped');
        } finally {
            unsubscribe?.();
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
     * Приводит id ветки перевода к числу: пустое значение — без ветки,
     * нечисловое — без ветки с предупреждением.
     * @param {*} branchId - id ветки перевода из опций загрузки.
     * @returns {?number} id ветки, либо null.
     */
    _normalizeBranchId(branchId) {
        if (branchId == null || branchId === '') return null;
        const id = Number(branchId);
        if (Number.isNaN(id)) {
            console.warn(`[DownloadManager] Invalid branch id "${branchId}", downloading without translator filter`);
            return null;
        }
        return id;
    }

    /**
     * Выбирает главы для загрузки: главы ветки перевода в выбранном диапазоне.
     * @param {object[]} chapters - Все главы тайтла в порядке чтения.
     * @param {?number} branchId - id ветки перевода, либо null.
     * @param {?{fromKey: string, toKey: string}} chapterRange - Ключи первой и последней
     * главы диапазона, либо null — все главы.
     * @returns {object[]} Главы для загрузки.
     * @throws {Error} Если глава диапазона не найдена, начало позже конца или глав нет.
     */
    _selectChapters(chapters, branchId, chapterRange) {
        const selected = selectRange(filterByBranch(chapters, branchId), chapterRange);
        const branch = branchId != null ? ` (branch ${branchId})` : '';
        console.log(`[DownloadManager] Chapters selected: ${selected.length} of ${chapters.length}${branch}`);
        if (selected.length === 0) throw new Error('Нет глав для загрузки');
        return selected;
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
                const port = extensionApi.runtime.connect({ name: PORT_KEEP_ALIVE });
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
     * метаданные, обложку, список глав (если он не передан) и содержимое глав
     * с разбиением на файлы по лимиту размера.
     * @param {{url?: string, format?: string, chapters?: object[],
     * chapterRange?: {fromKey: string, toKey: string}, branchId?: number,
     * maxSizeMB?: number, authToken?: string, serviceKey?: string, slug?: string,
     * controller?: object, splitPages?: boolean, fitFb2Images?: boolean}} options
     * Параметры загрузки. chapters — уже загруженный список глав тайтла
     * (service.fetchChapters); без него (или если он пуст) список запрашивается заново.
     * chapterRange — ключи первой и последней главы (chapterKey).
     * @returns {Promise<{success: boolean, downloadId: string}>} Результат загрузки.
     * @throws {Error} При ошибке на любом из этапов загрузки (после эмиссии download:failed).
     */
    async startDownload(options) {
        console.log('[DownloadManager] Starting download with options:',
            { ...options, chapters: options.chapters?.length });
        const { url, format = 'fb2', chapters: knownChapters = null, chapterRange = null,
            maxSizeMB = 200, authToken = null, serviceKey } = options;
        const branchId = this._normalizeBranchId(options.branchId);

        const service = this._resolveService(serviceKey, url, authToken);
        console.log('[DownloadManager] Using service:', service.name);

        const downloadState = this._createDownloadState(options, service);
        const { id: downloadId } = downloadState;

        this.activeDownloads.set(downloadId, downloadState);
        this.eventBus.emit('download:started', downloadState);

        const keepAlive = this._startKeepAlive();
        const { ctx } = downloadState;
        service.attach(ctx);
        ctx.activate();

        try {
            this.updateStatus(downloadId, 'Загрузка метаданных...', 5);
            const metadata = await service.getManga(downloadState.slug);
            console.log('[DownloadManager] Metadata:', metadata);

            const patched = MangaPatcher.patch(metadata);
            downloadState.manga = patched;
            downloadState.mangaId = patched.id || null;

            this.updateStatus(downloadId, 'Загружаем обложку...', 7);
            const coverPromise = this._fetchCoverBase64(service, patched.cover, downloadState.imageFit)
                .then(cover => {
                    downloadState.coverBase64 = cover;
                    return cover;
                });

            this.updateStatus(downloadId, 'Загрузка списка глав...', 10);
            const allChapters = Array.isArray(knownChapters) && knownChapters.length > 0
                ? knownChapters
                : await service.fetchChapters(downloadState.slug);
            const chapters = this._selectChapters(allChapters, branchId, chapterRange);
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
            ctx.dispose();
            if (service.ctx === ctx) service.attach(null);
            this._stopKeepAlive(keepAlive);
            setTimeout(() => this.activeDownloads.delete(downloadId), 5000);
        }
    }

    /**
     * Загружает обложку тайтла через сервис (service.fetchImage) и кодирует её
     * в data-URL с base64-содержимым.
     * @param {object} service - Экземпляр сервиса.
     * @param {?string} cover - URL обложки.
     * @param {?{maxWidth: number, maxHeight: number}} [imageFit] - Габариты, в которые
     * вписывается обложка; без них обложка сохраняется как есть.
     * @returns {Promise<string>} data-URL с обложкой, либо пустая строка при
     * отсутствии URL или ошибке загрузки.
     */
    async _fetchCoverBase64(service, cover, imageFit = null) {
        if (!cover || typeof cover !== 'string') return '';
        try {
            const result = await service.fetchImage(cover);
            if (result.ok) {
                const { base64, contentType } = imageFit
                    ? await ImageCompressor.compress(result.base64, result.contentType, imageFit)
                    : result;
                return `data:${contentType};base64,${base64}`;
            }
            console.warn('[DownloadManager] Failed to load cover:', result.error);
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
     * Освобождает содержимое сохранённого пакета глав, чтобы изображения уже
     * сохранённых файлов не держались в памяти до конца загрузки.
     * @param {object[]} batch - Пакет глав.
     * @returns {void}
     */
    _releaseBatch(batch) {
        batch.forEach(chapter => { chapter.content = null; });
        batch.length = 0;
    }

    /**
     * Создаёт последовательную очередь сохранения пакетов глав. Сохранение пакета
     * ждёт фоновые загрузки его глав (и обложку), но не задерживает загрузку
     * следующих глав; файлы сохраняются строго в порядке постановки в очередь.
     * После сохранения содержимое глав пакета освобождается.
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
                DEFERRED_SETTINGS.backgroundAttemptTimeoutMs, this._heldBack(downloadState));
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
                    this._releaseBatch(batch);
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

        for (let i = 0; i < chapters.length; i++) {
            await downloadState.controller.waitIfPaused();
            if (downloadState.controller.shouldStop()) break;

            downloadState.currentChapterIndex = i;
            const chapter = chapters[i];
            const progress = Math.floor((i / chapters.length) * 80) + 10;
            this.updateStatus(downloadId, this._withPendingInfo(downloadState,
                `Глава ${i + 1}/${chapters.length}: ${chapter.name || chapter.number}`), progress);

            const chapterResult = await this._downloadChapterOrDefer(service, downloadState, chapter);
            if (downloadState.ctx?.interrupted) break;
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
        }

        if (downloadState.controller.shouldStop() || downloadState.ctx?.interrupted)
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
     * @returns {{title: string, content: Array, volume: *, number: *, key: string}}
     */
    _errorChapter(chapter, error) {
        return {
            title: this._chapterTitle(chapter),
            content: [{ type: 'text', text: `[Ошибка загрузки главы: ${error.message}]` }],
            volume: chapter.volume,
            number: chapter.number,
            key: chapterKey(chapter)
        };
    }

    /**
     * Загружает и обрабатывает содержимое одной главы через сервис
     * (service.fetchChapterBlocks).
     * @param {object} service - Экземпляр сервиса.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @param {object} chapter - Метаданные главы (number, volume, branchId, name).
     * @returns {Promise<{title: string, content: Array, volume: *, number: *, key: string}>}
     * Готовое содержимое главы для экспортёра.
     * @throws {Error} При ошибке загрузки главы.
     */
    async _loadChapter(service, downloadState, chapter) {
        const content = await service.fetchChapterBlocks(chapter, {
            slug: downloadState.slug,
            mangaId: downloadState.mangaId,
            splitLongImages: downloadState.splitPages && downloadState.format !== 'simple',
            imageFit: downloadState.imageFit
        });
        return {
            title: this._chapterTitle(chapter),
            content,
            volume: chapter.volume,
            number: chapter.number,
            key: chapterKey(chapter)
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
            const outcome = await waitWithDeadline(
                running, DEFERRED_SETTINGS.deferAfterMs, this._heldBack(downloadState));
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
     * Создаёт контроллер паузы/остановки по умолчанию для загрузки, запущенной
     * без собственного controller в опциях (см. DownloadContext.createController).
     * @returns {{pause: function(): void, resume: function(): void, stop: function(): void,
     * isPaused: function(): boolean, shouldStop: function(): boolean,
     * waitIfPaused: function(): Promise<void>, whenStopped: function(): Promise<void>}}
     * Контроллер загрузки.
     */
    createController() {
        return createController();
    }

    /**
     * Возвращает проверку «загрузка придержана» (пауза, очередь ограничителя) для
     * сроков отложенной загрузки.
     * @param {object} downloadState - Текущее состояние загрузки.
     * @returns {function(): boolean}
     */
    _heldBack(downloadState) {
        return () => !!downloadState.ctx?.isHeldBack();
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
     * Генерирует уникальный id новой загрузки.
     * @returns {string} Строка вида "download_<timestamp>_<random>".
     */
    generateId() {
        return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Сохраняет готовый файл через downloads API браузера. Имя файла очищается
     * (с сохранением расширения), при совпадении имён браузер добавляет номер.
     * Временный blob-URL освобождается, когда браузер сообщит о завершении
     * или прерывании загрузки, но не позже чем через REVOKE_FALLBACK_MS.
     * @param {Blob} blob - Содержимое файла.
     * @param {string} filename - Имя сохраняемого файла.
     * @returns {Promise<void>}
     * @throws {Error} Если downloads API недоступен или браузер отклонил загрузку.
     */
    async saveFile(blob, filename) {
        const downloads = extensionApi?.downloads;
        if (!downloads?.download)
            throw new Error('Сохранение файла недоступно: у расширения нет доступа к загрузкам браузера');

        const url = URL.createObjectURL(blob);
        const release = this._revokeWhenDone(downloads, url);
        try {
            const id = await downloads.download({ url, filename: safeFilename(filename), conflictAction: 'uniquify' });
            release.track(id);
        } catch (error) {
            release.now();
            throw error;
        }
    }

    /**
     * Готовит освобождение blob-URL сохраняемого файла: по событию downloads.onChanged
     * о завершении или прерывании загрузки с известным id, либо по запасному таймауту.
     * @param {object} downloads - downloads API браузера.
     * @param {string} url - blob-URL файла.
     * @returns {{track: function(number): void, now: function(): void}} track(id) — начать
     * следить за загрузкой с этим id; now() — освободить сразу.
     */
    _revokeWhenDone(downloads, url) {
        const watch = { downloadId: null, released: false, timer: null, onChanged: null };
        const release = () => {
            if (watch.released) return;
            watch.released = true;
            clearTimeout(watch.timer);
            downloads.onChanged?.removeListener?.(watch.onChanged);
            URL.revokeObjectURL(url);
        };

        watch.onChanged = delta => {
            if (watch.downloadId == null || delta?.id !== watch.downloadId) return;
            const state = delta.state?.current;
            if (state === 'complete' || state === 'interrupted') release();
        };
        watch.timer = setTimeout(release, REVOKE_FALLBACK_MS);
        downloads.onChanged?.addListener?.(watch.onChanged);

        return {
            track: id => { watch.downloadId = id; },
            now: release
        };
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
}

console.log('[DownloadManager] Loaded');
