'use strict';

(function (global) {
    const GlobalRateLimiter = {
        _requestsInLastMinute: 0,
        _maxRequestsPerMinute: 79,
        _requestTimestamps: [],
        _pendingQueue: [],
        _isProcessing: false,

        setLimit: function(limit) {
            if (typeof limit !== 'number' || limit < 2) limit = 2;
            this._maxRequestsPerMinute = Math.max(2, Math.floor(limit)) - 1;
            console.log(`[GlobalRateLimiter] Rate limit set to: ${this._maxRequestsPerMinute + 1} requests/minute`);
        },

        async _processQueue() {
            if (this._isProcessing) return;
            this._isProcessing = true;

            while (this._pendingQueue.length > 0) {
                while (this._requestsInLastMinute >= this._maxRequestsPerMinute) {
                    console.debug(`[GlobalRateLimiter] Rate limit reached: ${this._requestsInLastMinute}/${this._maxRequestsPerMinute + 1}. Waiting...`);
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                const request = this._pendingQueue.shift();
                if (!request) continue;

                this._requestsInLastMinute++;
                const timestamp = Date.now();
                this._requestTimestamps.push(timestamp);

                console.debug(`[GlobalRateLimiter] Request tracked from ${request.source}: ${this._requestsInLastMinute}/${this._maxRequestsPerMinute + 1}`);
                request.resolve();

                setTimeout(() => {
                    this._requestsInLastMinute--;
                    this._requestTimestamps.shift();
                    console.debug(`[GlobalRateLimiter] Request expired: ${this._requestsInLastMinute}/${this._maxRequestsPerMinute + 1}`);
                }, 60000);
            }

            this._isProcessing = false;
        },

        async trackRequest(source) {
            return new Promise((resolve) => {
                this._pendingQueue.push({ source, resolve });
                this._processQueue();
            });
        }
    };

    global.GlobalRateLimiter = GlobalRateLimiter;
})(typeof window !== 'undefined' ? window : self);