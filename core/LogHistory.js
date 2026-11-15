/**
 * DownloadLib core module
 * Keeps the latest warnings and errors of the extension pages for bug reports
 * @module core/LogHistory
 * @license MIT
 * @author ivanvit
 * @version 1.1.1
 */

import { createLogger, setLogSink } from './ConsoleLogger.js';
import { extensionApi } from './BrowserApi.js';

const log = createLogger('LogHistory');

export const LOG_HISTORY_KEY = 'downloadlib_log_history';
export const LOG_HISTORY_LIMIT = 20;

const RECORDED_LEVELS = new Set(['warn', 'error']);
const MAX_TEXT_LENGTH = 500;
const LOCK_NAME = 'downloadlib-log-history';

const SECRET_PATTERNS = [
    [/Bearer\s+[\w.~+/-]+=*/gi, 'Bearer <token>'],
    [/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '<token>']
];

let pending = [];
let saving = null;

/**
 * Превращает аргумент вызова логгера в текст: ошибку - в "имя: сообщение",
 * объект - в JSON, остальное - в строку.
 * @param {*} arg - Аргумент вызова логгера.
 * @returns {string} Текстовое представление аргумента.
 */
function describeArg(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (arg && typeof arg === 'object') {
        try {
            return JSON.stringify(arg);
        } catch (e) {
            log.debug('Failed to serialize a log argument:', e);
        }
    }
    return String(arg);
}

/**
 * Собирает текст записи журнала, как его выводит консоль, маскирует токены
 * авторизации и обрезает слишком длинный текст.
 * @param {string} scope - Модуль, записавший сообщение.
 * @param {Array<*>} args - Аргументы вызова логгера.
 * @returns {string} Текст записи.
 */
function entryText(scope, args) {
    const text = SECRET_PATTERNS.reduce(
        (result, [pattern, replacement]) => result.replace(pattern, replacement),
        [`[${scope}]`, ...args.map(describeArg)].join(' ')
    );
    return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}...` : text;
}

/**
 * Выполняет задачу под блокировкой Web Locks, общей для всех страниц
 * расширения, чтобы окна не перезаписывали записи друг друга. Без Web Locks
 * задача выполняется сразу.
 * @param {function(): Promise<void>} task - Задача.
 * @returns {Promise<void>}
 */
function withLock(task) {
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request(LOCK_NAME, task) : task();
}

/**
 * Дописывает накопленные записи в журнал в storage.local, оставляя
 * LOG_HISTORY_LIMIT самых свежих.
 * @returns {Promise<void>}
 */
async function flush() {
    const batch = pending;
    pending = [];
    await withLock(async () => {
        const entries = await readLogHistory();
        await extensionApi.storage.local.set({
            [LOG_HISTORY_KEY]: [...entries, ...batch].slice(-LOG_HISTORY_LIMIT)
        });
    });
}

/**
 * Запускает запись накопленных записей в следующей микрозадаче, чтобы записи
 * одного синхронного участка кода ушли одной записью. Записи, появившиеся во
 * время записи, сохраняются следующим проходом. Ошибка записи пишется только
 * на уровне debug: предупреждение снова попало бы в журнал и зациклило запись.
 * @returns {void}
 */
function startSaving() {
    saving = Promise.resolve()
        .then(flush)
        .catch(e => log.debug('Failed to save the log history:', e))
        .finally(() => {
            saving = null;
            if (pending.length) startSaving();
        });
}

/**
 * Получатель записей логгера: сохраняет предупреждения и ошибки в журнал.
 * @param {string} level - Уровень записи.
 * @param {string} scope - Модуль, записавший сообщение.
 * @param {Array<*>} args - Аргументы вызова логгера.
 * @returns {void}
 */
function record(level, scope, args) {
    if (!RECORDED_LEVELS.has(level)) return;
    pending.push({ time: Date.now(), level, text: entryText(scope, args) });
    if (!saving) startSaving();
}

/**
 * Включает журнал предупреждений и ошибок страницы расширения: записи уровней
 * warn и error всех логгеров сохраняются независимо от уровня вывода в консоль.
 * Вызывается из точки входа страниц расширения (app.js). Без storage.local
 * журнал не ведётся.
 * @returns {void}
 */
export function startLogHistory() {
    if (!extensionApi?.storage?.local?.set) return;
    setLogSink(record);
}

/**
 * Читает журнал предупреждений и ошибок из storage.local. Ошибку чтения
 * хранилища пробрасывает.
 * @returns {Promise<Array<{time: number, level: string, text: string}>>} Записи от старых к новым.
 */
export async function readLogHistory() {
    const storage = extensionApi?.storage?.local;
    if (!storage?.get) return [];
    const stored = await storage.get(LOG_HISTORY_KEY);
    const entries = stored?.[LOG_HISTORY_KEY];
    return Array.isArray(entries) ? entries : [];
}

/**
 * Форматирует запись журнала одной строкой: время в UTC, уровень и текст.
 * @param {{time: number, level: string, text: string}} entry - Запись журнала.
 * @returns {string} Строка вида "2026-11-14T17:03:11.123Z WARN [Scope] текст".
 */
export function formatLogEntry(entry) {
    return `${new Date(entry.time).toISOString()} ${entry.level.toUpperCase()} ${entry.text}`;
}
