/**
 * Контрактные тесты API плагинов. Проверяют то, на что опираются плагины
 * пользователей: имена, типы и формы результатов глобалов и публичных методов.
 * Менять здесь можно только подготовку окружения; изменение проверок означает
 * изменение контракта плагинов и требует согласия владельца проекта.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    globalThis.chrome = { runtime: { id: 'ext' } };
    await import('../../core/pluginApi.js');
    await import('../../services/index.js');
    await import('../../exporters/index.js');
});

const methodsOf = target => name => expect(typeof target[name], name).toBe('function');

describe('Supported plugin API', () => {
    it('BaseExporter keeps its constructor and helper methods', () => {
        const { BaseExporter } = globalThis;
        expect(typeof BaseExporter).toBe('function');
        ['export', 'sanitizeText', 'escapeXml', 'escapeHtml', 'stripHtml', 'extractText']
            .forEach(methodsOf(BaseExporter.prototype));
        expect(new BaseExporter().format).toBe('unknown');
    });

    it('BaseExporter helpers keep their results', () => {
        const exporter = new globalThis.BaseExporter();
        expect(exporter.escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
        expect(exporter.escapeHtml(`'<b>'`)).toBe('&#39;&lt;b&gt;&#39;');
        expect(exporter.sanitizeText('  text  ')).toBe('text');
        expect(exporter.escapeXml(null)).toBe('');
    });

    it('ExporterRegistry keeps its static methods', () => {
        ['register', 'create', 'getSupportedFormats', 'getFormats'].forEach(methodsOf(globalThis.ExporterRegistry));
    });

    it('BaseService keeps its fields, request methods and helpers', () => {
        const { BaseService } = globalThis;
        expect(typeof BaseService).toBe('function');
        [
            'fetchMangaMetadata', 'fetchChaptersList', 'fetchChapter', 'extractPages', 'checkpoint',
            'interruptibleDelay', 'delay', 'fetchWithRetry', 'fetchWithRateLimitRetry', 'loadPageAsBase64', 'blobToBase64'
        ].forEach(methodsOf(BaseService.prototype));
        expect(typeof Object.getOwnPropertyDescriptor(BaseService.prototype, 'extensionApi').get).toBe('function');
        expect(typeof BaseService.matches).toBe('function');

        const service = new BaseService({ name: 'svc', baseUrl: 'https://api.example' });
        expect(service.name).toBe('svc');
        expect(service.baseUrl).toBe('https://api.example');
        expect(service.config).toEqual({ name: 'svc', baseUrl: 'https://api.example' });
    });

    it('serviceRegistry and ServiceRegistry keep their methods', () => {
        ['register', 'getServiceByUrl', 'getService', 'createService', 'getAllServices']
            .forEach(methodsOf(globalThis.serviceRegistry));
        expect(globalThis.serviceRegistry).toBeInstanceOf(globalThis.ServiceRegistry);
    });

    it('The popup loads JSZip and html2pdf as classic scripts before the app', () => {
        const html = readFileSync(resolve(root, 'popup.html'), 'utf8');
        const jszip = html.indexOf('<script src="lib/jszip.min.js">');
        const html2pdf = html.indexOf('<script src="lib/html2pdf.min.js">');
        const app = html.indexOf('<script type="module" src="app.js">');
        expect(jszip).toBeGreaterThan(-1);
        expect(html2pdf).toBeGreaterThan(-1);
        expect(app).toBeGreaterThan(Math.max(jszip, html2pdf));
    });
});

describe('Deprecated plugin globals (available before 1.1)', () => {
    it('Publishes the utility classes and objects', () => {
        ['ImageCompressor', 'MangaPatcher', 'EventBus', 'RateLimiter', 'ServiceRegistry', 'NoServiceTabError']
            .forEach(name => expect(typeof globalThis[name], name).toBe('function'));
        expect(typeof globalThis.ImageCompressor.compress).toBe('function');
        expect(typeof globalThis.MangaPatcher.patch).toBe('function');
        expect(new globalThis.NoServiceTabError('x')).toBeInstanceOf(Error);
    });

    it('Publishes the built-in exporters and services as subclasses of the base classes', () => {
        ['FB2Exporter', 'EPUBExporter', 'MOBIExporter', 'PDFExporter', 'SimpleExporter'].forEach(name =>
            expect(globalThis[name].prototype, name).toBeInstanceOf(globalThis.BaseExporter));
        ['MangaLibService', 'RanobeLibService'].forEach(name =>
            expect(globalThis[name].prototype, name).toBeInstanceOf(globalThis.BaseService));
    });

    it('Publishes the service configs under their old names', () => {
        expect(globalThis.mangalibConfig.name).toBe('mangalib');
        expect(globalThis.ranolibConfig.name).toBe('ranobelib');
    });

    it('Publishes the browser API helpers', () => {
        expect(globalThis.extensionApi).toBe(globalThis.chrome);
        expect(globalThis.getExtensionApi()).toBe(globalThis.extensionApi);
        const env = globalThis.getBrowserEnv();
        expect(env).toBe(globalThis.browserEnv);
        ['isFirefox', 'isChromium', 'supportsDnr'].forEach(key => expect(typeof env[key], key).toBe('boolean'));
    });

    it('Publishes the network and image loading functions', () => {
        ['fetchViaTab', 'requestViaTab', 'hasServiceTab', 'setServiceTab', 'fetchPageImage', 'loadImageOrDefer']
            .forEach(name => expect(typeof globalThis[name], name).toBe('function'));
    });

    it('loadImageOrDefer returns the result of the load function', async () => {
        const blocks = [{ type: 'image', data: { base64: 'AAAA', contentType: 'image/jpeg' } }];
        await expect(globalThis.loadImageOrDefer(1, async () => blocks)).resolves.toBe(blocks);
    });

    it('fetchViaTab resolves to null when no service tab can be used', async () => {
        await expect(globalThis.fetchViaTab('https://img3.cdnlibs.org/a.jpg', 'mangalib')).resolves.toBeNull();
    });

    it('Publishes globalRateLimiter with its previous methods', () => {
        ['setLimit', 'throttle', 'trackRequest', 'recordRequest', 'acquire', 'execute', 'getStats', 'reset']
            .forEach(methodsOf(globalThis.globalRateLimiter));
        expect(typeof globalThis.globalRateLimiter.getStats()).toBe('object');
    });
});
