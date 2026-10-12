/**
 * DownloadLib core module
 * State of one title download shared by the download manager and the service
 * @module core/DownloadContext
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { DeferredQueue, loadImageOrDefer } from './DeferredQueue.js';
import { RateLimitClient } from './RateLimitClient.js';

/**
 * Создаёт контроллер паузы и остановки загрузки. waitIfPaused не опрашивает
 * состояние по таймеру: на паузе он возвращает промис, который разрешается
 * при resume() или stop().
 * @returns {{pause: function(): void, resume: function(): void, stop: function(): void,
 * isPaused: function(): boolean, shouldStop: function(): boolean,
 * waitIfPaused: function(): Promise<void>}} Контроллер загрузки.
 */
export function createController() {
    let paused = false;
    let stopped = false;
    let waiting = null;
    let wake = null;

    const release = () => {
        if (!wake) return;
        wake();
        wake = null;
        waiting = null;
    };

    return {
        pause: () => {
            if (!stopped) paused = true;
        },
        resume: () => {
            paused = false;
            release();
        },
        stop: () => {
            stopped = true;
            paused = false;
            release();
        },
        isPaused: () => paused,
        shouldStop: () => stopped,
        waitIfPaused: () => {
            if (!paused || stopped) return Promise.resolve();
            waiting ??= new Promise(resolve => { wake = resolve; });
            return waiting;
        }
    };
}

/**
 * Ошибка прерванной (остановленной) загрузки.
 * @returns {Error} Ошибка с полем aborted=true.
 */
function abortedError() {
    const error = new Error('Download aborted');
    error.aborted = true;
    return error;
}

/** Контекст загрузки, которая идёт сейчас (для устаревших глобалов плагинов). */
let current = null;

/**
 * Объект одной загрузки тайтла. DownloadManager создаёт его на каждую загрузку
 * и передаёт сервису через service.attach(ctx), поэтому у каждой загрузки свои
 * пауза, остановка, фоновые загрузки и колбэки.
 */
export class DownloadContext {
    /**
     * Создаёт контекст загрузки.
     * @param {{controller?: object, settings?: {splitPages?: boolean, imageFit?: ?object,
     * format?: string}, onPageProgress?: function(number, number): void,
     * on429?: function(number): void}} [options] - Контроллер паузы и остановки
     * (по умолчанию createController()), настройки загрузки и колбэки прогресса
     * страниц главы и ожидания после ответа 429.
     */
    constructor({ controller = createController(), settings = {}, onPageProgress, on429 } = {}) {
        this.controller = controller;
        this.settings = { splitPages: false, imageFit: null, format: 'fb2', ...settings };
        this.interrupted = false;
        this._onPageProgress = onPageProgress;
        this._on429 = on429;
        this.deferred = new DeferredQueue(() => this.isHeldBack());
    }

    /**
     * Контекст загрузки, которая идёт сейчас, либо null.
     * @returns {?DownloadContext}
     */
    static get current() {
        return current;
    }

    /**
     * Делает контекст текущим (на время загрузки).
     * @returns {void}
     */
    activate() {
        current = this;
    }

    /**
     * Снимает контекст с текущего, если он текущий.
     * @returns {void}
     */
    deactivate() {
        if (current === this) current = null;
    }

    /**
     * Контрольная точка: ждёт снятия паузы и прерывает загрузку, если её остановили.
     * @returns {Promise<void>}
     * @throws {Error} С полем aborted=true, если загрузку остановили.
     */
    async checkpoint() {
        await this.controller.waitIfPaused();
        if (this.controller.shouldStop()) {
            this.interrupted = true;
            throw abortedError();
        }
    }

    /**
     * Проверяет, что загрузка сейчас медленная по нашей же причине: она на паузе,
     * либо запросы ждут своей очереди в ограничителе (в т.ч. после ответа 429).
     * Пока это так, сроки отложенной загрузки не истекают.
     * @returns {boolean}
     */
    isHeldBack() {
        return !!this.controller.isPaused?.() || RateLimitClient.isHeldBack();
    }

    /**
     * Загружает изображение, не задерживая главу дольше срока отложенной загрузки
     * (см. DeferredQueue.loadImageOrDefer).
     * @param {string|number} label - Подпись изображения (обычно номер страницы).
     * @param {function(): Promise<?object[]>} load - Загрузка изображения.
     * @returns {Promise<?object[]>} Блоки изображения, null при ошибке, либо [метка].
     */
    loadImageOrDefer(label, load) {
        return loadImageOrDefer(label, load, () => this.isHeldBack());
    }

    /**
     * Сообщает, сколько страниц главы уже загружено.
     * @param {number} done - Загружено страниц.
     * @param {number} total - Всего страниц в главе.
     * @returns {void}
     */
    onPageProgress(done, total) {
        this._onPageProgress?.(done, total);
    }

    /**
     * Сообщает, что сервер ответил 429 и запросы ждут.
     * @param {number} ms - Длительность ожидания.
     * @returns {void}
     */
    on429(ms) {
        this._on429?.(ms);
    }
}
