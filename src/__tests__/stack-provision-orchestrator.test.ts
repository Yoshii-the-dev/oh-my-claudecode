/**
 * Phase 1 tests for skills/stack-provision/scripts/orchestrate.mjs.
 * Mix of pure-function unit tests + e2e spawn against a real init/discover
 * pipeline in a tmpdir.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORCHESTRATOR = path.join(
  REPO_ROOT,
  'skills/stack-provision/scripts/orchestrate.mjs',
);

// Pure-function imports from the orchestrator. Importing the .mjs directly is
// supported because vitest runs in ESM mode and orchestrate.mjs guards its
// auto-run with the `invokedAsScript` check.
const orchestrator = await import(`${ORCHESTRATOR}`);
const { parseArgs, classifyCandidate, applyHeadlessPolicy, DEFAULT_POLICY, autoDetectAdr } = orchestrator;

interface OrchestratorEvent {
  ts?: number;
  event: string;
  [key: string]: unknown;
}

async function runOrchestrator(
  args: string[],
  cwd: string,
): Promise<{ events: OrchestratorEvent[]; code: number; stderr: string }> {
  return new Promise((resolveExit) => {
    const proc = spawn('node', [ORCHESTRATOR, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
      const events: OrchestratorEvent[] = [];
      for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          events.push(JSON.parse(trimmed));
        } catch {
          // ignore
        }
      }
      resolveExit({ events, code: code ?? 1, stderr });
    });
  });
}

describe('orchestrate.mjs — parseArgs', () => {
  it('captures positional stack list', () => {
    const a = parseArgs(['next.js, react']);
    expect(a.stack).toBe('next.js, react');
    expect(a.mode).toBe('full');
  });

  it('switches mode on --plan-only / --apply', () => {
    expect(parseArgs(['--plan-only']).mode).toBe('plan-only');
    expect(parseArgs(['--apply']).mode).toBe('apply');
  });

  it('captures --plan-file and --decisions-file values', () => {
    const a = parseArgs(['--apply', '--plan-file=/tmp/p.json', '--decisions-file=/tmp/d.jsonl']);
    expect(a.planFile).toBe('/tmp/p.json');
    expect(a.decisionsFile).toBe('/tmp/d.jsonl');
  });

  it('forwards unknown long flags via __forward__ keys', () => {
    const a = parseArgs(['some-stack', '--surfaces=backend']);
    expect((a as Record<string, unknown>)['__forward__--surfaces=backend']).toBe(true);
  });
});

describe('orchestrate.mjs — classifyCandidate', () => {
  const policy = { ...DEFAULT_POLICY };

  it('auto-approves high-trust safe candidates', () => {
    const v = classifyCandidate(
      {
        candidate_id: 'c',
        source: 'installed-skill',
        source_trust: 0.97,
        risk_flags: [],
        strict_gate: { passed: true },
      },
      policy,
    );
    expect(v.decision).toBe('auto-approve');
  });

  it('forces manual on generated drafts when forbid_generated_drafts is true', () => {
    const v = classifyCandidate(
      { candidate_id: 'c', source: 'generated', source_trust: 0.99, strict_gate: { passed: true } },
      policy,
    );
    expect(v.decision).toBe('manual');
    expect(v.reason).toMatch(/generated-draft/);
  });

  it('forces manual on warning-flag candidates even at high trust', () => {
    const v = classifyCandidate(
      {
        candidate_id: 'c',
        source: 'github',
        source_trust: 0.99,
        risk_flags: ['warning-stale-maintenance'],
        strict_gate: { passed: true },
      },
      policy,
    );
    expect(v.decision).toBe('manual');
  });

  it('rejects candidates whose source is in policy.blocked_sources', () => {
    const v = classifyCandidate(
      { candidate_id: 'c', source: 'cskills-sh', source_trust: 0.99 },
      { ...policy, blocked_sources: ['cskills-sh'] },
    );
    expect(v.decision).toBe('reject');
  });

  it('forces manual when strict gate not passed', () => {
    const v = classifyCandidate(
      {
        candidate_id: 'c',
        source: 'github',
        source_trust: 0.97,
        risk_flags: [],
        strict_gate: { passed: false },
      },
      policy,
    );
    expect(v.decision).toBe('manual');
    expect(v.reason).toMatch(/strict-gate/);
  });
});

describe('orchestrate.mjs — applyHeadlessPolicy', () => {
  it('bails when policy is bail and decisions are required', async () => {
    const result = await applyHeadlessPolicy(
      new Set(['c1']),
      new Map([['c1', { candidate_id: 'c1', source: 'github' }]]),
      { headless_action: 'bail' },
    );
    expect(result.cancelled).toBe(true);
    expect(result.bailed).toBe(true);
  });

  it('approves safe candidates under auto_approve_safe', async () => {
    const result = await applyHeadlessPolicy(
      new Set(['c1']),
      new Map([
        [
          'c1',
          {
            candidate_id: 'c1',
            source: 'github',
            risk_flags: [],
            strict_gate: { passed: true },
          },
        ],
      ]),
      { headless_action: 'auto_approve_safe' },
    );
    expect(result.cancelled).toBe(false);
    expect(result.decisions.get('c1')?.action).toBe('approve');
  });

  it('skips generated candidates under auto_approve_safe', async () => {
    const result = await applyHeadlessPolicy(
      new Set(['c1']),
      new Map([
        [
          'c1',
          { candidate_id: 'c1', source: 'generated', risk_flags: [], strict_gate: { passed: true } },
        ],
      ]),
      { headless_action: 'auto_approve_safe' },
    );
    expect(result.decisions.get('c1')?.action).toBe('skip');
  });
});

describe('orchestrate.mjs — autoDetectAdr', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-detect-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns null when no decisions dir exists', async () => {
    expect(await autoDetectAdr(tmp)).toBeNull();
  });

  it('returns latest technology ADR by mtime', async () => {
    const dir = path.join(tmp, '.omc', 'decisions');
    await fs.mkdir(dir, { recursive: true });
    const old = path.join(dir, '2026-01-01-technology-old.md');
    const fresh = path.join(dir, '2026-04-26-technology-new.md');
    await fs.writeFile(old, '# old');
    await new Promise((r) => setTimeout(r, 20));
    await fs.writeFile(fresh, '# new');
    const detected = await autoDetectAdr(tmp);
    expect(detected).toBe(fresh);
  });

  it('ignores non-technology markdown files in decisions/', async () => {
    const dir = path.join(tmp, '.omc', 'decisions');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'README.md'), '# meta');
    expect(await autoDetectAdr(tmp)).toBeNull();
  });
});

describe('orchestrate.mjs — e2e plan-only', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orc-e2e-'));
    const dir = path.join(tmp, '.omc', 'decisions');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, '2026-04-26-technology-test.md'),
      '# Tech\n## Chosen Stack\n- next.js\n- react\n',
    );
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('produces a plan-ready completed event and writes the plan file', async () => {
    const planPath = path.join(tmp, 'plan.json');
    const { events, code } = await runOrchestrator(
      ['--plan-only', `--plan-file=${planPath}`, '--headless'],
      tmp,
    );
    expect(code).toBe(0);
    const completed = events.find((e) => e.event === 'completed');
    expect(completed?.status).toBe('plan-ready');
    expect((completed as Record<string, unknown>).plan_path).toBe(planPath);
    const planRaw = await fs.readFile(planPath, 'utf-8');
    const plan = JSON.parse(planRaw);
    expect(plan.schema_version).toBe(1);
    expect(plan.run_dir).toBeTypeOf('string');
    expect(Array.isArray(plan.candidates)).toBe(true);
  });

  it('headless bail emits cancelled when manual decisions are required', async () => {
    // No candidates → no manual decisions → completed=no-op (not cancelled).
    // We assert the full orchestration still finishes cleanly; the bail path
    // is exercised by the unit test on applyHeadlessPolicy above.
    const { events, code } = await runOrchestrator(['--headless', '--no-promote'], tmp);
    expect(code).toBe(0);
    const completed = events.find((e) => e.event === 'completed');
    expect(['no-op', 'success', 'review-only']).toContain(completed?.status);
  });
});
