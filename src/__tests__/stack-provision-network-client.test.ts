/**
 * stack-provision network-client.
 *
 * The motivating regression: skills.sh discovery was tripping its 30 rpm limit
 * (`HTTP 429: rate_limit_exceeded`) and the discovery code had no retry, no
 * shared rate-limit, no cache, no concurrency cap, and no API-key injection.
 * `network-client.mjs` is the single chokepoint that fixes all five at once;
 * these tests pin the contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NETWORK = path.join(REPO_ROOT, 'skills/stack-provision/scripts/network-client.mjs');

const network = await import(`${NETWORK}`);
const {
  NetworkClient,
  HostBucket,
  retryWaitMs,
  resetDefaultClientForTests,
} = network as any;

function mockResponse({
  status = 200,
  body = '',
  headers = {} as Record<string, string>,
} = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

beforeEach(() => {
  resetDefaultClientForTests();
});

describe('HostBucket', () => {
  it('hands out tokens up to rpm and refills over time', async () => {
    const bucket = new HostBucket(60, 4);
    bucket.refill();
    expect(bucket.tokens).toBeGreaterThan(0);
    // Drain the bucket synchronously.
    for (let i = 0; i < 60; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await bucket.acquire();
      bucket.release();
    }
    bucket.refill();
    // Tokens should be near zero (some elapsed millis may have refilled a sliver).
    expect(bucket.tokens).toBeLessThan(2);
  });
});

describe('retryWaitMs', () => {
  it('honors numeric Retry-After (seconds)', () => {
    const res = { headers: { get: (k: string) => (k === 'retry-after' ? '2' : null) } };
    expect(retryWaitMs(res, 1)).toBe(2000);
  });

  it('falls back to exponential backoff when no Retry-After is present', () => {
    const res = { headers: { get: () => null } };
    const wait = retryWaitMs(res, 2);
    // Base 500ms * 2^1 = 1000 + jitter [0,250) → wait between 1000 and 1250.
    expect(wait).toBeGreaterThanOrEqual(1000);
    expect(wait).toBeLessThan(1300);
  });

  it('caps the backoff at retryMaxBackoffMs', () => {
    const res = { headers: { get: () => null } };
    const wait = retryWaitMs(res, 20);
    expect(wait).toBeLessThanOrEqual(60_000);
  });
});

describe('NetworkClient — retry on 429', () => {
  it('retries until success and honors Retry-After', async () => {
    const calls: number[] = [];
    const sleeps: number[] = [];
    const fetchImpl = async () => {
      calls.push(Date.now());
      if (calls.length === 1) {
        return mockResponse({ status: 429, headers: { 'retry-after': '0.05' }, body: 'rate' });
      }
      return mockResponse({ status: 200, body: '{"ok":true}' });
    };
    const client = new NetworkClient({
      fetchImpl,
      sleepImpl: async (ms: number) => { sleeps.push(ms); },
      disableCache: true,
    });
    const out = await client.fetchJson('https://example.com/api');
    expect(out).toEqual({ ok: true });
    expect(calls.length).toBe(2);
    expect(sleeps).toEqual([50]);
  });

  it('throws after retryMax exhaustion', async () => {
    const fetchImpl = async () =>
      mockResponse({ status: 429, headers: { 'retry-after': '0.01' }, body: 'always-rate-limited' });
    const sleeps: number[] = [];
    const client = new NetworkClient({
      fetchImpl,
      sleepImpl: async (ms: number) => { sleeps.push(ms); },
      disableCache: true,
      retryMax: 2,
    });
    await expect(client.fetchText('https://example.com/api')).rejects.toThrow(/HTTP 429/);
    // Two retries before the third call surfaces the failure.
    expect(sleeps.length).toBe(2);
  });
});

describe('NetworkClient — retry on 5xx', () => {
  it('retries on transient 503 then succeeds', async () => {
    let n = 0;
    const fetchImpl = async () => {
      n += 1;
      if (n < 2) return mockResponse({ status: 503, body: 'unavailable' });
      return mockResponse({ status: 200, body: 'ok' });
    };
    const client = new NetworkClient({
      fetchImpl,
      sleepImpl: async () => { /* no-op */ },
      disableCache: true,
    });
    const text = await client.fetchText('https://example.com/api');
    expect(text).toBe('ok');
    expect(n).toBe(2);
  });
});

describe('NetworkClient — concurrency cap and dedup', () => {
  it('deduplicates identical concurrent fetches', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      // Simulate latency so concurrent callers all see the same in-flight promise.
      await new Promise((r) => setTimeout(r, 10));
      return mockResponse({ status: 200, body: '{"hit":true}' });
    };
    const client = new NetworkClient({ fetchImpl, disableCache: true });
    const [a, b, c] = await Promise.all([
      client.fetchJson('https://example.com/api'),
      client.fetchJson('https://example.com/api'),
      client.fetchJson('https://example.com/api'),
    ]);
    expect(a).toEqual({ hit: true });
    expect(b).toEqual({ hit: true });
    expect(c).toEqual({ hit: true });
    expect(calls).toBe(1);
  });
});

