'use strict';

console.log('[BackgroundDownload] Loading...');

class BackgroundDownload {
    constructor() {
        this.activeDownloads = new Map();
        this.downloadIdCounter = 0;
        console.log('[BackgroundDownload] Initialized');
    }

    async takeOverDownload(options) {
        const downloadId = `bg_${Date.now()}_${++this.downloadIdCounter}`;
        
        const download = {
            id: downloadId,
            slug: options.slug,
            serviceKey: options.serviceKey,
            format: options.format,
            status: options.currentStatus || 'Продолжение загрузки...',
            progress: options.currentProgress || 0,
            startTime: Date.now(),
            controller: this.createController(),
            manga: options.manga,
            coverBase64: options.coverBase64,
            chapterContents: options.chapterContents || [],
            chapters: options.chapters,
            currentChapterIndex: options.currentChapterIndex || 0,
            loadedFile: options.loadedFile
        };
        
        this.activeDownloads.set(downloadId, download);
        console.log(`[BackgroundDownload] Took over download ${downloadId} from chapter ${download.currentChapterIndex}`);
        
        this.continueDownload(download).catch(err => {
            console.error(`[BackgroundDownload] Download ${downloadId} failed:`, err);
            download.status = 'failed';
            download.error = err.message;
        });
        
        return { downloadId };
    }

    async continueDownload(download) {
        try {
            let service;
            if (download.serviceKey === 'ranobelib')
                service = new RanobeLibService();
            else if (download.serviceKey === 'mangalib')
                service = new MangaLibService();
            else
                throw new Error(`Unknown service: ${download.serviceKey}`);

            const total = download.chapters.length;
            
            for (let i = download.currentChapterIndex; i < total; i++) {
                await download.controller.waitIfPaused();
                if (download.controller.shouldStop()) {
                    download.status = 'Остановлено';
                    return;
                }

                const chapter = download.chapters[i];
                const progress = Math.floor((i / total) * 80) + 10;
                
                download.status = `Глава ${i + 1}/${total}: ${chapter.name || chapter.number}`;
                download.progress = progress;
                download.currentChapterIndex = i;

                try {
                    const chapterData = await service.fetchChapter(
                        download.slug,
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
                            download.loadedFile,
                            {
                                chapterMeta: rawContent,
                                chapterObj: chapter,
                                mangaSlug: download.slug
                            }
                          )
                        : extractedContent;

                    download.chapterContents.push({
                        title: chapter.name || `Том ${chapter.volume}, Глава ${chapter.number}`,
                        content: processedContent,
                        volume: chapter.volume,
                        number: chapter.number
                    });

                } catch (error) {
                    console.error(`[BackgroundDownload] Failed to download chapter ${chapter.number}:`, error);
                    download.chapterContents.push({
                        title: chapter.name || `Том ${chapter.volume}, Глава ${chapter.number}`,
                        content: [{
                            type: 'text',
                            text: `[Ошибка загрузки главы: ${error.message}]`
                        }],
                        volume: chapter.volume,
                        number: chapter.number
                    });
                }

                await this.delay(500);
            }

            download.status = `Создание ${download.format.toUpperCase()}...`;
            download.progress = 95;
            
            const exporter = ExporterFactory.create(download.format);
            const file = await exporter.export(download.manga, download.chapterContents, download.coverBase64);

            const filename = file.filename;
            const blob = file.blob;
            
            const url = URL.createObjectURL(blob);
            const downloadItem = await browser.downloads.download({
                url: url,
                filename: filename,
                saveAs: false
            });
            
            download.status = 'Готово!';
            download.progress = 100;
            download.downloadItemId = downloadItem;
            
            setTimeout(() => {
                URL.revokeObjectURL(url);
                this.activeDownloads.delete(download.id);
            }, 10000);

        } catch (error) {
            console.error('[BackgroundDownload] Error:', error);
            download.status = `Ошибка: ${error.message}`;
            download.error = error.message;
            throw error;
        }
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

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getActiveDownloads() {
        const downloads = [];
        for (const [id, download] of this.activeDownloads) {
            downloads.push({
                id: download.id,
                slug: download.slug,
                serviceKey: download.serviceKey,
                format: download.format,
                status: download.status,
                progress: download.progress,
                error: download.error
            });
        }
        return downloads;
    }

    pause(downloadId) {
        const download = this.activeDownloads.get(downloadId);
        if (download) download.controller.pause();
    }

    resume(downloadId) {
        const download = this.activeDownloads.get(downloadId);
        if (download) download.controller.resume();
    }

    stop(downloadId) {
        const download = this.activeDownloads.get(downloadId);
        if (download) {
            download.controller.stop();
            download.status = 'Остановлено';
        }
    }
}

const backgroundDownload = new BackgroundDownload();

console.log('[BackgroundDownload] Loaded');