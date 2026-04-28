import type { ProductResearchExecutionPlan, ProductResearchExecutionStep } from './research-execution-plan.js';
export type ProductResearchRunStatus = 'passed' | 'failed' | 'partial' | 'noop';
export type ProductResearchRunStepStatus = 'passed' | 'failed' | 'skipped' | 'dry-run';
export interface ProductResearchRunStepResult {
    route_id: string;
    execution_surface: ProductResearchExecutionStep['execution_surface'];
    status: ProductResearchRunStepStatus;
    argv?: string[];
    exit_code?: number | null;
    signal?: string | null;
    reason: string;
}
export interface ProductResearchRunReport {
    schema_version: 1;
    produced_at: string;
    agent_role: 'product-research-runner';
    source_plan: string;
    research_artifact: string;
    research_artifact_exists: boolean;
    dry_run: boolean;
    status: ProductResearchRunStatus;
    executed_step_count: number;
    skipped_step_count: number;
    failed_step_count: number;
    step_results: ProductResearchRunStepResult[];
}
export interface ProductResearchRunReportWriteResult {
    jsonPath: string;
    mdPath: string;
}
export interface CommandRunResult {
    status: number | null;
    signal?: NodeJS.Signals | string | null;
    error?: Error;
}
export type ProductResearchCommandRunner = (argv: string[], cwd: string) => CommandRunResult;
export interface RunProductResearchExecutionPlanOptions {
    root?: string;
    dryRun?: boolean;
    maxSteps?: number;
    sourcePlan?: string;
    commandRunner?: ProductResearchCommandRunner;
}
export declare const PRODUCT_RESEARCH_RUN_REPORT_RELATIVE_PATH = ".omc/handoffs/product-cycle-research/run-report.json";
export declare function runProductResearchExecutionPlan(plan: ProductResearchExecutionPlan, options?: RunProductResearchExecutionPlanOptions): ProductResearchRunReport;
export declare function writeProductResearchRunReport(root: string, report: ProductResearchRunReport): ProductResearchRunReportWriteResult;
export declare function renderProductResearchRunReport(report: ProductResearchRunReport): string;
//# sourceMappingURL=research-runner.d.ts.map