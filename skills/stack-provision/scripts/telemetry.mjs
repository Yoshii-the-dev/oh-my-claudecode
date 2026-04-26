/**
 * Skill usage telemetry.
 *
 * Phase 4: tracks which provisioned skills the user actually installs and
 * touches over time so auto-cleanup can propose deprecation of long-unused
 * skills (interactive prompt only — never silent delete).
 *
 * Storage: `.omc/stack-provision/usage.json`. The file is small, append-light,
 * and bounded — we keep at most `MAX_EVENTS_PER_SKILL` recent events per slug
 * to avoid unbounded growth across years of use.
 *
 * Schema (v1):
 *   {
 *     schema_version: 1,
 *     updated_at:     ISO8601,
 *     skills: {
 *       <slug>: {
 *         first_used_at: ISO8601,
 *         last_used_at:  ISO8601,
 *         use_count:     number,
 *         events: [{ at: ISO8601, kind: 'install'|'reuse'|'verify' }]
 *       }
 *     }
 *   }
 *
 * Public API:
 *   readUsage({ projectRoot, fsImpl }) -> usage
 *   writeUsage(usage, { projectRoot, fsImpl })
 *   recordUsage({ projectRoot, slug, kind, now, fsImpl })
 *   recordBatch(slugs, { projectRoot, kind, now, fsImpl })
 *   findUnusedSkills(usage, { thresholdDays, now })
 *   summarizeUsage(usage)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_VERSION = 1;
const MAX_EVENTS_PER_SKILL = 50;
const VALID_KINDS = new Set(['install', 'reuse', 'verify', 'cleanup-deferred']);

function usagePath(projectRoot) {
  return path.join(projectRoot, '.omc', 'stack-provision', 'usage.json');
}

function emptyUsage() {
  return {
    schema_version: SCHEMA_VERSION,
    updated_at: new Date(0).toISOString(),
    skills: {},
  };
}

export async function readUsage(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  try {
    const raw = await fsImpl.readFile(usagePath(projectRoot), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.skills) return emptyUsage();
    if (parsed.schema_version !== SCHEMA_VERSION) {
      // Forward-compat stub: keep skills object, drop unrecognised top-level fields.
      return {
        schema_version: SCHEMA_VERSION,
        updated_at: parsed.updated_at ?? emptyUsage().updated_at,
        skills: parsed.skills && typeof parsed.skills === 'object' ? parsed.skills : {},
      };
    }
    return parsed;
  } catch {
    return emptyUsage();
  }
}

export async function writeUsage(usage, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const fsImpl = options.fsImpl ?? fs;
  const target = usagePath(projectRoot);
  await fsImpl.mkdir(path.dirname(target), { recursive: true });
  await fsImpl.writeFile(target, JSON.stringify(usage, null, 2), 'utf8');
}

function normaliseKind(kind) {
  const k = String(kind ?? 'install').toLowerCase();
  return VALID_KINDS.has(k) ? k : 'install';
}

export function applyUsageRecord(usage, { slug, kind, now }) {
  if (!slug || typeof slug !== 'string') return usage;
  const safeNow = now instanceof Date ? now.toISOString() : new Date(now ?? Date.now()).toISOString();
  const next = {
    ...usage,
    schema_version: SCHEMA_VERSION,
    updated_at: safeNow,
    skills: { ...(usage.skills ?? {}) },
  };
  const existing = next.skills[slug] ?? {
    first_used_at: safeNow,
    last_used_at: safeNow,
    use_count: 0,
    events: [],
  };
  const validKind = normaliseKind(kind);
  const events = [...(existing.events ?? []), { at: safeNow, kind: validKind }];
  while (events.length > MAX_EVENTS_PER_SKILL) events.shift();
  next.skills[slug] = {
    first_used_at: existing.first_used_at ?? safeNow,
    last_used_at: safeNow,
    use_count: (existing.use_count ?? 0) + 1,
    events,
  };
  return next;
}

export async function recordUsage(options = {}) {
  const usage = await readUsage(options);
  const updated = applyUsageRecord(usage, {
    slug: options.slug,
    kind: options.kind,
    now: options.now,
  });
  await writeUsage(updated, options);
  return updated;
}

export async function recordBatch(slugs, options = {}) {
  const list = Array.isArray(slugs) ? slugs.filter((s) => typeof s === 'string' && s) : [];
  if (list.length === 0) return readUsage(options);
  let usage = await readUsage(options);
  for (const slug of list) {
    usage = applyUsageRecord(usage, {
      slug,
      kind: options.kind,
      now: options.now,
    });
  }
  await writeUsage(usage, options);
  return usage;
}

export function findUnusedSkills(usage, options = {}) {
  const thresholdDays = Number(options.thresholdDays ?? 60);
  const nowMs = options.now != null ? new Date(options.now).getTime() : Date.now();
  const cutoffMs = nowMs - thresholdDays * 86_400_000;
  const skills = usage?.skills ?? {};
  const result = [];
  for (const [slug, entry] of Object.entries(skills)) {
    const lastMs = entry?.last_used_at ? Date.parse(entry.last_used_at) : NaN;
    if (!Number.isFinite(lastMs)) {
      // Treat unknown last-used as candidate for cleanup if older than threshold.
      result.push({ slug, last_used_at: null, idle_days: null, use_count: entry?.use_count ?? 0 });
      continue;
    }
    if (lastMs < cutoffMs) {
      const idleDays = Math.floor((nowMs - lastMs) / 86_400_000);
      result.push({
        slug,
        last_used_at: entry.last_used_at,
        idle_days: idleDays,
        use_count: entry.use_count ?? 0,
      });
    }
  }
  result.sort((a, b) => (b.idle_days ?? 0) - (a.idle_days ?? 0));
  return result;
}

export function summarizeUsage(usage) {
  const skills = usage?.skills ?? {};
  const slugs = Object.keys(skills);
  let totalUses = 0;
  let mostRecent = null;
  for (const [slug, entry] of Object.entries(skills)) {
    totalUses += entry.use_count ?? 0;
    const ms = entry.last_used_at ? Date.parse(entry.last_used_at) : NaN;
    if (Number.isFinite(ms) && (mostRecent == null || ms > mostRecent.ms)) {
      mostRecent = { slug, ms, last_used_at: entry.last_used_at };
    }
  }
  return {
    schema_version: SCHEMA_VERSION,
    skill_count: slugs.length,
    total_uses: totalUses,
    most_recent: mostRecent
      ? { slug: mostRecent.slug, last_used_at: mostRecent.last_used_at }
      : null,
  };
}

export const TELEMETRY_DEFAULTS = Object.freeze({
  SCHEMA_VERSION,
  MAX_EVENTS_PER_SKILL,
  DEFAULT_INACTIVITY_DAYS: 60,
});
