import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

describe('RemoveAds', () => {
    let cleanup;
    let observerDisconnectSpy;

    beforeEach(async () => {
        if (document.body) {
            document.body.innerHTML = `
                <div class="popup_root"></div>
                <div class="popup-root"></div>
                <div class="mo_b"></div>
                <div class="section" data-home-block="slider"></div>
                <div id="other"></div>
            `;
        }
        observerDisconnectSpy = vi.fn();
        global.MutationObserver = class {
            constructor(cb) { this.cb = cb; }
            observe() {}
            disconnect() { observerDisconnectSpy(); }
        };
        cleanup = await import('../../background/RemoveAds.js');
    });

    afterEach(() => {
        if (document.body) document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('Removes only explicit ad blocks on load', async () => {
        expect(document.querySelector('.popup_root')).not.toBeNull();
        expect(document.querySelector('.popup-root')).not.toBeNull();
        expect(document.querySelector('.mo_b')).toBeNull();
        expect(document.querySelector('div.section[data-home-block="slider"]')).toBeNull();
        expect(document.getElementById('other')).not.toBeNull();
    });

    it('Injects style to hide ad elements', async () => {
        const style = Array.from(document.documentElement.querySelectorAll('style'))
            .find(s => s.textContent.includes('data-home-block="slider"'));
        expect(style).toBeDefined();
        expect(style.textContent).toContain('display: none');
    });

    it('Calls cleanUp on DOMContentLoaded and window load', async () => {
        const spy = vi.spyOn(document, 'querySelectorAll');
        document.dispatchEvent(new Event('DOMContentLoaded'));
        window.dispatchEvent(new Event('load'));
        expect(spy).toHaveBeenCalled();
    });

    it('Debounced clean up removes ads only once after delay', async () => {
        vi.resetModules();

        let timerCallback;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn((cb, ms) => { timerCallback = cb; return 123; });

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const mo_b = document.createElement('div');
        mo_b.className = 'mo_b';
        document.body.appendChild(mo_b);

        const popup_root = document.createElement('div');
        popup_root.className = 'popup_root';
        document.body.appendChild(popup_root);

        const slider = document.createElement('div');
        slider.className = 'section';
        slider.setAttribute('data-home-block', 'slider');
        document.body.appendChild(slider);

        const wrapper = document.createElement('div');
        const inner = document.createElement('div');
        inner.className = 'mo_b';
        wrapper.appendChild(inner);

        observerCallback([{ addedNodes: [wrapper] }]);

        expect(typeof timerCallback).toBe('function');
        expect(document.querySelector('.mo_b')).not.toBeNull();
        expect(document.querySelector('.popup_root')).not.toBeNull();

        timerCallback();

        expect(document.querySelector('.mo_b')).toBeNull();
        expect(document.querySelector('.popup_root')).not.toBeNull();
        expect(document.querySelector('div.section[data-home-block="slider"]')).toBeNull();

        global.setTimeout = originalSetTimeout;
    });

    it('Skips setting new timer when debounce timer is already active', async () => {
        vi.resetModules();

        let callCount = 0;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn((cb, ms) => { callCount++; return callCount; });

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const makeWrapper = () => {
            const wrapper = document.createElement('div');
            const inner = document.createElement('div');
            inner.className = 'mo_b';
            wrapper.appendChild(inner);
            return wrapper;
        };

        observerCallback([{ addedNodes: [makeWrapper()] }]);
        const countAfterFirst = callCount;

        observerCallback([{ addedNodes: [makeWrapper()] }]);
        const countAfterSecond = callCount;

        expect(countAfterFirst).toBe(1);
        expect(countAfterSecond).toBe(1);

        global.setTimeout = originalSetTimeout;
    });

    it('Logs warning when document body is not available', async () => {
        vi.resetModules();
        const originalBody = Object.getOwnPropertyDescriptor(document, 'body');
        Object.defineProperty(document, 'body', { get: () => null, configurable: true });

        const warnSpy = vi.spyOn(console, 'warn');
        await import('../../background/RemoveAds.js');
        expect(warnSpy).toHaveBeenCalledWith('[RemoveAds] Document body not available, skipping initial cleanup');

        if (originalBody) Object.defineProperty(document, 'body', originalBody);
    });

    it('Removes node immediately if it matches slider ad selector', async () => {
        vi.resetModules();

        if (!document.body) {
            const body = document.createElement('body');
            Object.defineProperty(document, 'body', { value: body, configurable: true });
            document.documentElement.appendChild(body);
        }

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const node = document.createElement('div');
        node.className = 'section';
        node.setAttribute('data-home-block', 'slider');
        document.body.appendChild(node);

        expect(document.body.contains(node)).toBe(true);

        observerCallback([{ addedNodes: [node] }]);

        expect(document.body.contains(node)).toBe(false);
    });

    it('Ignores added node when it is not an element', async () => {
        vi.resetModules();

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const textNode = document.createTextNode('ad text');
        observerCallback([{ addedNodes: [textNode] }]);
    });

    it('Does not remove generic popup nodes without ad markers', async () => {
        vi.resetModules();

        let timerCallback;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn((cb, ms) => { timerCallback = cb; return 123; });

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const node = document.createElement('div');
        node.className = 'popup_root';
        document.body.appendChild(node);
        observerCallback([{ addedNodes: [node] }]);

        expect(typeof timerCallback).toBe('function');
        timerCallback();
        expect(document.body.contains(node)).toBe(true);
        global.setTimeout = originalSetTimeout;
    });

    it('Removes ad generic popup with flocktory markers', async () => {
        vi.resetModules();

        let timerCallback;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn((cb, ms) => { timerCallback = cb; return 123; });

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const node = document.createElement('div');
        node.className = 'popup-root';
        node.innerHTML = `
            <div class="popup" data-popup-id="ad-id">
                <div class="popup__content" role="dialog" aria-modal="true">
                    <div class="aek_ael">
                        <a href="https://share.flocktory.com/exchange/login" target="_blank">Выбрать</a>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(node);
        observerCallback([{ addedNodes: [node] }]);

        expect(typeof timerCallback).toBe('function');
        timerCallback();

        expect(document.body.contains(node)).toBe(false);
        global.setTimeout = originalSetTimeout;
    });

    it('Restores scroll after ad popup removal when no dialogs remain', async () => {
        vi.resetModules();

        let timerCallback;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn((cb, ms) => { timerCallback = cb; return 123; });

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.classList.add('modal-open');
        document.documentElement.classList.add('overflow-hidden');

        const node = document.createElement('div');
        node.className = 'popup-root';
        node.innerHTML = `
            <div class="popup" data-popup-id="ad-id">
                <div class="popup__content" role="dialog" aria-modal="true">
                    <div class="aek_ael"><a href="https://flocktory.com">ad</a></div>
                </div>
            </div>
        `;

        document.body.appendChild(node);
        observerCallback([{ addedNodes: [node] }]);

        expect(typeof timerCallback).toBe('function');
        timerCallback();

        expect(document.body.style.overflow).toBe('');
        expect(document.documentElement.style.overflow).toBe('');
        expect(document.body.classList.contains('modal-open')).toBe(false);
        expect(document.documentElement.classList.contains('overflow-hidden')).toBe(false);

        global.setTimeout = originalSetTimeout;
    });

    it('Removes .mo_b only when it has no interactive fields', async () => {
        vi.resetModules();

        let timerCallback;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn((cb, ms) => { timerCallback = cb; return 123; });

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const node = document.createElement('div');
        node.className = 'mo_b';
        const input = document.createElement('input');
        input.type = 'text';
        node.appendChild(input);

        document.body.appendChild(node);
        observerCallback([{ addedNodes: [node] }]);

        expect(typeof timerCallback).toBe('function');
        timerCallback();

        expect(document.body.contains(node)).toBe(true);
        global.setTimeout = originalSetTimeout;
    });

    it('Removes .mo_b without interactive fields', async () => {
        vi.resetModules();

        let timerCallback;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn((cb, ms) => { timerCallback = cb; return 123; });

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const node = document.createElement('div');
        node.className = 'mo_b';

        document.body.appendChild(node);
        observerCallback([{ addedNodes: [node] }]);

        expect(typeof timerCallback).toBe('function');
        timerCallback();

        expect(document.body.contains(node)).toBe(false);
        global.setTimeout = originalSetTimeout;
    });

    it('Cleans up ads on DOMContentLoaded when document is loading', async () => {
        vi.resetModules();

        Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });

        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
        const cleanUpSpy = vi.fn();
        const originalDefine = Object.defineProperty;
        let cleanUpRef;

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        const mod = await import('../../background/RemoveAds.js');
        for (const key of Object.getOwnPropertyNames(mod)) {
            if (typeof mod[key] === 'function' && mod[key].name === 'cleanUp') cleanUpRef = mod[key];
        }

        expect(addEventListenerSpy).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));

        const call = addEventListenerSpy.mock.calls.find(c => c[0] === 'DOMContentLoaded');
        expect(call).toBeDefined();
        const handler = call[1];

        document.body.innerHTML = `
            <div class="popup_root"></div>
            <div class="mo_b"></div>
            <div class="section" data-home-block="slider"></div>
        `;

        handler();

        expect(document.querySelector('.popup_root')).not.toBeNull();
        expect(document.querySelector('.mo_b')).toBeNull();
        expect(document.querySelector('div.section[data-home-block="slider"]')).toBeNull();
    });

    it('Keeps .mo_b with .text-content on ranobelib', async () => {
        vi.resetModules();

        const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
        Object.defineProperty(window, 'location', {
            value: { hostname: 'ranobelib.me' },
            configurable: true
        });

        document.body.innerHTML = `
            <div class="mo_b"><div class="text-content">content</div></div>
        `;

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        expect(document.querySelector('.mo_b')).not.toBeNull();

        if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
    });

    it('Removes .mo_b without .text-content on ranobelib', async () => {
        vi.resetModules();

        const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
        Object.defineProperty(window, 'location', {
            value: { hostname: 'ranobelib.me' },
            configurable: true
        });

        document.body.innerHTML = `
            <div class="mo_b"><div class="other">ad</div></div>
        `;

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        expect(document.querySelector('.mo_b')).toBeNull();

        if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
    });

    it('Removes .mo_b with .text-content on non-ranobelib', async () => {
        vi.resetModules();

        const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
        Object.defineProperty(window, 'location', {
            value: { hostname: 'example.com' },
            configurable: true
        });

        document.body.innerHTML = `
            <div class="mo_b"><div class="text-content">content</div></div>
        `;

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        expect(document.querySelector('.mo_b')).toBeNull();

        if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
    });
});