# Архитектура DownloadLib

## Дерево модулей

![Дерево модулей](/screenshots/schema.svg)

---

## Связи между модулями

### Контексты исполнения

Код расширения работает в трёх изолированных контекстах:

**Popup-контекст** (`popup.html`) — открывается браузером при клике на иконку расширения или в отдельном окне при запуске загрузки. Имеет доступ к DOM, может делать fetch, но не может напрямую перехватывать сетевые запросы.

**Background-контекст** — для Firefox: `background/background.html`, для Chrome MV3: модульный service worker `background/service-worker.js`. Оба загружают один модуль `background/main.js`, который импортирует `RequestInterceptor` и `MessageRouter`. Фон тонкий: в нём живут общий ограничитель частоты запросов, хранилище токенов, захват токенов из запросов страниц сервиса, правила блокировки рекламы и маршрутизация сообщений. Экспортёры, JSZip, MangaPatcher и классы сервисов фон не загружает (это проверяет `tests/modules.test.js`).

**Content scripts** (`content/`) — два скрипта, исполняемых на страницах сайтов: `AdCleaner.js` и `DownloadButton.js`. В логике загрузки не участвуют.

Общение между контекстами — исключительно через `runtime.sendMessage` / `runtime.onMessage`. Напрямую вызывать функции другого контекста нельзя.

### Владельцы задач

У каждой общей задачи один владелец, остальные обращаются к нему:

| Задача | Владелец |
|---|---|
| Ограничение частоты запросов к сервису для всех окон | фон, `background/rateLimitService.js`; окна обращаются через `core/RateLimitClient.js` |
| Токены авторизации | фон, `background/tokenStore.js` (`storage.session`) |
| Сетевой запрос в контексте вкладки сервиса | `core/BrowserApi.js` (`fetchViaTab`, `requestViaTab`) |
| Движок загрузки, экспорт, сохранение | окно загрузки (`DownloadManager`) |

### Сообщения

Имена действий — константы `MSG` из `core/messages.js`, имя порта keep-alive — `PORT_KEEP_ALIVE`. Content scripts не импортируют модули, поэтому `DownloadButton.js` пишет строку `'openDownloadWindow'`. Её совпадение с `MSG.OPEN_DOWNLOAD_WINDOW` проверяет тест.

| Действие | Отправитель | Что делает фон |
|---|---|---|
| `getAuthToken`, `cacheAuthToken`, `authInvalidate` | страницы расширения (`AuthManager`) | читает, сохраняет, удаляет токен сервиса в `tokenStore` |
| `rateAcquire` `{serviceKey}` | страницы расширения (`RateLimitClient`) | отвечает `{ok: true}`, когда общий ограничитель разрешит запрос |
| `rateThrottle` `{ms}` | страницы расширения (`RateLimitClient`) | блокирует запросы всех окон, отвечает `{ok: true, blockedUntil}` |
| `openWindowWithUrl` `{url}` | страницы расширения | открывает окно расширения |
| `plugin:cache`, `plugin:exec` | страницы расширения (`PluginManager`) | кэширует код плагина, выполняет его во вкладке |
| `openDownloadWindow` `{format}` | `DownloadButton.js` на сайте сервиса или сервисного плагина | открывает окно загрузки тайтла этой вкладки |

**Проверка отправителя.** У каждого обработчика задано, кто может его вызвать. Сообщение принимается, только если `sender.id` совпадает с id расширения и:
- для страниц расширения — `sender.url` находится в origin расширения;
- для вкладок сервиса — `sender.tab.url` на сайте встроенного сервиса или включённого сервисного плагина.

Иначе фон отвечает `{ok: false, error: 'forbidden'}`. Ошибка обработчика превращается в ответ `{ok: false, error}`.

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

Плагины остаются классическими скриптами и не могут импортировать модули расширения. Поэтому `core/pluginApi.js` публикует их API в `globalThis`. Это единственное место в расширении с намеренными глобалами. `app.js` импортирует его до `PluginManager.loadAll()`.

