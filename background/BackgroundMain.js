/**
 * DownloadLib background module
 * Entry point of the background context: the Chrome service worker
 * and the Firefox background page both load this module. Session ad block rules
 * are dropped when the browser closes, so the onStartup listener makes the browser
 * start the background on launch and reinstalls them
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

extensionApi?.runtime?.onStartup?.addListener(installAdBlockRules);

createLogger('Background').info('Started');
