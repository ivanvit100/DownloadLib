import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../core/BrowserApi.js', async () => (await import('../helpers/globalBridge.js')).globalBridge('extensionApi'));

let buildAdBlockRules, installAdBlockRules;

beforeEach(async () => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    ({ buildAdBlockRules, installAdBlockRules } = await import('../../background/netRules.js'));
});

afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.extensionApi;
});

describe('buildAdBlockRules', () => {
    it('Builds one block rule per adBlock filter, limited to the service sites', () => {
        const rules = buildAdBlockRules([
            { name: 'a', hosts: ['a.example', 'a.test'], adBlock: ['|https://ads.example/', '||tracker.example^'] },
            { name: 'b', hosts: ['b.example'], adBlock: ['|https://ads.example/'] },
            { name: 'c', hosts: ['c.example'] }
        ]);
        expect(rules).toEqual([
            {
                id: 1000, priority: 1, action: { type: 'block' },
                condition: { urlFilter: '|https://ads.example/', initiatorDomains: ['a.example', 'a.test'] }
            },
            {
                id: 1001, priority: 1, action: { type: 'block' },
                condition: { urlFilter: '||tracker.example^', initiatorDomains: ['a.example', 'a.test'] }
            },
            {
                id: 1002, priority: 1, action: { type: 'block' },
                condition: { urlFilter: '|https://ads.example/', initiatorDomains: ['b.example'] }
            }
        ]);
    });

    it('Builds the rules of the built-in services from their configs', () => {
        const rules = buildAdBlockRules();
        expect(rules.map(r => [r.condition.urlFilter, r.condition.initiatorDomains])).toEqual([
            ['|https://mangalib.me/uploads/slider_items/', ['mangalib.me', 'mangalib.org']],
            ['|https://yandex.ru/', ['mangalib.me', 'mangalib.org']],
            ['|https://yandex.ru/', ['ranobelib.me']]
        ]);
        expect(new Set(rules.map(r => r.id)).size).toBe(rules.length);
    });

    it('Does not share the host arrays of the configs', () => {
        const config = { name: 'a', hosts: ['a.example'], adBlock: ['|https://ads.example/'] };
        const [rule] = buildAdBlockRules([config]);
        rule.condition.initiatorDomains.push('other.example');
        expect(config.hosts).toEqual(['a.example']);
    });
});

describe('installAdBlockRules', () => {
    it('Replaces previously installed ad block rules in one update', async () => {
        const updateSessionRules = vi.fn().mockResolvedValue();
        globalThis.extensionApi = {
            declarativeNetRequest: {
                getSessionRules: vi.fn().mockResolvedValue([{ id: 1000 }, { id: 1005 }, { id: 7 }, { id: 2000 }]),
                updateSessionRules
            }
        };
        await installAdBlockRules();
        expect(updateSessionRules).toHaveBeenCalledTimes(1);
        const [{ removeRuleIds, addRules }] = updateSessionRules.mock.calls[0];
        expect(removeRuleIds).toEqual([1000, 1005]);
        expect(addRules).toEqual(buildAdBlockRules());
    });

    it('Warns and does nothing when session rules are not supported', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.extensionApi = { declarativeNetRequest: {} };
        await expect(installAdBlockRules()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith('[netRules] declarativeNetRequest session rules are not available');
    });

    it('Warns and does nothing without the extension api', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.extensionApi = null;
        await expect(installAdBlockRules()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
    });

    it('Warns instead of throwing when the update fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.extensionApi = {
            declarativeNetRequest: {
                getSessionRules: vi.fn().mockResolvedValue([]),
                updateSessionRules: vi.fn().mockRejectedValue(new Error('invalid rule'))
            }
        };
        await expect(installAdBlockRules()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith('[netRules] Failed to install ad block rules:', 'invalid rule');
    });
});
