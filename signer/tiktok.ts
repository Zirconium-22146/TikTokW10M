// Общий слой: сессия TikTok, подписанные запросы и нормализация ответов.
// Работает и в Node 22+, и в Cloudflare Workers (только fetch/URL).

import { signRequest, DEFAULT_SDK_VERSION, DEFAULT_SCM_VERSION } from './signer.ts';

const ORIGIN = 'https://www.tiktok.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface Config {
  authToken?: string;
  sdkVersion?: string;
  scmVersion?: string;
  minIntervalMs?: number;
  region?: string;
}

const config: Required<Omit<Config, 'authToken'>> & { authToken: string } = {
  authToken: '',
  sdkVersion: DEFAULT_SDK_VERSION,
  scmVersion: DEFAULT_SCM_VERSION,
  minIntervalMs: 700,
  region: 'US',
};

export function configure(next: Config): void {
  Object.assign(config, next);
}

// ---------------------------------------------------------------- session ---
const jar: Record<string, string> = Object.create(null);
let appContext: Record<string, any> | undefined;
let bootedAt = 0;
let requestCount = 0;

function cookieHeader(): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function absorb(response: Response): void {
  const list = (response.headers as any).getSetCookie?.() ?? [];
  for (const raw of list as string[]) {
    const first = raw.split(';')[0];
    const eq = first.indexOf('=');
    if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
}

async function send(url: string, init: RequestInit = {}): Promise<{ res: Response; text: string }> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    ...(Object.keys(jar).length ? { Cookie: cookieHeader() } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(url, { ...init, headers });
  absorb(res);
  return { res, text: await res.text() };
}

function parseAppContext(html: string): Record<string, any> | undefined {
  const match = /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]).__DEFAULT_SCOPE__?.['webapp.app-context'];
  } catch {
    return undefined;
  }
}

