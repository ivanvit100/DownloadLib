// Настройка проверок. Каждый объект в массиве — один запрос.
//
// Поля объекта:
//   id          — уникальный идентификатор (отображается в Telegram при ошибке)
//   url         — адрес запроса
//   method      — HTTP-метод (по умолчанию GET)
//   headers     — дополнительные заголовки (опционально)
//   body        — тело запроса для POST/PUT (опционально, объект → JSON)
//   expectFields — массив правил проверки тела ответа (опционально)
//
// Правила expectFields:
//   { path: 'user.id' }                        — поле должно существовать
//   { path: 'status', value: 'ok' }            — точное совпадение значения
//   { path: 'items', type: 'array' }           — проверка типа (string/number/boolean/array/object)
//   { path: 'count', min: 1 }                  — числовое значение >= min
//   { path: 'count', max: 100 }                — числовое значение <= max
//   { path: 'token', match: '^[a-z0-9]+$' }   — совпадение с регулярным выражением
//   { path: 'name', notEmpty: true }           — непустая строка/массив
// ─────────────────────────────────────────────────────────────────────────────

const headers = {
  ranobelib: {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Accept': '*/*',
    'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8',
    'Site-Id': '3',
    'X-DL-Service': 'ranobelib',
    'Content-Type': 'application/json',
    'Client-Time-Zone': 'Europe/Moscow',
    'Referer': 'https://ranobelib.me/',
    'Origin': 'https://ranobelib.me',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site'
  },
  mangalib: {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0',
    'Accept': '*/*',
    'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8',
    'Site-Id': '1',
    'X-DL-Service': 'mangalib',
    'Content-Type': 'application/json',
    'Client-Time-Zone': 'Europe/Moscow',
    'Referer': 'https://mangalib.me/',
    'Origin': 'https://mangalib.me',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site'
  }
};

