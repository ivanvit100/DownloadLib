/**
 * DownloadLib CI script
 * Browser-like fetch of a service page: browser headers, CORS preflight,
 * CORS checks and response filtering as in the Fetch standard
 * @module .github/scripts/lib/browser-fetch
 * @license MIT
 * @author ivanvit
 * @version 1.1.1
 */

/** Методы, для которых preflight не нужен. */
const SAFELISTED_METHODS = new Set(['GET', 'HEAD', 'POST']);

/** Методы, имя которых браузер приводит к верхнему регистру. */
const NORMALIZED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);

/** Значения Content-Type, с которыми заголовок не требует preflight. */
const SAFELISTED_CONTENT_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']);

/** Заголовки ответа, которые страница видит без Access-Control-Expose-Headers. */
const SAFELISTED_RESPONSE_HEADERS = new Set([
    'cache-control', 'content-language', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma'
]);

/**
 * Заголовки запроса, которые страница задать не может: браузер их отбрасывает
 * и при необходимости ставит сам. User-Agent тоже ставит браузер (как Chrome).
 */
const FORBIDDEN_REQUEST_HEADERS = new Set([
    'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
    'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin',
    'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'user-agent', 'via'
]);

/** Заголовки ответа, которые страница не видит никогда. */
const FORBIDDEN_RESPONSE_HEADERS = new Set(['set-cookie', 'set-cookie2']);

/** Символы, с которыми значение заголовка перестаёт быть CORS-безопасным. */
const UNSAFE_HEADER_CHARS = new Set(['"', '(', ')', ':', '<', '>', '?', '@', '[', '\\', ']', '{', '}', '\x7F']);

/** Допустимые символы значений Accept-Language и Content-Language без preflight. */
const LANGUAGE_VALUE = /^[\d a-z*,\-.;=]*$/i;

/** Статусы редиректа. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Заголовки тела запроса: браузер удаляет их, когда редирект меняет метод на GET. */
const BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type'];

/** Статусы, у ответа с которыми нет тела. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** Максимум редиректов одного запроса. */
const MAX_REDIRECTS = 20;

/** Суммарная длина значений безопасных заголовков, после которой они требуют preflight. */
const MAX_SAFELISTED_SIZE = 1024;

/**
 * Профиль браузера: заголовки, которые браузер добавляет к запросам сам, и
 * текст TypeError, которым fetch завершается при сетевой ошибке или отказе CORS.
 * @typedef {object} BrowserProfile
 * @property {string} name - Название браузера для отчёта.
 * @property {string} userAgent - Значение User-Agent.
 * @property {string} acceptLanguage - Accept-Language, если его не задал сам запрос.
 * @property {Object<string, string>} [headers] - Прочие заголовки браузера (client hints, Priority).
 * @property {string} networkError - Текст TypeError при сетевой ошибке.
 */

/**
 * Запись журнала запросов вкладки.
 * @typedef {object} RequestRecord
 * @property {string} method - Метод запроса.
 * @property {string} url - URL запроса.
 * @property {number} status - HTTP-статус ответа, 0 если ответа нет или он заблокирован.
 * @property {?{kind: 'cors'|'network', reason: string}} blocked - Почему браузер отдал
 * странице сетевую ошибку, либо null.
 */

/**
 * Проверяет, есть ли в значении заголовка символ, недопустимый для CORS-безопасного заголовка.
 * @param {string} value - Значение заголовка.
 * @returns {boolean}
 */
function hasUnsafeHeaderChar(value) {
    return [...value].some(ch => (ch < ' ' && ch !== '\t') || UNSAFE_HEADER_CHARS.has(ch));
}

/**
 * Проверяет, что заголовок запроса CORS-безопасен (CORS-safelisted request-header):
 * с ним одним preflight не нужен.
 * @param {string} name - Имя заголовка в нижнем регистре.
 * @param {string} value - Значение заголовка.
 * @returns {boolean}
 */
