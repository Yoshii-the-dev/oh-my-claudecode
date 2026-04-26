/**
 * Auto-cleanup deprecation candidates.
 *
 * Phase 4: identifies skills that have not been used in N days (default 60)
 * and proposes them for removal. The orchestrator never deletes silently —
 * the operator gets a structured proposal and must explicitly approve.
 *
 * This module is glue around `telemetry.findUnusedSkills` and the most recent
 * provision manifest, plus a helper to defer cleanup (record `cleanup-deferred`
 * usage event so the same skill is not re-proposed on every run).
 *
 * Public API:
 *   findCleanupCandidates({ projectRoot, manifestPath, thresholdDays, now, fsImpl })
 *     -> { candidates: Array<{slug, last_used_at, idle_days, install_target}>,
 *          summary: {…}, suggestion: 'prompt'|'noop' }
 *   deferCleanup(slugs, { projectRoot, fsImpl, now }) -> usage
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  readUsage,
  recordBatch,
  findUnusedSkills,
  TELEMETRY_DEFAULTS,
} from './telemetry.mjs';

function defaultManifestPath(projectRoot) {
  return path.join(projectRoot, '.omc', 'provisioned', 'current.json');
}

async function readJsonSafe(filePath, fsImpl) {
  try {
    const raw = await fsImpl.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function manifestEntries(manifest) {
  if (!manifest) return [];
  if (Array.isArray(manifest.installed)) return manifest.installed;
  if (Array.isArray(manifest.entries)) return manifest.entries;
  if (Array.isArray(manifest.runs)) {
    // current.json shape — flatten any installed lists across runs.
    return manifest.runs.flatMap((r) =>
      Array.isArray(r?.installed) ? r.installed : [],
    );
  }
  if (Array.isArray(manifest)) return manifest;
  return [];
}

function indexByCandidate(entries) {
  const bySlug = new Map();
  for (const entry of entries) {
    const slug = entry.slug ?? entry.candidate_id ?? null;
    if (!slug) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, entry);
  }
  return bySlug;
}

export async function findCleanupCandidates(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  const thresholdDays = Number(
    options.thresholdDays ?? TELEMETRY_DEFAULTS.DEFAULT_INACTIVITY_DAYS,
  );
  const now = options.now ?? Date.now();

  const usage = await readUsage({ projectRoot, fsImpl });
  const idle = findUnusedSkills(usage, { thresholdDays, now });
  if (idle.length === 0) {
    return {
      candidates: [],
      summary: {
        threshold_days: thresholdDays,
        idle_count: 0,
        with_install_target: 0,
      },
      suggestion: 'noop',
    };
  }

  const manifestPath = options.manifestPath ?? defaultManifestPath(projectRoot);
  const manifest = await readJsonSafe(manifestPath, fsImpl);
  const installIndex = indexByCandidate(manifestEntries(manifest));

  const candidates = idle.map((entry) => {
    const install = installIndex.get(entry.slug);
    return {
      slug: entry.slug,
      last_used_at: entry.last_used_at,
      idle_days: entry.idle_days,
      use_count: entry.use_count,
      install_target: install?.install_target ?? install?.target_path ?? null,
      manifest_sha256: install?.sha256 ?? install?.expected_sha256 ?? null,
    };
  });
  const withTargets = candidates.filter((c) => c.install_target).length;

  return {
    candidates,
    summary: {
      threshold_days: thresholdDays,
      idle_count: candidates.length,
      with_install_target: withTargets,
    },
    suggestion: candidates.length > 0 ? 'prompt' : 'noop',
  };
}

export async function deferCleanup(slugs, options = {}) {
  return recordBatch(slugs, {
    ...options,
    kind: 'cleanup-deferred',
  });
}

export const AUTO_CLEANUP_DEFAULTS = Object.freeze({
  DEFAULT_THRESHOLD_DAYS: TELEMETRY_DEFAULTS.DEFAULT_INACTIVITY_DAYS,
});
