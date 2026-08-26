/**
 * DownloadLib — пример плагина сервиса
 * Добавляет поддержку нового сайта с мангой
 * @module plugins/ServicePlugin
 * @license MIT
 * @author ivanvit
 * @version 1.0.9
 *
 * Установка: открыть настройки DownloadLib → Плагины → Добавить плагин → выбрать этот файл
 *
 * --- ТЕГИ МЕТАДАННЫХ ПЛАГИНА ---
 * Тег `dl-service` заменяет `dl-format` для сервисных плагинов.
 * Значение — уникальный ключ сервиса в нижнем регистре, латиницей.
 * Он используется в ServiceRegistry и в URL-матчере кнопки загрузки.
 *
 * @dl-service hlib
 * @dl-service-label HLib
 * @dl-host hentailib.me
 * @dl-host hentailib.org
 */

/*
 * @dl-service-config
 * {
 *   "name": "hlib",
 *   "baseUrl": "https://api.cdnlibs.org",
 *   "imagesDomain": "https://img3h.hentaicdn.org",
 *   "siteId": "4",
 *   "fields": [
 *     "background", "eng_name", "summary", "releaseDate",
 *     "genres", "tags", "authors", "chap_count", "status_id"
 *   ],
 *   "headers": {
 *     "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0",
 *     "Accept": "application/json",
 *     "Accept-Language": "ru,en-US;q=0.9,en;q=0.8",
 *     "Site-Id": "4",
 *     "X-DL-Service": "hlib",
 *     "Content-Type": "application/json",
 *     "Client-Time-Zone": "Europe/Moscow",
 *     "Referer": "https://hentailib.me/",
 *     "Origin": "https://hentailib.me",
 *     "Sec-GPC": "1",
 *     "Sec-Fetch-Dest": "empty",
 *     "Sec-Fetch-Mode": "cors",
 *     "Sec-Fetch-Site": "cross-site",
 *     "Connection": "keep-alive"
 *   },
 *   "imageHeaders": {
 *     "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0",
 *     "Accept": "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8",
 *     "Accept-Language": "ru,en-US;q=0.9,en;q=0.8",
 *     "Referer": "https://hentailib.me/",
 *     "Sec-Fetch-Dest": "image",
 *     "Sec-Fetch-Mode": "no-cors",
 *     "Sec-Fetch-Site": "cross-site",
 *     "Connection": "keep-alive"
 *   },
 *   "splitLongImages": true,
 *   "maxImageHeight": 1800,
 *   "label": "HLib",
 *   "siteUrl": "https://hentailib.me",
 *   "primaryColor": "#e53935",
 *   "secondaryColor": "#c62828",
 *   "logo": "https://github.com/ivanvit100/DownloadLib/blob/master/icons/logo3.png?raw=true"
 * }
 */

'use strict';