export function isSafelistedRequestHeader(name, value) {
    if (value.length > 128) return false;
    switch (name) {
    case 'accept':
        return !hasUnsafeHeaderChar(value);
    case 'accept-language':
    case 'content-language':
        return LANGUAGE_VALUE.test(value);
    case 'content-type':
        return !hasUnsafeHeaderChar(value) && SAFELISTED_CONTENT_TYPES.has(value.split(';')[0].trim().toLowerCase());
    case 'range':
        return /^bytes=\d+-\d*$/.test(value);
    default:
        return false;
    }
}

/**
 * Проверяет, что страница может задать заголовок запроса сама.
 * @param {string} name - Имя заголовка в нижнем регистре.
 * @returns {boolean}
 */
function isForbiddenRequestHeader(name) {
    return FORBIDDEN_REQUEST_HEADERS.has(name) || name.startsWith('sec-') || name.startsWith('proxy-');
}

/**
 * Имена заголовков запроса, которые требуют preflight и попадают в
 * Access-Control-Request-Headers (CORS-unsafe request-header names).
 * @param {Headers} headers - Заголовки, заданные страницей.
 * @returns {string[]} Имена в нижнем регистре, отсортированные, без повторов.
 */
export function unsafeHeaderNames(headers) {
    const unsafe = [];
    const safelisted = [];
    let safelistedSize = 0;
    for (const [name, value] of headers) {
        if (!isSafelistedRequestHeader(name, value)) unsafe.push(name);
        else {
            safelisted.push(name);
            safelistedSize += value.length;
        }
    }
    if (safelistedSize > MAX_SAFELISTED_SIZE) unsafe.push(...safelisted);
    return [...new Set(unsafe)].sort();
}

/**
 * Разбирает заголовок-список вида "a, b, c".
 * @param {?string} value - Значение заголовка.
 * @returns {string[]} Элементы списка без пустых, пустой массив без заголовка.
 */
function parseList(value) {
    return value == null ? [] : value.split(',').map(item => item.trim()).filter(Boolean);
}

/**
 * CORS check ответа: разрешает ли он странице с этим origin прочитать ответ.
 * @param {Headers} headers - Заголовки ответа.
 * @param {string} origin - Origin запроса ('null' после редиректа на чужой origin).
 * @param {boolean} includeCredentials - Запрос с credentials: 'include'.
 * @returns {?string} Причина отказа, либо null, если ответ разрешён.
 */
export function corsCheck(headers, origin, includeCredentials) {
    const allowOrigin = headers.get('access-control-allow-origin');
    if (allowOrigin === null) return 'в ответе нет Access-Control-Allow-Origin';
    if (allowOrigin.includes(',')) return `несколько значений Access-Control-Allow-Origin: ${allowOrigin}`;
    if (allowOrigin === '*' && !includeCredentials) return null;
    if (allowOrigin === '*')
        return 'Access-Control-Allow-Origin: * не допускается для запроса с credentials: \'include\'';
    if (allowOrigin !== origin) return `Access-Control-Allow-Origin: ${allowOrigin} не совпадает с origin ${origin}`;
    if (!includeCredentials) return null;
    return headers.get('access-control-allow-credentials') === 'true'
        ? null
        : 'для запроса с credentials: \'include\' нет Access-Control-Allow-Credentials: true';
}

/**
 * Проверяет ответ на preflight: CORS check, успешный статус, разрешённые метод и заголовки.
 * Access-Control-Allow-Headers: * без credentials разрешает и Authorization: так
 * делают Firefox и Chrome, хотя по спецификации Authorization звёздочкой не покрывается.
 * @param {Response} response - Ответ на OPTIONS.
 * @param {{method: string, origin: string, includeCredentials: boolean, unsafeNames: string[]}} request
 * Метод, origin и credentials запроса и имена заголовков, которые требуют preflight.
 * @returns {?string} Причина отказа, либо null, если запрос разрешён.
 */
