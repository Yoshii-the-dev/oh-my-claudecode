import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { setupRuntimeQaPrerequisites } from '../setup.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe('runtime QA setup', () => {
  it('plans safe command steps and manual mobile platform steps from doctor findings', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'mobile',
      adapter: 'mobile-maestro',
      commands: {
        build: ['pnpm --filter mobile ios', 'pnpm --filter mobile android'],
        smoke: 'maestro test .maestro/smoke.yaml',
      },
    }));

    const report = setupRuntimeQaPrerequisites(root, {
      platform: 'darwin',
      env: {},
      toolDetector: (tool) => ({ tool, detected: false, method: 'test' }),
      commandRunner: () => ({ status: 1, stdout: '', stderr: 'missing' }),
    });

    expect(report.applied).toBe(false);
    expect(report.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'java-17-install', kind: 'command', command: 'brew install openjdk@17' }),
      expect.objectContaining({ id: 'maestro-tap', kind: 'command' }),
      expect.objectContaining({ id: 'maestro-install', kind: 'command' }),
      expect.objectContaining({ id: 'xcode-install', kind: 'manual' }),
      expect.objectContaining({ id: 'ios-simulator-install', kind: 'manual' }),
      expect.objectContaining({ id: 'android-sdk-install', kind: 'manual' }),
    ]));
  });

  it('applies command steps but skips manual steps', () => {
    const root = createRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'mobile',
      adapter: 'mobile-maestro',
      commands: {
        build: 'pnpm --filter mobile android',
        smoke: 'maestro test .maestro/smoke.yaml',
      },
    }));
    const calls: string[] = [];

    const report = setupRuntimeQaPrerequisites(root, {
      apply: true,
      platform: 'darwin',
      env: {},
      toolDetector: (tool) => ({ tool, detected: false, method: 'test' }),
      commandRunner: (command) => {
        calls.push(command);
        return command.startsWith('brew')
          ? { status: 0, stdout: 'ok', stderr: '' }
          : { status: 1, stdout: '', stderr: 'missing' };
      },
    });

    expect(calls.filter((command) => command.startsWith('brew'))).toEqual([
      'brew install openjdk@17',
      'brew tap mobile-dev-inc/tap',
      'brew install mobile-dev-inc/tap/maestro',
    ]);
    expect(report.steps.find((step) => step.id === 'android-sdk-install')?.status).toBe('skipped');
    expect(report.summary.failed).toBe(0);
  });

  it('plans Playwright browser installation for web runtime QA', () => {
    const root = createRoot();
    writeArtifact(root, 'pnpm-lock.yaml', '');
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'web',
      adapter: 'web-playwright',
      commands: { smoke: 'pnpm exec playwright test' },
    }));

    const report = setupRuntimeQaPrerequisites(root);

    expect(report.steps).toEqual([
      expect.objectContaining({
        id: 'playwright-browsers-install',
        command: 'pnpm exec playwright install',
      }),
    ]);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-runtime-qa-setup-'));
  roots.push(root);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}
