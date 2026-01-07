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
            'Accept': '*/*',
            'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3',
            'Site-Id': '3',
            'Content-Type': 'application/json',
            'Client-Time-Zone': 'Europe/Moscow',
            'Referer': 'https://ranobelib.me/',
            'Origin': 'https://ranobelib.me',
            'Sec-GPC': '1'
        }
    };
})(window);