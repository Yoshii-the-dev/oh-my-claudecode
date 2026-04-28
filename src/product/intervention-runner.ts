import { spawnSync } from 'child_process';
import { dirname, resolve } from 'path';
import { atomicWriteFileSync, atomicWriteJsonSync, ensureDirSync } from '../lib/atomic-write.js';
import type {
  ProductInterventionExecutionPlan,
  ProductInterventionExecutionStep,
} from './intervention-execution-plan.js';

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

export const PRODUCT_INTERVENTION_RUN_REPORT_RELATIVE_PATH =
  '.omc/handoffs/product-cycle-interventions/run-report.json';

const PRODUCT_INTERVENTION_RUN_REPORT_MD_RELATIVE_PATH =
  '.omc/handoffs/product-cycle-interventions/run-report.md';

export function runProductInterventionExecutionPlan(
  plan: ProductInterventionExecutionPlan,
  options: RunProductInterventionExecutionPlanOptions = {},
): ProductInterventionRunReport {
  const root = resolve(options.root ?? process.cwd());
  const dryRun = options.dryRun === true;
  const maxSteps = options.maxSteps ?? Number.POSITIVE_INFINITY;
  const waitForTeamJobs = options.waitForTeamJobs === true;
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const stepResults: ProductInterventionRunStepResult[] = [];
  let runnableSeen = 0;

  for (const step of plan.steps) {
    if (!isSafeAutoRunnableStep(step)) {
      stepResults.push({
        route_id: step.route_id,
        execution_surface: step.execution_surface,
        status: 'skipped',
        argv: step.argv,
        reason: skipReason(step),
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
        reason: 'Would run this safe intervention step.',
      });
      continue;
    }

    const argv = waitForTeamJobs && step.execution_surface === 'team-start'
      ? ensureFlag(step.argv!, '--json')
      : step.argv!;
    const result = commandRunner(argv, root);
    if (result.error || result.status !== 0) {
      stepResults.push({
        route_id: step.route_id,
        execution_surface: step.execution_surface,
        status: 'failed',
        argv,
        exit_code: result.status,
        signal: result.signal,
        reason: result.error?.message ?? `Command exited with status ${result.status ?? 'unknown'}.`,
      });
      break;
    }

    if (waitForTeamJobs && step.execution_surface === 'team-start') {
      const waitResult = waitForTeamJob({ startResult: result, root, commandRunner, timeoutMs: options.teamWaitTimeoutMs });
      if (waitResult.failed) {
        stepResults.push({
          route_id: step.route_id,
          execution_surface: step.execution_surface,
          status: 'failed',
          argv,
          wait_argv: waitResult.waitArgv,
          child_job_id: waitResult.jobId,
          child_job_status: waitResult.jobStatus,
          exit_code: result.status,
          wait_exit_code: waitResult.result?.status,
          signal: result.signal,
          wait_signal: waitResult.result?.signal,
          reason: waitResult.reason,
        });
        break;
      }

      stepResults.push({
        route_id: step.route_id,
        execution_surface: step.execution_surface,
        status: 'passed',
        argv,
        wait_argv: waitResult.waitArgv,
        child_job_id: waitResult.jobId,
        child_job_status: waitResult.jobStatus,
        exit_code: result.status,
        wait_exit_code: waitResult.result?.status,
        signal: result.signal,
        wait_signal: waitResult.result?.signal,
        reason: waitResult.reason,
      });
      continue;
    }

    stepResults.push({
      route_id: step.route_id,
      execution_surface: step.execution_surface,
      status: 'passed',
      argv,
      exit_code: result.status,
      signal: result.signal,
      reason: 'Command completed successfully.',
    });
  }

  const executedStepCount = stepResults.filter((step) => step.status === 'passed').length;
  const failedStepCount = stepResults.filter((step) => step.status === 'failed').length;
  const skippedStepCount = stepResults.filter((step) => step.status === 'skipped').length;

  return {
    schema_version: 1,
    produced_at: new Date().toISOString(),
    agent_role: 'product-intervention-runner',
    source_plan: options.sourcePlan ?? '.omc/handoffs/product-cycle-interventions/execution-plan.json',
    dry_run: dryRun,
    status: resolveRunStatus({ dryRun, stepResults, failedStepCount }),
    executed_step_count: executedStepCount,
    skipped_step_count: skippedStepCount,
    failed_step_count: failedStepCount,
    step_results: stepResults,
  };
}

export function writeProductInterventionRunReport(
  root: string,
  report: ProductInterventionRunReport,
): ProductInterventionRunReportWriteResult {
  const jsonPath = resolve(root, PRODUCT_INTERVENTION_RUN_REPORT_RELATIVE_PATH);
  const mdPath = resolve(root, PRODUCT_INTERVENTION_RUN_REPORT_MD_RELATIVE_PATH);
  ensureDirSync(dirname(jsonPath));
  atomicWriteJsonSync(jsonPath, report);
  atomicWriteFileSync(mdPath, renderProductInterventionRunReport(report));
  return { jsonPath, mdPath };
}

