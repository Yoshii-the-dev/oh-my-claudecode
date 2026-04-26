import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROVISION_SCRIPT = join(REPO_ROOT, 'skills/stack-provision/scripts/provision.mjs');
const CONFIG_PATH = join(REPO_ROOT, 'skills/stack-provision/config/default-capability-packs.json');

// ESM dynamic import — provision.mjs is an ES module. Use template-literal path
// so TypeScript doesn't try to resolve a declaration file for the .mjs module.
let normalizeToken: (raw: unknown, config: unknown) => string[];
let createAliasResolver: (config: unknown, projectRoot: string, warnings?: string[]) => {
  expand: (token: string) => string[];
  canonical: (token: string) => string;
  _merged: Record<string, string[]>;
};
let discoveryQueries: (run: unknown, config: unknown, aliasResolver: unknown) => string[];
let config: Record<string, unknown>;

beforeAll(async () => {
  // Dynamic import via template literal so TypeScript won't resolve a .mjs declaration file.
  const mod = await import(`${PROVISION_SCRIPT}`) as Record<string, unknown>;
  normalizeToken = mod.normalizeToken as typeof normalizeToken;
  createAliasResolver = mod.createAliasResolver as typeof createAliasResolver;
  discoveryQueries = mod.discoveryQueries as typeof discoveryQueries;
  config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
});

describe('normalizeToken', () => {
  const cases: Array<[string, string[]]> = [
    ['supabase-auth', ['supabase', 'auth']],
    ['tRPC', ['trpc']],
    ['Sentry RN', ['sentry', 'rn']],
    ['pnpm workspaces .', ['pnpm', 'workspaces']],
    [
      'jwt verifier; client side auth flow only on mobile)',
      ['jwt', 'verifier', 'client'],
    ],
    // 'files' is in the stop-words list, so it is dropped; 'supabase' is the next
    // non-stop-word after the path tokens and 'under'/'runnable'/'by' are filtered.
    [
      'plain sql files under infra/db/migrations/ runnable by supabase db push and reversible via paired down.sql per fr-/ac-.',
      ['plain', 'sql', 'supabase'],
    ],
    ['', []],
    ['   ', []],
    ['(parenthetical only)', []],
    ['https://example.com/foo', []],
  ];

  it.each(cases)('normalizes %s', (input, expected) => {
    expect(normalizeToken(input, config)).toEqual(expected);
  });

  it('returns [] for null', () => {
    expect(normalizeToken(null, config)).toEqual([]);
  });
});

describe('createAliasResolver', () => {
  it('expands built-in aliases for supabase', () => {
    const r = createAliasResolver(config, '/tmp/no-project-xyzzy');
    expect(r.expand('supabase')).toEqual(
      expect.arrayContaining(['supabase', 'postgres', 'realtime', 'storage']),
    );
  });

  it('expands built-in aliases for trpc', () => {
    const r = createAliasResolver(config, '/tmp/no-project-xyzzy');
    expect(r.expand('trpc')).toEqual(
      expect.arrayContaining(['trpc', 'rpc', 'typesafe api']),
    );
  });

  it('canonicalizes case variants', () => {
    const r = createAliasResolver(config, '/tmp/no-project-xyzzy');
    expect(r.canonical('tRPC')).toBe('trpc');
    expect(r.canonical('TRPC')).toBe('trpc');
  });

  it('returns token unchanged for unknown token', () => {
    const r = createAliasResolver(config, '/tmp/no-project-xyzzy');
    // No alias exists — expand returns the token as-is (no splitting)
    expect(r.expand('unknown-thing')).toEqual(['unknown-thing']);
    expect(r.canonical('unknown-xyz-thing')).toBe('unknown-xyz-thing');
  });

  it('merges project override — replace semantics', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'omc-alias-test-'));
    mkdirSync(join(tmpRoot, '.omc', 'stack-provision'), { recursive: true });
    // Override supabase to narrow list (no realtime/storage)
    writeFileSync(
      join(tmpRoot, '.omc', 'stack-provision', 'aliases.json'),
      JSON.stringify({ supabase: ['supabase', 'postgres'] }),
      'utf8',
    );
    const r = createAliasResolver(config, tmpRoot);
    const expanded = r.expand('supabase');
    expect(expanded).toEqual(expect.arrayContaining(['supabase', 'postgres']));
    // Must NOT include realtime/storage (replaced, not concat)
    expect(expanded).not.toContain('realtime');
    expect(expanded).not.toContain('storage');
  });

  it('falls back to built-ins on malformed override file', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'omc-alias-bad-'));
    mkdirSync(join(tmpRoot, '.omc', 'stack-provision'), { recursive: true });
    writeFileSync(
      join(tmpRoot, '.omc', 'stack-provision', 'aliases.json'),
      '{invalid json',
      'utf8',
    );
    const warnings: string[] = [];
    const r = createAliasResolver(config, tmpRoot, warnings);
    // Built-in supabase still works
    expect(r.expand('supabase')).toEqual(
      expect.arrayContaining(['supabase', 'postgres', 'realtime', 'storage']),
    );
    // A warning was pushed
    expect(warnings.some((w) => w.includes('aliases.json preflight'))).toBe(true);
  });
});

