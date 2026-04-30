/**
 * Aggregated project doctor/setup preflight for common OMC project footguns.
 */
import { type RuntimeQaSetupReport } from '../../runtime-qa/setup.js';
import { type StateHygieneReport } from './state-hygiene.js';
export interface ProjectDoctorOptions {
    json?: boolean;
    applyStateHygiene?: boolean;
    applyRuntimeQaSetup?: boolean;
}
export interface ProjectDoctorCheck {
    id: string;
    label: string;
    ok: boolean;
    status: 'pass' | 'warning' | 'fail' | 'skipped';
    summary: string;
    recommendation?: string;
}
export interface ProjectDoctorReport {
    ok: boolean;
    root: string;
    applied: {
        stateHygiene: boolean;
        runtimeQaSetup: boolean;
    };
    checks: ProjectDoctorCheck[];
    stateHygiene: StateHygieneReport;
    runtimeQaSetup?: RuntimeQaSetupReport;
    summary: {
        passed: number;
        warnings: number;
        failed: number;
        skipped: number;
    };
}
interface LoggerLike {
    log: (message?: unknown) => void;
}
export declare function projectDoctorCommand(root: string | undefined, options: ProjectDoctorOptions, logger?: LoggerLike): Promise<number>;
export declare function inspectProjectDoctor(root: string | undefined, options?: ProjectDoctorOptions): ProjectDoctorReport;
export declare function renderProjectDoctorReport(report: ProjectDoctorReport): string;
export {};
//# sourceMappingURL=project-doctor.d.ts.map