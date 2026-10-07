/**
 * DownloadLib plugin API
 * Exposes the classes that user plugins extend and register with as globals
 * @module core/pluginApi
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { BaseExporter } from '../exporters/BaseExporter.js';
import { ExporterRegistry } from '../exporters/ExporterRegistry.js';
import { BaseService } from '../services/BaseService.js';
import { serviceRegistry } from '../services/ServiceRegistry.js';

/**
 * Плагины — классические скрипты и не могут импортировать модули расширения,
 * поэтому базовые классы и реестры, которые они используют, публикуются
 * в globalThis. Это единственное место в расширении с намеренными глобалами.
 */
Object.assign(globalThis, { BaseExporter, ExporterRegistry, BaseService, serviceRegistry });
