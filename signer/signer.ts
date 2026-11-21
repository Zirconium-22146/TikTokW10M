

const MASK32 = 0xffffffff;

export const DYNOSAUR_PARAM = 'X-Dynosaur';
export const MS_TOKEN_PARAM = 'msToken';
export const BOGUS_PARAM = 'X-Bogus';
export const GNARLY_PARAM = 'X-Gnarly';

// On HTTP requests the page sends a literal "1". The 16-char value from
// frontierSign() belongs to the websocket handshake.
export const BOGUS_VALUE = '1';

const ENVELOPE_TAG = 0x4b;

// Base64 with a shuffled alphabet, taken from the SDK's string table.
const ALPHABET = 'u09tbS3UvgDEe6r-ZVMXzLpsAohTn7mdINQlW412GqBjfYiyk8JORCF5/xKHwacP';
const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Not the standard "expand 32-byte k" constants.
const CHACHA_INIT = [1196819126, 600974999, 3863347763, 1451689750] as const;

// FNV-1a variant: non-standard offset basis plus an extra `* 33` per byte (see hashState).
const FNV_OFFSET = 2166136260;
const FNV_PRIME = 16777619;

const KEY_WORDS = 12;

// Taken from webmssdk 2.0.0.561. Override via TIKTOK_SIGNER_*_VERSION if TikTok ships a new build.
export const DEFAULT_SDK_VERSION = '5.3.2';
export const DEFAULT_SCM_VERSION = '2.0.0.561';

// The server checks envCode. Most endpoints expect 65; /api/post/item_list/ expects 64.
const ENV_CODE = 65;
const UB_CODE = 8;

// Field 0x38. Constant across bundles and environments.
const VM_STATE_HASH = 0xc46ce353;

// What a page without a 2d canvas context reports.
const CANVAS_HASH = '-1';

// Fingerprints a headless client can't produce. Reported as 0.
const WEBGL_HASH = '0';
const COMPONENT_VERSION = '0';
const DEVICE_HASH = '0';

const DEFAULT_PAGE = 'www.tiktok.com/';

const CALL_SEQUENCE_START = 1;

// Field encoders: [xorBase, addBase, preXor, rotate, postAdd].
export const ENCODER_A = [103, 1, null, 2, 1] as const;
export const ENCODER_B = [102, 0, 165, 1, 0] as const;

type Encoder = readonly [number, number, number | null, number, number];

// The only characters a browser escapes inside a query string. X-Dynosaur hashes
// the raw query, so URLSearchParams (which escapes far more) breaks the signature.
const MUST_ESCAPE: Record<string, string> = {
  ' ': '%20',
  '"': '%22',
  '<': '%3C',
  '>': '%3E',
  '`': '%60',
  '#': '%23',
};

export interface SignOptions {
  msToken?: string;
  body?: Buffer | string;
  userAgent: string;
  timestamp?: number;
  nonce?: number;
  nonce2?: number;
  sequence?: number;
  sdkVersion?: string;
  scmVersion?: string;
  page?: string;
  envCode?: number;
  ubCode?: number;
}

export interface SignedRequest {
  query: string;
  parameters: Record<string, string>;
}

function escapeQueryComponent(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch in MUST_ESCAPE) {
      out += MUST_ESCAPE[ch];
    } else if (ch > ' ' && ch <= '~') {
      out += ch;
    } else {
      for (const byte of Buffer.from(ch, 'utf8')) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
  }
  return out;
}

export function encodeQuery(pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs.map(([k, v]) => `${escapeQueryComponent(k)}=${escapeQueryComponent(v)}`).join('&');
}

export function hashState(text: string): number {
  let value = FNV_OFFSET;
  for (const byte of Buffer.from(text, 'utf8')) {
    const step = Math.imul(value ^ byte, FNV_PRIME) >>> 0;
    value = (step + Math.imul(step, 32)) >>> 0;
  }
  return value;
}

export function encodeField(text: string, config: Encoder): Buffer {
  const [xorBase, addBase, preXor, rotate, postAdd] = config;
  const chars = Array.from(text);
  const size = Math.max(chars.length + 2, 6);
  const out = Buffer.alloc(size);

  chars.forEach((char, index) => {
    let value = (char.codePointAt(0)! ^ (xorBase + index)) & MASK32;
    value = (value + addBase + (170 & index)) % 256;
    if (preXor !== null) value ^= preXor;
    value = ((value << rotate) | (value >> (8 - rotate))) & 0xff;
    out[index] = ((value ^ 187) + postAdd) % 256;
  });

  for (let index = chars.length; index < size - 2; index++) {
    out[index] = (221 + index) & 0xff;
  }
  out[size - 2] = 0;
  out[size - 1] = chars.length;
  return out;
}

