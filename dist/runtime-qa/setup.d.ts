import { type RuntimeQaDoctorOptions, type RuntimeQaDoctorReport } from './diagnostics.js';
import { type CommandRunResult } from './runner.js';
export type RuntimeQaSetupStepKind = 'command' | 'manual';
export type RuntimeQaSetupStepStatus = 'pending' | 'passed' | 'failed' | 'skipped';
export interface RuntimeQaSetupStep {
    id: string;
    title: string;
    kind: RuntimeQaSetupStepKind;
    command?: string;
    reason: string;
    status: RuntimeQaSetupStepStatus;
    exit_code?: number | null;
    stdout_preview?: string;
    stderr_preview?: string;
}
export interface RuntimeQaSetupReport {
    root: string;
    applied: boolean;
    ok: boolean;
    doctor: RuntimeQaDoctorReport;
    steps: RuntimeQaSetupStep[];
    summary: {
        commands: number;
        manual: number;
        failed: number;
    };
}
export interface RuntimeQaSetupOptions extends RuntimeQaDoctorOptions {
    apply?: boolean;
    commandRunner?: RuntimeQaSetupCommandRunner;
    platform?: NodeJS.Platform;
}
export type RuntimeQaSetupCommandRunner = (command: string, cwd: string, timeoutMs: number) => CommandRunResult;
export declare function setupRuntimeQaPrerequisites(root?: string, options?: RuntimeQaSetupOptions): RuntimeQaSetupReport;
export declare function buildRuntimeQaSetupPlan(root: string, doctor: RuntimeQaDoctorReport, options?: Pick<RuntimeQaSetupOptions, 'platform'>): RuntimeQaSetupStep[];
//# sourceMappingURL=setup.d.ts.map