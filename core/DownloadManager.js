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
                loadedFile
            } = options;

            let service;
            if (serviceKey) {
                if (serviceKey === 'ranobelib') {
                    service = new global.RanobeLibService();
                } else if (serviceKey === 'mangalib') {
                    service = new global.MangaLibService();
                } else {
                    throw new Error(`Unknown service: ${serviceKey}`);
                }
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
                            }
                        } catch (e) {
                            console.warn('[DownloadManager] Failed to load cover:', e);
                        }
                    }
                }
                
                downloadState.coverBase64 = coverBase64;
                
                this.updateStatus(downloadId, 'Загрузка списка глав...', 10);
                const chaptersData = await service.fetchChaptersList(downloadState.slug);
                const chapters = this.sortChapters(chaptersData.data || []);

                downloadState.chapters = chapters;

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

            } catch (error) {
                console.error('[DownloadManager] Error:', error);
                this.updateStatus(downloadId, `Ошибка: ${error.message}`, -1);
                this.eventBus.emit('download:failed', { downloadState, error });
                throw error;
            } finally {
                setTimeout(() => this.activeDownloads.delete(downloadId), 5000);
            }
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

        async downloadChapters(service, downloadState, chapters, onProgress) {
            const results = [];
            const total = chapters.length;

            for (let i = 0; i < total; i++) {
                await downloadState.controller.waitIfPaused();
                if (downloadState.controller.shouldStop()) break;

                downloadState.currentChapterIndex = i;

                const chapter = chapters[i];
                const progress = Math.floor((i / total) * 80) + 10;
                
                this.updateStatus(
                    downloadState.id,
                    `Глава ${i + 1}/${total}: ${chapter.name || chapter.number}`,
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

        async fetchImageWithRetry(url, referer, retries = 5) {
            for (let attempt = 0; attempt < retries; attempt++) {
                try {
                    const response = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'Referer': referer || '',
                            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
                        },
                        credentials: 'omit'
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const blob = await response.blob();
                    return blob;

                } catch (e) {
                    if (attempt < retries - 1)
                        await this.delay(1000 * (attempt + 1));
                }
            }

            return null;
        }

        async blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
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

        sanitizeFilename(filename) {
            return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
        }

        pause(downloadId) {
            const download = this.activeDownloads.get(downloadId);
            if (download) {
                download.controller.pause();
                this.eventBus.emit('download:paused', download);
            }
        }

        resume(downloadId) {
            const download = this.activeDownloads.get(downloadId);
            if (download) {
                download.controller.resume();
                this.eventBus.emit('download:resumed', download);
            }
        }

        stop(downloadId) {
            const download = this.activeDownloads.get(downloadId);
            if (download) {
                download.controller.stop();
                this.eventBus.emit('download:stopped', download);
            }
        }

        getStatus(downloadId) {
            return this.activeDownloads.get(downloadId) || null;
        }
    }

    global.DownloadManager = DownloadManager;
    console.log('[DownloadManager] Loaded');
})(window);