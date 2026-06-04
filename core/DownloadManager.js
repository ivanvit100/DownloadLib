/**
 * DownloadLib core module
 * Manages manga downloads from various services
 * @module core/DownloadManager
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[DownloadManager] Loading...');

    class DownloadManager {
        constructor() {
            this.activeDownloads = new Map();
            this.eventBus = new global.EventBus();
            console.log('[DownloadManager] Instance created');
        }

        async startDownload(options) {
            console.log('[DownloadManager] Starting download with options:', options);
            const {
                url,
                format = 'fb2',
                slug,
                serviceKey,
                controller,
                loadedFile,
                chapterRange,
                branchId = null,
                maxSizeMB = 200
            } = options;

            let service;
            if (serviceKey) {
                service = global.serviceRegistry.createService(serviceKey);
                if (!service) throw new Error(`Unknown service: ${serviceKey}`);
            } else if (url)
                service = global.serviceRegistry.getServiceByUrl(url);
            else
                throw new Error('Either serviceKey or url must be provided');

            if (!service) throw new Error('Unsupported service');

            console.log('[DownloadManager] Using service:', service.name);

            const downloadId = this.generateId();
            const downloadState = {
                id: downloadId,
                service: service.name,
                serviceKey: serviceKey,
                slug: slug || this.extractSlug(url),
                format,
                maxSizeMB,
                status: 'initializing',
                progress: 0,
                controller: controller || this.createController(),
                loadedFile: loadedFile,
                manga: null,
                mangaId: null,
                coverBase64: null,
                chapterContents: [],
                chapters: [],
                currentChapterIndex: 0
            };

            this.activeDownloads.set(downloadId, downloadState);
            this.eventBus.emit('download:started', downloadState);

            try {
                if (loadedFile) return await this.updateExistingFile(downloadState, service, loadedFile);

                this.updateStatus(downloadId, 'Загрузка метаданных...', 5);
                const metadata = await service.fetchMangaMetadata(downloadState.slug);
                console.log('[DownloadManager] Metadata:', metadata);

                const manga = metadata.data || metadata;
                const patched = global.MangaPatcher.patch(manga);
                downloadState.manga = patched;
                downloadState.mangaId = patched.id || null;

                this.updateStatus(downloadId, 'Загружаем обложку...', 7);
                downloadState.coverBase64 = await this._fetchCoverBase64(service, patched.cover);

                this.updateStatus(downloadId, 'Загрузка списка глав...', 10);
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
                setTimeout(() => this.activeDownloads.delete(downloadId), 5000);
            }
        }

        async _fetchCoverBase64(service, cover) {
            if (!cover || typeof cover !== 'string') return '';
            try {
                const coverHeaders = (service.config && service.config.imageHeaders) || {};
                const response = await fetch(cover, { headers: coverHeaders });
                if (!response.ok) {
                    console.error('[DownloadManager] Failed to fetch cover image:', response.status);
                    return '';
                }
                const blob = await response.blob();
                const reader = new FileReader();
                return await new Promise((resolve, reject) => {
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } catch (e) {
                console.warn('[DownloadManager] Failed to load cover:', e);
                return '';
            }
        }

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

        async downloadWithSizeLimit(downloadState, service, chapters, manga, coverBase64, format, maxSizeMB) {
            const { id: downloadId } = downloadState;
            const maxSizeBytes = maxSizeMB * 1024 * 1024;
            let partIndex = 0;
            let currentBatch = [];
            let currentSize = 0;

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
                    const chapterSize = this.estimateChapterSize(chapterResult);

                    if (currentBatch.length > 0 && currentSize + chapterSize > maxSizeBytes) {
                        partIndex += 1;
                        const exporter = global.ExporterRegistry.create(format);
                        const partSuffix = ` (Часть ${partIndex})`;
                        this.updateStatus(downloadId, `Сохранение части ${partIndex}...`, progress);
                        const file = await exporter.export({ ...manga, name: manga.name + partSuffix },
                            currentBatch, coverBase64);
                        await this.saveFile(file.blob, file.filename);

                        currentBatch = [chapterResult];
                        currentSize = chapterSize;
                    } else {
                        currentBatch.push(chapterResult);
                        currentSize += chapterSize;
                    }

                    downloadState.chapterContents.push(chapterResult);
                    await this.delay(500);
                }
            } finally {
                service._on429 = null;
            }

            if (currentBatch.length > 0) {
                partIndex += 1;
                const exporter = global.ExporterRegistry.create(format);
                const partSuffix = partIndex > 1 ? ` (Часть ${partIndex})` : '';
                this.updateStatus(downloadId, `Создание ${format.toUpperCase()}...`, 95);
                const file = await exporter.export(partSuffix ? { ...manga, name: manga.name + partSuffix } :
                    manga, currentBatch, coverBase64);
                await this.saveFile(file.blob, file.filename);
            }
        }

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
                            splitLongImages: downloadState.format !== 'simple'
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

        async updateExistingFile(downloadState, service, loadedFile) {
            const { id: downloadId, slug, format } = downloadState;

            try {
                this.updateStatus(downloadId, 'Загрузка списка глав с сервера...', 5);
                const chaptersData = await service.fetchChaptersList(slug);
                const serverChapters = this.sortChapters(chaptersData.data || []);

                this.updateStatus(downloadId, 'Анализ существующего файла...', 10);
                const exporter = global.ExporterRegistry.create(format);

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
                let partIndex = 0;
                let currentBatch = [];
                let currentSize = 0;

                for (const chapter of mergedChapters) {
                    const chapterSize = this.estimateChapterSize(chapter);
                    if (currentBatch.length > 0 && currentSize + chapterSize > maxSizeBytes) {
                        partIndex += 1;
                        const partSuffix = ` (Часть ${partIndex})`;
                        this.updateStatus(downloadId, `Создание обновлённого ${format.toUpperCase()} - часть ${partIndex}...`, 93);
                        const partFile = await exporter.export(
                            { ...patch, name: patch.name + partSuffix }, currentBatch, existingData.cover
                        );
                        await this.saveFile(partFile.blob, partFile.filename);
                        currentBatch = [chapter];
                        currentSize = chapterSize;
                    } else {
                        currentBatch.push(chapter);
                        currentSize += chapterSize;
                    }
                }

                if (currentBatch.length > 0) {
                    partIndex += 1;
                    const partSuffix = partIndex > 1 ? ` (Часть ${partIndex})` : '';
                    this.updateStatus(downloadId, `Создание обновлённого ${format.toUpperCase()}...`, 95);
                    const lastFile = await exporter.export(
                        partSuffix ? { ...patch, name: patch.name + partSuffix } : patch,
                        currentBatch,
                        existingData.cover
                    );
                    await this.saveFile(lastFile.blob, lastFile.filename);
                }

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

        readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsText(file, 'utf-8');
            });
        }

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

        getChapterKey(chapter) {
            const vol = chapter.volume || '1';
            const num = chapter.number || '0';
            return `v${vol}_ch${num}`;
        }

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
                                splitLongImages: downloadState.format !== 'simple'
                            }
                          )
                        : extractedContent;

                    const chapterResult = {
                        title: chapter.name || `Том ${chapter.volume}, Глава ${chapter.number}`,
                        content: processedContent,
                        volume: chapter.volume,
                        number: chapter.number
                    };

                    results.push(chapterResult);
                } catch (error) {
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
                await this.delay(500);
            }

            return results;
        }

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
                                    splitLongImages: downloadState.format !== 'simple'
                                }
                            )
                            : extractedContent;

                        const chapterResult = {
                            title: chapter.name || `Том ${chapter.volume}, Глава ${chapter.number}`,
                            content: processedContent,
                            volume: chapter.volume,
                            number: chapter.number
                        };

                        results.push(chapterResult);
                        downloadState.chapterContents.push(chapterResult);
                    } catch (error) {
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
                        downloadState.chapterContents.push(errorChapter);
                    }

                    await this.delay(500);
                }
            } finally {
                service._on429 = null;
            }

            return results;
        }

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

        updateStatus(downloadId, message, progress) {
            const download = this.activeDownloads.get(downloadId);
            if (download) {
                download.status = message;
                download.progress = progress;
                this.eventBus.emit('download:progress', download);
            }
        }

        sortChapters(chapters) {
            return chapters.sort((a, b) => {
                const volA = parseInt(a.volume) || 0;
                const volB = parseInt(b.volume) || 0;
                if (volA !== volB) return volA - volB;
                return (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0);
            });
        }

        extractSlug(url) {
            const match = url.match(/\/(?:manga|book)\/([^/?]+)/);
            return match ? match[1] : null;
        }

        generateId() {
            return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

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

        pause(downloadId) {
            const download = this.activeDownloads.get(downloadId);
            if (download) {
                download.controller.pause();
                this.eventBus.emit('download:paused', download);
            } else console.log(`[DownloadManager] No active download with ID: ${downloadId}`);
        }

        resume(downloadId) {
            const download = this.activeDownloads.get(downloadId);
            if (download) {
                download.controller.resume();
                this.eventBus.emit('download:resumed', download);
            } else console.log(`[DownloadManager] No active download with ID: ${downloadId}`);
        }

        stop(downloadId) {
            const download = this.activeDownloads.get(downloadId);
            if (download) {
                download.controller.stop();
                this.eventBus.emit('download:stopped', download);
            } else console.log(`[DownloadManager] No active download with ID: ${downloadId}`);
        }

        getStatus(downloadId) {
            return this.activeDownloads.get(downloadId) || null;
        }
    }

    global.DownloadManager = DownloadManager;
    console.log('[DownloadManager] Loaded');
})(typeof window !== 'undefined' ? window : self);
