/**
 * DownloadLib background module
 * Builds declarativeNetRequest session rules from the service configs
 * (ad blocking on service pages)
 * @module background/netRules
 * @license MIT
 * @author ivanvit
 * @version 1.1.0
 */

import { extensionApi } from '../core/BrowserApi.js';
import { serviceConfigs } from '../services/hosts.js';

/** Первый id сессионных правил блокировки рекламы. */
const AD_BLOCK_RULE_ID_BASE = 1000;

/** Сколько id зарезервировано под правила блокировки рекламы. */
const AD_BLOCK_RULE_ID_RANGE = 1000;

/**
 * Строит правила блокировки рекламы: для каждого фильтра из `config.adBlock`
 * (синтаксис urlFilter declarativeNetRequest) — правило `block`, которое
 * срабатывает только для запросов со страниц сайтов сервиса (`initiatorDomains`
 * = `config.hosts`, включая поддомены). Переходы верхнего уровня (main_frame)
 * правила не затрагивают.
 * @param {object[]} [configs] - Конфиги сервисов.
 * @returns {object[]} Правила declarativeNetRequest.
 */
export function buildAdBlockRules(configs = serviceConfigs) {
    const rules = [];
    for (const config of configs) {
        for (const urlFilter of config.adBlock || []) {
            rules.push({
                id: AD_BLOCK_RULE_ID_BASE + rules.length,
                priority: 1,
                action: { type: 'block' },
                condition: { urlFilter, initiatorDomains: [...config.hosts] }
            });
        }
    }
    return rules;
}

/**
 * Проверяет, относится ли id сессионного правила к правилам блокировки рекламы.
 * @param {number} id - id правила.
 * @returns {boolean} true, если id лежит в диапазоне правил блокировки рекламы.
 */
function isAdBlockRuleId(id) {
    return id >= AD_BLOCK_RULE_ID_BASE && id < AD_BLOCK_RULE_ID_BASE + AD_BLOCK_RULE_ID_RANGE;
}

/**
 * Заменяет сессионные правила блокировки рекламы актуальными правилами из конфигов:
 * удаляет ранее установленные правила этого диапазона id и добавляет новые одним
 * вызовом updateSessionRules. Сессионные правила живут до закрытия браузера и
 * переживают перезапуски service worker'а.
 * @returns {Promise<void>}
 */
export async function installAdBlockRules() {
    const dnr = extensionApi?.declarativeNetRequest;
    if (!dnr?.updateSessionRules) {
        console.warn('[netRules] declarativeNetRequest session rules are not available');
        return;
    }

    try {
        const existing = await dnr.getSessionRules();
        const removeRuleIds = existing.map(rule => rule.id).filter(isAdBlockRuleId);
        const addRules = buildAdBlockRules();
        await dnr.updateSessionRules({ removeRuleIds, addRules });
        console.log(`[netRules] Installed ${addRules.length} ad block rule(s)`);
    } catch (e) {
        console.warn('[netRules] Failed to install ad block rules:', e.message);
    }
}
