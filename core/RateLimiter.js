'use strict';

(function(global) {
    console.log('[RateLimiter] Loading...');

    class RateLimiter {
        constructor(options = {}) {
            this._requestsInLastMinute = 0;
            this._maxRequestsPerMinute = options.maxRequestsPerMinute || 99;
            this._requestTimestamps = [];
            this._pendingQueue = [];
            this._isProcessing = false;
            
            console.log(`[RateLimiter] Initialized with limit: ${this._maxRequestsPerMinute} requests/minute`);
        }

        setLimit(limit) {
            if (typeof limit !== 'number' || limit < 2) limit = 2;
            this._maxRequestsPerMinute = Math.max(2, Math.floor(limit)) - 1;
            console.log(`[RateLimiter] Rate limit set to: ${this._maxRequestsPerMinute} requests/minute`);
        }

        async _processQueue() {
            if (this._isProcessing) return;
            this._isProcessing = true;

            while (this._pendingQueue.length > 0) {
                while (this._requestsInLastMinute >= this._maxRequestsPerMinute) {
                    console.debug(`[RateLimiter] Rate limit reached: ${this._requestsInLastMinute}/${this._maxRequestsPerMinute}. Queue size: ${this._pendingQueue.length}. Waiting...`);
                    await new Promise(resolve => setTimeout(resolve, 100));
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
            console.log('[RateLimiter] Reset completed');
        }
    }

    global.RateLimiter = RateLimiter;
    
    if (!global.globalRateLimiter) global.globalRateLimiter = new RateLimiter({ maxRequestsPerMinute: 99 });
    
    console.log('[RateLimiter] Loaded');
})(typeof window !== 'undefined' ? window : self);