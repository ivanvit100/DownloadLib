/**
 * DownloadLib service module
 * Base class for manga services
 * @module services/BaseService
 * @license MIT
 * @author ivanvit
 * @version 1.0.2
 */

'use strict';

(function(global) {
    class BaseService {
        constructor(config) {
            this.config = config;
            this.name = config.name;
            this.baseUrl = config.baseUrl;
            console.log(`[BaseService] Created service: ${this.name}`);
        }

        async fetchMangaMetadata(slug) {
            throw new Error('fetchMangaMetadata must be implemented');
        }
        
        async fetchChaptersList(slug) {
            throw new Error('fetchChaptersList must be implemented');
        }
        
        async fetchChapter(slug, number, volume) {
            throw new Error('fetchChapter must be implemented');
        }

        extractPages(chapterData) {
            const keys = ['pages', 'images', 'pages_list', 'content'];
            for (const key of keys)
                if (Array.isArray(chapterData[key]) && chapterData[key].length)
                    return chapterData[key].slice();
            return [];
        }

        async loadPageAsBase64(url, opts = {}) {
            const response = await this.fetchWithRetry(url, opts);
            const blob = await response.blob();
            return this.blobToBase64(blob);
        }

        async fetchWithRetry(url, opts, retries = 3) {
            for (let i = 0; i < retries; i++) {
                try {
                    return await fetch(url, opts);
                } catch (e) {
                    if (i === retries - 1) throw e;
                    await this.delay(1000 * (i + 1));
                }
            }
        }

        async fetchWithRateLimitRetry(url, opts, maxRetries = 5) {
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const response = await fetch(url, opts);
                if (response.status === 429) {
                    const retryAfter = parseInt(response.headers.get('Retry-After'), 10);
                    const waitMs = (retryAfter && retryAfter > 0) ? retryAfter * 1000 : 30000;
                    console.warn(`[${this.name}] 429 Too Many Requests (attempt ${attempt + 1}/${maxRetries}), waiting ${waitMs}ms...`);
                    this._on429 && this._on429(waitMs);
                    if (typeof global !== 'undefined' && global.globalRateLimiter && global.globalRateLimiter.throttle)
                        global.globalRateLimiter.throttle(waitMs);
                    else if (typeof self !== 'undefined' && self.globalRateLimiter && self.globalRateLimiter.throttle)
                        self.globalRateLimiter.throttle(waitMs);
                    else console.warn(`[${this.name}] No globalRateLimiter found, proceeding with local delay.`);
                    await this.delay(waitMs);
                    continue;
                }
                return response;
            }
            throw new Error(`Rate limited after ${maxRetries} retries (429)`);
        }

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        async blobToBase64(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }

        static matches(url) {
            throw new Error('matches must be implemented');
        }
    }

    global.BaseService = BaseService;
})(typeof window !== 'undefined' ? window : self);