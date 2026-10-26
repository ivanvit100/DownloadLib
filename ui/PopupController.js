/**
 * DownloadLib ui module
 * Module to manage the user interface for manga downloads
 * @module ui/PopupController
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { AuthManager } from '../core/AuthManager.js';
import { browserEnv, extensionApi } from '../core/BrowserApi.js';
import { createLogger } from '../core/ConsoleLogger.js';
import { createController } from '../core/DownloadContext.js';
import { DownloadHistory } from '../core/DownloadHistory.js';
import { DownloadManager } from '../core/DownloadManager.js';
import { MangaPatcher } from '../core/MangaPatcher.js';
import { MSG } from '../core/MessageTypes.js';
import { PluginManager } from '../core/PluginManager.js';
import { DEFAULT_RATE_LIMIT } from '../core/RateLimiter.js';
import { RateLimitClient } from '../core/RateLimitClient.js';
import { fetchViaTab, setServiceTab } from '../core/TabNetwork.js';
import {
    FIT_FB2_IMAGES_KEY, FORMAT_STORAGE_KEY, readPartLimit, settingsStorage, SPLIT_PAGES_KEY
} from '../core/UserSettings.js';
import { ExporterRegistry } from '../exporters/ExporterRegistry.js';
import { extractSlug } from '../services/ServiceHosts.js';
import { serviceRegistry } from '../services/ServiceRegistry.js';
import { ChapterController } from './ChapterController.js';
import { $el, createEl, setDisplay } from './DomUtils.js';
import { HistoryController } from './HistoryController.js';
import { SettingsController } from './SettingsController.js';
import { TemplateLoader } from './TemplateLoader.js';

const log = createLogger('PopupController');

const REPO_URL = 'https://github.com/ivanvit100/DownloadLib';

/**
 * Заполняет select формата экспорта зарегистрированными форматами.
 * @param {HTMLSelectElement} select - Select формата.
 * @returns {void}
 */
function fillFormatOptions(select) {
    ExporterRegistry.getFormats().forEach(({ value, label }) =>
        select.appendChild(createEl('option', { text: label, attrs: { value } })));
}

/**
 * Строка панели параметров загрузки: подпись и значение.
 * @param {string} label - Подпись параметра.
 * @param {*} value - Значение параметра.
 * @returns {HTMLElement}
 */
function infoRow(label, value) {
    const row = createEl('div', { className: 'info-row' });
    row.append(createEl('span', { className: 'info-label', text: label }),
        createEl('span', { className: 'info-value', text: value }));
    return row;
}

/**
 * Главный контроллер попапа расширения: управляет отображением метаданных
 * тайтла, запуском/паузой/остановкой загрузки, переключением между шаблонами
 * (title, settings, history) и состоянием формы скачивания.
 */
