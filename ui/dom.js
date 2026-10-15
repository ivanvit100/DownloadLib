/**
 * DownloadLib ui module
 * Small DOM helpers shared by the popup controllers
 * @module ui/dom
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

/**
 * Короткий алиас для document.getElementById.
 * @param {string} id - id искомого элемента.
 * @returns {?HTMLElement} Найденный элемент или null.
 */
export function $el(id) {
    return document.getElementById(id);
}

/**
 * Устанавливает CSS-свойство display элемента по его id, если элемент найден.
 * @param {string} id - id элемента.
 * @param {string} value - Значение CSS display.
 * @returns {?HTMLElement} Элемент, либо null, если его нет.
 */
export function setDisplay(id, value) {
    const el = $el(id);
    if (el) el.style.display = value;
    return el;
}

/**
 * Создаёт элемент. Текст задаётся через textContent, поэтому данные сайта
 * (названия, описания) никогда не разбираются как HTML.
 * @param {string} tag - Имя тега.
 * @param {{className?: string, text?: *, attrs?: Object<string, *>}} [options] - Класс,
 * текст и атрибуты элемента; атрибуты со значением null или undefined пропускаются.
 * @returns {HTMLElement} Новый элемент.
 */
export function createEl(tag, { className, text, attrs } = {}) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    for (const [name, value] of Object.entries(attrs || {}))
        if (value != null) el.setAttribute(name, String(value));
    return el;
}
