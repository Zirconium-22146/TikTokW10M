# Attribution

`signer/signer.ts` — производная работа от проекта
[sangzun-han/Tiktok-Api](https://github.com/sangzun-han/Tiktok-Api)
(MIT License, Copyright (c) 2026 sangzun-han).

Изменения относительно оригинала:

- убран импорт `node:crypto`: MD5 реализован на чистом JS, а ключ генерируется
  через `crypto.getRandomValues`, чтобы один и тот же файл работал и в Node,
  и в Cloudflare Workers (там `createHash` недоступен);
- файл используется как есть для подписи запросов, без NestJS-обвязки.

Текст лицензии MIT сохранён в `signer/LICENSE`.