export function preflightCheck(response, { method, origin, includeCredentials, unsafeNames }) {
    const denied = corsCheck(response.headers, origin, includeCredentials);
    if (denied) return `preflight: ${denied}`;
    if (response.status < 200 || response.status > 299) return `preflight: HTTP ${response.status}`;

    const allowMethods = response.headers.get('access-control-allow-methods');
    const methods = parseList(allowMethods);
    const methodAllowed = methods.includes(method) || SAFELISTED_METHODS.has(method) ||
        (!includeCredentials && methods.includes('*'));
    if (!methodAllowed) return `preflight: метод ${method} не разрешён (Access-Control-Allow-Methods: ${allowMethods})`;

    const allowHeaders = response.headers.get('access-control-allow-headers');
    const allowed = parseList(allowHeaders).map(name => name.toLowerCase());
    const wildcard = !includeCredentials && allowed.includes('*');
    const missing = unsafeNames.filter(name => !wildcard && !allowed.includes(name));
    if (missing.length)
        return `preflight: не разрешены заголовки ${missing.join(', ')} (Access-Control-Allow-Headers: ${allowHeaders})`;
    return null;
}

/**
 * Сайт URL для Sec-Fetch-Site: схема и два последних уровня домена. Это упрощение
 * Public Suffix List, достаточное для доменов сервисов.
 * @param {URL} url - URL.
 * @returns {string}
 */
function siteOf(url) {
    return `${url.protocol}//${url.hostname.split('.').slice(-2).join('.')}`;
}

/**
 * Значение Sec-Fetch-Site по цепочке URL запроса: самое "чужое" из отношений
 * страницы к каждому URL цепочки.
 * @param {URL} page - URL страницы.
 * @param {URL[]} urls - URL запроса с учётом редиректов.
 * @returns {'same-origin'|'same-site'|'cross-site'}
 */
function fetchSite(page, urls) {
    if (urls.some(url => siteOf(url) !== siteOf(page))) return 'cross-site';
    if (urls.some(url => url.origin !== page.origin)) return 'same-site';
    return 'same-origin';
}

/**
 * Значение Referer по политике запроса (по умолчанию strict-origin-when-cross-origin,
 * как у Firefox и Chrome).
 * @param {{referrer: string, referrerPolicy: string}} request - Запрос.
 * @param {URL} page - URL страницы без фрагмента.
 * @param {URL} target - URL запроса.
 * @returns {?string} Referer, либо null, если он не отправляется.
 */
function referrerFor({ referrer, referrerPolicy }, page, target) {
    if (referrer === '') return null;
    const source = referrer === 'about:client' ? page : new URL(referrer, page);
    const full = source.href;
    const originOnly = `${source.origin}/`;
    const same = source.origin === target.origin;
    const downgrade = source.protocol === 'https:' && target.protocol !== 'https:';
    switch (referrerPolicy) {
    case 'no-referrer': return null;
    case 'origin': return originOnly;
    case 'unsafe-url': return full;
    case 'same-origin': return same ? full : null;
    case 'strict-origin': return downgrade ? null : originOnly;
    case 'no-referrer-when-downgrade': return downgrade ? null : full;
    case 'origin-when-cross-origin': return same ? full : originOnly;
    default:
        if (same) return full;
        return downgrade ? null : originOnly;
    }
}

/**
 * Приводит аргументы fetch к описанию запроса: отбрасывает заголовки, которые
 * страница задать не может, и подставляет значения по умолчанию.
 * @param {*} input - URL запроса.
 * @param {object} init - Опции fetch.
 * @param {URL} page - URL страницы.
 * @returns {{url: URL, method: string, headers: Headers, body: *, mode: string, credentials: string,
 * cache: string, redirect: string, referrer: string, referrerPolicy: string, signal: ?AbortSignal}}
 */
function toRequest(input, init, page) {
    const headers = new Headers(init.headers);
    for (const name of [...headers.keys()])
        if (isForbiddenRequestHeader(name)) headers.delete(name);
    const method = String(init.method || 'GET');
    return {
        url: new URL(String(input), page),
        method: NORMALIZED_METHODS.has(method.toUpperCase()) ? method.toUpperCase() : method,
        headers,
        body: init.body ?? null,
        mode: init.mode || 'cors',
        credentials: init.credentials || 'same-origin',
        cache: init.cache || 'default',
        redirect: init.redirect || 'follow',
        referrer: init.referrer ?? 'about:client',
        referrerPolicy: init.referrerPolicy || '',
        signal: init.signal ?? null
    };
}

