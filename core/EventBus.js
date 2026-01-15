/**
 * DownloadLib core module
 * Event bus for inter-module communication
 * @module core/EventBus
 * @license MIT
 * @author ivanvit
 * @version 1.0.0
 */

'use strict';

(function(global) {
    console.log('[EventBus] Loading...');

    class EventBus {
        constructor() {
            this.listeners = new Map();
        }

        on(event, callback) {
            if (!this.listeners.has(event))
                this.listeners.set(event, new Set());
            this.listeners.get(event).add(callback);
            return () => this.off(event, callback);
        }

        once(event, callback) {
            const wrapper = (...args) => {
                callback(...args);
                this.off(event, wrapper);
            };
            return this.on(event, wrapper);
        }

        off(event, callback) {
            if (this.listeners.has(event))
                this.listeners.get(event).delete(callback);
        }

        emit(event, data) {
            if (this.listeners.has(event)) {
                for (const callback of this.listeners.get(event)) {
                    try {
                        callback(data);
                    } catch (e) {
                        console.error(`[EventBus] Error in listener for ${event}:`, e);
                    }
                }
            }
        }

        clear(event) {
            if (event) {
                this.listeners.delete(event);
            } else {
                this.listeners.clear();
            }
        }
    }

    global.EventBus = EventBus;
    console.log('[EventBus] Loaded');
})(window);