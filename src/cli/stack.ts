/**
 * `omc stack` — CLI wrapper around skills/stack-provision/scripts/orchestrate.mjs.
 *
 * Phase 1 thin wrapper. Defaults to headless mode (CLI is the scripting path;
 * the chat slash command is the interactive path). Pretty-prints orchestrator
 * JSON events for humans, or pipes raw JSON when stdout is not a TTY (machine
 * consumers).
 */

import { spawn } from 'child_process';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

export const STACK_USAGE = `
Usage:
  omc stack [<adr-or-stack>]            Run plan + apply end-to-end (headless).
  omc stack plan [<adr-or-stack>]       Plan only — write plan file, exit.
  omc stack apply --plan-file=<path>    Apply a previously generated plan.

Common flags:
  --policy=<path>                       Override .omc/stack-provision-policy.json
  --skill-root=<path>                   Override default install root
  --no-promote                          Stop after review; skip promote/verify
  --raw                                 Emit raw JSON events (default when stdout is not a TTY)
  --plan-file=<path>                    File path for plan output / apply input
  --decisions-file=<path>               JSONL of decisions for apply
  --auto-mode=auto_approve_safe|bail    Override policy.headless_action

The CLI never prompts. For interactive review use the /stack-provision slash command.
`.trim();

interface ParsedCli {
  subcommand: 'run' | 'plan' | 'apply' | 'help';
  positional: string[];
  raw: boolean;
  forwardArgs: string[];
}

function parseCli(argv: string[]): ParsedCli {
  let subcommand: ParsedCli['subcommand'] = 'run';
  const positional: string[] = [];
  const forwardArgs: string[] = [];
  let raw = false;
  let consumedSubcommand = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!consumedSubcommand && (a === 'plan' || a === 'apply')) {
      subcommand = a;
      consumedSubcommand = true;
      continue;
    }
    if (!consumedSubcommand && (a === 'help' || a === '--help' || a === '-h')) {
      subcommand = 'help';
      consumedSubcommand = true;
      continue;
    }
    if (a === '--raw') {
      raw = true;
      continue;
    }
    if (a.startsWith('--')) {
      forwardArgs.push(a);
      const next = argv[i + 1];
      // Pass next token as value when it is not another flag (matches existing
      // argument shape used by orchestrate.mjs and provision.mjs).
      if (next !== undefined && !next.startsWith('--') && !a.includes('=')) {
        forwardArgs.push(next);
        i += 1;
      }
      continue;
    }
    positional.push(a);
  }

  return { subcommand, positional, raw, forwardArgs };
}

function getPackageRoot(): string {
  if (typeof __dirname !== 'undefined' && __dirname) {
    const currentDirName = basename(__dirname);
    const parentDirName = basename(dirname(__dirname));
    if (currentDirName === 'bridge') return join(__dirname, '..');
    if (currentDirName === 'cli' && (parentDirName === 'src' || parentDirName === 'dist')) {
      return join(__dirname, '..', '..');
    }
  }
  try {
    const filename = fileURLToPath(import.meta.url);
    return join(dirname(filename), '..', '..');
  } catch {
    return process.cwd();
  }
}

function resolveOrchestratorPath(packageRoot: string): string {
  const candidates = [
    join(packageRoot, 'skills', 'stack-provision', 'scripts', 'orchestrate.mjs'),
    join(packageRoot, '..', 'skills', 'stack-provision', 'scripts', 'orchestrate.mjs'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate);
  }
  return resolve(candidates[0]);
}

interface OrchestratorEvent {
  ts?: number;
  event: string;
  [key: string]: unknown;
}

