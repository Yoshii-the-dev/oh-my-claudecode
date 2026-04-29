import { type SummaryPolicy } from '../lib/summary-policy.js';
export type RuntimeQaAdapter = 'project-script' | 'web-playwright' | 'cli-tmux' | 'mobile-maestro' | 'mobile-detox' | 'mobile-appium';
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
export declare const RUNTIME_QA_CONFIG_RELATIVE_PATH = ".omc/runtime-qa.json";
export declare const RUNTIME_QA_HANDOFF_RELATIVE_PATH = ".omc/handoffs/runtime-qa/current.json";
export declare function shouldRunRuntimeQa(root?: string): boolean;
export declare function readRuntimeQaConfig(root?: string): RuntimeQaConfig | undefined;
export declare function detectRuntimeQaConfig(root?: string, target?: RuntimeQaConfig['target']): RuntimeQaConfig;
export declare function initRuntimeQaConfig(options?: {
    root?: string;
    target?: RuntimeQaConfig['target'];
    write?: boolean;
    force?: boolean;
}): RuntimeQaInitResult;
export declare function runRuntimeQa(options?: RunRuntimeQaOptions): RuntimeQaRunReport;
export declare function writeRuntimeQaRunReport(root: string, report: RuntimeQaRunReport): RuntimeQaRunReportWriteResult;
export declare function renderRuntimeQaRunReport(report: RuntimeQaRunReport): string;
//# sourceMappingURL=runner.d.ts.map