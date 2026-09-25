/**
 * DownloadLib core module
 * Manages manga downloads from various services
 * @module core/DownloadManager
 * @license MIT
 * @author ivanvit
 * @version 1.0.10
 */

'use strict';

(function(global) {
    console.log('[DownloadManager] Loading...');

    let activeGate = null;

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
     * Оркестрирует полный жизненный цикл загрузки тайтла с сервиса или обновления
     * существующего файла: получение метаданных и глав, скачивание содержимого
     * с учётом паузы/остановки, разбиение результата на файлы по лимиту размера
     * и сохранение готовых файлов.
     */
    class DownloadManager {
        /**
         * Создаёт менеджер с пустой картой активных загрузок и собственной шиной событий.
         */
        constructor() {
            this.activeDownloads = new Map();
            this.eventBus = new global.EventBus();
            console.log('[DownloadManager] Instance created');
        }

        /**
         * Создаёт экспортёр указанного формата, при необходимости предварительно
         * догружая плагины (если формат не зарегистрирован стандартными экспортёрами).
         * @param {string} format - Ключ формата экспорта.
         * @returns {Promise<object>} Экземпляр экспортёра.
         */
        async _createExporter(format) {
            if (!global.ExporterRegistry.getSupportedFormats().includes(format.toLowerCase()) &&
                global.PluginManager) {
                console.log(`[DownloadManager] Format "${format}" not registered, loading plugins...`);
                await global.PluginManager.loadAll();
            }
            return global.ExporterRegistry.create(format);
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
                service = global.serviceRegistry.createService(serviceKey);
                if (!service) throw new Error(`Unknown service: ${serviceKey}`);
            } else if (url)
                service = global.serviceRegistry.getServiceByUrl(url);
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
                loadedFile, maxSizeMB = 200, splitPages = true } = options;
            const downloadId = this.generateId();
            return {
                id: downloadId,
                service: service.name,
                serviceKey,
                slug: slug || this.extractSlug(url),
                format,
                maxSizeMB,
                splitPages,
                status: 'initializing',
                progress: 0,
                controller: controller || this.createController(),
                loadedFile,
                manga: null,
                mangaId: null,
                coverBase64: null,
                chapterContents: [],
                chapters: [],
                currentChapterIndex: 0
            };
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
            const api = typeof global.getExtensionApi === 'function' ? global.getExtensionApi() : global.extensionApi;
            if (!api?.runtime?.connect) return null;

            const state = { stopped: false, port: null, interval: null, reconnectTimer: null };

            const connect = () => {
                if (state.stopped) return;
                try {
                    const port = api.runtime.connect({ name: 'downloadKeepAlive' });
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
         * состояние загрузки и keep-alive порт, затем либо обновляет ранее
         * загруженный файл (если передан loadedFile), либо последовательно
         * загружает метаданные, обложку, список глав и содержимое глав с разбиением
         * на файлы по лимиту размера.
         * @param {{url?: string, format?: string, chapterRange?: {from: number, to: number},
         * branchId?: number, maxSizeMB?: number, authToken?: string, loadedFile?: File,
         * serviceKey?: string, slug?: string, controller?: object, splitPages?: boolean}} options
         * Параметры загрузки.
         * @returns {Promise<{success: boolean, downloadId: string}>} Результат загрузки.
         * @throws {Error} При ошибке на любом из этапов загрузки (после эмиссии download:failed).
         */
        async startDownload(options) {
            console.log('[DownloadManager] Starting download with options:', options);
            const { url, format = 'fb2', chapterRange, branchId = null, maxSizeMB = 200,
                authToken = null, loadedFile, serviceKey } = options;

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
                if (loadedFile) return await this.updateExistingFile(downloadState, service, loadedFile);

                this.updateStatus(downloadId, 'Загрузка метаданных...', 5);
                const metadata = await service.fetchMangaMetadata(downloadState.slug);
                console.log('[DownloadManager] Metadata:', metadata);

                const patched = global.MangaPatcher.patch(metadata.data || metadata);
                downloadState.manga = patched;
                downloadState.mangaId = patched.id || null;

                this.updateStatus(downloadId, 'Загружаем обложку...', 7);
                downloadState.coverBase64 = await this._fetchCoverBase64(service, patched.cover);

                this.updateStatus(downloadId, 'Загрузка списка глав...', 10);
                const chapters = await this._fetchAndFilterChapters(service, downloadState, branchId, chapterRange);
                downloadState.chapters = chapters;

                await this.downloadWithSizeLimit(downloadState,
                    service, chapters, patched, downloadState.coverBase64, format, maxSizeMB);

                this.updateStatus(downloadId, 'Готово!', 100);
                this.eventBus.emit('download:completed', downloadState);
                return { success: true, downloadId };
            } catch (error) {
                console.error('[DownloadManager] Error:', error);
                this.updateStatus(downloadId, `Ошибка: ${error.message}`, -1);
                this.eventBus.emit('download:failed', { downloadState, error });
                throw error;
            } finally {
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
         * @returns {Promise<string>} data-URL с обложкой, либо пустая строка при
         * отсутствии URL или ошибке загрузки.
         */
        async _fetchCoverBase64(service, cover) {
            if (!cover || typeof cover !== 'string') return '';
            try {
                const result = await global.fetchViaTab(cover, service.name);
                if (result?.ok) return `data:${result.contentType};base64,${result.base64}`;
                console.warn('[DownloadManager] fetchViaTab returned no result for cover');
                return '';
            } catch (e) {
                console.warn('[DownloadManager] Failed to load cover:', e);
                return '';
            }
        }

        /**
         * Оценивает приблизительный размер содержимого главы в байтах (для решения
         * о необходимости разбиения файла по лимиту размера).
         * @param {?{content: Array}} chapter - Обработанное содержимое главы.
         * @returns {number} Оценочный размер в байтах.
         */
        estimateChapterSize(chapter) {
            if (!chapter || !Array.isArray(chapter.content)) return 0;
            let bytes = 0;
            for (const block of chapter.content) {
                if (block.type === 'text' && block.text)
                    bytes += block.text.length * 2;
                else if (block.type === 'image') {
                    const b64 = (block.data && block.data.base64) ? block.data.base64 : '';
                    if (b64) bytes += Math.ceil(b64.length * 3 / 4);
                }
            }
            return bytes;
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
         * Загружает содержимое всех глав по порядку и сохраняет результат несколькими
         * файлами — новый файл начинается при смене тома или при превышении лимита
         * размера текущего накопленного файла.
         * @param {object} downloadState - Текущее состояние загрузки.
         * @param {object} service - Экземпляр сервиса.
         * @param {object[]} chapters - Список глав для загрузки.
         * @param {object} manga - Нормализованные метаданные тайтла.
         * @param {string} coverBase64 - Обложка тайтла в base64.
         * @param {string} format - Формат экспорта.
         * @param {number} maxSizeMB - Максимальный размер одного файла в мегабайтах.
         * @returns {Promise<void>}
         */
        async downloadWithSizeLimit(downloadState, service, chapters, manga, coverBase64, format, maxSizeMB) {
            const { id: downloadId } = downloadState;
            const maxSizeBytes = maxSizeMB * 1024 * 1024;
            const exporter = await this._createExporter(format);
            let currentBatch = [];
            let currentSize = 0;
            let currentVolume = null;
            let volumePartIndex = 0;

            /**
             * Экспортирует накопленный пакет глав текущего тома в файл и сохраняет
             * его, сбрасывая накопленный пакет и размер.
             * @param {number} progress - Процент прогресса для отображения статуса.
             * @returns {Promise<void>}
             */
            const flushBatch = async (progress) => {
                if (currentBatch.length === 0) return;
                volumePartIndex += 1;
                const suffix = this._buildVolumeSuffix(currentVolume, volumePartIndex);
                this.updateStatus(downloadId, `Сохранение тома ${currentVolume}${volumePartIndex > 1 ? `, часть ${volumePartIndex}` : ''}...`, progress);
                const file = await exporter.export({ ...manga, name: manga.name + suffix }, currentBatch, coverBase64);
                await this.saveFile(file.blob, file.filename);
                currentBatch = [];
                currentSize = 0;
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
                    this.updateStatus(downloadId, `Глава ${i + 1}/${chapters.length}: ${chapter.name || chapter.number}`, progress);

                    const chapterResult = await this.downloadSingleChapter(service, downloadState, chapter);
                    if (downloadState.gate?.interrupted) break;
                    const chapterSize = this.estimateChapterSize(chapterResult);
                    const chapterVolume = this._chapterVolume(chapter);
                    const volumeChanged = currentBatch.length > 0 && chapterVolume !== currentVolume;
                    const sizeExceeded = currentBatch.length > 0 && currentSize + chapterSize > maxSizeBytes;

                    if (volumeChanged || sizeExceeded) {
                        await flushBatch(progress);
                        if (volumeChanged) volumePartIndex = 0;
                    }

                    if (currentBatch.length === 0) currentVolume = chapterVolume;
                    currentBatch.push(chapterResult);
                    currentSize += chapterSize;

                    downloadState.chapterContents.push(chapterResult);
                }
            } finally {
                service._on429 = null;
            }

            await flushBatch(95);
        }

        /**
         * Загружает и обрабатывает содержимое одной главы: получает сырые данные
         * от сервиса, извлекает страницы/текст и прогоняет через обработку контента
         * (сжатие изображений и т.п.). При ошибке возвращает главу с текстом-заглушкой
         * вместо содержимого, не прерывая общую загрузку.
         * @param {object} service - Экземпляр сервиса.
         * @param {object} downloadState - Текущее состояние загрузки.
         * @param {object} chapter - Метаданные главы (number, volume, branchId, name).
         * @returns {Promise<{title: string, content: Array, volume: *, number: *}>}
         * Готовое содержимое главы для экспортёра.
         */
        async downloadSingleChapter(service, downloadState, chapter) {
            try {
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
                            splitLongImages: downloadState.splitPages && downloadState.format !== 'simple'
                        }
                      )
                    : extractedContent;

                return {
                    title: chapter.name || `Том ${chapter.volume}, Глава ${chapter.number}`,
                    content: processedContent,
                    volume: chapter.volume,
                    number: chapter.number
                };
            } catch (error) {
                console.error(`[DownloadManager] Failed to download chapter ${chapter.number}:`, error);
                return {
                    title: chapter.name || `Том ${chapter.volume}, Глава ${chapter.number}`,
                    content: [{ type: 'text', text: `[Ошибка загрузки главы: ${error.message}]` }],
                    volume: chapter.volume,
                    number: chapter.number
                };
            }
        }

        /**
         * Обновляет ранее загруженный файл: сверяет главы на сервере с главами
         * в файле, докачивает недостающие/пустые главы, объединяет результат
         * с существующим содержимым и пересохраняет файл(ы) с учётом лимита размера.
         * @param {object} downloadState - Текущее состояние загрузки.
         * @param {object} service - Экземпляр сервиса.
         * @param {File} loadedFile - Ранее загруженный файл для обновления.
         * @returns {Promise<{success: boolean, downloadId: string, updated: boolean,
         * addedChapters?: number}>} Результат обновления: updated=false, если файл уже
         * содержит все главы.
         * @throws {Error} При ошибке разбора файла или загрузки недостающих глав.
         */
        async updateExistingFile(downloadState, service, loadedFile) {
            const { id: downloadId, slug, format } = downloadState;

            try {
                this.updateStatus(downloadId, 'Загрузка списка глав с сервера...', 5);
                const chaptersData = await service.fetchChaptersList(slug);
                const serverChapters = this.sortChapters(chaptersData.data || []);

                this.updateStatus(downloadId, 'Анализ существующего файла...', 10);
                const exporter = await this._createExporter(format);

                const existingData = exporter.parse ?
                    await exporter.parse(loadedFile) :
                    await this.parseFile(loadedFile, format);

                console.log('[DownloadManager] Existing chapters:', existingData.chapters.length);

                const chaptersToDownload = this.findMissingChapters(
                    serverChapters,
                    existingData.chapters
                );

                console.log('[DownloadManager] Chapters to download:', chaptersToDownload.length);

                if (chaptersToDownload.length === 0) {
                    this.updateStatus(downloadId, 'Файл уже актуален!', 100);
                    this.eventBus.emit('download:completed', downloadState);
                    return { success: true, downloadId, updated: false };
                }

                downloadState.chapters = serverChapters;
                downloadState.manga = existingData.metadata;
                downloadState.coverBase64 = existingData.cover;

                const newChapterContents = await this.downloadSpecificChapters(
                    service,
                    downloadState,
                    chaptersToDownload,
                    serverChapters.length
                );

                this.updateStatus(downloadId, 'Объединение глав...', 90);
                const mergedChapters = this.mergeChapters(
                    existingData.chapters,
                    newChapterContents,
                    serverChapters
                );

                const patch = global.MangaPatcher.patch(existingData.metadata);
                const maxSizeBytes = (downloadState.maxSizeMB || 200) * 1024 * 1024;
                let currentBatch = [];
                let currentSize = 0;
                let currentVolume = null;
                let volumePartIndex = 0;

                /**
                 * Экспортирует накопленный пакет объединённых глав текущего тома
                 * в обновлённый файл и сохраняет его, сбрасывая накопленный пакет и размер.
                 * @param {number} progress - Процент прогресса для отображения статуса.
                 * @returns {Promise<void>}
                 */
                const flushMergedBatch = async (progress) => {
                    if (currentBatch.length === 0) return;
                    volumePartIndex += 1;
                    const suffix = this._buildVolumeSuffix(currentVolume, volumePartIndex);
                    this.updateStatus(downloadId, `Создание обновлённого ${format.toUpperCase()} - том ${currentVolume}${volumePartIndex > 1 ? `, часть ${volumePartIndex}` : ''}...`, progress);
                    const file = await exporter.export(
                        { ...patch, name: patch.name + suffix }, currentBatch, existingData.cover
                    );
                    await this.saveFile(file.blob, file.filename);
                    currentBatch = [];
                    currentSize = 0;
                };

                for (const chapter of mergedChapters) {
                    const chapterSize = this.estimateChapterSize(chapter);
                    const chapterVolume = this._chapterVolume(chapter);
                    const volumeChanged = currentBatch.length > 0 && chapterVolume !== currentVolume;
                    const sizeExceeded = currentBatch.length > 0 && currentSize + chapterSize > maxSizeBytes;

                    if (volumeChanged || sizeExceeded) {
                        await flushMergedBatch(93);
                        if (volumeChanged) volumePartIndex = 0;
                    }

                    if (currentBatch.length === 0) currentVolume = chapterVolume;
                    currentBatch.push(chapter);
                    currentSize += chapterSize;
                }

                await flushMergedBatch(95);

                this.updateStatus(downloadId, 'Файл обновлён!', 100);
                this.eventBus.emit('download:completed', downloadState);

                return {
                    success: true,
                    downloadId,
                    updated: true,
                    addedChapters: chaptersToDownload.length
                };
            } catch (error) {
                console.error('[DownloadManager] Update error:', error);
                this.updateStatus(downloadId, `Ошибка обновления: ${error.message}`, -1);
                this.eventBus.emit('download:failed', { downloadState, error });
                throw error;
            }
        }

        /**
         * Разбирает ранее скачанный файл в унифицированную структуру (метаданные,
         * обложка, главы), используя парсер соответствующего формата.
         * @param {File} file - Файл для разбора.
         * @param {string} format - Формат файла ('fb2', 'epub', 'mobi', 'simple').
         * @returns {Promise<{metadata: object, cover: string, chapters: object[]}>}
         * Разобранное содержимое файла.
         * @throws {Error} Если формат не поддерживается для парсинга (в т.ч. 'pdf').
         */
        async parseFile(file, format) {
            if (format === 'fb2') {
                const text = await this.readFileAsText(file);
                const exporter = global.ExporterRegistry.create('fb2');
                return exporter.parseFB2(text, file.name);
            } else if (format === 'epub') {
                const exporter = global.ExporterRegistry.create('epub');
                return await exporter.parseEPUB(file);
            } else if (format === 'mobi') {
                const exporter = global.ExporterRegistry.create('mobi');
                return await exporter.parse(file);
            } else if (format === 'simple') {
                const exporter = global.ExporterRegistry.create('simple');
                return await exporter.parse(file);
            } else if (format === 'pdf')
                throw new Error('PDF парсинг пока не реализован');

            throw new Error(`Unsupported format: ${format}`);
        }

        /**
         * Читает содержимое файла как текст в кодировке UTF-8.
         * @param {File} file - Читаемый файл.
         * @returns {Promise<string>} Текстовое содержимое файла.
         */
        readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsText(file, 'utf-8');
            });
        }

        /**
         * Находит главы, отсутствующие в ранее загруженном файле (или пустые из-за
         * прошлой ошибки загрузки), начиная с первой главы, совпадающей с содержимым
         * файла (главы до этой точки, добавленные позже на сервере задним числом,
         * не считаются пропущенными).
         * @param {object[]} serverChapters - Актуальный список глав с сервера.
         * @param {object[]} existingChapters - Главы, уже присутствующие в файле.
         * @returns {object[]} Список глав с сервера, которые нужно докачать.
         */
        findMissingChapters(serverChapters, existingChapters) {
            if (existingChapters.length === 0) return [];

            const existingKeys = new Set();
            for (const ch of existingChapters)
                existingKeys.add(this.getChapterKey(ch));

            let startIndex = -1;
            for (let i = 0; i < serverChapters.length; i++) {
                if (existingKeys.has(this.getChapterKey(serverChapters[i]))) {
                    startIndex = i;
                    break;
                }
            }

            if (startIndex === -1) return [];

            const missing = [];
            for (let i = startIndex; i < serverChapters.length; i++) {
                const serverCh = serverChapters[i];
                const key = this.getChapterKey(serverCh);

                if (!existingKeys.has(key))
                    missing.push(serverCh);
                else {
                    const existingCh = existingChapters.find(ch => this.getChapterKey(ch) === key);
                    if (existingCh && this.isChapterEmpty(existingCh)) missing.push(serverCh);
                }
            }

            return missing;
        }

        /**
         * Строит уникальный ключ главы по номеру тома и главы, используемый для
         * сопоставления глав с сервера и глав в загруженном файле.
         * @param {{volume?: *, number?: *}} chapter - Глава.
         * @returns {string} Ключ вида "v{том}_ch{номер}".
         */
        getChapterKey(chapter) {
            const vol = chapter.volume || '1';
            const num = chapter.number || '0';
            return `v${vol}_ch${num}`;
        }

        /**
         * Проверяет, пуста ли глава (нет содержимого, либо всё содержимое —
         * прошлая ошибка загрузки).
         * @param {{content?: Array}} chapter - Глава из существующего файла.
         * @returns {boolean} true, если глава не содержит полезного контента.
         */
        isChapterEmpty(chapter) {
            if (!chapter.content || !Array.isArray(chapter.content)) return true;

            const hasContent = chapter.content.some(block => {
                if (block.type === 'text') {
                    const text = block.text || '';
                    return text.trim() && !text.includes('[Ошибка загрузки главы');
                } else if (block.type === 'image')
                    return block.data && (block.data.base64 || block.data.src);
                return false;
            });

            return !hasContent;
        }

        /**
         * Докачивает заданный список конкретных глав (используется при обновлении
         * существующего файла), обрабатывая ошибки отдельных глав без прерывания
         * общего процесса.
         * @param {object} service - Экземпляр сервиса.
         * @param {object} downloadState - Текущее состояние загрузки.
         * @param {object[]} chaptersToDownload - Список глав, которые нужно докачать.
         * @returns {Promise<object[]>} Список загруженных (или с текстом ошибки) глав,
         * в том же порядке, что и chaptersToDownload.
         */
        async downloadSpecificChapters(service, downloadState, chaptersToDownload) {
            const results = [];
            const total = chaptersToDownload.length;

            for (let i = 0; i < total; i++) {
                await downloadState.controller.waitIfPaused();
                if (downloadState.controller.shouldStop()) break;

                const chapter = chaptersToDownload[i];
                const progress = Math.floor(((i / total) * 80) + 10);

                this.updateStatus(
                    downloadState.id,
                    `Загрузка главы ${i + 1}/${total}: ${chapter.name || chapter.number}`,
                    progress
                );

                try {
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
                                splitLongImages: downloadState.splitPages && downloadState.format !== 'simple'
                            }
                          )
                        : extractedContent;

                    const chapterResult = {
                        title: chapter.name || `Том ${chapter.volume}, Глава ${chapter.number}`,
                        content: processedContent,
                        volume: chapter.volume,
                        number: chapter.number
                    };

                    if (downloadState.gate?.interrupted) break;
                    results.push(chapterResult);
                } catch (error) {
                    if (error?.aborted || downloadState.gate?.interrupted) break;
                    console.error(`[DownloadManager] Failed to download chapter ${chapter.number}:`, error);
                    const errorChapter = {
                        title: chapter.name || `Том ${chapter.volume}, Глава ${chapter.number}`,
                        content: [{
                            type: 'text',
                            text: `[Ошибка загрузки главы: ${error.message}]`
                        }],
                        volume: chapter.volume,
                        number: chapter.number
                    };

                    results.push(errorChapter);
                }
            }

            return results;
        }

        /**
         * Объединяет главы из существующего файла с вновь докачанными главами
         * в порядке актуального списка глав на сервере, подставляя заглушку
         * для глав, которых нет ни там, ни там.
         * @param {object[]} existingChapters - Главы из ранее загруженного файла.
         * @param {object[]} newChapters - Вновь докачанные главы.
         * @param {object[]} serverChapters - Актуальный список глав с сервера (задаёт порядок).
         * @returns {object[]} Итоговый список глав для пересборки файла.
         */
        mergeChapters(existingChapters, newChapters, serverChapters) {
            const newChaptersMap = new Map();
            for (const ch of newChapters) {
                const key = this.getChapterKey(ch);
                newChaptersMap.set(key, ch);
            }

            const existingMap = new Map();
            for (const ch of existingChapters) {
                const key = this.getChapterKey(ch);
                existingMap.set(key, ch);
            }

            const result = [];

            for (const serverCh of serverChapters) {
                const key = this.getChapterKey(serverCh);

                if (newChaptersMap.has(key))
                    result.push(newChaptersMap.get(key));
                else if (existingMap.has(key))
                    result.push(existingMap.get(key));
                else {
                    result.push({
                        title: serverCh.name || `Том ${serverCh.volume}, Глава ${serverCh.number}`,
                        content: [{
                            type: 'text',
                            text: '[Глава не загружена]'
                        }],
                        volume: serverCh.volume,
                        number: serverCh.number
                    });
                }
            }

            return result;
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
                currentProgress: state.progress,
                loadedFile: state.loadedFile
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

                    const chapterResult = await this.downloadSingleChapter(service, downloadState, chapter);
                    if (downloadState.gate?.interrupted) break;
                    results.push(chapterResult);
                    downloadState.chapterContents.push(chapterResult);
                }
            } finally {
                service._on429 = null;
            }

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
            if (global.FileUtils)
                await global.FileUtils.downloadBlob(blob, filename);
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
    async function fetchPageImage(url, serviceKey) {
        const gate = activeGate;
        if (gate) await gate.checkpoint();
        const result = await fetchPageImageUngated(url, serviceKey);
        if (gate) await gate.checkpoint();
        return result;
    }

    /**
     * Загружает изображение страницы без проверки контрольных точек прерывания:
     * учитывает запрос в общем rate limiter'е, пробует загрузить напрямую через
     * вкладку сервиса (fetchViaTab), а при неудаче — просит background-скрипт
     * выполнить fetch, с повторными попытками при временной "заснувшей" background-странице.
     * @param {string} url - URL изображения.
     * @param {string} serviceKey - Ключ сервиса (для rate limiting и выбора вкладки).
     * @returns {Promise<{ok: boolean, base64?: string, contentType?: string, error?: string}>}
     * Результат загрузки изображения.
     */
    async function fetchPageImageUngated(url, serviceKey) {
        if (global.globalRateLimiter) await global.globalRateLimiter.trackRequest(serviceKey || 'image');
        if (activeGate) await activeGate.checkpoint();

        if (typeof global.fetchViaTab === 'function') {
            const viaTab = await global.fetchViaTab(url, serviceKey);
            if (viaTab?.ok) return viaTab;
        }

        const api = typeof global.getExtensionApi === 'function' ? global.getExtensionApi() : global.extensionApi;
        if (!api?.runtime?.sendMessage) return { ok: false, error: 'runtime.sendMessage not available' };

        const send = () => api.runtime.sendMessage({ action: 'fetchImage', url, serviceKey });
        const RETRY_DELAYS = [300, 800, 2000];
        let lastError;
        for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
            try {
                return await send();
            } catch (e) {
                lastError = e;
                if (!/Receiving end does not exist/i.test(e?.message || ''))
                    return { ok: false, error: String(e) };
                if (attempt < RETRY_DELAYS.length) {
                    console.warn('[DownloadManager] Background page was asleep, retrying fetchImage for', url);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
                }
            }
        }
        return { ok: false, error: String(lastError) };
    }

    global.DownloadManager = DownloadManager;
    global.fetchPageImage = fetchPageImage;
    console.log('[DownloadManager] Loaded');
})(typeof window !== 'undefined' ? window : self);
