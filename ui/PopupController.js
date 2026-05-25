/**
 * DownloadLib ui module
 * Module to manage the user interface for manga downloads
 * @module ui/PopupController
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[PopupController] Loading...');

    const browserAPI = typeof global.getExtensionApi === 'function'
        ? global.getExtensionApi()
        : ((typeof global.browser !== 'undefined' && global.browser) || (typeof global.chrome !== 'undefined' && global.chrome) || null);

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

            if (!btn) {
                console.error('downloadBtn not found in DOM');
                return;
            }

            let releaseEl = document.getElementById('releaseDate');
            if (!releaseEl) {
                releaseEl = document.createElement('div');
                releaseEl.id = 'releaseDate';
                btn.parentNode.insertBefore(releaseEl, btn);
            }

            let formatSelector = document.getElementById('formatSelector');
            if (!formatSelector) {
                const formatContainer = document.createElement('div');
                formatContainer.id = 'formatContainer';

                formatSelector = document.createElement('select');
                formatSelector.id = 'formatSelector';

                global.ExporterRegistry.getFormats().forEach(({ value, label }) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    formatSelector.appendChild(option);
                });

                const label = document.createElement('label');
                label.textContent = 'Формат: ';
                label.htmlFor = 'formatSelector';

                formatContainer.appendChild(label);
                formatContainer.appendChild(formatSelector);
                btn.parentNode.insertBefore(formatContainer, btn);
            } else console.warn('formatSelector found in DOM');

            const FORMAT_STORAGE_KEY = 'manga_parser_selected_format';
            if (formatSelector && localStorage.getItem(FORMAT_STORAGE_KEY))
                formatSelector.value = localStorage.getItem(FORMAT_STORAGE_KEY);
            else console.log('No saved format in localStorage');

            if (browserAPI && browserAPI.storage && browserAPI.storage.local)
                browserAPI.storage.local.set({ [FORMAT_STORAGE_KEY]: formatSelector.value });

            formatSelector.addEventListener('change', () => {
                localStorage.setItem(FORMAT_STORAGE_KEY, formatSelector.value);
                if (browserAPI && browserAPI.storage && browserAPI.storage.local)
                    browserAPI.storage.local.set({ [FORMAT_STORAGE_KEY]: formatSelector.value });
            });

            let rateLimitInput = document.getElementById('rateLimitInput');
            if (!rateLimitInput) {
                const rateLimitContainer = document.createElement('div');
                rateLimitContainer.id = 'rateLimitContainer';
                
                const label = document.createElement('label');
                label.textContent = 'Запросов в минуту: ';
                
                rateLimitInput = document.createElement('input');
                rateLimitInput.id = 'rateLimitInput';
                rateLimitInput.type = 'number';
                rateLimitInput.min = '2';
                rateLimitInput.max = '200';
                rateLimitInput.step = '1';
                rateLimitInput.value = '85';
                
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
                
                const rateLimitContainer = rateLimitInput.parentNode;
                rateLimitContainer.parentNode.insertBefore(activeDownloadsInfo, rateLimitContainer.nextSibling);
            }

            let fileInputContainer = document.getElementById('fileInputContainer');
            if (!fileInputContainer) {
                fileInputContainer = document.createElement('div');
                fileInputContainer.id = 'fileInputContainer';

                const hiddenFileInput = document.createElement('input');
                hiddenFileInput.type = 'file';
                hiddenFileInput.id = 'fileInput';
                hiddenFileInput.accept = '.pdf,.epub,.fb2';

                const customFileBtn = document.createElement('button');
                customFileBtn.id = 'customFileBtn';
                customFileBtn.textContent = 'Загрузить файл для обновления';

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
                
                const pauseBtn = document.createElement('button');
                pauseBtn.id = 'pauseBtn';
                pauseBtn.textContent = 'Пауза';
                
                const backgroundBtn = document.createElement('button');
                backgroundBtn.id = 'backgroundBtn';
                backgroundBtn.textContent = 'Фоном';

                const stopBtn = document.createElement('button');
                stopBtn.id = 'stopBtn';
                stopBtn.textContent = 'Завершить';
                
                const btnRow = document.createElement('div');
                btnRow.id = 'btnRow';
                btnRow.appendChild(pauseBtn);
                btnRow.appendChild(backgroundBtn);
                
                controlsContainer.appendChild(btnRow);
                controlsContainer.appendChild(stopBtn);
                btn.parentNode.insertBefore(controlsContainer, btn.nextSibling);
            } else console.warn('downloadControls container found in DOM');

            const MAX_SIZE_KEY = 'manga_parser_max_size_mb';

            let splitModeContainer = document.getElementById('splitModeContainer');
            if (!splitModeContainer) {
                splitModeContainer = document.createElement('div');
                splitModeContainer.id = 'splitModeContainer';
                splitModeContainer.style.textAlign = 'center';
                splitModeContainer.style.marginTop = '10px';
                splitModeContainer.style.marginBottom = '5px';

                const maxSizeLabel = document.createElement('label');
                maxSizeLabel.textContent = 'Макс. размер части (МБ):';
                maxSizeLabel.htmlFor = 'maxSizeInput';

                const maxSizeInput = document.createElement('input');
                maxSizeInput.id = 'maxSizeInput';
                maxSizeInput.type = 'number';
                maxSizeInput.min = '1';
                maxSizeInput.max = '9999';
                maxSizeInput.step = '1';
                maxSizeInput.value = localStorage.getItem(MAX_SIZE_KEY) || '200';
                maxSizeInput.addEventListener('input', (e) => {
                    let val = parseInt(e.target.value);
                    if (isNaN(val) || val < 1) val = 1;
                    e.target.value = Math.floor(val);
                    localStorage.setItem(MAX_SIZE_KEY, e.target.value);
                });

                splitModeContainer.appendChild(maxSizeLabel);
                splitModeContainer.appendChild(maxSizeInput);

                const chapterRangeContainer = document.getElementById('chapterRangeContainer');
                if (chapterRangeContainer) {
                    chapterRangeContainer.parentNode.insertBefore(splitModeContainer, chapterRangeContainer.nextSibling);
                } else {
                    btn.parentNode.insertBefore(splitModeContainer, btn);
                }
            } else console.warn('splitModeContainer found in DOM');

            let chapterRangeContainer = document.getElementById('chapterRangeContainer');
            if (!chapterRangeContainer) {
                chapterRangeContainer = document.createElement('div');
                chapterRangeContainer.id = 'chapterRangeContainer';

                const chapterSelectRow = document.createElement('div');
                chapterSelectRow.id = 'chapterSelectRow';

                const chapterFromLabel = document.createElement('div');
                chapterFromLabel.id = 'chapterFromLabel';
                chapterFromLabel.textContent = 'от';

                const chapterToLabel = document.createElement('div');
                chapterToLabel.id = 'chapterToLabel';
                chapterToLabel.textContent = 'до';

                const chapterLabelsRow = document.createElement('div');
                chapterLabelsRow.id = 'chapterLabelsRow';
                chapterLabelsRow.appendChild(chapterFromLabel);
                chapterLabelsRow.appendChild(chapterToLabel);

                const chapterFromSelect = document.createElement('select');
                chapterFromSelect.id = 'chapterFromSelect';

                const chapterToSelect = document.createElement('select');
                chapterToSelect.id = 'chapterToSelect';

                chapterFromSelect.addEventListener('change', () => {
                    const fromIdx = parseInt(chapterFromSelect.value);
                    const toIdx = parseInt(chapterToSelect.value);
                    if (fromIdx > toIdx) chapterToSelect.value = chapterFromSelect.value;
                    else console.log('Chapter range selectors updated without invalid range');
                });

                chapterToSelect.addEventListener('change', () => {
                    const fromIdx = parseInt(chapterFromSelect.value);
                    const toIdx = parseInt(chapterToSelect.value);
                    if (toIdx < fromIdx) chapterFromSelect.value = chapterToSelect.value;
                    else console.log('Chapter range selectors updated without invalid range');
                });
                chapterSelectRow.appendChild(chapterFromSelect);
                chapterSelectRow.appendChild(chapterToSelect);

                chapterRangeContainer.appendChild(chapterLabelsRow);
                chapterRangeContainer.appendChild(chapterSelectRow);

                const rateLimitContainer = rateLimitInput.parentNode;
                rateLimitContainer.parentNode.insertBefore(chapterRangeContainer, rateLimitContainer.nextSibling);
            }

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
            const chapterFromUrl = urlParams.get('chapterFrom');
            const chapterToUrl = urlParams.get('chapterTo');
            const maxSizeMBFromUrl = urlParams.get('maxSizeMB');

            const formatSelector = document.getElementById('formatSelector');
            if (formatFromUrl && formatSelector) {
                formatSelector.value = formatFromUrl;
                localStorage.setItem('manga_parser_selected_format', formatFromUrl);
            }

            if (maxSizeMBFromUrl) {
                localStorage.setItem('manga_parser_max_size_mb', maxSizeMBFromUrl);
                const maxSizeInput = document.getElementById('maxSizeInput');
                if (maxSizeInput) maxSizeInput.value = maxSizeMBFromUrl;
                else console.warn('Max size input element not found');
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
                const patched = global.MangaPatcher.patch(meta);

                let chaptersCount = null;
                let chapters = [];
                try {
                    const chaptersData = await service.fetchChaptersList(slug);
                    chapters = chaptersData.data || [];
                    chaptersCount = chapters.length;
                    
                    if (chaptersCount > 0) {
                        const fromSelect = document.getElementById('chapterFromSelect');
                        const toSelect = document.getElementById('chapterToSelect');
                        const chapterRangeContainer = document.getElementById('chapterRangeContainer');
                        
                        if (fromSelect && toSelect && chapterRangeContainer) {
                            fromSelect.innerHTML = '';
                            toSelect.innerHTML = '';
                            
                            chapters.forEach((ch, idx) => {
                                const optionFrom = document.createElement('option');
                                optionFrom.value = idx;
                                optionFrom.textContent = `Том ${ch.volume}, Глава ${ch.number}`;
                                fromSelect.appendChild(optionFrom);
                                
                                const optionTo = document.createElement('option');
                                optionTo.value = idx;
                                optionTo.textContent = `Том ${ch.volume}, Глава ${ch.number}`;
                                toSelect.appendChild(optionTo);
                            });
                            
                            if (chapterFromUrl !== null && chapterToUrl !== null) {
                                fromSelect.value = chapterFromUrl;
                                toSelect.value = chapterToUrl;
                                console.log('[PopupController] Restored chapter range from URL:', chapterFromUrl, '-', chapterToUrl);
                            } else {
                                toSelect.selectedIndex = chapters.length - 1;
                            }
                            
                            chapterRangeContainer.style.display = 'block';
                        }
                    }
                } catch (e) {
                    console.warn('[PopupController] Failed to fetch chapters count:', e);
                }

                const title = patched.name || slug;
                const fullSummary = patched.summary || 'Описание отсутствует.';
                const summary = this.truncateText(fullSummary, 100);

                const cover = patched.cover || null;
                if (!cover) console.warn('No cover information found in metadata');

                if (cover) {
                    coverImg.style.display = 'block';
                    coverImg.src = cover;
                    coverImg.setAttribute('style', 'display:block; float:left; width:80px; height:auto; margin-right:10px;');
                } else {
                    coverImg.style.display = 'none';
                }

                const authors = patched.authors.filter(Boolean);

                const rating = patched.rating || null;
                if (!rating) console.warn('No age restriction label found in metadata');

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
                
                const release = patched.releaseDate || '';
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
                                        width: 350,
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
                        const fromSelect = document.getElementById('chapterFromSelect');
                        const toSelect = document.getElementById('chapterToSelect');
                        const chapterRangeContainer = document.getElementById('chapterRangeContainer');
                        
                        const format = formatSelector ? formatSelector.value : 'fb2';
                        const rateLimit = rateLimitInput ? parseInt(rateLimitInput.value) || 100 : 100;
                        
                        const maxSizeMB = document.getElementById('maxSizeInput')?.value || '200';

                        let urlParams = `?download=true&slug=${encodeURIComponent(this.currentSlug)}&service=${encodeURIComponent(this.currentServiceKey)}&format=${encodeURIComponent(format)}&rateLimit=${encodeURIComponent(rateLimit)}&maxSizeMB=${encodeURIComponent(maxSizeMB)}`;

                        if (fromSelect && toSelect && chapterRangeContainer && chapterRangeContainer.style.display !== 'none') {
                            const chapterFrom = fromSelect.value;
                            const chapterTo = toSelect.value;
                            urlParams += `&chapterFrom=${encodeURIComponent(chapterFrom)}&chapterTo=${encodeURIComponent(chapterTo)}`;
                        } else console.warn('Chapter range selectors not found or not visible when constructing URL parameters for download');
                        
                        try {
                            const win = await browserAPI.windows.create({
                                url: browserAPI.runtime.getURL('popup.html') + urlParams,
                                type: 'popup',
                                width: 350,
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
                                    else console.warn('Status element not found when updating status after moving to background');
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
            const fileInputContainer = document.getElementById('fileInputContainer');
            const chapterRangeContainer = document.getElementById('chapterRangeContainer');
            const fromSelect = document.getElementById('chapterFromSelect');
            const toSelect = document.getElementById('chapterToSelect');

            try {
                if (rateLimitInput) {
                    const limit = parseInt(rateLimitInput.value) || 100;
                    await browserAPI.runtime.sendMessage({
                        action: 'setRateLimit',
                        limit: limit
                    });
                } else console.warn('Rate limit input not found when setting rate limit');
                
                let chapterRange = null;
                if (fromSelect && toSelect && chapterRangeContainer && chapterRangeContainer.style.display !== 'none') {
                    chapterRange = {
                        from: parseInt(fromSelect.value),
                        to: parseInt(toSelect.value)
                    };
                }
                
                this.isDownloading = true;
                this.isPaused = false;
                this.shouldStop = false;
                
                btn.disabled = true;
                btn.style.display = 'none';
                if (formatSelector) formatSelector.disabled = true;
                else console.warn('Format selector not found when disabling during download');
                if (rateLimitInput) rateLimitInput.disabled = true;
                else console.warn('Rate limit input not found when disabling during download');
                if (hiddenFileInput) hiddenFileInput.disabled = true;
                else console.warn('Hidden file input not found when disabling during download');
                if (customFileBtn) customFileBtn.disabled = true;
                else console.warn('Custom file button not found when disabling during download');
                if (fileInputContainer) fileInputContainer.style.display = 'none';
                else console.warn('File input container not found when disabling during download');
                if (progress) progress.style.display = 'block';
                else console.warn('Progress element not found when showing during download');
                if (controlsContainer) controlsContainer.style.display = 'block';
                else console.warn('Controls container not found when showing during download');
                if (chapterRangeContainer) chapterRangeContainer.style.display = 'none';
                else console.warn('Chapter range container not found when hiding during download');
                const splitModeContainer = document.getElementById('splitModeContainer');
                if (splitModeContainer) splitModeContainer.style.display = 'none';
                else console.warn('Split mode container not found when hiding during download');

                const statusText = this.loadedFile ? 'Запуск обновления...' : 'Запуск скачивания...';
                if (status) status.textContent = statusText;
                else console.warn('Status element not found when setting initial status for download start');

                const format = formatSelector?.value || 'fb2';
                const maxSizeMB = parseInt(document.getElementById('maxSizeInput')?.value) || 200;

                const result = await this.downloadManager.startDownload({
                    slug: this.currentSlug,
                    serviceKey: this.currentServiceKey,
                    format: format,
                    loadedFile: this.loadedFile,
                    chapterRange: chapterRange,
                    maxSizeMB: maxSizeMB,
                    controller: {
                        isPaused: () => this.isPaused,
                        shouldStop: () => this.shouldStop,
                        stop: () => { this.shouldStop = true; },
                        waitIfPaused: async () => {
                            while (this.isPaused && !this.shouldStop)
                                await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    }
                });

                if (result.updated !== undefined) {
                    const message = result.updated 
                        ? `Файл обновлён! Добавлено глав: ${result.addedChapters}`
                        : 'Файл уже актуален!';
                    if (status) status.textContent = message;
                    else console.warn('Status element not found when showing download result message');
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
            else console.warn('Status element not found when setting status on download stop');
        }

        updateProgress(message, percent) {
            const statusEl = document.getElementById('status');
            const progressEl = document.getElementById('progress');

            if (statusEl) statusEl.textContent = message;
            else console.warn('Status element not found when updating progress status');
            if (progressEl) progressEl.value = percent;
            else console.warn('Progress element not found when updating progress percentage');
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
            } else console.warn('Download button not found when resetting UI');
            if (formatSelector) formatSelector.disabled = false;
            else console.warn('Format selector not found when resetting UI');
            if (rateLimitInput) rateLimitInput.disabled = false;
            else console.warn('Rate limit input not found when resetting UI');
            if (hiddenFileInput) {
                hiddenFileInput.disabled = false;
                hiddenFileInput.value = '';
            } else console.warn('Hidden file input not found when resetting UI');
            if (customFileBtn) {
                customFileBtn.disabled = false;
                customFileBtn.textContent = 'Загрузить файл для обновления';
            } else console.warn('Custom file button not found when resetting UI');
            if (progress) progress.style.display = 'none';
            else console.warn('Progress element not found when resetting UI');
            if (controls) controls.style.display = 'none';
            else console.warn('Controls container not found when resetting UI');
            
            const chapterRangeContainer = document.getElementById('chapterRangeContainer');
            if (chapterRangeContainer) chapterRangeContainer.style.display = 'none';
            else console.warn('Chapter range container not found when resetting UI');
            const splitModeContainer = document.getElementById('splitModeContainer');
            if (splitModeContainer) splitModeContainer.style.display = 'block';
            else console.warn('Split mode container not found when resetting UI');

            this.currentDownloadId = null;
        }

        showError(message) {
            const errorEl = document.getElementById('error');
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.classList.remove('hidden');
                setTimeout(() => errorEl.classList.add('hidden'), 5000);
            } else console.warn('Error element not found when showing error message');
        }

        showSuccess(message) {
            const successEl = document.getElementById('success');
            if (successEl) {
                successEl.textContent = message;
                successEl.classList.remove('hidden');
                setTimeout(() => successEl.classList.add('hidden'), 5000);
            } else console.warn('Success element not found when showing success message');
        }
    }

    global.PopupController = PopupController;
    console.log('[PopupController] Loaded');
})(typeof window !== 'undefined' ? window : self);
