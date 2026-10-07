# Архитектура DownloadLib

## Дерево модулей

![Дерево модулей](/screenshots/schema.svg)

---

## Связи между модулями

### Контексты исполнения

Код расширения работает в трёх изолированных контекстах:

**Popup-контекст** (`popup.html`) — открывается браузером при клике на иконку расширения или в отдельном окне при запуске загрузки. Имеет доступ к DOM, может делать fetch, но не может напрямую перехватывать сетевые запросы.

**Background-контекст** — для Firefox: `background/background.html`, для Chrome MV3: модульный service worker `background/service-worker.js`. Оба загружают один модуль `background/main.js`, который импортирует `RequestInterceptor` и `MessageRouter`. Фон перехватывает HTTP-запросы через `webRequest` и принимает сообщения от popup и контент-скриптов через `runtime.onMessage`.

**Content scripts** (`content/`) — три скрипта, исполняемых на страницах сайтов. Не участвуют в логике загрузки (кроме `ImageFetcher.js`, который прокидывает fetch-запросы изображений через вкладку).

Общение между контекстами — исключительно через `runtime.sendMessage` / `runtime.onMessage`. Напрямую вызывать функции другого контекста нельзя.

### ES-модули

Код в `core/`, `services/`, `exporters/`, `ui/`, `background/` и `app.js` написан как нативные ES-модули без сборки: зависимости подключаются через `import`, публичный API — через `export`. Глобальные переменные модули не создают.

Исключения — классические скрипты:
- `content/*.js` — MV3 не загружает content scripts как модули. API расширения они получают выражением `globalThis.browser ?? globalThis.chrome`.
- `sandbox.js` и `sw.js`.
- Сторонние `lib/jszip.min.js` и `lib/html2pdf.min.js`. Они подключаются в `popup.html` обычными `<script>`, модули обращаются к ним через `globalThis.JSZip` и `globalThis.html2pdf`.

Точки входа:
- `popup.html` → `app.js`. Это composition root попапа: импортирует `core/pluginApi.js`, `services/index.js`, `exporters/index.js`, затем вызывает `PluginManager.loadAll()` и создаёт `PopupController`.
- `background/background.html` и `background/service-worker.js` → `background/main.js`.

### Регистрация встроенных сервисов и экспортеров

Классы сервисов и экспортеров сами себя не регистрируют. Это делают два index-модуля:

```js
// services/index.js
serviceRegistry.register(MangaLibService);
serviceRegistry.register(RanobeLibService);

// exporters/index.js
ExporterRegistry.register('fb2', FB2Exporter, { label: 'FB2' });
// … epub, mobi, pdf, simple
```

Порядок вызовов `ExporterRegistry.register` задаёт порядок форматов в селекторе.

### API для плагинов

Плагины остаются классическими скриптами и не могут импортировать модули расширения. Поэтому `core/pluginApi.js` публикует в `globalThis` ровно четыре объекта: `BaseExporter`, `ExporterRegistry`, `BaseService`, `serviceRegistry`. Это единственное место в расширении с намеренными глобалами. `app.js` импортирует его до `PluginManager.loadAll()`.

### Маршрут данных при загрузке

```
PopupController.loadMetadata()
    → AuthManager.apply(serviceKey, tabId, service)
        → runtime.sendMessage({ action: 'getAuthToken' })       [background]
        ↓  если не найден:
        → browserAPI.scripting.executeScript(tabId, …)          [localStorage scan]
    → service.fetchMangaMetadata(slug)     [BaseService → fetchWithRateLimit]
        → runtime.sendMessage({ action: 'fetchWithRateLimit' })  [background]
    → MangaPatcher.patch(rawMeta)          [core]
    → ChapterController.loadAndPopulate(service, slug, …)
        → service.fetchChaptersList(slug)

PopupController.startDownload()
    → DownloadManager.startDownload(options)
        → service.fetchChapter(slug, num, vol, branchId)
        → service.extractText(rawContent)
        → service.processChapterContent(extracted, …)
            → runtime.sendMessage({ action: 'fetchImage', url })   [background]
                ↓ (background → content script)
            → tabs.sendMessage(tabId, { action: 'fetchImageFromTab', url })
                ↓ (ImageFetcher content script)
            → fetch(url) → FileReader → base64
        → ExporterRegistry.create(format).export(manga, chapters, cover)
        → DownloadHistory.add(entry)
        → saveFile(blob, filename)
```

