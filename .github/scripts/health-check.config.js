/**
 * DownloadLib CI script
 * Browser profiles and titles for the API check. URLs, headers and fetch options
 * are not listed here: the extension code builds them
 * @module .github/scripts/health-check.config
 * @license MIT
 * @author ivanvit
 * @version 1.1.1
 */

/**
 * Браузеры, от имени которых повторяются запросы расширения (см. BrowserProfile
 * в lib/browser-fetch.js). Версии в User-Agent стоит обновлять вместе с браузерами.
 * @type {import('./lib/browser-fetch.js').BrowserProfile[]}
 */
export const browsers = [
    {
        name: 'Firefox',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:155.0) Gecko/20100101 Firefox/155.0',
        acceptLanguage: 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
        headers: { 'priority': 'u=4' },
        networkError: 'NetworkError when attempting to fetch resource.'
    },
    {
        name: 'Chrome',
        userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36`,
        acceptLanguage: 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        headers: {
            'sec-ch-ua': '"Chromium";v="152", "Google Chrome";v="152", "Not_A Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Linux"',
            'priority': 'u=1, i'
        },
        networkError: 'Failed to fetch'
    }
];

/**
 * Тайтл, на котором проверяется сервис.
 * @typedef {object} TitleCheck
 * @property {string} service - Ключ встроенного сервиса.
 * @property {string} slug - Slug тайтла.
 * @property {object} metadata - Поля метаданных после MangaPatcher.patch, которые должны совпасть.
 * @property {number} minChapterImages - Сколько изображений минимум должно загрузиться в первой главе.
 */

/**
 * Тайтлы для проверки: по одному на встроенный сервис.
 * @type {TitleCheck[]}
 */
export const titles = [
    {
        service: 'mangalib',
        slug: '6435--kaguya-sama-wa-kokurasetai-tensai-tachi-no-renai-zunousen',
        metadata: {
            'id': 6435,
            'slug_url': '6435--kaguya-sama-wa-kokurasetai-tensai-tachi-no-renai-zunousen',
            'site': 1
        },
        minChapterImages: 1
    },
    {
        service: 'ranobelib',
        slug: '62340--the-angel-next-door-spoils-me-rotten',
        metadata: { 'id': 62340, 'slug_url': '62340--the-angel-next-door-spoils-me-rotten', 'site': 3 },
        minChapterImages: 1
    }
];