export class PopupController {
    /**
     * Создаёт менеджер загрузок и контроллер глав, инициализирует поля состояния
     * загрузки и запускает первичную настройку интерфейса.
     */
    constructor() {
        log.debug('Initializing...');
        this.downloadManager = new DownloadManager();
        this.chapterController = new ChapterController();
        this.isDownloading = false;
        this.isPaused = false;
        this.shouldStop = false;
        this.controller = null;
        this._shellEventsBound = false;
        this.currentDownloadId = null;
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
            log.info('Download started with ID:', this.currentDownloadId);
        });

        this.subscribeToEvents();
        this._init();

        log.debug('Initialized');
    }

    /**
     * Инициализирует TemplateLoader и события оболочки, затем показывает либо
     * экран настроек (если открыт с параметром ?settings), либо главный экран
     * тайтла: загружает метаданные, проверяет здоровье API и подписывается
     * на изменение списка кастомных плагинов для обновления списка форматов.
     * @returns {Promise<void>}
     */
    async _init() {
        TemplateLoader.init('view');
        this._bindShellEvents();

        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('settings')) {
            await TemplateLoader.show('settings', () => SettingsController.init(() => this._restoreMainView()));
            return;
        }

        await TemplateLoader.show('title');
        this._bindTitleEvents();
        this.setupEventListeners();
        await this.loadMetadata();
        this.checkApiHealth();

        if (extensionApi?.storage?.onChanged) {
            extensionApi.storage.onChanged.addListener(async (changes, area) => {
                if (area !== 'local' || !('custom_plugins' in changes)) return;
                await PluginManager.loadAll();
                const sel = $el('formatSelector');
                if (!sel) return;
                const current = sel.value;
                sel.replaceChildren();
                fillFormatOptions(sel);
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
        await TemplateLoader.show('title');
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
                TemplateLoader.show('history', () => HistoryController.init(() => this._restoreMainView()));
            });
        } else log.warn('historyBtn not found in shell');

        const settingsBtn = $el('settingsBtn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', async () => {
                const url = `${extensionApi.runtime.getURL('popup.html')}?settings=true`;
                await this.openInNewContext(url);
            });
        } else log.warn('settingsBtn not found in shell');
    }

    /**
     * Навешивает обработчики на элементы шаблона title: заполняет и сохраняет выбор
     * формата экспорта, чекбокс разбиения страниц и валидацию диапазона выбора глав.
     * @returns {void}
     */
    _bindTitleEvents() {
        const btn = $el('downloadBtn');
        if (!btn) {
            log.error('downloadBtn not found in title template');
            return;
        }

        const formatSelector = $el('formatSelector');
        const chapterFromSelect = $el('chapterFromSelect');
        const chapterToSelect = $el('chapterToSelect');

        setDisplay('progress', 'none');
        setDisplay('downloadControls', 'none');
        setDisplay('downloadInfoPanel', 'none');

        if (formatSelector) {
            fillFormatOptions(formatSelector);

            const savedFormat = settingsStorage.get(FORMAT_STORAGE_KEY);
            if (savedFormat) formatSelector.value = savedFormat;
            else log.debug('No saved format in localStorage');

            if (extensionApi?.storage?.local)
                extensionApi.storage.local.set({ [FORMAT_STORAGE_KEY]: formatSelector.value });

            formatSelector.addEventListener('change', () => {
                settingsStorage.set(FORMAT_STORAGE_KEY, formatSelector.value);
                if (extensionApi?.storage?.local)
                    extensionApi.storage.local.set({ [FORMAT_STORAGE_KEY]: formatSelector.value });
            });
        }

        const splitPagesCheckbox = $el('splitPagesCheckbox');
        if (splitPagesCheckbox) {
            const saved = settingsStorage.get(SPLIT_PAGES_KEY);
            splitPagesCheckbox.checked = saved !== null ? saved === 'true' : true;
            splitPagesCheckbox.addEventListener('change', () => {
                settingsStorage.set(SPLIT_PAGES_KEY, splitPagesCheckbox.checked);
            });
        }

        if (chapterFromSelect && chapterToSelect) {
            chapterFromSelect.addEventListener('change', () => {
                if (chapterFromSelect.selectedIndex > chapterToSelect.selectedIndex)
                    chapterToSelect.selectedIndex = chapterFromSelect.selectedIndex;
                else log.debug('Chapter range selectors updated without invalid range');
            });
            chapterToSelect.addEventListener('change', () => {
                if (chapterToSelect.selectedIndex < chapterFromSelect.selectedIndex)
                    chapterFromSelect.selectedIndex = chapterToSelect.selectedIndex;
                else log.debug('Chapter range selectors updated without invalid range');
            });
        }

        log.debug('Title events bound');
    }

    /**
     * Собирает ссылки на все DOM-элементы формы загрузки в один объект для удобной передачи.
     * @returns {object} Объект со ссылками на элементы: btn, formatSelector, status,
     * chapterRangeContainer, fromSelect, toSelect.
     */
    _getDownloadElements() {
        return {
            btn: $el('downloadBtn'),
            formatSelector: $el('formatSelector'),
            status: $el('status'),
            chapterRangeContainer: $el('chapterRangeContainer'),
            fromSelect: $el('chapterFromSelect'),
            toSelect: $el('chapterToSelect')
        };
    }

    /**
     * Определяет, открыт ли попап в отдельном окне (а не как выпадающий попап
     * тулбара): по параметру URL download либо по типу текущего окна.
     * @returns {Promise<boolean>} true, если попап работает как отдельное окно.
     */
    async isInSeparateWindow() {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('download')) return true;
            const currentWindow = await extensionApi.windows.getCurrent();
            log.debug('Window type:', currentWindow.type);
            return currentWindow.type === 'popup';
        } catch (e) {
            log.warn('Failed to detect window type:', e);
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
        if (!browserEnv.isFirefox) {
            extensionApi.runtime.sendMessage({ action: MSG.OPEN_WINDOW_WITH_URL, url })
                .catch(e => log.warn('Failed to ask the background to open a window:', e));
            return;
        }
        if (extensionApi.windows) {
            const win = await extensionApi.windows.create({
                url,
                type: 'popup',
                width: 350,
                height: 650,
                focused: true,
                state: 'normal'
            });
            if (win && win.id) {
                await new Promise(resolve => setTimeout(resolve, 500));
                extensionApi.windows.update(win.id, { focused: true });
            } else log.warn('Window created but no ID found:', win);
        }
        else if (extensionApi.tabs) {
            const tab = await extensionApi.tabs.create({ url, active: true });
            if (!tab) log.warn('Tab created but no ID found:', tab);
        }
        else log.error('No window/tab API available');
    }

    /**
     * Применяет фирменные цвета и логотип сервиса к оформлению попапа.
     * @param {string} serviceKey - Ключ сервиса.
     * @param {?HTMLImageElement} siteLogo - Элемент логотипа сервиса (может отсутствовать).
     * @returns {void}
     */
    _applyServiceTheme(serviceKey, siteLogo) {
        const cfg = serviceRegistry.getService(serviceKey)?.config || {};
        document.body.style.setProperty('--primary-color', cfg.primaryColor || '#ff9100');
        document.body.style.setProperty('--secondary-color', cfg.secondaryColor || '#c77101');
        if (siteLogo) siteLogo.src = cfg.logo || 'icons/logo1.png';
        else log.warn('Site logo element not found when setting logo for service:', serviceKey);
    }

    /**
     * Применяет к форме формат и разбиение страниц, переданные через URL окна
     * загрузки. Параметры действуют только на эту загрузку: сохранённые настройки
     * (localStorage) не меняются, их меняет только сам пользователь.
     * @param {{formatFromUrl: ?string, splitPagesFromUrl: ?string,
     * formatSelector: ?HTMLSelectElement}} params - Значения параметров из URL и элемент селектора формата.
     * @returns {void}
     */
    _applyUrlParams({ formatFromUrl, splitPagesFromUrl, formatSelector }) {
        if (formatFromUrl && formatSelector) formatSelector.value = formatFromUrl;

        if (splitPagesFromUrl != null) {
            const splitPagesCheckbox = $el('splitPagesCheckbox');
            if (splitPagesCheckbox) splitPagesCheckbox.checked = splitPagesFromUrl === 'true';
        }
    }

    /**
     * Отрисовывает нормализованные метаданные тайтла: обложку (с догрузкой через
     * фоновый fetch), заголовок и краткое описание, сводку "глав/рейтинг/авторы"
     * и дату выхода. Данные сайта выводятся только как текст (textContent),
     * HTML в названии или описании не разбирается.
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
        if (!cover) log.warn('No cover information found in metadata');

        if (cover) {
            coverImg.style.display = 'block';
            coverImg.src = cover;
            this._fetchCover(cover).then(src => { coverImg.src = src; });
        } else
            coverImg.style.display = 'none';

        const authors = patched.authors.filter(Boolean);
        const rating = patched.rating || null;
        if (!rating) log.warn('No age restriction label found in metadata');

        const firstLineParts = [];
        if (chaptersCount !== null) firstLineParts.push(`Глав: ${chaptersCount}`);
        if (rating) firstLineParts.push(`Рейтинг: ${rating}`);

        const secondLine = (authors && authors.length) ? `Авторы: ${authors.join(', ')}` : '';
        const logoText = secondLine
            ? `${firstLineParts.join(' · ')}\n${secondLine}`
            : firstLineParts.join(' · ');
        logoInfo.textContent = logoText;

        desc.replaceChildren(createEl('strong', { text: title }), createEl('br'), createEl('small', { text: summary }));

        const release = patched.releaseDate || '';
        if (releaseEl) releaseEl.textContent = release ? `Дата выхода: ${release}` : '';
        else log.warn('Release date element not found when setting release date:', release);
    }

    /**
     * Переводит форму загрузки в состояние готовности: разблокирует кнопку скачивания.
     * @param {{btn: HTMLButtonElement, status: ?HTMLElement}} params - Элементы формы.
     * @returns {void}
     */
    _setReadyState({ btn, status }) {
        btn.disabled = false;
        if (status) status.textContent = 'Нажмите "Скачать" для загрузки книги';
        else log.warn('Status element not found when setting ready to download message');
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
        log.error('Failed to load metadata:', error);
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
        await TemplateLoader.show('wrong-service');
        const logoInfo = $el('logoInfo');
        if (logoInfo) logoInfo.textContent = '';

        const siteLogo = $el('siteLogo');
        const serviceLinks = $el('serviceLinks');

        if (serviceLinks) {
            for (const service of serviceRegistry.getAllServices()) {
                const { name, siteUrl } = service.config || {};
                if (!siteUrl) continue;
                const btn = createEl('button', {
                    className: `service-link-btn ${name}-link-btn`,
                    text: service.config.label || name
                });
                if (service.config.primaryColor)
                    btn.style.border = `2px solid ${service.config.primaryColor}`;
                btn.addEventListener('click', async () => {
                    extensionApi.tabs.create({ url: siteUrl });
                    this._applyServiceTheme(name, siteLogo);
                    await this._showNoTitleState();
                });
                serviceLinks.appendChild(btn);
            }
        }

        $el('openGithub')?.addEventListener('click', () => {
            extensionApi.tabs.create({ url: REPO_URL });
        });
    }

    /**
     * Показывает экран "тайтл не определён" (пользователь на поддерживаемом сервисе,
     * но не на странице конкретного тайтла) со ссылкой на репозиторий проекта.
     * @returns {Promise<void>}
     */
    async _showNoTitleState() {
        await TemplateLoader.show('no-title');
        const logoInfo = $el('logoInfo');
        if (logoInfo) logoInfo.textContent = '';

        $el('openGithub')?.addEventListener('click', () => {
            extensionApi.tabs.create({ url: REPO_URL });
        });
    }

    /**
     * Определяет сервис и slug тайтла: либо напрямую из параметров URL (когда попап
     * открыт с заранее известными данными для авто-скачивания), либо по URL активной
     * вкладки браузера. Если сервис активной вкладки не поддерживается, показывает
     * экран "неподдерживаемый сервис" и возвращает null.
     * @param {{autoDownload: boolean, slugFromUrl: ?string, serviceFromUrl: ?string,
     * tabIdFromUrl: ?number}} params - Флаг режима и данные из URL.
     * @returns {Promise<?{slug: ?string, serviceKey: string, service: object, activeTabId: ?number}>}
     * Разрешённые slug/сервис и id активной вкладки, либо null, если сервис не поддерживается.
     */
    async _resolveService({ autoDownload, slugFromUrl, serviceFromUrl, tabIdFromUrl }) {
        if (autoDownload && slugFromUrl && serviceFromUrl) {
            const service = serviceRegistry.createService(serviceFromUrl);
            if (!service) throw new Error(`Unknown service: ${serviceFromUrl}`);
            return { slug: slugFromUrl, serviceKey: serviceFromUrl, service, activeTabId: tabIdFromUrl };
        }

        const tabs = await extensionApi.tabs.query({ active: true, currentWindow: true });
        if (!tabs || !tabs[0]) throw new Error('No active tab found');
        const currentUrl = tabs[0].url;
        const activeTabId = tabs[0].id;
        log.debug('Current URL:', currentUrl);

        const slug = extractSlug(currentUrl);

        const serviceKey = serviceRegistry.findServiceKey(currentUrl);
        const service = serviceKey ? serviceRegistry.createService(serviceKey) : null;
        if (!service) {
            await this._showWrongServiceState();
            return null;
        }

        return { slug, serviceKey, service, activeTabId };
    }

    /**
     * Главный сценарий загрузки экрана тайтла: разбирает параметры URL, определяет
     * сервис и slug, применяет токен авторизации и тему сервиса, загружает
     * метаданные тайтла и список глав, отрисовывает их и переводит форму
     * в состояние готовности к скачиванию (либо запускает автоскачивание).
     * Если диапазон из URL не найден в списке глав, автоскачивание не запускается,
     * чтобы молча не скачать весь тайтл вместо выбранных глав.
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
        const uiElements = { logoInfo, coverImg, desc, releaseEl, btn, status };

        const urlParams = new URLSearchParams(window.location.search);
        const autoDownload = urlParams.get('download') === 'true';
        const slugFromUrl = urlParams.get('slug');
        const serviceFromUrl = urlParams.get('service');
        const formatFromUrl = urlParams.get('format');
        const chapterFromUrl = urlParams.get('chapterFrom');
        const chapterToUrl = urlParams.get('chapterTo');
        const branchIdFromUrl = urlParams.get('branchId')
            ? parseInt(urlParams.get('branchId'))
            : null;
        const splitPagesFromUrl = urlParams.get('splitPages');
        const tabIdFromUrl = urlParams.get('tabId') ? parseInt(urlParams.get('tabId')) : null;

        this._applyUrlParams({ formatFromUrl, splitPagesFromUrl, formatSelector: $el('formatSelector') });

        if (btn) btn.disabled = true;
        if (status) status.textContent = 'Получаем информацию...';

        try {
            const resolved = await this._resolveService({
                autoDownload, slugFromUrl, serviceFromUrl, tabIdFromUrl
            });
            if (resolved === null) return;
            const { slug, serviceKey, service, activeTabId } = resolved;

            this._activeTabId = activeTabId;
            if (activeTabId) setServiceTab(activeTabId);
            this.authToken = await AuthManager.apply(serviceKey, activeTabId, service);

            this._applyServiceTheme(serviceKey, siteLogo);

            const showSplit = serviceKey === 'mangalib' || !!service?.config?.splitLongImages;
            setDisplay('splitPagesContainer', showSplit ? 'block' : 'none');

            if (!slug) {
                await this._showNoTitleState();
                return;
            }

            this.currentSlug = slug;
            this.currentServiceKey = serviceKey;
            this.currentService = service;

            log.debug('Fetching metadata for slug:', slug);

            const meta = await service.getManga(slug);
            log.debug('Metadata:', meta);

            const patched = MangaPatcher.patch(meta);
            const chaptersCount = await this.chapterController.loadAndPopulate(
                service, slug, chapterFromUrl, chapterToUrl, branchIdFromUrl
            );

            this._renderMeta({ patched, chaptersCount, slug, coverImg, desc, releaseEl, logoInfo });
            this._setReadyState({ btn, status });

            if (this.chapterController.rangeNotFound) {
                if (status)
                    status.textContent = 'Выбранные главы не найдены в списке глав тайтла: выберите диапазон заново';
                return;
            }
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
            const result = await fetchViaTab(url, this.currentServiceKey);
            if (result.ok) return `data:${result.contentType};base64,${result.base64}`;
            log.warn('Cover fetch failed:', result.error);
        } catch (e) {
            log.warn('Cover fetch failed:', e.message);
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
     * экране тайтла. Клик по скачиванию в выпадающем попапе тулбара переоткрывает
     * попап в отдельном окне с параметрами загрузки в URL, чтобы процесс скачивания
     * не прерывался закрытием попапа.
     * @returns {void}
     */
    setupEventListeners() {
        const downloadBtn = $el('downloadBtn');
        const pauseBtn = $el('pauseBtn');
        const stopBtn = $el('stopBtn');

        if (downloadBtn) {
            downloadBtn.addEventListener('click', async () => {
                const inSeparateWindow = await this.isInSeparateWindow();

                if (!inSeparateWindow) {
                    const url = `${extensionApi.runtime.getURL('popup.html')}?${this._downloadWindowParams()}`;
                    try {
                        await this.openInNewContext(url);
                    } catch (e) {
                        log.error('Failed to create window:', e);
                        await this.startDownload();
                    }
                } else await this.startDownload();
            });
            log.debug('Download button listener attached');
        }

        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => {
                if (this.shouldStop) return;
                this.isPaused = !this.isPaused;
                if (this.isPaused) this.controller?.pause();
                else this.controller?.resume();
                pauseBtn.textContent = this.isPaused ? 'Продолжить' : 'Пауза';
                const status = $el('status');
                if (status) status.textContent = this.isPaused ? 'Пауза...' : 'Загрузка...';
                else log.warn('Status element not found when updating status on pause/resume');
            });
        }

        if (stopBtn) stopBtn.addEventListener('click', () => this.stopDownload());
    }

    /**
     * Параметры URL окна загрузки: тайтл, сервис, вкладка сервиса и выбор в форме
     * (формат, разбиение страниц, ключи первой и последней главы, ветка перевода).
     * Остальные настройки окно загрузки берёт из сохранённых настроек.
     * @returns {URLSearchParams}
     */
    _downloadWindowParams() {
        const formatSelector = $el('formatSelector');
        const splitPagesCheckbox = $el('splitPagesCheckbox');
        const splitPagesContainer = $el('splitPagesContainer');
        const splitPages = !!(splitPagesCheckbox && splitPagesContainer &&
            splitPagesContainer.style.display !== 'none' && splitPagesCheckbox.checked);

        const params = new URLSearchParams({
            download: 'true',
            slug: this.currentSlug,
            service: this.currentServiceKey,
            format: formatSelector ? formatSelector.value : 'fb2',
            splitPages: String(splitPages)
        });
        if (this._activeTabId != null) params.set('tabId', String(this._activeTabId));

        const range = this._buildChapterRange(
            $el('chapterFromSelect'), $el('chapterToSelect'), $el('chapterRangeContainer'));
        if (range) {
            params.set('chapterFrom', range.fromKey);
            params.set('chapterTo', range.toKey);
        } else {
            log.warn('Chapter range selectors not found or not visible ' +
                'when constructing URL parameters for download');
        }

        const translatorSelect = $el('translatorSelect');
        const translatorContainer = $el('translatorContainer');
        if (translatorSelect && translatorContainer && translatorContainer.style.display !== 'none')
            params.set('branchId', translatorSelect.value);
        return params;
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

        this.downloadManager.eventBus.on('download:pages', ({ done, total }) => {
            const statusEl = $el('status');
            if (statusEl && !this.isPaused) statusEl.textContent = `Загружено страниц: ${done}/${total}`;
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
     * @returns {?{fromKey: string, toKey: string}} Ключи первой и последней главы
     * диапазона, либо null, если селекторы/контейнер отсутствуют или скрыты.
     */
    _buildChapterRange(fromSelect, toSelect, container) {
        if (fromSelect && toSelect && container && container.style.display !== 'none')
            return { fromKey: fromSelect.value, toKey: toSelect.value };
        return null;
    }

    /**
     * Переводит интерфейс в состояние "идёт загрузка": скрывает элементы выбора
     * (формат, переводчик, разбиение страниц, диапазон), показывает прогресс-бар
     * и панель с параметрами текущей загрузки, обновляет статус.
     * @param {{btn: HTMLButtonElement, status: ?HTMLElement, rateLimit?: number}} elements -
     * Кнопка скачивания, элемент статуса и лимит запросов в минуту из настроек.
     * @returns {void}
     */
    _setDownloadingUIState({ btn, status, rateLimit = DEFAULT_RATE_LIMIT }) {
        btn.disabled = true;
        setDisplay('downloadBtn', 'none');
        setDisplay('formatContainer', 'none');
        setDisplay('translatorContainer', 'none');
        setDisplay('splitPagesContainer', 'none');
        setDisplay('progress', 'block');
        setDisplay('downloadControls', 'block');
        setDisplay('chapterRangeContainer', 'none');

        const downloadInfoPanel = $el('downloadInfoPanel');
        if (downloadInfoPanel) {
            const formatSelector = $el('formatSelector');
            const formatLabel = formatSelector
                ? (formatSelector.options[formatSelector.selectedIndex]?.text || formatSelector.value)
                : '';
            const { maxSizeMB, maxChapters } = readPartLimit();
            downloadInfoPanel.replaceChildren(
                infoRow('Формат', formatLabel),
                infoRow('Запросов в минуту', rateLimit),
                maxChapters > 0
                    ? infoRow('Макс. глав в части', maxChapters)
                    : infoRow('Макс. размер части', `${maxSizeMB} МБ`));
            setDisplay('downloadInfoPanel', 'block');
        }

        if (status) status.textContent = 'Запуск скачивания...';
    }

    /**
     * Запускает загрузку текущего тайтла: собирает параметры (диапазон глав, ветку
     * перевода, формат, лимиты), переводит UI в состояние загрузки, вызывает
     * downloadManager.startDownload с контроллером паузы/остановки, а по завершении
     * добавляет запись в историю загрузок.
     * @returns {Promise<void>}
     */
    async startDownload() {
        if (!this.currentSlug || !this.currentServiceKey) {
            this.showError('Не удалось определить тайтл');
            return;
        }

        const { btn, formatSelector, status, chapterRangeContainer,
            fromSelect, toSelect } = this._getDownloadElements();

        try {
            const { rateLimit, chapterRange, branchId, historyParams } = await this._prepareDownload({
                fromSelect, toSelect, chapterRangeContainer
            });

            this.isDownloading = true;
            this.isPaused = false;
            this.shouldStop = false;
            this.controller = createController();

            this._setDownloadingUIState({ btn, status, rateLimit });

            const format = formatSelector?.value || 'fb2';
            const { maxSizeMB, maxChapters } = readPartLimit();

            const splitPagesEl = $el('splitPagesCheckbox');
            const splitPages = splitPagesEl ? splitPagesEl.checked : false;
            const fitFb2Images = settingsStorage.get(FIT_FB2_IMAGES_KEY) === 'true';

            await this.downloadManager.startDownload({
                slug: this.currentSlug,
                serviceKey: this.currentServiceKey,
                format,
                chapters: this.chapterController.getChapters(),
                chapterRange,
                branchId,
                maxSizeMB,
                maxChapters,
                splitPages,
                fitFb2Images,
                authToken: this.authToken,
                controller: this.controller
            });

            DownloadHistory.add({
                service: this.currentServiceKey,
                slug: this.currentSlug,
                title: this.currentTitle || this.currentSlug,
                format,
                ...historyParams
            });
        } catch (error) {
            log.error('Download failed:', error);
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
     * Собирает параметры предстоящей загрузки: лимит запросов в минуту из настроек
     * (для панели параметров; сам лимит применяет фон), диапазон глав, ветку
     * перевода и текстовые значения для записи в историю.
     * @param {{fromSelect: ?HTMLSelectElement, toSelect: ?HTMLSelectElement,
     * chapterRangeContainer: ?HTMLElement}} params - Элементы выбора диапазона глав.
     * @returns {Promise<{rateLimit: number, chapterRange: ?{fromKey: string, toKey: string}, branchId: ?number,
     * historyParams: {chapterFrom: ?string, chapterTo: ?string, translator: ?string}}>}
     * Параметры для запуска загрузки и записи в историю.
     */
    async _prepareDownload({ fromSelect, toSelect, chapterRangeContainer }) {
        const rateLimit = await RateLimitClient.getLimit();

        const chapterRange = this._buildChapterRange(fromSelect, toSelect, chapterRangeContainer);

        const translatorSelect = $el('translatorSelect');
        const translatorContainer = $el('translatorContainer');
        const translatorVisible = !!(translatorSelect && translatorContainer &&
            translatorContainer.style.display !== 'none');
        const branchId = translatorVisible ? parseInt(translatorSelect.value) : null;

        return {
            rateLimit,
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
        this.controller?.stop();
        const pauseBtn = $el('pauseBtn');
        const stopBtn = $el('stopBtn');
        if (pauseBtn) pauseBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;
        if (this.currentDownloadId)
            this.downloadManager.stop(this.currentDownloadId);
        const status = $el('status');
        if (status) status.textContent = 'Досрочное завершение...';
        else log.warn('Status element not found when setting status on download stop');
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
        } else log.warn('Status element not found when updating progress status');
        if (progressEl) progressEl.value = percent;
        else log.warn('Progress element not found when updating progress percentage');
    }

    /**
     * Возвращает интерфейс попапа в исходное состояние после завершения, ошибки
     * или остановки загрузки: сбрасывает флаги, снова показывает элементы выбора
     * формата/диапазона глав и переводчика, скрывает прогресс-бар и панель
     * параметров загрузки.
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

        this.currentDownloadId = null;

        const btn = setDisplay('downloadBtn', 'block');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Скачать';
        } else log.warn('Download button not found when resetting UI');
        setDisplay('formatContainer', '');
        setDisplay('downloadInfoPanel', 'none');
        const showSplitOnReset =
            this.currentServiceKey === 'mangalib' || !!this.currentService?.config?.splitLongImages;
        setDisplay('splitPagesContainer', showSplitOnReset ? 'block' : 'none');
        if (!setDisplay('progress', 'none')) log.warn('Progress element not found when resetting UI');
        if (!setDisplay('downloadControls', 'none')) log.warn('Controls container not found when resetting UI');

        const hasChapters = $el('chapterFromSelect')?.options.length > 0;
        if (!setDisplay('chapterRangeContainer', hasChapters ? 'block' : 'none'))
            log.warn('Chapter range container not found when resetting UI');

        const hasTranslators = $el('translatorSelect')?.options.length > 1;
        if (!setDisplay('translatorContainer', hasTranslators ? 'block' : 'none'))
            log.warn('Translator container not found when resetting UI');
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
        } else log.warn('Error element not found when showing error message');
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
        } else log.warn('Success element not found when showing success message');
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
        const ISSUES_URL = `${REPO_URL}/issues`;

        try {
            const cached = settingsStorage.getJSON(CACHE_KEY);
            const useCache = cached && (Date.now() - cached.timestamp < CACHE_TTL);

            if (!useCache) {
                const res = await fetch(API_URL, { cache: 'no-cache' });
                const data = await res.json();
                const conclusion = data.workflow_runs?.[0]?.conclusion;
                const isFailing = conclusion === 'failure';
                settingsStorage.setJSON(CACHE_KEY, { isFailing, timestamp: Date.now() });
                if (isFailing) this._showApiWarning(ISSUES_URL);
                return;
            }

            if (cached.isFailing) this._showApiWarning(ISSUES_URL);
        } catch (e) {
            log.warn('Health check status unavailable:', e.message);
        }
    }

    /**
     * Вставляет перед кнопкой скачивания предупреждение о нестабильности API
     * со ссылкой на страницу issues репозитория.
     * @param {string} repoUrl - URL страницы issues репозитория проекта.
     * @returns {void}
     */
    _showApiWarning(repoUrl) {
        const warning = createEl('div', { attrs: { id: 'apiWarning' } });
        warning.appendChild(createEl('div', {
            text: '⚠️ Некоторые запросы к API могут не работать. ',
            attrs: { id: 'apiWarningMsg' }
        }));

        const link = createEl('a', { text: 'Подробнее на GitHub →', attrs: { id: 'apiWarningLink', href: '#' } });
        link.addEventListener('click', (e) => {
            e.preventDefault();
            extensionApi.tabs.create({ url: repoUrl });
        });
        warning.appendChild(link);

        const downloadBtn = $el('downloadBtn');
        if (downloadBtn && downloadBtn.parentNode)
            downloadBtn.parentNode.insertBefore(warning, downloadBtn);
    }
}
