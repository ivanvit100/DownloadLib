import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

describe('RemoveAds', () => {
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
        await import('../../background/RemoveAds.js');
    });

    afterEach(() => {
        if (document.body) document.body.innerHTML = '';
        vi.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
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
        global.setTimeout = vi.fn(cb => { timerCallback = cb; return 123; });

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
        global.setTimeout = vi.fn(() => { callCount++; return callCount; });

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
        global.setTimeout = vi.fn(cb => { timerCallback = cb; return 123; });

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
        global.setTimeout = vi.fn(cb => { timerCallback = cb; return 123; });

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
        global.setTimeout = vi.fn(cb => { timerCallback = cb; return 123; });

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
        global.setTimeout = vi.fn(cb => { timerCallback = cb; return 123; });

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
        global.setTimeout = vi.fn(cb => { timerCallback = cb; return 123; });

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

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

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

    it('Does not restore scroll when visible dialog remains', async () => {
        vi.resetModules();

        let timerCallback;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn(cb => { timerCallback = cb; return 123; });

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const visibleDialog = document.createElement('div');
        visibleDialog.className = 'popup';
        document.body.appendChild(visibleDialog);

        document.body.style.overflow = 'hidden';

        const node = document.createElement('div');
        node.className = 'popup-root';
        node.innerHTML = '<div class="aek_ael"><a href="https://flocktory.com">ad</a></div>';
        document.body.appendChild(node);

        observerCallback([{ addedNodes: [node] }]);
        timerCallback();

        expect(document.body.contains(node)).toBe(false);
        expect(document.body.style.overflow).toBe('hidden');

        global.setTimeout = originalSetTimeout;
    });

    it('Does not remove popup-root with ad markers that has interactive fields', async () => {
        vi.resetModules();

        let timerCallback;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn(cb => { timerCallback = cb; return 123; });

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
            <div class="aek_ael">ad</div>
            <input type="text" placeholder="search"/>
        `;
        document.body.appendChild(node);

        observerCallback([{ addedNodes: [node] }]);
        timerCallback();

        expect(document.body.contains(node)).toBe(true);
        global.setTimeout = originalSetTimeout;
    });

    it('Clicks popup-close button before removing ad popup', async () => {
        vi.resetModules();

        let timerCallback;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn(cb => { timerCallback = cb; return 123; });

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const node = document.createElement('div');
        node.className = 'popup-root';
        const adMarker = document.createElement('div');
        adMarker.className = 'aek_ael';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'popup-close';
        const clickSpy = vi.fn();
        closeBtn.click = clickSpy;
        node.appendChild(adMarker);
        node.appendChild(closeBtn);
        document.body.appendChild(node);

        observerCallback([{ addedNodes: [node] }]);
        timerCallback();

        expect(clickSpy).toHaveBeenCalledOnce();
        expect(document.body.contains(node)).toBe(false);
        global.setTimeout = originalSetTimeout;
    });

    it('Observer does not trigger cleanup for unrelated nodes', async () => {
        vi.resetModules();

        const setTimeoutSpy = vi.fn();
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = setTimeoutSpy;

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        setTimeoutSpy.mockClear();

        const plain = document.createElement('div');
        plain.innerHTML = '<span>just text</span>';
        observerCallback([{ addedNodes: [plain] }]);

        expect(setTimeoutSpy).not.toHaveBeenCalled();
        global.setTimeout = originalSetTimeout;
    });

    it('Observer triggers cleanup for node containing ad marker selector', async () => {
        vi.resetModules();

        let timerCallback;
        const originalSetTimeout = global.setTimeout;
        global.setTimeout = vi.fn(cb => { timerCallback = cb; return 123; });

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const wrapper = document.createElement('div');
        const inner = document.createElement('div');
        inner.className = 'aek_ael';
        wrapper.appendChild(inner);

        observerCallback([{ addedNodes: [wrapper] }]);

        expect(typeof timerCallback).toBe('function');
        global.setTimeout = originalSetTimeout;
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

    it('Injects download button when read button with sibling exists', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        expect(document.querySelector('.dl-ext-download-btn')).not.toBeNull();
    });

    it('Does not inject duplicate download button if container already has one', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <button class="dl-ext-download-btn">Уже есть</button>
                <span>Другое</span>
            </div>
        `;

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        expect(document.querySelectorAll('.dl-ext-download-btn').length).toBe(1);
    });

    it('Does not inject button when no element sibling follows read button', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
            </div>
        `;

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        expect(document.querySelector('.dl-ext-download-btn')).toBeNull();
    });

    it('Loads format label from storage when browser API is available', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        const mockGet = vi.fn().mockResolvedValue({ manga_parser_selected_format: 'epub' });
        global.browser = {
            storage: {
                local: { get: mockGet },
                onChanged: { addListener: vi.fn() }
            },
            runtime: { sendMessage: vi.fn() }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        await Promise.resolve();

        const label = document.querySelector('.dl-format-label');
        expect(label).not.toBeNull();
        expect(label.textContent).toBe('EPUB');
    });

    it('Uses FB2 as fallback when storage returns empty format', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        global.browser = {
            storage: {
                local: { get: vi.fn().mockResolvedValue({}) },
                onChanged: { addListener: vi.fn() }
            },
            runtime: { sendMessage: vi.fn() }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        await Promise.resolve();

        const label = document.querySelector('.dl-format-label');
        expect(label.textContent).toBe('FB2');
    });

    it('Silently catches storage.local.get rejection', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        global.browser = {
            storage: {
                local: { get: vi.fn().mockRejectedValue(new Error('Storage error')) },
                onChanged: { addListener: vi.fn() }
            },
            runtime: { sendMessage: vi.fn() }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        await Promise.resolve();
    });

    it('Click handler sends openDownloadWindow message via runtime API', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        const sendMessageMock = vi.fn();
        global.browser = {
            storage: {
                local: { get: vi.fn().mockResolvedValue({ manga_parser_selected_format: 'pdf' }) },
                onChanged: { addListener: vi.fn() }
            },
            runtime: { sendMessage: sendMessageMock }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        await Promise.resolve();

        const btn = document.querySelector('.dl-ext-download-btn');
        expect(btn).not.toBeNull();
        btn.click();

        expect(sendMessageMock).toHaveBeenCalledWith({ action: 'openDownloadWindow', format: 'pdf' });
    });

    it('Click handler uses fb2 fallback when format label text is empty', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        const sendMessageMock = vi.fn();
        global.browser = {
            storage: {
                onChanged: { addListener: vi.fn() }
            },
            runtime: { sendMessage: sendMessageMock }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        const btn = document.querySelector('.dl-ext-download-btn');
        expect(btn).not.toBeNull();
        btn.click();

        expect(sendMessageMock).toHaveBeenCalledWith({ action: 'openDownloadWindow', format: 'fb2' });
    });

    it('Click handler returns early when no browser API is available', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const btn = document.querySelector('.dl-ext-download-btn');
        expect(btn).not.toBeNull();
        expect(() => btn.click()).not.toThrow();
    });

    it('storage.onChanged updates format labels when area is local', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        let onChangedCallback;
        global.browser = {
            storage: {
                local: { get: vi.fn().mockResolvedValue({}) },
                onChanged: { addListener: vi.fn(cb => { onChangedCallback = cb; }) }
            },
            runtime: { sendMessage: vi.fn() }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        await Promise.resolve();

        onChangedCallback({ manga_parser_selected_format: { newValue: 'mobi' } }, 'local');

        document.querySelectorAll('.dl-format-label').forEach(label => {
            expect(label.textContent).toBe('MOBI');
        });
    });

    it('storage.onChanged ignores changes in sync area', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        let onChangedCallback;
        global.browser = {
            storage: {
                local: { get: vi.fn().mockResolvedValue({ manga_parser_selected_format: 'fb2' }) },
                onChanged: { addListener: vi.fn(cb => { onChangedCallback = cb; }) }
            },
            runtime: { sendMessage: vi.fn() }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        await Promise.resolve();

        const labelBefore = document.querySelector('.dl-format-label')?.textContent;
        onChangedCallback({ manga_parser_selected_format: { newValue: 'epub' } }, 'sync');
        const labelAfter = document.querySelector('.dl-format-label')?.textContent;

        expect(labelAfter).toBe(labelBefore);
    });

    it('storage.onChanged ignores changes without FORMAT_STORAGE_KEY', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        let onChangedCallback;
        global.browser = {
            storage: {
                local: { get: vi.fn().mockResolvedValue({ manga_parser_selected_format: 'fb2' }) },
                onChanged: { addListener: vi.fn(cb => { onChangedCallback = cb; }) }
            },
            runtime: { sendMessage: vi.fn() }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        await Promise.resolve();

        const labelBefore = document.querySelector('.dl-format-label')?.textContent;
        onChangedCallback({ some_other_key: { newValue: 'epub' } }, 'local');
        const labelAfter = document.querySelector('.dl-format-label')?.textContent;

        expect(labelAfter).toBe(labelBefore);
    });

    it('storage.onChanged uses FB2 fallback when newValue is absent', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        let onChangedCallback;
        global.browser = {
            storage: {
                local: { get: vi.fn().mockResolvedValue({ manga_parser_selected_format: 'epub' }) },
                onChanged: { addListener: vi.fn(cb => { onChangedCallback = cb; }) }
            },
            runtime: { sendMessage: vi.fn() }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        await Promise.resolve();

        onChangedCallback({ manga_parser_selected_format: { newValue: null } }, 'local');

        document.querySelectorAll('.dl-format-label').forEach(label => {
            expect(label.textContent).toBe('FB2');
        });
    });

    it('Uses chrome API when browser is not defined', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        const mockGet = vi.fn().mockResolvedValue({ manga_parser_selected_format: 'mobi' });
        global.chrome = {
            storage: {
                local: { get: mockGet },
                onChanged: { addListener: vi.fn() }
            },
            runtime: { sendMessage: vi.fn() }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');
        await Promise.resolve();

        expect(mockGet).toHaveBeenCalled();
        const label = document.querySelector('.dl-format-label');
        expect(label.textContent).toBe('MOBI');
    });

    it('Observer triggers injectDownloadButton when added node matches read button selector', async () => {
        vi.resetModules();

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const container = document.createElement('div');
        const readBtn = document.createElement('a');
        readBtn.className = 'btn';
        const sibling = document.createElement('span');
        sibling.textContent = 'Другое';
        container.appendChild(readBtn);
        container.appendChild(sibling);
        document.body.appendChild(container);

        observerCallback([{ addedNodes: [readBtn] }]);

        expect(document.querySelector('.dl-ext-download-btn')).not.toBeNull();
    });

    it('Observer triggers injectDownloadButton when added node contains read button', async () => {
        vi.resetModules();

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../background/RemoveAds.js');

        const wrapper = document.createElement('div');
        const container = document.createElement('div');
        const readBtn = document.createElement('a');
        readBtn.className = 'btn';
        const sibling = document.createElement('span');
        sibling.textContent = 'Другое';
        container.appendChild(readBtn);
        container.appendChild(sibling);
        wrapper.appendChild(container);
        document.body.appendChild(wrapper);

        observerCallback([{ addedNodes: [wrapper] }]);

        expect(document.querySelector('.dl-ext-download-btn')).not.toBeNull();
    });
});