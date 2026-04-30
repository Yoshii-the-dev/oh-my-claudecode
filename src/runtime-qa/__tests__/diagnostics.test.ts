import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnoseRuntimeQa } from '../diagnostics.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe('runtime QA diagnostics', () => {
  it('flags missing destructive fixture provisioning', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'project-script',
      commands: { smoke: 'npm run smoke' },
      fixtures: {
        signedInUser: { provisioning: 'manual login' },
      },
      flows: [
        {
          id: 'delete-account',
          path: '.maestro/delete-account.yaml',
          fixture: 'signedInUser',
          destructive: true,
        },
      ],
    }));

    const report = diagnoseRuntimeQa(root);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('runtime-qa-destructive-fixture-missing');
  });

  it('does not treat prose-only destructive fixture notes as executable provisioning', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'project-script',
      commands: { smoke: 'npm run smoke' },
      fixtures: {
        disposableUser: {
          provisioning: 'Each run MUST create a fresh user via Supabase Auth admin API; cycle-5+ should script this.',
        },
      },
      flows: [
        {
          id: 'delete-account',
          path: '.maestro/delete-account.yaml',
          fixture: 'disposableUser',
          destructive: true,
        },
      ],
    }));

    const report = diagnoseRuntimeQa(root);

    expect(report.destructiveFlows).toEqual([
      expect.objectContaining({ id: 'delete-account', provisioned: false }),
    ]);
    expect(report.issues.map((issue) => issue.code)).toContain('runtime-qa-destructive-fixture-missing');
  });

  it('accepts destructive fixture provisioning only when an executable command is declared', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'project-script',
      commands: { smoke: 'npm run smoke' },
      fixtures: {
        disposableUser: {
          provision_command: 'node scripts/runtime-qa/create-disposable-user.mjs',
        },
      },
      flows: [
        {
          id: 'delete-account',
          path: '.maestro/delete-account.yaml',
          fixture: 'disposableUser',
          destructive: true,
        },
      ],
    }));

    const report = diagnoseRuntimeQa(root);

    expect(report.destructiveFlows).toEqual([
      expect.objectContaining({ id: 'delete-account', provisioned: true }),
    ]);
    expect(report.issues.map((issue) => issue.code)).not.toContain('runtime-qa-destructive-fixture-missing');
  });

  it('accepts declarative Supabase auth-admin fixtures when env backend is available', () => {
    const root = createRoot();
    writeArtifact(root, '.env', 'SUPABASE_URL=https://example.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=service-role\n');
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'project-script',
      commands: { smoke: 'npm run smoke' },
      fixtures: {
        disposableUser: {
          provider: 'supabase',
          strategy: 'auth-admin-user',
          backend: 'env',
        },
      },
      flows: [
        {
          id: 'delete-account',
          path: '.maestro/delete-account.yaml',
          fixture: 'disposableUser',
          destructive: true,
        },
      ],
    }));

    const report = diagnoseRuntimeQa(root);

    expect(report.destructiveFlows).toEqual([
      expect.objectContaining({
        id: 'delete-account',
        provider: 'supabase',
        backend: 'env',
        provisioned: true,
      }),
    ]);
    expect(report.issues.map((issue) => issue.code)).not.toContain('runtime-qa-destructive-fixture-missing');
  });

  it('flags declarative Supabase auth-admin fixtures when no backend is available', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'project-script',
      commands: { smoke: 'npm run smoke' },
      fixtures: {
        disposableUser: {
          provider: 'supabase',
          strategy: 'auth-admin-user',
          backend: 'env',
        },
      },
      flows: [
        {
          id: 'delete-account',
          path: '.maestro/delete-account.yaml',
          fixture: 'disposableUser',
          destructive: true,
        },
      ],
    }));

    const report = diagnoseRuntimeQa(root);

    expect(report.destructiveFlows).toEqual([
      expect.objectContaining({
        id: 'delete-account',
        provider: 'supabase',
        backend: 'env',
        provisioned: false,
      }),
    ]);
    expect(report.issues.map((issue) => issue.code)).toContain('runtime-qa-destructive-fixture-missing');
  });

  it('separates Claude-mediated Supabase MCP fixtures from missing provisioning', () => {
    const root = createRoot();
    writeArtifact(root, '.mcp.json', JSON.stringify({
      mcpServers: {
        supabase: { url: 'https://mcp.supabase.com/mcp' },
      },
    }));
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'project-script',
      commands: { smoke: 'npm run smoke' },
      fixtures: {
        disposableUser: {
          provider: 'supabase',
          strategy: 'auth-admin-user',
          backend: 'auto',
        },
      },
      flows: [
        {
          id: 'delete-account',
          path: '.maestro/delete-account.yaml',
          fixture: 'disposableUser',
          destructive: true,
        },
      ],
    }));

    const report = diagnoseRuntimeQa(root);
    const issueCodes = report.issues.map((issue) => issue.code);

    expect(report.destructiveFlows).toEqual([
      expect.objectContaining({
        id: 'delete-account',
        provider: 'supabase',
        backend: 'mcp',
        provisioned: false,
        requiresAgentMcp: true,
      }),
    ]);
    expect(issueCodes).toContain('runtime-qa-fixture-agent-mcp-required');
    expect(issueCodes).not.toContain('runtime-qa-destructive-fixture-missing');
  });

  it('checks mobile platform readiness for iOS and Android runtime QA', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'mobile',
      adapter: 'mobile-maestro',
      commands: {
        build: ['pnpm --filter mobile ios', 'pnpm --filter mobile android'],
        smoke: 'maestro test .maestro/smoke.yaml',
      },
    }));

    const report = diagnoseRuntimeQa(root, {
      platform: 'darwin',
      env: {},
      toolDetector: (tool) => ({ tool, detected: true, method: 'test' }),
      commandRunner: (command) => {
        if (command === 'java -version') {
          return { status: 0, stderr: 'openjdk version "17.0.10" 2024-01-01' };
        }
        return { status: 1, stdout: '', stderr: 'missing' };
      },
    });
    const issueCodes = report.issues.map((issue) => issue.code);

    expect(report.platformChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'java-17', detected: true }),
      expect.objectContaining({ id: 'xcode', detected: false }),
      expect.objectContaining({ id: 'ios-simulator', detected: false }),
      expect.objectContaining({ id: 'android-sdk', detected: false }),
      expect.objectContaining({ id: 'android-emulator', detected: false }),
    ]));
    expect(issueCodes).toEqual(expect.arrayContaining([
      'runtime-qa-missing-xcode',
      'runtime-qa-missing-ios-simulator',
      'runtime-qa-missing-android-sdk',
      'runtime-qa-missing-android-emulator',
    ]));
    expect(issueCodes).not.toContain('runtime-qa-missing-java-17');
  });

  it('flags stale handoff and stale flow specs for the active cycle', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/cycles/current.md', 'cycle_id: 2026-04-30-current\ncycle_stage: complete\n');
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'project-script',
      commands: { smoke: 'npm run smoke' },
      flows: [
        {
          id: 'old-smoke',
          path: '.maestro/old.yaml',
          spec: '.omc/cycles/2026-04-29-old.md',
        },
      ],
    }));
    writeArtifact(root, '.omc/handoffs/runtime-qa/current.json', JSON.stringify({
      status: 'passed',
      dry_run: false,
      cycle_id: '2026-04-29-old',
    }));

    const report = diagnoseRuntimeQa(root);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'runtime-qa-handoff-stale-cycle',
      'runtime-qa-flow-spec-stale-cycle',
    ]));
  });

  it('flags passed handoffs without cycle identity when an active cycle exists', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/cycles/current.md', 'cycle_id: 2026-04-30-current\ncycle_stage: verify\n');
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'project-script',
      commands: { smoke: 'npm run smoke' },
    }));
    writeArtifact(root, '.omc/handoffs/runtime-qa/current.json', JSON.stringify({
      status: 'passed',
      dry_run: false,
    }));

    const report = diagnoseRuntimeQa(root);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain('runtime-qa-handoff-cycle-missing');
  });

  it('passes executable project-script runtime QA with a passed current handoff', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/cycles/current.md', 'cycle_id: 2026-04-30-current\ncycle_stage: verify\n');
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'project-script',
      commands: { smoke: 'npm run smoke' },
    }));
    writeArtifact(root, '.omc/handoffs/runtime-qa/current.json', JSON.stringify({
      status: 'passed',
      dry_run: false,
      cycle_id: '2026-04-30-current',
    }));

    const report = diagnoseRuntimeQa(root);

    expect(report.ok).toBe(true);
    expect(report.summary.errors).toBe(0);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-runtime-qa-diagnostics-'));
  roots.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}
