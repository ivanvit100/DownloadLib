import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { MSG } from '../../core/MessageTypes.js';

const TITLE_PATH = '/ru/manga/test-slug';

/**
 * Разметка страницы тайтла: блок кнопок под обложкой (прямой потомок контейнера
 * страницы) с кнопкой чтения.
 * @param {string} [after] - Разметка после кнопки чтения внутри блока кнопок.
 * @returns {string}
 */
function titlePage(after = '<span>Другое</span>') {
    return `
        <div class="page">
            <div class="container">
                <div id="container">
                    <a class="btn is-filled variant-primary">Читать</a>
                    ${after}
                </div>
            </div>
        </div>
    `;
}

/**
 * Пустой контейнер страницы тайтла, куда тест сам добавляет блок кнопок.
 * @returns {HTMLElement} Элемент .page > .container.
 */
function emptyTitlePage() {
    document.body.innerHTML = '<div class="page"><div class="container"></div></div>';
    return document.querySelector('.page > .container');
}

/**
 * Создаёт блок кнопок с кнопкой чтения и соседним элементом.
 * @returns {{block: HTMLElement, readBtn: HTMLElement}}
 */
function createReadBlock() {
    const block = document.createElement('div');
    const readBtn = document.createElement('a');
    readBtn.className = 'btn is-filled variant-primary';
    const sibling = document.createElement('span');
    sibling.textContent = 'Другое';
    block.appendChild(readBtn);
    block.appendChild(sibling);
    return { block, readBtn };
}

