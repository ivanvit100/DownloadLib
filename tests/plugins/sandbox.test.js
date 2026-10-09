/**
 * Контрактный тест песочницы плагинов форматов: заглушки API в sandbox.js (Chrome)
 * и в iframe.srcdoc песочницы Firefox (PluginManager) предоставляют одинаковые имена
 * и одинаково исполняют протокол sb-exec/sb-export. API песочницы можно только расширять.
 * Менять здесь можно только подготовку окружения; изменение проверок означает
 * изменение контракта плагинов и требует согласия владельца проекта.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Blob as NodeBlob } from 'node:buffer';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');

const probePlugin = `(function(global) {
    class ProbeExporter extends global.BaseExporter {
        async export(manga, chapters) {
            return {
                blob: new Blob([this.escapeXml(manga.name) + ':' + chapters.length]),
                filename: this.sanitizeText(' probe.prb '),
                mimeType: 'application/x-probe'
            };
        }
    }
    global.ExporterRegistry.register('probe', ProbeExporter, { label: 'PROBE' });
})(typeof window !== 'undefined' ? window : self);`;

/**
 * Исполняет код заглушки в отдельном реалме, как в iframe песочницы.
 * @param {string} code - Код заглушки.
 * @returns {{context: object, send: function(object): Promise<object>}} Реалм и отправка сообщения.
 */
function runStub(code) {
    const listeners = [];
    const context = vm.createContext({ Blob: NodeBlob, console });
    context.window = context;
    context.self = context;
    context.addEventListener = (type, listener) => listeners.push({ type, listener });
    vm.runInContext(code, context);

    const send = data => new Promise(resolveReply => {
        const source = { postMessage: reply => resolveReply(reply) };
        listeners.filter(l => l.type === 'message').forEach(l => l.listener({ data, source }));
    });
    return { context, listeners, send };
}

/**
 * Описывает API заглушки: глобалы, методы BaseExporter и ExporterRegistry, слушатели.
 * @param {{context: object, listeners: object[]}} stub - Исполненная заглушка.
 * @returns {object} Описание API.
 */
function describeApi({ context, listeners }) {
    return {
        globals: ['BaseService', 'BaseExporter', 'ExporterRegistry'].filter(name => typeof context[name] !== 'undefined'),
        exporterMethods: Object.getOwnPropertyNames(context.BaseExporter.prototype)
            .filter(name => name !== 'constructor').sort(),
        registryMethods: Object.keys(context.ExporterRegistry).sort(),
        listeners: listeners.map(l => l.type)
    };
}

let chromeStubCode;
let firefoxStubCode;

beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    chromeStubCode = readFileSync(resolve(root, 'sandbox.js'), 'utf8');

    globalThis.browser = { runtime: { id: 'ext', sendMessage: vi.fn(async () => ({ ok: true })) } };
    await import('../../core/pluginApi.js');
    const { PluginManager } = await import('../../core/PluginManager.js');

    vi.spyOn(document.head, 'appendChild').mockImplementation(el => { Promise.resolve().then(() => el.onerror?.()); });
    await PluginManager._loadViaSW(globalThis.browser, { format: 'sbx', code: 'void 0', label: 'SBX' });

    const fakeIframe = { setAttribute: vi.fn(), style: {}, srcdoc: '', addEventListener: vi.fn(), remove: vi.fn() };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(tag => (tag === 'iframe' ? fakeIframe : createElement(tag)));
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => {});

    vi.useFakeTimers();
    const exporting = globalThis.ExporterRegistry.create('sbx').export({}, [], null);
    const settled = expect(exporting).rejects.toThrow('Sandbox load timeout');
    await vi.advanceTimersByTimeAsync(5000);
    await settled;
    vi.useRealTimers();

    firefoxStubCode = fakeIframe.srcdoc.match(/<script>([\s\S]*)<\/script>/)[1];
});

afterAll(() => {
    vi.restoreAllMocks();
    delete globalThis.browser;
});

describe('Plugin sandbox stubs', () => {
    it('sandbox.js provides the documented minimal API', () => {
        const api = describeApi(runStub(chromeStubCode));
        expect(api.globals).toEqual(['BaseService', 'BaseExporter', 'ExporterRegistry']);
        expect(api.exporterMethods).toEqual(expect.arrayContaining(['escapeXml', 'escapeHtml', 'sanitizeText']));
        expect(api.registryMethods).toEqual(expect.arrayContaining(['register']));
        expect(api.listeners).toEqual(['message']);
    });

    it('The Firefox sandbox exposes the same API as sandbox.js', () => {
        expect(describeApi(runStub(firefoxStubCode))).toEqual(describeApi(runStub(chromeStubCode)));
    });

    it.each([['sandbox.js', () => chromeStubCode], ['Firefox srcdoc', () => firefoxStubCode]])(
        '%s runs a plugin through sb-exec and sb-export', async (_name, getCode) => {
            const stub = runStub(getCode());

            await expect(stub.send({ _t: 'sb-exec', _id: 1, code: probePlugin }))
                .resolves.toEqual({ _t: 'sb-ok', _id: 1, c: { format: 'probe' } });

            const reply = await stub.send({
                _t: 'sb-export', _id: 2, fmt: 'probe', manga: { name: 'A&B' }, chapters: [{}, {}], cover: null
            });
            expect(reply).toMatchObject({ _t: 'sb-export-ok', _id: 2, filename: 'probe.prb', mimeType: 'application/x-probe' });
            expect(new TextDecoder().decode(reply.buf)).toBe('A&amp;B:2');

            await expect(stub.send({ _t: 'sb-export', _id: 3, fmt: 'missing', manga: {}, chapters: [], cover: null }))
                .resolves.toEqual({ _t: 'sb-err', _id: 3, e: 'Format not registered in sandbox: missing' });
        }
    );
});
