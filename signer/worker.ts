// Cloudflare Worker: тот же код, что и node.mjs, только вход другой.
//   wrangler secret put TOKEN
//   wrangler deploy

import { configure, handle } from './tiktok.ts';

interface Env {
  TOKEN?: string;
  SIGNER_SDK_VERSION?: string;
  SIGNER_SCM_VERSION?: string;
  MIN_INTERVAL_MS?: string;
  REGION?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    configure({
      authToken: env.TOKEN ?? '',
      sdkVersion: env.SIGNER_SDK_VERSION,
      scmVersion: env.SIGNER_SCM_VERSION,
      minIntervalMs: env.MIN_INTERVAL_MS ? Number(env.MIN_INTERVAL_MS) : undefined,
      region: env.REGION,
    });

    const url = new URL(request.url);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });

    const token = env.TOKEN ?? '';
    if (token && url.searchParams.get('token') !== token && request.headers.get('x-token') !== token) {
      return json(401, { status: 'error', message: 'unauthorized' });
    }

    const { status, body } = await handle(url.pathname, url.searchParams);
    return json(status, body);
  },
};
