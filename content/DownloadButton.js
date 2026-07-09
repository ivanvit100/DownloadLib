/**
 * DownloadLib content script
 * Injects the download button next to the read button on MangaLib/RanobeLib pages
 * @module content/DownloadButton
 * @license MIT
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function downloadButton() {
    const DOWNLOAD_BTN_CLASS = 'dl-ext-download-btn';
    const READ_BTN_SELECTOR = 'a.btn';
    const FORMAT_STORAGE_KEY = 'manga_parser_selected_format';
    const _dlApi = (typeof browser !== 'undefined' && browser) || (typeof chrome !== 'undefined' && chrome) || null;

    function injectDownloadButton() {
        document.querySelectorAll(READ_BTN_SELECTOR).forEach(readLink => {
            const container = readLink.parentElement;
            /* istanbul ignore next */
            if (!container) return;
            if (container.querySelector(`.${DOWNLOAD_BTN_CLASS}`)) return;

            let insertBefore = null;
            for (let node = readLink.nextSibling; node; node = node.nextSibling) {
                if (node.nodeType !== 1) continue;
                /* istanbul ignore next */
                if (node.classList.contains(DOWNLOAD_BTN_CLASS)) continue;
                insertBefore = node;
                break;
            }
            if (!insertBefore) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.title = 'Скачать через DownloadLib';
            btn.className = `btn is-filled variant-primary ${DOWNLOAD_BTN_CLASS}`;
            btn.style.cssText = `display:inline-flex!important;justify-content:space-between;align-items:center;gap:0.4em;`;
            btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:0.4em;"><svg class="svg-inline--fa fa-fw" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="currentColor" d="M288 32c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 242.7-73.4-73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l128 128c12.5 12.5 32.8 12.5 45.3 0l128-128c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L288 274.7 288 32zM64 352c-35.3 0-64 28.7-64 64l0 32c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-32c0-35.3-28.7-64-64-64l-101.5 0-45.3 45.3c-25 25-65.5 25-90.5 0L165.5 352 64 352zm368 56a24 24 0 1 1 0 48 24 24 0 1 1 0-48z"/></svg><span>Скачать</span></span><span class="dl-format-label" style="font-size:0.75em;opacity:0.8;"></span>`;

            if (_dlApi && _dlApi.storage && _dlApi.storage.local) {
                _dlApi.storage.local.get([FORMAT_STORAGE_KEY]).then(result => {
                    const label = btn.querySelector('.dl-format-label');
                    /* istanbul ignore else */
                    if (label) label.textContent = (result[FORMAT_STORAGE_KEY] || 'fb2').toUpperCase();
                }).catch(() => {});
            }

            btn.addEventListener('click', () => {
                if (!_dlApi || !_dlApi.runtime) return;
                const format = btn.querySelector('.dl-format-label').textContent.toLowerCase() || 'fb2';
                _dlApi.runtime.sendMessage({ action: 'openDownloadWindow', format });
            });

            container.insertBefore(btn, insertBefore);
        });
    }

    if (_dlApi && _dlApi.storage && _dlApi.storage.onChanged) {
        _dlApi.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes[FORMAT_STORAGE_KEY]) return;
            const newFormat = (changes[FORMAT_STORAGE_KEY].newValue || 'fb2').toUpperCase();
            document.querySelectorAll('.dl-format-label').forEach(label => { label.textContent = newFormat; });
        });
    }

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;

                if ((node.matches && node.matches(READ_BTN_SELECTOR)) ||
                    (node.querySelector && node.querySelector(READ_BTN_SELECTOR))) {
                    injectDownloadButton();
                    return;
                }
            }
        }
    });

    const startObserving = () => {
        if (document.body)
            observer.observe(document.body, { childList: true, subtree: true });
        else
            requestAnimationFrame(startObserving);
    };
    startObserving();

    if (document.body) injectDownloadButton();
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', injectDownloadButton);
    window.addEventListener('load', injectDownloadButton);
})();
