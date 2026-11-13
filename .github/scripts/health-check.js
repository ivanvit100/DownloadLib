/**
 * DownloadLib CI script
 * API check: the extension's own code repeats the popup and download requests the
 * way a service tab of Firefox and Chrome would send them, with CORS checks
 * @module .github/scripts/health-check
 * @license MIT
 * @author ivanvit
 * @version 1.1.1
 */

import { browsers, titles } from './health-check.config.js';
import { createBrowserFetch } from './lib/browser-fetch.js';
import { createExtensionEnv } from './lib/extension-env.js';

/** Корень репозитория: отсюда загружаются модули расширения. */
const ROOT = new URL('../../', import.meta.url);

/** Токен шага "вошедший пользователь": сервер его не примет, проверяется только CORS. */
const CI_AUTH_TOKEN = 'downloadlib-ci-invalid-token';

/** Сколько заблокированных или неудачных запросов показывать на одну ошибку. */
const MAX_REQUESTS_PER_STEP = 5;

/** Максимальная длина сообщения Telegram. */
const TELEGRAM_LIMIT = 4096;

/** Пауза перед повторной проверкой тайтла, на котором были ошибки. */
const RETRY_DELAY_MS = 30000;

/**
 * Результат шага проверки.
 * @typedef {object} StepResult
 * @property {string} id - Браузер, сервис и шаг для отчёта.
 * @property {string} url - Страница тайтла, из вкладки которой шли запросы.
 * @property {string} details - Что получено, если шаг прошёл.
 * @property {?string} skipped - Почему шаг не выполнялся (не выполнен шаг, от которого он зависит).
 * @property {string[]} errors - Ошибки шага и заблокированные или неудачные запросы.
 */

/**
 * Шаг нельзя выполнить: не выполнен шаг, от которого он зависит. Такой шаг не
 * считается ошибкой: ошибкой считается шаг, от которого он зависит.
 */
class SkippedStep extends Error {}

/**
 * Подставляет API расширения и загружает модули расширения: фон (обработчики
 * сообщений, лимит запросов, токены) и то, чем пользуются попап и загрузка.
 * Уровень логов расширения: только ошибки. Предупреждения о повторах и об
 * отсутствии canvas в Node заменяет журнал запросов.
 * @returns {Promise<object>} API вкладок и модули расширения.
 */
async function loadExtension() {
    const env = createExtensionEnv();
    globalThis.chrome = env.api;
    const load = path => import(new URL(path, ROOT).href);

    const { setLogLevel } = await load('core/ConsoleLogger.js');
    setLogLevel('error');
    await load('background/MessageRouter.js');
    const [
        { serviceRegistry }, { setServiceTab }, { AuthManager }, { MangaPatcher }, { filterByBranch }, { buildTitleUrl }
    ] = await Promise.all([
        load('services/BuiltinServices.js'),
        load('core/TabNetwork.js'),
        load('core/AuthManager.js'),
        load('core/MangaPatcher.js'),
        load('core/ChapterList.js'),
        load('services/ServiceHosts.js')
    ]);
    return { env, serviceRegistry, setServiceTab, AuthManager, MangaPatcher, filterByBranch, buildTitleUrl };
}

/**
 * Сокращает URL для отчёта: без query.
 * @param {string} url - URL запроса.
 * @returns {string}
 */
function shortUrl(url) {
    const { origin, pathname, search } = new URL(url);
    return `${origin}${pathname}${search ? '?...' : ''}`;
}

/**
 * Описывает заблокированные и неудачные запросы шага, объединяя повторы.
 * @param {import('./lib/browser-fetch.js').RequestRecord[]} records - Запросы шага.
 * @returns {string[]}
 */
function describeRequests(records) {
    const counts = new Map();
    for (const { method, url, status, blocked } of records) {
        if (!blocked && status < 400) continue;
        const text = `${method} ${shortUrl(url)}: ${blocked ? blocked.reason : `HTTP ${status}`}`;
        counts.set(text, (counts.get(text) || 0) + 1);
    }
    return [...counts].slice(0, MAX_REQUESTS_PER_STEP)
        .map(([text, count]) => (count > 1 ? `${text} (повторов: ${count})` : text));
}

/**
 * Повторяет на тайтле действия попапа и загрузки в профиле браузера: открывает
 * вкладку сервиса, ищет токен, загружает метаданные, обложку, список глав и
 * первую главу с изображениями, затем запрос метаданных с заголовком Authorization.
 * Шаг провален, если код расширения завершился ошибкой или браузер заблокировал
 * хотя бы один запрос по CORS (даже если расширение продолжило без него).
 * @param {object} ext - Модули расширения (см. loadExtension).
 * @param {import('./lib/browser-fetch.js').BrowserProfile} profile - Профиль браузера.
 * @param {import('./health-check.config.js').TitleCheck} title - Тайтл.
 * @returns {Promise<StepResult[]>}
 */
