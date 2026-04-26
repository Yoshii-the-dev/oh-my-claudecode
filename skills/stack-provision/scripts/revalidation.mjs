/**
 * Periodic revalidation of installed skills.
 *
 * Phase 4: turns stack-provision from a one-shot installer into a "living
 * system" — every ~7 days (opportunistic, no system cron required) the
 * orchestrator re-checks each installed skill's manifest:
 *
 *   - hash drift: re-hash the on-disk SKILL.md and compare to manifest.
 *   - upstream drift (best-effort): if the manifest carries an `install.url`
 *     pointing at an HTTPS resource, GET it and compare its sha256 to the
 *     manifest. Network failures degrade silently — they do NOT mark the skill
 *     as drifting because that would punish offline runs.
 *
 * State file: `.omc/stack-provision/revalidation.json`
 *
 *   {
 *     schema_version: 1,
 *     last_check_at: ISO8601,
 *     interval_days: 7,
 *     results: [{
 *       slug, install_target, manifest_sha256, current_sha256,
 *       local_drift, upstream: { status, remote_sha256?, error? }
 *     }]
 *   }
 *
 * Public API:
 *   shouldRevalidate({ projectRoot, intervalDays, now, fsImpl }) -> boolean
 *   readRevalidationState({ projectRoot, fsImpl }) -> state
 *   writeRevalidationState(state, { projectRoot, fsImpl })
 *   revalidateManifest({ manifest, projectRoot, fetchImpl, fsImpl, now }) -> report
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const SCHEMA_VERSION = 1;
const DEFAULT_INTERVAL_DAYS = 7;
const FETCH_TIMEOUT_MS = 5000;

function statePath(projectRoot) {
  return path.join(projectRoot, '.omc', 'stack-provision', 'revalidation.json');
}

function emptyState(intervalDays = DEFAULT_INTERVAL_DAYS) {
  return {
    schema_version: SCHEMA_VERSION,
    last_check_at: null,
    interval_days: intervalDays,
    results: [],
  };
}

function sha256OfBuffer(buf) {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

export async function readRevalidationState(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  try {
    const raw = await fsImpl.readFile(statePath(projectRoot), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyState();
    return {
      schema_version: SCHEMA_VERSION,
      last_check_at: parsed.last_check_at ?? null,
      interval_days: Number(parsed.interval_days ?? DEFAULT_INTERVAL_DAYS),
      results: Array.isArray(parsed.results) ? parsed.results : [],
    };
  } catch {
    return emptyState();
  }
}

export async function writeRevalidationState(state, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  const target = statePath(projectRoot);
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  await fsImpl.writeFile(target, JSON.stringify(state, null, 2), 'utf8');
}

export async function shouldRevalidate(options = {}) {
  const intervalDays = Number(options.intervalDays ?? DEFAULT_INTERVAL_DAYS);
  const nowMs = options.now != null ? new Date(options.now).getTime() : Date.now();
  const state = await readRevalidationState(options);
  if (!state.last_check_at) return true;
  const lastMs = Date.parse(state.last_check_at);
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= intervalDays * 86_400_000;
}

async function safeReadFile(filePath, fsImpl) {
  try {
    return await fsImpl.readFile(filePath);
  } catch {
    return null;
  }
}

async function fetchUpstreamSha(url, { fetchImpl, timeoutMs }) {
  if (!url || typeof fetchImpl !== 'function') return { status: 'skipped' };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) {
      return { status: 'unreachable', error: `HTTP ${response.status}` };
    }
    const buf = Buffer.from(await response.arrayBuffer());
    return { status: 'ok', remote_sha256: sha256OfBuffer(buf) };
  } catch (err) {
    return { status: 'unreachable', error: err.message ?? String(err) };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normaliseEntries(manifest) {
  if (!manifest) return [];
  if (Array.isArray(manifest.installed)) return manifest.installed;
  if (Array.isArray(manifest.entries)) return manifest.entries;
  if (Array.isArray(manifest)) return manifest;
  return [];
}

export async function revalidateManifest(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs ?? FETCH_TIMEOUT_MS);
  const nowIso = (options.now instanceof Date
    ? options.now
    : new Date(options.now ?? Date.now())).toISOString();

  const entries = normaliseEntries(options.manifest);
  const results = [];
  let driftCount = 0;
  let upstreamDriftCount = 0;
  for (const entry of entries) {
    const installTarget = entry.install_target ?? entry.target_path ?? null;
    const slug = entry.slug ?? entry.candidate_id ?? null;
    const manifestSha = entry.sha256 ?? entry.expected_sha256 ?? null;
    const upstreamUrl =
      entry.install?.url ??
      entry.install?.source_url ??
      entry.upstream_url ??
      null;
    if (!installTarget) {
      results.push({ slug, status: 'skipped', reason: 'no install_target' });
      continue;
    }
    const fullPath = path.isAbsolute(installTarget)
      ? installTarget
      : path.join(projectRoot, installTarget);
    const buf = await safeReadFile(fullPath, fsImpl);
    if (!buf) {
      results.push({
        slug,
        install_target: installTarget,
        status: 'missing',
        manifest_sha256: manifestSha,
      });
      driftCount += 1;
      continue;
    }
    const currentSha = sha256OfBuffer(buf);
    const localDrift = manifestSha != null && currentSha !== manifestSha;
    if (localDrift) driftCount += 1;
    const upstream = upstreamUrl
      ? await fetchUpstreamSha(upstreamUrl, { fetchImpl, timeoutMs })
      : { status: 'skipped' };
    if (upstream.status === 'ok' && upstream.remote_sha256 && manifestSha
        && upstream.remote_sha256 !== manifestSha) {
      upstreamDriftCount += 1;
    }
    results.push({
      slug,
      install_target: installTarget,
      manifest_sha256: manifestSha,
      current_sha256: currentSha,
      local_drift: localDrift,
      upstream,
    });
  }
  return {
    schema_version: SCHEMA_VERSION,
    last_check_at: nowIso,
    interval_days: Number(options.intervalDays ?? DEFAULT_INTERVAL_DAYS),
    results,
    summary: {
      total: results.length,
      local_drift: driftCount,
      upstream_drift: upstreamDriftCount,
    },
  };
}

export const REVALIDATION_DEFAULTS = Object.freeze({
  SCHEMA_VERSION,
  DEFAULT_INTERVAL_DAYS,
  FETCH_TIMEOUT_MS,
});
