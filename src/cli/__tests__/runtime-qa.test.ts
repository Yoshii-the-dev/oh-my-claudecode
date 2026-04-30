import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runtimeQaFixtureCommand, runtimeQaMigrateCommand, runtimeQaSetupCommand } from '../commands/runtime-qa.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe('runtime QA CLI commands', () => {
  it('previews and writes canonical runtime QA migration', async () => {
    const root = createRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      platform: 'mobile',
      tooling: { framework: 'maestro' },
      flows: [{ id: 'smoke', path: '.maestro/smoke.yaml' }],
    }));
    const previewLogger = captureLogger();
    const writeLogger = captureLogger();

    const previewExit = await runtimeQaMigrateCommand(root, { json: true }, previewLogger);
    const writeExit = await runtimeQaMigrateCommand(root, { json: true, write: true }, writeLogger);
    const preview = JSON.parse(previewLogger.logs.join('\n')) as { changed: boolean; written: boolean };
    const written = JSON.parse(writeLogger.logs.join('\n')) as { changed: boolean; written: boolean };
    const migrated = JSON.parse(readFileSync(join(root, '.omc/runtime-qa.json'), 'utf-8')) as {
      target: string;
      commands: { smoke: string[] };
    };

    expect(previewExit).toBe(0);
    expect(writeExit).toBe(0);
    expect(preview).toMatchObject({ changed: true, written: false });
    expect(written.written).toBe(true);
    expect(migrated.target).toBe('mobile');
    expect(migrated.commands.smoke).toEqual(['maestro test .maestro/smoke.yaml']);
  });

  it('reports fixture provider backend readiness without running when env is missing', async () => {
    const root = createRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'mobile',
      adapter: 'mobile-maestro',
      fixtures: {
        disposableUser: {
          provider: 'supabase',
          strategy: 'auth-admin-user',
          backend: 'env',
        },
      },
    }));
    const logger = captureLogger();

    const exit = await runtimeQaFixtureCommand('provision', 'disposableUser', root, { json: true }, logger);
    const result = JSON.parse(logger.logs.join('\n')) as { ok: boolean; backend: string; reason: string };

    expect(exit).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.backend).toBe('env');
    expect(result.reason).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('returns an agent action for Claude-mediated Supabase MCP fixtures', async () => {
    const root = createRoot();
    writeArtifact(root, '.mcp.json', JSON.stringify({
      mcpServers: {
        supabase: { url: 'https://mcp.supabase.com/mcp' },
      },
    }));
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'mobile',
      adapter: 'mobile-maestro',
      fixtures: {
        disposableUser: {
          provider: 'supabase',
          strategy: 'auth-admin-user',
          backend: 'mcp',
        },
      },
    }));
    const logger = captureLogger();

    const exit = await runtimeQaFixtureCommand('provision', 'disposableUser', root, { json: true }, logger);
    const result = JSON.parse(logger.logs.join('\n')) as {
      ok: boolean;
      backend: string;
      agent_action?: {
        kind: string;
        transport: string;
        instructions: string[];
        safety: string[];
      };
    };

    expect(exit).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.backend).toBe('mcp');
    expect(result.agent_action).toMatchObject({
      kind: 'supabase-auth-admin-user',
      transport: 'claude-mcp',
    });
    expect(result.agent_action?.safety.join('\n')).toContain('Do not insert');
  });

  it('renders runtime QA setup plans as JSON', async () => {
    const root = createRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'web',
      adapter: 'web-playwright',
      commands: { smoke: 'pnpm exec playwright test' },
    }));
    writeArtifact(root, 'pnpm-lock.yaml', '');
    const logger = captureLogger();

    const exit = await runtimeQaSetupCommand(root, { json: true }, logger);
    const result = JSON.parse(logger.logs.join('\n')) as {
      steps: Array<{ id: string; command?: string }>;
    };

    expect(exit).toBe(0);
    expect(result.steps).toEqual([
      expect.objectContaining({
        id: 'playwright-browsers-install',
        command: 'pnpm exec playwright install',
      }),
    ]);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-runtime-qa-cli-'));
  roots.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function captureLogger(): { logs: string[]; errors: string[]; log: (message?: unknown) => void; error: (message?: unknown) => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (message?: unknown) => logs.push(String(message ?? '')),
    error: (message?: unknown) => errors.push(String(message ?? '')),
  };
}
