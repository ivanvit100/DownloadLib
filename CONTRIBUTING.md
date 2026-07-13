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

**Требования:** Node.js 18+, npm

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

1. Откройте `about:debugging` в Firefox.
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
├── app.js                   # Точка входа popup: проверяет зависимости, создаёт PopupController
├── popup.html               # Страница попапа (оболочка; шаблоны подгружает TemplateLoader)
├── background/              # Фоновые скрипты
│   ├── service-worker.js    # Chrome: точка входа SW, грузит всё через importScripts
│   ├── background.html      # Firefox: точка входа фоновой страницы
│   ├── RequestInterceptor.js# Перехват HTTP-запросов, заголовки, авторизация, блокировка рекламы
│   └── MessageRouter.js     # Маршрутизация runtime.onMessage (fetchImage, fetchWithRateLimit, …)
├── content/                 # Контент-скрипты (исполняются на страницах сайтов)
│   ├── AdCleaner.js         # Удаляет рекламные элементы
│   ├── DownloadButton.js    # Инжектирует кнопку «Скачать» на странице тайтла
│   └── ImageFetcher.js      # Прокидывает fetch изображений через вкладку в background
├── core/                    # Ядро: логика загрузки, утилиты, хранилища
│   ├── BrowserApi.js        # Единый API-адаптер (Firefox/Chrome)
│   ├── EventBus.js          # Pub/Sub шина событий
│   ├── RateLimiter.js       # Ограничитель частоты запросов
│   ├── Storage.js           # Обёртка над localStorage
│   ├── DownloadHistory.js   # Хранение истории загрузок (до 10 записей)
│   ├── AuthManager.js       # Извлечение и кэширование JWT-токенов авторизации
│   ├── MangaPatcher.js      # Нормализация метаданных тайтла
│   └── DownloadManager.js   # Оркестратор загрузки глав и экспорта
├── ui/                      # UI-контроллеры попапа
│   ├── TemplateLoader.js    # Загрузка HTML-шаблонов в #view
│   ├── HistoryController.js # Вид истории загрузок
│   ├── ChapterController.js # Выбор диапазона глав и переводчика
│   └── PopupController.js   # Главный контроллер попапа
├── templates/               # HTML-фрагменты (подгружаются динамически)
│   ├── title.html           # Основная форма загрузки
│   ├── history.html         # Список истории
│   ├── wrong-service.html   # Заглушка для неподдерживаемого сайта
│   └── no-title.html        # Заглушка при отсутствии тайтла
├── exporters/               # Экспортёры форматов (FB2, EPUB, MOBI, PDF, TXT, JPEG)
├── services/                # Адаптеры для конкретных сайтов (MangaLib, RanobeLib)
├── css/                     # Стили интерфейса
├── lib/                     # Сторонние библиотеки (jszip, html2pdf)
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
- Не добавляйте новые runtime-зависимости без предварительного обсуждения.

---

## Тесты

Тесты написаны на [Vitest](https://vitest.dev/).

```sh
# Запустить все тесты
npm test

# Запустить с отчётом покрытия
npm run test:coverage
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
</table>

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

## Планы на следующую версию

Если хотите помочь с реализацией одного из запланированных пунктов — упомяните это в своём issue или PR, чтобы не дублировать работу.

### Ведётся сбор идей для новых версий. Если знаете, как можно улучшить DownloadLib - напишите об этом в Issue. 

---

<div align="center">
  <sub>Любой вклад — большой или маленький — делает DownloadLib лучше. Спасибо!</sub>
</div>
