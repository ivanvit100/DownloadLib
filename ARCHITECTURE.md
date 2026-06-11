# Архитектура DownloadLib

## Дерево модулей

![Дерево модулей](/screenshots/schema.svg)

---

## Связи между модулями

### Контексты исполнения

Код расширения работает в двух изолированных контекстах:

**Popup-контекст** (`popup.html`) — открывается браузером при клике на иконку расширения. Имеет доступ к DOM, может делать fetch, но не может напрямую перехватывать сетевые запросы.

**Background-контекст** (`background/background.html` для Firefox, `service-worker.js` для Chrome MV3) — живёт в фоне, перехватывает HTTP-запросы через `webRequest`, принимает сообщения от popup через `runtime.onMessage`.

Общение между контекстами — исключительно через `runtime.sendMessage` / `runtime.onMessage`. Напрямую вызывать функции другого контекста нельзя.

**Content script** (`background/RemoveAds.js`) — третий изолированный контекст, исполняется на страницах сайта. Не участвует в логике загрузки.

### Паттерн самостоятельной регистрации

Каждый сервис и каждый экспортер после объявления класса **сам** регистрируется в своём реестре:

```js
// В конце MangaLibService.js:
if (global.serviceRegistry) global.serviceRegistry.register(MangaLibService);

// В конце FB2Exporter.js:
if (global.ExporterRegistry) global.ExporterRegistry.register('fb2', FB2Exporter, { label: 'FB2' });
```

Реестры к этому моменту уже созданы (они загружены раньше). Добавление нового сервиса или экспортера не требует правок в реестре — только добавление файла в массив скриптов реестра.

### Паттерн IIFE

Каждый файл обёрнут в:

```js
(function(global) {
    // ...
    global.MyClass = MyClass;
})(typeof window !== 'undefined' ? window : self);
```

Это позволяет одному и тому же коду работать в `window`-контексте (popup) и `self`-контексте (Service Worker), не загрязняя глобальное пространство имён посторонними переменными.

### Маршрут данных при загрузке

```
PopupController.loadMetadata()
    → service.fetchMangaMetadata(slug)      [BaseService]
    → MangaPatcher.patch(rawMeta)           [Core]
    → service.fetchChaptersList(slug)       [BaseService]

PopupController.startDownload()
    → DownloadManager.startDownload(options)
        → service.fetchChapter(slug, num, vol)    [BaseService]
        → service.extractText(rawContent)         [конкретный сервис]
        → service.processChapterContent(...)      [конкретный сервис]
            → runtime.sendMessage({ action: 'fetchImage', url })
                ↓ (background)
            → Background.js → fetch(url) → base64
        → ExporterRegistry.create(format).export(manga, chapters, cover)
        → saveFile(blob, filename)
```

---

## Описание модулей

### `core/BrowserApi.js`

Выставляет три глобала: `window.extensionApi`, `window.browserEnv`, `window.getExtensionApi`, `window.getBrowserEnv`.

`extensionApi` — унифицированный объект с Promise-based методами: `runtime.sendMessage`, `tabs.query`, `windows.getCurrent/create/update`, `downloads.download`, `storage.local.get/set`. Firefox нативно возвращает промисы, для Chrome callback-API оборачивается вручную через `toPromise()`.

`browserEnv` — объект `{ isFirefox, isChromium, supportsDnr }` для условной логики в Background.

Все остальные модули читают API через `getExtensionApi()`, никогда не обращаясь к `browser`/`chrome` напрямую.

---

### `core/EventBus.js`

Реализует паттерн Pub/Sub. Класс `EventBus` — не синглтон, каждый потребитель создаёт свой экземпляр.

Методы: `on(event, cb)`, `once(event, cb)`, `off(event, cb)`, `emit(event, data)`, `clear(event?)`.

`on()` возвращает функцию-отписку. `emit()` оборачивает каждый вызов подписчика в `try/catch` — ошибка в одном обработчике не ломает остальные.

Используется в `DownloadManager`: шина создаётся при инстанциировании и передаётся наружу как `downloadManager.eventBus`. `PopupController` подписывается на события прогресса и завершения через эту шину.

---

### `core/RateLimiter.js`

Ограничивает количество HTTP-запросов к API сервиса. Сразу при загрузке файла создаётся синглтон `window.globalRateLimiter` (85 req/min по умолчанию).