export function renderProductInterventionRunReport(report: ProductInterventionRunReport): string {
  const lines = [
    '# Product Cycle Intervention Run Report',
    '',
    `produced_at: ${report.produced_at}`,
    `status: ${report.status}`,
    `dry_run: ${report.dry_run}`,
    `source_plan: ${report.source_plan}`,
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
      if (step.wait_argv) lines.push(`  - wait_argv: ${renderArgv(step.wait_argv)}`);
      if (step.child_job_id) lines.push(`  - child_job_id: ${step.child_job_id}`);
      if (step.child_job_status) lines.push(`  - child_job_status: ${step.child_job_status}`);
      if (step.exit_code !== undefined) lines.push(`  - exit_code: ${step.exit_code}`);
      if (step.wait_exit_code !== undefined) lines.push(`  - wait_exit_code: ${step.wait_exit_code}`);
      if (step.signal !== undefined) lines.push(`  - signal: ${step.signal ?? 'none'}`);
      if (step.wait_signal !== undefined) lines.push(`  - wait_signal: ${step.wait_signal ?? 'none'}`);
    }
  }

  lines.push('');
  lines.push('artifacts_written:');
  lines.push(`  - ${PRODUCT_INTERVENTION_RUN_REPORT_RELATIVE_PATH}`);
  lines.push(`  - ${PRODUCT_INTERVENTION_RUN_REPORT_MD_RELATIVE_PATH}`);
  lines.push('');

  return lines.join('\n');
}

function isSafeAutoRunnableStep(step: ProductInterventionExecutionStep): boolean {
  if (!step.executable || !step.argv || step.argv.length === 0) return false;
  return step.execution_surface === 'agent-prompt'
    || step.execution_surface === 'stack-plan'
    || step.execution_surface === 'team-start';
}

function skipReason(step: ProductInterventionExecutionStep): string {
  if (!step.executable) return 'Step is not marked executable.';
  if (!step.argv || step.argv.length === 0) return 'Step has no argv to execute.';
  return 'Step requires an interactive or manual execution surface.';
}

function resolveRunStatus(options: {
  dryRun: boolean;
  stepResults: ProductInterventionRunStepResult[];
  failedStepCount: number;
}): ProductInterventionRunStatus {
  if (options.failedStepCount > 0) return 'failed';
  if (options.stepResults.length === 0) return 'noop';
  if (options.dryRun) return 'noop';
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
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });

  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function waitForTeamJob(options: {
  startResult: CommandRunResult;
  root: string;
  commandRunner: ProductInterventionCommandRunner;
  timeoutMs?: number;
}): {
  failed: boolean;
  reason: string;
  jobId?: string;
  jobStatus?: string;
  waitArgv?: string[];
  result?: CommandRunResult;
} {
  const jobId = parseTeamJobId(options.startResult.stdout ?? '');
  if (!jobId) {
    return {
      failed: true,
      reason: 'Team start succeeded but no jobId was found in JSON output.',
    };
  }

  const waitArgv = ['omc', 'team', 'wait', jobId, '--json'];
  if (options.timeoutMs != null) {
    waitArgv.push('--timeout-ms', String(options.timeoutMs));
  }

  const result = options.commandRunner(waitArgv, options.root);
  const parsed = parseJsonObject(result.stdout ?? '');
  const jobStatus = typeof parsed?.status === 'string' ? parsed.status : undefined;
  const timedOut = parsed?.timedOut === true;
  if (result.error || result.status !== 0) {
    return {
      failed: true,
      reason: result.error?.message ?? `Team wait exited with status ${result.status ?? 'unknown'}.`,
      jobId,
      jobStatus,
      waitArgv,
      result,
    };
  }
  if (timedOut) {
    return {
      failed: true,
      reason: 'Team wait timed out before completion.',
      jobId,
      jobStatus,
      waitArgv,
      result,
    };
  }
  if (jobStatus !== 'completed') {
    return {
      failed: true,
      reason: `Team job ended with status ${jobStatus ?? 'unknown'}.`,
      jobId,
      jobStatus,
      waitArgv,
      result,
    };
  }

  return {
    failed: false,
    reason: 'Team job completed successfully.',
    jobId,
    jobStatus,
    waitArgv,
    result,
  };
}

function parseTeamJobId(stdout: string): string | undefined {
  const parsed = parseJsonObject(stdout);
  const jobId = parsed?.jobId;
  return typeof jobId === 'string' && jobId.trim() ? jobId : undefined;
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore non-JSON command output.
  }
  return undefined;
}

function ensureFlag(argv: string[], flag: string): string[] {
  return argv.includes(flag) ? argv : [...argv, flag];
}

function renderArgv(argv: string[]): string {
  return argv.map((arg) => (/^[a-z0-9_./:=,-]+$/i.test(arg) ? arg : JSON.stringify(arg))).join(' ');
}
