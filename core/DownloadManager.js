/**
 * DownloadLib core module
 * Manages manga downloads from various services
 * @module core/DownloadManager
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from './BrowserApi.js';
import { DEFERRED_SETTINGS, estimateContentSize, waitWithDeadline } from './DeferredQueue.js';
import { createController, DownloadContext } from './DownloadContext.js';
import { EventBus } from './EventBus.js';
import { ImageCompressor } from './ImageCompressor.js';
import { MangaPatcher } from './MangaPatcher.js';
import { PORT_KEEP_ALIVE } from './messages.js';
import { PluginManager } from './PluginManager.js';
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
            chapterContents: [],
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
        let chapters = this.sortChapters(await service.getChapterList(downloadState.slug));

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
            ctx.deactivate();
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

            downloadState.chapterContents.push(chapterResult);
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
        const rawContent = await service.getChapter(
            downloadState.slug, chapter.number, chapter.volume || '1', chapter.branchId ?? null);
        const contentToExtract = rawContent.content || rawContent;

        const extractedContent = service.extractText
            ? service.extractText(contentToExtract)
            : contentToExtract;

        const processedContent = service.processChapterContent
            ? await service.processChapterContent(
                extractedContent,
                null,
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
     * полей вроде controller и ctx).
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
            if (downloadState.ctx?.interrupted) break;
            this._trackDeferred(downloadState, chapterResult);
            results.push(chapterResult);
            downloadState.chapterContents.push(chapterResult);
        }

        await this._waitForDeferred(downloadState, results, { report: true, progress: 90 });
        return results;
    }

    /**
     * Создаёт контроллер паузы/остановки по умолчанию для загрузки, запущенной
     * без собственного controller в опциях (см. DownloadContext.createController).
     * @returns {{pause: function(): void, resume: function(): void, stop: function(): void,
     * isPaused: function(): boolean, shouldStop: function(): boolean,
     * waitIfPaused: function(): Promise<void>}} Контроллер загрузки.
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

console.log('[DownloadManager] Loaded');
