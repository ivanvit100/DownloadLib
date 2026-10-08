import { describe, it, expect } from 'vitest';
import {
    buildTitleUrl, extractSlug, isApiUrl, isImageHost, isServiceHost, matchesHosts, serviceConfig,
    serviceConfigs, serviceKeyForSiteId, serviceKeyForUrl, serviceOrigins, tabPatterns, webRequestUrls
} from '../../services/hosts.js';
import { mangalibConfig } from '../../services/mangalib/config.js';
import { ranobelibConfig } from '../../services/ranobelib/config.js';

describe('services/hosts', () => {
    it('Lists the built-in service configs in priority order', () => {
        expect(serviceConfigs).toEqual([mangalibConfig, ranobelibConfig]);
        expect(serviceConfig('ranobelib')).toBe(ranobelibConfig);
        expect(serviceConfig('unknown')).toBeNull();
        expect(serviceConfig(null)).toBeNull();
    });

    describe('matchesHosts', () => {
        it('Matches a host and its subdomains, case-insensitively', () => {
            expect(matchesHosts('https://mangalib.me/ru/manga/x', ['mangalib.me'])).toBe(true);
            expect(matchesHosts('https://test-front.MangaLib.me/', ['mangalib.me'])).toBe(true);
            expect(matchesHosts('https://img.example.com/a.jpg', ['EXAMPLE.com'])).toBe(true);
        });

        it('Compares host names, not substrings of the URL', () => {
            expect(matchesHosts('https://notmangalib.me/', ['mangalib.me'])).toBe(false);
            expect(matchesHosts('https://mangalib.me.evil.example/', ['mangalib.me'])).toBe(false);
            expect(matchesHosts('https://evil.example/?next=https://mangalib.me/', ['mangalib.me'])).toBe(false);
        });

        it('Returns false for invalid URLs and empty host lists', () => {
            expect(matchesHosts('not a url', ['mangalib.me'])).toBe(false);
            expect(matchesHosts(undefined, ['mangalib.me'])).toBe(false);
            expect(matchesHosts('https://mangalib.me/')).toBe(false);
        });
    });

    describe('serviceKeyForUrl', () => {
        it('Detects built-in services by site host', () => {
            expect(serviceKeyForUrl('https://mangalib.me/ru/manga/x')).toBe('mangalib');
            expect(serviceKeyForUrl('https://mangalib.org/ru/manga/x')).toBe('mangalib');
            expect(serviceKeyForUrl('https://ranobelib.me/ru/book/x')).toBe('ranobelib');
        });

        it('Detects built-in services by image CDN host', () => {
            expect(serviceKeyForUrl('https://img3.cdnlibs.org/manga/a.jpg')).toBe('mangalib');
            expect(serviceKeyForUrl('https://img2.imgslib.link/a.jpg')).toBe('mangalib');
            expect(serviceKeyForUrl('https://cover.imglib.info/a.jpg')).toBe('ranobelib');
        });

        it('Does not attribute the shared API host to a service', () => {
            expect(serviceKeyForUrl('https://api.cdnlibs.org/api/manga/x')).toBeNull();
        });

        it('Falls back to plugin hosts after the built-in services', () => {
            const pluginHosts = { hlib: ['hentailib.me'], other: ['mangalib.me'] };
            expect(serviceKeyForUrl('https://v2.hentailib.me/ru/manga/x', pluginHosts)).toBe('hlib');
            expect(serviceKeyForUrl('https://mangalib.me/ru/manga/x', pluginHosts)).toBe('mangalib');
            expect(serviceKeyForUrl('https://example.com/', pluginHosts)).toBeNull();
        });

        it('Returns null for unknown and invalid URLs', () => {
            expect(serviceKeyForUrl('https://example.com/manga/x')).toBeNull();
            expect(serviceKeyForUrl('garbage')).toBeNull();
            expect(serviceKeyForUrl(undefined)).toBeNull();
        });
    });

    it('isServiceHost accepts service sites and plugin hosts but not image CDNs', () => {
        expect(isServiceHost('https://ranobelib.me/')).toBe(true);
        expect(isServiceHost('https://img3.cdnlibs.org/a.jpg')).toBe(false);
        expect(isServiceHost('https://hentailib.me/', { hlib: ['hentailib.me'] })).toBe(true);
        expect(isServiceHost('https://example.com/')).toBe(false);
    });

    it('isImageHost accepts only image CDN hosts', () => {
        expect(isImageHost('https://cover.cdnlibs.org/a.jpg')).toBe(true);
        expect(isImageHost('https://img3.mixlib.me/a.jpg')).toBe(true);
        expect(isImageHost('https://mangalib.me/uploads/a.jpg')).toBe(false);
    });

    it('isApiUrl matches the host of the service baseUrl', () => {
        expect(isApiUrl('https://api.cdnlibs.org/api/manga/x')).toBe(true);
        expect(isApiUrl('https://api.cdnlibs.org.evil.example/')).toBe(false);
        expect(isApiUrl('https://cover.cdnlibs.org/a.jpg')).toBe(false);
    });

    it('serviceKeyForSiteId maps the Site-Id header to a service', () => {
        expect(serviceKeyForSiteId('1')).toBe('mangalib');
        expect(serviceKeyForSiteId(' 3 ')).toBe('ranobelib');
        expect(serviceKeyForSiteId('42')).toBeNull();
        expect(serviceKeyForSiteId(undefined)).toBeNull();
    });

    describe('tabPatterns', () => {
        it('Builds patterns from the built-in config hosts', () => {
            expect(tabPatterns('mangalib')).toEqual(['*://mangalib.me/*', '*://mangalib.org/*']);
            expect(tabPatterns('ranobelib')).toEqual(['*://ranobelib.me/*']);
        });

        it('Uses plugin hosts for plugin services', () => {
            expect(tabPatterns('hlib', { hlib: ['hentailib.me'] })).toEqual(['*://hentailib.me/*']);
        });

        it('Returns no patterns for an unknown or missing service key', () => {
            expect(tabPatterns('unknown')).toEqual([]);
            expect(tabPatterns(undefined)).toEqual([]);
        });
    });

    it('webRequestUrls covers sites, image CDNs and the API host without duplicates', () => {
        const urls = webRequestUrls();
        expect(urls).toEqual(expect.arrayContaining([
            'https://*.mangalib.me/*', 'https://*.mangalib.org/*', 'https://*.ranobelib.me/*',
            'https://*.cover.cdnlibs.org/*', 'https://*.img1.cdnlibs.org/*', 'https://*.img2.cdnlibs.org/*',
            'https://*.img3.cdnlibs.org/*', 'https://*.mixlib.me/*', 'https://*.imgslib.link/*',
            'https://*.imglib.info/*', 'https://*.api.cdnlibs.org/*'
        ]));
        expect(new Set(urls).size).toBe(urls.length);
    });

    it('serviceOrigins lists the site origins of one or all services', () => {
        expect(serviceOrigins('mangalib')).toEqual(['https://mangalib.me', 'https://mangalib.org']);
        expect(serviceOrigins()).toEqual(['https://mangalib.me', 'https://mangalib.org', 'https://ranobelib.me']);
        expect(serviceOrigins('unknown')).toEqual([]);
    });

    it('buildTitleUrl fills the slug into the config template', () => {
        expect(buildTitleUrl(mangalibConfig.titleUrl, 'abc')).toBe('https://mangalib.me/ru/manga/abc');
        expect(buildTitleUrl(ranobelibConfig.titleUrl, 'a b')).toBe('https://ranobelib.me/ru/book/a%20b');
        expect(buildTitleUrl(undefined, 'abc')).toBeNull();
    });

    describe('extractSlug', () => {
        it('Extracts the slug of manga and book pages', () => {
            expect(extractSlug('https://mangalib.me/ru/manga/abc-def')).toBe('abc-def');
            expect(extractSlug('https://ranobelib.me/ru/book/xyz/read')).toBe('xyz');
        });

        it('Stops at the query string and the fragment', () => {
            expect(extractSlug('https://mangalib.me/ru/manga/abc?section=info')).toBe('abc');
            expect(extractSlug('https://mangalib.me/ru/manga/abc#comments')).toBe('abc');
        });

        it('Returns null for other pages and non-strings', () => {
            expect(extractSlug('https://mangalib.me/ru/catalog')).toBeNull();
            expect(extractSlug(undefined)).toBeNull();
            expect(extractSlug(42)).toBeNull();
        });
    });
});
