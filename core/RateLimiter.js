/**
 * DownloadLib core module
 * Module to manage request rate limiting
 * @module core/RateLimiter
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

console.log('[RateLimiter] Loading...');

/** Ключ storage.local с лимитом запросов в минуту из настроек. */
export const RATE_LIMIT_STORAGE_KEY = 'downloadlib_default_rate_limit';

/** Лимит запросов в минуту по умолчанию. */
export const DEFAULT_RATE_LIMIT = 85;

const MIN_RATE_LIMIT = 2;
const MAX_RATE_LIMIT = 200;
const WINDOW_MS = 60000;

/**
 * Приводит значение лимита к целому числу в допустимых границах.
 * @param {*} value - Значение лимита (число или строка).
 * @returns {number} Лимит от 2 до 200; для нечислового значения — DEFAULT_RATE_LIMIT.
 */
export function normalizeRateLimit(value) {
    const limit = parseInt(value, 10);
    if (Number.isNaN(limit)) return DEFAULT_RATE_LIMIT;
    return Math.min(MAX_RATE_LIMIT, Math.max(MIN_RATE_LIMIT, limit));
}

/**
 * Ограничитель частоты запросов со скользящим окном в минуту: хранит метки
 * времени выданных разрешений и очередь ожидающих запросов. Один таймер ждёт
 * ближайшего свободного слота (или конца блокировки после 429), опроса нет.
 */
export class RateLimiter {
    /**
     * Создаёт ограничитель.
     * @param {{maxRequestsPerMinute?: number, onChange?: function(): void}} [options] -
     * Лимит запросов в минуту (по умолчанию 85) и колбэк, вызываемый при изменении
     * состояния (для сохранения снимка).
     */
    constructor(options = {}) {
        this._limit = normalizeRateLimit(options.maxRequestsPerMinute ?? DEFAULT_RATE_LIMIT);
        this._timestamps = [];
        this._queue = [];
        this._blockedUntil = 0;
        this._timer = null;
        this._onChange = options.onChange || null;
        console.log(`[RateLimiter] Initialized with limit: ${this._limit} requests/minute`);
    }

    /**
     * Устанавливает лимит запросов в минуту (2..200) и сразу пропускает
     * ожидающие запросы, если лимит вырос.
     * @param {number|string} limit - Новый лимит.
     * @returns {void}
     */
    setLimit(limit) {
        this._limit = normalizeRateLimit(limit);
        console.log(`[RateLimiter] Rate limit set to: ${this._limit} requests/minute`);
        this._changed();
        this._drain();
    }

    /**
     * Блокирует выдачу разрешений на заданное время (реакция на HTTP 429).
     * Повторный вызов продлевает блокировку, если новый срок позже текущего.
     * @param {number} [duration=30000] - Длительность блокировки в миллисекундах.
     * @returns {number} Момент окончания блокировки (мс с эпохи).
     */
    throttle(duration = 30000) {
        const until = Date.now() + Math.max(0, Number(duration) || 0);
        if (until > this._blockedUntil) {
            this._blockedUntil = until;
            console.warn(`[RateLimiter] 429 detected: blocking all requests for ${duration}ms`);
            this._changed();
        }
        this._drain();
        return this._blockedUntil;
    }

    /**
     * Ставит запрос в очередь и возвращает промис, который разрешится, когда
     * запросу будет позволено выполниться в рамках лимита.
     * @param {string} [source='unknown'] - Метка источника запроса (для логирования).
     * @returns {Promise<void>} Промис разрешения; отклоняется при reset().
     */
    trackRequest(source = 'unknown') {
        return new Promise((resolve, reject) => {
            this._queue.push({ source, resolve, reject });
            this._drain();
        });
    }

    /**
     * Синоним trackRequest — «получить разрешение» перед запросом.
     * @param {string} [serviceName='default'] - Метка источника запроса.
     * @returns {Promise<void>} Промис разрешения.
     */
    acquire(serviceName = 'default') {
        return this.trackRequest(serviceName);
    }

    /**
     * Дожидается разрешения и затем выполняет функцию.
     * @param {string} serviceName - Метка источника запроса.
     * @param {function(): *} fn - Функция, выполняемая в рамках лимита.
     * @returns {Promise<*>} Результат fn.
     */
    async execute(serviceName, fn) {
        await this.trackRequest(serviceName);
        return fn();
    }

