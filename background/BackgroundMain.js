/**
 * DownloadLib background module
 * Entry point of the background context: the Chrome service worker
 * and the Firefox background page both load this module
 * @module background/BackgroundMain
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from '../core/BrowserApi.js';
import { createLogger, watchLogLevel } from '../core/ConsoleLogger.js';
import { installAdBlockRules } from './AdBlockRules.js';
import './RequestInterceptor.js';
import './MessageRouter.js';

watchLogLevel(extensionApi);
installAdBlockRules();

// Сессионные правила пропадают при закрытии браузера: слушатель onStartup
// заставляет браузер запустить фон при старте, и правила ставятся заново.
extensionApi?.runtime?.onStartup?.addListener(installAdBlockRules);

createLogger('Background').info('Started');
