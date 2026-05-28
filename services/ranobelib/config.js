'use strict';

(function(global) {
    global.ranolibConfig = {
        name: 'ranobelib',
        baseUrl: 'https://api.cdnlibs.org',
        imagesDomain: 'https://cover.imglib.info',
        siteId: '3',

        fields: [
            'background', 'eng_name', 'otherNames', 'summary', 'releaseDate', 'type_id',
            'caution', 'views', 'close_view', 'rate_avg', 'rate', 'genres',
            'tags', 'teams', 'user', 'franchise', 'authors', 'publisher',
            'userRating', 'moderated', 'metadata', 'metadata.count',
            'metadata.close_comments', 'manga_status_id', 'chap_count',
            'status_id', 'artists', 'format'
        ],

        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
            'Accept': '*/*',
            'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8',
            'Site-Id': '3',
            'X-DL-Service': 'ranobelib',
            'Content-Type': 'application/json',
            'Client-Time-Zone': 'Europe/Moscow',
            'Referer': 'https://ranobelib.me/',
            'Origin': 'https://ranobelib.me',
            'Sec-GPC': '1',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
            'Connection': 'keep-alive'
        },

        imageHeaders: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0',
            'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
            'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8',
            'Referer': 'https://ranobelib.me/',
            'Sec-Fetch-Dest': 'image',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Site': 'same-origin',
            'Connection': 'keep-alive'
        }
    };
})(typeof window !== 'undefined' ? window : self);