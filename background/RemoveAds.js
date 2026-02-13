/**
 * DownloadLib background module
 * Module to remove ads from manga pages
 * @module background/RemoveAds
 * @license MIT
 * @author ivanvit
 * @version 1.0.1
 */

(function removeAds() {
    const style = document.createElement('style');
    style.textContent = `
        .popup_root,
        [class*="popup_root"],
        .popup-root,
        [class*="popup-root"] {
            display: none !important;
            pointer-events: none !important;
        }
        .head-track_top {
            overflow: auto !important;
        }
        div.section[data-home-block="slider"] {
            display: none !important;
        }
        .mo_b {
            display: none !important;
        }
    `;
    document.documentElement.appendChild(style);

    function cleanUp() {
        document.querySelectorAll('.mo_b').forEach(el => el.remove());
        document.querySelectorAll('div.section[data-home-block="slider"]').forEach(el => el.remove());
        document.querySelectorAll(
            '.popup_root, [class*="popup_root"], .popup-root, [class*="popup-root"]'
        ).forEach(el => el.remove());
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

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === 1) {
                    if (node.matches && node.matches('.popup_root, [class*="popup_root"], .popup-root, [class*="popup-root"], .mo_b, div.section[data-home-block="slider"]')) {
                        node.remove();
                        return;
                    }
                    if (node.querySelector && node.querySelector('.popup_root, [class*="popup_root"], .popup-root, [class*="popup-root"], .mo_b')) {
                        debouncedCleanUp();
                        return;
                    }
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