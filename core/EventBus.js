/**
 * DownloadLib core module
 * Event bus for inter-module communication
 * @module core/EventBus
 * @license MIT
 * @author ivanvit
 * @version 1.0.6
 */

'use strict';

(function(global) {
    console.log('[EventBus] Loading...');

    /**
     * Простая шина событий по схеме publish/subscribe для общения между модулями расширения.
     */
    class EventBus {
        /**
         * Создаёт шину с пустой картой подписчиков.
         */
        constructor() {
            this.listeners = new Map();
        }

        /**
         * Подписывает колбэк на событие.
         * @param {string} event - Имя события.
         * @param {function(*): void} callback - Обработчик, вызываемый при эмиссии события.
         * @returns {function(): void} Функция отписки, эквивалентная вызову off(event, callback).
         */
        on(event, callback) {
            if (!this.listeners.has(event))
                this.listeners.set(event, new Set());
            else console.warn(`[EventBus] Listener added for existing event: ${event}`);
            this.listeners.get(event).add(callback);
            return () => this.off(event, callback);
        }

        /**
         * Подписывает колбэк на однократное срабатывание события: после первого
         * вызова колбэк автоматически отписывается.
         * @param {string} event - Имя события.
         * @param {function(*): void} callback - Обработчик, вызываемый один раз при эмиссии события.
         * @returns {function(): void} Функция отписки.
         */
        once(event, callback) {
            const wrapper = (...args) => {
                callback(...args);
                this.off(event, wrapper);
            };
            return this.on(event, wrapper);
        }

        /**
         * Отписывает колбэк от события.
         * @param {string} event - Имя события.
         * @param {function(*): void} callback - Ранее подписанный обработчик.
         * @returns {void}
         */
        off(event, callback) {
            if (this.listeners.has(event))
                this.listeners.get(event).delete(callback);
            else console.warn(`[EventBus] No listeners found for event: ${event}`);
        }

        /**
         * Вызывает все подписанные на событие колбэки с переданными данными,
         * изолируя ошибки одного обработчика от остальных.
         * @param {string} event - Имя события.
         * @param {*} data - Данные, передаваемые каждому обработчику события.
         * @returns {void}
         */
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

        /**
         * Удаляет всех подписчиков указанного события, либо всех подписчиков всех
         * событий, если событие не передано.
         * @param {string} [event] - Имя события для очистки.
         * @returns {void}
         */
        clear(event) {
            if (event) this.listeners.delete(event);
            else this.listeners.clear();
        }
    }

    global.EventBus = EventBus;
    console.log('[EventBus] Loaded');
})(typeof window !== 'undefined' ? window : self);