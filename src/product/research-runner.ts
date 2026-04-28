import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
import {
  validateProductResearchArtifact,
  type ProductResearchArtifactIssue,
} from './research-artifact-validator.js';
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
  research_artifact_valid: boolean;
  research_validation_issues: ProductResearchArtifactIssue[];
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

export const PRODUCT_RESEARCH_RUN_REPORT_RELATIVE_PATH =
  '.omc/handoffs/product-cycle-research/run-report.json';

const PRODUCT_RESEARCH_RUN_REPORT_MD_RELATIVE_PATH =
  '.omc/handoffs/product-cycle-research/run-report.md';

export function runProductResearchExecutionPlan(
  plan: ProductResearchExecutionPlan,
  options: RunProductResearchExecutionPlanOptions = {},
): ProductResearchRunReport {
  const root = resolve(options.root ?? process.cwd());
  const dryRun = options.dryRun === true;
  const maxSteps = options.maxSteps ?? Number.POSITIVE_INFINITY;
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const stepResults: ProductResearchRunStepResult[] = [];
  let runnableSeen = 0;

  for (const step of plan.steps) {
    if (!step.executable || !step.argv || step.argv.length === 0) {
      stepResults.push({
        route_id: step.route_id,
        execution_surface: step.execution_surface,
        status: 'skipped',
        argv: step.argv,
        reason: step.executable ? 'Step has no argv to execute.' : 'Step is not marked executable.',
      });
      continue;
    }

    runnableSeen += 1;
    if (runnableSeen > maxSteps) {
      stepResults.push({
        route_id: step.route_id,
        execution_surface: step.execution_surface,
        status: 'skipped',
        argv: step.argv,
        reason: `Skipped because --max-steps=${maxSteps} was reached.`,
      });
      continue;
    }

    if (dryRun) {
      stepResults.push({
        route_id: step.route_id,
        execution_surface: step.execution_surface,
        status: 'dry-run',
        argv: step.argv,
        reason: 'Would run this research step.',
      });
      continue;
    }

    const result = commandRunner(step.argv, root);
    if (result.error || result.status !== 0) {
      stepResults.push({
        route_id: step.route_id,
        execution_surface: step.execution_surface,
        status: 'failed',
        argv: step.argv,
        exit_code: result.status,
        signal: result.signal,
        reason: result.error?.message ?? `Command exited with status ${result.status ?? 'unknown'}.`,
      });
      break;
    }

    stepResults.push({
      route_id: step.route_id,
      execution_surface: step.execution_surface,
      status: 'passed',
      argv: step.argv,
      exit_code: result.status,
      signal: result.signal,
      reason: 'Command completed successfully.',
    });
  }

  const executedStepCount = stepResults.filter((step) => step.status === 'passed').length;
  const failedStepCount = stepResults.filter((step) => step.status === 'failed').length;
  const skippedStepCount = stepResults.filter((step) => step.status === 'skipped').length;
  const routeIds = plan.steps.map((step) => step.route_id);
  const artifactValidation = validateProductResearchArtifact({
    root,
    artifactPath: plan.research_artifact,
    expectedCycleId: plan.cycle_id,
    expectedCycleStage: plan.cycle_stage,
    expectedCycleGoal: plan.cycle_goal,
    expectedRouteIds: routeIds,
  });
  const researchArtifactExists = existsSync(resolve(root, plan.research_artifact));

  return {
    schema_version: 1,
    produced_at: new Date().toISOString(),
    agent_role: 'product-research-runner',
    source_plan: options.sourcePlan ?? '.omc/handoffs/product-cycle-research/execution-plan.json',
    research_artifact: plan.research_artifact,
    research_artifact_exists: researchArtifactExists,
    research_artifact_valid: artifactValidation.ok,
    research_validation_issues: artifactValidation.issues,
    dry_run: dryRun,
    status: resolveRunStatus({
      dryRun,
      stepResults,
      failedStepCount,
      artifactValid: artifactValidation.ok,
    }),
    executed_step_count: executedStepCount,
    skipped_step_count: skippedStepCount,
    failed_step_count: failedStepCount,
    step_results: stepResults,
  };
}

