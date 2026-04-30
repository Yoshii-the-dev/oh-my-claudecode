/**
 * `omc state-hygiene` — find and optionally untrack runtime .omc state.
 */

import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { colors, renderTable } from '../utils/formatting.js';

export interface StateHygieneCommandOptions {
  apply?: boolean;
  json?: boolean;
}

export interface StateHygieneReport {
  ok: boolean;
  root: string;
  gitRoot: string | null;
  applied: boolean;
  trackedRuntimeFileCount: number;
  trackedRuntimeFiles: string[];
  issues: Array<{
    severity: 'error' | 'warning';
    code: string;
    message: string;
  }>;
}

interface LoggerLike {
  log: (message?: unknown) => void;
  error: (message?: unknown) => void;
}

const ROOT_RUNTIME_DIRECTORIES = new Set(['logs', 'sessions', 'state', 'telemetry']);
const ROOT_RUNTIME_FILES = new Set([
  '.fingerprint-history.json',
  'notepad.md',
  'project-memory.json',
]);

export async function stateHygieneCommand(
  root: string | undefined,
  options: StateHygieneCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const report = runStateHygiene(root, { apply: options.apply === true });
  logger.log(options.json ? JSON.stringify(report, null, 2) : renderStateHygieneReport(report));
  return report.ok ? 0 : 1;
}

export function runStateHygiene(
  root: string | undefined,
  options: Pick<StateHygieneCommandOptions, 'apply'> = {},
): StateHygieneReport {
  const report = inspectStateHygiene(root);

  if (options.apply && report.gitRoot && report.trackedRuntimeFiles.length > 0) {
    try {
      untrackFiles(report.gitRoot, report.trackedRuntimeFiles);
      report.applied = true;
      report.trackedRuntimeFiles = listTrackedRuntimeFiles(report.gitRoot);
      report.trackedRuntimeFileCount = report.trackedRuntimeFiles.length;
      report.ok = report.trackedRuntimeFileCount === 0;
      report.issues = report.ok ? [] : [trackedRuntimeStateIssue()];
    } catch (error) {
      report.ok = false;
      report.issues.push({
        severity: 'error',
        code: 'git-rm-cached-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}

export function inspectStateHygiene(root: string | undefined): StateHygieneReport {
  const resolvedRoot = resolve(root ?? process.cwd());
  const gitRoot = findGitRoot(resolvedRoot);
  if (!gitRoot) {
    return {
      ok: false,
      root: resolvedRoot,
      gitRoot: null,
      applied: false,
      trackedRuntimeFileCount: 0,
      trackedRuntimeFiles: [],
      issues: [{
        severity: 'error',
        code: 'not-a-git-repository',
        message: 'Root is not inside a git repository.',
      }],
    };
  }

  const trackedRuntimeFiles = listTrackedRuntimeFiles(gitRoot);
  return {
    ok: trackedRuntimeFiles.length === 0,
    root: resolvedRoot,
    gitRoot,
    applied: false,
    trackedRuntimeFileCount: trackedRuntimeFiles.length,
    trackedRuntimeFiles,
    issues: trackedRuntimeFiles.length === 0 ? [] : [trackedRuntimeStateIssue()],
  };
}

export function isOmcRuntimeStatePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/').filter(Boolean);
  const firstOmcIndex = segments.indexOf('.omc');
  if (firstOmcIndex === -1) return false;

  // Package-level .omc directories are generated workspace/runtime state.
  if (firstOmcIndex > 0) return true;

  // Nested .omc trees under the root .omc directory are runtime scratch state
  // from generated competitors, workers, or package probes.
  if (segments.indexOf('.omc', 1) !== -1) return true;

  const secondSegment = segments[1];
  if (!secondSegment) return false;
  if (ROOT_RUNTIME_DIRECTORIES.has(secondSegment)) return true;
  if (segments.length === 2 && ROOT_RUNTIME_FILES.has(secondSegment)) return true;

  return false;
}

function findGitRoot(root: string): string | null {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function listTrackedRuntimeFiles(gitRoot: string): string[] {
  const raw = execFileSync('git', ['-C', gitRoot, 'ls-files', '-z'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return raw
    .split('\0')
    .filter(Boolean)
    .filter(isOmcRuntimeStatePath)
    .sort((a, b) => a.localeCompare(b));
}

function untrackFiles(gitRoot: string, paths: string[]): void {
  const chunkSize = 100;
  for (let index = 0; index < paths.length; index += chunkSize) {
    const chunk = paths.slice(index, index + chunkSize);
    execFileSync('git', ['-C', gitRoot, 'rm', '--cached', '--ignore-unmatch', '--', ...chunk], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
}

function trackedRuntimeStateIssue(): StateHygieneReport['issues'][number] {
  return {
    severity: 'error',
    code: 'tracked-runtime-state',
    message: 'OMC runtime state is tracked by git. Re-run with --apply to remove it from the index while keeping files on disk.',
  };
}

function renderStateHygieneReport(report: StateHygieneReport): string {
  const lines = [
    colors.bold('OMC state hygiene'),
    `root: ${report.root}`,
    `gitRoot: ${report.gitRoot ?? 'none'}`,
    `trackedRuntimeFiles: ${report.trackedRuntimeFileCount}`,
  ];

  if (report.trackedRuntimeFiles.length > 0) {
    lines.push('');
    lines.push(renderTable(report.trackedRuntimeFiles.map((path) => ({ path })), [
      { header: 'tracked runtime path', field: 'path', width: 100 },
    ]));
  }

  if (report.issues.length > 0) {
    lines.push('');
    lines.push(renderTable(report.issues.map((issue) => ({
      severity: issue.severity === 'error' ? colors.red(issue.severity) : colors.yellow(issue.severity),
      code: issue.code,
      message: issue.message,
    })), [
      { header: 'severity', field: 'severity', width: 10 },
      { header: 'code', field: 'code', width: 26 },
      { header: 'message', field: 'message', width: 90 },
    ]));
  }

  lines.push('');
  if (report.ok) {
    lines.push(colors.green(report.applied ? 'Pass: runtime state removed from git index.' : 'Pass: no runtime state is tracked.'));
  } else {
    lines.push(colors.red('Fail: tracked runtime state found.'));
  }
  return lines.join('\n');
}