function be(value: number, size: number): Buffer {
  const out = Buffer.alloc(size);
  out.writeUIntBE(value >>> 0, 0, size);
  return out;
}

function le(value: number, size: number): Buffer {
  const out = Buffer.alloc(size);
  out.writeUIntLE(value >>> 0, 0, size);
  return out;
}

export function packPayload(
  fields: ReadonlyMap<number, Buffer>,
  order?: readonly number[],
  leadCount = false,
): Buffer {
  const keys = order ? [...order] : [...fields.keys()].sort((a, b) => a - b);
  const parts: Buffer[] = [];
  for (const key of keys) {
    const value = fields.get(key);
    if (!value) continue;
    parts.push(Buffer.from([key, 0, value.length]), value);
  }
  const body = Buffer.concat(parts);
  return leadCount ? Buffer.concat([Buffer.from([keys.length]), body]) : body;
}

export function mixState(timestamp: number, nonce: number, envCode: number = ENV_CODE): number {
  const folded = ((timestamp >>> 16) ^ (nonce >>> 16) ^ timestamp ^ nonce) & 0xffff;
  return (folded | (envCode << 16)) >>> 0;
}

export function foldChecksum(values: ReadonlyArray<number | string>, mode: number): number {
  let accumulator = MASK32;
  for (const value of values) {
    let number: number;
    if (typeof value === 'string') {
      const raw = Buffer.from(value, 'utf8').subarray(0, 4);
      number = mode === 1 ? 0 : raw.length === 0 ? 0 : raw.readUIntBE(0, raw.length);
    } else {
      number = value;
    }
    accumulator = (accumulator ^ (number >>> 0)) >>> 0;
  }
  return accumulator >>> 0;
}

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function quarterRound(state: number[], a: number, b: number, c: number, d: number): void {
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = (state[d] ^ state[a]) >>> 0;
  state[d] = rotl(state[d], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = (state[b] ^ state[c]) >>> 0;
  state[b] = rotl(state[b], 12);
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = (state[d] ^ state[a]) >>> 0;
  state[d] = rotl(state[d], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = (state[b] ^ state[c]) >>> 0;
  state[b] = rotl(state[b], 7);
}

function keystream(state: readonly number[], rounds: number): number[] {
  const working = [...state];
  let done = 0;
  while (done < rounds) {
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
    done += 1;
    if (done >= rounds) break;
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 12, 13);
    quarterRound(working, 3, 4, 13, 14);
    done += 1;
  }
  return working.map((word, i) => (word + state[i]) >>> 0);
}

function crypt(key: readonly number[], rounds: number, payload: Buffer): Buffer {
  const state = [...CHACHA_INIT, ...key.map((word) => word >>> 0)];
  const length = payload.length;
  const wordCount = Math.ceil(length / 4);
  const words = new Array<number>(wordCount);
  for (let i = 0; i < wordCount; i++) {
    const slice = Buffer.alloc(4);
    payload.copy(slice, 0, i * 4, Math.min(i * 4 + 4, length));
    words[i] = slice.readUInt32LE(0);
  }

  let offset = 0;
  while (offset + 16 < wordCount) {
    const block = keystream(state, rounds);
    state[12] = (state[12] + 1) >>> 0;
    for (let i = 0; i < 16; i++) words[offset + i] = (words[offset + i] ^ block[i]) >>> 0;
    offset += 16;
  }
  const block = keystream(state, rounds);
  for (let i = 0; i < wordCount - offset; i++) {
    words[offset + i] = (words[offset + i] ^ block[i]) >>> 0;
  }

  const out = Buffer.alloc(wordCount * 4);
  words.forEach((word, i) => out.writeUInt32LE(word >>> 0, i * 4));
  return out.subarray(0, length);
}

function toCustomAlphabet(standard: string): string {
  let out = '';
  for (const ch of standard) {
    const index = STANDARD.indexOf(ch);
    out += index >= 0 ? ALPHABET[index] : ch;
  }
  return out;
}

export function seal(payload: Buffer, key: readonly number[]): string {
  const rounds = (key.reduce((sum, word) => sum + (word & 0xf), 0) & 0xf) + 5;
  const ciphertext = crypt(key, rounds, payload);
  const keyBytes = Buffer.concat(key.map((word) => le(word, 4)));
  const position =
    (keyBytes.reduce((a, b) => a + b, 0) + ciphertext.reduce((a, b) => a + b, 0)) %
    (ciphertext.length + 1);
  const spliced = Buffer.concat([
    ciphertext.subarray(0, position),
    keyBytes,
    ciphertext.subarray(position),
  ]);
  return toCustomAlphabet(Buffer.concat([Buffer.from([ENVELOPE_TAG]), spliced]).toString('base64'));
}

// Pure-JS MD5: node:crypto's createHash is not available inside Cloudflare
// Workers, and the signature must be identical in both runtimes.
const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_TABLE = (() => {
  const table = new Uint32Array(64);
  for (let i = 0; i < 64; i++) table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  return table;
})();

export function md5Hex(input: Buffer | string): string {
  const message = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const length = message.length;
  const padded = new Uint8Array((((length + 8) >>> 6) + 1) << 6);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = length * 8;
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const chunk = new Uint32Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) chunk[i] = view.getUint32(offset + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      f = (f + a + MD5_TABLE[i] + chunk[g]) >>> 0;
      a = d; d = c; c = b;
      b = (b + ((f << MD5_SHIFTS[i]) | (f >>> (32 - MD5_SHIFTS[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }

  let hex = '';
  for (const word of [a0, b0, c0, d0]) {
    for (let i = 0; i < 4; i++) hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return hex;
}

function clockNonce(): number {
  return Number((BigInt(Date.now()) * 1000n) & 0xffffffffn);
}

function randomKey(): number[] {
  const bytes = new Uint8Array(KEY_WORDS * 4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(
    { length: KEY_WORDS },
    (_, i) => (bytes[i * 4] | (bytes[i * 4 + 1] << 8) | (bytes[i * 4 + 2] << 16) | (bytes[i * 4 + 3] << 24)) >>> 0,
  );
}

export interface VersionStrings {
  sdkVersion: string;
  scmVersion: string;
}

export function dynosaurPayload(
  query: string,
  userAgent: string,
  options: {
    timestamp: number;
    nonce: number;
    sequence?: number;
    versions?: VersionStrings;
    page?: string;
    envCode?: number;
    ubCode?: number;
  },
): Buffer {
  const { timestamp, nonce, sequence = CALL_SEQUENCE_START } = options;
  const page = options.page ?? DEFAULT_PAGE;
  const { sdkVersion, scmVersion } = options.versions ?? {
    sdkVersion: DEFAULT_SDK_VERSION,
    scmVersion: DEFAULT_SCM_VERSION,
  };

  const fields = new Map<number, Buffer>([
    [0x21, encodeField('1', ENCODER_B as Encoder)],
    [0x22, encodeField('1', ENCODER_B as Encoder)],
    [0x23, encodeField('0', ENCODER_A as Encoder)],
    [0x24, encodeField(String(mixState(timestamp, nonce, options.envCode)), ENCODER_A as Encoder)],
    [0x25, encodeField(String(sequence), ENCODER_A as Encoder)],
    [0x26, encodeField(String(options.envCode ?? ENV_CODE), ENCODER_A as Encoder)],
    [0x27, encodeField(String(timestamp), ENCODER_A as Encoder)],
    [0x28, encodeField(WEBGL_HASH, ENCODER_A as Encoder)],
    [0x29, encodeField('0', ENCODER_A as Encoder)],
    [0x2a, encodeField(sdkVersion, ENCODER_A as Encoder)],
    [0x2b, be(hashState(''), 4)],
    [0x2c, encodeField(CANVAS_HASH, ENCODER_A as Encoder)],
    [0x2d, encodeField('0', ENCODER_A as Encoder)],
    [0x2e, be(hashState(query), 4)],
    [0x2f, encodeField(String(sequence), ENCODER_A as Encoder)],
    [0x30, be(hashState(userAgent), 4)],
    [0x31, encodeField(scmVersion, ENCODER_A as Encoder)],
    [0x32, encodeField(COMPONENT_VERSION, ENCODER_A as Encoder)],
    [0x33, encodeField(DEVICE_HASH, ENCODER_A as Encoder)],
    [0x34, encodeField(String(nonce), ENCODER_A as Encoder)],
    [0x35, encodeField(page, ENCODER_A as Encoder)],
    [0x36, encodeField(String(options.ubCode ?? UB_CODE), ENCODER_A as Encoder)],
    [0x37, encodeField('0', ENCODER_A as Encoder)],
    [0x38, be(VM_STATE_HASH, 4)],
    [0x20, encodeField('0', ENCODER_A as Encoder)],
  ]);

  let checksum = 0;
  for (const key of [...fields.keys()].sort((a, b) => a - b)) {
    checksum ^= fields.get(key)![1];
  }
  fields.set(0x20, encodeField(String(checksum), ENCODER_B as Encoder));

  return packPayload(fields);
}

export function gnarlyFields(
  signedQuery: string,
  userAgent: string,
  options: {
    body?: Buffer | string;
    timestamp: number;
    nonce: number;
    nonce2: number;
    sequence?: number;
    versions?: VersionStrings;
    envCode?: number;
    ubCode?: number;
  },
): Map<number, Buffer> {
  const { timestamp, nonce, nonce2, sequence = CALL_SEQUENCE_START } = options;
  const { sdkVersion, scmVersion } = options.versions ?? {
    sdkVersion: DEFAULT_SDK_VERSION,
    scmVersion: DEFAULT_SCM_VERSION,
  };
  const body = options.body ?? Buffer.alloc(0);

  const queryMd5 = md5Hex(signedQuery);
  const bodyMd5 = md5Hex(body);
  const agentMd5 = md5Hex(userAgent);
  const env = options.envCode ?? ENV_CODE;
  const ub = options.ubCode ?? UB_CODE;
  const mixed = mixState(timestamp, nonce, env);

  const covered: Array<number | string> = [
    0,
    env,
    ub,
    queryMd5,
    bodyMd5,
    agentMd5,
    timestamp,
    0,
    nonce,
    sdkVersion,
    scmVersion,
    CALL_SEQUENCE_START,
    sequence,
    sequence,
    mixed,
    nonce2,
  ];
  const first = foldChecksum(covered, 2);
  const second = foldChecksum([...covered, first], 1);

  return new Map<number, Buffer>([
    [0x00, be(second, 4)],
    [0x01, be(env, 2)],
    [0x02, be(ub, 2)],
    [0x03, Buffer.from(queryMd5, 'ascii')],
    [0x04, Buffer.from(bodyMd5, 'ascii')],
    [0x05, Buffer.from(agentMd5, 'ascii')],
    [0x06, be(timestamp, 4)],
    [0x08, be(nonce, 4)],
    [0x09, Buffer.from(sdkVersion, 'ascii')],
    [0x0a, Buffer.from(scmVersion, 'ascii')],
    [0x0b, be(CALL_SEQUENCE_START, 2)],
    [0x0c, be(sequence, 2)],
    [0x0d, be(sequence, 2)],
    [0x0e, be(mixed, 4)],
    [0x0f, be(nonce2, 4)],
    [0x10, be(first, 4)],
  ]);
}

export function gnarlyPayload(
  signedQuery: string,
  userAgent: string,
  options: Parameters<typeof gnarlyFields>[2] & { order?: readonly number[] },
): Buffer {
  return packPayload(gnarlyFields(signedQuery, userAgent, options), options.order, true);
}

export function signRequest(
  pairs: ReadonlyArray<readonly [string, string]>,
  options: SignOptions,
): SignedRequest {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = options.nonce ?? clockNonce();
  const nonce2 = options.nonce2 ?? ~clockNonce() >>> 0;
  const sequence = options.sequence ?? CALL_SEQUENCE_START;
  const msToken = options.msToken ?? '';
  const versions: VersionStrings = {
    sdkVersion: options.sdkVersion ?? DEFAULT_SDK_VERSION,
    scmVersion: options.scmVersion ?? DEFAULT_SCM_VERSION,
  };

  const query = encodeQuery(pairs);
  const dynosaur = seal(
    dynosaurPayload(query, options.userAgent, {
      timestamp,
      nonce,
      sequence,
      versions,
      page: options.page,
      envCode: options.envCode,
      ubCode: options.ubCode,
    }),
    randomKey(),
  );

  const sealedQuery = `${query}&${DYNOSAUR_PARAM}=${dynosaur}&${MS_TOKEN_PARAM}=${msToken}`;
  const gnarly = seal(
    gnarlyPayload(sealedQuery, options.userAgent, {
      body: options.body,
      timestamp,
      nonce,
      nonce2,
      sequence,
      versions,
    }),
    randomKey(),
  );

  const parameters: Record<string, string> = {
    [DYNOSAUR_PARAM]: dynosaur,
    [MS_TOKEN_PARAM]: msToken,
    [BOGUS_PARAM]: BOGUS_VALUE,
    [GNARLY_PARAM]: gnarly,
  };

  const signed = `${sealedQuery}&${BOGUS_PARAM}=${BOGUS_VALUE}&${GNARLY_PARAM}=${gnarly}`;

  return { query: signed, parameters };
}

export function extractSignatureParameters(signedQuery: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of signedQuery.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq);
    if (key === DYNOSAUR_PARAM || key === GNARLY_PARAM || key === BOGUS_PARAM) {
      out[key] = part.slice(eq + 1);
    }
  }
  return out;
}