---

## Описание модулей

### `core/BrowserApi.js`

Единственная точка доступа к API браузера. Экспортирует:
- `extensionApi` — `globalThis.browser ?? globalThis.chrome ?? null`. Обёртки над callback-API не нужны: в MV3 методы `chrome.*` сами возвращают промисы.
- `browserEnv` — объект `{ isFirefox, isChromium, supportsDnr, nativeName }` для условной логики. Вычисляется только здесь.
- Сетевые функции через вкладку сервиса: `setServiceTab`, `fetchViaTab`, `requestViaTab`, `hasServiceTab` и класс ошибки `NoServiceTabError`.

Остальные модули импортируют `extensionApi` и `browserEnv` отсюда и не обращаются к `browser`/`chrome` напрямую.

---

### `core/Storage.js`

Безопасная обёртка над `localStorage`. Проверяет доступность при инициализации; все методы (`get`, `set`, `getJSON`, `setJSON`, `remove`) перехватывают исключения и возвращают `null`/`false` вместо выброса.

Экспортирует класс `SafeStorage` (не синглтон; имя не затеняет встроенный `window.Storage`). `DownloadHistory` создаёт свой экземпляр.

---

### `core/DownloadHistory.js`

Хранит до 10 последних успешных загрузок в `localStorage` (через `Storage`). Ключ `manga_parser_download_history`.

Методы: `add(entry)`, `getAll()`, `clear()`. `add()` добавляет запись в начало массива (`unshift`) и обрезает до 10.

Вызывается из `DownloadManager` после успешного сохранения файла.

---

### `core/AuthManager.js`

Управляет JWT-токенами авторизации для API cdnlibs.org.

`getToken(serviceKey, tabId)` — сначала запрашивает кэшированный токен у background через `getAuthToken`. Если не найден и передан `tabId` — извлекает токен из `localStorage`/`sessionStorage` страницы через `scripting.executeScript`.

`apply(serviceKey, tabId, service)` — вызывает `getToken`, при успехе добавляет `Authorization: Bearer <token>` в `service.config.headers`.

Кэш токенов — объект `authTokens`, экспортируемый `background/RequestInterceptor.js`. Его читают и пишут сообщения `getAuthToken` / `cacheAuthToken` через `MessageRouter`.

---

### `core/EventBus.js`

Реализует паттерн Pub/Sub. Класс `EventBus` — не синглтон, каждый потребитель создаёт свой экземпляр.

Методы: `on(event, cb)`, `once(event, cb)`, `off(event, cb)`, `emit(event, data)`, `clear(event?)`.

`on()` возвращает функцию-отписку. `emit()` оборачивает каждый вызов подписчика в `try/catch` — ошибка в одном обработчике не ломает остальные.

Используется в `DownloadManager`: шина создаётся при инстанциировании и передаётся наружу как `downloadManager.eventBus`. `PopupController` подписывается на события `download:started`, `download:progress`, `download:completed`, `download:failed`.

---

### `core/RateLimiter.js`

Ограничивает количество HTTP-запросов к API сервиса. Экспортирует класс `RateLimiter` и общий экземпляр `globalRateLimiter` (85 req/min по умолчанию).

`acquire(name)` / `trackRequest(name)` — возвращает промис, который резолвится только тогда, когда счётчик запросов за последнюю минуту не превышает лимит. Запросы встают в очередь `_pendingQueue`.

