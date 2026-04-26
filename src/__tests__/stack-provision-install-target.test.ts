/**
 * stack-provision install-target normalization + TOFU strict-gate.
 *
 * Targets the regression where skills.sh search returns slug-only IDs
 * (e.g. `supabase-postgres-best-practices`), but `npx skills add` requires
 * `<org>/<repo>`. The orchestrator now extracts the repo path from the
 * entry's github URL or, failing that, emits a clean `external-command-unresolved`
 * action with `unresolvable-install-target` risk flag rather than a broken
 * `npx skills add <slug>` command that silently fails.
 *
 * Also covers TOFU (trust-on-first-use): high-trust candidates without a
 * sha256 should pass the strict gate with `tofu_pending: true` so they can
 * be auto-installed once and pinned thereafter.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROVISION = path.join(REPO_ROOT, 'skills/stack-provision/scripts/provision.mjs');

const provision = await import(`${PROVISION}`);
const {
  extractGithubRepoPath,
  externalInstall,
  evaluateStrictGateForCandidate,
  strictGatePolicy,
  renderRegistryInstallCommand,
  DEFAULT_STRICT_GATE,
} = provision as any;

describe('extractGithubRepoPath', () => {
  it('returns <org>/<repo> from a plain github.com html_url', () => {
    expect(extractGithubRepoPath({ html_url: 'https://github.com/anthropics/courses' })).toBe(
      'anthropics/courses',
    );
  });

  it('extracts <org>/<repo> from a tree URL with subpath', () => {
    expect(
      extractGithubRepoPath({
        html_url: 'https://github.com/vercel-labs/agent-skills/tree/main/skills/foo',
      }),
    ).toBe('vercel-labs/agent-skills');
  });

  it('extracts <org>/<repo> from a .git suffix URL', () => {
    expect(extractGithubRepoPath({ url: 'https://github.com/anthropics/courses.git' })).toBe(
      'anthropics/courses',
    );
  });

  it('accepts a pre-shaped <org>/<repo> ref without scheme', () => {
    expect(extractGithubRepoPath({ repo_path: 'anthropics/courses' })).toBe('anthropics/courses');
  });

  it('returns null for slug-only entries', () => {
    expect(extractGithubRepoPath({ slug: 'supabase-postgres-best-practices' })).toBeNull();
  });

  it('returns null for non-github URLs', () => {
    expect(extractGithubRepoPath({ url: 'https://example.com/foo' })).toBeNull();
  });

  it('returns null for empty / non-object inputs', () => {
    expect(extractGithubRepoPath(null)).toBeNull();
    expect(extractGithubRepoPath({})).toBeNull();
  });
});

describe('externalInstall — skills-sh source', () => {
  it('promotes skill_md_url candidates to download-skill', () => {
    const inst = externalInstall(
      'skills-sh',
      { slug: 'foo', skill_md_url: 'https://x/SKILL.md' },
      'foo',
      `sha256:${'a'.repeat(64)}`,
    );
    expect(inst.kind).toBe('download-skill');
    expect(inst.source_url).toBe('https://x/SKILL.md');
    expect(inst.expected_sha256).toBe(`sha256:${'a'.repeat(64)}`);
    expect(inst.normalized).toBe(true);
  });

  it('derives <org>/<repo> from html_url and produces a valid `npx skills add` command', () => {
    const inst = externalInstall(
      'skills-sh',
      { slug: 'agent-skills', html_url: 'https://github.com/vercel-labs/agent-skills' },
      'agent-skills',
    );
    expect(inst.kind).toBe('external-command');
    expect(inst.command).toBe('npx skills add vercel-labs/agent-skills -p -y');
    expect(inst.target).toBe('vercel-labs/agent-skills');
    expect(inst.normalized).toBe(true);
  });

  it('honors entry.install_cmd verbatim (registry-supplied command wins)', () => {
    const inst = externalInstall(
      'skills-sh',
      {
        slug: 'foo',
        html_url: 'https://github.com/anthropics/foo',
        install_cmd: 'npx skills add anthropics/foo --pin v1',
      },
      'foo',
    );
    expect(inst.command).toBe('npx skills add anthropics/foo --pin v1');
    expect(inst.normalized).toBe(true);
  });

  it('falls back to external-command-unresolved when no github URL or skill_md_url is available', () => {
    const inst = externalInstall(
      'skills-sh',
      { slug: 'supabase-postgres-best-practices' },
      'supabase-postgres-best-practices',
    );
    expect(inst.kind).toBe('external-command-unresolved');
    expect(inst.normalized).toBe(false);
    expect(inst.target).toBe('supabase-postgres-best-practices');
    expect(inst.reason).toMatch(/<org>\/<repo>/);
    // Critical: the command must NOT pretend to install — it tells the user
    // to review manually instead of silently issuing a broken `npx skills add <slug>`.
    expect(inst.command).toMatch(/^review manually:/);
  });

  it('uses /learn for agentskill-sh source when github URL is available', () => {
    const inst = externalInstall(
      'agentskill-sh',
      { slug: 'foo', html_url: 'https://github.com/anthropics/foo' },
      'foo',
    );
    expect(inst.command).toBe('/learn anthropics/foo');
    expect(inst.target).toBe('anthropics/foo');
  });
});

describe('externalInstall — install.method audit field', () => {
  it('annotates every install branch with method and normalized', () => {
    const cases = [
      [
        externalInstall('skills-sh', { html_url: 'https://github.com/a/b' }, 's'),
        'external-command',
        true,
      ],
      [externalInstall('skills-sh', {}, 's'), 'external-command-unresolved', false],
      [
        externalInstall('skills-sh', { skill_md_url: 'https://x/y' }, 's'),
        'download-skill',
        true,
      ],
      [externalInstall('plugin-marketplace', { ref: 'foo/bar' }, 's'), 'plugin-install', true],
    ] as const;
    for (const [inst, expectedMethod, expectedNormalized] of cases) {
      expect((inst as any).method).toBe(expectedMethod);
      expect((inst as any).normalized).toBe(expectedNormalized);
    }
  });
});

describe('renderRegistryInstallCommand — github fallback for slug-only entries', () => {
  const skillsShRegistry = {
    install_command_template: 'npx skills add {ref}',
    install_reference_fields: ['ref', 'package', 'repository', 'slug', 'name'],
  };

  it('substitutes the github repo path when entry.html_url is present', () => {
    const cmd = renderRegistryInstallCommand(
      skillsShRegistry.install_command_template,
      { slug: 'foo', html_url: 'https://github.com/anthropics/foo' },
      'skills-sh',
      skillsShRegistry,
    );
    expect(cmd).toBe('npx skills add anthropics/foo');
  });

  it('returns entry.install_cmd verbatim when present, ignoring the template', () => {
    const cmd = renderRegistryInstallCommand(
      skillsShRegistry.install_command_template,
      { slug: 'foo', install_cmd: 'npx skills add a/b --pin v2' },
      'skills-sh',
      skillsShRegistry,
    );
    expect(cmd).toBe('npx skills add a/b --pin v2');
  });

  it('falls back to slug only when no github reference is available', () => {
    const cmd = renderRegistryInstallCommand(
      skillsShRegistry.install_command_template,
      { slug: 'orphan-skill' },
      'skills-sh',
      skillsShRegistry,
    );
    // This produces a broken command — but discovery should now route such
    // candidates to external-command-unresolved before this template ever
    // runs. The test exists to lock in the fact that the fallback exists
    // for legacy paths (e.g. registries that still use raw slugs as ref).
    expect(cmd).toBe('npx skills add orphan-skill');
  });
});

describe('TOFU strict-gate', () => {
  it('exposes the new TOFU defaults', () => {
    expect(DEFAULT_STRICT_GATE.checksum_tofu_allowed).toBe(true);
    expect(DEFAULT_STRICT_GATE.checksum_tofu_min_trust).toBe(0.9);
    const policy = strictGatePolicy({});
    expect(policy.checksum_tofu_allowed).toBe(true);
    expect(policy.checksum_tofu_min_trust).toBe(0.9);
  });

  it('lets high-trust no-checksum candidates through with tofu_pending=true', () => {
    const policy = strictGatePolicy({});
    const result = evaluateStrictGateForCandidate(
      {
        source_trust: 0.95,
        freshness_days: 30,
        checksum_valid: false,
        license_status: 'no-conflict',
        source: 'skills-sh',
        risk_flags: [],
      },
      policy,
    );
    expect(result.install_allowed).toBe(true);
    expect(result.tofu_pending).toBe(true);
    expect(result.reasons).not.toContain('checksum_invalid');
  });

  it('still blocks low-trust no-checksum candidates', () => {
    const policy = strictGatePolicy({});
    const result = evaluateStrictGateForCandidate(
      {
        source_trust: 0.7,
        freshness_days: 30,
        checksum_valid: false,
        license_status: 'no-conflict',
        source: 'skills-sh',
        risk_flags: [],
      },
      policy,
    );
    expect(result.install_allowed).toBe(false);
    expect(result.reasons).toContain('source_trust<0.85');
    expect(result.reasons).toContain('checksum_invalid');
    expect(result.tofu_pending).toBe(false);
  });

  it('honours an explicit policy opt-out (checksum_tofu_allowed=false)', () => {
    const policy = strictGatePolicy({
      policy: { strict_gate: { checksum_tofu_allowed: false } },
    });
    const result = evaluateStrictGateForCandidate(
      {
        source_trust: 0.95,
        freshness_days: 30,
        checksum_valid: false,
        license_status: 'no-conflict',
        source: 'skills-sh',
        risk_flags: [],
      },
      policy,
    );
    expect(result.install_allowed).toBe(false);
    expect(result.reasons).toContain('checksum_invalid');
    expect(result.tofu_pending).toBe(false);
  });

  it('refuses TOFU when license is in conflict even with high trust', () => {
    const policy = strictGatePolicy({});
    const result = evaluateStrictGateForCandidate(
      {
        source_trust: 0.95,
        freshness_days: 30,
        checksum_valid: false,
        license_status: 'conflict',
        source: 'skills-sh',
        risk_flags: [],
      },
      policy,
    );
    expect(result.install_allowed).toBe(false);
    expect(result.reasons).toContain('checksum_invalid');
    expect(result.reasons).toContain('license_conflict');
    expect(result.tofu_pending).toBe(false);
  });
});
