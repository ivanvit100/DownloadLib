/**
 * DownloadLib core module
 * Module to manage request rate limiting
 * @module core/RateLimiter
 * @license MIT
 * @author ivanvit
 * @version 1.0.2
 */

'use strict';

(function(global) {
    console.log('[RateLimiter] Loading...');

    class RateLimiter {
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

        setLimit(limit) {
            if (typeof limit !== 'number' || limit < 2) limit = 2;
            this._maxRequestsPerMinute = Math.max(2, Math.floor(limit)) - 1;
            console.log(`[RateLimiter] Rate limit set to: ${this._maxRequestsPerMinute} requests/minute`);
        }

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

        async _processQueue() {
            if (this._isProcessing) return;
            this._isProcessing = true;

            while (this._pendingQueue.length > 0) {
                while (this._throttled || this._requestsInLastMinute >= this._maxRequestsPerMinute) {
                    if (this._throttled)
                        console.debug(`[RateLimiter] Throttled (429). Queue size: ${this._pendingQueue.length}. Waiting...`);
                    else
                        console.debug(`[RateLimiter] Rate limit reached: ${this._requestsInLastMinute}/${this._maxRequestsPerMinute}. Queue size: ${this._pendingQueue.length}. Waiting...`);
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                const request = this._pendingQueue.shift();
                if (!request) continue;

                this._requestsInLastMinute++;
                const timestamp = Date.now();
                this._requestTimestamps.push(timestamp);

                request.resolve();

                setTimeout(() => {
                    this._requestsInLastMinute--;
                    this._requestTimestamps.shift();
                    console.debug(`[RateLimiter] Request expired: ${this._requestsInLastMinute}/${this._maxRequestsPerMinute} used`);
                }, 60000);
            }

            this._isProcessing = false;
        }

        async trackRequest(source = 'unknown') {
            return new Promise((resolve) => {
                this._pendingQueue.push({ source, resolve });
                this._processQueue();
            });
        }

        recordRequest(source = 'unknown') {
            if (this._requestsInLastMinute >= this._maxRequestsPerMinute) return;
            this._requestsInLastMinute++;
            this._requestTimestamps.push(Date.now());
            console.debug(`[RateLimiter] Recorded external request (${source}): ${this._requestsInLastMinute}/${this._maxRequestsPerMinute}`);
            setTimeout(() => {
                this._requestsInLastMinute--;
                this._requestTimestamps.shift();
            }, 60000);
        }

        async acquire(serviceName = 'default') {
            return this.trackRequest(serviceName);
        }

        async execute(serviceName, fn) {
            await this.trackRequest(serviceName);
            return fn();
        }

        getStats() {
            return {
                requestsInLastMinute: this._requestsInLastMinute,
                maxRequestsPerMinute: this._maxRequestsPerMinute,
                queueSize: this._pendingQueue.length,
                timestamps: this._requestTimestamps.slice()
            };
        }

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