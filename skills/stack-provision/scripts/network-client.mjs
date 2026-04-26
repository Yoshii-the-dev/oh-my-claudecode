/**
 * stack-provision network client.
 *
 * Centralised HTTP layer for every external discovery and download in the
 * provisioner. Bare `fetch` calls scattered across discovery adapters cannot
 * coordinate rate-limits, share an auth header, retry on 429, deduplicate
 * concurrent requests for the same URL, or cache responses across runs —
 * which is why skills.sh discovery routinely tripped its 30 rpm limit and
 * came back with `HTTP 429 rate_limit_exceeded` for half the queries.
 *
 * Responsibilities:
 *   - Per-host token-bucket rate limiter (rpm) + concurrency cap.
 *   - Retry on 429 (honoring the `Retry-After` header) and 5xx (exponential
 *     backoff capped at 60s, max 3 attempts per URL).
 *   - In-flight request dedup: identical concurrent fetches share one Promise.
 *   - Optional disk cache keyed by URL with configurable TTL (default 6h),
 *     stored under .omc/stack-provision/discovery-cache.json.
 *   - API-key injection driven by registry config (api_key_env +
 *     auth_header_template); zero secrets in repo, env vars only.
 *
 * The module exposes both a class (NetworkClient) for direct construction in
 * tests and a process-wide singleton accessor (`getDefaultClient`,
 * `configureDefaultClient`) so legacy `fetchJson`/`fetchText` helpers in
 * `provision.mjs` can delegate to it without rewiring every call site.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';

const HARD_DEFAULTS = Object.freeze({
  rateLimitRpm: 30,
  concurrency: 4,
  retryMax: 3,
  retryBaseMs: 500,
  retryMaxBackoffMs: 60_000,
  cacheTtlMs: 6 * 60 * 60 * 1000, // 6h
  timeoutMs: 30_000,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clipBody(body) {
  return String(body || '').replace(/\s+/g, ' ').trim().slice(0, 280);
}

function isGitHubHost(host) {
  return host === 'github.com' || host === 'api.github.com' || host === 'raw.githubusercontent.com';
}

let cachedGitHubFallbackToken;
function githubFallbackToken() {
  if (cachedGitHubFallbackToken !== undefined) return cachedGitHubFallbackToken;
  const env = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (env || process.env.STACK_PROVISION_DISABLE_GH_AUTH_TOKEN === '1') {
    cachedGitHubFallbackToken = env;
    return env;
  }
  try {
    cachedGitHubFallbackToken = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
  } catch {
    cachedGitHubFallbackToken = '';
  }
  return cachedGitHubFallbackToken;
}

function _resetGitHubFallbackTokenForTests() {
  cachedGitHubFallbackToken = undefined;
}

class HostBucket {
  constructor(rpm, concurrency) {
    this.rpm = Math.max(1, rpm);
    this.tokens = this.rpm;
    this.lastRefill = Date.now();
    this.concurrency = Math.max(1, concurrency);
    this.inFlight = 0;
  }

  refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const refill = (elapsed / 60_000) * this.rpm;
    if (refill > 0) {
      this.tokens = Math.min(this.rpm, this.tokens + refill);
      this.lastRefill = now;
    }
  }

  async acquire() {
    while (true) {
      this.refill();
      if (this.tokens >= 1 && this.inFlight < this.concurrency) {
        this.tokens -= 1;
        this.inFlight += 1;
        return;
      }
      const waitForToken = this.tokens < 1
        ? Math.ceil((1 - this.tokens) * 60_000 / this.rpm)
        : 0;
      const waitForSlot = this.inFlight >= this.concurrency ? 50 : 0;
      const wait = Math.max(20, waitForToken, waitForSlot);
      await sleep(wait);
    }
  }

  release() {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }
}

class DiskCache {
  constructor({ path, ttlMs }) {
    this.path = path || null;
    this.ttlMs = Math.max(0, ttlMs ?? HARD_DEFAULTS.cacheTtlMs);
    this.mem = null;
    this.dirty = false;
    this.flushTimer = null;
  }

  async _load() {
    if (this.mem !== null || !this.path) return;
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      this.mem = parsed && typeof parsed === 'object' && parsed.entries ? parsed : { entries: {} };
    } catch {
      this.mem = { entries: {} };
    }
  }

  async get(key) {
    if (!this.path || this.ttlMs === 0) return null;
    await this._load();
    const entry = this.mem.entries[key];
    if (!entry) return null;
    if (Date.now() - entry.t > this.ttlMs) {
      delete this.mem.entries[key];
      this._scheduleFlush();
      return null;
    }
    return entry.body;
  }

  async set(key, body) {
    if (!this.path || this.ttlMs === 0) return;
    await this._load();
    this.mem.entries[key] = { t: Date.now(), body };
    this._scheduleFlush();
  }

  _scheduleFlush() {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => { /* best-effort */ });
    }, 200);
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  async flush() {
    if (!this.path || !this.dirty || this.mem === null) return;
    this.dirty = false;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.mem), 'utf8');
  }
}

