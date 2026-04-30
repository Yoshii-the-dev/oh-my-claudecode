import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectProjectDoctor,
  projectDoctorCommand,
} from '../commands/project-doctor.js';

let rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    rmSync(root, { recursive: true, force: true });
  }
  rootsToClean = [];
});

describe('project doctor command', () => {
  it('fails when OMC runtime state is tracked by git', () => {
    const root = createGitRoot();
    writeArtifact(root, '.omc/state/session.json', '{}\n');
    writeArtifact(root, '.omc/portfolio/current.json', '{}\n');
    git(root, ['add', '.']);

    const report = inspectProjectDoctor(root);

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'state-hygiene',
      status: 'fail',
    }));
    expect(report.checks).toContainEqual(expect.objectContaining({
      id: 'runtime-qa',
      status: 'skipped',
    }));
  });

  it('can apply state hygiene while leaving product artifacts tracked', () => {
    const root = createGitRoot();
    writeArtifact(root, '.omc/project-memory.json', '{}\n');
    writeArtifact(root, '.omc/portfolio/current.json', '{}\n');
    git(root, ['add', '.']);

    const report = inspectProjectDoctor(root, { applyStateHygiene: true });

    expect(report.ok).toBe(true);
    expect(report.applied.stateHygiene).toBe(true);
    expect(git(root, ['ls-files'])).toBe('.omc/portfolio/current.json\n');
    expect(existsSync(join(root, '.omc/project-memory.json'))).toBe(true);
  });

  it('includes runtime QA setup steps in the aggregate report', async () => {
    const root = createGitRoot();
    writeArtifact(root, '.omc/runtime-qa.json', JSON.stringify({
      target: 'web',
      adapter: 'web-playwright',
      commands: { smoke: 'pnpm exec playwright test' },
    }));
    writeArtifact(root, 'pnpm-lock.yaml', '');
    const logger = captureLogger();

    const exitCode = await projectDoctorCommand(root, { json: true }, logger);
    const report = JSON.parse(logger.logs.join('\n')) as {
      ok: boolean;
      runtimeQaSetup?: {
        steps: Array<{ id: string; command?: string }>;
      };
    };

    expect(exitCode).toBe(1);
    expect(report.ok).toBe(false);
    expect(report.runtimeQaSetup?.steps).toEqual([
      expect.objectContaining({
        id: 'playwright-browsers-install',
        command: 'pnpm exec playwright install',
      }),
    ]);
  });
});

function createGitRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'omc-project-doctor-'));
  rootsToClean.push(root);
  git(root, ['init', '--quiet']);
  return root;
}

function writeArtifact(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function captureLogger(): { logs: string[]; log: (message?: unknown) => void } {
  const logs: string[] = [];
  return {
    logs,
    log: (message?: unknown) => logs.push(String(message ?? '')),
  };
}
