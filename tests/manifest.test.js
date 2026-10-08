import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifests = {
    chrome: JSON.parse(readFileSync(resolve(root, 'manifest.chrome.json'), 'utf8')),
    firefox: JSON.parse(readFileSync(resolve(root, 'manifest.firefox.json'), 'utf8'))
};

describe.each(Object.entries(manifests))('%s manifest', (name, manifest) => {
    it('Takes service hosts from the configs: no static content scripts or host lists', () => {
        expect(manifest.content_scripts).toBeUndefined();
        expect(manifest.host_permissions).toEqual(['https://*/*']);
    });

    it('Has no static declarativeNetRequest rule files', () => {
        expect(manifest.declarative_net_request).toBeUndefined();
        expect(manifest.permissions).toContain('declarativeNetRequest');
        expect(manifest.permissions).toContain('scripting');
    });
});

describe('Browser-specific manifest settings', () => {
    it('Loads the Chrome background as a module service worker', () => {
        expect(manifests.chrome.background).toEqual({ service_worker: 'background/service-worker.js', type: 'module' });
    });

    it('Requires Firefox 115 for session rules', () => {
        expect(manifests.firefox.browser_specific_settings.gecko.strict_min_version).toBe('115.0');
    });

    it('Does not ship the removed static rule files', () => {
        expect(existsSync(resolve(root, 'rules.chrome.json'))).toBe(false);
        expect(existsSync(resolve(root, 'rules.firefox.json'))).toBe(false);
    });
});