class NetworkClient {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? HARD_DEFAULTS.timeoutMs;
    this.retryMax = options.retryMax ?? HARD_DEFAULTS.retryMax;
    this.disableCache = options.disableCache === true;
    this.cache = new DiskCache({
      path: options.cachePath || null,
      ttlMs: options.cacheTtlMs ?? HARD_DEFAULTS.cacheTtlMs,
    });
    this.hostConfigs = new Map(); // host -> { rateLimitRpm, concurrency, apiKeyEnv, authHeaderTemplate, cacheTtlMs }
    this.buckets = new Map(); // host -> HostBucket
    this.deduper = new Map(); // url -> Promise
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.sleepImpl = options.sleepImpl || sleep;
  }

  configureHost(host, config = {}) {
    const normalized = String(host || '').toLowerCase().trim();
    if (!normalized) return;
    const merged = {
      rateLimitRpm: Number(config.rateLimitRpm ?? config.rate_limit_rpm ?? HARD_DEFAULTS.rateLimitRpm),
      concurrency: Number(config.concurrency ?? HARD_DEFAULTS.concurrency),
      apiKeyEnv: String(config.apiKeyEnv ?? config.api_key_env ?? '').trim() || null,
      authHeaderTemplate: String(
        config.authHeaderTemplate ?? config.auth_header_template ?? 'Bearer {token}',
      ),
      cacheTtlMs: typeof (config.cacheTtlMs ?? config.cache_ttl_seconds) === 'number'
        ? (config.cacheTtlMs ?? config.cache_ttl_seconds * 1000)
        : null,
    };
    this.hostConfigs.set(normalized, merged);
    // Reset bucket so the new rpm/concurrency take effect immediately.
    this.buckets.delete(normalized);
  }

  configureRegistry(registry) {
    if (!registry || typeof registry !== 'object') return;
    const hosts = Array.isArray(registry.domains) ? registry.domains : [];
    for (const host of hosts) {
      this.configureHost(host, {
        rate_limit_rpm: registry.rate_limit_rpm,
        concurrency: registry.concurrency,
        api_key_env: registry.api_key_env,
        auth_header_template: registry.auth_header_template,
        cache_ttl_seconds: registry.cache_ttl_seconds,
      });
    }
  }

  async fetchText(url, opts = {}) {
    const cacheKey = !this.disableCache && opts.cache !== false ? url : null;
    if (cacheKey) {
      const hit = await this.cache.get(cacheKey);
      if (hit !== null) return hit;
    }
    if (this.deduper.has(url)) return this.deduper.get(url);
    const work = this._fetchTextRaw(url, opts).finally(() => {
      this.deduper.delete(url);
    });
    this.deduper.set(url, work);
    const text = await work;
    if (cacheKey) {
      await this.cache.set(cacheKey, text);
    }
    return text;
  }

  async fetchJson(url, opts = {}) {
    const text = await this.fetchText(url, opts);
    return JSON.parse(text);
  }

  async _fetchTextRaw(url, opts) {
    const host = this._hostOf(url);
    const cfg = this._resolveHostConfig(host);
    const bucket = this._getBucket(host, cfg);
    const headers = this._buildHeaders(url, host, cfg, opts.headers);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;

    let attempt = 0;
    while (true) {
      await bucket.acquire();
      let response;
      let body = '';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          response = await this.fetchImpl(url, {
            signal: controller.signal,
            headers,
            method: opts.method || 'GET',
          });
          if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
            attempt += 1;
            if (attempt > this.retryMax) {
              body = await response.text().catch(() => '');
              throw new Error(formatHttpError(url, response.status, body));
            }
            const wait = retryWaitMs(response, attempt);
            // Release the slot before sleeping so other waiters can proceed.
            bucket.release();
            await this.sleepImpl(wait);
            continue;
          }
          if (!response.ok) {
            body = await response.text().catch(() => '');
            throw new Error(formatHttpError(url, response.status, body));
          }
          return await response.text();
        } finally {
          clearTimeout(timer);
        }
      } finally {
        // Only release here if we actually finished (returned text or threw).
        // The 429/5xx retry path released early before sleeping.
        if (response && response.status !== 429 && !(response.status >= 500 && response.status < 600)) {
          bucket.release();
        } else if (!response) {
          bucket.release();
        }
      }
    }
  }

  _hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  _getBucket(host, cfg) {
    let bucket = this.buckets.get(host);
    if (!bucket) {
      bucket = new HostBucket(cfg.rateLimitRpm, cfg.concurrency);
      this.buckets.set(host, bucket);
    }
    return bucket;
  }

  _resolveHostConfig(host) {
    const cfg = this.hostConfigs.get(host);
    if (cfg) return cfg;
    return {
      rateLimitRpm: HARD_DEFAULTS.rateLimitRpm,
      concurrency: HARD_DEFAULTS.concurrency,
      apiKeyEnv: null,
      authHeaderTemplate: 'Bearer {token}',
      cacheTtlMs: null,
    };
  }

  _buildHeaders(url, host, cfg, extra) {
    const headers = { accept: 'application/json,text/plain,*/*', ...(extra || {}) };

    // Configured registry auth wins over GitHub fallback.
    let token = '';
    if (cfg.apiKeyEnv) {
      token = String(process.env[cfg.apiKeyEnv] || '').trim();
    }
    if (!token && isGitHubHost(host)) {
      token = githubFallbackToken();
    }
    if (token) {
      const tpl = cfg.authHeaderTemplate || 'Bearer {token}';
      const value = tpl.replace('{token}', token);
      const colon = value.indexOf(':');
      if (colon > 0 && /^[A-Za-z][A-Za-z0-9-]*:/.test(value)) {
        const headerName = value.slice(0, colon).trim().toLowerCase();
        const headerValue = value.slice(colon + 1).trim();
        if (headerName) headers[headerName] = headerValue;
      } else {
        headers.authorization = value;
      }
    }

    if (host === 'api.github.com') {
      headers['x-github-api-version'] = '2022-11-28';
    }
    return headers;
  }

  async flush() {
    await this.cache.flush();
  }
}

