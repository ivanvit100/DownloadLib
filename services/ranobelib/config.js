export const ranolibConfig = {
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
        'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8',
        'Site-Id': '3',
        'X-DL-Service': 'ranobelib',
        'Content-Type': 'application/json',
        'Client-Time-Zone': 'Europe/Moscow'
    },

    imageHeaders: {
        'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
        'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8'
    },

    label: 'RanobeLib',
    siteUrl: 'https://ranobelib.me',
    primaryColor: '#2196f3',
    secondaryColor: '#1f82d3',
    logo: 'icons/logo3.png'
};