Метод `acquire(name)` / `trackRequest(name)` — возвращает промис, который резолвится только тогда, когда счётчик запросов за последнюю минуту не превышает лимит. Запросы встают в очередь `_pendingQueue` и обрабатываются по одному через `_processQueue()`.

Метод `throttle(ms)` — принудительная пауза всех запросов на `ms` миллисекунд. Вызывается при получении HTTP 429 в `BaseService.fetchWithRateLimitRetry()` и в `Background.js`.

Метод `recordRequest(name)` — зарегистрировать запрос без ожидания (используется Background для учёта перехваченных браузером запросов).

---

### `core/MangaPatcher.js`

Нормализует сырой объект метаданных тайтла из API в единый контракт, который могут использовать все экспортеры и UI без знания о специфике конкретного сервиса.

Реализован как пайплайн независимых статических классов-модулей. `MangaPatcher.patch(obj)` последовательно применяет каждый.

---

### `core/DownloadManager.js`

Оркестрирует полный жизненный цикл загрузки. Хранит активные загрузки в `Map<downloadId, downloadState>`.

**`startDownload(options)`** — основной метод. Принимает `{ url?, serviceKey?, slug, format, controller, loadedFile, chapterRange, branchId, maxSizeMB }`. Если передан `loadedFile` — делегирует в `updateExistingFile()`, иначе запускает стандартный flow:

1. Получает сервис из `serviceRegistry`.
2. Загружает метаданные → `MangaPatcher.patch()`.
3. Загружает обложку как base64 через обычный `fetch` с `imageHeaders`.
4. Загружает список глав, применяет фильтры `branchId` и `chapterRange`.
5. `downloadWithSizeLimit()` — итерирует главы, разбивая на файловые части при превышении `maxSizeMB`.

**`downloadWithSizeLimit()`** — для каждой главы вызывает `downloadSingleChapter()`, накапливает батч и, как только оценочный размер превышает лимит, вызывает `exporter.export()` и `saveFile()` для текущего батча.

**`downloadSingleChapter()`** — вызывает `service.fetchChapter()` → `service.extractText()` → `service.processChapterContent()`. Возвращает `{ title, content, volume, number }`.

**`updateExistingFile()`** — режим обновления: загружает серверный список глав, парсит существующий файл через `exporter.parse()`, находит отсутствующие главы через `findMissingChapters()`, докачивает их и сохраняет объединённый файл.

**`createController()`** — фабрика объекта управления `{ pause(), resume(), stop(), isPaused(), shouldStop(), waitIfPaused() }`. `waitIfPaused()` — асинхронный spin-lock, вызывается перед каждой главой.

---

### `services/ServiceRegistry.js`

Реестр сервисов. Создаёт синглтон `window.serviceRegistry`. При своей загрузке через `document.write` (или `importScripts`) подключает все конфиги и классы сервисов.

Методы:
- `register(ServiceClass)` — создаёт экземпляр, сохраняет `{ class, instance, matcher }`.
- `getServiceByUrl(url)` — перебирает сервисы, возвращает экземпляр первого, чей `matches(url)` вернул `true`.
- `getService(name)` — возвращает существующий экземпляр по имени.
- `createService(name)` — создаёт **новый** экземпляр (используется в `DownloadManager` и `BackgroundDownload` для каждой загрузки).

---

### `services/BaseService.js`

Базовый класс для всех сервисов. Принимает объект `config` в конструктор, читает из него `name`, `baseUrl`, `headers`, `fields`.

Реализует стандартные API-запросы к cdnlibs.org:
- `fetchMangaMetadata(slug)` — `GET /api/manga/{slug}?fields[]=...`
- `fetchChaptersList(slug)` — `GET /api/manga/{slug}/chapters`
- `fetchChapter(slug, number, volume, branchId)` — `GET /api/manga/{slug}/chapter?number=...`

`fetchWithRateLimitRetry(url, opts, maxRetries)` — fetch с автоматическим retry при 429: читает `Retry-After`, вызывает `globalRateLimiter.throttle(ms)` и `this._on429(ms)` (коллбэк устанавливается из `DownloadManager` для обновления статуса в UI).

Геттер `extensionApi` — вызывает `getExtensionApi()` при каждом обращении, что корректно работает и в popup, и в background.

Абстрактный метод `static matches(url)` — обязателен в подклассе.

---