describe('discoveryQueries (new)', () => {
  const baseRun = {
    contract: { stack: ['ignore-this-prose; should not appear in queries.'] },
    matrix: {
      cells: [
        { surface: 'mobile', technology: 'expo', aspect: 'auth' },
        { surface: 'backend', technology: 'tRPC', aspect: 'rpc' },
        { surface: 'data', technology: 'supabase', aspect: 'database' },
      ],
    },
  };

  it('does not include raw run.contract.stack prose', () => {
    const r = createAliasResolver(config, '/tmp');
    const queries = discoveryQueries(baseRun, config, r);
    expect(queries.some((q: string) => q.includes(';'))).toBe(false);
    expect(queries.some((q: string) => q.includes('ignore-this-prose'))).toBe(false);
  });

  it('caps every query at 40 chars and total at 80 entries', () => {
    const r = createAliasResolver(config, '/tmp');
    const queries = discoveryQueries(baseRun, config, r);
    expect(queries.length).toBeLessThanOrEqual(80);
    for (const q of queries) {
      expect(q.length).toBeLessThanOrEqual(40);
    }
  });

  it('expands aliases for each cell technology', () => {
    const r = createAliasResolver(config, '/tmp');
    const queries = discoveryQueries(baseRun, config, r);
    expect(queries).toEqual(expect.arrayContaining(['expo', 'react native', 'trpc', 'rpc']));
  });

  it('returns at least one query for malformed input', () => {
    const r = createAliasResolver(config, '/tmp');
    const empty = { contract: {}, matrix: { cells: [] } };
    expect(discoveryQueries(empty, config, r).length).toBeGreaterThanOrEqual(1);
  });

  it('first 5 queries for real stack include expected technologies', () => {
    const realRun = {
      contract: {},
      matrix: {
        cells: [
          { surface: 'mobile', technology: 'expo', aspect: 'navigation' },
          { surface: 'backend', technology: 'trpc', aspect: 'rpc' },
          { surface: 'data', technology: 'supabase', aspect: 'database' },
          { surface: 'mobile', technology: 'sentry-rn', aspect: 'observability' },
          { surface: 'product-analytics', technology: 'posthog', aspect: 'analytics' },
        ],
      },
    };
    const r = createAliasResolver(config, '/tmp');
    const queries = discoveryQueries(realRun, config, r);
    // At least 4 of the 5 expected technologies should appear
    const techTerms = ['expo', 'trpc', 'supabase', 'sentry', 'posthog'];
    const matched = techTerms.filter((t) => queries.some((q: string) => q.includes(t)));
    expect(matched.length).toBeGreaterThanOrEqual(4);
  });
});