/**
 * Заголовки, которые браузер ставит сам: User-Agent, Accept и Accept-Language
 * по умолчанию, Sec-Fetch-*, Referer, заголовки профиля.
 * @param {BrowserProfile} profile - Профиль браузера.
 * @param {{mode: string, site: string, referrer: ?string}} context - Режим запроса,
 * значение Sec-Fetch-Site и Referer.
 * @returns {Headers}
 */
function browserHeaders(profile, { mode, site, referrer }) {
    const headers = new Headers({
        'accept': '*/*',
        'accept-language': profile.acceptLanguage,
        'user-agent': profile.userAgent,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': mode,
        'sec-fetch-site': site,
        ...profile.headers
    });
    if (referrer) headers.set('referer', referrer);
    return headers;
}

/**
 * Заголовки самого запроса: заданные страницей поверх браузерных, Origin и
 * заголовки режима кэша.
 * @param {object} request - Запрос (см. toRequest).
 * @param {Headers} base - Браузерные заголовки (см. browserHeaders).
 * @param {?string} origin - Значение Origin, либо null, если он не отправляется.
 * @returns {Headers}
 */
function actualHeaders(request, base, origin) {
    const headers = new Headers(base);
    for (const [name, value] of request.headers) headers.set(name, value);
    if (origin) headers.set('origin', origin);
    if (request.cache === 'no-store' || request.cache === 'reload') {
        if (!request.headers.has('pragma')) headers.set('pragma', 'no-cache');
        if (!request.headers.has('cache-control')) headers.set('cache-control', 'no-cache');
    } else if (request.cache === 'no-cache' && !request.headers.has('cache-control'))
        headers.set('cache-control', 'max-age=0');
    return headers;
}

/**
 * Заголовки ответа, которые увидит страница: без Set-Cookie, а для CORS-ответа
 * только безопасные и перечисленные в Access-Control-Expose-Headers.
 * @param {Headers} headers - Заголовки ответа сервера.
 * @param {boolean} cors - Ответ получен по CORS.
 * @param {boolean} includeCredentials - Запрос с credentials: 'include'.
 * @returns {Headers}
 */
function exposedHeaders(headers, cors, includeCredentials) {
    const exposed = new Set(parseList(headers.get('access-control-expose-headers')).map(name => name.toLowerCase()));
    const exposeAll = !cors || (!includeCredentials && exposed.has('*'));
    const result = new Headers();
    for (const [name, value] of headers) {
        if (FORBIDDEN_RESPONSE_HEADERS.has(name)) continue;
        if (exposeAll || SAFELISTED_RESPONSE_HEADERS.has(name) || exposed.has(name)) result.append(name, value);
    }
    return result;
}

/**
 * Непрозрачный ответ (no-cors на чужой origin или редирект при redirect: 'manual'):
 * статус 0, без заголовков и тела.
 * @param {'opaque'|'opaqueredirect'} type - Тип ответа.
 * @returns {object} Response-подобный объект.
 */
function opaqueResponse(type) {
    return {
        type,
        ok: false,
        status: 0,
        statusText: '',
        headers: new Headers(),
        text: () => Promise.resolve(''),
        blob: () => Promise.resolve(new Blob([])),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0))
    };
}

/**
 * Проверяет, меняет ли редирект метод на GET: 303 для любого метода, кроме GET
 * и HEAD, 301 и 302 для POST.
 * @param {number} status - Статус редиректа.
 * @param {string} method - Метод запроса.
 * @returns {boolean}
 */
function redirectsToGet(status, method) {
    if (status === 303) return method !== 'GET' && method !== 'HEAD';
    return (status === 301 || status === 302) && method === 'POST';
}

/**
 * Один вызов fetch вкладки вместе с переходами по редиректам: состояние запроса
 * (текущий URL, метод, тело, режим ответа) и шаги, которые выполняет браузер.
 */
