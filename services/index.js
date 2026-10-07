/**
 * DownloadLib service bootstrap
 * Registers the built-in services in the shared service registry
 * @module services/index
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { MangaLibService } from './mangalib/MangaLibService.js';
import { RanobeLibService } from './ranobelib/RanobeLibService.js';
import { serviceRegistry } from './ServiceRegistry.js';

serviceRegistry.register(MangaLibService);
serviceRegistry.register(RanobeLibService);

export { serviceRegistry };