export function writeProductResearchRunReport(
  root: string,
  report: ProductResearchRunReport,
): ProductResearchRunReportWriteResult {
  const jsonPath = resolve(root, PRODUCT_RESEARCH_RUN_REPORT_RELATIVE_PATH);
  const mdPath = resolve(root, PRODUCT_RESEARCH_RUN_REPORT_MD_RELATIVE_PATH);
  ensureDirSync(dirname(jsonPath));
  atomicWriteJsonSync(jsonPath, report);
  atomicWriteFileSync(mdPath, renderProductResearchRunReport(report));
  return { jsonPath, mdPath };
}

export function renderProductResearchRunReport(report: ProductResearchRunReport): string {
  const lines = [
    '# Product Cycle Research Run Report',
    '',
    `produced_at: ${report.produced_at}`,
    `status: ${report.status}`,
    `dry_run: ${report.dry_run}`,
    `source_plan: ${report.source_plan}`,
    `research_artifact: ${report.research_artifact}`,
    `research_artifact_exists: ${report.research_artifact_exists}`,
    `research_artifact_valid: ${report.research_artifact_valid}`,
    `executed_step_count: ${report.executed_step_count}`,
    `skipped_step_count: ${report.skipped_step_count}`,
    `failed_step_count: ${report.failed_step_count}`,
    '',
    '## Step Results',
  ];

  if (report.step_results.length === 0) {
    lines.push('- none');
  } else {
    for (const step of report.step_results) {
      lines.push(`- ${step.route_id}: ${step.status}`);
      lines.push(`  - surface: ${step.execution_surface}`);
      lines.push(`  - reason: ${step.reason}`);
      lines.push(`  - argv: ${step.argv ? renderArgv(step.argv) : 'none'}`);
      if (step.exit_code !== undefined) lines.push(`  - exit_code: ${step.exit_code}`);
      if (step.signal !== undefined) lines.push(`  - signal: ${step.signal ?? 'none'}`);
    }
  }

  if (report.research_validation_issues.length > 0) {
    lines.push('');
    lines.push('## Research Validation Issues');
    for (const issue of report.research_validation_issues) {
      lines.push(`- ${issue.severity} ${issue.code}: ${issue.message}`);
    }
  }

  lines.push('');
  lines.push('artifacts_written:');
  lines.push(`  - ${PRODUCT_RESEARCH_RUN_REPORT_RELATIVE_PATH}`);
  lines.push(`  - ${PRODUCT_RESEARCH_RUN_REPORT_MD_RELATIVE_PATH}`);
  lines.push('');

  return lines.join('\n');
}

function resolveRunStatus(options: {
  dryRun: boolean;
  stepResults: ProductResearchRunStepResult[];
  failedStepCount: number;
  artifactValid: boolean;
}): ProductResearchRunStatus {
  if (options.failedStepCount > 0) return 'failed';
  if (options.stepResults.length === 0) return 'noop';
  if (options.dryRun) return 'noop';
  if (!options.artifactValid) return 'failed';
  const hasPassed = options.stepResults.some((step) => step.status === 'passed');
  const hasSkipped = options.stepResults.some((step) => step.status === 'skipped');
  if (hasPassed && hasSkipped) return 'partial';
  if (hasPassed) return 'passed';
  return 'noop';
}

function defaultCommandRunner(argv: string[], cwd: string): CommandRunResult {
  const [command, ...args] = argv;
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });

  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
  };
}

function renderArgv(argv: string[]): string {
  return argv.map((arg) => (/^[a-z0-9_./:=,-]+$/i.test(arg) ? arg : JSON.stringify(arg))).join(' ');
}
