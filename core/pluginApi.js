/**
 * DownloadLib plugin API
 * Exposes the classes that user plugins extend and register with as globals,
 * plus the deprecated globals plugins could rely on before 1.1
 * @module core/pluginApi
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import {
    browserEnv, extensionApi, fetchViaTab, hasServiceTab, NoServiceTabError, requestViaTab, setServiceTab
} from './BrowserApi.js';
import { fetchPageImage, loadImageOrDefer } from './DownloadManager.js';
import { EventBus } from './EventBus.js';
import { ImageCompressor } from './ImageCompressor.js';
import { MangaPatcher } from './MangaPatcher.js';
import { RateLimiter } from './RateLimiter.js';
import { RateLimitClient } from './RateLimitClient.js';
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
    fetchViaTab: (url, serviceKey) => fetchViaTab(url, serviceKey),
    requestViaTab: (url, options, serviceKey) => requestViaTab(url, options, serviceKey),
    hasServiceTab: serviceKey => hasServiceTab(serviceKey),
    setServiceTab: tabId => setServiceTab(tabId),
    fetchPageImage: (url, serviceKey) => fetchPageImage(url, serviceKey),
    loadImageOrDefer: (label, load) => loadImageOrDefer(label, load),
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