async function checkTitle(ext, profile, title) {
    const service = ext.serviceRegistry.createService(title.service);
    const pageUrl = ext.buildTitleUrl(service.config.titleUrl, title.slug);
    const journal = [];
    const tabId = ext.env.openTab(pageUrl,
        createBrowserFetch({ pageUrl, profile, onRequest: record => journal.push(record) }));
    ext.setServiceTab(tabId);
    await ext.AuthManager.apply(service.name, tabId, service);

    const results = [];
    const step = async (name, run) => {
        const from = journal.length;
        const errors = [];
        let details = '';
        let skipped = null;
        try {
            details = (await run()) || '';
        } catch (e) {
            if (e instanceof SkippedStep) skipped = e.message;
            else errors.push(e.message);
        }
        const records = journal.slice(from);
        if (!errors.length && records.some(record => record.blocked?.kind === 'cors'))
            errors.push('браузер заблокировал запросы по CORS, расширение продолжило без них');
        if (errors.length) errors.push(...describeRequests(records));
        results.push({ id: `${profile.name} / ${service.config.label}: ${name}`, url: pageUrl, details, skipped, errors });
    };

    let manga = null;
    let chapters = [];
    await step('метаданные', async () => {
        manga = ext.MangaPatcher.patch(await service.getManga(title.slug));
        for (const [key, value] of Object.entries(title.metadata))
            if (manga[key] !== value) throw new Error(`поле ${key}: ожидалось ${value}, получено ${manga[key]}`);
        return manga.rus_name || manga.name;
    });
    await step('обложка', async () => {
        if (!manga) throw new SkippedStep('метаданные не получены');
        if (!manga.cover) throw new Error('в метаданных нет URL обложки');
        const image = await service.fetchImage(manga.cover);
        if (!image.ok) throw new Error(`обложка не загрузилась: ${image.error || `HTTP ${image.status}`}`);
        if (!image.base64 || !image.contentType.startsWith('image/'))
            throw new Error(`вместо изображения получено ${image.contentType}`);
        return `${image.contentType}, ${image.base64.length} символов base64`;
    });
    await step('список глав', async () => {
        chapters = await service.fetchChapters(title.slug);
        if (!chapters.length) throw new Error('список глав пуст');
        return `глав: ${chapters.length}`;
    });
    await step('глава', async () => {
        const branchId = chapters[0]?.branches?.[0]?.branch_id ?? null;
        const [chapter] = ext.filterByBranch(chapters, branchId);
        if (!chapter) throw new SkippedStep('список глав не получен');
        const blocks = await service.fetchChapterBlocks(chapter, {
            slug: title.slug, mangaId: manga?.id ?? null, splitLongImages: true, imageFit: null
        });
        const images = blocks.filter(block => block.type === 'image' && block.data?.base64);
        const failed = blocks.filter(block => block.type === 'text' && block.text?.startsWith('[Ошибка загрузки'));
        if (failed.length) throw new Error(`не загрузились изображения: ${failed.length} из ${failed.length + images.length}`);
        if (images.length < title.minChapterImages)
            throw new Error(`загрузилось изображений: ${images.length}, ожидалось не меньше ${title.minChapterImages}`);
        return `том ${chapter.volume}, глава ${chapter.number}: блоков ${blocks.length}, изображений ${images.length}`;
    });
    await step('запрос с токеном авторизации', async () => {
        const authorized = ext.serviceRegistry.createService(title.service);
        authorized.setAuthToken(CI_AUTH_TOKEN);
        const from = journal.length;
        try {
            await authorized.getManga(title.slug);
            return 'сервер принял запрос';
        } catch (e) {
            if (!journal.slice(from).some(record => record.status === 401)) throw e;
            return 'сервер отклонил токен (401), но CORS пропустил запрос';
        }
    });
    return results;
}

/**
 * Проверяет тайтл и, если были ошибки, через паузу проверяет его ещё раз: в отчёт
 * попадает второй результат. Так разовый сетевой сбой не делает запуск красным
 * (а красный запуск показывает предупреждение в попапе у всех пользователей),
 * а отказ CORS или ошибка сервера повторяются и попадают в отчёт.
 * @param {object} ext - Модули расширения (см. loadExtension).
 * @param {import('./lib/browser-fetch.js').BrowserProfile} profile - Профиль браузера.
 * @param {import('./health-check.config.js').TitleCheck} title - Тайтл.
 * @returns {Promise<StepResult[]>}
 */