`throttle(ms)` — принудительная пауза всех запросов на `ms` миллисекунд. Вызывается при HTTP 429 в `MessageRouter.fetchWithRateLimit`.

`setLimit(n)` / `getStats()` — динамическое изменение лимита и диагностика.

Экземпляр присутствует как в popup, так и в background; background-копия используется для учёта реальных сетевых запросов.

---

### `core/MangaPatcher.js`

Нормализует сырой объект метаданных тайтла из API в единый контракт, который могут использовать все экспортеры и UI без знания о специфике конкретного сервиса.

Реализован как пайплайн независимых статических классов-модулей. `MangaPatcher.patch(obj)` последовательно применяет каждый.

---

### `core/DownloadManager.js`

Оркестрирует полный жизненный цикл загрузки.

**`startDownload(options)`** — принимает `{ url?, serviceKey?, slug, format, controller, chapterRange, branchId, maxSizeMB }` и запускает flow:

1. Применяет auth-токен через `AuthManager.apply()`.
2. Загружает метаданные → `MangaPatcher.patch()`.
3. Загружает обложку как base64.
4. Загружает список глав через `ChapterController`, применяет фильтры `branchId` и `chapterRange`.
5. `downloadWithSizeLimit()` — итерирует главы, разбивая на части при превышении `maxSizeMB`.

**`downloadSingleChapter()`** — вызывает `service.fetchChapter()` → `service.extractText()` → `service.processChapterContent()`.

**`createController()`** — фабрика объекта `{ pause(), resume(), stop(), isPaused(), shouldStop(), waitIfPaused() }`. `waitIfPaused()` — асинхронный spin-lock, вызывается перед каждой главой.

**Фоновая загрузка медленного контента.** Ни изображение, ни глава не задерживают загрузку дольше `deferredLoadSettings.deferAfterMs` (30 с). Пока загрузка на паузе или запросы стоят в очереди rate limiter'а (в т.ч. после 429), срок не идёт.
- *Изображения.* Сервис загружает каждое изображение через `loadImageOrDefer(label, load)`. Срок считается на всю загрузку изображения (перебор расширений, сжатие). Если он истёк, в главу кладётся метка `[Изображение N загружается в фоне]`, а сама загрузка продолжается в фоне.
- *Главы.* `_loadChapterOrDefer()` так же откладывает главу целиком и ставит на её место в пакете главу-метку. Одновременно в фоне грузится не больше `maxDeferredChapters` глав, дальше глава ждётся как обычно.
- *Очередь.* `DeferredQueue` (`downloadState.deferred`) вставляет результат на место метки, как только фоновая загрузка завершится. Неудачная попытка повторяется через `retryDelayMs`. Попытка, висящая дольше `backgroundAttemptTimeoutMs`, дублируется новой; засчитывается первый успех. После `maxAttempts` на месте метки остаётся `[Ошибка загрузки изображения N]` / `[Ошибка загрузки главы: …]`.
- *Размер.* Метки учитываются в `estimateChapterSize()` по среднему размеру уже загруженных изображений/глав.
- *Сохранение.* Сохранение тома (`_createBatchSaver`) ждёт фоновые загрузки своих глав, не задерживая загрузку следующих; файлы сохраняются по порядку. Обложка тоже грузится в фоне и нужна только при сохранении.
- *Остановка.* Фоновые загрузки отменяются, на местах меток остаётся текст ошибки, уже загруженное сохраняется.

---

### `services/ServiceRegistry.js`

Реестр сервисов. Экспортирует класс `ServiceRegistry` и общий экземпляр `serviceRegistry`. Сам ничего не подключает: встроенные сервисы регистрирует `services/index.js`, сервисы плагинов — `PluginManager`.

Методы:
- `register(ServiceClass)` — создаёт экземпляр, сохраняет `{ class, instance, matcher }`.
- `getServiceByUrl(url)` — перебирает сервисы, возвращает экземпляр первого, чей `matches(url)` вернул `true`.
- `getService(name)` — возвращает существующий экземпляр по имени.
- `createService(name)` — создаёт **новый** экземпляр (используется в `DownloadManager` для каждой загрузки).

