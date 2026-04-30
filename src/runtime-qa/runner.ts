import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
import { truncateInlineLog, type SummaryPolicy } from '../lib/summary-policy.js';
import {
  providerLifecycleCommands,
  fixtureEnvFileRelative,
  resolveFixtureProvider,
  wrapCommandWithFixtureEnv,
  type RuntimeQaFixtureProvider,
  type RuntimeQaFixtureProviderBackend,
  type RuntimeQaFixtureStrategy,
} from './fixture-providers.js';

export type RuntimeQaAdapter =
  | 'project-script'
  | 'web-playwright'
  | 'cli-tmux'
  | 'mobile-maestro'
  | 'mobile-detox'
  | 'mobile-appium';

export type RuntimeQaMobileTool = 'maestro' | 'detox' | 'appium';
export type RuntimeQaPackageManager = 'auto' | 'npm' | 'pnpm' | 'yarn' | 'brew';
export type RuntimeQaStatus = 'passed' | 'partial-pass' | 'failed' | 'blocked' | 'noop' | 'dry-run';
export type RuntimeQaStepStatus = 'passed' | 'failed' | 'blocked' | 'skipped' | 'dry-run';

export interface RuntimeQaCommandSet {
  build?: string | string[];
  start?: string | string[];
  readiness?: string | string[];
  smoke?: string | string[];
  cleanup?: string | string[];
}

export interface RuntimeQaConfig {
  schema_version?: 1;
  target?: 'web' | 'cli' | 'service' | 'mobile' | 'project-script';
  adapter?: RuntimeQaAdapter;
  commands?: RuntimeQaCommandSet;
  timeout_ms?: number;
  artifacts_dir?: string;
  mobile?: {
    tool?: RuntimeQaMobileTool;
    command?: string;
    install?: {
      enabled?: boolean;
      manager?: RuntimeQaPackageManager;
      command?: string | string[];
    };
  };
  fixtures?: Record<string, RuntimeQaFixtureConfig>;
  flows?: RuntimeQaFlowConfig[];
  gates?: Record<string, unknown>;
  history?: Record<string, unknown>;
}

export interface RuntimeQaFixtureConfig {
  purpose?: string;
  provisioning?: string;
  provision_command?: string;
  teardown_command?: string;
  provider?: RuntimeQaFixtureProvider;
  strategy?: RuntimeQaFixtureStrategy;
  backend?: RuntimeQaFixtureProviderBackend;
  email_prefix?: string;
  email_env?: string;
  password_env?: string;
  user_id_env?: string;
}

export interface RuntimeQaFlowConfig {
  id?: string;
  path: string;
  fixture?: string;
  destructive?: boolean;
  verifies?: string[];
  spec?: string;
  expectedDurationSec?: number;
}

export interface LegacyRuntimeQaConfig {
  version?: unknown;
  platform?: unknown;
  tooling?: {
    framework?: unknown;
    installCommand?: unknown;
    platformRequirements?: Record<string, { buildCommand?: unknown } | undefined>;
  };
  flows?: Array<{
    id?: unknown;
    path?: unknown;
    fixture?: unknown;
    destructive?: unknown;
    verifies?: unknown;
    spec?: unknown;
    expectedDurationSec?: unknown;
  }>;
  fixtures?: Record<string, RuntimeQaFixtureConfig | undefined>;
  gates?: Record<string, unknown>;
  history?: Record<string, unknown>;
}

export interface RuntimeQaToolDetection {
  tool: RuntimeQaMobileTool;
  detected: boolean;
  method: string;
  command?: string;
  version?: string;
  missing_prerequisite?: 'java-17';
  reason?: string;
}

export interface RuntimeQaStepResult {
  name: string;
  command?: string;
  status: RuntimeQaStepStatus;
  exit_code?: number | null;
  signal?: string | null;
  reason: string;
  stdout_artifact?: string;
  stderr_artifact?: string;
  stdout_preview?: string;
  stderr_preview?: string;
}

export interface RuntimeQaRunReport {
  schema_version: 1;
  produced_at: string;
  agent_role: 'runtime-qa-runner';
  cycle_id?: string;
  status: RuntimeQaStatus;
  root: string;
  config_path: string;
  config_exists: boolean;
  adapter: RuntimeQaAdapter;
  auto: boolean;
  dry_run: boolean;
  artifact_dir: string;
  install_proposal?: string;
  tool_detection?: RuntimeQaToolDetection;
  step_results: RuntimeQaStepResult[];
}

export interface RuntimeQaRunReportWriteResult {
  jsonPath: string;
  mdPath: string;
}

export interface CommandRunResult {
  status: number | null;
  signal?: NodeJS.Signals | string | null;
  error?: Error;
  stdout?: string;
  stderr?: string;
}

export type RuntimeQaCommandRunner = (command: string, cwd: string, timeoutMs: number) => CommandRunResult;
export type RuntimeQaToolDetector = (tool: RuntimeQaMobileTool, root: string) => RuntimeQaToolDetection;

interface RuntimeQaResolvedCommand {
  name: string;
  command: string;
  lifecycle?: 'provision' | 'teardown';
  flowKey?: string;
  skipReason?: string;
}

export interface RunRuntimeQaOptions {
  root?: string;
  auto?: boolean;
  dryRun?: boolean;
  config?: RuntimeQaConfig;
  commandRunner?: RuntimeQaCommandRunner;
  installMobileTools?: boolean;
  writeDetectedConfig?: boolean;
  toolDetector?: RuntimeQaToolDetector;
  summaryPolicy?: Partial<SummaryPolicy>;
}

export interface RuntimeQaInitResult {
  root: string;
  path: string;
  config: RuntimeQaConfig;
  existed: boolean;
  written: boolean;
  reason: string;
}

export interface RuntimeQaMigrateResult {
  root: string;
  path: string;
  existed: boolean;
  changed: boolean;
  written: boolean;
  config: RuntimeQaConfig;
  reason: string;
}

export const RUNTIME_QA_CONFIG_RELATIVE_PATH = '.omc/runtime-qa.json';
export const RUNTIME_QA_HANDOFF_RELATIVE_PATH = '.omc/handoffs/runtime-qa/current.json';

