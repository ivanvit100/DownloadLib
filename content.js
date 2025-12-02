'use strict';

window.addEventListener('message', (event) => {
    if (event.data.type === 'GET_MANGA_SLUG') {
        const slug = window.location.pathname.match(/\/(manga|book)\/([^\/\?]+)/)?.[2];
        event.source.postMessage({
            type: 'MANGA_SLUG',
            slug: slug
        }, event.origin);
    }
});