// Каждый плагин ОБЯЗАН быть обёрнут в IIFE.
// Параметр `global` = `window` в popup-странице, `self` в service worker.
// Все глобалы DownloadLib доступны только через него.
(function(global) {
    if (!global.BaseService) {
        console.error('[ServicePlugin] BaseService not found — load after DownloadLib');
        return;
    }

    // Конфигурация сервиса — передаётся в конструктор BaseService.
    const SERVICE_CONFIG = {
        // Уникальный ключ сервиса — обязан совпадать с @dl-service.
        name: 'hlib',

        // Базовый URL REST API
        // BaseService строит запросы вида: baseUrl + '/api/manga/' + slug
        baseUrl: 'https://api.cdnlibs.org',

        // Домен CDN, откуда загружаются изображения.
        imagesDomain: 'https://img3h.hentaicdn.org',

        // Числовой ID сайта — подставляется в заголовок Site-Id MangaLib запросов к API.
        // Если сайт не требует этого заголовка, удалите поле и уберите его из headers.
        siteId: '4',

        // Поля метаданных манги, которые нужно запросить у API.
        // Передаются как ?fields[]=... в запросе fetchMangaMetadata().
        // Оставьте только те, которые реально возвращает этот API.
        fields: [
            'background', 'eng_name', 'summary', 'releaseDate',
            'genres', 'tags', 'authors', 'chap_count', 'status_id'
        ],

        // Заголовки для API-запросов (metadata, chapters, chapter).
        // Минимально необходимый набор — остальное подберите через DevTools сайта.
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
            'Accept': '*/*',
            'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8',
            'Site-Id': '4',
            'X-DL-Service': 'hlib',
            'Content-Type': 'application/json',
            'Client-Time-Zone': 'Europe/Moscow',
            'Referer': 'https://hentailib.me/',
            'Origin':  'https://hentailib.me',
            'Sec-GPC': '1',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
            'Connection': 'keep-alive'
        },

        // Заголовки специально для запросов изображений.
        // Обычно отличаются Accept и Sec-Fetch-Dest.
        imageHeaders: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
            'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
            'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8',
            'Referer': 'https://hentailib.me/',
            'Sec-Fetch-Dest': 'image',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Site': 'cross-site',
            'Connection': 'keep-alive'
        },

        // Разрезать очень длинные (веб-лонги) изображения на части для читалок.
        splitLongImages: true,

        // Максимальная высота одной части в пикселях при разрезании.
        maxImageHeight: 1800,

        // Цвета темы UI и путь к логотипу.
        label: 'HLib',
        siteUrl: 'https://hentailib.me',
        primaryColor: '#e53935',
        secondaryColor: '#c62828',
        logo: 'https://github.com/ivanvit100/DownloadLib/blob/master/icons/logo4.png?raw=true'
    };

    class MyService extends global.BaseService {
        constructor() {
            super(SERVICE_CONFIG);
        }

        // Метод ОБЯЗАТЕЛЕН. Возвращает true, если URL принадлежит этому сервису.
        static matches(url) {
            try {
                const { hostname } = new URL(url);
                return /hentailib\.me$/i.test(hostname);
            } catch {
                return false;
            }
        }

        // Преобразует ответ API главы в плоский массив объектов страниц.
        // content — данные из fetchChapter() → data.chapter (или аналогичное поле).
        //
        // Возвращаемый формат: [{ type: 'image', src: '<url или filename>' }]
        // DownloadManager передаёт каждый src в resolvePageUrl() → loadPageAsBase64().
        extractText(content) {
            const pages = this.extractPages(content);
            return pages.map(page => ({
                type: 'image',
                src: page.url || page.filename || page.src || String(page)
            }));
        }

        // Строит полный URL изображения из относительного пути или частичного URL.
        // filename — значение поля src из extractText().
        resolvePageUrl(filename) {
            if (!filename) return null;
            const str = String(filename);
            if (/^https?:\/\//i.test(str)) return str;
            return str.startsWith('/')
                ? `${SERVICE_CONFIG.imagesDomain}${str}`
                : `${SERVICE_CONFIG.imagesDomain}/${str}`;
        }

        // Загружает одну страницу и возвращает { base64, contentType }.
        // ref — объект страницы из extractText(); opts — настройки сжатия.
        //
        // Базовая реализация использует background-сообщение 'fetchImage',
        // которое обходит CORS через вкладку с сайтом. Переопределяйте только
        // если сайт требует нестандартного способа загрузки (токены, сессии и т.п.).
        async loadPageAsBase64(ref, opts = {}) {
            const url = this.resolvePageUrl(ref?.src || ref);
            if (!url) return null;

            const api = this.extensionApi;
            if (!api?.runtime?.sendMessage) {
                console.error(`[${this.name}] browser.runtime недоступен`);
                return null;
            }

            const response = await api.runtime.sendMessage({ action: 'fetchImage', url });
            if (!response?.ok) {
                console.warn(`[${this.name}] Не удалось загрузить ${url}:`, response?.error);
                return null;
            }

            // Опционально: сжатие и разрезание длинных изображений.
            const compressOpts = {
                format:  opts.compressionFormat  || 'image/jpeg',
                quality: opts.compressionQuality || 0.92
            };
            if (SERVICE_CONFIG.splitLongImages && global.ImageCompressor)
                return global.ImageCompressor.compress(response.base64, response.contentType, compressOpts);

            return { base64: response.base64, contentType: response.contentType };
        }
    }

    if (!global.serviceRegistry) {
        console.error('[ServicePlugin] serviceRegistry not found — plugin will not be available');
        return;
    }

    // Регистрация в реестре сервисов.
    // После этой строки DownloadLib будет предлагать этот сервис
    // на страницах, для которых matches() возвращает true.
    global.serviceRegistry.register(MyService);
    console.log(`[ServicePlugin] Сервис "${SERVICE_CONFIG.name}" зарегистрирован`);
})(typeof window !== 'undefined' ? window : self);
