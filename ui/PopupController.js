/**
 * DownloadLib ui module
 * Module to manage the user interface for manga downloads
 * @module ui/PopupController
 * @license MIT
 * @author ivanvit
 * @version 1.0.1
 */

'use strict';

(function(global) {
    console.log('[PopupController] Loading...');

    const browserAPI = typeof chrome !== 'undefined' && chrome.runtime ? chrome : (typeof browser !== 'undefined' ? browser : null);

    if (!browserAPI) {
        console.error('[PopupController] No browser API available');
        return;
    }

    class PopupController {
        constructor() {
            console.log('[PopupController] Initializing...');
            this.downloadManager = new global.DownloadManager();
            this.currentDownloadId = null;
            this.isDownloading = false;
            this.isPaused = false;
            this.shouldStop = false;
            this.loadedFile = null;
            this.currentSlug = null;
            this.currentServiceKey = null;
            this.setupUI();
            this.setupEventListeners();
            this.subscribeToEvents();
            this.loadMetadata();
            
            setInterval(() => this.updateActiveDownloadsInfo(), 2000);
            
            this.downloadManager.eventBus.on('download:started', (state) => {
                this.currentDownloadId = state.id;
                console.log('[PopupController] Download started with ID:', this.currentDownloadId);
            });
            
            console.log('[PopupController] Initialized');
        }

        setupUI() {
            const btn = document.getElementById('downloadBtn');
            const status = document.getElementById('status');
            const progress = document.getElementById('progress');
            const siteLogo = document.getElementById('siteLogo');
            const logoInfo = document.getElementById('logoInfo');
            const coverImg = document.getElementById('cover');
            const desc = document.getElementById('description');

            if (!btn) {
                console.error('downloadBtn not found in DOM');
                return;
            }

            let releaseEl = document.getElementById('releaseDate');
            if (!releaseEl) {
                releaseEl = document.createElement('div');
                releaseEl.id = 'releaseDate';
                releaseEl.style.textAlign = 'center';
                releaseEl.style.color = '#bdbdbd';
                releaseEl.style.fontSize = '12px';
                releaseEl.style.marginTop = '8px';
                releaseEl.style.marginBottom = '8px';
                btn.parentNode.insertBefore(releaseEl, btn);
            }

            let formatSelector = document.getElementById('formatSelector');
            if (!formatSelector) {
                const formatContainer = document.createElement('div');
                formatContainer.style.textAlign = 'center';
                formatContainer.style.marginTop = '10px';
                formatContainer.style.marginBottom = '10px';

                formatSelector = document.createElement('select');
                formatSelector.id = 'formatSelector';
                formatSelector.style.padding = '6px 12px';
                formatSelector.style.fontSize = '14px';
                formatSelector.style.marginLeft = '8px';
                formatSelector.style.marginRight = '8px';

                const optionFb2 = document.createElement('option');
                optionFb2.value = 'fb2';
                optionFb2.textContent = 'FB2';

                const optionEpub = document.createElement('option');
                optionEpub.value = 'epub';
                optionEpub.textContent = 'EPUB';

                const optionPdf = document.createElement('option');
                optionPdf.value = 'pdf';
                optionPdf.textContent = 'PDF';

                formatSelector.appendChild(optionFb2);
                formatSelector.appendChild(optionEpub);
                formatSelector.appendChild(optionPdf);

                const label = document.createElement('label');
                label.textContent = 'Формат: ';
                label.style.color = '#bdbdbd';
                label.style.fontSize = '14px';
                label.htmlFor = 'formatSelector';

                formatContainer.appendChild(label);
                formatContainer.appendChild(formatSelector);
                btn.parentNode.insertBefore(formatContainer, btn);
            } else console.warn('formatSelector found in DOM');

            const FORMAT_STORAGE_KEY = 'manga_parser_selected_format';
            if (formatSelector && localStorage.getItem(FORMAT_STORAGE_KEY)) 
                formatSelector.value = localStorage.getItem(FORMAT_STORAGE_KEY);
            else console.log('No saved format in localStorage');
            
            formatSelector.addEventListener('change', () => {
                localStorage.setItem(FORMAT_STORAGE_KEY, formatSelector.value);
            });

            let rateLimitInput = document.getElementById('rateLimitInput');
            if (!rateLimitInput) {
                const rateLimitContainer = document.createElement('div');
                rateLimitContainer.style.textAlign = 'center';
                rateLimitContainer.style.marginTop = '10px';
                rateLimitContainer.style.marginBottom = '10px';
                
                const label = document.createElement('label');
                label.textContent = 'Запросов в минуту: ';
                label.style.color = '#bdbdbd';
                label.style.fontSize = '14px';
                
                rateLimitInput = document.createElement('input');
                rateLimitInput.id = 'rateLimitInput';
                rateLimitInput.type = 'number';
                rateLimitInput.min = '2';
                rateLimitInput.max = '200';
                rateLimitInput.step = '1';
                rateLimitInput.value = '100';
                
                rateLimitInput.addEventListener('input', (e) => {
                    let val = parseInt(e.target.value);
                    if (isNaN(val) || val < 2) val = 2;
                    if (val > 200) val = 200;
                    e.target.value = Math.floor(val);
                });
                
                rateLimitContainer.appendChild(label);
                rateLimitContainer.appendChild(rateLimitInput);
                btn.parentNode.insertBefore(rateLimitContainer, btn);
            } else console.warn('rateLimitInput found in DOM');

            let activeDownloadsInfo = document.getElementById('activeDownloadsInfo');
            if (!activeDownloadsInfo) {
                activeDownloadsInfo = document.createElement('div');
                activeDownloadsInfo.id = 'activeDownloadsInfo';
                activeDownloadsInfo.style.textAlign = 'center';
                activeDownloadsInfo.style.color = '#bdbdbd';
                activeDownloadsInfo.style.fontSize = '12px';
                activeDownloadsInfo.style.marginTop = '8px';
                activeDownloadsInfo.style.marginBottom = '8px';
                activeDownloadsInfo.style.display = 'none';
                
                const rateLimitContainer = rateLimitInput.parentNode;
                rateLimitContainer.parentNode.insertBefore(activeDownloadsInfo, rateLimitContainer.nextSibling);
            }

            let fileInputContainer = document.getElementById('fileInputContainer');
            if (!fileInputContainer) {
                fileInputContainer = document.createElement('div');
                fileInputContainer.id = 'fileInputContainer';
                fileInputContainer.style.textAlign = 'center';
                fileInputContainer.style.marginTop = '10px';
                fileInputContainer.style.marginBottom = '10px';

                const hiddenFileInput = document.createElement('input');
                hiddenFileInput.type = 'file';
                hiddenFileInput.id = 'fileInput';
                hiddenFileInput.accept = '.pdf,.epub,.fb2';
                hiddenFileInput.style.display = 'none';

                const customFileBtn = document.createElement('button');
                customFileBtn.id = 'customFileBtn';
                customFileBtn.textContent = 'Загрузить файл для обновления';
                customFileBtn.style.padding = '8px 16px';
                customFileBtn.style.cursor = 'pointer';
                customFileBtn.style.fontSize = '14px';
                customFileBtn.style.transition = 'all 0.3s ease';

                fileInputContainer.appendChild(hiddenFileInput);
                fileInputContainer.appendChild(customFileBtn);
                btn.parentNode.insertBefore(fileInputContainer, btn);

                hiddenFileInput.addEventListener('change', (e) => {
                    e.stopPropagation();
                    const file = hiddenFileInput.files && hiddenFileInput.files[0];
                    this.loadedFile = null;
                    
                    if (!file) {
                        formatSelector.disabled = false;
                        if (status) status.textContent = '';
                        else console.warn('Status element not found when resetting after file deselection');
                        customFileBtn.textContent = 'Загрузить файл для обновления';
                        btn.textContent = 'Скачать';
                        btn.style.display = 'block';
                        return;
                    }
                    
                    const ext = file.name.split('.').pop().toLowerCase();
                    if (['pdf', 'epub', 'fb2'].includes(ext)) {
                        formatSelector.value = ext;
                        formatSelector.disabled = true;
                        if (status) status.textContent = `Загружен файл: ${file.name}`;
                        customFileBtn.textContent = `Файл загружен: ${file.name}`;
                        btn.textContent = 'Обновить файл';
                        btn.style.display = 'block';
                        this.loadedFile = file;
                    } else {
                        formatSelector.disabled = false;
                        if (status) status.textContent = 'Ошибка: поддерживаются только файлы PDF, EPUB или FB2';
                        else console.warn('Status element not found when showing file type error');
                        customFileBtn.textContent = 'Загрузить файл для обновления';
                        hiddenFileInput.value = '';
                        this.loadedFile = null;
                        btn.textContent = 'Скачать';
                    }
                });
            } else console.warn('fileInputContainer found in DOM');

            let controlsContainer = document.getElementById('downloadControls');
            if (!controlsContainer) {
                controlsContainer = document.createElement('div');
                controlsContainer.id = 'downloadControls';
                controlsContainer.style.display = 'none';
                controlsContainer.style.textAlign = 'center';
                controlsContainer.style.marginTop = '10px';
                
                const pauseBtn = document.createElement('button');
                pauseBtn.id = 'pauseBtn';
                pauseBtn.textContent = 'Пауза';
                pauseBtn.style.padding = '8px 16px';
                pauseBtn.style.cursor = 'pointer';
                pauseBtn.style.width = 'calc(50% - 4px)';
                pauseBtn.style.transition = 'all 0.3s ease';
                
                const backgroundBtn = document.createElement('button');
                backgroundBtn.id = 'backgroundBtn';
                backgroundBtn.textContent = 'Фоном';
                backgroundBtn.style.padding = '8px 16px';
                backgroundBtn.style.cursor = 'pointer';
                backgroundBtn.style.width = 'calc(50% - 4px)';
                backgroundBtn.style.transition = 'all 0.3s ease';

                if (!document.getElementById('control-buttons-styles')) {
                    const styleEl = document.createElement('style');
                    styleEl.id = 'control-buttons-styles';
                    styleEl.textContent = `
                        #pauseBtn, #backgroundBtn, #customFileBtn {
                            border: 2px solid var(--primary-color) !important;
                            background: #252527 !important;
                        }
                        #pauseBtn:hover, #backgroundBtn:hover, #customFileBtn:hover {
                            border: 2px solid var(--secondary-color) !important;
                            background: #252527 !important;
                        }
                    `;
                    document.head.appendChild(styleEl);
                }

                const stopBtn = document.createElement('button');
                stopBtn.id = 'stopBtn';
                stopBtn.textContent = 'Завершить';
                stopBtn.style.marginTop = '12px';
                stopBtn.style.padding = '8px 16px';
                stopBtn.style.cursor = 'pointer';
                stopBtn.style.display = 'block';
                stopBtn.style.width = '100%';
                stopBtn.style.transition = 'all 0.3s ease';
                
                const btnRow = document.createElement('div');
                btnRow.style.display = 'flex';
                btnRow.style.justifyContent = 'space-between';
                btnRow.appendChild(pauseBtn);
                btnRow.appendChild(backgroundBtn);
                
                controlsContainer.appendChild(btnRow);
                controlsContainer.appendChild(stopBtn);
                btn.parentNode.insertBefore(controlsContainer, btn.nextSibling);
            } else console.warn('downloadControls container found in DOM');

            if (progress) progress.style.display = 'none';

            console.log('[PopupController] UI setup complete');
        }

        async isInSeparateWindow() {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const hasParams = urlParams.has('download') || urlParams.has('fileUpload');
                
                if (hasParams) return true;
                
                if (window.outerWidth <= 500 && window.outerHeight <= 700) return true;
                
                const currentWindow = await browserAPI.windows.getCurrent();
                console.log('[PopupController] Window type:', currentWindow.type);
                return currentWindow.type === 'popup';
            } catch (e) {
                console.warn('Failed to detect window type:', e);
                return false;
            }
        }

        async updateActiveDownloadsInfo() {
            const activeDownloadsInfo = document.getElementById('activeDownloadsInfo');
            if (!activeDownloadsInfo) return;
            
            try {
                const response = await browserAPI.runtime.sendMessage({ action: 'getActiveDownloads' });
                
                if (response.ok && response.downloads) {
                    const bgDownloads = response.downloads;
                    const fgDownloads = this.isDownloading ? 1 : 0;
                    const total = bgDownloads.length + fgDownloads;
                    
                    if (total > 0) {
                        const parts = [];
                        if (fgDownloads > 0) parts.push(`${fgDownloads} обычная`);
                        if (bgDownloads.length > 0) parts.push(`${bgDownloads.length} фоновая`);
                        else console.log('No background downloads currently active');
                        
                        activeDownloadsInfo.textContent = `Активных загрузок: ${parts.join(' + ')}`;
                        activeDownloadsInfo.style.display = 'block';
                        
                        if (bgDownloads.length > 0) {
                            const details = bgDownloads.map(d => 
                                `${d.slug}: ${d.status} (${d.progress}%)`
                            ).join('\n');
                            activeDownloadsInfo.title = details;
                        } else console.log('No background downloads to show in tooltip');
                    } else {
                        activeDownloadsInfo.style.display = 'none';
                    }
                } else console.warn('Failed to get active downloads or no downloads found:', response);
            } catch (e) {
                console.error('[PopupController] Failed to get active downloads:', e);
            }
        }

        async loadMetadata() {
            await this.updateActiveDownloadsInfo();
            
            const status = document.getElementById('status');
            const btn = document.getElementById('downloadBtn');
            const logoInfo = document.getElementById('logoInfo');
            const coverImg = document.getElementById('cover');
            const desc = document.getElementById('description');
            const releaseEl = document.getElementById('releaseDate');
            const siteLogo = document.getElementById('siteLogo');
            const customFileBtn = document.getElementById('customFileBtn');
            const hiddenFileInput = document.getElementById('fileInput');

            const urlParams = new URLSearchParams(window.location.search);
            const autoDownload = urlParams.get('download') === 'true';
            const fileUploadMode = urlParams.get('fileUpload') === 'true';
            const slugFromUrl = urlParams.get('slug');
            const serviceFromUrl = urlParams.get('service');
            const formatFromUrl = urlParams.get('format');
            const rateLimitFromUrl = urlParams.get('rateLimit');

            const formatSelector = document.getElementById('formatSelector');
            if (formatFromUrl && formatSelector) {
                formatSelector.value = formatFromUrl;
                localStorage.setItem('manga_parser_selected_format', formatFromUrl);
            }

            const rateLimitInput = document.getElementById('rateLimitInput');
            if (rateLimitFromUrl && rateLimitInput)
                rateLimitInput.value = rateLimitFromUrl;

            if (btn) btn.disabled = true;
            if (status) status.textContent = 'Получаем информацию...';

            try {
                let currentUrl, hostname, slug, serviceKey, service;

                if ((autoDownload || fileUploadMode) && slugFromUrl && serviceFromUrl) {
                    slug = slugFromUrl;
                    serviceKey = serviceFromUrl;
                    
                    if (serviceKey === 'ranobelib')
                        service = new global.RanobeLibService();
                    else if (serviceKey === 'mangalib')
                        service = new global.MangaLibService();
                    else throw new Error(`Unknown service: ${serviceKey}`);
                    
                    hostname = serviceKey === 'ranobelib' ? 'ranobelib.me' : 'mangalib.me';
                } else {
                    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
                    
                    if (!tabs || !tabs[0]) throw new Error('No active tab found');
                    
                    currentUrl = tabs[0].url;
                    console.log('[PopupController] Current URL:', currentUrl);

                    const match = currentUrl.match(/\/(manga|book)\/([^\/\?]+)/);
                    slug = match ? match[2] : null;

                    const url = new URL(currentUrl);
                    hostname = url.hostname;
                    
                    service = global.serviceRegistry.getServiceByUrl(currentUrl);
                    if (!service) {
                        logoInfo.textContent = '';
                        if (coverImg) coverImg.style.display = 'none';
                        else console.warn('No service found for current URL');
                        if (desc) desc.textContent = 'Сперва откройте один из сайтов проекта MangaLib';
                        else console.warn('Description element found when showing no service error');
                        if (releaseEl) releaseEl.textContent = '';
                        else console.warn('Release date element found when showing no service error');
                        btn.disabled = true;
                        if (status) status.textContent = '';
                        else console.warn('Status element not found when showing no service error');
                        return;
                    }
                    
                    serviceKey = service.name;
                }

                if (serviceKey === 'ranobelib') {
                    document.body.style.setProperty('--primary-color', '#2196f3');
                    document.body.style.setProperty('--secondary-color', '#1f82d3ff');
                    if (siteLogo) siteLogo.src = 'icons/logo3.png';
                    else console.warn('Site logo element not found when setting logo for service:', serviceKey);
                } else {
                    document.body.style.setProperty('--primary-color', '#ff9100');
                    document.body.style.setProperty('--secondary-color', '#c77101');
                    if (siteLogo) siteLogo.src = 'icons/logo1.png';
                    else console.warn('Site logo element not found when setting logo for service:', serviceKey);
                }

                if (!slug) {
                    logoInfo.textContent = '';
                    if (coverImg) coverImg.style.display = 'none';
                    else console.warn('Cover image element not found when showing no slug error');
                    if (desc) desc.textContent = 'Сперва откройте соответствующий тайтл';
                    else console.warn('Description element found when showing no slug error');
                    if (releaseEl) releaseEl.textContent = '';
                    else console.warn('Release date element found when showing no slug error');
                    btn.disabled = true;
                    if (status) status.textContent = '';
                    else console.warn('Status element not found when showing no slug error');
                    return;
                }

                this.currentSlug = slug;
                this.currentServiceKey = serviceKey;
                this.currentService = service;

                console.log('[PopupController] Fetching metadata for slug:', slug);
                
                const rawResp = await service.fetchMangaMetadata(slug);
                console.log('[PopupController] Raw response:', rawResp);
                
                const meta = rawResp.data || rawResp;

                let chaptersCount = null;
                try {
                    const chaptersData = await service.fetchChaptersList(slug);
                    const chapters = chaptersData.data || [];
                    chaptersCount = chapters.length;
                } catch (e) {
                    console.warn('[PopupController] Failed to fetch chapters count:', e);
                }

                const title = meta.rus_name || meta.name || slug;
                const fullSummary = meta.summary || meta.description || 'Описание отсутствует.';
                const summary = this.truncateText(fullSummary, 100);

                let cover = null;
                if (meta.cover) {
                    if (typeof meta.cover === 'string')
                        cover = meta.cover;
                    else if (meta.cover.default)
                        cover = meta.cover.default;
                    else if (meta.cover.thumbnail)
                        cover = meta.cover.thumbnail;
                    else if (meta.cover.md)
                        cover = meta.cover.md;
                    else if (meta.cover.url)
                        cover = meta.cover.url;
                    else console.warn('No valid cover URL found in meta.cover object');
                } else if (meta.image) {
                    cover = meta.image;
                } else console.warn('No cover information found in metadata');

                if (cover) {
                    coverImg.style.display = 'block';
                    coverImg.src = cover;
                    coverImg.setAttribute('style', 'display:block; float:left; width:80px; height:auto; margin-right:10px;');
                } else {
                    coverImg.style.display = 'none';
                }

                const authors = (meta.authors && Array.isArray(meta.authors)) 
                    ? meta.authors.map(a => {
                        if (!a) return null;
                        else if (typeof a === 'string') return a;
                        else return a.name || a.rus_name || a.title || null;
                    }).filter(Boolean)
                    : null;

                let rating = null;
                if (meta.ageRestriction && meta.ageRestriction.label) 
                    rating = String(meta.ageRestriction.label);
                else console.warn('No age restriction label found in metadata');

                const firstLineParts = [];
                if (chaptersCount !== null) firstLineParts.push('Глав: ' + chaptersCount);
                if (rating) firstLineParts.push('Рейтинг: ' + rating);
                else console.warn('No rating information found in metadata');

                const secondLine = (authors && authors.length) ? ('Авторы: ' + authors.join(', ')) : '';

                let logoText = '';
                logoText += firstLineParts.join(' · ');
                if (secondLine) logoText += '\n' + secondLine;
                logoInfo.textContent = logoText;

                desc.innerHTML = `<strong>${title}</strong><br><small>${summary}</small>`;
                
                const release = meta.releaseDate || meta.releaseDateString || meta.release_date || meta.published || meta.year || meta.date || '';
                if (releaseEl) releaseEl.textContent = release ? ('Дата выхода: ' + release) : '';
                else console.warn('Release date element not found when setting release date:', release);

                btn.disabled = false;
                if (status) status.textContent = 'Нажмите "Скачать" для загрузки книги';
                else console.warn('Status element not found when setting ready to download message');

                if (customFileBtn) {
                    customFileBtn.onclick = async () => {
                        try {
                            const inSeparateWindow = await this.isInSeparateWindow();
                            console.log('[PopupController] In separate window:', inSeparateWindow);
                            
                            if (inSeparateWindow) {
                                if (status) status.textContent = 'Выберите файл для обновления';
                                else console.warn('Status element not found when prompting for file selection in separate window');
                                hiddenFileInput.click();
                            } else {
                                const format = formatSelector ? formatSelector.value : 'fb2';
                                const rateLimit = rateLimitInput ? parseInt(rateLimitInput.value) || 100 : 100;
                                
                                try {
                                    const win = await browserAPI.windows.create({
                                        url: browserAPI.runtime.getURL('popup.html') + 
                                             '?fileUpload=true&slug=' + encodeURIComponent(slug) + 
                                             '&service=' + encodeURIComponent(serviceKey) +
                                             '&format=' + encodeURIComponent(format) +
                                             '&rateLimit=' + encodeURIComponent(rateLimit),
                                        type: 'popup',
                                        width: 420,
                                        height: 650,
                                        focused: true,
                                        state: 'normal'
                                    });
                                    
                                    if (win && win.id) {
                                        await new Promise(resolve => setTimeout(resolve, 500));
                                        browserAPI.windows.update(win.id, { focused: true });
                                    } else console.warn('Window created but no ID found:', win);
                                } catch (createError) {
                                    console.error('Failed to create window:', createError);
                                    if (status) status.textContent = 'Не удалось открыть окно, используем текущее';
                                    else console.warn('Status element not found when showing window creation error');
                                    hiddenFileInput.click();
                                }
                            }
                        } catch (e) {
                            console.error('Failed to handle file upload:', e);
                            if (status) status.textContent = 'Выберите файл для обновления';
                            else console.warn('Status element not found when prompting for file selection after error');
                            hiddenFileInput.click();
                        }
                    };
                } else console.warn('Custom file button not found when setting up file upload handler');

                if (fileUploadMode && hiddenFileInput) {
                    if (status) status.textContent = 'Выберите файл для обновления';
                    else console.warn('Status element not found when prompting for file selection in file upload mode');
                    setTimeout(() => {
                        hiddenFileInput.click();
                    }, 300);
                }

                if (autoDownload) setTimeout(() => this.startDownload(), 500);
            } catch (error) {
                console.error('[PopupController] Failed to load metadata:', error);
                if (desc) desc.textContent = `Ошибка: ${error.message}`;
                if (status) status.textContent = '';
                if (btn) btn.disabled = true;
            }
        }

        truncateText(text, maxLength = 128) {
            if (!text) return text;
            const str = String(text).trim();
            if (str.length <= maxLength) return str;
            return str.substring(0, maxLength) + '...';
        }

        setupEventListeners() {
            const downloadBtn = document.getElementById('downloadBtn');
            const pauseBtn = document.getElementById('pauseBtn');
            const stopBtn = document.getElementById('stopBtn');
            const backgroundBtn = document.getElementById('backgroundBtn');

            if (downloadBtn) {
                downloadBtn.addEventListener('click', async () => {
                    const inSeparateWindow = await this.isInSeparateWindow();
                    
                    if (!this.loadedFile && !inSeparateWindow) {
                        const formatSelector = document.getElementById('formatSelector');
                        const rateLimitInput = document.getElementById('rateLimitInput');
                        const format = formatSelector ? formatSelector.value : 'fb2';
                        const rateLimit = rateLimitInput ? parseInt(rateLimitInput.value) || 100 : 100;
                        
                        try {
                            const win = await browserAPI.windows.create({
                                url: browserAPI.runtime.getURL('popup.html') + 
                                     '?download=true&slug=' + encodeURIComponent(this.currentSlug) + 
                                     '&service=' + encodeURIComponent(this.currentServiceKey) +
                                     '&format=' + encodeURIComponent(format) +
                                     '&rateLimit=' + encodeURIComponent(rateLimit),
                                type: 'popup',
                                width: 420,
                                height: 650,
                                focused: true,
                                state: 'normal'
                            });
                            
                            if (win && win.id) {
                                await new Promise(resolve => setTimeout(resolve, 500));
                                browserAPI.windows.update(win.id, { focused: true });
                            } else console.warn('Window created but no ID found:', win);
                        } catch (e) {
                            console.error('Failed to create window:', e);
                            await this.startDownload();
                        }
                    } else await this.startDownload();
                });
                console.log('[PopupController] Download button listener attached');
            }

            if (pauseBtn) {
                pauseBtn.addEventListener('click', () => {
                    this.isPaused = !this.isPaused;
                    pauseBtn.textContent = this.isPaused ? 'Продолжить' : 'Пауза';
                    const status = document.getElementById('status');
                    if (status) status.textContent = this.isPaused ? 'Пауза...' : 'Загрузка...';
                    else console.warn('Status element not found when updating status on pause/resume');
                });
            }

            if (stopBtn) stopBtn.addEventListener('click', () => this.stopDownload());

            if (backgroundBtn) {
                backgroundBtn.addEventListener('click', async () => {
                    if (!this.currentDownloadId) {
                        console.error('[PopupController] No currentDownloadId:', this.currentDownloadId);
                        return;
                    } else console.log('[PopupController] Attempting to move download to background with ID:', this.currentDownloadId);
                    
                    try {
                        const downloadState = this.downloadManager.getDownloadState(this.currentDownloadId);
                        
                        if (!downloadState) {
                            console.error('[PopupController] No downloadState for ID:', this.currentDownloadId);
                            return;
                        } else {
                            this.shouldStop = true;
                            this.downloadManager.stop(this.currentDownloadId);
                            
                            const response = await browserAPI.runtime.sendMessage({
                                action: 'takeOverDownload',
                                ...downloadState
                            });
                            
                            if (response.ok) {
                                const inSeparateWindow = await this.isInSeparateWindow();
                                if (inSeparateWindow) {
                                    window.close();
                                } else {
                                    this.resetUI();
                                    const status = document.getElementById('status');
                                    if (status) status.textContent = 'Загрузка продолжается в фоне';
                                }
                            } else this.shouldStop = false;
                        }
                    } catch (e) {
                        console.error('[PopupController] Failed to move to background:', e);
                        this.shouldStop = false;
                    }
                });
            }
        }

        subscribeToEvents() {
            this.downloadManager.eventBus.on('download:progress', (state) => {
                this.updateProgress(state.status, state.progress);
            });

            this.downloadManager.eventBus.on('download:completed', () => {
                const message = this.loadedFile ? 'Файл обновлён!' : 'Загрузка завершена!';
                this.showSuccess(message);
                this.resetUI();
            });

            this.downloadManager.eventBus.on('download:failed', ({ error }) => {
                this.showError(error.message);
                this.resetUI();
            });
        }

        async startDownload() {
            if (!this.currentSlug || !this.currentServiceKey) {
                this.showError('Не удалось определить тайтл');
                return;
            }

            const btn = document.getElementById('downloadBtn');
            const formatSelector = document.getElementById('formatSelector');
            const rateLimitInput = document.getElementById('rateLimitInput');
            const status = document.getElementById('status');
            const progress = document.getElementById('progress');
            const controlsContainer = document.getElementById('downloadControls');
            const hiddenFileInput = document.getElementById('fileInput');
            const customFileBtn = document.getElementById('customFileBtn');

            try {
                if (rateLimitInput) {
                    const limit = parseInt(rateLimitInput.value) || 100;
                    await browserAPI.runtime.sendMessage({
                        action: 'setRateLimit',
                        limit: limit
                    });
                }
                
                this.isDownloading = true;
                this.isPaused = false;
                this.shouldStop = false;
                
                btn.disabled = true;
                btn.style.display = 'none';
                if (formatSelector) formatSelector.disabled = true;
                if (rateLimitInput) rateLimitInput.disabled = true;
                if (hiddenFileInput) hiddenFileInput.disabled = true;
                if (customFileBtn) customFileBtn.disabled = true;
                if (progress) progress.style.display = 'block';
                if (controlsContainer) controlsContainer.style.display = 'block';
                
                const statusText = this.loadedFile ? 'Запуск обновления...' : 'Запуск скачивания...';
                if (status) status.textContent = statusText;

                const format = formatSelector?.value || 'fb2';

                const result = await this.downloadManager.startDownload({
                    slug: this.currentSlug,
                    serviceKey: this.currentServiceKey,
                    format: format,
                    loadedFile: this.loadedFile,
                    controller: {
                        isPaused: () => this.isPaused,
                        shouldStop: () => this.shouldStop,
                        stop: () => { this.shouldStop = true; },
                        waitIfPaused: async () => {
                            while (this.isPaused && !this.shouldStop) {
                                await new Promise(resolve => setTimeout(resolve, 100));
                            }
                        }
                    }
                });

                if (result.updated !== undefined) {
                    const message = result.updated 
                        ? `Файл обновлён! Добавлено глав: ${result.addedChapters}`
                        : 'Файл уже актуален!';
                    if (status) status.textContent = message;
                }

            } catch (error) {
                console.error('[PopupController] Download failed:', error);
                this.showError(error.message);
                this.resetUI();
            }
        }

        stopDownload() {
            this.shouldStop = true;
            this.isDownloading = false;
            if (this.currentDownloadId)
                this.downloadManager.stop(this.currentDownloadId);
            const status = document.getElementById('status');
            if (status) status.textContent = 'Досрочное завершение...';
        }

        updateProgress(message, percent) {
            const statusEl = document.getElementById('status');
            const progressEl = document.getElementById('progress');

            if (statusEl) statusEl.textContent = message;
            if (progressEl) progressEl.value = percent;
        }

        resetUI() {
            this.isDownloading = false;
            this.isPaused = false;
            this.shouldStop = false;
            this.loadedFile = null;
            
            const btn = document.getElementById('downloadBtn');
            const formatSelector = document.getElementById('formatSelector');
            const rateLimitInput = document.getElementById('rateLimitInput');
            const progress = document.getElementById('progress');
            const controls = document.getElementById('downloadControls');
            const hiddenFileInput = document.getElementById('fileInput');
            const customFileBtn = document.getElementById('customFileBtn');
            
            if (btn) {
                btn.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Скачать';
            }
            if (formatSelector) formatSelector.disabled = false;
            if (rateLimitInput) rateLimitInput.disabled = false;
            if (hiddenFileInput) {
                hiddenFileInput.disabled = false;
                hiddenFileInput.value = '';
            }
            if (customFileBtn) {
                customFileBtn.disabled = false;
                customFileBtn.textContent = 'Загрузить файл для обновления';
            }
            if (progress) progress.style.display = 'none';
            if (controls) controls.style.display = 'none';
            
            this.currentDownloadId = null;
        }

        showError(message) {
            const errorEl = document.getElementById('error');
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.classList.remove('hidden');
                setTimeout(() => errorEl.classList.add('hidden'), 5000);
            }
        }

        showSuccess(message) {
            const successEl = document.getElementById('success');
            if (successEl) {
                successEl.textContent = message;
                successEl.classList.remove('hidden');
                setTimeout(() => successEl.classList.add('hidden'), 5000);
            }
        }
    }

    global.PopupController = PopupController;
    console.log('[PopupController] Loaded');
})(typeof window !== 'undefined' ? window : self);