- **Поддерживаемый API:** `BaseExporter`, `ExporterRegistry`, `BaseService`, `serviceRegistry`, а также `JSZip` и `html2pdf`. Последние два `popup.html` подключает обычными скриптами.
- **Устаревшие, но поддерживаемые глобалы:** то, что было доступно плагинам до версии 1.1. Они не удаляются:
  - классы и объекты: `ImageCompressor`, `MangaPatcher`, `EventBus`, `RateLimiter`, `globalRateLimiter`, `ServiceRegistry`. `globalRateLimiter` — обёртка над `RateLimitClient`: `acquire`/`trackRequest` ждут разрешения общего ограничителя фона, `throttle` блокирует запросы всех окон, `setLimit` сохраняет лимит в настройки;
  - встроенные экспортеры и сервисы, их конфиги `mangalibConfig`, `ranolibConfig`;
  - функции: `fetchPageImage`, `loadImageOrDefer`, `NoServiceTabError`, `getExtensionApi`/`getBrowserEnv`/`extensionApi`/`browserEnv`, `fetchViaTab`/`requestViaTab`/`hasServiceTab`/`setServiceTab`. Они опубликованы обёртками: при изменениях внутри расширения правятся обёртки, а имена и формы результатов остаются прежними.

Контракт плагинов (метаданные `@dl-*`, поля `@dl-service-config`, данные `export()`, публичные методы базовых классов, API песочницы, глобалы) проверяют тесты `tests/plugins/` на настоящих файлах из `plugins/`.

### Маршрут данных при загрузке

```
PopupController.loadMetadata()
    → AuthManager.apply(serviceKey, tabId, service)
        → runtime.sendMessage({ action: MSG.GET_AUTH_TOKEN })     [фон: tokenStore]
        ↓  если не найден:
        → scripting.executeScript(tabId, findTokenInPageStorage)  [localStorage/sessionStorage вкладки]
        → runtime.sendMessage({ action: MSG.CACHE_AUTH_TOKEN })   [фон: tokenStore]
    → service.fetchMangaMetadata(slug)     [BaseService → requestViaTab]
        → scripting.executeScript(tabId, fetch)                   [вкладка сервиса]
    → MangaPatcher.patch(rawMeta)          [core]
    → ChapterController.loadAndPopulate(service, slug, …)
        → service.fetchChaptersList(slug)

PopupController.startDownload()
    → DownloadManager.startDownload(options)
        → service.fetchChapter(slug, num, vol, branchId)
        → service.extractText(rawContent)
        → service.processChapterContent(extracted, …)
            → fetchPageImage(url, serviceKey)
                → RateLimitClient.acquire(serviceKey)
                    → runtime.sendMessage({ action: MSG.RATE_ACQUIRE })  [фон: rateLimitService]
                → fetchViaTab(url, serviceKey)                    [вкладка сервиса: fetch → base64]
        → ExporterRegistry.create(format).export(manga, chapters, cover)
        → DownloadHistory.add(entry)
        → saveFile(blob, filename)

Ответ HTTP 429 (BaseService.fetchWithRateLimitRetry)
    → RateLimitClient.throttle(ms)
        → runtime.sendMessage({ action: MSG.RATE_THROTTLE, ms })  [фон: блокировка для всех окон]
```

---

## Описание модулей

### `core/BrowserApi.js`

Единственная точка доступа к API браузера. Экспортирует:
- `extensionApi` — `globalThis.browser ?? globalThis.chrome ?? null`. Обёртки над callback-API не нужны: в MV3 методы `chrome.*` сами возвращают промисы.
- `browserEnv` — объект `{ isFirefox, isChromium, supportsDnr, nativeName }` для условной логики. Вычисляется только здесь.
- `extensionOrigin()` и `isExtensionUrl(url)` — origin страниц расширения и проверка, что URL ведёт на них. Origin берётся из `runtime.getURL('')`, а не из `URL.origin`: по стандарту origin нестандартных схем (`moz-extension:`, `chrome-extension:`) непрозрачен (`'null'`).
- Сетевые функции через вкладку сервиса: `setServiceTab`, `fetchViaTab`, `requestViaTab`, `hasServiceTab` и класс ошибки `NoServiceTabError`.

Остальные модули импортируют `extensionApi` и `browserEnv` отсюда и не обращаются к `browser`/`chrome` напрямую.

---

### `core/messages.js`

Протокол сообщений между окнами расширения, content scripts и фоном: замороженный объект `MSG` с именами действий и имя порта `PORT_KEEP_ALIVE`. Строки `plugin:cache` и `plugin:exec` входят в контракт плагинов и не меняются. Таблица действий — в разделе «Сообщения».

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