class BrowserRequest {
    /**
     * Создаёт запрос.
     * @param {object} request - Запрос (см. toRequest).
     * @param {URL} page - URL страницы.
     * @param {BrowserProfile} profile - Профиль браузера.
     * @param {function(RequestRecord): void} onRequest - Получатель записей журнала.
     */
    constructor(request, page, profile, onRequest) {
        this.request = request;
        this.page = page;
        this.profile = profile;
        this.onRequest = onRequest;
        this.url = request.url;
        this.method = request.method;
        this.body = request.body;
        this.urls = [];
        this.tainting = 'basic';
        this.taintedOrigin = false;
        this.includeCredentials = request.credentials === 'include';
    }

    /**
     * Origin запроса: 'null' после редиректа с чужого origin на другой.
     * @returns {string}
     */
    get origin() {
        return this.taintedOrigin ? 'null' : this.page.origin;
    }

    /**
     * Записывает в журнал, почему браузер отдал бы странице сетевую ошибку, и возвращает эту ошибку.
     * @param {'cors'|'network'} kind - Отказ CORS или сетевая ошибка.
     * @param {string} reason - Причина.
     * @param {number} [status=0] - Статус ответа, если он был.
     * @returns {TypeError}
     */
    fail(kind, reason, status = 0) {
        this.onRequest({ method: this.method, url: this.url.href, status, blocked: { kind, reason } });
        return new TypeError(this.profile.networkError);
    }

    /**
     * Отправляет HTTP-запрос по текущему URL, не переходя по редиректам.
     * @param {object} options - Метод, заголовки и тело.
     * @returns {Promise<Response>}
     * @throws {TypeError} При сетевой ошибке.
     */
    async send(options) {
        try {
            return await fetch(this.url, { ...options, redirect: 'manual', signal: this.request.signal });
        } catch (e) {
            if (this.request.signal?.aborted) throw e;
            throw this.fail('network', `сеть: ${e.cause?.code || e.cause?.message || e.message}`);
        }
    }

    /**
     * Определяет режим ответа для текущего URL: запрос на чужой origin (и всё после
     * него) идёт по CORS, а в режиме no-cors даёт непрозрачный ответ.
     * @returns {void}
     * @throws {TypeError} Если режим same-origin, а URL с другого origin.
     */
    updateTainting() {
        const sameOrigin = !this.taintedOrigin && this.url.origin === this.page.origin;
        if (this.tainting === 'basic' && sameOrigin) return;
        if (this.request.mode === 'same-origin')
            throw this.fail('cors', 'mode: \'same-origin\', а URL с другого origin');
        this.tainting = this.request.mode === 'no-cors' ? 'opaque' : 'cors';
    }

    /**
     * Отправляет preflight, если CORS-запрос его требует, и проверяет ответ.
     * @param {Headers} base - Браузерные заголовки (см. browserHeaders).
     * @returns {Promise<void>}
     * @throws {TypeError} Если preflight не разрешил запрос.
     */
    async preflight(base) {
        const unsafeNames = unsafeHeaderNames(this.request.headers);
        if (SAFELISTED_METHODS.has(this.method) && !unsafeNames.length) return;
        const headers = new Headers(base);
        headers.set('sec-fetch-mode', 'cors');
        headers.set('origin', this.origin);
        headers.set('access-control-request-method', this.method);
        if (unsafeNames.length) headers.set('access-control-request-headers', unsafeNames.join(','));
        const response = await this.send({ method: 'OPTIONS', headers });
        await response.body?.cancel();
        const denied = preflightCheck(response, {
            method: this.method, origin: this.origin, includeCredentials: this.includeCredentials, unsafeNames
        });
        if (denied) throw this.fail('cors', denied, response.status);
    }

