import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
import { truncateInlineLog, type SummaryPolicy } from '../lib/summary-policy.js';

export type RuntimeQaAdapter =
  | 'project-script'
  | 'web-playwright'
  | 'cli-tmux'
  | 'mobile-maestro'
  | 'mobile-detox'
  | 'mobile-appium';

export type RuntimeQaMobileTool = 'maestro' | 'detox' | 'appium';
export type RuntimeQaPackageManager = 'auto' | 'npm' | 'pnpm' | 'yarn' | 'brew';
export type RuntimeQaStatus = 'passed' | 'failed' | 'blocked' | 'noop';
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
}

export interface RuntimeQaToolDetection {
  tool: RuntimeQaMobileTool;
  detected: boolean;
  method: string;
  command?: string;
  version?: string;
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

export interface RunRuntimeQaOptions {
  root?: string;
  auto?: boolean;
  dryRun?: boolean;
  config?: RuntimeQaConfig;
  commandRunner?: RuntimeQaCommandRunner;
  installMobileTools?: boolean;
  toolDetector?: RuntimeQaToolDetector;
  summaryPolicy?: Partial<SummaryPolicy>;
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
  return JSON.parse(readFileSync(path, 'utf-8')) as RuntimeQaConfig;
}

export function runRuntimeQa(options: RunRuntimeQaOptions = {}): RuntimeQaRunReport {
  const root = resolve(options.root ?? process.cwd());
  const configPath = resolve(root, RUNTIME_QA_CONFIG_RELATIVE_PATH);
  const config = options.config ?? readRuntimeQaConfig(root);
  const configExists = Boolean(config || existsSync(configPath));
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = resolve(root, config?.artifacts_dir ?? `.omc/artifacts/runtime-qa/${runId}`);
  const adapterResolution = resolveAdapter(root, config, {
    installMobileTools: options.installMobileTools === true,
    toolDetector: options.toolDetector ?? defaultToolDetector,
  });
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const dryRun = options.dryRun === true;
  const timeoutMs = config?.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const stepResults: RuntimeQaStepResult[] = [];

  if (adapterResolution.blocked) {
    return {
      schema_version: 1,
      produced_at: new Date().toISOString(),
      agent_role: 'runtime-qa-runner',
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

  ensureDirSync(artifactDir);
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
      stepResults.push(commandResultToStep(command, result, artifactDir, options.summaryPolicy));
      if (result.error || result.status !== 0) {
        return {
          schema_version: 1,
          produced_at: new Date().toISOString(),
          agent_role: 'runtime-qa-runner',
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

  const commands = commandsForAdapter(adapterResolution.adapter, config, root);
  if (commands.length === 0) {
    return {
      schema_version: 1,
      produced_at: new Date().toISOString(),
      agent_role: 'runtime-qa-runner',
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

  for (const command of commands) {
    if (dryRun) {
      stepResults.push({
        name: command.name,
        command: command.command,
        status: 'dry-run',
        reason: 'Would run runtime QA command.',
      });
      continue;
    }

    const result = commandRunner(command.command, root, timeoutMs);
    const step = commandResultToStep(command, result, artifactDir, options.summaryPolicy);
    stepResults.push(step);

    if (step.status === 'failed') break;
  }

  return {
    schema_version: 1,
    produced_at: new Date().toISOString(),
    agent_role: 'runtime-qa-runner',
    status: stepResults.some((step) => step.status === 'failed') ? 'failed' : 'passed',
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
      const provisionCommands = mobileProvisionCommands(root, tool, config);
      const installProposal = mobileInstallProposal(tool, provisionCommands);
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

function commandsForAdapter(
  adapter: RuntimeQaAdapter,
  config: RuntimeQaConfig | undefined,
  root: string,
): Array<{ name: string; command: string }> {
  const configured = flattenConfiguredCommands(config?.commands);
  if (configured.length > 0) return configured;

  if (adapter === 'web-playwright') {
    return [{ name: 'smoke', command: 'npx playwright test --trace retain-on-failure' }];
  }

  if (config?.mobile?.command) {
    return [{ name: 'smoke', command: config.mobile.command }];
  }
  const detectedMobileCommand = detectMobileSmokeCommand(adapter, root);
  if (detectedMobileCommand) {
    return [{ name: 'smoke', command: detectedMobileCommand }];
  }

  return [];
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
): Array<{ name: string; command: string }> {
  if (config?.mobile?.install?.command) {
    return expandCommand(`install-${tool}`, config.mobile.install.command);
  }

  const configuredManager = config?.mobile?.install?.manager;
  const manager = resolveInstallManager(root, configuredManager);
  if (tool === 'maestro') {
    if (configuredManager === 'brew') {
      return [
        { name: 'install-maestro-1', command: 'brew tap mobile-dev-inc/tap' },
        { name: 'install-maestro-2', command: 'brew install mobile-dev-inc/tap/maestro' },
      ];
    }
    return [{ name: 'install-maestro', command: 'curl -fsSL "https://get.maestro.mobile.dev" | bash' }];
  }

  if (tool === 'detox') {
    return [{ name: 'install-detox', command: packageAddCommand(root, manager, 'detox') }];
  }

  const appiumManager = configuredManager && configuredManager !== 'auto' ? configuredManager : 'npm';
  return [{ name: 'install-appium', command: globalPackageAddCommand(appiumManager, 'appium') }];
}

function mobileInstallProposal(tool: RuntimeQaMobileTool, commands: Array<{ command: string }>): string {
  if (commands.length === 0) {
    return `Configure mobile.install.command in .omc/runtime-qa.json to provision ${tool}.`;
  }
  return [
    `Run omc runtime-qa run --auto --install-mobile-tools to provision ${tool}, or run manually:`,
    ...commands.map((entry) => entry.command),
  ].join(' ');
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

  const command = tool === 'detox'
    ? 'detox --version'
    : tool === 'appium'
      ? 'appium --version'
      : 'maestro --version';
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

  return {
    tool,
    detected: false,
    method: packageDetection.method === 'package-json' ? 'package-json-and-path' : 'path',
    command,
  };
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