`getToken(serviceKey, tabId)` — сначала запрашивает токен у фона (`getAuthToken`). Если его нет и передан `tabId`, ищет токен в `localStorage`/`sessionStorage` страницы через `scripting.executeScript` и сохраняет найденный в фоне (`cacheAuthToken`). При поиске принимаются только JWT с действующим `exp` (с запасом 30 с). Сначала проверяются ключи, похожие на хранилище токена (`/auth|token/i`), затем остальные.

`apply(serviceKey, tabId, service)` — вызывает `getToken`, при успехе добавляет `Authorization: Bearer <token>` в `service.config.headers`.

`invalidate(serviceKey)` — просит фон удалить токен сервиса (`authInvalidate`), например после ответа 401.

Токены хранит фон — `background/tokenStore.js`.

---

### `core/EventBus.js`

Реализует паттерн Pub/Sub. Класс `EventBus` — не синглтон, каждый потребитель создаёт свой экземпляр.

Методы: `on(event, cb)`, `once(event, cb)`, `off(event, cb)`, `emit(event, data)`, `clear(event?)`.

`on()` возвращает функцию-отписку. `emit()` оборачивает каждый вызов подписчика в `try/catch` — ошибка в одном обработчике не ломает остальные.

Используется в `DownloadManager`: шина создаётся при инстанциировании и передаётся наружу как `downloadManager.eventBus`. `PopupController` подписывается на события `download:started`, `download:progress`, `download:completed`, `download:failed`.

---

### `core/RateLimiter.js`

Класс `RateLimiter` — ограничитель со скользящим окном в одну минуту. Модуль также экспортирует ключ настройки `RATE_LIMIT_STORAGE_KEY`, лимит по умолчанию `DEFAULT_RATE_LIMIT` (85 в минуту) и `normalizeRateLimit(value)` (2..200, нечисловое значение — лимит по умолчанию). Общего экземпляра модуль не создаёт: единственный экземпляр живёт в `background/rateLimitService.js`.

- `acquire(name)` / `trackRequest(name)` — промис, который разрешается, когда за последнюю минуту выдано меньше `limit` разрешений и нет блокировки. Ожидающие запросы стоят в очереди. Для всей очереди заводится один таймер — до момента, когда освободится ближайший слот.
- `throttle(ms)` — блокирует выдачу разрешений до `now + ms`. Более раннюю блокировку продлевает, более позднюю не сокращает. Возвращает момент окончания блокировки.
- `setLimit(n)` — точный лимит (без вычитания единицы) с ограничением 2..200. При повышении лимита ожидающие запросы получают разрешения сразу.
- `recordRequest(name)` / `record(name)` — учитывает уже сделанный запрос, даже если лимит исчерпан.
- `reset()` — отклоняет ожидающие промисы ошибкой `Rate limiter reset`, очищает окно и блокировку.
- `snapshot()` / `restore(state)` — состояние `{timestamps, blockedUntil}` для `storage.session`.
- `getStats()` — `{requestsInLastMinute, maxRequestsPerMinute, queueSize, throttled, blockedUntil, timestamps}`.

---

### `core/RateLimitClient.js`

Клиент общего ограничителя для страниц расширения. Каждое окно получает разрешения у фона, поэтому лимит общий для всех окон.

- `acquire(serviceKey)` — отправляет `rateAcquire` и ждёт ответа. Если фон недоступен, запрос пропускается с предупреждением, чтобы загрузка не зависла.
- `throttle(ms)` — сразу блокирует это окно и сообщает о блокировке фону (`rateThrottle`). Если фон ответил более поздним `blockedUntil`, локальная блокировка продлевается.
- `isHeldBack()` — синхронно: есть ожидающие `acquire` или действует блокировка. По нему `DeferredQueue` понимает, что сеть стоит, и не отсчитывает срок отложенной загрузки.
- `getLimit()` / `setLimit(value)` — лимит в минуту из `storage.local` (ключ `downloadlib_default_rate_limit`). Фон следит за этим ключом через `storage.onChanged`. Значение, сохранённое прежними версиями в `localStorage`, при первом чтении переносится в `storage.local`.
- `getStats()` / `reset()` — локальная статистика в прежнем формате и снятие локальной блокировки.

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

