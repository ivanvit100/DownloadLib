/**
 * DownloadLib exporter registry
 * @module exporters/ExporterRegistry
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

console.log('[ExporterRegistry] Loading...');

/**
 * Реестр доступных экспортёров форматов (встроенных и добавленных плагинами):
 * связывает ключ формата с классом экспортёра и его метаданными для UI.
 * Встроенные экспортёры регистрирует exporters/index.js.
 */
export class ExporterRegistry {
    static #registry = {};

    /**
     * Регистрирует класс экспортёра под указанным ключом формата.
     * @param {string} format - Ключ формата (регистр не важен).
     * @param {function} ExporterClass - Класс экспортёра (наследник BaseExporter).
     * @param {{label?: string}} [meta] - Метаданные формата для UI.
     * @returns {void}
     */
    static register(format, ExporterClass, meta = {}) {
        ExporterRegistry.#registry[format.toLowerCase()] = { ExporterClass, meta };
    }

    /**
     * Создаёт экземпляр экспортёра зарегистрированного формата.
     * @param {string} format - Ключ формата.
     * @returns {object} Новый экземпляр класса экспортёра.
     * @throws {Error} Если формат не зарегистрирован.
     */
    static create(format) {
        const entry = ExporterRegistry.#registry[format.toLowerCase()];
        if (!entry) throw new Error(`Unsupported format: ${format}`);
        return new entry.ExporterClass();
    }

    /**
     * Возвращает список ключей всех зарегистрированных форматов.
     * @returns {string[]} Список ключей форматов.
     */
    static getSupportedFormats() {
        return Object.keys(ExporterRegistry.#registry);
    }

    /**
     * Возвращает список зарегистрированных форматов в виде опций для UI-селектора.
     * @returns {{value: string, label: string}[]} Список опций формата.
     */
    static getFormats() {
        return Object.entries(ExporterRegistry.#registry).map(([value, { meta }]) => ({
            value,
            label: meta.label || value.toUpperCase()
        }));
    }

    /**
     * Полностью очищает реестр зарегистрированных экспортёров (используется в тестах).
     * @returns {void}
     */
    static _reset() {
        ExporterRegistry.#registry = {};
    }
}

console.log('[ExporterRegistry] Loaded');