    /**
     * Учитывает уже выполненный запрос без ожидания разрешения. Запрос
     * учитывается всегда, даже если лимит исчерпан.
     * @param {string} [source='unknown'] - Метка источника запроса (для логирования).
     * @returns {void}
     */
    recordRequest(source = 'unknown') {
        this._timestamps.push(Date.now());
        console.debug(`[RateLimiter] Recorded request (${source})`);
        this._changed();
        this._drain();
    }

    /**
     * Синоним recordRequest.
     * @param {string} [source] - Метка источника запроса.
     * @returns {void}
     */
    record(source) {
        this.recordRequest(source);
    }

    /**
     * Возвращает текущую статистику ограничителя.
     * @returns {{requestsInLastMinute: number, maxRequestsPerMinute: number, queueSize: number,
     * throttled: boolean, blockedUntil: number, timestamps: number[]}} Снимок состояния.
     */
    getStats() {
        const now = Date.now();
        this._prune(now);
        return {
            requestsInLastMinute: this._timestamps.length,
            maxRequestsPerMinute: this._limit,
            queueSize: this._queue.length,
            throttled: now < this._blockedUntil,
            blockedUntil: this._blockedUntil,
            timestamps: this._timestamps.slice()
        };
    }

    /**
     * Сбрасывает состояние: снимает блокировку, очищает окно и отклоняет
     * все ожидающие запросы.
     * @returns {void}
     */
    reset() {
        clearTimeout(this._timer);
        this._timer = null;
        const pending = this._queue;
        this._queue = [];
        this._timestamps = [];
        this._blockedUntil = 0;
        pending.forEach(request => request.reject(new Error('Rate limiter reset')));
        console.log('[RateLimiter] Reset completed');
        this._changed();
    }

    /**
     * Возвращает сериализуемый снимок состояния (для storage.session).
     * @returns {{timestamps: number[], blockedUntil: number}} Снимок.
     */
    snapshot() {
        this._prune(Date.now());
        return { timestamps: this._timestamps.slice(), blockedUntil: this._blockedUntil };
    }

    /**
     * Восстанавливает состояние из снимка, отбрасывая устаревшие метки.
     * @param {?{timestamps?: number[], blockedUntil?: number}} state - Снимок из snapshot().
     * @returns {void}
     */
    restore(state) {
        if (!state) return;
        const timestamps = Array.isArray(state.timestamps) ? state.timestamps.filter(Number.isFinite) : [];
        this._timestamps = [...timestamps, ...this._timestamps].sort((a, b) => a - b);
        this._blockedUntil = Math.max(this._blockedUntil, Number(state.blockedUntil) || 0);
        this._prune(Date.now());
        this._drain();
    }

    /**
     * Убирает метки, вышедшие из окна.
     * @param {number} now - Текущее время.
     * @returns {void}
     */
    _prune(now) {
        while (this._timestamps.length && this._timestamps[0] <= now - WINDOW_MS)
            this._timestamps.shift();
    }

    /**
     * Выдаёт разрешения ожидающим запросам, пока позволяют лимит и блокировка,
     * и заводит один таймер до ближайшего момента, когда появится свободный слот.
     * @returns {void}
     */
    _drain() {
        clearTimeout(this._timer);
        this._timer = null;
        const now = Date.now();
        this._prune(now);

        let granted = false;
        while (this._queue.length && now >= this._blockedUntil && this._timestamps.length < this._limit) {
            this._timestamps.push(now);
            this._queue.shift().resolve();
            granted = true;
        }
        if (granted) this._changed();
        if (!this._queue.length) return;

        const slotFreeAt = this._timestamps.length >= this._limit
            ? this._timestamps[this._timestamps.length - this._limit] + WINDOW_MS
            : now;
        const wakeAt = Math.max(slotFreeAt, this._blockedUntil);
        this._timer = setTimeout(() => this._drain(), Math.max(0, wakeAt - now));
    }

    /**
     * Сообщает подписчику об изменении состояния.
     * @returns {void}
     */
    _changed() {
        if (this._onChange) this._onChange();
    }
}

console.log('[RateLimiter] Loaded');