Запросы к API выполняются в контексте открытой вкладки сервиса через `requestViaTab`: браузер сам подставляет cookies, Referer и Origin сайта. Если вкладки нет, бросается ошибка с просьбой открыть страницу тайтла. При ответе 429 `fetchWithRateLimitRetry` ждёт `Retry-After` (по умолчанию 30 с) и вызывает `RateLimitClient.throttle`, чтобы остановить запросы всех окон.

- `fetchMangaMetadata(slug)` — `GET /api/manga/{slug}?fields[]=...`
- `fetchChaptersList(slug)` — `GET /api/manga/{slug}/chapters`
- `fetchChapter(slug, number, volume, branchId)` — `GET /api/manga/{slug}/chapter?number=...`

`static matches(url)` по умолчанию проверяет хост URL по `hosts` статического конфига класса (`static config = mangalibConfig`): совпадение или поддомен. Подкласс без статического конфига должен переопределить метод.

---

### `services/*/config.js`

Экспортируемый объект конфигурации сервиса (`mangalibConfig`, `ranobelibConfig`) — единственный источник доменов сервиса. Содержит:
- `name`, `baseUrl` (хост API), `imagesDomain`, `siteId` (значение заголовка `Site-Id`), `fields[]`, `headers`, `imageHeaders`, опциональные `splitLongImages` и `maxImageHeight`;
- `hosts` — сайты сервиса. По ним определяется сервис вкладки, ищутся вкладки сервиса и регистрируются content scripts;
- `imageHosts` — CDN изображений;
- `titleUrl` — шаблон адреса страницы тайтла с плейсхолдером `{slug}` (ссылки в истории загрузок);
- `adBlock` — фильтры рекламных запросов в синтаксисе `urlFilter` declarativeNetRequest;
- оформление: `label`, `siteUrl`, `primaryColor`, `secondaryColor`, `logo`.

Хост в `hosts` и `imageHosts` покрывает и свои поддомены. Класс сервиса импортирует конфиг и передаёт его в `super(config)`.

---

### `services/hosts.js`

Чистые функции над конфигами встроенных сервисов (`serviceConfigs`) и хостами плагинов. Ни один модуль не держит собственных списков доменов.
- `serviceKeyForUrl(url, pluginHosts?)` — сервис сайта или CDN по имени хоста (не по подстроке URL);
- `isServiceHost`, `isImageHost`, `isApiUrl`, `serviceKeyForSiteId`;
- `tabPatterns(serviceKey, pluginHosts?)` — паттерны поиска вкладки сервиса;
- `webRequestUrls()` — фильтр слушателей `webRequest`;
- `serviceOrigins(serviceKey?)`, `buildTitleUrl(template, slug)`;
- `extractSlug(url)` — slug из адреса страницы тайтла (до `?` и `#`).

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

### `background/RequestInterceptor.js`

Наблюдает за сетевыми запросами к сервисам. Сам запросы не делает и не считает: учёт частоты — только через `rateAcquire`. Ничего не экспортирует.

**Захват токенов (оба браузера).** Неблокирующий `webRequest.onBeforeSendHeaders`. Если страница сервиса обращается к API с заголовком `Authorization: Bearer …`, токен сохраняется в `tokenStore`. Сервис определяется:
1. по заголовку `Site-Id` встроенного сервиса;
2. иначе по хосту страницы, сделавшей запрос (`originUrl`/`initiator`), включая сайты сервисных плагинов.

Если сервис не определён, токен не сохраняется. Поэтому токен сайта плагина не затирает токен встроенного сервиса с тем же API.

**CORS изображений (только Firefox).** Блокирующий `onHeadersReceived` добавляет `Access-Control-Allow-Origin` к ответам на запросы изображений, у которых этого заголовка нет. Произвольный Origin никогда не отражается:
- Origin сайта встроенного сервиса — разрешается с `Access-Control-Allow-Credentials: true`;
- origin самого расширения — разрешается без credentials;
- любой другой Origin — заголовок не добавляется;
- запрос без Origin — origin расширения для запросов не из вкладки (`tabId -1`), иначе сайт сервиса, которому принадлежит CDN.

Origin запроса запоминается в `onBeforeSendHeaders` и забывается в `onHeadersReceived`, `onCompleted` или `onErrorOccurred`, так что карта не растёт.

Фильтр URL слушателей и распознавание сервиса берутся из `services/hosts.js`.

---

### `background/tokenStore.js`

