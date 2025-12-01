'use strict';

window.addEventListener('message', (event) => {
  if (event.data.type === 'GET_MANGA_SLUG') {
    const slug = window.location.pathname.match(/\/(manga|book)\/([^\/\?]+)/)?.[2];
    event.source.postMessage({
      type: 'MANGA_SLUG',
      slug: slug
    }, event.origin);
  }
  
  if (event.data.type === 'EXTENSION_FETCH') {
    const { requestId, url, options } = event.data;
    
    (async () => {
      try {
        const resp = await fetch(url, options);
        const text = await resp.text().catch(() => '');
        
        event.source.postMessage({
          type: 'EXTENSION_FETCH_RESPONSE',
          requestId,
          ok: resp.ok,
          status: resp.status,
          text: text
        }, event.origin);
      } catch (err) {
        event.source.postMessage({
          type: 'EXTENSION_FETCH_RESPONSE',
          requestId,
          ok: false,
          status: 0,
          error: err.message
        }, event.origin);
      }
    })();
  }
});