import { describe, it, expect, vi } from 'vitest';

vi.mock('../../services/mangalib/config.js', () => ({
    mangalibConfig: { name: 'mangalib', baseUrl: 'not a url', hosts: ['manga.example'] }
}));
vi.mock('../../services/ranobelib/config.js', () => ({
    ranobelibConfig: {
        name: 'ranobelib', baseUrl: 'https://api.ranobe.example', hosts: ['ranobe.example'], imageHosts: ['img.ranobe.example']
    }
}));

describe('services/hosts with configs that omit optional fields', () => {
    it('webRequestUrls skips a missing CDN list and an unreadable API host', async () => {
        const { webRequestUrls } = await import('../../services/ServiceHosts.js');
        expect(webRequestUrls()).toEqual([
            'https://*.manga.example/*',
            'https://*.ranobe.example/*',
            'https://*.img.ranobe.example/*',
            'https://*.api.ranobe.example/*'
        ]);
    });
});