Единственное хранилище токенов авторизации. Токены лежат в `storage.session`: они переживают перезапуск service worker'а, но не закрытие браузера. Без `storage.session` токены хранятся только в памяти.

- `getToken(serviceKey)` — действующий токен сервиса; истёкший удаляется.
- `setToken(serviceKey, token)` — сохраняет токен; истёкший или пустой не сохраняет. Возвращает `true`, если значение изменилось.
- `invalidate(serviceKey)` — удаляет токен.
- `jwtExpiry(token)`, `isTokenUsable(token)` — проверка `exp` в JWT с запасом 30 с. Токен без `exp` считается действующим.

---

### `background/rateLimitService.js`

Единственный экземпляр `RateLimiter` на всё расширение. Обслуживает сообщения `rateAcquire` и `rateThrottle` всех окон.
- Лимит читает из `storage.local['downloadlib_default_rate_limit']` до выдачи первого разрешения. Затем следит за этим ключом через `storage.onChanged`.
- Состояние (окно и блокировку) сохраняет в `storage.session` не чаще раза в секунду и восстанавливает после перезапуска service worker'а.

Экспортирует `acquire(serviceKey)`, `throttle(ms)` → `{blockedUntil}`, `getStats()`.

---

### `background/pluginHosts.js`

Хосты сайтов включённых сервисных плагинов из `storage.local['custom_plugins']`. `syncPluginHosts()` перечитывает их и возвращает включённые плагины с хостами. `getPluginHosts()` отдаёт карту «ключ сервиса → хосты», по которой `RequestInterceptor` определяет сервис токена, а `MessageRouter` — сайт вкладки-отправителя.

---

### `background/netRules.js`

Строит сессионные правила declarativeNetRequest из `config.adBlock`: правило `block` для каждого фильтра, только для запросов со страниц сайтов сервиса (`initiatorDomains` = `config.hosts`). `installAdBlockRules()` заменяет ранее установленные правила своего диапазона id одним `updateSessionRules`. `background/main.js` вызывает её при загрузке фона и на `runtime.onStartup`, потому что сессионные правила живут до закрытия браузера.

---

### `background/MessageRouter.js`

Маршрутизатор сообщений. Слушает `runtime.onMessage` и передаёт сообщение обработчику из таблицы `handlers` (действие → `{allow, handle}`), если отправителю он разрешён (см. «Сообщения» и «Проверка отправителя»). Обработчики асинхронные. Единая обёртка отправляет их результат через `sendResponse`, а ошибку — как `{ok: false, error}`.

`openDownloadWindow` определяет slug и сервис по URL вкладки-отправителя. В URL окна загрузки передаются только `slug`, `service`, `format` и `tabId`. Остальные параметры загрузки, в том числе лимит запросов и максимальный размер части, окно берёт из настроек.

Принимает подключения порта `downloadKeepAlive`. Окно загрузки держит его открытым, чтобы фон Chrome не выгружался посреди загрузки.

Регистрирует content scripts (`scripting.registerContentScripts`): для встроенных сервисов — по `hosts` их конфигов, для включённых плагинов — по их хостам. Статических `content_scripts` в манифестах нет. При старте фона и при изменении списка плагинов регистрации сверяются с нужными: неизменённые не трогаются, устаревшие снимаются, новые добавляются по одной.

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
    imageHeaders: { 'Referer': 'https://newsite.example/' },

    hosts: ['newsite.example'],
    imageHosts: ['img.newsite.example'],
    titleUrl: 'https://newsite.example/manga/{slug}',
    adBlock: []
};
```

2. Создать модуль `services/newsite/NewSiteService.js`:

```js
import { fetchPageImage, loadImageOrDefer } from '../../core/DownloadManager.js';
import { BaseService } from '../BaseService.js';
import { newsiteConfig } from './config.js';

export class NewSiteService extends BaseService {
    // По hosts этого конфига работает унаследованный static matches(url).
    static config = newsiteConfig;

    constructor() { super(newsiteConfig); }

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

4. Добавить конфиг в массив `serviceConfigs` в `services/hosts.js`. Отсюда фон берёт фильтры `webRequest`, паттерны поиска вкладки, регистрацию content scripts и правила блокировки рекламы. Правки манифестов, `RequestInterceptor` и `MessageRouter` не нужны: `host_permissions` (`https://*/*`) уже покрывает любой сайт.
