/**
 * DownloadLib core module
 * Leveled console logger shared by all ES modules of the extension
 * @module core/ConsoleLogger
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

/** Ключ storage.local с уровнем логирования. */
export const LOG_LEVEL_KEY = 'downloadlib_log_level';

/** Уровень логирования по умолчанию. */
export const DEFAULT_LOG_LEVEL = 'warn';

/** Уровни по возрастанию важности; сообщение выводится, если его уровень не ниже текущего. */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Проверяет имя уровня.
 * @param {*} level - Имя уровня.
 * @returns {?string} Имя уровня, либо null, если такого уровня нет.
 */
function normalizeLevel(level) {
    return typeof level === 'string' && Object.hasOwn(LEVELS, level) ? level : null;
}

/**
 * Начальный уровень: DEFAULT_LOG_LEVEL. Тесты задают свой через переменную
 * окружения DOWNLOADLIB_LOG_LEVEL (import.meta.env); в расширении её нет.
 */
const initialLevel = normalizeLevel(import.meta.env?.DOWNLOADLIB_LOG_LEVEL) || DEFAULT_LOG_LEVEL;

let currentLevel = initialLevel;

/**
 * Текущий уровень логирования.
 * @returns {'debug'|'info'|'warn'|'error'}
 */
export function getLogLevel() {
    return currentLevel;
}

/**
 * Задаёт уровень логирования. Пустое или неизвестное значение возвращает
 * начальный уровень.
 * @param {*} level - 'debug', 'info', 'warn' или 'error'.
 * @returns {void}
 */
export function setLogLevel(level) {
    currentLevel = normalizeLevel(level) || initialLevel;
}

/**
 * Создаёт логгер модуля. Сообщения выводятся в консоль методом своего уровня
 * (console.debug/info/warn/error) с префиксом «[scope]»: если первый аргумент —
 * строка, префикс становится её частью, как в прежних console.*-вызовах.
 * @param {string} scope - Имя модуля для префикса.
 * @returns {{debug: function(...*): void, info: function(...*): void,
 * warn: function(...*): void, error: function(...*): void}} Логгер.
 */
export function createLogger(scope) {
    const prefix = `[${scope}]`;
    const method = level => (...args) => {
        if (LEVELS[level] < LEVELS[currentLevel]) return;
        if (typeof args[0] === 'string') console[level](`${prefix} ${args[0]}`, ...args.slice(1));
        else console[level](prefix, ...args);
    };
    return { debug: method('debug'), info: method('info'), warn: method('warn'), error: method('error') };
}

const log = createLogger('Logger');

/**
 * Читает уровень логирования из storage.local и следит за его изменением.
 * Вызывается из точек входа (app.js, background/BackgroundMain.js).
 * @param {?object} api - API расширения (extensionApi).
 * @returns {Promise<void>}
 */
export async function watchLogLevel(api) {
    const storage = api?.storage;
    if (!storage?.local?.get) return;
    storage.onChanged?.addListener?.((changes, area) => {
        if (area === 'local' && changes && LOG_LEVEL_KEY in changes) setLogLevel(changes[LOG_LEVEL_KEY].newValue);
    });
    try {
        const stored = await storage.local.get(LOG_LEVEL_KEY);
        setLogLevel(stored?.[LOG_LEVEL_KEY]);
    } catch (e) {
        log.debug('Failed to read the log level:', e);
    }
}