export async function bootstrap(): Promise<void> {
  for (const key of Object.keys(jar)) delete jar[key];

  try {
    await send(`${ORIGIN}/ttwid/union/register/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: '*/*' },
      body: JSON.stringify({
        region: config.region,
        aid: 1988,
        needFid: false,
        service: 'www.tiktok.com',
        migrate_info: { ticket: '', source: 'node' },
        cbUrlProtocol: 'https',
        union: true,
      }),
    });
  } catch {
    // не критично: ttwid всё равно выдаст страница
  }

  appContext = undefined;
  for (const path of ['/explore', '/foryou', '/']) {
    try {
      const { text } = await send(`${ORIGIN}${path}`, {
        headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      });
      appContext = parseAppContext(text);
      if (appContext?.wid) break;
    } catch {
      // пробуем следующую страницу
    }
  }

  const wid = appContext?.wid ?? '7' + Array.from({ length: 18 }, () => Math.floor(Math.random() * 10)).join('');
  const region = appContext?.region ?? config.region;
  const query = new URLSearchParams({
    aid: '1988',
    count: '10',
    app_name: 'tiktok_web',
    device_platform: 'web_pc',
    device_id: wid,
    region,
    priority_region: region,
  });
  await send(`${ORIGIN}/api/recommend/item_list/?${query}`, {
    headers: { Accept: 'application/json, text/plain, */*', Referer: `${ORIGIN}/foryou` },
  });

  bootedAt = Date.now();
  requestCount = 0;
  if (!jar.msToken) {
    throw new Error('TikTok did not issue msToken - the egress IP is likely blocked');
  }
}

async function ensureSession(): Promise<{ wid: string; region: string }> {
  if (!appContext || !jar.msToken || requestCount >= 150 || Date.now() - bootedAt > 10 * 60 * 1000) {
    await bootstrap();
  }
  return { wid: appContext!.wid, region: appContext!.region ?? config.region };
}

let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function serialise<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = config.minIntervalMs - (Date.now() - lastCall);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await task();
    } finally {
      lastCall = Date.now();
    }
  });
  queue = run.catch(() => undefined);
  return run as Promise<T>;
}

// ------------------------------------------------------------------ calls ---
function commonParams(wid: string, region: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  return {
    aid: '1988',
    app_name: 'tiktok_web',
    app_language: 'en',
    device_platform: 'web_pc',
    device_id: wid,
    region,
    priority_region: region,
    language: 'en',
    WebIdLastTime: String(now),
    channel: 'tiktok_web',
    cookie_enabled: 'true',
    os: 'mac',
    browser_language: 'en-US',
    browser_name: 'Mozilla',
    browser_online: 'true',
    browser_platform: 'MacIntel',
    browser_version: '5.0 (Macintosh)',
    focus_state: 'true',
    is_fullscreen: 'false',
    is_page_visible: 'true',
    history_len: '3',
    screen_height: '1117',
    screen_width: '1728',
    tz_name: 'America/New_York',
    webcast_language: 'en',
    referer: '',
    root_referer: `${ORIGIN}/`,
    odinId: appContext?.odinId ?? '',
  };
}

export async function call(
  path: string,
  extra: Record<string, string> = {},
  options: { envCode?: number; referer?: string } = {},
): Promise<{ status: number; text: string; logId: string | null }> {
  return serialise(async () => {
    const { wid, region } = await ensureSession();
    requestCount += 1;

    const pairs: Array<[string, string]> = [
      ...Object.entries(commonParams(wid, region)),
      ...Object.entries(extra),
    ];
    const abVersion = appContext?.abTestVersion?.versionName;
    if (abVersion) pairs.push(['clientABVersions', abVersion]);

    const signed = signRequest(pairs, {
      userAgent: UA,
      msToken: jar.msToken ?? '',
      sdkVersion: config.sdkVersion,
      scmVersion: config.scmVersion,
      envCode: options.envCode,
    });

    const { res, text } = await send(`${ORIGIN}${path}?${signed.query}`, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: options.referer ?? `${ORIGIN}/`,
        'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        priority: 'u=1, i',
        ...(appContext?.csrfToken ? { 'x-secsdk-csrf-token': String(appContext.csrfToken) } : {}),
      },
    });

    if (res.status === 429) throw new Error('TikTok throttled the request (HTTP 429)');
    return { status: res.status, text, logId: res.headers.get('x-tt-logid') };
  });
}

// ----------------------------------------------------------- normalisation ---
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);

export interface Item {
  id: string;
  desc: string;
  created: number;
  duration: number;
  width: number;
  height: number;
  cover: string;
  dynamicCover: string;
  play: string;
  download: string;
  author: { id: string; uid: string; nick: string; avatar: string };
  stats: { play: number; like: number; comment: number; share: number };
  music: { title: string; author: string; url: string };
}

export function normaliseItem(raw: any): Item {
  const video = raw.video ?? {};
  const author = raw.author ?? {};
  const music = raw.music ?? {};
  return {
    id: String(raw.id),
    desc: raw.desc ?? '',
    created: num(raw.createTime),
    duration: num(video.duration),
    width: num(video.width),
    height: num(video.height),
    cover: video.cover ?? video.originCover ?? '',
    dynamicCover: video.dynamicCover ?? '',
    play: video.playAddr ?? video.downloadAddr ?? '',
    download: video.downloadAddr ?? video.playAddr ?? '',
    author: {
      id: String(author.id ?? ''),
      uid: author.uniqueId ?? '',
      nick: author.nickname ?? '',
      avatar: author.avatarThumb ?? author.avatarMedium ?? '',
    },
    stats: {
      play: num(raw.stats?.playCount),
      like: num(raw.stats?.diggCount),
      comment: num(raw.stats?.commentCount),
      share: num(raw.stats?.shareCount),
    },
    music: { title: music.title ?? '', author: music.authorName ?? '', url: music.playUrl ?? '' },
  };
}

// ----------------------------------------------------------------- routes ---
export interface Reply {
  status: number;
  body: unknown;
}

export async function handle(path: string, params: URLSearchParams): Promise<Reply> {
  try {
    switch (path) {
      case '/health': {
        return {
          status: 200,
          body: {
            status: 'ok',
            sdk: config.sdkVersion,
            scm: config.scmVersion,
            session: Boolean(jar.msToken),
            region: appContext?.region ?? null,
            wid: appContext?.wid ?? null,
          },
        };
      }

      case '/feed': {
        const { text } = await call('/api/recommend/item_list/', {
          count: String(Math.min(Number(params.get('count') ?? 10) || 10, 30)),
          cursor: params.get('cursor') ?? '0',
          from_page: 'fyp',
        });
        const data = JSON.parse(text);
        const items = (data.itemList ?? []).map(normaliseItem);
        return {
          status: 200,
          body: {
            status: 'ok',
            cursor: String(data.cursor ?? 0),
            hasMore: Boolean(data.hasMore),
            count: items.length,
            items,
          },
        };
      }

      case '/item': {
        const id = params.get('id');
        if (!id) return { status: 400, body: { status: 'error', message: 'missing ?id=' } };
        const { text } = await call('/api/item/detail/', { itemId: id });
        const data = JSON.parse(text || 'null');
        if (!data?.itemInfo?.itemStruct) {
          return { status: 404, body: { status: 'error', message: 'video not found or private' } };
        }
        return { status: 200, body: { status: 'ok', item: normaliseItem(data.itemInfo.itemStruct) } };
      }

      case '/raw': {
        const target = params.get('path');
        if (!target || !target.startsWith('/api/')) {
          return { status: 400, body: { status: 'error', message: 'missing ?path=/api/...' } };
        }
        const extra: Record<string, string> = {};
        params.forEach((value, key) => {
          if (key !== 'path' && key !== 'envCode') extra[key] = value;
        });
        const envCode = params.get('envCode') ? Number(params.get('envCode')) : undefined;
        const result = await call(target, extra, { envCode });
        let data: unknown = null;
        try {
          data = JSON.parse(result.text || 'null');
        } catch {
          data = { raw: result.text.slice(0, 2000) };
        }
        return { status: 200, body: { status: 'ok', upstream: result.status, bytes: result.text.length, data } };
      }

      default:
        return { status: 404, body: { status: 'error', message: 'not found' } };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 502, body: { status: 'error', message } };
  }
}