const RUNTIME_QA_HANDOFF_MD_RELATIVE_PATH = '.omc/handoffs/runtime-qa/current.md';
const DEFAULT_TIMEOUT_MS = 120_000;

export function shouldRunRuntimeQa(root = process.cwd()): boolean {
  if (existsSync(resolve(root, RUNTIME_QA_CONFIG_RELATIVE_PATH))) return true;
  const cyclePath = resolve(root, '.omc/cycles/current.md');
  if (!existsSync(cyclePath)) return false;
  try {
    const content = readFileSync(cyclePath, 'utf-8');
    return /\b(runtime-qa|simulator|emulator|smoke|playwright|maestro|detox|appium|ios|android)\b/i.test(content);
  } catch {
    return false;
  }
}

export function readRuntimeQaConfig(root = process.cwd()): RuntimeQaConfig | undefined {
  const path = resolve(root, RUNTIME_QA_CONFIG_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  return normalizeRuntimeQaConfig(readRuntimeQaConfigRaw(root) as RuntimeQaConfig | LegacyRuntimeQaConfig);
}

export function readRuntimeQaConfigRaw(root = process.cwd()): RuntimeQaConfig | LegacyRuntimeQaConfig | undefined {
  const path = resolve(root, RUNTIME_QA_CONFIG_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf-8')) as RuntimeQaConfig | LegacyRuntimeQaConfig;
}

export function detectRuntimeQaConfig(
  root = process.cwd(),
  target?: RuntimeQaConfig['target'],
): RuntimeQaConfig {
  const resolvedRoot = resolve(root);
  const inferredTarget = target ?? inferRuntimeQaTarget(resolvedRoot);
  if (inferredTarget === 'mobile') {
    const adapter = inferMobileAdapter(resolvedRoot);
    const smoke = detectMobileSmokeCommand(adapter, resolvedRoot);
    return {
      schema_version: 1,
      target: 'mobile',
      adapter,
      commands: smoke ? { smoke } : undefined,
      mobile: { tool: mobileToolForAdapter(adapter, undefined) },
    };
  }

  if (inferredTarget === 'web') {
    const smoke = detectWebSmokeCommand(resolvedRoot);
    return {
      schema_version: 1,
      target: 'web',
      adapter: 'web-playwright',
      commands: smoke ? { smoke } : undefined,
    };
  }

  const smoke = detectProjectSmokeCommand(resolvedRoot);
  return {
    schema_version: 1,
    target: inferredTarget ?? 'project-script',
    adapter: inferredTarget === 'cli' || inferredTarget === 'service' ? 'cli-tmux' : 'project-script',
    commands: smoke ? { smoke } : undefined,
  };
}

export function initRuntimeQaConfig(options: {
  root?: string;
  target?: RuntimeQaConfig['target'];
  write?: boolean;
  force?: boolean;
} = {}): RuntimeQaInitResult {
  const root = resolve(options.root ?? process.cwd());
  const path = resolve(root, RUNTIME_QA_CONFIG_RELATIVE_PATH);
  const existed = existsSync(path);
  const config = existed && !options.force
    ? readRuntimeQaConfig(root) ?? detectRuntimeQaConfig(root, options.target)
    : detectRuntimeQaConfig(root, options.target);
  const written = options.write === true && (!existed || options.force === true);
  if (written) {
    ensureDirSync(dirname(path));
    atomicWriteJsonSync(path, config);
  }
  return {
    root,
    path,
    config,
    existed,
    written,
    reason: existed && !options.force
      ? 'Existing runtime QA config preserved.'
      : 'Runtime QA config detected from project files and scripts.',
  };
}

export function migrateRuntimeQaConfig(options: {
  root?: string;
  write?: boolean;
  force?: boolean;
} = {}): RuntimeQaMigrateResult {
  const root = resolve(options.root ?? process.cwd());
  const path = resolve(root, RUNTIME_QA_CONFIG_RELATIVE_PATH);
  const raw = readRuntimeQaConfigRaw(root);
  const existed = Boolean(raw);
  const config = raw ? normalizeRuntimeQaConfig(raw) : detectRuntimeQaConfig(root);
  const changed = !raw || JSON.stringify(raw, null, 2) !== JSON.stringify(config, null, 2);
  const written = options.write === true && (changed || options.force === true);
  if (written) {
    ensureDirSync(dirname(path));
    atomicWriteJsonSync(path, config);
  }
  return {
    root,
    path,
    existed,
    changed,
    written,
    config,
    reason: raw
      ? changed
        ? 'Runtime QA config can be migrated to the canonical schema.'
        : 'Runtime QA config already uses the canonical schema.'
      : 'Runtime QA config detected from project files and scripts.',
  };
}

export function runRuntimeQa(options: RunRuntimeQaOptions = {}): RuntimeQaRunReport {
  const root = resolve(options.root ?? process.cwd());
  const activeCycleId = readActiveCycleId(root);
  const configPath = resolve(root, RUNTIME_QA_CONFIG_RELATIVE_PATH);
  const explicitConfig = options.config ?? readRuntimeQaConfig(root);
  const configExists = Boolean(options.config || existsSync(configPath));
  const config = explicitConfig ?? detectRuntimeQaConfig(root);
  if (!configExists && options.writeDetectedConfig === true && config.commands && options.dryRun !== true) {
    ensureDirSync(dirname(configPath));
    atomicWriteJsonSync(configPath, config);
  }
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = resolve(root, config?.artifacts_dir ?? `.omc/artifacts/runtime-qa/${runId}`);
  const dryRun = options.dryRun === true;
  const adapterResolution = resolveAdapter(root, config, {
    dryRun,
    installMobileTools: options.installMobileTools === true,
    toolDetector: options.toolDetector ?? defaultToolDetector,
  });
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const timeoutMs = config?.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const stepResults: RuntimeQaStepResult[] = [];

  if (adapterResolution.blocked) {
    return {
      schema_version: 1,
      produced_at: new Date().toISOString(),
      agent_role: 'runtime-qa-runner',
      cycle_id: activeCycleId,
      status: 'blocked',
      root,
      config_path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
      config_exists: configExists,
      adapter: adapterResolution.adapter,
      auto: options.auto === true,
      dry_run: dryRun,
      artifact_dir: artifactDir,
      install_proposal: adapterResolution.installProposal,
      tool_detection: adapterResolution.toolDetection,
      step_results: [{
        name: 'adapter',
        status: 'blocked',
        reason: adapterResolution.reason,
      }],
    };
  }

  if (adapterResolution.provisionCommands.length > 0) {
    for (const command of adapterResolution.provisionCommands) {
      if (dryRun) {
        stepResults.push({
          name: command.name,
          command: command.command,
          status: 'dry-run',
          reason: 'Would install missing mobile runtime QA tooling.',
        });
        continue;
      }

      const result = commandRunner(command.command, root, timeoutMs);
      ensureDirSync(artifactDir);
      stepResults.push(commandResultToStep(command, result, artifactDir, options.summaryPolicy));
      if (result.error || result.status !== 0) {
        return {
          schema_version: 1,
          produced_at: new Date().toISOString(),
          agent_role: 'runtime-qa-runner',
          cycle_id: activeCycleId,
          status: 'failed',
          root,
          config_path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
          config_exists: configExists,
          adapter: adapterResolution.adapter,
          auto: options.auto === true,
          dry_run: dryRun,
          artifact_dir: artifactDir,
          install_proposal: adapterResolution.installProposal,
          tool_detection: adapterResolution.toolDetection,
          step_results: stepResults,
        };
      }
    }
  }

  const commands = withFixtureLifecycleCommands(
    root,
    config,
    commandsForAdapter(adapterResolution.adapter, config, root, adapterResolution.toolDetection),
  );
  const runnableCommands = commands.filter((command) => !isCleanupCommand(command.name));
  const cleanupCommands = commands.filter((command) => isCleanupCommand(command.name));
  if (commands.length === 0) {
    return {
      schema_version: 1,
      produced_at: new Date().toISOString(),
      agent_role: 'runtime-qa-runner',
      cycle_id: activeCycleId,
      status: 'noop',
      root,
      config_path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
      config_exists: configExists,
      adapter: adapterResolution.adapter,
      auto: options.auto === true,
      dry_run: dryRun,
      artifact_dir: artifactDir,
      install_proposal: adapterResolution.installProposal,
      tool_detection: adapterResolution.toolDetection,
      step_results: [{
        name: 'commands',
        status: 'skipped',
        reason: 'No runtime QA commands were configured or detected.',
      }],
    };
  }

  let failed = false;
  let partial = false;
  const startedFlows = new Set<string>();
  for (const command of runnableCommands) {
    if (failed && command.lifecycle !== 'teardown') continue;
    if (command.lifecycle === 'teardown' && command.flowKey && !startedFlows.has(command.flowKey)) {
      continue;
    }
    if (command.skipReason) {
      partial = true;
      stepResults.push({
        name: command.name,
        command: command.command,
        status: 'skipped',
        reason: command.skipReason,
      });
      continue;
    }
    if (command.flowKey && command.lifecycle !== 'teardown') startedFlows.add(command.flowKey);

    if (dryRun) {
      stepResults.push({
        name: command.name,
        command: command.command,
        status: 'dry-run',
        reason: runtimeQaDryRunReason(command),
      });
      continue;
    }

    const result = commandRunner(command.command, root, timeoutMs);
    ensureDirSync(artifactDir);
    const step = commandResultToStep(command, result, artifactDir, options.summaryPolicy);
    stepResults.push(step);

    if (step.status === 'failed') {
      failed = true;
    }
  }

  for (const command of cleanupCommands) {
    if (dryRun) {
      stepResults.push({
        name: command.name,
        command: command.command,
        status: 'dry-run',
        reason: failed
          ? 'Would run cleanup after a runtime QA failure.'
          : 'Would run runtime QA cleanup command.',
      });
      continue;
    }

    const result = commandRunner(command.command, root, timeoutMs);
    ensureDirSync(artifactDir);
    const step = commandResultToStep(command, result, artifactDir, options.summaryPolicy);
    stepResults.push(step);
    if (step.status === 'failed') failed = true;
  }

  return {
    schema_version: 1,
    produced_at: new Date().toISOString(),
    agent_role: 'runtime-qa-runner',
    cycle_id: activeCycleId,
    status: dryRun ? 'dry-run' : failed ? 'failed' : partial ? 'partial-pass' : 'passed',
    root,
    config_path: RUNTIME_QA_CONFIG_RELATIVE_PATH,
    config_exists: configExists,
    adapter: adapterResolution.adapter,
    auto: options.auto === true,
    dry_run: dryRun,
    artifact_dir: artifactDir,
    install_proposal: adapterResolution.installProposal,
    tool_detection: adapterResolution.toolDetection,
    step_results: stepResults,
  };
}

export function writeRuntimeQaRunReport(
  root: string,
  report: RuntimeQaRunReport,
): RuntimeQaRunReportWriteResult {
  const jsonPath = resolve(root, RUNTIME_QA_HANDOFF_RELATIVE_PATH);
  const mdPath = resolve(root, RUNTIME_QA_HANDOFF_MD_RELATIVE_PATH);
  ensureDirSync(dirname(jsonPath));
  atomicWriteJsonSync(jsonPath, report);
  atomicWriteFileSync(mdPath, renderRuntimeQaRunReport(report));
  return { jsonPath, mdPath };
}

export function renderRuntimeQaRunReport(report: RuntimeQaRunReport): string {
  const lines = [
    '# Runtime QA Report',
    '',
    `produced_at: ${report.produced_at}`,
    ...(report.cycle_id ? [`cycle_id: ${report.cycle_id}`] : []),
    `status: ${report.status}`,
    `adapter: ${report.adapter}`,
    `auto: ${report.auto}`,
    `dry_run: ${report.dry_run}`,
    `config_exists: ${report.config_exists}`,
    `artifact_dir: ${report.artifact_dir}`,
  ];

  if (report.install_proposal) {
    lines.push(`install_proposal: ${report.install_proposal}`);
  }
  if (report.tool_detection) {
    lines.push(`tool_detection: ${report.tool_detection.tool} ${report.tool_detection.detected ? 'detected' : 'missing'} (${report.tool_detection.method})`);
    if (report.tool_detection.missing_prerequisite) {
      lines.push(`missing_prerequisite: ${report.tool_detection.missing_prerequisite}`);
    }
    if (report.tool_detection.reason) {
      lines.push(`tool_detection_reason: ${report.tool_detection.reason}`);
    }
  }

  lines.push('', '## Steps');
  for (const step of report.step_results) {
    lines.push(`- ${step.name}: ${step.status}`);
    lines.push(`  - reason: ${step.reason}`);
    if (step.command) lines.push(`  - command: ${step.command}`);
    if (step.exit_code !== undefined) lines.push(`  - exit_code: ${step.exit_code}`);
    if (step.stdout_artifact) lines.push(`  - stdout_artifact: ${step.stdout_artifact}`);
    if (step.stderr_artifact) lines.push(`  - stderr_artifact: ${step.stderr_artifact}`);
  }

  lines.push('');
  lines.push('artifacts_written:');
  lines.push(`  - ${RUNTIME_QA_HANDOFF_RELATIVE_PATH}`);
  lines.push(`  - ${RUNTIME_QA_HANDOFF_MD_RELATIVE_PATH}`);
  lines.push('');
  return lines.join('\n');
}

function resolveAdapter(
  root: string,
  config: RuntimeQaConfig | undefined,
  options: {
    dryRun: boolean;
    installMobileTools: boolean;
    toolDetector: RuntimeQaToolDetector;
  },
): {
  adapter: RuntimeQaAdapter;
  blocked: boolean;
  reason: string;
  installProposal?: string;
  toolDetection?: RuntimeQaToolDetection;
  provisionCommands: Array<{ name: string; command: string }>;
} {
  const adapter = config?.adapter ?? defaultAdapterForTarget(config?.target);

  if (adapter === 'web-playwright' && !hasPlaywright(root) && !hasConfiguredSmoke(config)) {
    return {
      adapter,
      blocked: true,
      reason: 'web-playwright selected but no Playwright project config or smoke command was found.',
      installProposal: 'Install/configure Playwright or add .omc/runtime-qa.json commands.smoke.',
      provisionCommands: [],
    };
  }

  if (isMobileAdapter(adapter)) {
    const tool = mobileToolForAdapter(adapter, config);
    const toolDetection = options.toolDetector(tool, root);
    if (!hasMobileSmokeCommand(adapter, config, root)) {
      return {
        adapter,
        blocked: true,
        reason: `${adapter} selected but no mobile smoke command was configured or detected.`,
        installProposal: `Set commands.smoke or mobile.command in .omc/runtime-qa.json before running ${tool} simulator checks.`,
        toolDetection,
        provisionCommands: [],
      };
    }

    if (!toolDetection.detected) {
      const provisionCommands = mobileProvisionCommands(root, tool, config, toolDetection);
      const installProposal = mobileInstallProposal(tool, provisionCommands, toolDetection);
      if (options.dryRun) {
        return {
          adapter,
          blocked: false,
          reason: `${adapter} selected but ${tool} was not detected; dry-run will render the planned simulator commands only.`,
          installProposal,
          toolDetection,
          provisionCommands: options.installMobileTools ? provisionCommands : [],
        };
      }

      const installAllowed = options.installMobileTools || config?.mobile?.install?.enabled === true;
      if (installAllowed && provisionCommands.length > 0) {
        return {
          adapter,
          blocked: false,
          reason: `${tool} was not detected; provisioning is explicitly enabled.`,
          installProposal,
          toolDetection,
          provisionCommands,
        };
      }

      return {
        adapter,
        blocked: true,
        reason: `${adapter} selected but ${tool} was not detected.`,
        installProposal,
        toolDetection,
        provisionCommands: [],
      };
    }

    return {
      adapter,
      blocked: false,
      reason: `${tool} detected and mobile smoke command is available.`,
      toolDetection,
      provisionCommands: [],
    };
  }

  return { adapter, blocked: false, reason: 'Adapter is runnable.', provisionCommands: [] };
}

function defaultAdapterForTarget(target: RuntimeQaConfig['target']): RuntimeQaAdapter {
  if (target === 'web') return 'web-playwright';
  if (target === 'cli' || target === 'service') return 'cli-tmux';
  if (target === 'mobile') return 'mobile-maestro';
  return 'project-script';
}

function inferRuntimeQaTarget(root: string): RuntimeQaConfig['target'] {
  const cycle = readRelative(root, '.omc/cycles/current.md')?.toLowerCase() ?? '';
  const pkg = readPackageJson(root);
  const scriptText = Object.entries(pkg?.scripts ?? {})
    .map(([name, command]) => `${name} ${command}`)
    .join('\n')
    .toLowerCase();

  if (
    existsSync(resolve(root, '.maestro'))
    || /\b(maestro|detox|appium|ios|android|simulator|emulator|react-native|expo)\b/i.test(`${cycle}\n${scriptText}`)
  ) {
    return 'mobile';
  }
  if (hasPlaywright(root) || /\b(playwright|browser|e2e:web|test:e2e)\b/i.test(`${cycle}\n${scriptText}`)) {
    return 'web';
  }
  if (/\b(cli|terminal|command-line|tmux)\b/i.test(cycle)) return 'cli';
  if (/\b(service|server|api smoke)\b/i.test(cycle)) return 'service';
  return 'project-script';
}

function inferMobileAdapter(root: string): RuntimeQaAdapter {
  const scriptText = Object.values(readPackageJson(root)?.scripts ?? {}).join('\n').toLowerCase();
  if (scriptText.includes('detox')) return 'mobile-detox';
  if (scriptText.includes('appium')) return 'mobile-appium';
  return 'mobile-maestro';
}

function commandsForAdapter(
  adapter: RuntimeQaAdapter,
  config: RuntimeQaConfig | undefined,
  root: string,
  toolDetection?: RuntimeQaToolDetection,
): RuntimeQaResolvedCommand[] {
  const configured = flattenConfiguredCommands(config?.commands);
  if (configured.length > 0) return adapter === 'mobile-maestro'
    ? configured.map((command) => withMaestroJavaEnvironment(root, command, toolDetection))
    : configured;

  if (adapter === 'web-playwright') {
    return [{ name: 'smoke', command: detectWebSmokeCommand(root) ?? 'npx playwright test --trace retain-on-failure' }];
  }

  if (config?.mobile?.command) {
    return [{ name: 'smoke', command: config.mobile.command }];
  }
  const detectedMobileCommand = detectMobileSmokeCommand(adapter, root);
  if (detectedMobileCommand) {
    const command = { name: 'smoke', command: detectedMobileCommand };
    return adapter === 'mobile-maestro'
      ? [withMaestroJavaEnvironment(root, command, toolDetection)]
      : [command];
  }

  return [];
}

function withFixtureLifecycleCommands(
  root: string,
  config: RuntimeQaConfig | undefined,
  commands: RuntimeQaResolvedCommand[],
): RuntimeQaResolvedCommand[] {
  if (!config?.flows?.length || !config.fixtures) return commands;

  const expanded: RuntimeQaResolvedCommand[] = [];
  for (const command of commands) {
    const flow = flowForCommand(config.flows, command);
    const fixture = flow?.fixture ? config.fixtures[flow.fixture] : undefined;
    const flowKey = flow ? flowKeyForLifecycle(flow) : undefined;
    const provider = flow?.fixture
      ? resolveFixtureProvider(root, flow.fixture, fixture)
      : undefined;
    const providerCommands = flow?.fixture && provider?.supported && provider.requiresAgentMcp !== true
      ? providerLifecycleCommands(flow.fixture)
      : undefined;
    const provisionCommand = fixture?.provision_command ?? providerCommands?.provisionCommand;
    const teardownCommand = fixture?.teardown_command ?? providerCommands?.teardownCommand;
    const skipReason = flow
      ? destructiveFlowSkipReason(root, flow, fixture, provider, provisionCommand)
      : undefined;

    if (flow && provisionCommand && !skipReason) {
      expanded.push({
        name: `fixture-${flowKey}-provision`,
        command: provisionCommand,
        lifecycle: 'provision',
        flowKey,
      });
    }

    const commandWithFixture = flowKey
      ? {
        ...command,
        command: flow?.fixture && provider?.supported
          ? wrapCommandWithFixtureEnv(flow.fixture, command.command)
          : command.command,
        flowKey,
        skipReason,
      }
      : command;
    expanded.push(commandWithFixture);

    if (flow && teardownCommand && !skipReason) {
      expanded.push({
        name: `fixture-${flowKey}-teardown`,
        command: teardownCommand,
        lifecycle: 'teardown',
        flowKey,
      });
    }
  }

  return expanded;
}

function destructiveFlowSkipReason(
  root: string,
  flow: RuntimeQaFlowConfig,
  fixture: RuntimeQaFixtureConfig | undefined,
  provider: ReturnType<typeof resolveFixtureProvider> | undefined,
  provisionCommand: string | undefined,
): string | undefined {
  if (flow.destructive !== true) return undefined;
  const flowId = flow.id ?? flow.path;
  if (!flow.fixture) {
    return `Destructive runtime QA flow ${flowId} skipped: no disposable fixture is declared. partial-pass is not complete evidence.`;
  }
  if (provider?.requiresAgentMcp === true) {
    const envFile = fixtureEnvFileRelative(flow.fixture);
    if (!existsSync(resolve(root, envFile))) {
      return `Destructive runtime QA flow ${flowId} skipped: Supabase MCP fixture ${flow.fixture} must be provisioned by the Claude/OMC agent before simulator execution (${envFile} missing). partial-pass is not complete evidence.`;
    }
    return undefined;
  }
  if (!provisionCommand) {
    const reason = provider?.reason ?? (fixture
      ? `fixture ${flow.fixture} has no executable provision_command or supported provider`
      : `fixture ${flow.fixture} is not declared`);
    return `Destructive runtime QA flow ${flowId} skipped: ${reason}. partial-pass is not complete evidence.`;
  }
  return undefined;
}

function flowForCommand(
  flows: RuntimeQaFlowConfig[],
  command: RuntimeQaResolvedCommand,
): RuntimeQaFlowConfig | undefined {
  if (!isSmokeCommand(command.name)) return undefined;
  return flows.find((flow) => command.command.includes(flow.path));
}

function flowKeyForLifecycle(flow: RuntimeQaFlowConfig): string {
  return sanitizeStepName(flow.id ?? flow.path.replace(/\.[^.]+$/, ''));
}

function sanitizeStepName(value: string): string {
  const sanitized = value.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'flow';
}

function isSmokeCommand(name: string): boolean {
  return name === 'smoke' || name.startsWith('smoke-');
}

function runtimeQaDryRunReason(command: RuntimeQaResolvedCommand): string {
  if (command.lifecycle === 'provision') return 'Would provision runtime QA fixture.';
  if (command.lifecycle === 'teardown') return 'Would tear down runtime QA fixture.';
  return 'Would run runtime QA command.';
}

function detectWebSmokeCommand(root: string): string | undefined {
  const pkg = readPackageJson(root);
  if (!pkg?.scripts) {
    return hasPlaywright(root) ? 'npx playwright test --trace retain-on-failure' : undefined;
  }
  const names = ['test:e2e', 'e2e', 'playwright:test', 'test:playwright', 'smoke:web', 'smoke'];
  for (const name of names) {
    const script = pkg.scripts[name];
    if (script && /\b(playwright|browser|e2e|smoke)\b/i.test(script)) {
      return `${packageRunCommand(root)} ${name}`;
    }
  }
  const fallback = Object.entries(pkg.scripts).find(([name, script]) => (
    /\b(e2e|smoke|playwright)\b/i.test(name) || /\bplaywright\b/i.test(script)
  ));
  return fallback ? `${packageRunCommand(root)} ${fallback[0]}` : hasPlaywright(root) ? 'npx playwright test --trace retain-on-failure' : undefined;
}

function detectProjectSmokeCommand(root: string): string | undefined {
  const pkg = readPackageJson(root);
  if (!pkg?.scripts) return undefined;
  const names = ['smoke', 'test:smoke', 'test:e2e', 'e2e', 'test:integration', 'test'];
  for (const name of names) {
    if (pkg.scripts[name]) return `${packageRunCommand(root)} ${name}`;
  }
  const fallback = Object.keys(pkg.scripts).find((name) => /\b(smoke|e2e|integration)\b/i.test(name));
  return fallback ? `${packageRunCommand(root)} ${fallback}` : undefined;
}

function flattenConfiguredCommands(commands: RuntimeQaCommandSet | undefined): Array<{ name: string; command: string }> {
  if (!commands) return [];
  return [
    ...expandCommand('build', commands.build),
    ...expandCommand('start', commands.start),
    ...expandCommand('readiness', commands.readiness),
    ...expandCommand('smoke', commands.smoke),
    ...expandCommand('cleanup', commands.cleanup),
  ];
}

function expandCommand(name: string, value: string | string[] | undefined): Array<{ name: string; command: string }> {
  if (!value) return [];
  const commands = Array.isArray(value) ? value : [value];
  return commands.map((command, index) => ({
    name: commands.length === 1 ? name : `${name}-${index + 1}`,
    command,
  }));
}

function isCleanupCommand(name: string): boolean {
  return name === 'cleanup' || name.startsWith('cleanup-');
}

function hasConfiguredSmoke(config: RuntimeQaConfig | undefined): boolean {
  return Boolean(config?.commands?.smoke || config?.mobile?.command);
}

function hasMobileSmokeCommand(adapter: RuntimeQaAdapter, config: RuntimeQaConfig | undefined, root: string): boolean {
  return hasConfiguredSmoke(config) || Boolean(detectMobileSmokeCommand(adapter, root));
}

function isMobileAdapter(adapter: RuntimeQaAdapter): boolean {
  return adapter === 'mobile-maestro' || adapter === 'mobile-detox' || adapter === 'mobile-appium';
}

function mobileToolForAdapter(adapter: RuntimeQaAdapter, config: RuntimeQaConfig | undefined): RuntimeQaMobileTool {
  if (config?.mobile?.tool) return config.mobile.tool;
  if (adapter === 'mobile-detox') return 'detox';
  if (adapter === 'mobile-appium') return 'appium';
  return 'maestro';
}

function detectMobileSmokeCommand(adapter: RuntimeQaAdapter, root: string): string | undefined {
  if (adapter === 'mobile-maestro' && existsSync(resolve(root, '.maestro'))) {
    return 'maestro test .maestro';
  }

  const pkg = readPackageJson(root);
  if (!pkg?.scripts) return undefined;
  const scriptEntries = Object.entries(pkg.scripts);
  const preferredNames = adapter === 'mobile-detox'
    ? ['detox:test', 'e2e:detox', 'test:e2e', 'e2e']
    : adapter === 'mobile-appium'
      ? ['appium:test', 'e2e:appium', 'test:e2e', 'e2e']
      : ['maestro:test', 'test:maestro', 'test:e2e', 'e2e'];
  const commandNeedle = adapter.replace('mobile-', '');

  for (const name of preferredNames) {
    const script = pkg.scripts[name];
    if (script && script.includes(commandNeedle)) {
      return `${packageRunCommand(root)} ${name}`;
    }
  }

  const fallback = scriptEntries.find(([, script]) => script.includes(commandNeedle));
  return fallback ? `${packageRunCommand(root)} ${fallback[0]}` : undefined;
}

function mobileProvisionCommands(
  root: string,
  tool: RuntimeQaMobileTool,
  config: RuntimeQaConfig | undefined,
  toolDetection?: RuntimeQaToolDetection,
): Array<{ name: string; command: string }> {
  if (tool === 'maestro' && toolDetection?.missing_prerequisite === 'java-17') {
    return java17ProvisionCommands();
  }

  if (config?.mobile?.install?.command) {
    return expandCommand(`install-${tool}`, config.mobile.install.command);
  }

  const configuredManager = config?.mobile?.install?.manager;
  const manager = resolveInstallManager(root, configuredManager);
  if (tool === 'maestro') {
    const javaCommands = java17ProvisionCommands();
    if (configuredManager === 'brew') {
      return [
        ...javaCommands,
        { name: 'install-maestro-1', command: 'brew tap mobile-dev-inc/tap' },
        { name: 'install-maestro-2', command: 'brew install mobile-dev-inc/tap/maestro' },
      ];
    }
    return [
      ...javaCommands,
      { name: 'install-maestro', command: 'curl -fsSL "https://get.maestro.mobile.dev" | bash' },
    ];
  }

  if (tool === 'detox') {
    return [{ name: 'install-detox', command: packageAddCommand(root, manager, 'detox') }];
  }

  const appiumManager = configuredManager && configuredManager !== 'auto' ? configuredManager : 'npm';
  return [{ name: 'install-appium', command: globalPackageAddCommand(appiumManager, 'appium') }];
}

function mobileInstallProposal(
  tool: RuntimeQaMobileTool,
  commands: Array<{ command: string }>,
  toolDetection?: RuntimeQaToolDetection,
): string {
  if (toolDetection?.missing_prerequisite === 'java-17') {
    if (commands.length === 0) {
      return 'Install Java 17+ and set JAVA_HOME before running Maestro runtime QA.';
    }
    return [
      'Run omc runtime-qa run --auto --install-mobile-tools to provision Java 17 for Maestro, or run manually:',
      ...commands.map((entry) => entry.command),
    ].join(' ');
  }

  if (commands.length === 0) {
    return `Configure mobile.install.command in .omc/runtime-qa.json to provision ${tool}.`;
  }
  return [
    `Run omc runtime-qa run --auto --install-mobile-tools to provision ${tool}, or run manually:`,
    ...commands.map((entry) => entry.command),
  ].join(' ');
}

function java17ProvisionCommands(): Array<{ name: string; command: string }> {
  if (process.platform === 'darwin') {
    return [{ name: 'install-java-17', command: 'brew install openjdk@17' }];
  }
  return [];
}

function resolveInstallManager(root: string, configured: RuntimeQaPackageManager | undefined): RuntimeQaPackageManager {
  if (configured && configured !== 'auto') return configured;
  if (existsSync(resolve(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(resolve(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function packageRunCommand(root: string): string {
  if (existsSync(resolve(root, 'pnpm-lock.yaml'))) return 'pnpm run';
  if (existsSync(resolve(root, 'yarn.lock'))) return 'yarn';
  return 'npm run';
}

function withMaestroJavaEnvironment(
  root: string,
  command: { name: string; command: string },
  toolDetection?: RuntimeQaToolDetection,
): { name: string; command: string } {
  if (!/^\s*maestro(?:\s|$)/.test(command.command)) return command;
  if (toolDetection?.missing_prerequisite !== 'java-17' && javaIsOnPath(root)) return command;

  const javaHome = detectJava17Home();
  if (!javaHome) return command;
  const javaBin = `${javaHome}/bin`;
  return {
    ...command,
    command: `JAVA_HOME=${shellQuote(javaHome)} PATH=${shellQuote(javaBin)}:$PATH ${command.command}`,
  };
}

function javaIsOnPath(root: string): boolean {
  const result = spawnSync('java -version', {
    cwd: root,
    shell: true,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
  });
  return result.status === 0;
}

function detectJava17Home(): string | undefined {
  const candidates = [
    process.env.JAVA_HOME,
    '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home',
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(resolve(candidate, 'bin/java')));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function packageAddCommand(root: string, manager: RuntimeQaPackageManager, packageName: string): string {
  const resolved = manager === 'auto' ? resolveInstallManager(root, manager) : manager;
  if (resolved === 'pnpm') return `pnpm add ${packageName} --save-dev`;
  if (resolved === 'yarn') return `yarn add ${packageName} --dev`;
  return `npm install ${packageName} --save-dev`;
}

function globalPackageAddCommand(manager: RuntimeQaPackageManager, packageName: string): string {
  if (manager === 'pnpm') return `pnpm add --global ${packageName}`;
  if (manager === 'yarn') return `yarn global add ${packageName}`;
  return `npm i --location=global ${packageName}`;
}

function hasPlaywright(root: string): boolean {
  if (existsSync(resolve(root, 'playwright.config.ts')) || existsSync(resolve(root, 'playwright.config.js'))) {
    return true;
  }
  if (existsSync(resolve(root, 'node_modules/.bin/playwright'))) {
    return true;
  }
  const packagePath = resolve(root, 'package.json');
  if (!existsSync(packagePath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.['@playwright/test'] || pkg.devDependencies?.['@playwright/test']);
  } catch {
    return false;
  }
}

function defaultToolDetector(tool: RuntimeQaMobileTool, root: string): RuntimeQaToolDetection {
  const packageDetection = detectToolFromPackage(tool, root);
  if (packageDetection.detected) return packageDetection;

  if (tool === 'maestro' && javaIsOnPath(root) && maestroExistsOnPath(root)) {
    return {
      tool,
      detected: true,
      method: 'path',
      command: 'command -v maestro',
    };
  }

  const command = tool === 'detox'
    ? 'detox --version'
    : tool === 'appium'
      ? 'appium --version'
      : 'maestro --version';
  if (tool === 'maestro' && !javaIsOnPath(root)) {
    const javaHome = detectJava17Home();
    if (javaHome) {
      const commandWithJava = `JAVA_HOME=${shellQuote(javaHome)} PATH=${shellQuote(`${javaHome}/bin`)}:$PATH ${command}`;
      const resultWithJava = spawnSync(commandWithJava, {
        cwd: root,
        shell: true,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5_000,
      });
      if (resultWithJava.status === 0) {
        return {
          tool,
          detected: true,
          method: 'path-with-java-home',
          command: commandWithJava,
          version: String(resultWithJava.stdout || resultWithJava.stderr).trim().split('\n')[0],
        };
      }
    }
  }

  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
  });
  if (result.status === 0) {
    return {
      tool,
      detected: true,
      method: 'path',
      command,
      version: String(result.stdout || result.stderr).trim().split('\n')[0],
    };
  }

  if (tool === 'maestro' && maestroExistsOnPath(root) && isJavaRuntimeMissing(result.stderr, result.stdout)) {
    return {
      tool,
      detected: false,
      method: 'path-prerequisite',
      command,
      missing_prerequisite: 'java-17',
      reason: 'maestro is installed, but Java 17+ is missing or not visible to the shell.',
    };
  }

  return {
    tool,
    detected: false,
    method: packageDetection.method === 'package-json' ? 'package-json-and-path' : 'path',
    command,
  };
}

function maestroExistsOnPath(root: string): boolean {
  const result = spawnSync('command -v maestro', {
    cwd: root,
    shell: true,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5_000,
  });
  return result.status === 0;
}

function isJavaRuntimeMissing(stderr: string | undefined, stdout: string | undefined): boolean {
  return /unable to locate a java runtime|java runtime|could not find java|JAVA_HOME/i.test(`${stderr ?? ''}\n${stdout ?? ''}`);
}

function detectToolFromPackage(tool: RuntimeQaMobileTool, root: string): RuntimeQaToolDetection {
  const binaryPath = resolve(root, 'node_modules/.bin', tool);
  if (existsSync(binaryPath)) {
    return { tool, detected: true, method: 'node_modules', command: binaryPath };
  }

  const pkg = readPackageJson(root);
  if (pkg?.dependencies?.[tool] || pkg?.devDependencies?.[tool]) {
    return { tool, detected: true, method: 'package-json' };
  }

  return { tool, detected: false, method: pkg ? 'package-json' : 'none' };
}

function readPackageJson(root: string): {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | undefined {
  const packagePath = resolve(root, 'package.json');
  if (!existsSync(packagePath)) return undefined;
  try {
    return JSON.parse(readFileSync(packagePath, 'utf-8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return undefined;
  }
}

export function normalizeRuntimeQaConfig(config: RuntimeQaConfig | LegacyRuntimeQaConfig): RuntimeQaConfig {
  if ('target' in config || 'adapter' in config || 'commands' in config || 'mobile' in config) {
    return config as RuntimeQaConfig;
  }

  const legacy = config as LegacyRuntimeQaConfig;
  const platform = typeof legacy.platform === 'string' ? legacy.platform.toLowerCase() : undefined;
  const framework = typeof legacy.tooling?.framework === 'string'
    ? legacy.tooling.framework.toLowerCase()
    : undefined;
  if (platform !== 'mobile' || !isRuntimeQaMobileTool(framework)) {
    return config as RuntimeQaConfig;
  }

  const smokeCommands = (legacy.flows ?? [])
    .map((flow) => (typeof flow.path === 'string' ? flow.path.trim() : ''))
    .filter(Boolean)
    .map((path) => `${framework} test ${path}`);
  const buildCommands = Object.values(legacy.tooling?.platformRequirements ?? {})
    .map((requirements) => requirements?.buildCommand)
    .filter((command): command is string => typeof command === 'string' && command.trim().length > 0);
  const installCommand = legacy.tooling?.installCommand;
  const flows = normalizeLegacyFlows(legacy.flows);
  const fixtures = normalizeLegacyFixtures(legacy.fixtures);

  return {
    schema_version: 1,
    target: 'mobile',
    adapter: `mobile-${framework}` as RuntimeQaAdapter,
    commands: {
      ...(buildCommands.length > 0 ? { build: buildCommands } : {}),
      ...(smokeCommands.length > 0 ? { smoke: smokeCommands } : {}),
    },
    mobile: {
      tool: framework,
      install: typeof installCommand === 'string'
        ? { command: installCommand }
        : undefined,
    },
    ...(Object.keys(fixtures).length > 0 ? { fixtures } : {}),
    ...(flows.length > 0 ? { flows } : {}),
    ...(legacy.gates ? { gates: legacy.gates } : {}),
    ...(legacy.history ? { history: legacy.history } : {}),
  };
}

function isRuntimeQaMobileTool(value: unknown): value is RuntimeQaMobileTool {
  return value === 'maestro' || value === 'detox' || value === 'appium';
}

function normalizeLegacyFlows(flows: LegacyRuntimeQaConfig['flows']): RuntimeQaFlowConfig[] {
  return (flows ?? [])
    .map((flow): RuntimeQaFlowConfig | undefined => {
      const path = typeof flow.path === 'string' ? flow.path.trim() : '';
      if (!path) return undefined;
      return {
        ...(typeof flow.id === 'string' ? { id: flow.id } : {}),
        path,
        ...(typeof flow.fixture === 'string' ? { fixture: flow.fixture } : {}),
        ...(typeof flow.destructive === 'boolean' ? { destructive: flow.destructive } : {}),
        ...(Array.isArray(flow.verifies) ? { verifies: flow.verifies.filter((item): item is string => typeof item === 'string') } : {}),
        ...(typeof flow.spec === 'string' ? { spec: flow.spec } : {}),
        ...(typeof flow.expectedDurationSec === 'number' ? { expectedDurationSec: flow.expectedDurationSec } : {}),
      };
    })
    .filter((flow): flow is RuntimeQaFlowConfig => Boolean(flow));
}

function normalizeLegacyFixtures(fixtures: LegacyRuntimeQaConfig['fixtures']): Record<string, RuntimeQaFixtureConfig> {
  const normalized: Record<string, RuntimeQaFixtureConfig> = {};
  for (const [name, fixture] of Object.entries(fixtures ?? {})) {
    if (!fixture) continue;
    normalized[name] = {
      ...(typeof fixture.purpose === 'string' ? { purpose: fixture.purpose } : {}),
      ...(typeof fixture.provisioning === 'string' ? { provisioning: fixture.provisioning } : {}),
      ...(typeof fixture.provision_command === 'string' ? { provision_command: fixture.provision_command } : {}),
      ...(typeof fixture.teardown_command === 'string' ? { teardown_command: fixture.teardown_command } : {}),
      ...(fixture.provider === 'supabase' ? { provider: fixture.provider } : {}),
      ...(fixture.strategy === 'auth-admin-user' ? { strategy: fixture.strategy } : {}),
      ...(isRuntimeQaFixtureBackend(fixture.backend) ? { backend: fixture.backend } : {}),
      ...(typeof fixture.email_prefix === 'string' ? { email_prefix: fixture.email_prefix } : {}),
      ...(typeof fixture.email_env === 'string' ? { email_env: fixture.email_env } : {}),
      ...(typeof fixture.password_env === 'string' ? { password_env: fixture.password_env } : {}),
      ...(typeof fixture.user_id_env === 'string' ? { user_id_env: fixture.user_id_env } : {}),
    };
  }
  return normalized;
}

function isRuntimeQaFixtureBackend(value: unknown): value is RuntimeQaFixtureProviderBackend {
  return value === 'auto' || value === 'env' || value === 'mcp';
}

function readActiveCycleId(root: string): string | undefined {
  const content = readRelative(root, '.omc/cycles/current.md');
  if (!content) return undefined;
  const match = content.match(/^\s*cycle_id\s*:\s*(.*?)\s*$/im);
  return match?.[1]?.replace(/^['"]|['"]$/g, '').trim();
}

function readRelative(root: string, relativePath: string): string | undefined {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

function commandResultToStep(
  command: { name: string; command: string },
  result: CommandRunResult,
  artifactDir: string,
  summaryPolicy: Partial<SummaryPolicy> | undefined,
): RuntimeQaStepResult {
  const stdoutArtifact = writeCommandArtifact(artifactDir, `${command.name}.stdout.txt`, result.stdout ?? '');
  const stderrArtifact = writeCommandArtifact(artifactDir, `${command.name}.stderr.txt`, result.stderr ?? '');
  const status: RuntimeQaStepStatus = result.error || result.status !== 0 ? 'failed' : 'passed';
  return {
    name: command.name,
    command: command.command,
    status,
    exit_code: result.status,
    signal: result.signal,
    reason: result.error?.message ?? (status === 'passed' ? 'Command completed successfully.' : `Command exited with status ${result.status ?? 'unknown'}.`),
    stdout_artifact: stdoutArtifact,
    stderr_artifact: stderrArtifact,
    stdout_preview: truncateInlineLog(result.stdout ?? '', summaryPolicy),
    stderr_preview: truncateInlineLog(result.stderr ?? '', summaryPolicy),
  };
}

function writeCommandArtifact(artifactDir: string, filename: string, content: string): string {
  const path = resolve(artifactDir, filename);
  atomicWriteFileSync(path, content);
  return path;
}

function defaultCommandRunner(command: string, cwd: string, timeoutMs: number): CommandRunResult {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
  });

  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
