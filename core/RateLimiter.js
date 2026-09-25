/**
 * DownloadLib core module
 * Module to manage request rate limiting
 * @module core/RateLimiter
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[RateLimiter] Loading...');

    /**
     * Ограничитель частоты запросов со скользящим окном в минуту, очередью
     * ожидающих запросов и поддержкой временной блокировки при 429.
     */
    class RateLimiter {
        /**
         * Создаёт ограничитель с заданным лимитом запросов в минуту.
         * @param {{maxRequestsPerMinute?: number}} [options] - Максимальное число
         * запросов в минуту (по умолчанию 85).
         */
        constructor(options = {}) {
            this._requestsInLastMinute = 0;
            this._maxRequestsPerMinute = options.maxRequestsPerMinute || 85;
            this._requestTimestamps = [];
            this._pendingQueue = [];
            this._isProcessing = false;
            this._throttled = false;
            this._throttleTimer = null;

            console.log(`[RateLimiter] Initialized with limit: ${this._maxRequestsPerMinute} requests/minute`);
        }

        /**
         * Устанавливает новый лимит запросов в минуту (с запасом в 1 запрос от указанного значения).
         * @param {number|string} limit - Новый лимит; при некорректном значении используется минимум 2.
         * @returns {void}
         */
        setLimit(limit) {
            let lmt = parseInt(limit);
            if (isNaN(lmt) || lmt < 2) lmt = 2;
            this._maxRequestsPerMinute = Math.max(2, Math.floor(lmt)) - 1;
            console.log(`[RateLimiter] Rate limit set to: ${this._maxRequestsPerMinute} requests/minute`);
        }

        /**
         * Полностью блокирует выполнение запросов на заданную длительность
         * (реакция на HTTP 429), после чего возобновляет обработку очереди.
         * Повторный вызов во время активной блокировки игнорируется.
         * @param {number} [duration=30000] - Длительность блокировки в миллисекундах.
         * @returns {void}
         */
        throttle(duration = 30000) {
            if (this._throttled) {
                console.warn(`[RateLimiter] Already throttled, ignoring duplicate`);
                return;
            }
            this._throttled = true;
            console.warn(`[RateLimiter] 429 detected: blocking ALL requests for ${duration}ms`);
            if (this._throttleTimer) clearTimeout(this._throttleTimer);
            this._throttleTimer = setTimeout(() => {
                this._throttled = false;
                this._throttleTimer = null;
                console.log(`[RateLimiter] Throttle lifted, resuming queue`);
                this._processQueue();
            }, duration);
        }

        /**
         * Обрабатывает очередь ожидающих запросов, разрешая их промисы по мере
         * освобождения окна лимита (или снятия блокировки throttle), и планирует
         * освобождение слота лимита через минуту после каждого выполненного запроса.
         * @returns {Promise<void>}
         */
        async _processQueue() {
            if (this._isProcessing) return;
            this._isProcessing = true;

            while (this._pendingQueue.length > 0) {
                while (this._throttled || this._requestsInLastMinute >= this._maxRequestsPerMinute) {
                    if (this._throttled) console.debug(`[RateLimiter] Throttled (429). Queue size: ${this._pendingQueue.length}. Waiting...`);
                    else console.debug(`[RateLimiter] Rate limit reached: ${this._requestsInLastMinute}/${this._maxRequestsPerMinute}. Queue size: ${this._pendingQueue.length}. Waiting...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                const request = this._pendingQueue.shift();
                if (!request) continue;

                this._requestsInLastMinute += 1;
                const timestamp = Date.now();
                this._requestTimestamps.push(timestamp);

                request.resolve();

                setTimeout(() => {
                    this._requestsInLastMinute -= 1;
                    this._requestTimestamps.shift();
                    console.debug(`[RateLimiter] Request expired: ${this._requestsInLastMinute}/${this._maxRequestsPerMinute} used`);
                }, 60000);
            }

            this._isProcessing = false;
        }

        /**
         * Ставит запрос в очередь и возвращает промис, который разрешится, когда
         * запросу будет позволено выполниться в рамках текущего лимита.
         * @param {string} [source='unknown'] - Метка источника запроса (для логирования).
         * @returns {Promise<void>} Промис, разрешающийся при разрешении на выполнение запроса.
         */
        trackRequest(source = 'unknown') {
            return new Promise((resolve) => {
                this._pendingQueue.push({ source, resolve });
                this._processQueue();
            });
        }

        /**
         * Учитывает уже выполненный вне очереди запрос в текущем окне лимита,
         * без ожидания разрешения (используется для запросов, перехваченных webRequest).
         * Если лимит уже исчерпан, запрос не учитывается.
         * @param {string} [source='unknown'] - Метка источника запроса (для логирования).
         * @returns {void}
         */
        recordRequest(source = 'unknown') {
            if (this._requestsInLastMinute >= this._maxRequestsPerMinute) return;
            this._requestsInLastMinute += 1;
            this._requestTimestamps.push(Date.now());
            console.debug(`[RateLimiter] Recorded external request (${source}): ${this._requestsInLastMinute}/${this._maxRequestsPerMinute}`);
            setTimeout(() => {
                this._requestsInLastMinute -= 1;
                this._requestTimestamps.shift();
            }, 60000);
        }

        /**
         * Алиас trackRequest для более читаемого вызова в местах, семантически
         * означающих "получить разрешение" перед действием.
         * @param {string} [serviceName='default'] - Метка источника запроса (для логирования).
         * @returns {Promise<void>} Промис, разрешающийся при разрешении на выполнение запроса.
         */
        acquire(serviceName = 'default') {
            return this.trackRequest(serviceName);
        }

        /**
         * Дожидается разрешения лимита и затем выполняет переданную функцию.
         * @param {string} serviceName - Метка источника запроса (для логирования).
         * @param {function(): *} fn - Функция, которую нужно выполнить в рамках лимита.
         * @returns {Promise<*>} Результат выполнения fn.
         */
        async execute(serviceName, fn) {
            await this.trackRequest(serviceName);
            return fn();
        }

        /**
         * Возвращает текущую статистику ограничителя.
         * @returns {{requestsInLastMinute: number, maxRequestsPerMinute: number,
         * queueSize: number, timestamps: number[]}} Снимок текущего состояния лимита.
         */
        getStats() {
            return {
                requestsInLastMinute: this._requestsInLastMinute,
                maxRequestsPerMinute: this._maxRequestsPerMinute,
                queueSize: this._pendingQueue.length,
                timestamps: this._requestTimestamps.slice()
            };
        }

        /**
         * Полностью сбрасывает состояние ограничителя: счётчики, очередь и блокировку throttle.
         * @returns {void}
         */
        reset() {
            this._requestsInLastMinute = 0;
            this._requestTimestamps = [];
            this._pendingQueue = [];
            this._isProcessing = false;
            this._throttled = false;
            if (this._throttleTimer) {
                clearTimeout(this._throttleTimer);
                this._throttleTimer = null;
            }
            console.log('[RateLimiter] Reset completed');
        }
    }

    global.RateLimiter = RateLimiter;

    if (!global.globalRateLimiter) global.globalRateLimiter = new RateLimiter({ maxRequestsPerMinute: 85 });
    else console.log('[RateLimiter] Using existing global RateLimiter instance');

    console.log('[RateLimiter] Loaded');
})(typeof window !== 'undefined' ? window : self);