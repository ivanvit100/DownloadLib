/**
 * DownloadLib core module
 * Manages manga downloads from various services
 * @module core/DownloadManager
 * @license MIT
 * @author ivanvit
 * @version 1.0.1
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
                onProgress,
                controller,
                loadedFile,
                chapterRange
            } = options;

            let service;
            if (serviceKey) {
                if (serviceKey === 'ranobelib')
                    service = new global.RanobeLibService();
                else if (serviceKey === 'mangalib')
                    service = new global.MangaLibService();
                else throw new Error(`Unknown service: ${serviceKey}`);
            } else if (url) {
                service = global.serviceRegistry.getServiceByUrl(url);
            } else {
                throw new Error('Either serviceKey or url must be provided');
            }

            if (!service) throw new Error('Unsupported service');

            console.log('[DownloadManager] Using service:', service.name);

            const downloadId = this.generateId();
            const downloadState = {
                id: downloadId,
                service: service.name,
                serviceKey: serviceKey,
                slug: slug || this.extractSlug(url),
                format,
                status: 'initializing',
                progress: 0,
                controller: controller || this.createController(),
                loadedFile: loadedFile,
                manga: null,
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
                downloadState.manga = manga;
                
                let coverBase64 = '';
                if (manga.cover) {
                    const coverUrl = manga.cover.default || manga.cover.thumbnail || manga.cover.md || manga.cover;
                    if (typeof coverUrl === 'string') {
                        try {
                            this.updateStatus(downloadId, 'Загружаем обложку...', 7);
                            const referer = service.name === 'ranobelib' ? 'https://ranobelib.me/' : 'https://mangalib.me/';
                            const response = await fetch(coverUrl, {
                                headers: {
                                    'Referer': referer,
                                    'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
                                }
                            });
                            
                            if (response.ok) {
                                const blob = await response.blob();
                                const reader = new FileReader();
                                coverBase64 = await new Promise((resolve, reject) => {
                                    reader.onloadend = () => resolve(reader.result);
                                    reader.onerror = reject;
                                    reader.readAsDataURL(blob);
                                });
                            } else console.error('[DownloadManager] Failed to fetch cover image:', response.status);
                        } catch (e) {
                            console.warn('[DownloadManager] Failed to load cover:', e);
                        }
                    } else console.error('[DownloadManager] Unknown cover format:', coverUrl);
                }
                
                downloadState.coverBase64 = coverBase64;
                
                this.updateStatus(downloadId, 'Загрузка списка глав...', 10);
                const chaptersData = await service.fetchChaptersList(downloadState.slug);
                let chapters = this.sortChapters(chaptersData.data || []);

                if (chapterRange && chapterRange.from !== undefined && chapterRange.to !== undefined) {
                    chapters = chapters.slice(chapterRange.from, chapterRange.to + 1);
                    console.log('[DownloadManager] Filtered chapters:', chapters.length, 'from', chapterRange.from, 'to', chapterRange.to);
                }

                downloadState.chapters = chapters;

                const MAX_CHAPTERS_PER_FILE = serviceKey === 'mangalib' ? 80 : Infinity;
                
                if (chapters.length > MAX_CHAPTERS_PER_FILE) {
                    const totalParts = Math.ceil(chapters.length / MAX_CHAPTERS_PER_FILE);
                    
                    for (let partIndex = 0; partIndex < totalParts; partIndex++) {
                        await downloadState.controller.waitIfPaused();
                        if (downloadState.controller.shouldStop()) break;

                        const startIdx = partIndex * MAX_CHAPTERS_PER_FILE;
                        const endIdx = Math.min((partIndex + 1) * MAX_CHAPTERS_PER_FILE, chapters.length);
                        const chaptersForPart = chapters.slice(startIdx, endIdx);
                        
                        this.updateStatus(downloadId, `Часть ${partIndex + 1}/${totalParts}: Загрузка глав ${startIdx + 1}-${endIdx}...`, 10);
                        
                        const chapterContents = await this.downloadChapters(
                            service,
                            downloadState,
                            chaptersForPart,
                            onProgress,
                            startIdx,
                            chapters.length
                        );

                        this.updateStatus(downloadId, `Часть ${partIndex + 1}/${totalParts}: Создание ${format.toUpperCase()}...`, 90);
                        const exporter = global.ExporterFactory.create(format);
                        
                        const partSuffix = totalParts > 1 ? ` (Часть ${partIndex + 1} из ${totalParts})` : '';
                        const mangaWithSuffix = { ...manga, rus_name: (manga.rus_name || manga.name) + partSuffix };
                        
                        const file = await exporter.export(mangaWithSuffix, chapterContents, coverBase64);

                        await this.saveFile(file.blob, file.filename);
                        
                        downloadState.chapterContents = [];
                    }

                    this.updateStatus(downloadId, 'Готово!', 100);
                    this.eventBus.emit('download:completed', downloadState);
                    
                    return { success: true, downloadId };
                } else {
                    const chapterContents = await this.downloadChapters(
                        service,
                        downloadState,
                        chapters,
                        onProgress
                    );

                    this.updateStatus(downloadId, `Создание ${format.toUpperCase()}...`, 95);
                    const exporter = global.ExporterFactory.create(format);
                    const file = await exporter.export(manga, chapterContents, coverBase64);

                    await this.saveFile(file.blob, file.filename);

                    this.updateStatus(downloadId, 'Готово!', 100);
                    this.eventBus.emit('download:completed', downloadState);
                    
                    return { success: true, downloadId };
                }

            } catch (error) {
                console.error('[DownloadManager] Error:', error);
                this.updateStatus(downloadId, `Ошибка: ${error.message}`, -1);
                this.eventBus.emit('download:failed', { downloadState, error });
                throw error;
            } finally {
                setTimeout(() => this.activeDownloads.delete(downloadId), 5000);
            }
        }

        async updateExistingFile(downloadState, service, loadedFile) {
            const { id: downloadId, slug, format } = downloadState;

            try {
                this.updateStatus(downloadId, 'Загрузка списка глав с сервера...', 5);
                const chaptersData = await service.fetchChaptersList(slug);
                const serverChapters = this.sortChapters(chaptersData.data || []);
                
                this.updateStatus(downloadId, 'Анализ существующего файла...', 10);
                const exporter = global.ExporterFactory.create(format);
                
                let existingData;
                existingData = exporter.parse ?
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

                this.updateStatus(downloadId, `Создание обновлённого ${format.toUpperCase()}...`, 95);
                const file = await exporter.export(
                    existingData.metadata,
                    mergedChapters,
                    existingData.cover
                );

                await this.saveFile(file.blob, file.filename);

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
                const exporter = global.ExporterFactory.create('fb2');
                return exporter.parseFB2(text, file.name);
            } else if (format === 'epub') {
                const exporter = global.ExporterFactory.create('epub');
                return await exporter.parseEPUB(file);
            } else if (format === 'pdf') {
                throw new Error('PDF парсинг пока не реализован');
            }
            
            throw new Error(`Unsupported format: ${format}`);
        }

        async readFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsText(file, 'utf-8');
            });
        }

        findMissingChapters(serverChapters, existingChapters) {
            const existingKeys = new Set();
            
            for (const ch of existingChapters) {
                const key = this.getChapterKey(ch);
                existingKeys.add(key);
            }

            const missing = [];
            
            for (const serverCh of serverChapters) {
                const key = this.getChapterKey(serverCh);
                
                if (!existingKeys.has(key)) {
                    missing.push(serverCh);
                } else {
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
                else return false;
            });

            return !hasContent;
        }

        async downloadSpecificChapters(service, downloadState, chaptersToDownload, totalChapters) {
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
                    const chapterData = await service.fetchChapter(
                        downloadState.slug,
                        chapter.number,
                        chapter.volume || '1'
                    );

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
                                mangaSlug: downloadState.slug
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

                if (newChaptersMap.has(key)) {
                    result.push(newChaptersMap.get(key));
                } else if (existingMap.has(key)) {
                    result.push(existingMap.get(key));
                } else {
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
                    const chapterData = await service.fetchChapter(
                        downloadState.slug,
                        chapter.number,
                        chapter.volume || '1'
                    );

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
                                mangaSlug: downloadState.slug
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

            return results;
        }

        createController() {
            let paused = false;
            let stopped = false;

            return {
                pause: () => paused = true,
                resume: () => paused = false,
                stop: () => stopped = true,
                isPaused: () => paused,
                shouldStop: () => stopped,
                waitIfPaused: async () => {
                    while (paused && !stopped)
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
            const match = url.match(/\/(manga|book)\/([^\/\?]+)/);
            return match ? match[2] : null;
        }

        generateId() {
            return `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        async saveFile(blob, filename) {
            if (global.FileUtils) {
                await global.FileUtils.downloadBlob(blob, filename);
            } else {
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