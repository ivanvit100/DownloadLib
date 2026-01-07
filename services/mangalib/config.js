'use strict';

(function(global) {
    global.mangalibConfig = {
        name: 'mangalib',
        baseUrl: 'https://api.cdnlibs.org',
        imagesDomain: 'https://img3.mixlib.me',
        siteId: '1',
        
        fields: [
            'background', 'eng_name', 'otherNames', 'summary', 'releaseDate', 'type_id',
            'caution', 'views', 'close_view', 'rate_avg', 'rate', 'genres',
            'tags', 'teams', 'user', 'franchise', 'authors', 'publisher',
            'userRating', 'moderated', 'metadata', 'metadata.count',
            'metadata.close_comments', 'manga_status_id', 'chap_count',
            'status_id', 'artists', 'format'
        ],

        headers: {
            'Accept': '*/*',
            'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
            'Site-Id': '1',
            'Content-Type': 'application/json',
            'Client-Time-Zone': 'Europe/Moscow',
            'Referer': 'https://mangalib.me/',
            'Origin': 'https://mangalib.me',
            'Sec-GPC': '1'
        },

        splitLongImages: true,
        maxImageHeight: 1800
    };
})(window);