function prettyEvent(evt: OrchestratorEvent): string | null {
  switch (evt.event) {
    case 'started':
      return chalk.gray(`stack-provision starting (project: ${evt.project_root as string})`);
    case 'phase': {
      const name = String(evt.name);
      const status = String(evt.status);
      if (status === 'started') return chalk.gray(`  → ${name}…`);
      if (status === 'completed') return chalk.green(`  ✓ ${name}`);
      if (status === 'failed') return chalk.red(`  ✗ ${name}: ${(evt.message as string) ?? 'failed'}`);
      return null;
    }
    case 'detect': {
      const source = String(evt.source);
      if (source === 'adr') return chalk.gray(`  detected ADR: ${evt.path as string}`);
      if (source === 'stack-list') return chalk.gray(`  using stack list: ${evt.stack as string}`);
      return chalk.yellow('  no stack source detected');
    }
    case 'review_summary': {
      const total = Number(evt.total ?? 0);
      const auto = Array.isArray(evt.auto_approve) ? evt.auto_approve.length : 0;
      const need = Array.isArray(evt.needs_decision) ? evt.needs_decision.length : 0;
      const rej = Array.isArray(evt.rejected) ? evt.rejected.length : 0;
      return chalk.cyan(
        `  review: ${total} candidates → ${auto} auto-approve, ${need} need decision, ${rej} rejected`,
      );
    }
    case 'install_plan': {
      const approved = Array.isArray(evt.approved) ? evt.approved.length : 0;
      const skipped = Array.isArray(evt.skipped) ? evt.skipped.length : 0;
      const editReq = Array.isArray(evt.edit_requested) ? evt.edit_requested.length : 0;
      return chalk.cyan(
        `  install plan: ${approved} approved, ${skipped} skipped, ${editReq} need edit`,
      );
    }
    case 'completed': {
      const status = String(evt.status);
      if (status === 'success') return chalk.green(`✓ done — ${(evt.manifest_path as string) ?? evt.run_dir}`);
      if (status === 'plan-ready') return chalk.green(`✓ plan ready — ${evt.plan_path as string}`);
      if (status === 'no-op') return chalk.yellow(`= no-op: ${evt.reason as string}`);
      if (status === 'cancelled') return chalk.yellow(`= cancelled: ${evt.reason as string}`);
      if (status === 'paused-for-edits') {
        const edits = Array.isArray(evt.edit_paths) ? (evt.edit_paths as string[]) : [];
        return chalk.yellow(
          `= paused — edit then re-run:\n${edits.map((p) => `    ${p}`).join('\n')}`,
        );
      }
      if (status === 'partial')
        return chalk.yellow(`= partial: verify failed; manifest at ${evt.manifest_path as string}`);
      if (status === 'review-only') return chalk.green(`✓ review only — ${evt.run_dir as string}`);
      return chalk.gray(`completed: ${status}`);
    }
    case 'error':
      return chalk.red(`✗ error: ${evt.message as string}`);
    default:
      return null;
  }
}

function buildOrchestratorArgs(parsed: ParsedCli): { args: string[]; explicitMode?: 'plan' | 'apply' } {
  const args: string[] = [];
  if (parsed.subcommand === 'plan') args.push('--plan-only');
  if (parsed.subcommand === 'apply') args.push('--apply');
  for (const a of parsed.forwardArgs) args.push(a);
  for (const p of parsed.positional) args.push(p);
  if (!args.includes('--headless') && !args.includes('--interactive')) args.push('--headless');
  return { args };
}

export async function stackCommand(argv: string[]): Promise<void> {
  const parsed = parseCli(argv);
  if (parsed.subcommand === 'help') {
    process.stdout.write(`${STACK_USAGE}\n`);
    return;
  }

  const packageRoot = getPackageRoot();
  const orchestrator = resolveOrchestratorPath(packageRoot);
  if (!existsSync(orchestrator)) {
    process.stderr.write(
      chalk.red(`[omc stack] orchestrator not found at ${orchestrator}.\n`) +
        'Re-install or rebuild the package, or run from a development checkout.\n',
    );
    process.exit(1);
    return;
  }

  const { args } = buildOrchestratorArgs(parsed);
  const useRaw = parsed.raw || !process.stdout.isTTY;

  return new Promise<void>((resolveExit, reject) => {
    const proc = spawn(process.execPath, [orchestrator, ...args], {
      stdio: useRaw ? 'inherit' : ['inherit', 'pipe', 'inherit'],
    });

    if (!useRaw && proc.stdout) {
      let buf = '';
      proc.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf-8');
        let nl = buf.indexOf('\n');
        while (nl >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          nl = buf.indexOf('\n');
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as OrchestratorEvent;
            const rendered = prettyEvent(evt);
            if (rendered) process.stdout.write(`${rendered}\n`);
          } catch {
            process.stdout.write(`${line}\n`);
          }
        }
      });
      proc.stdout.on('end', () => {
        if (buf.trim()) process.stdout.write(`${buf}\n`);
      });
    }

    proc.on('error', (err) => reject(err));
    proc.on('exit', (code) => {
      if (code === 0) resolveExit();
      else process.exit(code ?? 1);
    });
  });
}

export const __testing = { parseCli, prettyEvent, buildOrchestratorArgs, resolveOrchestratorPath };
