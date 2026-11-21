// Локальный сервис (Node 22.18+, .ts читается из коробки).
//   PORT=8787 TOKEN=secret node node.mjs

import { createServer } from 'node:http';
import { configure, handle } from './tiktok.ts';

const port = Number(process.env.PORT ?? 8787);
const token = process.env.TOKEN ?? '';

configure({
  authToken: token,
  sdkVersion: process.env.SIGNER_SDK_VERSION,
  scmVersion: process.env.SIGNER_SCM_VERSION,
  minIntervalMs: Number(process.env.MIN_INTERVAL_MS ?? 700),
  region: process.env.REGION ?? 'US',
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const reply = (status, body) => {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
      'Cache-Control': 'no-store',
    });
    res.end(json);
  };

  if (token && url.searchParams.get('token') !== token && req.headers['x-token'] !== token) {
    return reply(401, { status: 'error', message: 'unauthorized' });
  }

  const { status, body } = await handle(url.pathname, url.searchParams);
  reply(status, body);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`tiktokw10m signer: http://0.0.0.0:${port}`);
});
