# API сервиса подписи

Базовый URL: адрес Worker'а или `http://localhost:8787` локально.
Если задан `TOKEN`, каждый запрос должен нести `x-token: <TOKEN>` (или `?token=`).

## GET /health

```json
{
  "status": "ok",
  "sdk": "5.3.2",
  "scm": "2.0.0.561",
  "session": true,
  "region": "RU",
  "wid": "7710540754074437121"
}
```

`session: false` при первом вызове — нормально: сессия поднимается лениво,
при первом запросе к ленте.

## GET /feed

Параметры: `count` (1–30, по умолчанию 10), `cursor` (из предыдущего ответа).

```json
{
  "status": "ok",
  "cursor": "10",
  "hasMore": true,
  "count": 7,
  "items": [
    {
      "id": "7035722352948186369",
      "desc": "…",
      "created": 1638131765,
      "duration": 11,
      "width": 576,
      "height": 1024,
      "cover": "https://p16-common-sign.tiktokcdn.com/…",
      "dynamicCover": "https://…",
      "play": "https://v16-webapp-prime.tiktok.com/video/tos/…",
      "download": "https://v16-webapp.tiktok.com/…",
      "author": { "id": "…", "uid": "tusya_kiskis", "nick": "…", "avatar": "https://…" },
      "stats": { "play": 1200, "like": 340, "comment": 12, "share": 4 },
      "music": { "title": "…", "author": "…", "url": "https://…" }
    }
  ]
}
```

Ссылки `play`/`download` — прямые MP4 без авторизации, с ограниченным сроком
жизни. Клиент не должен кешировать их дольше нескольких часов.

## GET /item?id=7035722352948186369

То же самое, но одно видео: `{ "status": "ok", "item": { … } }`.
404 — видео удалено или закрыто.

## GET /raw?path=/api/post/item_list/&secUid=…&count=10&envCode=64

Проброс в TikTok как есть, для отладки новых эндпоинтов:

```json
{ "status": "ok", "upstream": 200, "bytes": 141908, "data": { "…": "сырой ответ" } }
```

Ограничения: `path` обязан начинаться с `/api/`, `envCode` не уходит в TikTok,
а меняет код окружения в подписи.

## Ошибки

Любая ошибка — `502` и `{ "status": "error", "message": "…" }`.
Типичные тексты:

- `TikTok did not issue msToken - the egress IP is likely blocked` — IP сервиса
  в чёрном списке, нужен другой хостинг или прокси;
- `TikTok throttled the request (HTTP 429)` — слишком часто, надо поднять
  `MIN_INTERVAL_MS`.
