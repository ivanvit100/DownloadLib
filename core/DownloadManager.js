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
                slug: slug || this.extractSlug(url),
                format,
                status: 'initializing',
                progress: 0,
                controller: controller || this.createController()
            };

            this.activeDownloads.set(downloadId, downloadState);
            this.eventBus.emit('download:started', downloadState);

            try {
                this.updateStatus(downloadId, 'Загрузка метаданных...', 5);
                const metadata = await service.fetchMangaMetadata(downloadState.slug);
                console.log('[DownloadManager] Metadata:', metadata);
                
                this.updateStatus(downloadId, 'Загрузка списка глав...', 10);
                const chaptersData = await service.fetchChaptersList(downloadState.slug);
                const chapters = this.sortChapters(chaptersData.data || []);
                console.log('[DownloadManager] Found', chapters.length, 'chapters');

                const chapterContents = await this.downloadChapters(
                    service,
                    downloadState,
                    chapters,
                    onProgress
                );

                this.updateStatus(downloadId, `Создание ${format.toUpperCase()}...`, 95);
                const exporter = global.ExporterFactory.create(format);
                const file = await exporter.export(metadata.data, chapterContents);

                await this.saveFile(file, metadata.data, format);

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

        async downloadChapters(service, downloadState, chapters, onProgress) {
            const results = [];
            const total = chapters.length;

            for (let i = 0; i < total; i++) {
                await downloadState.controller.waitIfPaused();
                if (downloadState.controller.shouldStop()) break;

                const chapter = chapters[i];
                const progress = Math.floor((i / total) * 80) + 10;
                
                this.updateStatus(
                    downloadState.id,
                    `Глава ${i + 1}/${total}: ${chapter.name}`,
                    progress
                );

                try {
                    const chapterData = await service.fetchChapter(
                        downloadState.slug,
                        chapter.number,
                        chapter.volume || '1'
                    );

                    const content = await service.processChapterContent(
                        chapterData.data || chapterData,
                        { onProgress: onProgress }
                    );

                    results.push({
                        title: chapter.name || `Том ${chapter.volume}, Глава ${chapter.number}`,
                        content,
                        volume: chapter.volume,
                        number: chapter.number
                    });

                } catch (error) {
                    console.error(`[DownloadManager] Failed to download chapter ${chapter.number}:`, error);
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

        async saveFile(blob, metadata, format) {
            const filename = this.sanitizeFilename(
                metadata.rus_name || metadata.name || 'book'
            ) + `.${format}`;

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