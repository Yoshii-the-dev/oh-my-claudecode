import { colors } from '../utils/formatting.js';
import {
  initRuntimeQaConfig,
  migrateRuntimeQaConfig,
  renderRuntimeQaRunReport,
  runRuntimeQa,
  writeRuntimeQaRunReport,
  type RuntimeQaConfig,
  type RuntimeQaCommandRunner,
} from '../../runtime-qa/runner.js';
import { loadConfig } from '../../config/loader.js';
import { limitFinalReport } from '../../lib/summary-policy.js';
import {
  provisionRuntimeQaFixture,
  teardownRuntimeQaFixture,
  type RuntimeQaFixtureProviderBackend,
} from '../../runtime-qa/fixture-providers.js';
import { setupRuntimeQaPrerequisites, type RuntimeQaSetupReport } from '../../runtime-qa/setup.js';

export interface RuntimeQaCommandOptions {
  auto?: boolean;
  dryRun?: boolean;
  json?: boolean;
  installMobileTools?: boolean;
  target?: string;
  write?: boolean;
  force?: boolean;
  backend?: string;
  apply?: boolean;
  commandRunner?: RuntimeQaCommandRunner;
}

interface LoggerLike {
  log: (message?: unknown) => void;
  error: (message?: unknown) => void;
}

export async function runtimeQaRunCommand(
  root: string | undefined,
  options: RuntimeQaCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const config = loadConfig();
  const report = runRuntimeQa({
    root,
    auto: options.auto,
    dryRun: options.dryRun,
    commandRunner: options.commandRunner,
    installMobileTools: options.installMobileTools,
    writeDetectedConfig: options.auto === true,
    summaryPolicy: config.summaryPolicy,
  });
  const written = options.dryRun ? undefined : writeRuntimeQaRunReport(root ?? process.cwd(), report);

  if (options.json) {
    logger.log(JSON.stringify({ report, written: written ?? null }, null, 2));
  } else {
    const rendered = renderRuntimeQaRunReport(report);
    logger.log(limitFinalReport(rendered, config.summaryPolicy));
    if (written) {
      logger.log(colors.bold('Runtime QA report written:'));
      logger.log(`  ${written.jsonPath}`);
      logger.log(`  ${written.mdPath}`);
    }
  }

  return report.status === 'failed' || report.status === 'blocked' ? 1 : 0;
}

export async function runtimeQaInitCommand(
  root: string | undefined,
  options: RuntimeQaCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const target = normalizeTarget(options.target);
  if (options.target && !target) {
    logger.error(colors.red(`Invalid --target: ${options.target}`));
    logger.error(colors.gray('Valid targets: web, cli, service, mobile, project-script'));
    return 2;
  }

  const result = initRuntimeQaConfig({
    root,
    target,
    write: options.write !== false,
    force: options.force === true,
  });

  if (options.json) {
    logger.log(JSON.stringify(result, null, 2));
  } else {
    logger.log(colors.bold('Runtime QA config'));
    logger.log(`  path: ${result.path}`);
    logger.log(`  target: ${result.config.target ?? 'project-script'}`);
    logger.log(`  adapter: ${result.config.adapter ?? 'project-script'}`);
    logger.log(`  written: ${result.written}`);
    logger.log(`  reason: ${result.reason}`);
    if (!result.config.commands?.smoke && result.config.target === 'mobile') {
      logger.log(colors.yellow('  mobile smoke command was not detected; set commands.smoke or mobile.command before verify can pass.'));
    }
  }

  return result.config.target === 'mobile' && !result.config.commands?.smoke ? 1 : 0;
}