describe('DownloadButton', () => {
    beforeEach(async () => {
        window.history.pushState({}, '', TITLE_PATH);
        if (document.body) document.body.innerHTML = titlePage();
        global.MutationObserver = class {
            constructor(cb) { this.cb = cb; }
            observe() {}
            disconnect() {}
        };
        await import('../../content/DownloadButton.js');
    });

    afterEach(() => {
        if (document.body) document.body.innerHTML = '';
        document.querySelectorAll('style').forEach(style => style.remove());
        window.history.pushState({}, '', '/');
        vi.restoreAllMocks();
        delete global.browser;
        delete global.chrome;
    });

    it('Injects download button when read button with sibling exists', async () => {
        expect(document.querySelector('.dl-ext-download-btn')).not.toBeNull();
    });

    it('Does not inject duplicate download button if container already has one', async () => {
        vi.resetModules();

        document.body.innerHTML = titlePage('<button class="dl-ext-download-btn">Уже есть</button><span>Другое</span>');

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

        document.body.innerHTML = titlePage('');

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

        document.body.innerHTML = titlePage();

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

        document.body.innerHTML = titlePage();

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

        document.body.innerHTML = titlePage();

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

    it('Click handler sends the openDownloadWindow message the background router handles', async () => {
        vi.resetModules();

        document.body.innerHTML = titlePage();

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

        expect(sendMessageMock).toHaveBeenCalledWith({ action: MSG.OPEN_DOWNLOAD_WINDOW, format: 'pdf', title: null });
    });

    it('Click handler uses fb2 fallback when format label text is empty', async () => {
        vi.resetModules();

        document.body.innerHTML = titlePage();

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

        expect(sendMessageMock).toHaveBeenCalledWith({ action: MSG.OPEN_DOWNLOAD_WINDOW, format: 'fb2', title: null });
    });

    it('Click handler sends the page title and shows that a queued title is in the queue', async () => {
        vi.resetModules();
        vi.useFakeTimers();

        document.body.innerHTML = `<h1> Тайтл </h1>${titlePage()}`;

        const sendMessageMock = vi.fn().mockResolvedValue({ ok: true, queued: true, position: 1 });
        global.browser = {
            storage: { onChanged: { addListener: vi.fn() } },
            runtime: { sendMessage: sendMessageMock }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../content/DownloadButton.js');
        const btn = document.querySelector('.dl-ext-download-btn');
        btn.click();
        await vi.advanceTimersByTimeAsync(0);

        expect(sendMessageMock).toHaveBeenCalledWith({ action: MSG.OPEN_DOWNLOAD_WINDOW, format: 'fb2', title: 'Тайтл' });
        expect(btn.querySelector('.dl-btn-text').textContent).toBe('В очереди');

        btn.click();
        await vi.advanceTimersByTimeAsync(2500);
        expect(btn.querySelector('.dl-btn-text').textContent).toBe('Скачать');

        vi.useRealTimers();
    });

    it('Click handler keeps the label when the title is not queued or the background fails', async () => {
        vi.resetModules();

        document.body.innerHTML = titlePage();

        const sendMessageMock = vi.fn().mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('no receiver'));
        global.browser = {
            storage: { onChanged: { addListener: vi.fn() } },
            runtime: { sendMessage: sendMessageMock }
        };

        global.MutationObserver = class {
            constructor() {}
            observe() {}
            disconnect() {}
        };

        await import('../../content/DownloadButton.js');
        const btn = document.querySelector('.dl-ext-download-btn');
        btn.click();
        btn.click();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(sendMessageMock).toHaveBeenCalledTimes(2);
        expect(btn.querySelector('.dl-btn-text').textContent).toBe('Скачать');
    });

    it('Click handler returns early when no browser API is available', async () => {
        vi.resetModules();

        document.body.innerHTML = titlePage();

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

        document.body.innerHTML = titlePage();

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

        document.body.innerHTML = titlePage();

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

        document.body.innerHTML = titlePage();

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

        document.body.innerHTML = titlePage();

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

        document.body.innerHTML = titlePage();

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

        const { block, readBtn } = createReadBlock();
        emptyTitlePage().appendChild(block);

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
        wrapper.innerHTML = '<div class="page"><div class="container"></div></div>';
        wrapper.querySelector('.container').appendChild(createReadBlock().block);
        document.body.innerHTML = '';
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

    it.each(['/', '/ru/manga/test-slug/read', '/ru/catalog', '/manga/test-slug'])(
        'Does not inject the button outside a title page (%s)', async path => {
            vi.resetModules();
            window.history.pushState({}, '', path);
            document.body.innerHTML = titlePage();

            let observerCallback;
            global.MutationObserver = class {
                constructor(cb) { observerCallback = cb; }
                observe() {}
                disconnect() {}
            };

            await import('../../content/DownloadButton.js');
            observerCallback([{ addedNodes: [document.querySelector('a.btn')] }]);

            expect(document.querySelector('.dl-ext-download-btn')).toBeNull();
        }
    );

    it.each(['/ru/manga/test-slug', '/ru/book/test-slug/', '/en/manga/test-slug'])(
        'Injects the button on the title page %s', async path => {
            vi.resetModules();
            window.history.pushState({}, '', path);
            document.body.innerHTML = titlePage();

            await import('../../content/DownloadButton.js');

            expect(document.querySelector('.dl-ext-download-btn')).not.toBeNull();
        }
    );

    it('Ignores read buttons outside the button block under the cover', async () => {
        vi.resetModules();
        document.body.innerHTML = `
            <div class="page">
                <div class="container">
                    <div><div><a class="btn is-filled variant-primary">Читать</a><span>Глава</span></div></div>
                </div>
            </div>
            <div><a class="btn is-filled variant-primary">Читать</a><span>Другое</span></div>
            <div class="page"><div class="container"><div><a class="btn">Читать</a><span>Другое</span></div></div></div>
        `;

        await import('../../content/DownloadButton.js');

        expect(document.querySelector('.dl-ext-download-btn')).toBeNull();
    });

    it('Adds styles that keep the read and download buttons in one row on narrow screens', async () => {
        vi.resetModules();
        await import('../../content/DownloadButton.js');

        const style = [...document.documentElement.querySelectorAll(':scope > style')]
            .find(el => el.textContent.includes('.dl-ext-download-btn'));

        expect(style).toBeDefined();
        expect(style.textContent).toContain('@media screen and (max-width: 1024px)');
        expect(style.textContent).toContain(
            '.page > .container > * > a.btn.is-filled.variant-primary + .dl-ext-download-btn ~ *'
        );
    });

    it('Registers DOMContentLoaded listener when readyState is loading', async () => {
        vi.resetModules();

        document.body.innerHTML = titlePage();

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
