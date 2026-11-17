import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({}));

vi.mock('../../core/DownloadQueueClient.js', async () => (await import('../helpers/ModuleMock.js'))
    .mockExports(mocks, 'DownloadQueueClient'));
vi.mock('../../ui/HistoryController.js', async () => (await import('../helpers/ModuleMock.js'))
    .mockExports(mocks, 'formatLabel', 'getServiceColor'));

let QueueController;
let changeListener;

/**
 * Элемент очереди.
 * @param {string} id - id тайтла.
 * @param {string} status - Состояние.
 * @param {object} [extra] - Остальные поля.
 * @returns {object} Элемент очереди.
 */
const item = (id, status, extra = {}) => ({
    id, status, params: `slug=${id}-slug&service=mangalib&format=epub`, title: null, error: null, ...extra
});

/**
 * Разметка шаблона queue.html и оболочки.
 * @returns {void}
 */
function setupDOM() {
    document.body.innerHTML = `
        <div id="logoInfo">info</div>
        <button id="queueBackBtn"></button>
        <div id="queueList"></div>
        <div id="queueEmpty"></div>
        <button id="queueStartBtn">Запустить очередь</button>
        <button id="queueClearBtn"></button>
    `;
}

const cards = () => [...document.querySelectorAll('#queueList .history-card')];
const shown = id => document.getElementById(id).style.display;

beforeEach(async () => {
    vi.resetModules();
    setupDOM();
    changeListener = null;
    mocks.formatLabel = vi.fn(format => format.toUpperCase());
    mocks.getServiceColor = vi.fn(() => '#123456');
    mocks.DownloadQueueClient = {
        list: vi.fn(async () => []),
        onChange: vi.fn(listener => {
            changeListener = listener;
            return vi.fn(() => { changeListener = null; });
        }),
        start: vi.fn(async () => true),
        remove: vi.fn(async () => {}),
        clear: vi.fn(async () => {})
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    ({ QueueController } = await import('../../ui/QueueController.js'));
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('QueueController', () => {
    it('Shows the empty state for an empty queue', async () => {
        await QueueController.init(vi.fn());

        expect(shown('queueEmpty')).toBe('block');
        expect(shown('queueList')).toBe('none');
        expect(shown('queueStartBtn')).toBe('none');
        expect(shown('queueClearBtn')).toBe('none');
    });

    it('Renders titles with format, state, error and remove buttons', async () => {
        mocks.DownloadQueueClient.list.mockResolvedValue([
            item('a', 'active', { title: 'Тайтл A' }),
            item('b', 'pending'),
            item('c', 'error', { error: 'HTTP 500' }),
            item('d', 'pending')
        ]);

        await QueueController.init(vi.fn());

        const [a, b, c, d] = cards();
        expect(a.querySelector('.history-card-title').textContent).toBe('Тайтл A');
        expect(b.querySelector('.history-card-title').textContent).toBe('b-slug');
        expect(a.querySelector('.history-badge').textContent).toBe('EPUB');
        expect(cards().map(card => card.querySelector('.history-date').textContent))
            .toEqual(['Скачивается', 'В очереди: 1', 'Не скачан', 'В очереди: 2']);
        expect(c.querySelector('.queue-card-error').textContent).toBe('HTTP 500');
        expect(a.querySelector('.queue-remove-btn')).toBeNull();
        expect(d.querySelector('.queue-remove-btn')).not.toBeNull();
        expect(shown('queueStartBtn')).toBe('block');
        expect(shown('queueClearBtn')).toBe('block');
    });

    it('Hides the start button without pending titles and the clear button with only the active one', async () => {
        mocks.DownloadQueueClient.list.mockResolvedValue([item('a', 'active')]);

        await QueueController.init(vi.fn());

        expect(shown('queueStartBtn')).toBe('none');
        expect(shown('queueClearBtn')).toBe('none');
    });

    it('Removes a title by its button', async () => {
        mocks.DownloadQueueClient.list.mockResolvedValue([item('b', 'pending')]);
        await QueueController.init(vi.fn());

        cards()[0].querySelector('.queue-remove-btn').click();

        expect(mocks.DownloadQueueClient.remove).toHaveBeenCalledWith('b');
    });

    it('Clears the queue', async () => {
        await QueueController.init(vi.fn());

        document.getElementById('queueClearBtn').click();

        expect(mocks.DownloadQueueClient.clear).toHaveBeenCalled();
    });

    it('Re-renders on queue changes while the view is open', async () => {
        await QueueController.init(vi.fn());

        changeListener([item('b', 'pending')]);

        expect(cards()).toHaveLength(1);
    });

    it('Stops watching once the view is gone', async () => {
        await QueueController.init(vi.fn());
        document.body.innerHTML = '';

        changeListener([item('b', 'pending')]);

        expect(changeListener).toBeNull();
    });

    it('Goes back, clears the logo info and stops watching', async () => {
        const onBack = vi.fn();
        await QueueController.init(onBack);

        document.getElementById('queueBackBtn').click();

        expect(onBack).toHaveBeenCalled();
        expect(document.getElementById('logoInfo').textContent).toBe('');
        expect(changeListener).toBeNull();
    });

    it('Logs an error when there is no back callback', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await QueueController.init(null);

        document.getElementById('queueBackBtn').click();

        expect(console.error).toHaveBeenCalled();
    });

    it('Starts the queue', async () => {
        await QueueController.init(vi.fn());
        const startBtn = document.getElementById('queueStartBtn');

        startBtn.click();
        await vi.waitFor(() => expect(mocks.DownloadQueueClient.start).toHaveBeenCalled());

        await vi.waitFor(() => expect(startBtn.disabled).toBe(false));
        expect(startBtn.textContent).toBe('Запустить очередь');
    });

    it('Tells that the queue is already downloading and restores the button', async () => {
        vi.useFakeTimers();
        mocks.DownloadQueueClient.start.mockResolvedValue(false);
        await QueueController.init(vi.fn());
        const startBtn = document.getElementById('queueStartBtn');

        startBtn.click();
        await vi.waitFor(() => expect(startBtn.textContent).toBe('Очередь уже скачивается'));
        expect(startBtn.disabled).toBe(true);

        vi.advanceTimersByTime(3000);
        expect(startBtn.textContent).toBe('Запустить очередь');
        expect(startBtn.disabled).toBe(false);
    });

    it('Replaces the previous subscription on a new init', async () => {
        await QueueController.init(vi.fn());
        const firstUnsubscribe = mocks.DownloadQueueClient.onChange.mock.results[0].value;

        await QueueController.init(vi.fn());

        expect(firstUnsubscribe).toHaveBeenCalled();
    });
});