export async function runtimeQaMigrateCommand(
  root: string | undefined,
  options: RuntimeQaCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const result = migrateRuntimeQaConfig({
    root,
    write: options.write === true,
    force: options.force === true,
  });

  if (options.json) {
    logger.log(JSON.stringify(result, null, 2));
  } else {
    logger.log(colors.bold('Runtime QA migration'));
    logger.log(`  path: ${result.path}`);
    logger.log(`  existed: ${result.existed}`);
    logger.log(`  changed: ${result.changed}`);
    logger.log(`  written: ${result.written}`);
    logger.log(`  reason: ${result.reason}`);
    if (!result.written && result.changed) {
      logger.log(colors.yellow('  re-run with --write to update .omc/runtime-qa.json'));
    }
  }

  return 0;
}

export async function runtimeQaSetupCommand(
  root: string | undefined,
  options: RuntimeQaCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const report = setupRuntimeQaPrerequisites(root, {
    apply: options.apply === true,
    commandRunner: options.commandRunner,
  });

  if (options.json) {
    logger.log(JSON.stringify(report, null, 2));
  } else {
    logger.log(renderRuntimeQaSetupReport(report));
  }

  return report.summary.failed > 0 ? 1 : 0;
}

export async function runtimeQaFixtureCommand(
  action: 'provision' | 'teardown',
  fixtureName: string,
  root: string | undefined,
  options: RuntimeQaCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const backend = normalizeFixtureBackend(options.backend);
  if (options.backend && !backend) {
    logger.error(colors.red(`Invalid --backend: ${options.backend}`));
    logger.error(colors.gray('Valid backends: auto, env, mcp'));
    return 2;
  }

  const result = action === 'provision'
    ? await provisionRuntimeQaFixture({ root, fixtureName, backend })
    : await teardownRuntimeQaFixture({ root, fixtureName, backend });

  if (options.json) {
    logger.log(JSON.stringify(result, null, 2));
  } else {
    logger.log(colors.bold(`Runtime QA fixture ${action}`));
    logger.log(`  fixture: ${result.fixture}`);
    logger.log(`  provider: ${result.provider}`);
    logger.log(`  backend: ${result.backend}`);
    logger.log(`  ok: ${result.ok}`);
    logger.log(`  reason: ${result.reason}`);
    logger.log(`  state: ${result.statePath}`);
    logger.log(`  env: ${result.envPath}`);
    if (result.agent_action) {
      logger.log(colors.yellow('  agent action: run this fixture through the Claude/OMC runtime-qa skill.'));
    }
  }

  return result.ok ? 0 : 1;
}

function normalizeTarget(value: string | undefined): RuntimeQaConfig['target'] | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'web'
    || normalized === 'cli'
    || normalized === 'service'
    || normalized === 'mobile'
    || normalized === 'project-script'
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeFixtureBackend(value: string | undefined): RuntimeQaFixtureProviderBackend | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'env' || normalized === 'mcp') return normalized;
  return undefined;
}

function renderRuntimeQaSetupReport(report: RuntimeQaSetupReport): string {
  const lines = [
    colors.bold('Runtime QA setup'),
    `root: ${report.root}`,
    `applied: ${report.applied}`,
  ];

  if (report.steps.length === 0) {
    lines.push(colors.green('No runtime QA prerequisite setup steps are needed.'));
    return lines.join('\n');
  }

  for (const step of report.steps) {
    const status = step.status === 'failed'
      ? colors.red(step.status)
      : step.status === 'passed'
        ? colors.green(step.status)
        : step.status;
    lines.push('');
    lines.push(`${colors.bold(step.title)} [${step.kind}] ${status}`);
    lines.push(`  reason: ${step.reason}`);
    if (step.command) lines.push(`  command: ${step.command}`);
    if (step.exit_code !== undefined) lines.push(`  exit_code: ${step.exit_code}`);
    if (step.stderr_preview) lines.push(`  stderr: ${step.stderr_preview}`);
  }

  if (!report.applied) {
    lines.push('');
    lines.push(colors.yellow('Re-run with --apply to execute command steps. Manual steps are always reported, not executed.'));
  }
  return lines.join('\n');
}
