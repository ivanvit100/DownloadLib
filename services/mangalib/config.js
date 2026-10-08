export const mangalibConfig = {
    name: 'mangalib',
    baseUrl: 'https://api.cdnlibs.org',
    imagesDomain: 'https://img3.cdnlibs.org',
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
        'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8',
        'Site-Id': '1',
        'X-DL-Service': 'mangalib',
        'Content-Type': 'application/json',
        'Client-Time-Zone': 'Europe/Moscow'
    },

    imageHeaders: {
        'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
        'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.5,en;q=0.3'
    },

    splitLongImages: true,
    maxImageHeight: 1800,

    hosts: ['mangalib.me', 'mangalib.org'],
    imageHosts: [
        'cover.cdnlibs.org', 'img1.cdnlibs.org', 'img2.cdnlibs.org', 'img3.cdnlibs.org',
        'mixlib.me', 'imgslib.link'
    ],
    titleUrl: 'https://mangalib.me/ru/manga/{slug}',
    adBlock: ['|https://mangalib.me/uploads/slider_items/', '|https://yandex.ru/'],

    label: 'MangaLib',
    siteUrl: 'https://mangalib.me',
    primaryColor: '#ff9100',
    secondaryColor: '#c77101',
    logo: 'icons/logo1.png'
};