---

### `services/BaseService.js`

Базовый класс. Принимает объект `config` в конструктор.

Реализует API-запросы к cdnlibs.org через `runtime.sendMessage({ action: 'fetchWithRateLimit' })` — все fetch-запросы идут через background, где применяются нужные заголовки и учитывается rate limit.

- `fetchMangaMetadata(slug)` — `GET /api/manga/{slug}?fields[]=...`
- `fetchChaptersList(slug)` — `GET /api/manga/{slug}/chapters`
- `fetchChapter(slug, number, volume, branchId)` — `GET /api/manga/{slug}/chapter?number=...`

Абстрактный метод `static matches(url)` — обязателен в подклассе.

---

### `services/*/config.js`

Экспортируемый объект конфигурации сервиса (`mangalibConfig`, `ranolibConfig`). Содержит: `name`, `baseUrl`, `imagesDomain`, `siteId`, `fields[]`, `headers`, `imageHeaders`, опциональные `splitLongImages` и `maxImageHeight`. Класс сервиса импортирует его и передаёт в `super(config)`.

---

### `exporters/ExporterRegistry.js`

Реестр экспортеров со статическим приватным полем `#registry`. Сам ничего не подключает: встроенные экспортеры регистрирует `exporters/index.js`, форматы плагинов — сами плагины или `PluginManager`.

Методы:
- `register(format, Class, meta)` — регистрация по строковому ключу формата.
- `create(format)` — фабрика, бросает `Error` при неизвестном формате.
- `getFormats()` — список `[{ value, label }]` для построения `<select>` в UI.
- `_reset()` — полный сброс реестра (используется в тестах).

---

### `exporters/BaseExporter.js`

Базовый класс. Предоставляет утилиты: `escapeXml()`, `escapeHtml()`, `stripHtml()`, `sanitizeText()`, `extractText()`.

Обязательный метод для переопределения: `async export(manga, chapters, coverBase64)` — должен вернуть `{ blob, filename, mimeType }`.

**Контракт аргументов `export()`:**
- `manga` — нормализованный объект из `MangaPatcher`: `{ name, authors[], summary, cover, genres[], tags[], releaseDate, ageRating, rating }`.
- `chapters` — `[{ title, content: Block[], volume, number }]`, где `Block` — `{ type: 'text', text: string }` или `{ type: 'image', id: string, data: { base64: string, contentType: string } }`.
- `coverBase64` — data-URL строка или пустая строка.

---

### `content/AdCleaner.js`

Content script. Удаляет рекламные DOM-элементы на страницах MangaLib/RanobeLib: слайдеры, рекламные попапы (по CSS-классам и маркерам), восстанавливает прокрутку страницы после закрытия попапов. Отслеживает динамически добавляемые узлы через `MutationObserver`. Не участвует в логике загрузки.

---

### `content/DownloadButton.js`

Content script. Инжектирует кнопку «Скачать» рядом с кнопкой «Читать» на странице тайтла. При клике отправляет `{ action: 'openDownloadWindow', format }` в background. Читает последний выбранный формат из `storage.local` и обновляет подпись кнопки при его изменении через `storage.onChanged`. Отслеживает динамическое появление кнопок через `MutationObserver`.

---

### `content/ImageFetcher.js`

Content script. Слушает сообщение `{ action: 'fetchImageFromTab', url }` от background. Делает `fetch(url)` в контексте вкладки (с cookies и заголовками сайта), конвертирует в base64 через `FileReader` и возвращает `{ ok, base64, contentType }`. Это позволяет background получать изображения, не имея собственного доступа к CDN с авторизованными cookies.

---

### `background/RequestInterceptor.js`

Перехватчик сетевых запросов. Загружается в background-контекст до `MessageRouter`.