async function checkTitleWithRetry(ext, profile, title) {
    const first = await checkTitle(ext, profile, title);
    const failed = first.filter(result => result.errors.length > 0);
    if (!failed.length) return first;
    console.log(`  ошибки, повтор через ${RETRY_DELAY_MS / 1000} с:`);
    for (const result of failed) console.log(`    ${result.id}: ${result.errors.join('; ')}`);
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    return checkTitle(ext, profile, title);
}

/**
 * Экранирует текст для HTML-разметки Telegram.
 * @param {string} text - Текст.
 * @returns {string}
 */
function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Слово "ошибка" в форме для числа.
 * @param {number} count - Число ошибок.
 * @returns {string}
 */
function errorsWord(count) {
    const tens = count % 100;
    const units = count % 10;
    if (tens >= 11 && tens <= 14) return 'ошибок';
    if (units === 1) return 'ошибка';
    return units >= 2 && units <= 4 ? 'ошибки' : 'ошибок';
}

/**
 * Собирает сообщение об ошибках для Telegram, не длиннее лимита: не поместившиеся
 * ошибки заменяются строкой с их числом.
 * @param {StepResult[]} failed - Проваленные шаги.
 * @returns {string} Сообщение с HTML-разметкой.
 */
function telegramMessage(failed) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const head = `⚠️ <b>Health Check — ${failed.length} ${errorsWord(failed.length)}</b>\n<i>${now} UTC</i>`;
    let message = head;
    for (const [index, result] of failed.entries()) {
        const errors = result.errors.map(error => `  • ${escapeHtml(error)}`).join('\n');
        const block = `\n\n🔴 <b>${escapeHtml(result.id)}</b>\n<code>${escapeHtml(result.url)}</code>\n${errors}`;
        const rest = `\n\n...и ещё ${failed.length - index}`;
        if (message.length + block.length + rest.length > TELEGRAM_LIMIT) return message + rest;
        message += block;
    }
    return message;
}

/**
 * Отправляет текстовое сообщение (HTML-разметка) в чат Telegram через Bot API.
 * @param {string} token - Токен Telegram-бота.
 * @param {string} chatId - id чата/пользователя-получателя.
 * @param {string} text - Текст сообщения (поддерживает HTML-разметку Telegram).
 * @returns {Promise<void>}
 * @throws {Error} Если Telegram API вернул ошибку.
 */
async function sendTelegram(token, chatId, text) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            'chat_id': chatId,
            text,
            'parse_mode': 'HTML',
            'disable_web_page_preview': true
        })
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Telegram API вернул ${res.status}: ${body}`);
    }
}

/**
 * Точка входа: проверяет все тайтлы во всех профилях браузеров, печатает
 * результат в лог и, если есть проваленные шаги, отправляет отчёт в Telegram и
 * завершает процесс с ненулевым кодом (провал шага CI). Без TG_BOT_TOKEN и
 * TG_USER_ID в GitHub Actions проверка не запускается, а локально отчёт
 * печатается только в консоль.
 * @returns {Promise<void>}
 */
async function main() {
    const tgBotToken = process.env.TG_BOT_TOKEN;
    const tgUserId = process.env.TG_USER_ID;
    const telegram = Boolean(tgBotToken && tgUserId);

    if (!telegram && process.env.GITHUB_ACTIONS) {
        console.error('Ошибка: TG_BOT_TOKEN и TG_USER_ID должны быть заданы в секретах репозитория.');
        process.exit(1);
    }
    if (!telegram) console.warn('TG_BOT_TOKEN и TG_USER_ID не заданы: отчёт будет только в консоли.\n');

    const ext = await loadExtension();
    const results = [];
    for (const profile of browsers) {
        for (const title of titles) {
            console.log(`Проверка: ${profile.name}, ${title.service}...`);
            results.push(...await checkTitleWithRetry(ext, profile, title));
        }
    }

    const failed = results.filter(r => r.errors.length > 0);
    const skipped = results.filter(r => r.skipped && r.errors.length === 0);
    const passed = results.filter(r => !r.skipped && r.errors.length === 0);

    console.log('');
    for (const r of passed)
        console.log(`✅ [${r.id}] OK${r.details ? `: ${r.details}` : ''}`);

    for (const r of skipped)
        console.log(`-- [${r.id}] SKIPPED: ${r.skipped}`);

    for (const r of failed) {
        console.log(`❌ [${r.id}] FAILED`);
        for (const e of r.errors)
            console.log(`   • ${e}`);
    }

    console.log(`\nИтог: ${passed.length} прошли, ${failed.length} упали, ${skipped.length} пропущены.`);

    if (failed.length > 0 && telegram) {
        try {
            await sendTelegram(tgBotToken, tgUserId, telegramMessage(failed));
            console.log('Уведомление в Telegram отправлено.');
        } catch (err) {
            console.error(`Не удалось отправить Telegram-уведомление: ${err.message}`);
        }
    }

    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('Критическая ошибка:', err);
    process.exit(1);
});
