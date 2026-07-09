/**
 * DownloadLib content script
 * Removes ads and ad-injected elements from MangaLib/RanobeLib pages
 * @module content/AdCleaner
 * @license MIT
 * @author ivanvit
 * @version 1.0.7
 */

'use strict';

(function adCleaner() {
    const SLIDER_SELECTOR = 'div.section[data-home-block="slider"]';
    const MO_B_SELECTOR = '.mo_b';
    const POPUP_ROOT_SELECTOR = '.popup_root, .popup-root';
    const isRanobeLib = /(?:^|\.)ranobelib\.me$/i.test(location.hostname);
    const AD_POPUP_MARKERS_SELECTOR = [
        '.aek_ael',
        '.aek_aem',
        '.ww_wy',
        'a[href*="flocktory.com"]',
        'a[href*="share.flocktory.com"]',
        'img[src*="gift-ranobe"]'
    ].join(', ');

    function hasInteractiveFields(node) {
        /* istanbul ignore next */
        if (!node || node.nodeType !== 1) return false;
        return !!node.querySelector(
            'input[type="text"], input[type="search"], input[type="checkbox"], textarea'
        );
    }

    function hasTextContentBlock(node) {
        /* istanbul ignore next */
        if (!node || node.nodeType !== 1) return false;
        return !!node.querySelector('.text-content');
    }

    function removeMoBIfAdLike(node) {
        /* istanbul ignore next */
        if (!node || node.nodeType !== 1) return;
        /* istanbul ignore next */
        if (!node.matches || !node.matches(MO_B_SELECTOR)) return;
        if (hasInteractiveFields(node)) return;
        if (isRanobeLib && hasTextContentBlock(node)) return;
        node.remove();
    }

    function hasVisibleDialogs() {
        return !!document.querySelector('.popup:not(.is-hidden), [role="dialog"]:not(.is-hidden), .modal.show');
    }

    function restoreScrollIfSafe() {
        if (hasVisibleDialogs()) return;

        /* istanbul ignore else */
        if (document.body) {
            document.body.style.overflow = '';
            document.body.classList.remove('no-scroll', 'overflow-hidden', 'modal-open', 'popup-open', 'is-locked');
        }

        /* istanbul ignore else */
        if (document.documentElement) {
            document.documentElement.style.overflow = '';
            document.documentElement.classList.remove('no-scroll',
                'overflow-hidden', 'modal-open', 'popup-open', 'is-locked');
        }
    }

    function removeAdPopupIfMatches(node) {
        /* istanbul ignore next */
        if (!node || node.nodeType !== 1) return;

        /* istanbul ignore next */
        const popupRoot = node.matches && node.matches(POPUP_ROOT_SELECTOR)
            ? node
            : node.closest && node.closest(POPUP_ROOT_SELECTOR);

        /* istanbul ignore next */
        if (!popupRoot) return;
        if (hasInteractiveFields(popupRoot)) return;

        const hasAdMarkers = !!popupRoot.querySelector(AD_POPUP_MARKERS_SELECTOR);
        if (!hasAdMarkers) return;

        const closeBtn = popupRoot.querySelector('.popup-close, .btn.popup-close, button.popup-close');
        if (closeBtn && typeof closeBtn.click === 'function') closeBtn.click();

        popupRoot.remove();
        restoreScrollIfSafe();
    }

    const style = document.createElement('style');
    style.textContent = `
        ${SLIDER_SELECTOR} {
            display: none !important;
        }
        @media screen and (max-width: 1024px) {
            .lm_be, .lq_be, .lh_ap {
                grid-template-columns: 1fr 1fr 1fr;
                direction: rtl;
            }
        }
        @media screen and (max-width: 640px) {
            .lm_be, .lq_be, .lh_ap {
                display: flex;
                flex-direction: column-reverse;
            }
        }
    `;
    document.documentElement.appendChild(style);

    function cleanUp() {
        document.querySelectorAll(SLIDER_SELECTOR).forEach(el => el.remove());
        document.querySelectorAll(MO_B_SELECTOR).forEach(removeMoBIfAdLike);
        document.querySelectorAll(POPUP_ROOT_SELECTOR).forEach(removeAdPopupIfMatches);
    }

    let debounceTimer = null;

    function debouncedCleanUp() {
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            cleanUp();
        }, 200);
    }

    if (document.body) cleanUp();
    else console.warn('[AdCleaner] Document body not available, skipping initial cleanup');

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue;

                if (node.matches && node.matches(SLIDER_SELECTOR)) {
                    node.remove();
                    return;
                }

                if (node.matches && node.matches(MO_B_SELECTOR)) {
                    debouncedCleanUp();
                    return;
                }

                if (node.matches && node.matches(POPUP_ROOT_SELECTOR)) {
                    debouncedCleanUp();
                    return;
                }

                if (node.querySelector && (node.querySelector(SLIDER_SELECTOR) ||
                    node.querySelector(MO_B_SELECTOR) ||
                    node.querySelector(POPUP_ROOT_SELECTOR) ||
                    node.querySelector(AD_POPUP_MARKERS_SELECTOR))) {
                    debouncedCleanUp();
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

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', cleanUp);
    window.addEventListener('load', cleanUp);
})();
