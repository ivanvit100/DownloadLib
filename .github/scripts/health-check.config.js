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

module.exports = [
  {
    id: 'api-status',
    url: `https://api.cdnlibs.org/api/manga/62340--the-angel-next-door-spoils-me-rotten?fields[]=background&fields[]=eng_name&fields[]=otherNames&fields[]=summary&fields[]=releaseDate&fields[]=type_id&fields[]=caution&fields[]=views&fields[]=close_view&fields[]=rate_avg&fields[]=rate&fields[]=genres&fields[]=tags&fields[]=teams&fields[]=user&fields[]=franchise&fields[]=authors&fields[]=publisher&fields[]=userRating&fields[]=moderated&fields[]=metadata&fields[]=metadata.count&fields[]=metadata.close_comments&fields[]=translation_quality_rating&fields[]=manga_status_id&fields[]=chap_count&fields[]=status_id&fields[]=artists&fields[]=format`,
    method: 'GET',
    expectFields: [
      { path: 'data.id', value: 62340 },
      { path: 'data.name', value: 'Otonari no tenshi-sama ni itsunomanika dame ningen ni sa rete ita kudan (WN)' },
      { path: 'data.rus_name', value: 'Ангел по соседству (WN)' },
      { path: 'data.slug', value: 'the-angel-next-door-spoils-me-rotten' },
      { path: 'data.slug_url', value: '62340--the-angel-next-door-spoils-me-rotten' },
      { path: 'data.cover.filename' },
      { path: 'data.id', value: '62340' },
      { path: 'data.ageRestriction.label' },
      { path: 'data.site', value: '3' },
      { path: 'data.summary.content' },
      { path: 'data.authors' },
      { path: 'data.id', value: '62340' },
      { path: 'data.releaseDateString' }
    ]
  }
];