**Firefox** (`webRequest.onBeforeSendHeaders` в режиме `blocking`): подменяет заголовки запросов от расширения на нужные из конфига сервиса, захватывает JWT-токены из запросов страницы (`captureAuthToken`), добавляет `Access-Control-Allow-Origin` к ответам изображений (`onHeadersReceived`).

**Chrome**: только rate-limiting и перехват токенов без изменения заголовков (управляются через `rules.json` и `declarativeNetRequest`).

В обоих браузерах блокирует запросы к рекламным URL через `webRequest.onBeforeRequest`.

Экспортирует `detectServiceByUrl` — функцию определения сервиса по URL — и хранилище токенов `authTokens`. Оба импортирует `MessageRouter`.

---

### `background/MessageRouter.js`

Маршрутизатор сообщений. Слушает `runtime.onMessage` и делегирует обработку зарегистрированным хендлерам.

Хендлеры (`Map<action, handler>`):
- `getAuthToken` / `cacheAuthToken` — чтение и запись токенов в `authTokens` из `RequestInterceptor`.
- `setRateLimit` / `getRateLimiterStats` — управление rate limiter background-процесса.
- `fetchImage` — находит открытую вкладку нужного сервиса, отправляет ей `fetchImageFromTab`, прокидывает ответ обратно в popup.
- `fetchWithRateLimit` — делает fetch с rate limiting и retry при 429, возвращает тело и заголовки.
- `openDownloadWindow` / `openWindowWithUrl` — открывает popup.html с нужными параметрами в новом окне или вкладке.

---

### `ui/TemplateLoader.js`

Загружает HTML-фрагменты из папки `templates/` в якорный элемент (`#view`). Методы: `init(anchorId)`, `async show(templateName, onReady?)`, `current()`. Один шаблон активен в один момент времени.

Шаблоны: `templates/title.html` (основная форма загрузки), `templates/history.html` (история), `templates/wrong-service.html`, `templates/no-title.html`.

---

### `ui/ChapterController.js`

Управляет выбором диапазона глав и переводчика.

`loadAndPopulate(service, slug, chapterFromUrl, chapterToUrl, branchIdUrl)` — загружает список глав через `service.fetchChaptersList()`, заполняет `<select>` элементы и при наличии нескольких переводов показывает `translatorSelect`.

`getFilteredChapters(branchId)` — возвращает главы, принадлежащие нужной ветке перевода.

`repopulateSelects(chapters, fromSelect, toSelect)` — пересобирает `<option>` в обоих селектах при смене переводчика.

---

### `ui/HistoryController.js`

Управляет видом истории загрузок (шаблон `history.html`).

`init(onBack)` — рендерит список через `DownloadHistory.getAll()` и вешает обработчики кнопок «Назад» и «Очистить». Кнопка «Назад» вызывает колбэк `onBack`: `PopupController` передаёт в него `_restoreMainView`. Так же устроен `SettingsController.init(onBack)`. Карточки содержат цветовую метку сервиса, формат, дату, диапазон глав и переводчика. При наличии `extensionApi.tabs` заголовок карточки становится кликабельной ссылкой на тайтл.

---

### `ui/PopupController.js`

Управляет всем DOM popup-страницы. Создаётся один раз из `app.js`.

**Инициализация (`_init`):**
1. Инициализирует `TemplateLoader` на элементе `#view`.
2. Привязывает события оболочки (`_bindShellEvents`): кнопка истории `#historyBtn`.
3. Загружает шаблон `title`, привязывает события формы (`_bindTitleEvents`), настраивает слушатели.
4. Вызывает `loadMetadata()` и `checkApiHealth()`.

**`loadMetadata()`** — определяет активную вкладку, парсит slug из URL, применяет auth-токен, загружает метаданные тайтла, заполняет UI обложкой/описанием, передаёт управление главами в `ChapterController`. Читает URL-параметр `download=true` для автозапуска.

**`openInNewContext(url)`** — открывает popup.html в новом окне/вкладке через `openWindowWithUrl` сообщение в background. Используется кнопкой «Скачать» (открывает новое окно с `download=true`).

