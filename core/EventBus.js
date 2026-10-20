/**
 * DownloadLib core module
 * Event bus for inter-module communication
 * @module core/EventBus
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { createLogger } from './ConsoleLogger.js';

const log = createLogger('EventBus');

/**
 * Простая шина событий по схеме publish/subscribe для общения между модулями расширения.
 */
export class EventBus {
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
        this.listeners.get(event).add(callback);
        return () => this.off(event, callback);
    }

    /**
     * Подписывает колбэк на однократное срабатывание события. Колбэк отписывается
     * до вызова, поэтому срабатывает один раз, даже если бросил ошибку или
     * вызвал повторную эмиссию того же события.
     * @param {string} event - Имя события.
     * @param {function(*): void} callback - Обработчик, вызываемый один раз при эмиссии события.
     * @returns {function(): void} Функция отписки.
     */
    once(event, callback) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            callback(...args);
        };
        return this.on(event, wrapper);
    }

    /**
     * Отписывает колбэк от события. Отписка неподписанного колбэка ничего не делает.
     * @param {string} event - Имя события.
     * @param {function(*): void} callback - Ранее подписанный обработчик.
     * @returns {void}
     */
    off(event, callback) {
        this.listeners.get(event)?.delete(callback);
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
                    log.error(`Error in listener for ${event}:`, e);
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
