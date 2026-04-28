import type { ProductInterventionExecutionPlan, ProductInterventionExecutionStep } from './intervention-execution-plan.js';
export type ProductInterventionRunStatus = 'passed' | 'failed' | 'partial' | 'noop';
export type ProductInterventionRunStepStatus = 'passed' | 'failed' | 'skipped' | 'dry-run';
export interface ProductInterventionRunStepResult {
    route_id: string;
    execution_surface: ProductInterventionExecutionStep['execution_surface'];
    status: ProductInterventionRunStepStatus;
    argv?: string[];
    wait_argv?: string[];
    child_job_id?: string;
    child_job_status?: string;
    exit_code?: number | null;
    wait_exit_code?: number | null;
    signal?: string | null;
    wait_signal?: string | null;
    reason: string;
}
export interface ProductInterventionRunReport {
    schema_version: 1;
    produced_at: string;
    agent_role: 'product-intervention-runner';
    source_plan: string;
    dry_run: boolean;
    status: ProductInterventionRunStatus;
    executed_step_count: number;
    skipped_step_count: number;
    failed_step_count: number;
    step_results: ProductInterventionRunStepResult[];
}
export interface ProductInterventionRunReportWriteResult {
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
export type ProductInterventionCommandRunner = (argv: string[], cwd: string) => CommandRunResult;
export interface RunProductInterventionExecutionPlanOptions {
    root?: string;
    dryRun?: boolean;
    maxSteps?: number;
    waitForTeamJobs?: boolean;
    teamWaitTimeoutMs?: number;
    sourcePlan?: string;
    commandRunner?: ProductInterventionCommandRunner;
}
export declare const PRODUCT_INTERVENTION_RUN_REPORT_RELATIVE_PATH = ".omc/handoffs/product-cycle-interventions/run-report.json";
export declare function runProductInterventionExecutionPlan(plan: ProductInterventionExecutionPlan, options?: RunProductInterventionExecutionPlanOptions): ProductInterventionRunReport;
export declare function writeProductInterventionRunReport(root: string, report: ProductInterventionRunReport): ProductInterventionRunReportWriteResult;
export declare function renderProductInterventionRunReport(report: ProductInterventionRunReport): string;
//# sourceMappingURL=intervention-runner.d.ts.map