describe('NetworkClient — disk cache', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'omc-net-'));
  });

  it('serves cached responses without a network call on second fetch', async () => {
    const cachePath = path.join(tmpDir, 'cache.json');
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return mockResponse({ status: 200, body: '{"v":1}' });
    };
    const client = new NetworkClient({ fetchImpl, cachePath, cacheTtlMs: 60_000 });
    await client.fetchJson('https://example.com/api');
    await client.flush();
    await client.fetchJson('https://example.com/api');
    expect(calls).toBe(1);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('skips the cache when disableCache=true', async () => {
    const cachePath = path.join(tmpDir, 'cache.json');
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return mockResponse({ status: 200, body: '{"v":1}' });
    };
    const client = new NetworkClient({ fetchImpl, cachePath, cacheTtlMs: 60_000, disableCache: true });
    await client.fetchJson('https://example.com/api');
    await client.fetchJson('https://example.com/api');
    expect(calls).toBe(2);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('expires cache entries past TTL', async () => {
    const cachePath = path.join(tmpDir, 'cache.json');
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return mockResponse({ status: 200, body: `{"call":${calls}}` });
    };
    const client = new NetworkClient({ fetchImpl, cachePath, cacheTtlMs: 1 });
    await client.fetchJson('https://example.com/api');
    await client.flush();
    // Sleep just past the 1ms TTL.
    await new Promise((r) => setTimeout(r, 25));
    await client.fetchJson('https://example.com/api');
    expect(calls).toBe(2);
    await rm(tmpDir, { recursive: true, force: true });
  });
});

describe('NetworkClient — API-key injection', () => {
  it('reads token from configured env var into Authorization header (Bearer default)', async () => {
    process.env.OMC_TEST_TOKEN = 'super-secret';
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchImpl = async (_url: string, init: any) => {
      seenHeaders.push({ ...(init.headers || {}) });
      return mockResponse({ status: 200, body: 'ok' });
    };
    const client = new NetworkClient({ fetchImpl, disableCache: true });
    client.configureHost('example.com', { api_key_env: 'OMC_TEST_TOKEN' });
    await client.fetchText('https://example.com/api');
    expect(seenHeaders[0].authorization).toBe('Bearer super-secret');
    delete process.env.OMC_TEST_TOKEN;
  });

  it('honors a non-Bearer auth_header_template (e.g. X-API-Key)', async () => {
    process.env.OMC_TEST_TOKEN = 'secret-2';
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchImpl = async (_url: string, init: any) => {
      seenHeaders.push({ ...(init.headers || {}) });
      return mockResponse({ status: 200, body: 'ok' });
    };
    const client = new NetworkClient({ fetchImpl, disableCache: true });
    client.configureHost('example.com', {
      api_key_env: 'OMC_TEST_TOKEN',
      auth_header_template: 'X-API-Key: {token}',
    });
    await client.fetchText('https://example.com/api');
    expect(seenHeaders[0]['x-api-key']).toBe('secret-2');
    expect(seenHeaders[0].authorization).toBeUndefined();
    delete process.env.OMC_TEST_TOKEN;
  });

  it('omits auth header when env var is not set', async () => {
    delete process.env.OMC_TEST_TOKEN_MISSING;
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchImpl = async (_url: string, init: any) => {
      seenHeaders.push({ ...(init.headers || {}) });
      return mockResponse({ status: 200, body: 'ok' });
    };
    const client = new NetworkClient({ fetchImpl, disableCache: true });
    client.configureHost('example.com', { api_key_env: 'OMC_TEST_TOKEN_MISSING' });
    await client.fetchText('https://example.com/api');
    expect(seenHeaders[0].authorization).toBeUndefined();
    expect(seenHeaders[0]['x-api-key']).toBeUndefined();
  });
});

describe('NetworkClient — registry config wiring', () => {
  it('configureRegistry applies rate-limit + auth to all listed domains', async () => {
    process.env.OMC_REG_TOKEN = 'reg-token';
    const seenHeaders: Array<Record<string, string>> = [];
    const fetchImpl = async (_url: string, init: any) => {
      seenHeaders.push({ ...(init.headers || {}) });
      return mockResponse({ status: 200, body: 'ok' });
    };
    const client = new NetworkClient({ fetchImpl, disableCache: true });
    client.configureRegistry({
      id: 'demo',
      domains: ['demo.example.com', 'demo-cdn.example.com'],
      rate_limit_rpm: 120,
      concurrency: 8,
      api_key_env: 'OMC_REG_TOKEN',
      auth_header_template: 'Token {token}',
    });
    await client.fetchText('https://demo.example.com/a');
    await client.fetchText('https://demo-cdn.example.com/b');
    expect(seenHeaders[0].authorization).toBe('Token reg-token');
    expect(seenHeaders[1].authorization).toBe('Token reg-token');
    delete process.env.OMC_REG_TOKEN;
  });
});
