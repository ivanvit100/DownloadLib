/**
 * DownloadLib core module
 * Collects diagnostic information about the extension, the browser and the OS
 * @module core/Diagnostics
 * @license MIT
 * @author ivanvit
 * @version 1.1.1
 */

import { createLogger } from './ConsoleLogger.js';
import { extensionApi } from './BrowserApi.js';

const log = createLogger('Diagnostics');

export const UNKNOWN_VALUE = 'неизвестно';

const OS_NAMES = {
    win: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android',
    cros: 'ChromeOS', openbsd: 'OpenBSD', fuchsia: 'Fuchsia'
};

const CHROMIUM_BRAND = 'Chromium';
const NOT_A_BRAND = /not.a.brand/i;

/**
 * Читает необязательный источник данных браузера. Ошибка не прерывает сбор
 * информации: она пишется в лог, а значение считается неизвестным.
 * @param {string} what - Что читается, для лога.
 * @param {function(): *} read - Чтение источника (может вернуть промис).
 * @returns {Promise<*>} Результат чтения, либо null, если источника нет или чтение упало.
 */
async function safeRead(what, read) {
    try {
        return (await read()) ?? null;
    } catch (e) {
        log.debug(`Failed to read ${what}:`, e);
        return null;
    }
}

/**
 * Читает значения userAgentData с высокой энтропией: список брендов с полными
 * версиями и версию платформы. Есть только в браузерах на Chromium.
 * @returns {Promise<?{platform?: string, platformVersion?: string,
 * fullVersionList?: Array<{brand: string, version: string}>}>} Значения, либо null.
 */
function readUaData() {
    return safeRead('userAgentData', () =>
        globalThis.navigator?.userAgentData?.getHighEntropyValues(['fullVersionList', 'platformVersion']));
}

/**
 * Формирует название браузера на Chromium по брендам userAgentData: конкретные
 * бренды с версиями и версия движка Chromium в скобках.
 * @param {Array<{brand: string, version: string}>} brands - Бренды с полными версиями.
 * @returns {?string} Название браузера, либо null, если брендов нет.
 */
function chromiumBrowserName(brands) {
    const engine = brands.find(({ brand }) => brand === CHROMIUM_BRAND);
    const engineName = engine ? `${CHROMIUM_BRAND} ${engine.version}` : null;
    const named = brands
        .filter(({ brand }) => brand !== CHROMIUM_BRAND && !NOT_A_BRAND.test(brand))
        .map(({ brand, version }) => `${brand} ${version}`)
        .join(', ');
    if (!named) return engineName;
    return engineName ? `${named} (${engineName})` : named;
}

/**
 * Определяет название и версию браузера: в Firefox через runtime.getBrowserInfo,
 * в Chromium по брендам userAgentData.
 * @param {?object} uaData - Значения userAgentData с высокой энтропией.
 * @returns {Promise<string>} Название и версия браузера.
 */
async function readBrowser(uaData) {
    const info = await safeRead('browser info', () => extensionApi?.runtime?.getBrowserInfo?.());
    if (info?.name)
        return [info.name, info.version, info.buildID && `(${info.buildID})`].filter(Boolean).join(' ');
    return (uaData?.fullVersionList && chromiumBrowserName(uaData.fullVersionList)) || UNKNOWN_VALUE;
}

/**
 * Называет версию Windows по platformVersion из userAgentData: 13 и выше -
 * Windows 11, от 1 до 12 - Windows 10, 0 - Windows 7, 8 и 8.1.
 * @param {string} platformVersion - Версия платформы.
 * @returns {string} Название версии Windows.
 */
function windowsName(platformVersion) {
    const major = parseInt(platformVersion, 10);
    if (major >= 13) return 'Windows 11';
    if (major >= 1) return 'Windows 10';
    return major === 0 ? 'Windows 7/8/8.1' : OS_NAMES.win;
}

/**
 * Определяет ОС через runtime.getPlatformInfo. В Chromium название дополняется
 * версией платформы из userAgentData, по которой различаются Windows 10 и 11.
 * @param {?object} uaData - Значения userAgentData с высокой энтропией.
 * @returns {Promise<string>} Название и, если известна, версия ОС.
 */
async function readOs(uaData) {
    const platform = await safeRead('platform info', () => extensionApi?.runtime?.getPlatformInfo?.());
    const name = OS_NAMES[platform?.os] || platform?.os || uaData?.platform;
    if (!name) return UNKNOWN_VALUE;
    const version = uaData?.platformVersion;
    if (!version) return name;
    return name === OS_NAMES.win ? `${windowsName(version)} (${version})` : `${name} ${version}`;
}

/**
 * Собирает отладочную информацию для диагностики проблем пользователя: версию
 * расширения, браузер, ОС и User-Agent. Токены, адреса вкладок и история
 * загрузок в неё не входят.
 * @returns {Promise<Array<{label: string, value: string}>>} Пункты в порядке вывода.
 */
export async function collectDiagnostics() {
    const uaData = await readUaData();
    const [browser, os] = await Promise.all([readBrowser(uaData), readOs(uaData)]);
    return [
        { label: 'Версия расширения', value: extensionApi?.runtime?.getManifest?.()?.version || UNKNOWN_VALUE },
        { label: 'Браузер', value: browser },
        { label: 'ОС', value: os },
        { label: 'User-Agent', value: globalThis.navigator?.userAgent || UNKNOWN_VALUE }
    ];
}

/**
 * Форматирует отладочную информацию в текст для отчёта об ошибке: по пункту в строке.
 * @param {Array<{label: string, value: string}>} items - Пункты из collectDiagnostics.
 * @returns {string} Текст вида "Название: значение".
 */
export function formatDiagnostics(items) {
    return items.map(({ label, value }) => `${label}: ${value}`).join('\n');
}