**Шаблонные состояния:** `_showWrongServiceState` (не та страница), `_showNoTitleState` (нет тайтла), `_setReadyState` (готов к загрузке), `_setDownloadingUIState` / `resetUI` (во время/после загрузки).

**`checkApiHealth()`** — проверяет кэшированный статус API в `localStorage`. При наличии флага `isFailing` показывает предупреждение `_showApiWarning`.

---

## Как добавить новый экспортер

1. Создать модуль `exporters/XyzExporter.js`:

```js
import { BaseExporter } from './BaseExporter.js';

export class XyzExporter extends BaseExporter {
    async export(manga, chapters, coverBase64) {
        // manga.name, manga.authors[], manga.summary — всегда строки/массивы строк
        // chapters[i].content[j] — { type: 'text', text } или { type: 'image', data: { base64, contentType } }
        const blob = new Blob([...], { type: 'application/xyz' });
        return { blob, filename: `${manga.name}.xyz`, mimeType: 'application/xyz' };
    }
}
```

2. Импортировать его в `exporters/index.js` и зарегистрировать:

```js
import { XyzExporter } from './XyzExporter.js';
ExporterRegistry.register('xyz', XyzExporter, { label: 'XYZ' });
```

3. `PopupController` автоматически добавит новый вариант в `<select>` форматов через `ExporterRegistry.getFormats()`.

---

## Как добавить новый сервис

1. Создать модуль `services/newsite/config.js`:

```js
export const newsiteConfig = {
    name: 'newsite',
    baseUrl: 'https://api.newsite.example',
    imagesDomain: 'https://img.newsite.example',
    siteId: '42',
    fields: ['authors', 'summary', 'genres', 'tags'],
    headers: {
        'User-Agent': '...',
        'Site-Id': '42',
        'X-DL-Service': 'newsite',
        'Referer': 'https://newsite.example/'
    },
    imageHeaders: { 'Referer': 'https://newsite.example/' }
};
```

2. Создать модуль `services/newsite/NewSiteService.js`:

```js
import { fetchPageImage, loadImageOrDefer } from '../../core/DownloadManager.js';
import { BaseService } from '../BaseService.js';
import { newsiteConfig } from './config.js';

export class NewSiteService extends BaseService {
    constructor() { super(newsiteConfig); }

    static matches(url) {
        try { return /newsite\.example$/i.test(new URL(url).hostname); }
        catch { return false; }
    }

    extractText(content) {
        // Разобрать content (формат зависит от API сервиса)
        return [];
    }

    async processChapterContent(extracted, _statusEl, opts) {
        const result = [];
        for (const [index, block] of extracted.entries()) {
            if (block.type !== 'image') {
                result.push(block);
                continue;
            }
            const blocks = await loadImageOrDefer(index + 1, async () => {
                const resp = await fetchPageImage(block.src, this.name);
                return resp?.ok
                    ? [{ type: 'image', id: `img_${Date.now()}`, data: { base64: resp.base64, contentType: resp.contentType } }]
                    : null;
            });
            if (blocks) result.push(...blocks);
        }
        return result;
    }
}
```

3. Импортировать класс в `services/index.js` и вызвать `serviceRegistry.register(NewSiteService)`.

4. В `manifest.json`: добавить домен в `host_permissions` и `content_scripts.matches`.

5. В `background/RequestInterceptor.js`:
   - Добавить домен в `FIREFOX_WEBREQUEST_URLS`.
   - Добавить обнаружение в `detectServiceByUrl()` и `detectServiceByReferer()`.
   - Добавить конфиг в `ServiceConfigs`:
     ```js
     if (typeof newsiteConfig !== 'undefined')
         ServiceConfigs.newsite = newsiteConfig;
     ```

6. В `background/MessageRouter.js`: обновить массив `patterns` в хендлере `fetchImage` для новых URL-паттернов поиска вкладки.
