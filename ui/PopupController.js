/**
 * DownloadLib ui module
 * Module to manage the user interface for manga downloads
 * @module ui/PopupController
 * @license MIT
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function(global) {
    console.log('[PopupController] Loading...');

    const browserAPI = typeof global.getExtensionApi === 'function'
        ? global.getExtensionApi()
        : ((typeof global.browser !== 'undefined' && global.browser) ||
            (typeof global.chrome !== 'undefined' && global.chrome) ||
            null);

    if (!browserAPI) {
        console.error('[PopupController] No browser API available');
        return;
    }

    function $el(id) {
        return document.getElementById(id);
    }

    class PopupController {
        constructor() {
            console.log('[PopupController] Initializing...');
            this.downloadManager = new global.DownloadManager();
            this.chapterController = new global.ChapterController();
            this.currentDownloadId = null;
            this.isDownloading = false;
            this.isPaused = false;
            this.shouldStop = false;
            this.loadedFile = null;
            this.currentSlug = null;
            this.currentServiceKey = null;
            this.currentTitle = null;
            this.authToken = null;
            this._shellEventsBound = false;

            this.downloadManager.eventBus.on('download:started', (state) => {
                this.currentDownloadId = state.id;
                console.log('[PopupController] Download started with ID:', this.currentDownloadId);
            });

            this.subscribeToEvents();
            this._init();

            console.log('[PopupController] Initialized');
        }

        async _init() {
            global.TemplateLoader.init('view');
            this._bindShellEvents();
            await global.TemplateLoader.show('title');
            this._bindTitleEvents();
            this.setupEventListeners();
            await this.loadMetadata();
            this.checkApiHealth();
        }

        async _restoreMainView() {
            const logoInfo = $el('logoInfo');
            if (logoInfo) logoInfo.textContent = '';
            await global.TemplateLoader.show('title');
            this._bindTitleEvents();
            this.setupEventListeners();
            await this.loadMetadata();
            this.checkApiHealth();
        }

        _bindShellEvents() {
            if (this._shellEventsBound) return;
            this._shellEventsBound = true;

            const historyBtn = $el('historyBtn');
            if (historyBtn) {
                historyBtn.addEventListener('click', () => {
                    const logoInfo = $el('logoInfo');
                    if (logoInfo) logoInfo.textContent = '';
                    global.TemplateLoader.show('history', () => global.HistoryController.init());
                });
            } else console.warn('[PopupController] historyBtn not found in shell');
        }

        _bindTitleEvents() {
            const btn = $el('downloadBtn');
            if (!btn) {
                console.error('[PopupController] downloadBtn not found in title template');
                return;
            }

            const formatSelector = $el('formatSelector');
            const rateLimitInput = $el('rateLimitInput');
            const maxSizeInput = $el('maxSizeInput');
            const hiddenFileInput = $el('fileInput');
            const customFileBtn = $el('customFileBtn');
            const status = $el('status');
            const chapterFromSelect = $el('chapterFromSelect');
            const chapterToSelect = $el('chapterToSelect');

            this._setVisibility('progress', 'none');
            this._setVisibility('downloadControls', 'none');
            this._setVisibility('downloadInfoPanel', 'none');

            if (formatSelector) {
                const FORMAT_STORAGE_KEY = 'manga_parser_selected_format';

                global.ExporterRegistry.getFormats().forEach(({ value, label }) => {
                    const option = document.createElement('option');
                    option.value = value;
                    option.textContent = label;
                    formatSelector.appendChild(option);
                });

                if (localStorage.getItem(FORMAT_STORAGE_KEY))
                    formatSelector.value = localStorage.getItem(FORMAT_STORAGE_KEY);
                else console.log('[PopupController] No saved format in localStorage');

                if (browserAPI?.storage?.local)
                    browserAPI.storage.local.set({ [FORMAT_STORAGE_KEY]: formatSelector.value });

                formatSelector.addEventListener('change', () => {
                    localStorage.setItem(FORMAT_STORAGE_KEY, formatSelector.value);
                    if (browserAPI?.storage?.local)
                        browserAPI.storage.local.set({ [FORMAT_STORAGE_KEY]: formatSelector.value });
                });
            }

            if (rateLimitInput) {
                rateLimitInput.addEventListener('input', (e) => {
                    let val = parseInt(e.target.value);
                    if (isNaN(val) || val < 2) val = 2;
                    if (val > 200) val = 200;
                    e.target.value = Math.floor(val);
                });
            }

            const MAX_SIZE_KEY = 'manga_parser_max_size_mb';
            if (maxSizeInput) {
                maxSizeInput.value = localStorage.getItem(MAX_SIZE_KEY) || '200';
                maxSizeInput.addEventListener('input', (e) => {
                    let val = parseInt(e.target.value);
                    if (isNaN(val) || val < 1) val = 1;
                    e.target.value = Math.floor(val);
                    localStorage.setItem(MAX_SIZE_KEY, e.target.value);
                });
            }

            if (hiddenFileInput && customFileBtn && formatSelector) {
                hiddenFileInput.addEventListener('change', (e) => {
                    e.stopPropagation();
                    const file = hiddenFileInput.files && hiddenFileInput.files[0];
                    this.loadedFile = null;

                    if (!file) {
                        formatSelector.disabled = false;
                        if (status) status.textContent = '';
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
                        customFileBtn.textContent = 'Загрузить файл для обновления';
                        hiddenFileInput.value = '';
                        this.loadedFile = null;
                        btn.textContent = 'Скачать';
                    }
                });
            }

            if (chapterFromSelect && chapterToSelect) {
                chapterFromSelect.addEventListener('change', () => {
                    if (parseInt(chapterFromSelect.value) > parseInt(chapterToSelect.value))
                        chapterToSelect.value = chapterFromSelect.value;
                    else console.log('[PopupController] Chapter range selectors updated without invalid range');
                });
                chapterToSelect.addEventListener('change', () => {
                    if (parseInt(chapterToSelect.value) < parseInt(chapterFromSelect.value))
                        chapterFromSelect.value = chapterToSelect.value;
                    else console.log('[PopupController] Chapter range selectors updated without invalid range');
                });
            }

            console.log('[PopupController] Title events bound');
        }

        _setVisibility(id, display) {
            const el = $el(id);
            if (el) el.style.display = display;
        }

        _getDownloadElements() {
            return {
                btn: $el('downloadBtn'),
                formatSelector: $el('formatSelector'),
                rateLimitInput: $el('rateLimitInput'),
                status: $el('status'),
                progress: $el('progress'),
                controls: $el('downloadControls'),
                hiddenFileInput: $el('fileInput'),
                customFileBtn: $el('customFileBtn'),
                fileInputContainer: $el('fileInputContainer'),
                chapterRangeContainer: $el('chapterRangeContainer'),
                fromSelect: $el('chapterFromSelect'),
                toSelect: $el('chapterToSelect')
            };
        }

        async isInSeparateWindow() {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.has('download') || urlParams.has('fileUpload')) return true;
                const currentWindow = await browserAPI.windows.getCurrent();
                console.log('[PopupController] Window type:', currentWindow.type);
                return currentWindow.type === 'popup';
            } catch (e) {
                console.warn('Failed to detect window type:', e);
                return false;
            }
        }

        async openInNewContext(url) {
            const isFirefox = typeof global.browser !== 'undefined' && !!global.browser;
            if (!isFirefox) {
                browserAPI.runtime.sendMessage({ action: 'openWindowWithUrl', url }).catch(() => {});
                return;
            }
            if (browserAPI.windows) {
                const win = await browserAPI.windows.create({
                    url,
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
            }
            else if (browserAPI.tabs) {
                const tab = await browserAPI.tabs.create({ url, active: true });
                if (!tab) console.warn('Tab created but no ID found:', tab);
            }
            else console.error('No window/tab API available');
        }

        _applyServiceTheme(serviceKey, siteLogo) {
            const isRanobeLib = serviceKey === 'ranobelib';
            document.body.style.setProperty('--primary-color', isRanobeLib ? '#2196f3' : '#ff9100');
            document.body.style.setProperty('--secondary-color', isRanobeLib ? '#1f82d3ff' : '#c77101');
            if (siteLogo) siteLogo.src = isRanobeLib ? 'icons/logo3.png' : 'icons/logo1.png';
            else console.warn('Site logo element not found when setting logo for service:', serviceKey);
        }

        _applyUrlParams({ formatFromUrl, maxSizeMBFromUrl, rateLimitFromUrl, formatSelector, rateLimitInput }) {
            if (formatFromUrl && formatSelector) {
                formatSelector.value = formatFromUrl;
                localStorage.setItem('manga_parser_selected_format', formatFromUrl);
            }

            if (maxSizeMBFromUrl) {
                localStorage.setItem('manga_parser_max_size_mb', maxSizeMBFromUrl);
                const maxSizeInput = $el('maxSizeInput');
                if (maxSizeInput) maxSizeInput.value = maxSizeMBFromUrl;
                else console.warn('Max size input element not found');
            }

            if (rateLimitFromUrl && rateLimitInput)
                rateLimitInput.value = rateLimitFromUrl;
        }

        _renderMeta({ patched, chaptersCount, slug, coverImg, desc, releaseEl, logoInfo }) {
            const title = patched.name || slug;
            this.currentTitle = title;
            const summary = this.truncateText(patched.summary || 'Описание отсутствует.', 100);
            const cover = patched.cover || null;
            if (!cover) console.warn('No cover information found in metadata');

            if (cover) {
                coverImg.style.display = 'block';
                coverImg.src = cover;
            } else
                coverImg.style.display = 'none';

            const authors = patched.authors.filter(Boolean);
            const rating = patched.rating || null;
            if (!rating) console.warn('No age restriction label found in metadata');

            const firstLineParts = [];
            if (chaptersCount !== null) firstLineParts.push(`Глав: ${chaptersCount}`);
            if (rating) firstLineParts.push(`Рейтинг: ${rating}`);

            const secondLine = (authors && authors.length) ? `Авторы: ${authors.join(', ')}` : '';
            const logoText = secondLine
                ? `${firstLineParts.join(' · ')}\n${secondLine}`
                : firstLineParts.join(' · ');
            logoInfo.textContent = logoText;

            desc.innerHTML = `<strong>${title}</strong><br><small>${summary}</small>`;

            const release = patched.releaseDate || '';
            if (releaseEl) releaseEl.textContent = release ? `Дата выхода: ${release}` : '';
            else console.warn('Release date element not found when setting release date:', release);
        }

        _setReadyState({ btn, status, fileUploadMode, hiddenFileInput }) {
            btn.disabled = false;
            if (status) status.textContent = 'Нажмите "Скачать" для загрузки книги';
            else console.warn('Status element not found when setting ready to download message');
            if (fileUploadMode && hiddenFileInput) {
                if (status) status.textContent = 'Выберите файл для обновления';
                else console.warn('Status element not found when prompting for file selection in file upload mode');
                setTimeout(() => hiddenFileInput.click(), 300);
            }
        }

        _handleLoadError(error, { desc, status, btn }) {
            console.error('[PopupController] Failed to load metadata:', error);
            if (desc) desc.textContent = `Ошибка: ${error.message}`;
            if (status) status.textContent = '';
            if (btn) btn.disabled = true;
        }

        async _showWrongServiceState() {
            await global.TemplateLoader.show('wrong-service');
            const logoInfo = $el('logoInfo');
            if (logoInfo) logoInfo.textContent = '';

            const siteLogo = $el('siteLogo');

            $el('openMangaLib')?.addEventListener('click', async () => {
                browserAPI.tabs.create({ url: 'https://mangalib.me' });
                this._applyServiceTheme('mangalib', siteLogo);
                await this._showNoTitleState();
            });

            $el('openRanobeLib')?.addEventListener('click', async () => {
                browserAPI.tabs.create({ url: 'https://ranobelib.me' });
                this._applyServiceTheme('ranobelib', siteLogo);
                await this._showNoTitleState();
            });

            $el('openGithub')?.addEventListener('click', () => {
                browserAPI.tabs.create({ url: 'https://github.com/ivanvit100/DownloadLib' });
            });
        }

        async _showNoTitleState() {
            await global.TemplateLoader.show('no-title');
            const logoInfo = $el('logoInfo');
            if (logoInfo) logoInfo.textContent = '';

            $el('openGithub')?.addEventListener('click', () => {
                browserAPI.tabs.create({ url: 'https://github.com/ivanvit100/DownloadLib' });
            });
        }

        async loadMetadata() {
            await Promise.resolve();
            const status = $el('status');
            const btn = $el('downloadBtn');
            const logoInfo = $el('logoInfo');
            const coverImg = $el('cover');
            const desc = $el('description');
            const releaseEl = $el('releaseDate');
            const siteLogo = $el('siteLogo');
            const customFileBtn = $el('customFileBtn');
            const hiddenFileInput = $el('fileInput');
            const uiElements = { logoInfo, coverImg, desc, releaseEl, btn, status };

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
            const branchIdFromUrl = urlParams.get('branchId')
                ? parseInt(urlParams.get('branchId'))
                : null;

            this._applyUrlParams({
                formatFromUrl, maxSizeMBFromUrl, rateLimitFromUrl,
                formatSelector: $el('formatSelector'),
                rateLimitInput: $el('rateLimitInput')
            });

            if (btn) btn.disabled = true;
            if (status) status.textContent = 'Получаем информацию...';

            try {
                let currentUrl, slug, serviceKey, service;
                let activeTabId = null;

                if ((autoDownload || fileUploadMode) && slugFromUrl && serviceFromUrl) {
                    slug = slugFromUrl;
                    serviceKey = serviceFromUrl;

                    if (serviceKey === 'ranobelib')
                        service = new global.RanobeLibService();
                    else if (serviceKey === 'mangalib')
                        service = new global.MangaLibService();
                    else throw new Error(`Unknown service: ${serviceKey}`);
                } else {
                    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
                    if (!tabs || !tabs[0]) throw new Error('No active tab found');
                    currentUrl = tabs[0].url;
                    activeTabId = tabs[0].id;
                    console.log('[PopupController] Current URL:', currentUrl);

                    const match = currentUrl.match(/\/(?:manga|book)\/([^/?]+)/);
                    slug = match ? match[1] : null;

                    service = global.serviceRegistry.getServiceByUrl(currentUrl);
                    if (!service) {
                        await this._showWrongServiceState();
                        return;
                    }

                    serviceKey = service.name;
                }

                this.authToken = await global.AuthManager.apply(serviceKey, activeTabId, service);

                this._applyServiceTheme(serviceKey, siteLogo);

                if (!slug) {
                    await this._showNoTitleState();
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
                const chaptersCount = await this.chapterController.loadAndPopulate(
                    service, slug, chapterFromUrl, chapterToUrl, branchIdFromUrl
                );

                this._renderMeta({ patched, chaptersCount, slug, coverImg, desc, releaseEl, logoInfo });
                this._setReadyState({ btn, status, fileUploadMode, hiddenFileInput });

                if (customFileBtn) {
                    customFileBtn.onclick = async () => {
                        try {
                            const inSeparateWindow = await this.isInSeparateWindow();
                            console.log(`[PopupController] In separate window: ${inSeparateWindow}`);

                            if (inSeparateWindow) {
                                if (status) status.textContent = 'Выберите файл для обновления';
                                hiddenFileInput.click();
                            } else {
                                const formatSelector = $el('formatSelector');
                                const rateLimitInput = $el('rateLimitInput');
                                const format = formatSelector ? formatSelector.value : 'fb2';
                                const rateLimit = rateLimitInput ? parseInt(rateLimitInput.value) || 100 : 100;

                                try {
                                    const fileUploadParams = new URLSearchParams({
                                        fileUpload: 'true', slug, service: serviceKey, format, rateLimit
                                    });
                                    const fileUploadUrl = `${browserAPI.runtime.getURL('popup.html')}?${fileUploadParams}`;
                                    await this.openInNewContext(fileUploadUrl);
                                } catch (createError) {
                                    console.error('Failed to create window:', createError);
                                    if (status) status.textContent = 'Не удалось открыть окно, используем текущее';
                                    hiddenFileInput.click();
                                }
                            }
                        } catch (e) {
                            console.error('Failed to handle file upload:', e);
                            if (status) status.textContent = 'Выберите файл для обновления';
                            hiddenFileInput.click();
                        }
                    };
                } else console.warn('[PopupController] customFileBtn not found');

                if (autoDownload) setTimeout(() => this.startDownload(), 500);
            } catch (error) {
                this._handleLoadError(error, uiElements);
            }
        }

        truncateText(text, maxLength = 128) {
            if (!text) return text;
            const str = String(text).trim();
            if (str.length <= maxLength) return str;
            return `${str.substring(0, maxLength)}...`;
        }

        setupEventListeners() {
            const downloadBtn = $el('downloadBtn');
            const pauseBtn = $el('pauseBtn');
            const stopBtn = $el('stopBtn');

            if (downloadBtn) {
                downloadBtn.addEventListener('click', async () => {
                    const inSeparateWindow = await this.isInSeparateWindow();

                    if (!this.loadedFile && !inSeparateWindow) {
                        const formatSelector = $el('formatSelector');
                        const rateLimitInput = $el('rateLimitInput');
                        const fromSelect = $el('chapterFromSelect');
                        const toSelect = $el('chapterToSelect');
                        const chapterRangeContainer = $el('chapterRangeContainer');

                        const format = formatSelector ? formatSelector.value : 'fb2';
                        const rateLimit = rateLimitInput ? parseInt(rateLimitInput.value) || 100 : 100;
                        const maxSizeMB = $el('maxSizeInput')?.value || '200';

                        let urlParams = `?download=true&slug=${encodeURIComponent(this.currentSlug)}&service=${encodeURIComponent(this.currentServiceKey)}&format=${encodeURIComponent(format)}&rateLimit=${encodeURIComponent(rateLimit)}&maxSizeMB=${encodeURIComponent(maxSizeMB)}`;

                        if (fromSelect && toSelect &&
                            chapterRangeContainer &&
                            chapterRangeContainer.style.display !== 'none')
                            urlParams += `&chapterFrom=${encodeURIComponent(fromSelect.value)}&chapterTo=${encodeURIComponent(toSelect.value)}`;
                        else console.warn(`Chapter range selectors not found or not visible when constructing URL parameters for download`);

                        const translatorSelect = $el('translatorSelect');
                        const translatorContainer = $el('translatorContainer');
                        if (translatorSelect && translatorContainer &&
                            translatorContainer.style.display !== 'none')
                            urlParams += `&branchId=${encodeURIComponent(translatorSelect.value)}`;

                        try {
                            await this.openInNewContext(browserAPI.runtime.getURL('popup.html') + urlParams);
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
                    const status = $el('status');
                    if (status) status.textContent = this.isPaused ? 'Пауза...' : 'Загрузка...';
                    else console.warn('Status element not found when updating status on pause/resume');
                });
            }

            if (stopBtn) stopBtn.addEventListener('click', () => this.stopDownload());
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

        _buildChapterRange(fromSelect, toSelect, container) {
            if (fromSelect && toSelect && container && container.style.display !== 'none')
                return { from: parseInt(fromSelect.value), to: parseInt(toSelect.value) };
            return null;
        }

        _setDownloadingUIState({ btn, hiddenFileInput, customFileBtn,
            fileInputContainer, progress, controls, chapterRangeContainer, status }) {
            btn.disabled = true;
            btn.style.display = 'none';
            this._setVisibility('formatContainer', 'none');
            this._setVisibility('rateLimitContainer', 'none');
            this._setVisibility('translatorContainer', 'none');
            this._setVisibility('splitModeContainer', 'none');
            if (hiddenFileInput) hiddenFileInput.disabled = true;
            if (customFileBtn) customFileBtn.disabled = true;
            if (fileInputContainer) fileInputContainer.style.display = 'none';
            if (progress) progress.style.display = 'block';
            if (controls) controls.style.display = 'block';
            if (chapterRangeContainer) chapterRangeContainer.style.display = 'none';

            const downloadInfoPanel = $el('downloadInfoPanel');
            if (downloadInfoPanel) {
                const formatSelector = $el('formatSelector');
                const rateLimitInput = $el('rateLimitInput');
                const maxSizeInput = $el('maxSizeInput');
                const formatLabel = formatSelector
                    ? (formatSelector.options[formatSelector.selectedIndex]?.text || formatSelector.value)
                    : '';
                downloadInfoPanel.innerHTML =
                    `<div class="info-row"><span class="info-label">Формат</span><span class="info-value">${formatLabel}</span></div>` +
                    `<div class="info-row"><span class="info-label">Запросов в минуту</span><span class="info-value">${rateLimitInput ? rateLimitInput.value : ''}</span></div>` +
                    `<div class="info-row"><span class="info-label">Макс. размер части</span><span class="info-value">${maxSizeInput ? maxSizeInput.value : ''} МБ</span></div>`;
                downloadInfoPanel.style.display = 'block';
            }

            const statusText = this.loadedFile ? 'Запуск обновления...' : 'Запуск скачивания...';
            if (status) status.textContent = statusText;
        }

        _handleDownloadResult(result, status) {
            if (!('updated' in result)) return;
            const message = result.updated
                ? `Файл обновлён! Добавлено глав: ${result.addedChapters}`
                : 'Файл уже актуален!';
            if (status) status.textContent = message;
            else console.warn('Status element not found when showing download result message');
        }

        async startDownload() {
            if (!this.currentSlug || !this.currentServiceKey) {
                this.showError('Не удалось определить тайтл');
                return;
            }

            const { btn, formatSelector, rateLimitInput, status, progress,
                controls, hiddenFileInput, customFileBtn, fileInputContainer,
                chapterRangeContainer, fromSelect, toSelect } = this._getDownloadElements();

            try {
                const { chapterRange, branchId, historyParams } = await this._prepareDownload({
                    fromSelect, toSelect, chapterRangeContainer, rateLimitInput
                });

                this.isDownloading = true;
                this.isPaused = false;
                this.shouldStop = false;

                this._setDownloadingUIState({
                    btn, hiddenFileInput, customFileBtn, fileInputContainer,
                    progress, controls, chapterRangeContainer, status
                });

                const format = formatSelector?.value || 'fb2';
                const maxSizeMB = parseInt($el('maxSizeInput')?.value) || 200;

                const result = await this.downloadManager.startDownload({
                    slug: this.currentSlug,
                    serviceKey: this.currentServiceKey,
                    format,
                    loadedFile: this.loadedFile,
                    chapterRange,
                    branchId,
                    maxSizeMB,
                    authToken: this.authToken,
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

                this._handleDownloadResult(result, status);
                global.DownloadHistory.add({
                    service: this.currentServiceKey,
                    slug: this.currentSlug,
                    title: this.currentTitle || this.currentSlug,
                    format,
                    ...historyParams
                });
            } catch (error) {
                console.error('[PopupController] Download failed:', error);
                this.showError(error.message);
                this.resetUI();
            }
        }

        _getSelectText(select) {
            if (!select || select.selectedIndex < 0) return null;
            return select.options[select.selectedIndex]?.text || null;
        }

        async _prepareDownload({ fromSelect, toSelect, chapterRangeContainer, rateLimitInput }) {
            if (rateLimitInput) {
                const limit = parseInt(rateLimitInput.value) || 100;
                await browserAPI.runtime.sendMessage({ action: 'setRateLimit', limit });
            } else console.warn('Rate limit input not found when setting rate limit');

            const chapterRange = this._buildChapterRange(fromSelect, toSelect, chapterRangeContainer);

            const translatorSelect = $el('translatorSelect');
            const translatorContainer = $el('translatorContainer');
            const translatorVisible = !!(translatorSelect && translatorContainer &&
                translatorContainer.style.display !== 'none');
            const branchId = translatorVisible ? parseInt(translatorSelect.value) : null;

            return {
                chapterRange,
                branchId,
                historyParams: {
                    chapterFrom: this._getSelectText(fromSelect),
                    chapterTo: this._getSelectText(toSelect),
                    translator: translatorVisible ? this._getSelectText(translatorSelect) : null
                }
            };
        }

        stopDownload() {
            this.shouldStop = true;
            this.isDownloading = false;
            if (this.currentDownloadId)
                this.downloadManager.stop(this.currentDownloadId);
            const status = $el('status');
            if (status) status.textContent = 'Досрочное завершение...';
            else console.warn('Status element not found when setting status on download stop');
        }

        updateProgress(message, percent) {
            const statusEl = $el('status');
            const progressEl = $el('progress');
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
            this.currentDownloadId = null;

            const { btn, progress, controls, hiddenFileInput, customFileBtn } = this._getDownloadElements();

            if (btn) {
                btn.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Скачать';
            } else console.warn('Download button not found when resetting UI');
            this._setVisibility('formatContainer', '');
            this._setVisibility('rateLimitContainer', '');
            this._setVisibility('downloadInfoPanel', 'none');
            if (hiddenFileInput) { hiddenFileInput.disabled = false; hiddenFileInput.value = ''; }
            else console.warn('Hidden file input not found when resetting UI');
            if (customFileBtn) {
                customFileBtn.disabled = false;
                customFileBtn.textContent = 'Загрузить файл для обновления';
            } else console.warn('Custom file button not found when resetting UI');
            if (progress) progress.style.display = 'none';
            else console.warn('Progress element not found when resetting UI');
            if (controls) controls.style.display = 'none';
            else console.warn('Controls container not found when resetting UI');
            this._setVisibility('fileInputContainer', 'block');

            const chapterRangeContainer = $el('chapterRangeContainer');
            const fromSelectReset = $el('chapterFromSelect');
            if (chapterRangeContainer) {
                chapterRangeContainer.style.display =
                    (fromSelectReset && fromSelectReset.options.length > 0) ? 'block' : 'none';
            } else console.warn('Chapter range container not found when resetting UI');

            const translatorContainerReset = $el('translatorContainer');
            const translatorSelectReset = $el('translatorSelect');
            if (translatorContainerReset) {
                translatorContainerReset.style.display =
                    (translatorSelectReset && translatorSelectReset.options.length > 1) ? 'block' : 'none';
            } else console.warn('Translator container not found when resetting UI');

            this._setVisibility('splitModeContainer', 'block');
        }

        showError(message) {
            const errorEl = $el('error');
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.classList.remove('hidden');
                setTimeout(() => errorEl.classList.add('hidden'), 5000);
            } else console.warn('Error element not found when showing error message');
        }

        showSuccess(message) {
            const successEl = $el('success');
            if (successEl) {
                successEl.textContent = message;
                successEl.classList.remove('hidden');
                setTimeout(() => successEl.classList.add('hidden'), 5000);
            } else console.warn('Success element not found when showing success message');
        }

        async checkApiHealth() {
            const CACHE_KEY = 'DLoadLib_API_check';
            const CACHE_TTL = 4 * 60 * 60 * 1000;
            const BADGE_URL = 'https://github.com/ivanvit100/DownloadLib/actions/workflows/health-check.yaml/badge.svg';
            const REPO_URL = 'https://github.com/ivanvit100/DownloadLib/issues';

            try {
                const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
                const useCache = cached && (Date.now() - cached.timestamp < CACHE_TTL);

                if (!useCache) {
                    const res = await fetch(BADGE_URL, { cache: 'no-cache' });
                    const svg = await res.text();
                    const isFailing = svg.includes('failing');
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ isFailing, timestamp: Date.now() }));
                    if (isFailing) this._showApiWarning(REPO_URL);
                    return;
                }

                if (cached.isFailing) this._showApiWarning(REPO_URL);
            } catch (e) {
                console.warn('[PopupController] Health check status unavailable:', e.message);
            }
        }

        _showApiWarning(repoUrl) {
            const warning = document.createElement('div');
            warning.id = 'apiWarning';

            const msg = document.createElement('div');
            msg.id = 'apiWarningMsg';
            msg.textContent = '⚠️ Некоторые запросы к API могут не работать. ';
            warning.appendChild(msg);

            const link = document.createElement('a');
            link.id = 'apiWarningLink';
            link.textContent = 'Подробнее на GitHub →';
            link.href = '#';
            link.addEventListener('click', (e) => {
                e.preventDefault();
                browserAPI.tabs.create({ url: repoUrl });
            });
            warning.appendChild(link);

            const downloadBtn = $el('downloadBtn');
            if (downloadBtn && downloadBtn.parentNode)
                downloadBtn.parentNode.insertBefore(warning, downloadBtn);
        }
    }

    global.PopupController = PopupController;
    console.log('[PopupController] Loaded');
})(typeof window !== 'undefined' ? window : self);
