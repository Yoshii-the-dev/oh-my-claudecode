/**
 * Phase 3 tests for stack-provision quality hardening:
 *   - license-gate.mjs       (SPDX-aware allow/deny/warn)
 *   - cross-project-dedup.mjs (global skill scan + duplicate detection)
 *   - dependency-graph.mjs   (peer closure + capability requirements)
 *   - priority-score.mjs     (multi-axis ranking)
 *   - orchestrate.mjs::classifyCandidate (integration with the above)
 *
 * Pure ESM imports — no end-to-end orchestration here, that lives in
 * stack-provision-orchestrator.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = path.join(REPO_ROOT, 'skills/stack-provision/scripts');

const licenseGate = await import(`${path.join(SCRIPTS, 'license-gate.mjs')}`);
const dedup = await import(`${path.join(SCRIPTS, 'cross-project-dedup.mjs')}`);
const depGraph = await import(`${path.join(SCRIPTS, 'dependency-graph.mjs')}`);
const priority = await import(`${path.join(SCRIPTS, 'priority-score.mjs')}`);
const orchestrate = await import(`${path.join(SCRIPTS, 'orchestrate.mjs')}`);

const {
  loadLicensePolicy,
  resolveLicense,
  normaliseSpdx,
  LICENSE_GATE_DEFAULTS,
} = licenseGate;
const {
  collectGlobalSkillRoots,
  scanGlobalSkills,
  findDuplicateForCandidate,
} = dedup;
const {
  buildSkillIndex,
  resolveDependencies,
  evaluateCapabilityRequirements,
} = depGraph;
const { computePriorityScore, rankCandidates } = priority;
const { classifyCandidate, DEFAULT_POLICY } = orchestrate;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omc-stack-p3-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── license-gate ───────────────────────────────────────────────────────────

describe('license-gate: normaliseSpdx', () => {
  it('canonicalises common aliases', () => {
    expect(normaliseSpdx('mit')).toBe('MIT');
    expect(normaliseSpdx('Apache 2.0')).toBe('Apache-2.0');
    expect(normaliseSpdx('BSD-3-Clause')).toBe('BSD-3-Clause');
    expect(normaliseSpdx('AGPL')).toBe('AGPL-3.0');
  });
  it('picks first SPDX token from compound expressions', () => {
    expect(normaliseSpdx('MIT OR Apache-2.0')).toBe('MIT');
    expect(normaliseSpdx('Apache-2.0 AND BSD-3-Clause')).toBe('Apache-2.0');
  });
  it('returns null for empty / non-string', () => {
    expect(normaliseSpdx(null)).toBeNull();
    expect(normaliseSpdx('')).toBeNull();
  });
});

describe('license-gate: resolveLicense', () => {
  it('allows licenses on the allow list', () => {
    const v = resolveLicense({ license: 'MIT' }, LICENSE_GATE_DEFAULTS);
    expect(v.decision).toBe('allow');
    expect(v.spdx).toBe('MIT');
    expect(v.flags.some((f: string) => f.startsWith('license:allow:'))).toBe(true);
  });
  it('denies licenses on the deny list', () => {
    const v = resolveLicense({ license: 'AGPL-3.0' }, LICENSE_GATE_DEFAULTS);
    expect(v.decision).toBe('deny');
    expect(v.spdx).toBe('AGPL-3.0');
    expect(v.flags.some((f: string) => f.startsWith('license:denied:'))).toBe(true);
  });
  it('warns on unknown license (non-SPDX-shaped string) by default', () => {
    // Strings that contain whitespace / unsupported chars cannot be normalised
    // into a SPDX-shaped token, so they fall into the unknown branch.
    const v = resolveLicense({ license: 'Custom Internal License' }, LICENSE_GATE_DEFAULTS);
    expect(v.decision).toBe('warn');
    expect(v.spdx).toBeNull();
    expect(v.flags).toContain('license:unknown');
  });
  it('escalates unknown to deny when policy demands it', () => {
    const policy = {
      ...LICENSE_GATE_DEFAULTS,
      treat_unknown_as: 'deny',
    };
    const v = resolveLicense({ license: 'Internal Confidential License' }, policy);
    expect(v.decision).toBe('deny');
    expect(v.spdx).toBeNull();
  });
  it('warns when license is allowed by spdx but not in project allow list', () => {
    const policy = { ...LICENSE_GATE_DEFAULTS, allow: ['MIT'] };
    const v = resolveLicense({ license: 'BSD-2-Clause' }, policy);
    expect(v.decision).toBe('warn');
    expect(v.flags.some((f: string) => f.startsWith('license:not-allowed:'))).toBe(true);
  });
});

describe('license-gate: loadLicensePolicy', () => {
  it('falls back to defaults when file missing', async () => {
    const policy = await loadLicensePolicy(tmpDir);
    expect(policy._source).toBe('defaults');
    expect(policy.allow).toContain('MIT');
  });
  it('reads project policy when present', async () => {
    await fs.mkdir(path.join(tmpDir, '.omc'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.omc', 'license.json'),
      JSON.stringify({
        project_spdx: 'MIT',
        allow: ['MIT', 'Apache-2.0'],
        deny: ['GPL-3.0'],
        treat_unknown_as: 'deny',
      }),
      'utf8',
    );
    const policy = await loadLicensePolicy(tmpDir);
    expect(policy._source).toContain('license.json');
    expect(policy.allow).toEqual(['MIT', 'Apache-2.0']);
    expect(policy.deny).toEqual(['GPL-3.0']);
    expect(policy.treat_unknown_as).toBe('deny');
  });
});

// ─── cross-project-dedup ────────────────────────────────────────────────────

describe('cross-project-dedup: collectGlobalSkillRoots', () => {
  it('returns expected default roots without duplicates', () => {
    const roots = collectGlobalSkillRoots('/projects/foo', { homeDir: '/home/u' });
    expect(roots).toContain('/home/u/.claude/skills');
    expect(roots).toContain('/projects/foo/.claude/skills');
    // Deduped.
    const set = new Set(roots);
    expect(set.size).toBe(roots.length);
  });
  it('honours extra roots', () => {
    const roots = collectGlobalSkillRoots('/projects/foo', {
      homeDir: '/home/u',
      extra: ['/custom/path'],
    });
    expect(roots).toContain('/custom/path');
  });
});

describe('cross-project-dedup: scanGlobalSkills + findDuplicateForCandidate', () => {
  it('indexes SKILL.md files by frontmatter name and detects sha mismatches', async () => {
    const root = path.join(tmpDir, 'skills');
    const skillDirA = path.join(root, 'pkg-a');
    const skillDirB = path.join(root, 'pkg-b');
    await fs.mkdir(skillDirA, { recursive: true });
    await fs.mkdir(skillDirB, { recursive: true });
    const aBody =
      '---\nname: foo\ndescription: Foo skill\n---\n\nbody-a\n';
    const bBody =
      '---\nname: bar\ndescription: Bar skill\n---\n\nbody-b\n';
    await fs.writeFile(path.join(skillDirA, 'SKILL.md'), aBody, 'utf8');
    await fs.writeFile(path.join(skillDirB, 'SKILL.md'), bBody, 'utf8');

    const index = await scanGlobalSkills([root]);
    expect(index.has('foo')).toBe(true);
    expect(index.has('bar')).toBe(true);
    expect(index.get('foo')).toHaveLength(1);

    const fooSha = index.get('foo')![0].sha256;

    // No duplicate when slug missing.
    const noDup = findDuplicateForCandidate({ slug: 'qux' }, index);
    expect(noDup.duplicate).toBe(false);
    expect(noDup.flags).toHaveLength(0);

    // Duplicate with matching sha.
    const matchDup = findDuplicateForCandidate({ slug: 'foo', sha256: fooSha }, index);
    expect(matchDup.duplicate).toBe(true);
    expect(matchDup.flags).toContain('duplicate-already-installed');
    expect(matchDup.flags).not.toContain('duplicate-sha-mismatch');

    // Duplicate with sha drift.
    const driftDup = findDuplicateForCandidate(
      { slug: 'foo', sha256: 'sha256:deadbeef' },
      index,
    );
    expect(driftDup.duplicate).toBe(true);
    expect(driftDup.flags).toContain('duplicate-already-installed');
    expect(driftDup.flags).toContain('duplicate-sha-mismatch');
  });
});

// ─── dependency-graph ────────────────────────────────────────────────────────

describe('dependency-graph: buildSkillIndex', () => {
  it('groups candidates by slug', () => {
    const candidates = [
      { candidate_id: 'a1', slug: 'a' },
      { candidate_id: 'a2', slug: 'a' },
      { candidate_id: 'b1', slug: 'b' },
      { candidate_id: 'no-slug' },
    ];
    const idx = buildSkillIndex(candidates);
    expect(idx.get('a')).toHaveLength(2);
    expect(idx.get('b')).toHaveLength(1);
    expect(idx.has(undefined)).toBe(false);
  });
});

describe('dependency-graph: resolveDependencies', () => {
  it('closes peer skills transitively when peers also auto-approve', () => {
    const auto = { decision: 'auto-approve' };
    const a = {
      candidate_id: 'a',
      slug: 'a',
      peer_skills: ['b'],
      __verdict: auto,
    };
    const b = {
      candidate_id: 'b',
      slug: 'b',
      peer_skills: ['c'],
      __verdict: auto,
    };
    const c = { candidate_id: 'c', slug: 'c', __verdict: auto };
    const byId = new Map<string, any>([
      ['a', a],
      ['b', b],
      ['c', c],
    ]);
    const result = resolveDependencies(['a'], byId);
    expect(result.approved).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(result.added).toEqual(expect.arrayContaining(['b', 'c']));
    expect(result.blocked).toHaveLength(0);
  });
  it('blocks peers that are not auto-approve', () => {
    const a = {
      candidate_id: 'a',
      slug: 'a',
      peer_skills: ['b'],
      __verdict: { decision: 'auto-approve' },
    };
    const b = {
      candidate_id: 'b',
      slug: 'b',
      __verdict: { decision: 'manual' },
    };
    const byId = new Map<string, any>([['a', a], ['b', b]]);
    const result = resolveDependencies(['a'], byId);
    expect(result.added).toEqual([]);
    expect(result.blocked.some((b: any) => /peer-not-approved:b/.test(b.reason))).toBe(true);
  });
  it('reports peer-missing when slug has no candidate', () => {
    const a = {
      candidate_id: 'a',
      slug: 'a',
      peer_skills: ['ghost'],
      __verdict: { decision: 'auto-approve' },
    };
    const byId = new Map<string, any>([['a', a]]);
    const result = resolveDependencies(['a'], byId);
    expect(result.blocked.some((b: any) => /peer-missing:ghost/.test(b.reason))).toBe(true);
  });
});

describe('dependency-graph: evaluateCapabilityRequirements', () => {
  it('returns ok when every requirement is covered', () => {
    const r = evaluateCapabilityRequirements(
      { requires_capabilities: ['backend/auth', 'data-ai/eval'] },
      ['backend/auth', 'data-ai/eval', 'frontend/state'],
    );
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it('flags unsatisfied requirements', () => {
    const r = evaluateCapabilityRequirements(
      { requires_capabilities: ['backend/auth', 'frontend/state'] },
      ['backend/auth'],
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['frontend/state']);
    expect(r.flags).toContain('dependency:unsatisfied:frontend/state');
  });
  it('treats empty requirements as ok', () => {
    const r = evaluateCapabilityRequirements({}, []);
    expect(r.ok).toBe(true);
    expect(r.flags).toEqual([]);
  });
});

// ─── priority-score ─────────────────────────────────────────────────────────

describe('priority-score: computePriorityScore', () => {
  it('rewards high coverage + recent + multi-signal candidate', () => {
    const high = computePriorityScore(
      {
        score: 1,
        freshness_days: 10,
        source_trust: 0.95,
        source_quality: { score: 90 },
        trust_signals: { signals: ['a', 'b', 'c', 'd', 'e'] },
      },
      { batchMaxCoverage: 1 },
    );
    const low = computePriorityScore(
      {
        score: 0.2,
        freshness_days: 800,
        source_trust: 0.4,
        source_quality: { score: 40 },
      },
      { batchMaxCoverage: 1 },
    );
    expect(high.composite).toBeGreaterThan(low.composite);
    expect(high.axes.coverage).toBeCloseTo(1, 4);
    expect(low.axes.freshness).toBe(0);
  });
  it('penalises stale candidates with zeroed freshness axis', () => {
    const stale = computePriorityScore({ freshness_days: 400 });
    expect(stale.axes.freshness).toBe(0);
  });
  it('treats unknown freshness as neutral 0.5', () => {
    const unknown = computePriorityScore({});
    expect(unknown.axes.freshness).toBe(0.5);
  });
  it('handles non-object input safely', () => {
    const result = computePriorityScore(null);
    expect(result.composite).toBe(0);
    expect(result.missing).toContain('candidate');
  });
});

describe('priority-score: rankCandidates', () => {
  it('sorts by composite, breaks ties by raw score then id', () => {
    const cs = [
      {
        candidate_id: 'low',
        score: 0.2,
        freshness_days: 500,
        source_trust: 0.3,
      },
      {
        candidate_id: 'high',
        score: 1,
        freshness_days: 5,
        source_trust: 0.95,
        trust_signals: { signals: ['a', 'b', 'c'] },
      },
      {
        candidate_id: 'mid',
        score: 0.6,
        freshness_days: 60,
        source_trust: 0.7,
      },
    ];
    const ranked = rankCandidates(cs);
    expect(ranked.map((c: { candidate_id: string }) => c.candidate_id)).toEqual(['high', 'mid', 'low']);
    expect(typeof ranked[0].priority_score).toBe('number');
    expect(ranked[0].priority_breakdown.axes.coverage).toBe(1);
  });
  it('returns [] for empty input', () => {
    expect(rankCandidates([])).toEqual([]);
  });
});

// ─── classifyCandidate integration ──────────────────────────────────────────

describe('orchestrate.classifyCandidate (Phase 3 hooks)', () => {
  const basePolicy = { ...DEFAULT_POLICY };

  it('rejects candidates whose license is on the deny list', () => {
    const c = {
      candidate_id: 'denied-1',
      source: 'github',
      source_trust: 0.99,
      strict_gate: { passed: true },
      license: 'AGPL-3.0',
      risk_flags: [],
    };
    const verdict = classifyCandidate(c, basePolicy, {
      licensePolicy: LICENSE_GATE_DEFAULTS,
    });
    expect(verdict.decision).toBe('reject');
    expect(verdict.reason).toMatch(/license-blocked/);
    expect(verdict.license.spdx).toBe('AGPL-3.0');
  });

  it('routes warn-license candidates to manual', () => {
    const c = {
      candidate_id: 'warn-1',
      source: 'github',
      source_trust: 0.99,
      strict_gate: { passed: true },
      license: 'mystery-license',
      risk_flags: [],
    };
    const verdict = classifyCandidate(c, basePolicy, {
      licensePolicy: LICENSE_GATE_DEFAULTS,
    });
    expect(verdict.decision).toBe('manual');
    expect(verdict.reason).toMatch(/license requires manual review/);
  });

  it('passes allow-license through to the trust check', () => {
    const c = {
      candidate_id: 'allow-1',
      source: 'github',
      source_trust: 0.99,
      strict_gate: { passed: true },
      license: 'MIT',
      risk_flags: [],
    };
    const verdict = classifyCandidate(c, basePolicy, {
      licensePolicy: LICENSE_GATE_DEFAULTS,
    });
    expect(verdict.decision).toBe('auto-approve');
  });

  it('routes duplicate-already-installed to manual review', () => {
    const c = {
      candidate_id: 'dup-1',
      slug: 'foo',
      source: 'github',
      source_trust: 0.99,
      strict_gate: { passed: true },
      license: 'MIT',
      risk_flags: [],
      sha256: 'sha256:existing',
    };
    const dedupIndex = new Map<string, Array<{ path: string; sha256?: string }>>([
      ['foo', [{ path: '/home/u/.claude/skills/foo/SKILL.md', sha256: 'sha256:existing' }]],
    ]);
    const verdict = classifyCandidate(c, basePolicy, {
      licensePolicy: LICENSE_GATE_DEFAULTS,
      dedupIndex,
    });
    expect(verdict.decision).toBe('manual');
    expect(verdict.reason).toMatch(/duplicate already installed/);
    expect(c.risk_flags).toContain('duplicate-already-installed');
  });

  it('escalates duplicate with sha mismatch in reason', () => {
    const c = {
      candidate_id: 'dup-2',
      slug: 'foo',
      source: 'github',
      source_trust: 0.99,
      strict_gate: { passed: true },
      license: 'MIT',
      risk_flags: [],
      sha256: 'sha256:new',
    };
    const dedupIndex = new Map<string, Array<{ path: string; sha256?: string }>>([
      ['foo', [{ path: '/x/SKILL.md', sha256: 'sha256:old' }]],
    ]);
    const verdict = classifyCandidate(c, basePolicy, {
      licensePolicy: LICENSE_GATE_DEFAULTS,
      dedupIndex,
    });
    expect(verdict.decision).toBe('manual');
    expect(verdict.reason).toMatch(/different content/);
    expect(c.risk_flags).toContain('duplicate-sha-mismatch');
  });

  it('keeps existing source-blocked behaviour ahead of license check', () => {
    const c = {
      candidate_id: 'blocked-1',
      source: 'cskills-sh',
      source_trust: 0.99,
      strict_gate: { passed: true },
      license: 'AGPL-3.0',
      risk_flags: [],
    };
    const verdict = classifyCandidate(
      c,
      { ...basePolicy, blocked_sources: ['cskills-sh'] },
      { licensePolicy: LICENSE_GATE_DEFAULTS },
    );
    expect(verdict.decision).toBe('reject');
    expect(verdict.reason).toMatch(/blocked by policy/);
  });
});