function retryWaitMs(response, attempt) {
  try {
    const ra = response.headers.get('retry-after');
    if (ra) {
      const seconds = Number(ra);
      if (Number.isFinite(seconds)) {
        return Math.min(Math.max(0, seconds * 1000), HARD_DEFAULTS.retryMaxBackoffMs);
      }
      const ts = Date.parse(ra);
      if (Number.isFinite(ts)) {
        return Math.max(0, Math.min(ts - Date.now(), HARD_DEFAULTS.retryMaxBackoffMs));
      }
    }
  } catch {
    // headers.get may not exist on minimal mock responses; fall through.
  }
  const expo = HARD_DEFAULTS.retryBaseMs * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(expo + jitter, HARD_DEFAULTS.retryMaxBackoffMs);
}

function formatHttpError(url, status, body) {
  let message = `HTTP ${status}`;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* ignore */
  }
  if (status === 429) {
    message += ` rate-limited at ${host || url}; retry exhausted`;
  } else if (status === 403 && (host === 'api.github.com' || host === 'github.com')) {
    message += githubFallbackToken()
      ? ' (GitHub API denied the authenticated request; check token scopes or rate limits)'
      : ' (GitHub API unauthenticated or rate-limited; set GITHUB_TOKEN/GH_TOKEN or run gh auth login)';
  }
  const clipped = clipBody(body);
  return clipped ? `${message}: ${clipped}` : message;
}

let defaultClient = null;

function getDefaultClient() {
  if (!defaultClient) {
    defaultClient = new NetworkClient();
  }
  return defaultClient;
}

function configureDefaultClient(options = {}) {
  defaultClient = new NetworkClient(options);
  return defaultClient;
}

function resetDefaultClientForTests() {
  defaultClient = null;
  _resetGitHubFallbackTokenForTests();
}

export {
  NetworkClient,
  HostBucket,
  DiskCache,
  HARD_DEFAULTS,
  retryWaitMs,
  formatHttpError,
  getDefaultClient,
  configureDefaultClient,
  resetDefaultClientForTests,
};
