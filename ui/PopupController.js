/**
 * DownloadLib ui module
 * Module to manage the user interface for manga downloads
 * @module ui/PopupController
 * @license MIT
 * @author ivanvit
 * @version 1.0.10
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

    /**
     * Короткий алиас для document.getElementById.
     * @param {string} id - id искомого элемента.
     * @returns {?HTMLElement} Найденный элемент или null.
     */
    function $el(id) {
        return document.getElementById(id);
    }

    /**
     * Главный контроллер попапа расширения: управляет отображением метаданных
     * тайтла, запуском/паузой/остановкой загрузки, переключением между шаблонами
     * (title, settings, history) и состоянием формы скачивания.
     */
    class PopupController {
        /**
         * Создаёт менеджер загрузок и контроллер глав, инициализирует поля состояния
         * загрузки и запускает первичную настройку интерфейса.
         */
        constructor() {
            console.log('[PopupController] Initializing...');
            this.downloadManager = new global.DownloadManager();
            this.chapterController = new global.ChapterController();
            this.isDownloading = false;
            this.isPaused = false;
            this.shouldStop = false;
            this._shellEventsBound = false;
            this.currentDownloadId = null;
            this.loadedFile = null;
            this.currentSlug = null;
            this.currentServiceKey = null;
            this.currentTitle = null;
            this.authToken = null;
            this._activeTabId = null;

            const pauseBtn = $el('pauseBtn');
            const stopBtn = $el('stopBtn');
            if (pauseBtn) {
                pauseBtn.disabled = false;
                pauseBtn.textContent = 'Пауза';
            }
            if (stopBtn) stopBtn.disabled = false;

            this.downloadManager.eventBus.on('download:started', (state) => {
                this.currentDownloadId = state.id;
                console.log('[PopupController] Download started with ID:', this.currentDownloadId);
            });

            this.subscribeToEvents();
            this._init();

            console.log('[PopupController] Initialized');
        }

        /**
         * Инициализирует TemplateLoader и события оболочки, затем показывает либо
         * экран настроек (если открыт с параметром ?settings), либо главный экран
         * тайтла: загружает метаданные, проверяет здоровье API и подписывается
         * на изменение списка кастомных плагинов для обновления списка форматов.
         * @returns {Promise<void>}
         */
        async _init() {
            global.TemplateLoader.init('view');
            this._bindShellEvents();

            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('settings')) {
                await global.TemplateLoader.show('settings', () => global.SettingsController.init());
                return;
            }

            await global.TemplateLoader.show('title');
            this._bindTitleEvents();
            this.setupEventListeners();
            await this.loadMetadata();
            this.checkApiHealth();

            if (browserAPI?.storage?.onChanged) {
                browserAPI.storage.onChanged.addListener(async (changes, area) => {
                    if (area !== 'local' || !('custom_plugins' in changes)) return;
                    await global.PluginManager.loadAll();
                    const sel = $el('formatSelector');
                    if (!sel) return;
                    const current = sel.value;
                    sel.innerHTML = '';
                    global.ExporterRegistry.getFormats().forEach(({ value, label }) => {
                        const opt = document.createElement('option');
                        opt.value = value;
                        opt.textContent = label;
                        sel.appendChild(opt);
                    });
                    if (current) sel.value = current;
                });
            }
        }

        /**
         * Возвращает попап к главному экрану тайтла из истории/настроек: заново
         * показывает шаблон title, навешивает обработчики и перезагружает метаданные.
         * @returns {Promise<void>}
         */
        async _restoreMainView() {
            const logoInfo = $el('logoInfo');
            if (logoInfo) logoInfo.textContent = '';
            await global.TemplateLoader.show('title');
            this._bindTitleEvents();
            this.setupEventListeners();
            await this.loadMetadata();
            this.checkApiHealth();
        }

        /**
         * Однократно навешивает обработчики на постоянные элементы оболочки попапа
         * (кнопки истории и настроек), которые не пересоздаются при смене шаблонов.
         * @returns {void}
         */
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

            const settingsBtn = $el('settingsBtn');
            if (settingsBtn) {
                settingsBtn.addEventListener('click', async () => {
                    const url = `${browserAPI.runtime.getURL('popup.html')}?settings=true`;
                    await this.openInNewContext(url);
                });
            } else console.warn('[PopupController] settingsBtn not found in shell');
        }

        /**
         * Навешивает обработчики на элементы шаблона title: заполняет и сохраняет выбор
         * формата экспорта, чекбокс разбиения страниц, выбор кастомного файла для
         * обновления и валидацию диапазона выбора глав.
         * @returns {void}
         */
        _bindTitleEvents() {
            const btn = $el('downloadBtn');
            if (!btn) {
                console.error('[PopupController] downloadBtn not found in title template');
                return;
            }

            const formatSelector = $el('formatSelector');
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

            const SPLIT_PAGES_KEY = 'manga_parser_split_pages';
            const splitPagesCheckbox = $el('splitPagesCheckbox');
            if (splitPagesCheckbox) {
                const saved = localStorage.getItem(SPLIT_PAGES_KEY);
                splitPagesCheckbox.checked = saved !== null ? saved === 'true' : true;
                splitPagesCheckbox.addEventListener('change', () => {
                    localStorage.setItem(SPLIT_PAGES_KEY, splitPagesCheckbox.checked);
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

        /**
         * Устанавливает CSS-свойство display элемента по его id, если элемент найден.
         * @param {string} id - id элемента.
         * @param {string} display - Значение CSS display.
         * @returns {void}
         */
        _setVisibility(id, display) {
            const el = $el(id);
            if (el) el.style.display = display;
        }

        /**
         * Собирает ссылки на все DOM-элементы формы загрузки в один объект для удобной передачи.
         * @returns {object} Объект со ссылками на элементы: btn, formatSelector, status,
         * progress, controls, hiddenFileInput, customFileBtn, fileInputContainer,
         * chapterRangeContainer, fromSelect, toSelect.
         */
        _getDownloadElements() {
            return {
                btn: $el('downloadBtn'),
                formatSelector: $el('formatSelector'),
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

        /**
         * Определяет, открыт ли попап в отдельном окне (а не как выпадающий попап
         * тулбара): по параметрам URL (download/fileUpload) либо по типу текущего окна.
         * @returns {Promise<boolean>} true, если попап работает как отдельное окно.
         */
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

        /**
         * Открывает URL в новом контексте вне текущего выпадающего попапа: в Firefox —
         * создаёт отдельное окно (или вкладку, если windows API недоступен), в остальных
         * браузерах — просит background-скрипт открыть окно (обходя ограничения closable
         * попапа тулбара при клике на элементы, требующие постоянного окна).
         * @param {string} url - URL, который нужно открыть.
         * @returns {Promise<void>}
         */
        async openInNewContext(url) {
            const isFirefox = typeof global.getBrowserEnv === 'function'
                ? global.getBrowserEnv().isFirefox
                : typeof global.browser !== 'undefined' && !!global.browser;
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

        /**
         * Применяет фирменные цвета и логотип сервиса к оформлению попапа.
         * @param {string} serviceKey - Ключ сервиса.
         * @param {?HTMLImageElement} siteLogo - Элемент логотипа сервиса (может отсутствовать).
         * @returns {void}
         */
        _applyServiceTheme(serviceKey, siteLogo) {
            const cfg = global.serviceRegistry?.getService(serviceKey)?.config || {};
            document.body.style.setProperty('--primary-color', cfg.primaryColor || '#ff9100');
            document.body.style.setProperty('--secondary-color', cfg.secondaryColor || '#c77101');
            if (siteLogo) siteLogo.src = cfg.logo || 'icons/logo1.png';
            else console.warn('Site logo element not found when setting logo for service:', serviceKey);
        }

        /**
         * Применяет и сохраняет в localStorage параметры формата, максимального размера
         * части и разбиения страниц, переданные через URL попапа (используется при
         * открытии попапа из фонового скрипта с заранее заданными настройками).
         * @param {{formatFromUrl: ?string, maxSizeMBFromUrl: ?string, splitPagesFromUrl: ?string,
         * formatSelector: ?HTMLSelectElement}} params - Значения параметров из URL и элемент селектора формата.
         * @returns {void}
         */
        _applyUrlParams({ formatFromUrl, maxSizeMBFromUrl, splitPagesFromUrl, formatSelector }) {
            if (formatFromUrl && formatSelector) {
                formatSelector.value = formatFromUrl;
                localStorage.setItem('manga_parser_selected_format', formatFromUrl);
            }

            if (maxSizeMBFromUrl)
                localStorage.setItem('manga_parser_max_size_mb', maxSizeMBFromUrl);

            if (splitPagesFromUrl !== null) {
                const splitPagesCheckbox = $el('splitPagesCheckbox');
                if (splitPagesCheckbox) splitPagesCheckbox.checked = splitPagesFromUrl === 'true';
                localStorage.setItem('manga_parser_split_pages', splitPagesFromUrl);
            }
        }

        /**
         * Отрисовывает нормализованные метаданные тайтла: обложку (с догрузкой через
         * фоновый fetch), заголовок и краткое описание, сводку "глав/рейтинг/авторы"
         * и дату выхода.
         * @param {{patched: object, chaptersCount: ?number, slug: string, coverImg: HTMLImageElement,
         * desc: HTMLElement, releaseEl: ?HTMLElement, logoInfo: HTMLElement}} params - Нормализованные
         * метаданные тайтла и ссылки на DOM-элементы для отрисовки.
         * @returns {void}
         */
        _renderMeta({ patched, chaptersCount, slug, coverImg, desc, releaseEl, logoInfo }) {
            const title = patched.name || slug;
            this.currentTitle = title;
            const summary = this.truncateText(patched.summary || 'Описание отсутствует.', 100);
            const cover = patched.cover || null;
            if (!cover) console.warn('No cover information found in metadata');

            if (cover) {
                coverImg.style.display = 'block';
                coverImg.src = cover;
                this._fetchCover(cover).then(src => { coverImg.src = src; });
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

        /**
         * Переводит форму загрузки в состояние готовности: разблокирует кнопку
         * скачивания и, в режиме обновления файла, предлагает сразу выбрать файл.
         * @param {{btn: HTMLButtonElement, status: ?HTMLElement, fileUploadMode: boolean,
         * hiddenFileInput: ?HTMLInputElement}} params - Элементы формы и флаг режима обновления файла.
         * @returns {void}
         */
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

        /**
         * Отображает ошибку загрузки метаданных тайтла в блоке описания и блокирует
         * кнопку скачивания.
         * @param {Error} error - Возникшая ошибка.
         * @param {{desc: ?HTMLElement, status: ?HTMLElement, btn: ?HTMLButtonElement}} elements
         * Элементы UI, в которых нужно отразить ошибку.
         * @returns {void}
         */
        _handleLoadError(error, { desc, status, btn }) {
            console.error('[PopupController] Failed to load metadata:', error);
            if (desc) desc.textContent = `Ошибка: ${error.message}`;
            if (status) status.textContent = '';
            if (btn) btn.disabled = true;
        }

        /**
         * Показывает экран "неподдерживаемый сервис" со ссылками на переход к
         * поддерживаемым сервисам (mangalib/ranobelib) и на репозиторий проекта.
         * @returns {Promise<void>}
         */
        async _showWrongServiceState() {
            await global.TemplateLoader.show('wrong-service');
            const logoInfo = $el('logoInfo');
            if (logoInfo) logoInfo.textContent = '';

            const siteLogo = $el('siteLogo');
            const serviceLinks = $el('serviceLinks');

            if (serviceLinks && global.serviceRegistry) {
                for (const service of global.serviceRegistry.getAllServices()) {
                    const { name, siteUrl } = service.config || {};
                    if (!siteUrl) continue;
                    const btn = document.createElement('button');
                    btn.className = `service-link-btn ${name}-link-btn`;
                    btn.style.flex = '1';
                    if (service.config.primaryColor)
                        btn.style.border = `2px solid ${service.config.primaryColor}`;
                    btn.textContent = service.config.label || name;
                    btn.addEventListener('click', async () => {
                        browserAPI.tabs.create({ url: siteUrl });
                        this._applyServiceTheme(name, siteLogo);
                        await this._showNoTitleState();
                    });
                    serviceLinks.appendChild(btn);
                }
            }

            $el('openGithub')?.addEventListener('click', () => {
                browserAPI.tabs.create({ url: 'https://github.com/ivanvit100/DownloadLib' });
            });
        }

        /**
         * Показывает экран "тайтл не определён" (пользователь на поддерживаемом сервисе,
         * но не на странице конкретного тайтла) со ссылкой на репозиторий проекта.
         * @returns {Promise<void>}
         */
        async _showNoTitleState() {
            await global.TemplateLoader.show('no-title');
            const logoInfo = $el('logoInfo');
            if (logoInfo) logoInfo.textContent = '';

            $el('openGithub')?.addEventListener('click', () => {
                browserAPI.tabs.create({ url: 'https://github.com/ivanvit100/DownloadLib' });
            });
        }

        /**
         * Определяет сервис и slug тайтла: либо напрямую из параметров URL (когда попап
         * открыт с заранее известными данными для авто-скачивания/обновления файла),
         * либо по URL активной вкладки браузера. Если сервис активной вкладки не
         * поддерживается, показывает экран "неподдерживаемый сервис" и возвращает null.
         * @param {{autoDownload: boolean, fileUploadMode: boolean, slugFromUrl: ?string,
         * serviceFromUrl: ?string, tabIdFromUrl: ?number}} params - Флаги режима и данные из URL.
         * @returns {Promise<?{slug: ?string, serviceKey: string, service: object, activeTabId: ?number}>}
         * Разрешённые slug/сервис и id активной вкладки, либо null, если сервис не поддерживается.
         */
        async _resolveService({ autoDownload, fileUploadMode, slugFromUrl, serviceFromUrl, tabIdFromUrl }) {
            if ((autoDownload || fileUploadMode) && slugFromUrl && serviceFromUrl) {
                const serviceKey = serviceFromUrl;
                let service;
                if (serviceKey === 'ranobelib')
                    service = new global.RanobeLibService();
                else if (serviceKey === 'mangalib')
                    service = new global.MangaLibService();
                else
                    service = global.serviceRegistry?.getService(serviceKey) ?? null;
                if (!service) throw new Error(`Unknown service: ${serviceKey}`);
                return { slug: slugFromUrl, serviceKey, service, activeTabId: tabIdFromUrl };
            }

            const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
            if (!tabs || !tabs[0]) throw new Error('No active tab found');
            const currentUrl = tabs[0].url;
            const activeTabId = tabs[0].id;
            console.log('[PopupController] Current URL:', currentUrl);

            const match = currentUrl.match(/\/(?:manga|book)\/([^/?]+)/);
            const slug = match ? match[1] : null;

            const service = global.serviceRegistry.getServiceByUrl(currentUrl);
            if (!service) {
                await this._showWrongServiceState();
                return null;
            }

            return { slug, serviceKey: service.name, service, activeTabId };
        }

        /**
         * Навешивает обработчик на кнопку выбора файла для обновления: в отдельном
         * окне сразу открывает системный диалог выбора файла, а в выпадающем попапе
         * тулбара — открывает попап заново в отдельном окне (диалог выбора файла не
         * работает корректно в закрывающемся при потере фокуса попапе).
         * @param {{customFileBtn: ?HTMLButtonElement, status: ?HTMLElement, hiddenFileInput: HTMLInputElement,
         * slug: string, serviceKey: string}} params - Элементы UI и данные текущего тайтла.
         * @returns {void}
         */
        _setupFileUploadButton({ customFileBtn, status, hiddenFileInput, slug, serviceKey }) {
            if (!customFileBtn) {
                console.warn('[PopupController] customFileBtn not found');
                return;
            }

            customFileBtn.onclick = async () => {
                try {
                    const inSeparateWindow = await this.isInSeparateWindow();
                    console.log(`[PopupController] In separate window: ${inSeparateWindow}`);

                    if (inSeparateWindow) {
                        if (status) status.textContent = 'Выберите файл для обновления';
                        hiddenFileInput.click();
                    } else {
                        const formatSelector = $el('formatSelector');
                        const format = formatSelector ? formatSelector.value : 'fb2';

                        try {
                            const fileUploadParams = new URLSearchParams({
                                fileUpload: 'true', slug, service: serviceKey, format
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
        }

        /**
         * Главный сценарий загрузки экрана тайтла: разбирает параметры URL, определяет
         * сервис и slug, применяет токен авторизации и тему сервиса, загружает
         * метаданные тайтла и список глав, отрисовывает их и переводит форму
         * в состояние готовности к скачиванию (либо запускает автоскачивание).
         * @returns {Promise<void>}
         */
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
            const chapterFromUrl = urlParams.get('chapterFrom');
            const chapterToUrl = urlParams.get('chapterTo');
            const maxSizeMBFromUrl = urlParams.get('maxSizeMB');
            const branchIdFromUrl = urlParams.get('branchId')
                ? parseInt(urlParams.get('branchId'))
                : null;
            const splitPagesFromUrl = urlParams.get('splitPages');
            const tabIdFromUrl = urlParams.get('tabId') ? parseInt(urlParams.get('tabId')) : null;

            this._applyUrlParams({
                formatFromUrl, maxSizeMBFromUrl, splitPagesFromUrl,
                formatSelector: $el('formatSelector')
            });

            if (btn) btn.disabled = true;
            if (status) status.textContent = 'Получаем информацию...';

            try {
                const resolved = await this._resolveService({
                    autoDownload, fileUploadMode, slugFromUrl, serviceFromUrl, tabIdFromUrl
                });
                if (resolved === null) return;
                const { slug, serviceKey, service, activeTabId } = resolved;

                this._activeTabId = activeTabId;
                if (activeTabId) global.setServiceTab(activeTabId);
                this.authToken = await global.AuthManager.apply(serviceKey, activeTabId, service);

                this._applyServiceTheme(serviceKey, siteLogo);

                const splitPagesContainer = $el('splitPagesContainer');
                if (splitPagesContainer) {
                    const showSplit = serviceKey === 'mangalib' || !!service?.config?.splitLongImages;
                    splitPagesContainer.style.display = showSplit ? 'block' : 'none';
                }

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

                this._setupFileUploadButton({ customFileBtn, status, hiddenFileInput, slug, serviceKey });

                if (autoDownload) setTimeout(() => this.startDownload(), 500);
            } catch (error) {
                this._handleLoadError(error, uiElements);
            }
        }

        /**
         * Пытается догрузить обложку через контекст вкладки сервиса (обходя CORS/rate-limit
         * ограничения), возвращая data-URL с base64-содержимым.
         * @param {string} url - Исходный URL обложки.
         * @returns {Promise<string>} data-URL с изображением, либо исходный URL при ошибке загрузки.
         */
        async _fetchCover(url) {
            try {
                const result = await global.fetchViaTab(url, this.currentServiceKey);
                if (result?.ok) return `data:${result.contentType};base64,${result.base64}`;
            } catch (e) {
                console.warn('[PopupController] Cover fetch failed:', e.message);
            }
            return url;
        }

        /**
         * Обрезает текст до заданной длины, добавляя многоточие при обрезке.
         * @param {?string} text - Исходный текст.
         * @param {number} [maxLength=128] - Максимальная длина результата (без многоточия).
         * @returns {?string} Обрезанный текст, исходный text, если он короче лимита или пуст.
         */
        truncateText(text, maxLength = 128) {
            if (!text) return text;
            const str = String(text).trim();
            if (str.length <= maxLength) return str;
            return `${str.substring(0, maxLength)}...`;
        }

        /**
         * Навешивает обработчики на кнопки скачивания, паузы и остановки на главном
         * экране тайтла. Клик по скачиванию в выпадающем попапе тулбара (без загруженного
         * файла обновления) переоткрывает попап в отдельном окне с параметрами загрузки
         * в URL, чтобы процесс скачивания не прерывался закрытием попапа.
         * @returns {void}
         */
        setupEventListeners() {
            const downloadBtn = $el('downloadBtn');
            const pauseBtn = $el('pauseBtn');
            const stopBtn = $el('stopBtn');

            if (downloadBtn) {
                downloadBtn.addEventListener('click', async () => {
                    const inSeparateWindow = await this.isInSeparateWindow();

                    if (!this.loadedFile && !inSeparateWindow) {
                        const formatSelector = $el('formatSelector');
                        const fromSelect = $el('chapterFromSelect');
                        const toSelect = $el('chapterToSelect');
                        const chapterRangeContainer = $el('chapterRangeContainer');

                        const format = formatSelector ? formatSelector.value : 'fb2';
                        const maxSizeMB = localStorage.getItem('manga_parser_max_size_mb') || '200';

                        const splitPagesCheckboxEl = $el('splitPagesCheckbox');
                        const splitPagesContainerEl = $el('splitPagesContainer');
                        const splitPages = splitPagesCheckboxEl && splitPagesContainerEl &&
                            splitPagesContainerEl.style.display !== 'none'
                            ? splitPagesCheckboxEl.checked
                            : false;

                        let urlParams = `?download=true&slug=${encodeURIComponent(this.currentSlug)}&service=${encodeURIComponent(this.currentServiceKey)}&format=${encodeURIComponent(format)}&maxSizeMB=${encodeURIComponent(maxSizeMB)}&splitPages=${encodeURIComponent(splitPages)}`;

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
                    if (this.shouldStop) return;
                    this.isPaused = !this.isPaused;
                    pauseBtn.textContent = this.isPaused ? 'Продолжить' : 'Пауза';
                    const status = $el('status');
                    if (status) status.textContent = this.isPaused ? 'Пауза...' : 'Загрузка...';
                    else console.warn('Status element not found when updating status on pause/resume');
                });
            }

            if (stopBtn) stopBtn.addEventListener('click', () => this.stopDownload());
        }

        /**
         * Подписывается на события шины downloadManager'а (прогресс, завершение, ошибка)
         * и обновляет соответствующим образом интерфейс попапа.
         * @returns {void}
         */
        subscribeToEvents() {
            this.downloadManager.eventBus.on('download:progress', (state) => {
                this.updateProgress(state.status, state.progress);
            });

            this.downloadManager.eventBus.on('download:completed', () => {
                this.resetUI();
            });

            this.downloadManager.eventBus.on('download:failed', ({ error }) => {
                this.showError(error.message);
                this.resetUI();
            });
        }

        /**
         * Строит объект диапазона глав из значений select-элементов, если контейнер
         * диапазона видим.
         * @param {?HTMLSelectElement} fromSelect - Select начала диапазона.
         * @param {?HTMLSelectElement} toSelect - Select конца диапазона.
         * @param {?HTMLElement} container - Контейнер блока выбора диапазона.
         * @returns {?{from: number, to: number}} Диапазон индексов глав, либо null,
         * если селекторы/контейнер отсутствуют или скрыты.
         */
        _buildChapterRange(fromSelect, toSelect, container) {
            if (fromSelect && toSelect && container && container.style.display !== 'none')
                return { from: parseInt(fromSelect.value), to: parseInt(toSelect.value) };
            return null;
        }

        /**
         * Переводит интерфейс в состояние "идёт загрузка": скрывает элементы выбора
         * (формат, переводчик, разбиение страниц, файл, диапазон), показывает прогресс-бар
         * и панель с параметрами текущей загрузки, обновляет статус.
         * @param {{btn: HTMLButtonElement, hiddenFileInput: ?HTMLInputElement, customFileBtn: ?HTMLButtonElement,
         * fileInputContainer: ?HTMLElement, progress: ?HTMLElement, controls: ?HTMLElement,
         * chapterRangeContainer: ?HTMLElement, status: ?HTMLElement}} elements - Элементы формы загрузки.
         * @returns {void}
         */
        _setDownloadingUIState({ btn, hiddenFileInput, customFileBtn,
            fileInputContainer, progress, controls, chapterRangeContainer, status }) {
            btn.disabled = true;
            btn.style.display = 'none';
            this._setVisibility('formatContainer', 'none');
            this._setVisibility('translatorContainer', 'none');
            this._setVisibility('splitPagesContainer', 'none');
            if (hiddenFileInput) hiddenFileInput.disabled = true;
            if (customFileBtn) customFileBtn.disabled = true;
            if (fileInputContainer) fileInputContainer.style.display = 'none';
            if (progress) progress.style.display = 'block';
            if (controls) controls.style.display = 'block';
            if (chapterRangeContainer) chapterRangeContainer.style.display = 'none';

            const downloadInfoPanel = $el('downloadInfoPanel');
            if (downloadInfoPanel) {
                const formatSelector = $el('formatSelector');
                const formatLabel = formatSelector
                    ? (formatSelector.options[formatSelector.selectedIndex]?.text || formatSelector.value)
                    : '';
                const rateLimit = localStorage.getItem('downloadlib_default_rate_limit') || '85';
                const maxSizeMBDisplay = localStorage.getItem('manga_parser_max_size_mb') || '200';
                downloadInfoPanel.innerHTML =
                    `<div class="info-row"><span class="info-label">Формат</span><span class="info-value">${formatLabel}</span></div>` +
                    `<div class="info-row"><span class="info-label">Запросов в минуту</span><span class="info-value">${rateLimit}</span></div>` +
                    `<div class="info-row"><span class="info-label">Макс. размер части</span><span class="info-value">${maxSizeMBDisplay} МБ</span></div>`;
                downloadInfoPanel.style.display = 'block';
            }

            const statusText = this.loadedFile ? 'Запуск обновления...' : 'Запуск скачивания...';
            if (status) status.textContent = statusText;
        }

        /**
         * Отображает итог операции обновления существующего файла (если результат
         * загрузки содержит поле updated); для обычного скачивания ничего не делает.
         * @param {object} result - Результат downloadManager.startDownload.
         * @param {?HTMLElement} status - Элемент статуса для вывода сообщения.
         * @returns {void}
         */
        _handleDownloadResult(result, status) {
            if (!('updated' in result)) return;
            const message = result.updated
                ? `Файл обновлён! Добавлено глав: ${result.addedChapters}`
                : 'Файл уже актуален!';
            if (status) status.textContent = message;
            else console.warn('Status element not found when showing download result message');
        }

        /**
         * Запускает загрузку текущего тайтла: собирает параметры (диапазон глав, ветку
         * перевода, формат, лимиты), переводит UI в состояние загрузки, вызывает
         * downloadManager.startDownload с контроллером паузы/остановки, а по завершении
         * отображает результат и добавляет запись в историю загрузок.
         * @returns {Promise<void>}
         */
        async startDownload() {
            if (!this.currentSlug || !this.currentServiceKey) {
                this.showError('Не удалось определить тайтл');
                return;
            }

            const { btn, formatSelector, status, progress,
                controls, hiddenFileInput, customFileBtn, fileInputContainer,
                chapterRangeContainer, fromSelect, toSelect } = this._getDownloadElements();

            try {
                const { chapterRange, branchId, historyParams } = await this._prepareDownload({
                    fromSelect, toSelect, chapterRangeContainer
                });

                this.isDownloading = true;
                this.isPaused = false;
                this.shouldStop = false;

                this._setDownloadingUIState({
                    btn, hiddenFileInput, customFileBtn, fileInputContainer,
                    progress, controls, chapterRangeContainer, status
                });

                const format = formatSelector?.value || 'fb2';
                const maxSizeMB = parseInt(localStorage.getItem('manga_parser_max_size_mb')) || 200;

                const splitPagesEl = $el('splitPagesCheckbox');
                const splitPages = splitPagesEl ? splitPagesEl.checked : false;

                const result = await this.downloadManager.startDownload({
                    slug: this.currentSlug,
                    serviceKey: this.currentServiceKey,
                    format,
                    loadedFile: this.loadedFile,
                    chapterRange,
                    branchId,
                    maxSizeMB,
                    splitPages,
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

        /**
         * Возвращает текст выбранной опции select-элемента.
         * @param {?HTMLSelectElement} select - Проверяемый select.
         * @returns {?string} Текст выбранной опции, либо null, если select отсутствует
         * или ничего не выбрано.
         */
        _getSelectText(select) {
            if (!select || select.selectedIndex < 0) return null;
            return select.options[select.selectedIndex]?.text || null;
        }

        /**
         * Применяет сохранённый лимит запросов в минуту на стороне background-скрипта
         * и собирает параметры предстоящей загрузки: диапазон глав, ветку перевода
         * и текстовые значения для записи в историю.
         * @param {{fromSelect: ?HTMLSelectElement, toSelect: ?HTMLSelectElement,
         * chapterRangeContainer: ?HTMLElement}} params - Элементы выбора диапазона глав.
         * @returns {Promise<{chapterRange: ?{from: number, to: number}, branchId: ?number,
         * historyParams: {chapterFrom: ?string, chapterTo: ?string, translator: ?string}}>}
         * Параметры для запуска загрузки и записи в историю.
         */
        async _prepareDownload({ fromSelect, toSelect, chapterRangeContainer }) {
            const limit = parseInt(localStorage.getItem('downloadlib_default_rate_limit')) || 85;
            await browserAPI.runtime.sendMessage({ action: 'setRateLimit', limit });

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

        /**
         * Останавливает текущую загрузку: снимает паузу, выставляет флаг остановки,
         * блокирует кнопки паузы/остановки и просит downloadManager прервать загрузку.
         * @returns {void}
         */
        stopDownload() {
            this.shouldStop = true;
            this.isPaused = false;
            this.isDownloading = false;
            const pauseBtn = $el('pauseBtn');
            const stopBtn = $el('stopBtn');
            if (pauseBtn) pauseBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = true;
            if (this.currentDownloadId)
                this.downloadManager.stop(this.currentDownloadId);
            const status = $el('status');
            if (status) status.textContent = 'Досрочное завершение...';
            else console.warn('Status element not found when setting status on download stop');
        }

        /**
         * Обновляет текст статуса (если загрузка не на паузе) и значение прогресс-бара.
         * @param {string} message - Текст статуса загрузки.
         * @param {number} percent - Процент выполнения (0-100).
         * @returns {void}
         */
        updateProgress(message, percent) {
            const statusEl = $el('status');
            const progressEl = $el('progress');
            if (statusEl) {
                if (!this.isPaused) statusEl.textContent = message;
            } else console.warn('Status element not found when updating progress status');
            if (progressEl) progressEl.value = percent;
            else console.warn('Progress element not found when updating progress percentage');
        }

        /**
         * Возвращает интерфейс попапа в исходное состояние после завершения, ошибки
         * или остановки загрузки: сбрасывает флаги, очищает загруженный файл, снова
         * показывает элементы выбора формата/файла/диапазона глав и переводчика,
         * скрывает прогресс-бар и панель параметров загрузки.
         * @returns {void}
         */
        resetUI() {
            this.isDownloading = false;
            this.isPaused = false;
            this.shouldStop = false;

            const pauseBtn = $el('pauseBtn');
            const stopBtn = $el('stopBtn');
            if (pauseBtn) {
                pauseBtn.disabled = false;
                pauseBtn.textContent = 'Пауза';
            }
            if (stopBtn) stopBtn.disabled = false;

            this.loadedFile = null;
            this.currentDownloadId = null;

            const { btn, progress, controls, hiddenFileInput, customFileBtn } = this._getDownloadElements();

            if (btn) {
                btn.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Скачать';
            } else console.warn('Download button not found when resetting UI');
            this._setVisibility('formatContainer', '');
            this._setVisibility('downloadInfoPanel', 'none');
            const showSplitOnReset =
                this.currentServiceKey === 'mangalib' || !!this.currentService?.config?.splitLongImages;
            this._setVisibility('splitPagesContainer', showSplitOnReset ? 'block' : 'none');
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
        }

        /**
         * Показывает сообщение об ошибке во всплывающем блоке на 5 секунд.
         * @param {string} message - Текст сообщения об ошибке.
         * @returns {void}
         */
        showError(message) {
            const errorEl = $el('error');
            if (errorEl) {
                errorEl.textContent = message;
                errorEl.classList.remove('hidden');
                setTimeout(() => errorEl.classList.add('hidden'), 5000);
            } else console.warn('Error element not found when showing error message');
        }

        /**
         * Показывает сообщение об успехе во всплывающем блоке на 5 секунд.
         * @param {string} message - Текст сообщения об успехе.
         * @returns {void}
         */
        showSuccess(message) {
            const successEl = $el('success');
            if (successEl) {
                successEl.textContent = message;
                successEl.classList.remove('hidden');
                setTimeout(() => successEl.classList.add('hidden'), 5000);
            } else console.warn('Success element not found when showing success message');
        }

        /**
         * Проверяет (с кэшированием на 4 часа в localStorage) статус последнего запуска
         * health-check воркфлоу проекта на GitHub и показывает предупреждение о
         * возможной неработоспособности части запросов к API, если проверка провалена.
         * @returns {Promise<void>}
         */
        async checkApiHealth() {
            const CACHE_KEY = 'DLoadLib_API_check';
            const CACHE_TTL = 4 * 60 * 60 * 1000;
            const API_URL = `https://api.github.com/repos/ivanvit100/DownloadLib/actions/workflows/health-check.yaml/runs?per_page=1`;
            const REPO_URL = 'https://github.com/ivanvit100/DownloadLib/issues';

            try {
                const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
                const useCache = cached && (Date.now() - cached.timestamp < CACHE_TTL);

                if (!useCache) {
                    const res = await fetch(API_URL, { cache: 'no-cache' });
                    const data = await res.json();
                    const conclusion = data.workflow_runs?.[0]?.conclusion;
                    const isFailing = conclusion === 'failure';
                    localStorage.setItem(CACHE_KEY, JSON.stringify({ isFailing, timestamp: Date.now() }));
                    if (isFailing) this._showApiWarning(REPO_URL);
                    return;
                }

                if (cached.isFailing) this._showApiWarning(REPO_URL);
            } catch (e) {
                console.warn('[PopupController] Health check status unavailable:', e.message);
            }
        }

        /**
         * Вставляет перед кнопкой скачивания предупреждение о нестабильности API
         * со ссылкой на страницу issues репозитория.
         * @param {string} repoUrl - URL страницы issues репозитория проекта.
         * @returns {void}
         */
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
