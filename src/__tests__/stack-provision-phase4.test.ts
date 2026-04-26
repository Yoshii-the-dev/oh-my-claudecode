/**
 * Phase 4 tests for stack-provision maintenance layer:
 *   - telemetry.mjs       (per-skill usage counters, unused detection)
 *   - revalidation.mjs    (opportunistic cron + manifest re-hash)
 *   - cve-feed.mjs        (OSV.dev adapter + severity classification)
 *   - auto-cleanup.mjs    (deprecation proposals based on telemetry)
 *   - orchestrate.mjs::annotateCveFlags + persistTelemetryForApproved
 *
 * All network calls are stubbed via fetchImpl/fsImpl; no real HTTP and no
 * real ~/.claude scans during tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'skills/stack-provision/scripts');

const telemetry = await import(`${path.join(SCRIPTS, 'telemetry.mjs')}`);
const revalidation = await import(`${path.join(SCRIPTS, 'revalidation.mjs')}`);
const cveFeed = await import(`${path.join(SCRIPTS, 'cve-feed.mjs')}`);
const autoCleanup = await import(`${path.join(SCRIPTS, 'auto-cleanup.mjs')}`);

const {
  readUsage,
  writeUsage,
  recordUsage,
  recordBatch,
  applyUsageRecord,
  findUnusedSkills,
  summarizeUsage,
  TELEMETRY_DEFAULTS,
} = telemetry;
const {
  shouldRevalidate,
  readRevalidationState,
  writeRevalidationState,
  revalidateManifest,
  REVALIDATION_DEFAULTS,
} = revalidation;
const {
  parsePackagesFromCandidate,
  classifyAdvisorySeverity,
  gatherCveSignals,
  CVE_DEFAULTS,
} = cveFeed;
const { findCleanupCandidates, deferCleanup } = autoCleanup;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omc-stack-p4-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── telemetry ───────────────────────────────────────────────────────────────

describe('telemetry: applyUsageRecord', () => {
  it('initialises a fresh entry on first record', () => {
    const empty = { schema_version: 1, updated_at: '1970-01-01T00:00:00.000Z', skills: {} };
    const updated = applyUsageRecord(empty, {
      slug: 'foo',
      kind: 'install',
      now: '2026-04-26T00:00:00.000Z',
    });
    expect(updated.skills.foo.use_count).toBe(1);
    expect(updated.skills.foo.first_used_at).toBe('2026-04-26T00:00:00.000Z');
    expect(updated.skills.foo.last_used_at).toBe('2026-04-26T00:00:00.000Z');
    expect(updated.skills.foo.events).toHaveLength(1);
  });
  it('increments use_count and updates last_used_at on subsequent records', () => {
    let usage = applyUsageRecord(
      { schema_version: 1, updated_at: '1970-01-01T00:00:00Z', skills: {} },
      { slug: 'foo', now: '2026-04-01T00:00:00.000Z' },
    );
    usage = applyUsageRecord(usage, { slug: 'foo', now: '2026-04-26T00:00:00.000Z' });
    expect(usage.skills.foo.use_count).toBe(2);
    expect(usage.skills.foo.first_used_at).toBe('2026-04-01T00:00:00.000Z');
    expect(usage.skills.foo.last_used_at).toBe('2026-04-26T00:00:00.000Z');
  });
  it('caps events list at MAX_EVENTS_PER_SKILL', () => {
    let usage: ReturnType<typeof applyUsageRecord> = { schema_version: 1, updated_at: '1970-01-01T00:00:00Z', skills: {} };
    for (let i = 0; i < TELEMETRY_DEFAULTS.MAX_EVENTS_PER_SKILL + 10; i += 1) {
      usage = applyUsageRecord(usage, {
        slug: 'foo',
        now: new Date(Date.parse('2026-01-01T00:00:00Z') + i * 60_000).toISOString(),
      });
    }
    expect(usage.skills.foo!.events).toHaveLength(TELEMETRY_DEFAULTS.MAX_EVENTS_PER_SKILL);
    expect(usage.skills.foo!.use_count).toBe(TELEMETRY_DEFAULTS.MAX_EVENTS_PER_SKILL + 10);
  });
  it('ignores invalid kind values', () => {
    const usage = applyUsageRecord(
      { schema_version: 1, updated_at: '1970-01-01T00:00:00Z', skills: {} },
      { slug: 'foo', kind: 'evil-kind', now: '2026-04-26T00:00:00.000Z' },
    );
    expect(usage.skills.foo.events[0].kind).toBe('install');
  });
});

describe('telemetry: read/write round-trip', () => {
  it('reads empty usage when file missing', async () => {
    const usage = await readUsage({ projectRoot: tmpDir });
    expect(usage.skills).toEqual({});
    expect(usage.schema_version).toBe(TELEMETRY_DEFAULTS.SCHEMA_VERSION);
  });
  it('persists and reloads usage', async () => {
    await recordUsage({ projectRoot: tmpDir, slug: 'foo', now: '2026-04-26T00:00:00.000Z' });
    const round = await readUsage({ projectRoot: tmpDir });
    expect(round.skills.foo.use_count).toBe(1);
  });
  it('records batches in order', async () => {
    await recordBatch(['foo', 'bar', 'foo'], {
      projectRoot: tmpDir,
      now: '2026-04-26T00:00:00.000Z',
    });
    const usage = await readUsage({ projectRoot: tmpDir });
    expect(usage.skills.foo.use_count).toBe(2);
    expect(usage.skills.bar.use_count).toBe(1);
  });
});

describe('telemetry: findUnusedSkills + summarizeUsage', () => {
  it('returns skills idle past threshold sorted by idle_days desc', () => {
    const usage = {
      schema_version: 1,
      updated_at: '2026-04-26T00:00:00Z',
      skills: {
        recent: {
          first_used_at: '2026-04-01T00:00:00Z',
          last_used_at: '2026-04-25T00:00:00Z',
          use_count: 5,
          events: [],
        },
        idle: {
          first_used_at: '2026-01-01T00:00:00Z',
          last_used_at: '2026-02-01T00:00:00Z',
          use_count: 2,
          events: [],
        },
        ancient: {
          first_used_at: '2025-01-01T00:00:00Z',
          last_used_at: '2025-06-01T00:00:00Z',
          use_count: 1,
          events: [],
        },
      },
    };
    const unused = findUnusedSkills(usage, {
      thresholdDays: 60,
      now: '2026-04-26T00:00:00Z',
    });
    expect(unused.map((u: { slug: string }) => u.slug)).toEqual(['ancient', 'idle']);
    expect(unused[0].idle_days!).toBeGreaterThan(unused[1].idle_days!);
  });
  it('summary captures total uses and most_recent', () => {
    const summary = summarizeUsage({
      schema_version: 1,
      updated_at: 'x',
      skills: {
        a: {
          first_used_at: '2026-04-01T00:00:00Z',
          last_used_at: '2026-04-26T00:00:00Z',
          use_count: 3,
          events: [],
        },
        b: {
          first_used_at: '2026-04-10T00:00:00Z',
          last_used_at: '2026-04-15T00:00:00Z',
          use_count: 1,
          events: [],
        },
      },
    });
    expect(summary.skill_count).toBe(2);
    expect(summary.total_uses).toBe(4);
    expect(summary.most_recent?.slug).toBe('a');
  });
});

// ─── revalidation ───────────────────────────────────────────────────────────

describe('revalidation: shouldRevalidate', () => {
  it('returns true when state file missing', async () => {
    expect(await shouldRevalidate({ projectRoot: tmpDir })).toBe(true);
  });
  it('returns false when last check is fresh', async () => {
    await writeRevalidationState(
      {
        schema_version: 1,
        last_check_at: '2026-04-25T00:00:00.000Z',
        interval_days: 7,
        results: [],
      },
      { projectRoot: tmpDir },
    );
    const fresh = await shouldRevalidate({
      projectRoot: tmpDir,
      now: '2026-04-26T00:00:00.000Z',
      intervalDays: 7,
    });
    expect(fresh).toBe(false);
  });
  it('returns true when last check is older than interval', async () => {
    await writeRevalidationState(
      {
        schema_version: 1,
        last_check_at: '2026-01-01T00:00:00.000Z',
        interval_days: 7,
        results: [],
      },
      { projectRoot: tmpDir },
    );
    const stale = await shouldRevalidate({
      projectRoot: tmpDir,
      now: '2026-04-26T00:00:00.000Z',
      intervalDays: 7,
    });
    expect(stale).toBe(true);
  });
});

describe('revalidation: revalidateManifest', () => {
  it('detects local hash drift and missing files', async () => {
    const skillsDir = path.join(tmpDir, '.claude', 'skills', 'foo');
    await fs.mkdir(skillsDir, { recursive: true });
    const present = path.join(skillsDir, 'SKILL.md');
    await fs.writeFile(present, '---\nname: foo\n---\nbody', 'utf8');
    const manifest = {
      installed: [
        {
          slug: 'foo',
          install_target: '.claude/skills/foo/SKILL.md',
          // Wrong hash → drift expected.
          sha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        },
        {
          slug: 'gone',
          install_target: '.claude/skills/gone/SKILL.md',
          sha256: 'sha256:abc',
        },
      ],
    };
    const report = await revalidateManifest({
      manifest,
      projectRoot: tmpDir,
      fetchImpl: null,
      now: '2026-04-26T00:00:00.000Z',
    });
    expect(report.summary.total).toBe(2);
    expect(report.summary.local_drift).toBeGreaterThanOrEqual(1);
    const missing = report.results.find((r: any) => r.slug === 'gone');
    expect(missing?.status).toBe('missing');
  });
  it('records hash-match result when sha matches manifest', async () => {
    const file = path.join(tmpDir, '.claude', 'skills', 'ok', 'SKILL.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const body = '---\nname: ok\n---\nstable';
    await fs.writeFile(file, body, 'utf8');
    const { createHash } = await import('node:crypto');
    const sha = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    const report = await revalidateManifest({
      manifest: { installed: [{ slug: 'ok', install_target: '.claude/skills/ok/SKILL.md', sha256: sha }] },
      projectRoot: tmpDir,
      fetchImpl: null,
    });
    expect(report.summary.local_drift).toBe(0);
    expect(report.results[0].local_drift).toBe(false);
  });
  it('reports upstream as unreachable when fetch throws', async () => {
    const file = path.join(tmpDir, '.claude', 'skills', 'u', 'SKILL.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'x', 'utf8');
    const fetchImpl = async () => {
      throw new Error('econnrefused');
    };
    const report = await revalidateManifest({
      manifest: {
        installed: [
          {
            slug: 'u',
            install_target: '.claude/skills/u/SKILL.md',
            install: { url: 'https://example.invalid/SKILL.md' },
          },
        ],
      },
      projectRoot: tmpDir,
      fetchImpl,
    });
    expect(report.results[0].upstream.status).toBe('unreachable');
    expect(report.summary.upstream_drift).toBe(0);
  });
});

// ─── cve-feed ────────────────────────────────────────────────────────────────

describe('cve-feed: parsePackagesFromCandidate', () => {
  it('extracts explicit declarations', () => {
    const pkgs = parsePackagesFromCandidate({
      packages: [
        { ecosystem: 'npm', name: 'lodash', version: '4.17.0' },
        { ecosystem: 'PyPI', name: 'requests' },
      ],
    });
    expect(pkgs).toHaveLength(2);
    expect(pkgs[0]).toMatchObject({ ecosystem: 'npm', name: 'lodash', version: '4.17.0' });
  });
  it('parses install command for npm/pip/cargo', () => {
    const a = parsePackagesFromCandidate({ install: { command: 'npm install lodash@4.17.0' } });
    const b = parsePackagesFromCandidate({ install: { command: 'pip install requests' } });
    const c = parsePackagesFromCandidate({ install: { command: 'cargo add serde' } });
    expect(a[0]).toMatchObject({ ecosystem: 'npm', name: 'lodash', version: '4.17.0' });
    expect(b[0]).toMatchObject({ ecosystem: 'PyPI', name: 'requests' });
    expect(c[0]).toMatchObject({ ecosystem: 'crates.io', name: 'serde' });
  });
  it('honours single-purpose fields like npm_package', () => {
    const pkgs = parsePackagesFromCandidate({ npm_package: 'react', npm_version: '18.2.0' });
    expect(pkgs[0]).toMatchObject({ ecosystem: 'npm', name: 'react', version: '18.2.0' });
  });
  it('returns [] for non-package candidates', () => {
    expect(parsePackagesFromCandidate({})).toEqual([]);
    expect(parsePackagesFromCandidate(null)).toEqual([]);
  });
});

describe('cve-feed: classifyAdvisorySeverity', () => {
  it('honours explicit database_specific severity', () => {
    expect(classifyAdvisorySeverity({ database_specific: { severity: 'critical' } })).toBe('critical');
    expect(classifyAdvisorySeverity({ database_specific: { severity: 'HIGH' } })).toBe('high');
  });
  it('maps CVSS scores to bands', () => {
    expect(classifyAdvisorySeverity({ severity: [{ score: '9.5' }] })).toBe('critical');
    expect(classifyAdvisorySeverity({ severity: [{ score: '7.2' }] })).toBe('high');
    expect(classifyAdvisorySeverity({ severity: [{ score: '5.0' }] })).toBe('medium');
    expect(classifyAdvisorySeverity({ severity: [{ score: '2.0' }] })).toBe('low');
  });
  it('falls back to medium for GHSA without score', () => {
    expect(classifyAdvisorySeverity({ id: 'GHSA-xxxx-yyyy-zzzz' })).toBe('medium');
  });
  it('returns unknown for empty advisory', () => {
    expect(classifyAdvisorySeverity({})).toBe('unknown');
  });
});

describe('cve-feed: gatherCveSignals (stubbed fetch)', () => {
  const candidate = {
    candidate_id: 'pkg-1',
    install: { command: 'npm install lodash@4.17.0' },
  };
  it('emits flags for each advisory severity above unknown', async () => {
    const fetchImpl = async () => ({
      ok: true,
      async json() {
        return {
          vulns: [
            { id: 'GHSA-aaaa', database_specific: { severity: 'critical' } },
            { id: 'GHSA-bbbb', severity: [{ score: '7.5' }] },
            { id: 'GHSA-cccc', severity: [{ score: '0' }] },
          ],
        };
      },
    });
    const result = await gatherCveSignals(candidate, { fetchImpl, network: true });
    expect(result.flags).toContain('cve:critical:GHSA-aaaa');
    expect(result.flags).toContain('cve:high:GHSA-bbbb');
    expect(result.severity).toBe('critical');
    expect(result.degraded).toBe(false);
  });
  it('marks degraded when network is disabled', async () => {
    const result = await gatherCveSignals(candidate, { network: false });
    expect(result.degraded).toBe(true);
    expect(result.flags).toEqual([]);
  });
  it('records errors but never throws on fetch failure', async () => {
    const fetchImpl = async () => {
      throw new Error('boom');
    };
    const result = await gatherCveSignals(candidate, { fetchImpl, network: true });
    expect(result.degraded).toBe(true);
    expect(result.errors.some((e: string) => /boom/.test(e))).toBe(true);
    expect(result.flags).toEqual([]);
  });
  it('returns empty result when candidate declares no packages', async () => {
    const fetchImpl = async () => ({ ok: true, async json() { return { vulns: [] }; } });
    const result = await gatherCveSignals({}, { fetchImpl, network: true });
    expect(result.advisories).toEqual([]);
    expect(result.fetched).toBe(0);
  });
});

// ─── auto-cleanup ────────────────────────────────────────────────────────────

describe('auto-cleanup: findCleanupCandidates', () => {
  it('returns noop suggestion when usage file is empty', async () => {
    const result = await findCleanupCandidates({
      projectRoot: tmpDir,
      thresholdDays: 60,
      now: '2026-04-26T00:00:00Z',
    });
    expect(result.suggestion).toBe('noop');
    expect(result.candidates).toEqual([]);
  });
  it('flags idle skills and joins manifest entries when available', async () => {
    // seed usage
    await writeUsage(
      {
        schema_version: 1,
        updated_at: '2026-04-26T00:00:00Z',
        skills: {
          stale: {
            first_used_at: '2025-12-01T00:00:00Z',
            last_used_at: '2026-01-01T00:00:00Z',
            use_count: 1,
            events: [],
          },
          fresh: {
            first_used_at: '2026-04-25T00:00:00Z',
            last_used_at: '2026-04-25T00:00:00Z',
            use_count: 1,
            events: [],
          },
        },
      },
      { projectRoot: tmpDir },
    );
    // seed current.json
    await fs.mkdir(path.join(tmpDir, '.omc', 'provisioned'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.omc', 'provisioned', 'current.json'),
      JSON.stringify({
        installed: [
          {
            slug: 'stale',
            install_target: '.claude/skills/stale/SKILL.md',
            sha256: 'sha256:abc',
          },
        ],
      }),
      'utf8',
    );
    const result = await findCleanupCandidates({
      projectRoot: tmpDir,
      thresholdDays: 60,
      now: '2026-04-26T00:00:00Z',
    });
    expect(result.suggestion).toBe('prompt');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      slug: 'stale',
      install_target: '.claude/skills/stale/SKILL.md',
    });
    expect(result.summary.with_install_target).toBe(1);
  });
});

describe('auto-cleanup: deferCleanup', () => {
  it('records cleanup-deferred events in usage', async () => {
    await writeUsage(
      {
        schema_version: 1,
        updated_at: '2026-04-01T00:00:00Z',
        skills: {
          stale: {
            first_used_at: '2026-01-01T00:00:00Z',
            last_used_at: '2026-02-01T00:00:00Z',
            use_count: 1,
            events: [],
          },
        },
      },
      { projectRoot: tmpDir },
    );
    const updated = await deferCleanup(['stale'], {
      projectRoot: tmpDir,
      now: '2026-04-26T00:00:00Z',
    });
    expect(updated.skills.stale.use_count).toBe(2);
    expect(updated.skills.stale.events.at(-1)?.kind).toBe('cleanup-deferred');
    // last_used_at is bumped — `defer` is treated as a touch so we don't keep
    // re-prompting for the same skill on every orchestration.
    expect(updated.skills.stale.last_used_at).toBe('2026-04-26T00:00:00.000Z');
  });
});
