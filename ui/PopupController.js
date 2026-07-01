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
            this.currentTitle = null;
            this.authToken = null;
            this._allChapters = [];
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
            const logoInfo = document.getElementById('logoInfo');
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

            const historyBtn = document.getElementById('historyBtn');
            if (historyBtn) {
                historyBtn.addEventListener('click', () => {
                    const logoInfo = document.getElementById('logoInfo');
                    if (logoInfo) logoInfo.textContent = '';
                    global.TemplateLoader.show('history', () => global.HistoryController.init());
                });
            } else console.warn('[PopupController] historyBtn not found in shell');
        }

        _bindTitleEvents() {
            const btn = document.getElementById('downloadBtn');
            if (!btn) {
                console.error('[PopupController] downloadBtn not found in title template');
                return;
            }

            const formatSelector = document.getElementById('formatSelector');
            const rateLimitInput = document.getElementById('rateLimitInput');
            const maxSizeInput = document.getElementById('maxSizeInput');
            const hiddenFileInput = document.getElementById('fileInput');
            const customFileBtn = document.getElementById('customFileBtn');
            const status = document.getElementById('status');
            const chapterFromSelect = document.getElementById('chapterFromSelect');
            const chapterToSelect = document.getElementById('chapterToSelect');
            const progress = document.getElementById('progress');
            const controls = document.getElementById('downloadControls');
            const downloadInfoPanel = document.getElementById('downloadInfoPanel');

            if (progress) progress.style.display = 'none';
            if (controls) controls.style.display = 'none';
            if (downloadInfoPanel) downloadInfoPanel.style.display = 'none';

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
                const maxSizeInput = document.getElementById('maxSizeInput');
                if (maxSizeInput) maxSizeInput.value = maxSizeMBFromUrl;
                else console.warn('Max size input element not found');
            }

            if (rateLimitFromUrl && rateLimitInput)
                rateLimitInput.value = rateLimitFromUrl;
        }

        async _loadChaptersAndPopulateSelects(service, slug, chapterFromUrl, chapterToUrl, branchIdFromUrl = null) {
            try {
                const chaptersData = await service.fetchChaptersList(slug);
                const chapters = chaptersData.data || [];
                this._allChapters = chapters;

                const hasMultipleBranches = chapters.some(ch => ch.branches && ch.branches.length > 1);
                let activeBranchId = null;

                if (hasMultipleBranches)
                    activeBranchId = this._setupTranslatorSelector(chapters, branchIdFromUrl);
                else {
                    const translatorContainer = document.getElementById('translatorContainer');
                    if (translatorContainer) translatorContainer.style.display = 'none';
                }

                const filteredChapters = activeBranchId != null
                    ? this._getFilteredChapters(activeBranchId)
                    : chapters;

                const chaptersCount = chapters.length;

                if (filteredChapters.length > 0) {
                    const fromSelect = document.getElementById('chapterFromSelect');
                    const toSelect = document.getElementById('chapterToSelect');
                    const chapterRangeContainer = document.getElementById('chapterRangeContainer');

                    if (fromSelect && toSelect && chapterRangeContainer) {
                        this._repopulateChapterSelects(filteredChapters, fromSelect, toSelect);

                        if (chapterFromUrl !== null && chapterToUrl !== null) {
                            fromSelect.value = chapterFromUrl;
                            toSelect.value = chapterToUrl;
                            console.log(`[PopupController] Restored chapter range from URL: ${chapterFromUrl} - ${chapterToUrl}`);
                        } else
                            toSelect.selectedIndex = filteredChapters.length - 1;

                        chapterRangeContainer.style.display = 'block';
                    }
                }
                return chaptersCount;
            } catch (e) {
                console.warn('[PopupController] Failed to fetch chapters count:', e);
                return null;
            }
        }

        _setupTranslatorSelector(chapters, branchIdFromUrl) {
            const translatorContainer = document.getElementById('translatorContainer');
            const translatorSelect = document.getElementById('translatorSelect');
            if (!translatorContainer || !translatorSelect) return null;

            const branchMap = new Map();
            for (const ch of chapters) {
                if (!ch.branches) continue;
                for (const branch of ch.branches) {
                    if (!branchMap.has(branch.branch_id)) {
                        const teamName = (branch.teams && branch.teams[0] && branch.teams[0].name)
                            ? branch.teams[0].name
                            : `Перевод ${branch.branch_id}`;
                        branchMap.set(branch.branch_id, teamName);
                    }
                }
            }

            if (branchMap.size <= 1) {
                translatorContainer.style.display = 'none';
                return branchMap.size === 1 ? [...branchMap.keys()][0] : null;
            }

            translatorSelect.innerHTML = '';
            for (const [id, name] of branchMap) {
                const opt = document.createElement('option');
                opt.value = id;
                opt.textContent = name;
                translatorSelect.appendChild(opt);
            }

            const initialBranchId = branchIdFromUrl != null && branchMap.has(Number(branchIdFromUrl))
                ? Number(branchIdFromUrl)
                : [...branchMap.keys()][0];
            translatorSelect.value = initialBranchId;

            translatorSelect.onchange = () => {
                const selectedBranchId = parseInt(translatorSelect.value);
                const filtered = this._getFilteredChapters(selectedBranchId);
                const fromSelect = document.getElementById('chapterFromSelect');
                const toSelect = document.getElementById('chapterToSelect');
                if (fromSelect && toSelect) {
                    this._repopulateChapterSelects(filtered, fromSelect, toSelect);
                    toSelect.selectedIndex = filtered.length - 1;
                }
            };

            translatorContainer.style.display = 'block';
            return initialBranchId;
        }

        _getFilteredChapters(branchId) {
            return this._allChapters.filter(
                ch => ch.branches && ch.branches.some(b => b.branch_id === branchId)
            );
        }

        _repopulateChapterSelects(filteredChapters, fromSelect, toSelect) {
            fromSelect.innerHTML = '';
            toSelect.innerHTML = '';
            filteredChapters.forEach((ch, idx) => {
                const label = `Том ${ch.volume}, Глава ${ch.number}`;
                const optFrom = document.createElement('option');
                optFrom.value = idx;
                optFrom.textContent = label;
                fromSelect.appendChild(optFrom);

                const optTo = document.createElement('option');
                optTo.value = idx;
                optTo.textContent = label;
                toSelect.appendChild(optTo);
            });
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

        async _getAuthToken(serviceKey, tabId = null) {
            try {
                const cached = await browserAPI.runtime.sendMessage({ action: 'getAuthToken', serviceKey });
                if (cached && cached.token) return cached.token;
            } catch (e) {
                console.warn('[PopupController] Failed to get cached auth token:', e);
            }

            if (tabId != null && browserAPI.scripting) {
                try {
                    const results = await browserAPI.scripting.executeScript({
                        target: { tabId },
                        func: () => {
                            const RE = /^eyJ[\w\-+=/]+\.eyJ[\w\-+=/]+\.[\w\-+=/]+$/;

                            function findJwt(val) {
                                if (typeof val !== 'string' || !val) return null;
                                if (RE.test(val)) return val;
                                const bare = val.startsWith('Bearer ') ? val.slice(7) : null;
                                if (bare && RE.test(bare)) return bare;
                                try { return scanObj(JSON.parse(val)); } catch { return null; }
                            }

                            function scanObj(o) {
                                if (!o || typeof o !== 'object') return null;
                                for (const v of Object.values(o)) {
                                    const f = typeof v === 'string'
                                        ? findJwt(v)
                                        : scanObj(typeof v === 'object' && v ? v : null);
                                    if (f) return f;
                                }
                                return null;
                            }

                            for (const s of [localStorage, sessionStorage]) {
                                for (let i = 0; i < s.length; i++) {
                                    const f = findJwt(s.getItem(s.key(i)));
                                    if (f) return f;
                                }
                            }
                            return null;
                        }
                    });
                    if (results && results[0] && results[0].result) {
                        const token = results[0].result;
                        browserAPI.runtime.sendMessage({ action: 'cacheAuthToken', serviceKey, token }).catch(() => {});
                        return token;
                    }
                } catch (e) {
                    console.warn('[PopupController] Failed to extract auth token via executeScript:', e);
                }
            }

            return null;
        }

        async _applyAuthToken(serviceKey, activeTabId, service) {
            this.authToken = null;
            try {
                const token = await this._getAuthToken(serviceKey, activeTabId);
                if (token) {
                    this.authToken = token;
                    service.config.headers = { ...service.config.headers, 'Authorization': `Bearer ${token}` };
                    console.log('[PopupController] Auth token applied');
                }
            } catch (e) {
                console.warn('[PopupController] Could not get auth token:', e);
            }
        }

        async _showWrongServiceState() {
            await global.TemplateLoader.show('wrong-service');
            const logoInfo = document.getElementById('logoInfo');
            if (logoInfo) logoInfo.textContent = '';

            const siteLogo = document.getElementById('siteLogo');

            document.getElementById('openMangaLib')?.addEventListener('click', async () => {
                browserAPI.tabs.create({ url: 'https://mangalib.me' });
                this._applyServiceTheme('mangalib', siteLogo);
                await this._showNoTitleState();
            });

            document.getElementById('openRanobeLib')?.addEventListener('click', async () => {
                browserAPI.tabs.create({ url: 'https://ranobelib.me' });
                this._applyServiceTheme('ranobelib', siteLogo);
                await this._showNoTitleState();
            });

            document.getElementById('openGithub')?.addEventListener('click', () => {
                browserAPI.tabs.create({ url: 'https://github.com/ivanvit100/DownloadLib' });
            });
        }

        async _showNoTitleState() {
            await global.TemplateLoader.show('no-title');
            const logoInfo = document.getElementById('logoInfo');
            if (logoInfo) logoInfo.textContent = '';

            document.getElementById('openGithub')?.addEventListener('click', () => {
                browserAPI.tabs.create({ url: 'https://github.com/ivanvit100/DownloadLib' });
            });
        }

        async loadMetadata() {
            await Promise.resolve();
            const status = document.getElementById('status');
            const btn = document.getElementById('downloadBtn');
            const logoInfo = document.getElementById('logoInfo');
            const coverImg = document.getElementById('cover');
            const desc = document.getElementById('description');
            const releaseEl = document.getElementById('releaseDate');
            const siteLogo = document.getElementById('siteLogo');
            const customFileBtn = document.getElementById('customFileBtn');
            const hiddenFileInput = document.getElementById('fileInput');
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

            const formatSelector = document.getElementById('formatSelector');
            const rateLimitInput = document.getElementById('rateLimitInput');
            this._applyUrlParams({ formatFromUrl, maxSizeMBFromUrl, rateLimitFromUrl, formatSelector, rateLimitInput });

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

                await this._applyAuthToken(serviceKey, activeTabId, service);

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
                const chaptersCount = await this._loadChaptersAndPopulateSelects(
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
            const downloadBtn = document.getElementById('downloadBtn');
            const pauseBtn = document.getElementById('pauseBtn');
            const stopBtn = document.getElementById('stopBtn');

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

                        if (fromSelect && toSelect &&
                            chapterRangeContainer &&
                            chapterRangeContainer.style.display !== 'none')
                            urlParams += `&chapterFrom=${encodeURIComponent(fromSelect.value)}&chapterTo=${encodeURIComponent(toSelect.value)}`;
                        else console.warn(`Chapter range selectors not found or not visible when constructing URL parameters for download`);

                        const translatorSelect = document.getElementById('translatorSelect');
                        const translatorContainer = document.getElementById('translatorContainer');
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
                    const status = document.getElementById('status');
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

        _setDownloadingUIState({ btn, hiddenFileInput,
            customFileBtn, fileInputContainer, progress, controlsContainer, chapterRangeContainer, status }) {
            btn.disabled = true;
            btn.style.display = 'none';
            const formatContainer = document.getElementById('formatContainer');
            if (formatContainer) formatContainer.style.display = 'none';
            else console.warn('Format container not found when hiding during download');
            const rateLimitContainer = document.getElementById('rateLimitContainer');
            if (rateLimitContainer) rateLimitContainer.style.display = 'none';
            else console.warn('Rate limit container not found when hiding during download');
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
            const translatorContainerDl = document.getElementById('translatorContainer');
            if (translatorContainerDl) translatorContainerDl.style.display = 'none';
            else console.warn('Translator container not found when hiding during download');
            const splitModeContainer = document.getElementById('splitModeContainer');
            if (splitModeContainer) splitModeContainer.style.display = 'none';
            else console.warn('Split mode container not found when hiding during download');

            const downloadInfoPanel = document.getElementById('downloadInfoPanel');
            if (downloadInfoPanel) {
                const formatSelector = document.getElementById('formatSelector');
                const rateLimitInput = document.getElementById('rateLimitInput');
                const maxSizeInput = document.getElementById('maxSizeInput');
                const formatLabel = formatSelector
                    ? (formatSelector.options[formatSelector.selectedIndex]?.text || formatSelector.value)
                    : '';
                const rateLabel = rateLimitInput ? rateLimitInput.value : '';
                const sizeLabel = maxSizeInput ? maxSizeInput.value : '';
                downloadInfoPanel.innerHTML =
                    `<div class="info-row"><span class="info-label">Формат</span><span class="info-value">${formatLabel}</span></div>` +
                    `<div class="info-row"><span class="info-label">Запросов в минуту</span><span class="info-value">${rateLabel}</span></div>` +
                    `<div class="info-row"><span class="info-label">Макс. размер части</span><span class="info-value">${sizeLabel} МБ</span></div>`;
                downloadInfoPanel.style.display = 'block';
            }

            const statusText = this.loadedFile ? 'Запуск обновления...' : 'Запуск скачивания...';
            if (status) status.textContent = statusText;
            else console.warn('Status element not found when setting initial status for download start');
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
                const { chapterRange, branchId, historyParams } = await this._prepareDownload({
                    fromSelect, toSelect, chapterRangeContainer, rateLimitInput
                });

                this.isDownloading = true;
                this.isPaused = false;
                this.shouldStop = false;

                this._setDownloadingUIState({
                    btn, hiddenFileInput,
                    customFileBtn, fileInputContainer, progress, controlsContainer, chapterRangeContainer, status
                });

                const format = formatSelector?.value || 'fb2';
                const maxSizeMB = parseInt(document.getElementById('maxSizeInput')?.value) || 200;

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

            const translatorSelect = document.getElementById('translatorSelect');
            const translatorContainer = document.getElementById('translatorContainer');
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
            const progress = document.getElementById('progress');
            const controls = document.getElementById('downloadControls');
            const hiddenFileInput = document.getElementById('fileInput');
            const customFileBtn = document.getElementById('customFileBtn');

            if (btn) {
                btn.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Скачать';
            } else console.warn('Download button not found when resetting UI');
            const formatContainer = document.getElementById('formatContainer');
            if (formatContainer) formatContainer.style.display = '';
            else console.warn('Format container not found when resetting UI');
            const rateLimitContainer = document.getElementById('rateLimitContainer');
            if (rateLimitContainer) rateLimitContainer.style.display = '';
            else console.warn('Rate limit container not found when resetting UI');
            const downloadInfoPanel = document.getElementById('downloadInfoPanel');
            if (downloadInfoPanel) downloadInfoPanel.style.display = 'none';
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

            const fileInputContainer = document.getElementById('fileInputContainer');
            if (fileInputContainer) fileInputContainer.style.display = 'block';
            else console.warn('File input container not found when resetting UI');

            const chapterRangeContainer = document.getElementById('chapterRangeContainer');
            const fromSelectReset = document.getElementById('chapterFromSelect');
            if (chapterRangeContainer) {
                chapterRangeContainer.style.display =
                    (fromSelectReset && fromSelectReset.options.length > 0) ? 'block' : 'none';
            } else console.warn('Chapter range container not found when resetting UI');
            const translatorContainerReset = document.getElementById('translatorContainer');
            const translatorSelectReset = document.getElementById('translatorSelect');
            if (translatorContainerReset) {
                translatorContainerReset.style.display =
                    (translatorSelectReset && translatorSelectReset.options.length > 1) ? 'block' : 'none';
            } else console.warn('Translator container not found when resetting UI');
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

            const downloadBtn = document.getElementById('downloadBtn');
            if (downloadBtn && downloadBtn.parentNode)
                downloadBtn.parentNode.insertBefore(warning, downloadBtn);
        }
    }

    global.PopupController = PopupController;
    console.log('[PopupController] Loaded');
})(typeof window !== 'undefined' ? window : self);