### `services/*/config.js`

Простой файл с объектом конфигурации сервиса, выставляемым в `global`. Содержит: `name`, `baseUrl`, `imagesDomain`, `siteId`, `fields[]`, `headers`, `imageHeaders`, опциональные `splitLongImages` и `maxImageHeight`. Загружается до класса сервиса, поэтому конструктор просто читает `global.xyzConfig`.

---

### `exporters/ExporterRegistry.js`

Реестр экспортеров со статическим приватным полем `#registry`. Аналогично `ServiceRegistry`, при загрузке подключает все файлы экспортеров через `document.write` / `importScripts`.

Методы:
- `register(format, Class, meta)` — регистрация по строковому ключу формата.
- `create(format)` — фабрика, бросает `Error` при неизвестном формате.
- `getFormats()` — список `[{ value, label }]` для построения `<select>` в UI.
- `_reset()` — полный сброс реестра (используется в тестах).

---

### `exporters/BaseExporter.js`

Базовый класс. Предоставляет утилиты: `escapeXml()`, `escapeHtml()`, `stripHtml()`, `sanitizeText()`, `extractText()`.

Обязательный метод для переопределения: `async export(manga, chapters, coverBase64)` — должен вернуть `{ blob, filename, mimeType }`.

Опциональный метод: `parse(file)` — разобрать файл в `{ metadata, cover, chapters }` для режима обновления.

**Контракт аргументов `export()`:**
- `manga` — нормализованный объект из `MangaPatcher`: `{ name, authors[], summary, cover, genres[], tags[], releaseDate, ageRating, rating }`.
- `chapters` — `[{ title, content: Block[], volume, number }]`, где `Block` — `{ type: 'text', text: string }` или `{ type: 'image', id: string, data: { base64: string, contentType: string } }`.
- `coverBase64` — data-URL строка или пустая строка.

**Контракт возвращаемого значения `parse()`:** `{ metadata: { name, authors[], summary, genres[], tags[], releaseDate, rating }, cover: string, chapters: [{ title, content: Block[], volume, number }] }`.

---

### `ui/PopupController.js`

Управляет всем DOM popup-страницы. Создаётся один раз из `app.js`.

**Инициализация в конструкторе:**
1. `new DownloadManager()`.
2. `setupUI()` — программно строит DOM, отсутствующий в HTML: `<select>` форматов (данные из `ExporterRegistry.getFormats()`), поля rate-limit и max-size, кнопки "Пауза"/"Фоном"/"Завершить", загрузчик файла для обновления, селекторы диапазона глав и переводчика.
3. `setupEventListeners()` — обработчики кнопок.
4. `subscribeToEvents()` — подписка на `downloadManager.eventBus`.
5. `loadMetadata()` — определяет активный таб, распознаёт slug из URL, загружает метаданные тайтла, наполняет UI обложкой/описанием/списком глав.

**Логика кнопки "Скачать":** если popup открыт как overlay (не в отдельном окне) — открывает `popup.html?download=true&slug=...&service=...&format=...` в новом окне через `windows.create()`. Новое окно при инициализации читает параметры из `URLSearchParams` и сразу вызывает `startDownload()`.

**Логика кнопки "Фоном":** сериализует `downloadState` из `DownloadManager.getDownloadState()`, останавливает локальную загрузку, отправляет `{ action: 'takeOverDownload', ...state }` в background.

**Опрос фоновых загрузок:** `setInterval` каждые 2 секунды отправляет `{ action: 'getActiveDownloads' }` и отображает счётчик.

---

### `background/Background.js`

Ядро background-контекста. Запускается последним после всех зависимостей.

**Перехват запросов (Firefox):** `webRequest.onBeforeSendHeaders` в режиме `blocking` — определяет сервис через `detectServiceByReferer()` (по заголовкам `X-DL-Service`, `Site-Id`, `Referer`), подменяет заголовки на нужные из `ServiceConfigs[serviceName]`, вызывает `rateLimiter.trackRequest()`. `webRequest.onHeadersReceived` — добавляет `Access-Control-Allow-Origin: *` к ответам с изображениями.

**Перехват запросов (Chrome):** только rate-limiting через `webRequest.onBeforeSendHeaders` без `blocking` (заголовки управляются через `rules.json` и `declarativeNetRequest`).

---

### `background/BackgroundDownload.js`

