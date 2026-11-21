# Архитектура

```
Lumia (UWP, C#/XAML)  ──HTTPS──>  Сервис подписи  ──HTTPS──>  www.tiktok.com
   MediaPlayer,                      X-Gnarly                  подписанный
   локальный кеш                     X-Dynosaur                 web API
```

## Почему так

1. **Подпись живёт на сервере.** Версии `X-Gnarly`/`X-Dynosaur` меняются
   несколько раз в год. Передеплой сервиса — минута, пересборка и установка
   appx на Lumia — полчаса и провода.
2. **Сервис нормализует JSON.** Ответ TikTok на 21 видео — около 450 КБ с
   дублирующимися полями; после нормализации — около 17 КБ. На Lumia это
   критично и по памяти, и по скорости разбора.
3. **Клиент ничего не знает про TikTok.** Он видит четыре эндпоинта и
   структуру `Item`. Если TikTok что-то сломает, клиент не трогаем.

## Сессия

```
POST /ttwid/union/register/        -> ttwid
GET  /explore                      -> webapp.app-context (wid, region, odinId, csrfToken)
GET  /api/recommend/item_list/     -> cookie msToken
```

Дальше каждый запрос подписывается: `msToken` + `X-Dynosaur` + `X-Bogus: 1` +
`X-Gnarly` в query, плюс `ttwid`/`msToken` в cookie. Сессия живёт 10 минут или
150 запросов, потом поднимается заново.

Запросы сериализуются с паузой `MIN_INTERVAL_MS` (по умолчанию 700 мс):
параллельные вызовы TikTok придушивает.

## Клиент (следующий этап)

- UWP, C#, `MinVersion 10.0.14393`, `TargetPlatformVersion 10.0.16299`, ARM.
- Видео: `MediaPlayer` + `MediaPlayerElement`, H.264 MP4 — 540p тянет спокойно.
- Лента: `ItemsRepeater`/`ListView` с одной карточкой на экран, без тяжёлых
  анимаций; кеш обложек на диск (локальная папка приложения).
- Скачивание: `BackgroundDownloader` в папку «Видео».
- Настройки: адрес сервиса, токен, качество, автовоспроизведение.
- Особенность W10M: нет WebView2, встроенный Edge (EdgeHTML) для tiktok.com
  бесполезен — поэтому только нативный UI.

## Обновление подписи

1. Смотрим, какая версия webmssdk у TikTok (поле `version`/`scm` в подписи или
   в бандле).
2. Меняем `SIGNER_SDK_VERSION` / `SIGNER_SCM_VERSION` в Worker'е.
3. Если поменялся сам алгоритм — правим `signer/signer.ts` и редеплоим.

Клиент при этом не меняется.
