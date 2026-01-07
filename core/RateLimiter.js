'use strict';

(function(global) {
    console.log('[RateLimiter] Loading...');

    class RateLimiter {
        constructor(options = {}) {
            this.limits = new Map();
            this.queues = new Map();
            this.defaultLimit = options.defaultLimit || 5;
        }

        setLimit(serviceName, requestsPerSecond) {
            this.limits.set(serviceName, {
                rps: requestsPerSecond,
                interval: 1000 / requestsPerSecond,
                lastRequest: 0,
                queue: []
            });
        }

        async acquire(serviceName = 'default') {
            if (!this.limits.has(serviceName))
                this.setLimit(serviceName, this.defaultLimit);

            const limit = this.limits.get(serviceName);
            const now = Date.now();
            const timeSinceLastRequest = now - limit.lastRequest;

            if (timeSinceLastRequest < limit.interval)
                await this.delay(limit.interval - timeSinceLastRequest);

            limit.lastRequest = Date.now();
        }

        async execute(serviceName, fn) {
            await this.acquire(serviceName);
            return fn();
        }

        getStats(serviceName) {
            return this.limits.get(serviceName) || null;
        }

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        reset(serviceName) {
            if (serviceName) this.limits.delete(serviceName);
            else this.limits.clear();
        }
    }

    global.RateLimiter = RateLimiter;
    global.globalRateLimiter = new RateLimiter();
    console.log('[RateLimiter] Loaded');
})(window);