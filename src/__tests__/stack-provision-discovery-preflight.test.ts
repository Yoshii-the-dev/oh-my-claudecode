/**
 * Integration tests for M4:
 * - emitSourcePreflightWarnings: preflight: entries appear at start of candidates.json warnings
 * - --network plumbing: orchestrate.mjs does NOT forward --network to init.mjs
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const initScript = join(root, 'skills', 'stack-provision', 'scripts', 'init.mjs');
const provisionScript = join(root, 'skills', 'stack-provision', 'scripts', 'provision.mjs');
const orchestrateScript = join(root, 'skills', 'stack-provision', 'scripts', 'orchestrate.mjs');

const fixedNow = '2026-04-26T00:00:00.000Z';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'omc-preflight-test-'));
  tempDirs.push(dir);
  return dir;
}

function runJson(script: string, args: string[], cwd = root): unknown {
  const output = execFileSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OMC_STACK_PROVISION_NOW: fixedNow },
  });
  return JSON.parse(output);
}

// ---------------------------------------------------------------------------
// Helper: init a minimal run then return runDir
// ---------------------------------------------------------------------------
function initRun(runRoot: string, stack: string, runId: string): string {
  runJson(initScript, [stack, '--run-id', runId, '--out', runRoot, '--json']);
  return join(runRoot, runId);
}

// ---------------------------------------------------------------------------
// parseArgs unit-level check (pure import — no spawning needed)
// ---------------------------------------------------------------------------
describe('orchestrate.mjs --network flag parsing', () => {
  let parseArgs: (argv: string[]) => Record<string, unknown>;

  it('loads parseArgs from orchestrate.mjs', async () => {
    const mod = await import(`${orchestrateScript}`);
    parseArgs = mod.parseArgs;
    expect(typeof parseArgs).toBe('function');
  });

  it('sets opts.network = true when --network is passed', async () => {
    const mod = await import(`${orchestrateScript}`);
    parseArgs = mod.parseArgs;
    const opts = parseArgs(['expo, trpc', '--network']);
    expect(opts.network).toBe(true);
  });

  it('does NOT set __forward__--network when --network is passed', async () => {
    const mod = await import(`${orchestrateScript}`);
    parseArgs = mod.parseArgs;
    const opts = parseArgs(['expo, trpc', '--network']);
    // None of the keys should be the forwarded --network sentinel
    const forwardedKeys = Object.keys(opts).filter((k) => k.startsWith('__forward__'));
    expect(forwardedKeys).not.toContain('__forward__--network');
  });

  it('defaults opts.network to false', async () => {
    const mod = await import(`${orchestrateScript}`);
    parseArgs = mod.parseArgs;
    const opts = parseArgs(['expo, trpc']);
    expect(opts.network).toBe(false);
  });

  it('still forwards other unknown flags to init.mjs', async () => {
    const mod = await import(`${orchestrateScript}`);
    parseArgs = mod.parseArgs;
    const opts = parseArgs(['expo, trpc', '--surfaces', 'mobile', '--network']);
    expect((opts as Record<string, unknown>)['__forward__--surfaces']).toBe('mobile');
    expect(opts.network).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// emitSourcePreflightWarnings — provision.mjs discover integration
// ---------------------------------------------------------------------------
describe('emitSourcePreflightWarnings', () => {
  it('emits preflight: warnings for skills-sh when no index and no --network', () => {
    const tmpDir = makeTempDir();
    const runRoot = join(tmpDir, 'runs');
    const runDir = initRun(runRoot, 'expo, supabase', 'preflight-no-network');

    const result = runJson(provisionScript, [
      'discover',
      runDir,
      '--sources=skills-sh',
      '--json',
    ]) as { warnings: string[] };

    // First preflight warning should appear before any post-fetch warning
    const preflightIdx = result.warnings.findIndex((w) => w.includes('preflight:'));
    const postFetchIdx = result.warnings.findIndex((w) => w.includes('skipped:') && !w.includes('preflight:'));
    expect(preflightIdx).toBeGreaterThanOrEqual(0);
    // preflight must appear before (or at same index as) the post-fetch warning
    if (postFetchIdx >= 0) {
      expect(preflightIdx).toBeLessThanOrEqual(postFetchIdx);
    }
    // Must mention skills-sh
    expect(result.warnings.some((w) => w.includes('skills-sh') && w.includes('preflight:'))).toBe(true);
  });

  it('does NOT emit skills-sh preflight when an index file is provided', () => {
    const tmpDir = makeTempDir();
    const runRoot = join(tmpDir, 'runs');
    const indexFile = join(tmpDir, 'skills-sh-index.json');
    // Write a valid (but empty) index
    writeFileSync(indexFile, JSON.stringify([]), 'utf8');
    const runDir = initRun(runRoot, 'expo, supabase', 'preflight-with-index');

    const result = runJson(provisionScript, [
      'discover',
      runDir,
      '--sources=skills-sh',
      `--skills-sh-index=${indexFile}`,
      '--json',
    ]) as { warnings: string[] };

    expect(result.warnings.some((w) => w.includes('skills-sh') && w.includes('preflight:'))).toBe(false);
  });

  it('emits preflight: warnings for github when no index and no --network', () => {
    const tmpDir = makeTempDir();
    const runRoot = join(tmpDir, 'runs');
    const runDir = initRun(runRoot, 'expo, supabase', 'preflight-github');

    const result = runJson(provisionScript, [
      'discover',
      runDir,
      '--sources=github',
      '--json',
    ]) as { warnings: string[] };

    expect(result.warnings.some((w) => w.includes('github') && w.includes('preflight:'))).toBe(true);
  });

  it('does NOT emit preflight for installed/bundled sources', () => {
    const tmpDir = makeTempDir();
    const runRoot = join(tmpDir, 'runs');
    const runDir = initRun(runRoot, 'expo, supabase', 'preflight-local');

    const result = runJson(provisionScript, [
      'discover',
      runDir,
      '--sources=installed,bundled',
      '--json',
    ]) as { warnings: string[] };

    expect(result.warnings.some((w) => w.includes('preflight:'))).toBe(false);
  });
});