Продолжает загрузку после передачи из popup. Хранит активные фоновые загрузки в `Map`.

`takeOverDownload(options)` — принимает сериализованный `downloadState` (slug, serviceKey, format, уже скачанные главы, индекс текущей), создаёт `controller`, запускает `continueDownload()` асинхронно и немедленно возвращает `{ downloadId }`.

`continueDownload(download)` — итерирует главы начиная с `currentChapterIndex`, для каждой: `service.fetchChapter()` → `extractText()` → `processChapterContent()`. По завершении: `ExporterRegistry.create(format).export()` → `extensionApi.downloads.download()` (сохраняет файл в папку загрузок без диалога).

Реализует `pause()`, `resume()`, `stop()` через тот же `controller`-паттерн, что и `DownloadManager`.

---

### `background/RemoveAds.js`

Content script. Удаляет рекламные DOM-элементы на страницах MangaLib/RanobeLib. Не связан с логикой загрузки.

---

## Как добавить новый экспортер

1. Создать `exporters/XyzExporter.js` по шаблону:

```js
'use strict';
(function(global) {
    class XyzExporter extends global.BaseExporter {
        async export(manga, chapters, coverBase64) {
            // manga.name, manga.authors[], manga.summary — всегда строки/массивы строк
            // chapters[i].content[j] — { type: 'text', text } или { type: 'image', data: { base64, contentType } }
            const blob = new Blob([...], { type: 'application/xyz' });
            return { blob, filename: `${manga.name}.xyz`, mimeType: 'application/xyz' };
        }

        // Опционально — для поддержки режима обновления файла
        async parse(file) {
            return {
                metadata: { name: '', authors: [], summary: '', genres: [], tags: [], releaseDate: '', rating: '' },
                cover: '',
                chapters: [] // [{ title, content: Block[], volume, number }]
            };
        }
    }

    global.XyzExporter = XyzExporter;
    if (global.ExporterRegistry)
        global.ExporterRegistry.register('xyz', XyzExporter, { label: 'XYZ' });
})(typeof window !== 'undefined' ? window : self);
```

2. Добавить путь `/exporters/XyzExporter.js` в массив `EXPORTER_SCRIPTS` в `exporters/ExporterRegistry.js`.

3. `PopupController` автоматически добавит новый вариант в `<select>` форматов через `ExporterRegistry.getFormats()`.

---

## Как добавить новый сервис

1. Создать `services/newsite/config.js`:

```js
'use strict';
(function(global) {
    global.newsiteConfig = {
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
})(typeof window !== 'undefined' ? window : self);
```

2. Создать `services/newsite/NewSiteService.js`:

```js
'use strict';
(function(global) {
    class NewSiteService extends global.BaseService {
        constructor() { super(global.newsiteConfig); }

        static matches(url) {
            try { return /newsite\.example$/i.test(new URL(url).hostname); }
            catch { return false; }
        }

        extractText(content) {
            // Разобрать content (формат зависит от API сервиса)
            // Вернуть [{ type: 'text', text }, { type: 'image', src }]
            return [];
        }

        async processChapterContent(extracted, _statusEl, opts) {
            const result = [];
            for (const block of extracted) {
                if (block.type === 'image') {
                    const resp = await new Promise((res, rej) =>
                        this.extensionApi.runtime.sendMessage({ action: 'fetchImage', url: block.src })
                            .then(res).catch(rej)
                    );
                    if (resp?.ok)
                        result.push({ type: 'image', id: `img_${Date.now()}`, data: { base64: resp.base64, contentType: resp.contentType } });
                } else result.push(block);
            }
            return result;
        }
    }

    global.NewSiteService = NewSiteService;
    if (global.serviceRegistry) global.serviceRegistry.register(NewSiteService);
})(typeof window !== 'undefined' ? window : self);
```

3. Добавить оба пути в массив `SERVICE_SCRIPTS` в `services/ServiceRegistry.js` (конфиг — перед классом).

4. В `manifest.json`: добавить домен в `host_permissions`.

5. В `background/Background.js`: добавить домен в `FIREFOX_WEBREQUEST_URLS`, в `detectServiceByUrl()` и в `detectServiceByReferer()`. Добавить конфиг в `ServiceConfigs`:

```js
if (typeof newsiteConfig !== 'undefined')
    ServiceConfigs.newsite = newsiteConfig;
```
