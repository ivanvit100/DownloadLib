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

    /**
     * Проверяет, содержит ли узел интерактивные поля ввода (текст, поиск, чекбокс,
     * textarea) — используется, чтобы не удалить блок, являющийся частью формы/интерфейса.
     * @param {Node} node - Проверяемый DOM-узел.
     * @returns {boolean} true, если внутри узла есть хотя бы одно интерактивное поле.
     */
    function hasInteractiveFields(node) {
        /* istanbul ignore next */
        if (!node || node.nodeType !== 1) return false;
        return !!node.querySelector(
            'input[type="text"], input[type="search"], input[type="checkbox"], textarea'
        );
    }

    /**
     * Проверяет, содержит ли узел блок .text-content — используется на RanobeLib,
     * чтобы не удалить легитимный текстовый блок, случайно попавший под .mo_b.
     * @param {Node} node - Проверяемый DOM-узел.
     * @returns {boolean} true, если внутри узла есть .text-content.
     */
    function hasTextContentBlock(node) {
        /* istanbul ignore next */
        if (!node || node.nodeType !== 1) return false;
        return !!node.querySelector('.text-content');
    }

    /**
     * Удаляет узел .mo_b, если он похож на рекламную вставку: не содержит
     * интерактивных полей, а на RanobeLib — ещё и текстового контента.
     * @param {Node} node - Кандидат на удаление.
     * @returns {void}
     */
    function removeMoBIfAdLike(node) {
        /* istanbul ignore next */
        if (!node || node.nodeType !== 1) return;
        /* istanbul ignore next */
        if (!node.matches || !node.matches(MO_B_SELECTOR)) return;
        if (hasInteractiveFields(node)) return;
        if (isRanobeLib && hasTextContentBlock(node)) return;
        node.remove();
    }

    /**
     * Проверяет наличие на странице видимых диалогов/модальных окон.
     * @returns {boolean} true, если найден хотя бы один видимый popup, dialog или modal.
     */
    function hasVisibleDialogs() {
        return !!document.querySelector('.popup:not(.is-hidden), [role="dialog"]:not(.is-hidden), .modal.show');
    }

    /**
     * Снимает блокировку прокрутки страницы (классы/стили, оставленные закрытым
     * рекламным попапом), если на странице не осталось других видимых диалогов.
     * @returns {void}
     */
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

    /**
     * Находит ближайший корень попапа для узла и удаляет его, если внутри есть
     * маркеры рекламы (AD_POPUP_MARKERS_SELECTOR) и нет интерактивных полей;
     * перед удалением кликает по кнопке закрытия попапа, если она есть.
     * @param {Node} node - Узел, добавленный/проверяемый на принадлежность к рекламному попапу.
     * @returns {void}
     */
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

    /**
     * Выполняет полный проход по документу и удаляет все текущие рекламные
     * элементы: слайдер, рекламные .mo_b-блоки и рекламные попапы.
     * @returns {void}
     */
    function cleanUp() {
        document.querySelectorAll(SLIDER_SELECTOR).forEach(el => el.remove());
        document.querySelectorAll(MO_B_SELECTOR).forEach(removeMoBIfAdLike);
        document.querySelectorAll(POPUP_ROOT_SELECTOR).forEach(removeAdPopupIfMatches);
    }

    let debounceTimer = null;

    /**
     * Откладывает вызов cleanUp() на 200мс, схлопывая несколько срабатываний
     * MutationObserver подряд в один проход очистки.
     * @returns {void}
     */
    function debouncedCleanUp() {
        if (debounceTimer) return;
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            cleanUp();
        }, 200);
    }

    if (document.body) cleanUp();
    else console.warn('[AdCleaner] Document body not available, skipping initial cleanup');

    /**
     * Обработчик MutationObserver: при появлении слайдера удаляет его немедленно,
     * а при появлении .mo_b-блока, попапа или узла, содержащего маркеры рекламы,
     * планирует отложенную полную очистку через debouncedCleanUp().
     * @param {MutationRecord[]} mutations - Список изменений DOM, полученных от observer'а.
     * @returns {void}
     */
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

    /**
     * Запускает наблюдение observer'ом за document.body; если body ещё не существует,
     * откладывает попытку до следующего кадра анимации.
     * @returns {void}
     */
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