    /**
     * Переходит по редиректу: меняет URL, а при необходимости метод, тело и
     * заголовки. На другой origin не уходит Authorization.
     * @param {Response} response - Ответ-редирект.
     * @param {number} redirects - Сколько редиректов уже пройдено.
     * @returns {?object} Непрозрачный ответ при redirect: 'manual', иначе null.
     * @throws {TypeError} Если браузер не перешёл бы по редиректу.
     */
    redirect(response, redirects) {
        this.onRequest({ method: this.method, url: this.url.href, status: response.status, blocked: null });
        if (this.request.redirect === 'manual') return opaqueResponse('opaqueredirect');
        if (this.request.redirect === 'error') throw this.fail('network', 'редирект при redirect: \'error\'');
        if (redirects >= MAX_REDIRECTS) throw this.fail('network', 'слишком много редиректов');
        const next = new URL(response.headers.get('location'), this.url);
        if (this.tainting === 'cors' && (next.username || next.password))
            throw this.fail('cors', 'редирект CORS-запроса на URL с логином или паролем');
        if (next.origin !== this.url.origin && this.url.origin !== this.page.origin) this.taintedOrigin = true;
        if (redirectsToGet(response.status, this.method)) {
            this.method = 'GET';
            this.body = null;
            BODY_HEADERS.forEach(name => this.request.headers.delete(name));
        }
        if (next.origin !== this.url.origin) this.request.headers.delete('authorization');
        this.url = next;
        return null;
    }

    /**
     * Ответ, который увидит страница: непрозрачный для no-cors, иначе с
     * отфильтрованными заголовками.
     * @param {Response} response - Ответ сервера.
     * @returns {Promise<Response|object>}
     */
    async respond(response) {
        this.onRequest({ method: this.method, url: this.url.href, status: response.status, blocked: null });
        if (this.tainting === 'opaque') {
            await response.body?.cancel();
            return opaqueResponse('opaque');
        }
        return new Response(NULL_BODY_STATUSES.has(response.status) ? null : response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: exposedHeaders(response.headers, this.tainting === 'cors', this.includeCredentials)
        });
    }

    /**
     * Выполняет запрос так, как браузер: preflight, сам запрос, CORS check и
     * переходы по редиректам.
     * @returns {Promise<Response|object>} Ответ, который увидит страница.
     * @throws {TypeError} Если браузер отдал бы странице сетевую ошибку.
     */
    async run() {
        for (let redirects = 0; ; redirects++) {
            this.urls.push(this.url);
            this.updateTainting();
            const cors = this.tainting === 'cors';
            const base = browserHeaders(this.profile, {
                mode: this.request.mode,
                site: fetchSite(this.page, this.urls),
                referrer: referrerFor(this.request, this.page, this.url)
            });
            if (cors) await this.preflight(base);

            const sendOrigin = cors || (this.method !== 'GET' && this.method !== 'HEAD') ? this.origin : null;
            const response = await this.send({
                method: this.method, headers: actualHeaders(this.request, base, sendOrigin), body: this.body
            });
            const denied = cors ? corsCheck(response.headers, this.origin, this.includeCredentials) : null;
            if (denied) {
                await response.body?.cancel();
                throw this.fail('cors', denied, response.status);
            }
            if (!REDIRECT_STATUSES.has(response.status) || !response.headers.has('location'))
                return this.respond(response);
            await response.body?.cancel();
            const opaque = this.redirect(response, redirects);
            if (opaque) return opaque;
        }
    }
}

/**
 * Создаёт fetch вкладки: запросы уходят так, как их отправил бы браузер со
 * страницы pageUrl, а ответ проходит проверки CORS. Запрос, который браузер не
 * отдал бы странице, завершается TypeError с текстом профиля, а причина
 * записывается в журнал. Cookies не отправляются: у CI нет профиля браузера.
 * @param {{pageUrl: string, profile: BrowserProfile, onRequest?: function(RequestRecord): void}} options
 * Страница, профиль браузера и получатель записей журнала.
 * @returns {function(*, object=): Promise<Response|object>} Функция с интерфейсом fetch.
 */
export function createBrowserFetch({ pageUrl, profile, onRequest = () => {} }) {
    const page = new URL(pageUrl);
    page.hash = '';
    return (input, init = {}) => Promise.resolve()
        .then(() => new BrowserRequest(toRequest(input, init, page), page, profile, onRequest).run());
}
