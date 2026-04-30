import { type CommandRunResult, type RuntimeQaRunReport, type RuntimeQaToolDetector } from './runner.js';
export type RuntimeQaDoctorSeverity = 'error' | 'warning';
export interface RuntimeQaDoctorIssue {
    severity: RuntimeQaDoctorSeverity;
    code: string;
    message: string;
    path?: string;
}
export interface RuntimeQaPlatformCheck {
    id: string;
    label: string;
    required: boolean;
    detected: boolean;
    command?: string;
    reason: string;
}
export interface RuntimeQaDoctorReport {
    ok: boolean;
    root: string;
    configPath: string;
    configExists: boolean;
    handoffPath: string;
    handoffExists: boolean;
    shouldRun: boolean;
    activeCycleId?: string;
    dryRunReport: RuntimeQaRunReport;
    handoff?: RuntimeQaRunReport | Record<string, unknown>;
    platformChecks: RuntimeQaPlatformCheck[];
    destructiveFlows: Array<{
        id: string;
        path: string;
        fixture?: string;
        provider?: string;
        backend?: string;
        provisioned: boolean;
        requiresAgentMcp?: boolean;
        reason?: string;
    }>;
    issues: RuntimeQaDoctorIssue[];
    summary: {
        errors: number;
        warnings: number;
    };
}
export interface RuntimeQaDoctorOptions {
    commandRunner?: RuntimeQaDoctorCommandRunner;
    toolDetector?: RuntimeQaToolDetector;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
}
type RuntimeQaDoctorCommandRunner = (command: string, cwd: string, timeoutMs: number) => CommandRunResult;
export declare function diagnoseRuntimeQa(root?: string, options?: RuntimeQaDoctorOptions): RuntimeQaDoctorReport;
export {};
//# sourceMappingURL=diagnostics.d.ts.map