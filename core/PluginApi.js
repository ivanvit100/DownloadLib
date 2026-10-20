/**
 * DownloadLib plugin API
 * Exposes the classes that user plugins extend and register with as globals,
 * plus the deprecated globals plugins could rely on before 1.1
 * @module core/PluginApi
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { browserEnv, extensionApi } from './BrowserApi.js';
import { DownloadContext } from './DownloadContext.js';
import { EventBus } from './EventBus.js';
import { ImageCompressor } from './ImageCompressor.js';
import { MangaPatcher } from './MangaPatcher.js';
import { RateLimiter } from './RateLimiter.js';
import { RateLimitClient } from './RateLimitClient.js';
import { fetchViaTab, hasServiceTab, NoServiceTabError, requestViaTab, setServiceTab } from './TabNetwork.js';
import { BaseExporter } from '../exporters/BaseExporter.js';
import { EPUBExporter } from '../exporters/EPUBExporter.js';
import { ExporterRegistry } from '../exporters/ExporterRegistry.js';
import { FB2Exporter } from '../exporters/FB2Exporter.js';
import { MOBIExporter } from '../exporters/MOBIExporter.js';
import { PDFExporter } from '../exporters/PDFExporter.js';
import { SimpleExporter } from '../exporters/SimpleExporter.js';
import { BaseService } from '../services/BaseService.js';
import { mangalibConfig } from '../services/mangalib/config.js';
import { MangaLibService } from '../services/mangalib/MangaLibService.js';
import { ranobelibConfig } from '../services/ranobelib/config.js';
import { RanobeLibService } from '../services/ranobelib/RanobeLibService.js';
import { ServiceRegistry, serviceRegistry } from '../services/ServiceRegistry.js';

/**
 * Поддерживаемый API плагинов: базовые классы и реестры, от которых плагины
 * наследуются и в которых регистрируются.
 */
export const pluginApi = { BaseExporter, ExporterRegistry, BaseService, serviceRegistry };

/**
 * Глобалы, которые видел код плагинов до версии 1.1. Устаревшие, но не удаляются:
 * на них могут опираться плагины пользователей. Имена и формы результатов
 * не меняются. То, что внутри расширения со временем меняется, опубликовано
 * обёртками, и при изменениях правятся только они.
 */
export const legacyPluginGlobals = {
    ImageCompressor,
    MangaPatcher,
    EventBus,
    RateLimiter,
    ServiceRegistry,
    FB2Exporter,
    EPUBExporter,
    MOBIExporter,
    PDFExporter,
    SimpleExporter,
    MangaLibService,
    RanobeLibService,
    mangalibConfig,
    ranolibConfig: ranobelibConfig,
    NoServiceTabError,
    extensionApi,
    browserEnv,
    getExtensionApi: () => extensionApi,
    getBrowserEnv: () => browserEnv,
    fetchViaTab: async (url, serviceKey) => {
        const result = await fetchViaTab(url, serviceKey);
        return result.ok ? { ok: true, base64: result.base64, contentType: result.contentType } : null;
    },
    requestViaTab: (url, options, serviceKey) => requestViaTab(url, options, serviceKey),
    hasServiceTab: serviceKey => hasServiceTab(serviceKey),
    setServiceTab: tabId => setServiceTab(tabId),
    fetchPageImage: async (url, serviceKey) => {
        const result = await fetchViaTab(url, serviceKey);
        if (result.noTab)
            throw new NoServiceTabError('Откройте страницу сервиса в отдельной вкладке, чтобы продолжить загрузку');
        return result.ok
            ? { ok: true, base64: result.base64, contentType: result.contentType }
            : { ok: false, error: result.error || 'Image fetch failed' };
    },
    loadImageOrDefer: (label, load) => {
        const ctx = DownloadContext.current;
        return ctx ? ctx.loadImageOrDefer(label, load) : Promise.resolve().then(load);
    },
    globalRateLimiter: {
        setLimit: limit => { RateLimitClient.setLimit(limit); },
        throttle: (duration = 30000) => { RateLimitClient.throttle(duration); },
        trackRequest: (source = 'unknown') => RateLimitClient.acquire(source),
        recordRequest: (source = 'unknown') => { RateLimitClient.acquire(source); },
        acquire: (serviceName = 'default') => RateLimitClient.acquire(serviceName),
        execute: async (serviceName, fn) => {
            await RateLimitClient.acquire(serviceName);
            return fn();
        },
        getStats: () => RateLimitClient.getStats(),
        reset: () => RateLimitClient.reset()
    }
};

/**
 * Плагины — классические скрипты и не могут импортировать модули расширения,
 * поэтому API плагинов публикуется в globalThis. Это единственное место
 * в расширении с намеренными глобалами.
 */
Object.assign(globalThis, pluginApi, legacyPluginGlobals);
