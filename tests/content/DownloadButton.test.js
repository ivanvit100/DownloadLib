import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

describe('DownloadButton', () => {
    beforeEach(async () => {
        if (document.body) {
            document.body.innerHTML = `
                <div id="container">
                    <a class="btn">Читать</a>
                    <span>Другое</span>
                </div>
            `;
        }
        global.MutationObserver = class {
            constructor(cb) { this.cb = cb; }
            observe() {}
            disconnect() {}
        };
        await import('../../content/DownloadButton.js');
    });

    afterEach(() => {
        if (document.body) document.body.innerHTML = '';
        vi.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
    });

    it('Injects download button when read button with sibling exists', async () => {
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

        await import('../../content/DownloadButton.js');

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

        await import('../../content/DownloadButton.js');

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

        await import('../../content/DownloadButton.js');
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

        await import('../../content/DownloadButton.js');
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

        await import('../../content/DownloadButton.js');
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

        await import('../../content/DownloadButton.js');
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

        await import('../../content/DownloadButton.js');
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

        await import('../../content/DownloadButton.js');

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

        await import('../../content/DownloadButton.js');
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

        await import('../../content/DownloadButton.js');
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

        await import('../../content/DownloadButton.js');
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

        await import('../../content/DownloadButton.js');
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

        await import('../../content/DownloadButton.js');
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

        await import('../../content/DownloadButton.js');

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

        await import('../../content/DownloadButton.js');

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

    it('Observer ignores non-element nodes (nodeType !== 1)', async () => {
        vi.resetModules();

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../content/DownloadButton.js');

        const textNode = document.createTextNode('some text');
        observerCallback([{ addedNodes: [textNode] }]);
    });

    it('Observer does nothing when added element does not match read button selector', async () => {
        vi.resetModules();

        document.body.innerHTML = '<div><p>no read button here</p></div>';

        let observerCallback;
        global.MutationObserver = class {
            constructor(cb) { observerCallback = cb; }
            observe() {}
            disconnect() {}
        };

        await import('../../content/DownloadButton.js');

        const unrelated = document.createElement('div');
        observerCallback([{ addedNodes: [unrelated] }]);

        expect(document.querySelector('.dl-ext-download-btn')).toBeNull();
    });

    it('startObserving calls requestAnimationFrame when document.body is null at load time', async () => {
        vi.resetModules();

        const savedBody = document.body;
        document.body.remove();

        const originalRaf = global.requestAnimationFrame;
        const rafMock = vi.fn();
        global.requestAnimationFrame = rafMock;

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        try {
            await import('../../content/DownloadButton.js');
            expect(rafMock).toHaveBeenCalledWith(expect.any(Function));
        } finally {
            document.documentElement.appendChild(savedBody);
            global.requestAnimationFrame = originalRaf;
        }
    });

    it('Registers DOMContentLoaded listener when readyState is loading', async () => {
        vi.resetModules();

        document.body.innerHTML = `
            <div id="container">
                <a class="btn">Читать</a>
                <span>Другое</span>
            </div>
        `;

        Object.defineProperty(document, 'readyState', {
            get: () => 'loading',
            configurable: true
        });

        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        try {
            await import('../../content/DownloadButton.js');
            expect(addEventListenerSpy).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function));
        } finally {
            delete document.readyState;
        }
    });
});
