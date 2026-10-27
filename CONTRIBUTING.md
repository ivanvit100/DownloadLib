<div align="center">

# Участие в разработке DownloadLib

**Спасибо, что хотите помочь проекту! Этот документ расскажет, как это сделать правильно.**

[⚠️ Сообщить об ошибке](https://github.com/ivanvit100/DownloadLib/issues/new?template=bug-report.yaml) · [⚙️ Предложить идею](https://github.com/ivanvit100/DownloadLib/issues/new?template=feature-request.yaml) · [❓ Задать вопрос](https://github.com/ivanvit100/DownloadLib/issues/new?template=question.yaml)

</div>

---

## Содержание

- [Как помочь проекту](#как-помочь-проекту)
- [Настройка окружения](#настройка-окружения)
- [Структура проекта](#структура-проекта)
- [Стиль кода](#стиль-кода)
- [Тесты](#тесты)
- [Процесс pull request](#процесс-pull-request)
- [Планы на следующую версию](#планы-на-следующую-версию)

---

## Как помочь проекту

<table>
  <tr>
    <td>⚠️ <b>Нашли баг</b></td>
    <td>Откройте <a href="https://github.com/ivanvit100/DownloadLib/issues/new?template=bug-report.yaml">Bug Report</a> с версией расширения, браузером, шагами воспроизведения и ожидаемым поведением</td>
  </tr>
  <tr>
    <td>⚙️ <b>Есть идея</b></td>
    <td>Откройте <a href="https://github.com/ivanvit100/DownloadLib/issues/new?template=feature-request.yaml">Feature Request</a> — опишите сценарий использования и почему это будет полезно другим пользователям</td>
  </tr>
  <tr>
    <td>✏️ <b>Изменения кода</b></td>
    <td>Для нетривиальных изменений сначала откройте issue, чтобы обсудить подход, и только потом приступайте к реализации</td>
  </tr>
  <tr>
    <td>ℹ️ <b>Документация</b></td>
    <td>Исправления в README, комментариях к коду и этом файле тоже приветствуются</td>
  </tr>
</table>

---

## Настройка окружения

**Требования:** Node.js 18+, npm. Для запуска расширения — Chromium-браузер с поддержкой Manifest V3 или **Firefox 115+** (нужны сессионные правила declarativeNetRequest и `storage.session`).

```sh
# Клонируйте репозиторий
git clone https://github.com/ivanvit100/DownloadLib.git
cd DownloadLib

# Установите зависимости
npm install
```

**Загрузка расширения локально:**

<details>
<summary><b>Firefox</b></summary>

1. Откройте `about:debugging` в Firefox (версия 115 или новее).
2. Во вкладке **«Этот Firefox»** выберите **«Загрузить временное дополнение»**.
3. Переименуйте `manifest.firefox.json` в `manifest.json` и выберите его.

</details>

<details>
<summary><b>Chromium-браузеры</b></summary>

1. Откройте `chrome://extensions/` в браузере.
2. Включите **«Режим разработчика»**.
3. Нажмите **«Загрузить распакованное расширение»** и выберите папку проекта.
4. Убедитесь, что активен файл `manifest.chrome.json` (переименуйте в `manifest.json`).

</details>

---

## Структура проекта

```
DownloadLib/
├── app.js                   # Точка входа popup (ES-модуль): регистрирует сервисы, экспортёры, плагины, создаёт PopupController
├── popup.html               # Страница попапа (оболочка; шаблоны подгружает TemplateLoader)
├── background/              # Фоновые модули
│   ├── BackgroundMain.js    # Общая точка входа фона: импортирует RequestInterceptor и MessageRouter
│   ├── service-worker.js    # Chrome: модульный service worker, импортирует BackgroundMain.js
│   ├── background.html      # Firefox: фоновая страница, подключает BackgroundMain.js как модуль
│   ├── RequestInterceptor.js# Захват токенов из запросов страниц сервиса, CORS изображений в Firefox
│   ├── TokenStore.js        # Хранилище токенов авторизации (storage.session, проверка exp)
│   ├── RateLimitService.js  # Единственный ограничитель частоты запросов для всех окон
│   ├── PluginHosts.js       # Хосты сайтов сервисных плагинов
│   ├── AdBlockRules.js      # Правила declarativeNetRequest из конфигов (блокировка рекламы)
│   └── MessageRouter.js     # Маршрутизация runtime.onMessage с проверкой отправителя, регистрация content scripts
├── content/                 # Контент-скрипты (исполняются на страницах сайтов)
│   ├── AdCleaner.js         # Удаляет рекламные элементы
│   └── DownloadButton.js    # Инжектирует кнопку «Скачать» на странице тайтла
├── core/                    # Ядро: логика загрузки, утилиты, хранилища
│   ├── BrowserApi.js        # Единый API-адаптер (Firefox/Chrome)
│   ├── TabNetwork.js        # Все запросы к сервису через его вкладку (с общим ограничителем)
│   ├── Base64Codec.js       # Blob ↔ data-URL/base64 ↔ байты
│   ├── TextUtils.js         # Экранирование, раскодирование сущностей, очистка имени файла
│   ├── ChapterList.js       # Ключи глав, сортировка, ветки перевода, диапазон по ключам
│   ├── MessageTypes.js      # Имена runtime-сообщений (MSG) и порта keep-alive
│   ├── ConsoleLogger.js     # createLogger(scope): уровни debug/info/warn/error, уровень из storage.local
│   ├── EventBus.js          # Pub/Sub шина событий
│   ├── RateLimiter.js       # Ограничитель частоты запросов (скользящее окно)
│   ├── RateLimitClient.js   # Клиент ограничителя фона для окон расширения
│   ├── Storage.js           # SafeStorage: обёртка над localStorage
│   ├── UserSettings.js      # Ключи, значения по умолчанию и хранилище настроек страниц расширения
│   ├── PluginApi.js         # Публикует в globalThis классы и реестры для плагинов
│   ├── DownloadHistory.js   # Хранение истории загрузок (до 10 записей)
│   ├── AuthManager.js       # Извлечение и кэширование JWT-токенов авторизации
│   ├── MangaPatcher.js      # Нормализация метаданных тайтла
│   ├── DownloadManager.js   # Оркестратор загрузки глав и экспорта
│   ├── DownloadContext.js   # Состояние одной загрузки: пауза, остановка, отложенные загрузки, колбэки
│   ├── DeferredQueue.js     # Фоновая догрузка медленных картинок и глав
│   ├── ImageCompressor.js   # Сжатие, вписывание и нарезка изображений (OffscreenCanvas)
│   └── PluginManager.js     # Управление пользовательскими плагинами (сервисы и экспортёры)
├── ui/                      # UI-контроллеры попапа; DomUtils.js — $el, setDisplay, createEl (данные сайта только текстом)
├── templates/               # HTML-фрагменты (подгружаются динамически)
├── exporters/               # Экспортёры форматов (FB2, EPUB, MOBI, PDF, TXT, JPEG); BuiltinExporters.js регистрирует встроенные
├── services/                # Адаптеры сайтов (MangaLib, RanobeLib; CdnLibsService — общая база MangaLib и сервисных плагинов;
│                            #   ServiceHosts.js — домены из конфигов; BuiltinServices.js регистрирует встроенные)
├── css/                     # Стили интерфейса
├── lib/                     # Сторонние библиотеки (jszip, html2pdf)
├── plugins/                 # Официальные плагины (пример для пользователей)
├── manifest.chrome.json     # Chrome MV3 манифест
├── manifest.firefox.json    # Firefox манифест
├── tests/                   # Тестовые наборы (Vitest), зеркалят структуру src
└── .github/                 # CI-воркфлоу и шаблоны issue
```

Подробное описание архитектуры, схема зависимостей модулей и инструкции по расширению функциональности — в [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Стиль кода

- Используется **чистый JavaScript**.
- Придерживайтесь конвенций того файла, который редактируете — единообразие важнее личных предпочтений.
- Файлы модулей называются в PascalCase, обычно двумя словами, по главному классу или назначению: `DownloadManager.js`, `TabNetwork.js`, `TextUtils.js`. Файлы тестов повторяют имя модуля: `tests/core/TextUtils.test.js`.
- Не добавляйте новые runtime-зависимости без предварительного обсуждения.
- В ES-модулях пишите в лог через `createLogger('Модуль')` из `core/ConsoleLogger.js`, а не через `console.*`. Не оставляйте пустых `catch {}`: хотя бы `log.debug(…, e)`. Подробные логи в расширении включаются так: `chrome.storage.local.set({downloadlib_log_level: 'debug'})` в DevTools страницы расширения.

---

## Тесты

Тесты написаны на [Vitest](https://vitest.dev/).

```sh
# Запустить все тесты
npm test

# Запустить с отчётом покрытия
npm run test:coverage

# Проверить код линтером
npm run lint
```

<table>
  <tr>
    <td>✔️ <b>Все тесты должны проходить</b></td>
    <td>PR не будет принят, если тесты падают</td>
  </tr>
  <tr>
    <td>⚗️ <b>Покрытие 100%</b></td>
    <td>Проект поддерживает полное покрытие — добавляйте тесты для каждого нового кода</td>
  </tr>
  <tr>
    <td>⚙️ <b>CI</b></td>
    <td>GitHub Actions автоматически запускает тесты и линтер на каждый push и PR в <code>master</code></td>
  </tr>
  <tr>
    <td>🔌 <b>Контракт плагинов</b></td>
    <td>Тесты в <code>tests/plugins/</code> проверяют то, на что опираются плагины пользователей (см. «Контракт плагинов» в <a href="ARCHITECTURE.md">ARCHITECTURE.md</a>). Не меняйте в них проверки, чтобы «починить» тест: это изменение контракта, его нужно обсудить</td>
  </tr>
</table>

**Как подменять зависимости.** Модули расширения — ES-модули, поэтому зависимости модуля подменяются через `vi.mock`, а не через `globalThis`. Чтобы менять мок в `beforeEach` или в отдельном тесте, храните моки в объекте из `vi.hoisted` и отдавайте их через `mockExports` из `tests/helpers/ModuleMock.js`:

```js
const mocks = vi.hoisted(() => ({}));
vi.mock('../../core/RateLimitClient.js', async () =>
    (await import('../helpers/ModuleMock.js')).mockExports(mocks, 'RateLimitClient'));

import { RateLimitClient } from '../../core/RateLimitClient.js'; // тот же мок

beforeEach(() => {
    mocks.RateLimitClient = { acquire: vi.fn(async () => {}), isHeldBack: vi.fn(() => false) };
});
```

Если модуль наследует подменённый класс (`extends BaseService`), задайте мок до импорта модуля: базовый класс фиксируется при загрузке. Тесты запускаются с уровнем логирования `debug`, поэтому отладочные сообщения тоже можно проверять через `vi.spyOn(console, 'debug')`.

## Процесс pull request

1. Создайте ветку от `master`:
   ```sh
   git checkout -b feat/название-фичи
   ```
2. Внесите изменения, убедитесь, что тесты проходят.
3. Откройте PR против `master` и полностью заполните шаблон.
4. Дождитесь ревью.

> Один PR — одна задача. Не смешивайте несвязанные изменения.

---

## Планы на следующие версии

Если хотите помочь с реализацией одного из запланированных пунктов — упомяните это в своём issue или PR, чтобы не дублировать работу.

- [x] Ограничитель загрузки по главам (1.1.0)
- [x] Улучшить блокировку рекламы в Chromium (1.1.0)
- [x] Ускорение загрузки временным скипом "зависших" глав (1.1.0)
- [x] Общий рефакторинг архитектуры (1.1.0)
- [ ] e2e тесты (1.1.0+)
- [ ] Добавить возможность выбора сервера (ожидание API)

#### Ведётся сбор идей для новых версий. Если знаете, как можно улучшить DownloadLib - напишите об этом в Issue. 

---

<div align="center">
  <sub>Любой вклад — большой или маленький — делает DownloadLib лучше. Спасибо!</sub>
</div>