module.exports = [
  // ─── RanobeLib ────────────────────────────────────────────────────────────
  {
    id: 'RanobeLib API: Manga Info',
    url: `https://api.cdnlibs.org/api/manga/62340--the-angel-next-door-spoils-me-rotten?fields[]=background&fields[]=eng_name&fields[]=otherNames&fields[]=summary&fields[]=releaseDate&fields[]=type_id&fields[]=caution&fields[]=views&fields[]=close_view&fields[]=rate_avg&fields[]=rate&fields[]=genres&fields[]=tags&fields[]=teams&fields[]=user&fields[]=franchise&fields[]=authors&fields[]=publisher&fields[]=userRating&fields[]=moderated&fields[]=metadata&fields[]=metadata.count&fields[]=metadata.close_comments&fields[]=translation_quality_rating&fields[]=manga_status_id&fields[]=chap_count&fields[]=status_id&fields[]=artists&fields[]=format`,
    method: 'GET',
    headers: headers.ranobelib,
    expectFields: [
      { path: 'data.id', value: 62340 },
      { path: 'data.name', value: 'Otonari no tenshi-sama ni itsunomanika dame ningen ni sa rete ita kudan (WN)' },
      { path: 'data.rus_name', value: 'Ангел по соседству (WN)' },
      { path: 'data.slug', value: 'the-angel-next-door-spoils-me-rotten' },
      { path: 'data.slug_url', value: '62340--the-angel-next-door-spoils-me-rotten' },
      { path: 'data.cover.filename', type: 'string' },
      { path: 'data.ageRestriction.label', type: 'string' },
      { path: 'data.site', value: 3 },
      { path: 'data.summary.content', type: 'array' },
      { path: 'data.authors', type: 'array' },
      { path: 'data.releaseDateString', type: 'string' }
    ]
  },
  {
    id: 'RanobeLib API: Chapters',
    url: `https://api.cdnlibs.org/api/manga/62340--the-angel-next-door-spoils-me-rotten/chapters`,
    method: 'GET',
    headers: headers.ranobelib,
    expectFields: [
      { path: 'data', type: 'array' },
      { path: 'data[0].id', type: 'number' },
      { path: 'data[0].volume', value: '1' },
      { path: 'data[0].number', value: '1' },
      { path: 'data[0].name', type: 'string' }
    ]
  },
  {
    id: 'RanobeLib API: Chapter Content',
    url: `https://api.cdnlibs.org/api/manga/62340--the-angel-next-door-spoils-me-rotten/chapter?branch_id=24124&number=1&volume=1`,
    method: 'GET',
    headers: headers.ranobelib,
    expectFields: [
      { path: 'data', type: 'object' },
      { path: 'data.id', type: 'number' },
      { path: 'data.model', value: 'chapter' },
      { path: 'data.volume', value: '1' },
      { path: 'data.number', value: '1' },
      { path: 'data.type', value: 'chapter' },
      { path: 'data.content', type: 'string' },
      { path: 'data.attachments[0].filename', type: 'string' }
    ]
  },
  {
    id: 'RanobeLib API: Chapter Image',
    url: `https://ranobelib.me/uploads/ranobe/the-angel-next-door-spoils-me-rotten/chapters/1232183/2097_jhpl.jpg`,
    method: 'GET',
    headers: headers.ranobelib,
    expectContentType: 'image/'
  },
  {
    id: 'RanobeLib API: Title Cover',
    url: `https://cover.cdnlibs.org/uploads/cover/the-angel-next-door-spoils-me-rotten/cover/a22648d0-0c99-4a14-a496-fc525fa9d3fc.jpg`,
    method: 'GET',
    headers: headers.ranobelib,
    expectContentType: 'image/'
  },

  // ─── MangaLib ────────────────────────────────────────────────────────────
  {
    id: 'MangaLib API: Manga Info',
    url: `https://api.cdnlibs.org/api/manga/6435--kaguya-sama-wa-kokurasetai-tensai-tachi-no-renai-zunousen?fields[]=background&fields[]=eng_name&fields[]=otherNames&fields[]=summary&fields[]=releaseDate&fields[]=type_id&fields[]=caution&fields[]=views&fields[]=close_view&fields[]=rate_avg&fields[]=rate&fields[]=genres&fields[]=tags&fields[]=teams&fields[]=user&fields[]=franchise&fields[]=authors&fields[]=publisher&fields[]=userRating&fields[]=moderated&fields[]=metadata&fields[]=metadata.count&fields[]=metadata.close_comments&fields[]=translation_quality_rating&fields[]=manga_status_id&fields[]=chap_count&fields[]=status_id&fields[]=artists&fields[]=format`,
    method: 'GET',
    headers: headers.mangalib,
    expectFields: [
      { path: 'data.id', value: 6435 },
      { path: 'data.name', value: 'Kaguya-sama wa Kokurasetai - Tensai-tachi no Renai Zunousen' },
      { path: 'data.rus_name', value: 'Кагуя хочет, чтобы ей признались: Гении — война любви и разума' },
      { path: 'data.slug', value: 'kaguya-sama-wa-kokurasetai-tensai-tachi-no-renai-zunousen' },
      { path: 'data.slug_url', value: '6435--kaguya-sama-wa-kokurasetai-tensai-tachi-no-renai-zunousen' },
      { path: 'data.cover.filename', type: 'string' },
      { path: 'data.ageRestriction.label', type: 'string' },
      { path: 'data.site', value: 1 },
      { path: 'data.summary.content', type: 'array' },
      { path: 'data.authors', type: 'array' },
      { path: 'data.releaseDateString', type: 'string' }
    ]
  },
  {
    id: 'MangaLib API: Chapters',
    url: `https://api.cdnlibs.org/api/manga/6435--kaguya-sama-wa-kokurasetai-tensai-tachi-no-renai-zunousen/chapters`,
    method: 'GET',
    headers: headers.mangalib,
    expectFields: [
      { path: 'data', type: 'array' },
      { path: 'data[0].id', type: 'number' },
      { path: 'data[0].volume', value: '1' },
      { path: 'data[0].number', value: '1' },
      { path: 'data[0].name' }
    ]
  },
  {
    id: 'MangaLib API: Chapter Content',
    url: `https://api.cdnlibs.org/api/manga/6435--kaguya-sama-wa-kokurasetai-tensai-tachi-no-renai-zunousen/chapter?branch_id=24124&number=1&volume=1`,
    method: 'GET',
    headers: headers.mangalib,
    expectFields: [
      { path: 'data', type: 'object' },
      { path: 'data.id', type: 'number' },
      { path: 'data.model', value: 'chapter' },
      { path: 'data.volume', value: '1' },
      { path: 'data.number', value: '1' },
      { path: 'data.type', value: 'chapter' },
      { path: 'data.pages[0].id', type: 'number' },
      { path: 'data.pages[0].image', type: 'string' },
      { path: 'data.pages[0].url', type: 'string' }
    ]
  },
  {
    id: 'MangaLib API: Chapter Image',
    url: `https://img3.cdnlibs.org//manga/kaguya-sama-wa-kokurasetai-tensai-tachi-no-renai-zunousen/chapters/1-1/kaguya_wants_to_be_confessed_to__the_geniuses__war_of_love_and_brains__A1b7de4_1_1_0.jpg`,
    method: 'GET',
    headers: headers.mangalib,
    expectContentType: 'image/'
  },
  {
    id: 'MangaLib API: Title Cover',
    url: `https://cover.cdnlibs.org/uploads/cover/kaguya-sama-wa-kokurasetai-tensai-tachi-no-renai-zunousen/cover/uBcYKxKek1sC_250x350.jpg`,
    method: 'GET',
    headers: headers.mangalib,
    expectContentType: 'image/'
  }
];
