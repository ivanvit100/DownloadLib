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
            this.authToken = null;
            this._allChapters = [];
            this.setupUI();
            this.setupEventListeners();
            this.subscribeToEvents();
            this.loadMetadata();

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

                const stopBtn = document.createElement('button');
                stopBtn.id = 'stopBtn';
                stopBtn.textContent = 'Завершить';

                const btnRow = document.createElement('div');
                btnRow.id = 'btnRow';
                btnRow.appendChild(pauseBtn);

                controlsContainer.appendChild(btnRow);
                controlsContainer.appendChild(stopBtn);
                btn.parentNode.insertBefore(controlsContainer, btn.nextSibling);
            } else console.warn('downloadControls container found in DOM');

            const MAX_SIZE_KEY = 'manga_parser_max_size_mb';

            let splitModeContainer = document.getElementById('splitModeContainer');
            if (!splitModeContainer) {
                splitModeContainer = document.createElement('div');
                splitModeContainer.id = 'splitModeContainer';

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
                if (chapterRangeContainer)
                    chapterRangeContainer.parentNode.insertBefore(splitModeContainer,chapterRangeContainer.nextSibling);
                else
                    btn.parentNode.insertBefore(splitModeContainer, btn);
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

            let translatorContainer = document.getElementById('translatorContainer');
            if (!translatorContainer) {
                translatorContainer = document.createElement('div');
                translatorContainer.id = 'translatorContainer';
                translatorContainer.style.display = 'none';

                const translatorLabel = document.createElement('label');
                translatorLabel.textContent = 'Перевод:';
                translatorLabel.htmlFor = 'translatorSelect';

                const translatorSelect = document.createElement('select');
                translatorSelect.id = 'translatorSelect';

                translatorContainer.appendChild(translatorLabel);
                translatorContainer.appendChild(translatorSelect);

                chapterRangeContainer.parentNode.insertBefore(translatorContainer, chapterRangeContainer);
            } else console.warn('translatorContainer found in DOM');

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

        async openInNewContext(url) {
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

        _showEmptyState({ logoInfo, coverImg, desc, releaseEl, btn, status }, descText, context) {
            logoInfo.textContent = '';
            if (coverImg) coverImg.style.display = 'none';
            else console.warn(`Cover image element not found when showing ${context}`);
            console.warn(`Description element found when showing ${context}`);
            if (desc) desc.textContent = descText;
            console.warn(`Release date element found when showing ${context}`);
            if (releaseEl) releaseEl.textContent = '';
            btn.disabled = true;
            if (status) status.textContent = '';
            else console.warn(`Status element not found when showing ${context}`);
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
            else console.warn('No rating information found in metadata');

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
                        this._showEmptyState(uiElements,
                            'Сперва откройте один из сайтов проекта MangaLib', 'no service error');
                        return;
                    }

                    serviceKey = service.name;
                }

                await this._applyAuthToken(serviceKey, activeTabId, service);

                this._applyServiceTheme(serviceKey, siteLogo);

                if (!slug) {
                    this._showEmptyState(uiElements, 'Сперва откройте соответствующий тайтл', 'no slug error');
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
                                else console.warn(`Status element not found when prompting for file selection in separate window`);
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
                            chapterRangeContainer.style.display !== 'none') {
                            const chapterFrom = fromSelect.value;
                            const chapterTo = toSelect.value;
                            urlParams += `&chapterFrom=${encodeURIComponent(chapterFrom)}&chapterTo=${encodeURIComponent(chapterTo)}`;
                        } else console.warn(`Chapter range selectors not found or not visible when constructing URL parameters for download`);

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

        _setDownloadingUIState({ btn, formatSelector, rateLimitInput, hiddenFileInput,
            customFileBtn, fileInputContainer, progress, controlsContainer, chapterRangeContainer, status }) {
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
            const translatorContainerDl = document.getElementById('translatorContainer');
            if (translatorContainerDl) translatorContainerDl.style.display = 'none';
            else console.warn('Translator container not found when hiding during download');
            const splitModeContainer = document.getElementById('splitModeContainer');
            if (splitModeContainer) splitModeContainer.style.display = 'none';
            else console.warn('Split mode container not found when hiding during download');
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
                if (rateLimitInput) {
                    const limit = parseInt(rateLimitInput.value) || 100;
                    await browserAPI.runtime.sendMessage({ action: 'setRateLimit', limit });
                } else console.warn('Rate limit input not found when setting rate limit');

                const chapterRange = this._buildChapterRange(fromSelect, toSelect, chapterRangeContainer);

                const translatorSelect = document.getElementById('translatorSelect');
                const translatorContainer = document.getElementById('translatorContainer');
                const branchId = (translatorSelect && translatorContainer &&
                    translatorContainer.style.display !== 'none')
                    ? parseInt(translatorSelect.value)
                    : null;

                this.isDownloading = true;
                this.isPaused = false;
                this.shouldStop = false;

                this._setDownloadingUIState({
                    btn, formatSelector, rateLimitInput, hiddenFileInput,
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
            const translatorContainerReset = document.getElementById('translatorContainer');
            if (translatorContainerReset) translatorContainerReset.style.display = 'none';
            else console.warn('Translator container not found when resetting UI');
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
