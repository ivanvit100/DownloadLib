/**
 * DownloadLib background module
 * Entry point of the background context: the Chrome service worker
 * and the Firefox background page both load this module
 * @module background/main
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import './RequestInterceptor.js';
import './MessageRouter.js';

console.log('[Background] Started');
