/**
 * DownloadLib background module
 * Module to remove ads from manga pages
 * @module background/RemoveAds
 * @license MIT
 * @author ivanvit
 * @version 1.0.1
 */

(function removeAds() {
    document.querySelectorAll('.mo_b').forEach(el => el.remove());
    document.querySelectorAll('div.section[data-home-block="slider"]').forEach(el => el.remove());
    const observer = new MutationObserver(() => {
        document.querySelectorAll('.mo_b').forEach(el => el.remove());
        document.querySelectorAll('div.section[data-home-block="slider"]').forEach(el => el.remove());
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();