/**
 * `omc product-cycle` — runtime FSM for the product learning loop.
 */

import { colors, renderTable } from '../utils/formatting.js';
import {
  advanceProductCycle,
  getNextProductCycleAction,
  isProductCycleStage,
  readProductCycle,
  validateProductCycle,
  type ProductCycleSnapshot,
  type ProductCycleStage,
} from '../../product/cycle-fsm.js';
import {
  repairProductCycle,
  type ProductCycleRepairReport,
} from '../../product/cycle-repair.js';
import {
  runProductCycle,
  type CycleRunnerStageResult,
  type RunProductCycleReport,
} from '../../product/cycle-runner.js';
import {
  PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH,
  readProductInterventionHandoff,
  type ProductInterventionHandoff,
} from '../../product/intervention-router.js';
import {
  buildProductInterventionExecutionPlan,
  PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
  readProductInterventionExecutionPlan,
  renderProductInterventionExecutionPlan,
  writeProductInterventionExecutionPlan,
  type ProductInterventionExecutionPlan,
  type ProductInterventionExecutionPlanWriteResult,
} from '../../product/intervention-execution-plan.js';
import {
  PRODUCT_INTERVENTION_RUN_REPORT_RELATIVE_PATH,
  renderProductInterventionRunReport,
  runProductInterventionExecutionPlan,
  writeProductInterventionRunReport,
  type ProductInterventionCommandRunner,
  type ProductInterventionRunReport,
  type ProductInterventionRunReportWriteResult,
} from '../../product/intervention-runner.js';
import {
  PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH,
  readProductResearchHandoff,
  type ProductResearchHandoff,
} from '../../product/research-router.js';
import {
  buildProductResearchExecutionPlan,
  PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH,
  readProductResearchExecutionPlan,
  renderProductResearchExecutionPlan,
  writeProductResearchExecutionPlan,
  type ProductResearchExecutionPlan,
  type ProductResearchExecutionPlanWriteResult,
} from '../../product/research-execution-plan.js';
import {
  PRODUCT_RESEARCH_RUN_REPORT_RELATIVE_PATH,
  renderProductResearchRunReport,
  runProductResearchExecutionPlan,
  writeProductResearchRunReport,
  type ProductResearchRunReport,
  type ProductResearchRunReportWriteResult,
} from '../../product/research-runner.js';
import { emitProductCycleEvent } from '../../telemetry/emit.js';
import {
  buildAutoAttemptKey,
  decideAutoAction,
  type AutoDecision,
  type ProductCycleAutoPolicy,
} from '../../product/auto-decision.js';
import {
  incrementProductCycleAutoAttempt,
  readProductCycleAutoState,
  startProductCycleAutoState,
  updateProductCycleAutoState,
} from '../../product/cycle-auto-state.js';
import { loadConfig } from '../../config/loader.js';
import { limitFinalReport } from '../../lib/summary-policy.js';

export interface ProductCycleCommandOptions {
  json?: boolean;
  to?: string;
  goal?: string;
  force?: boolean;
  maxStages?: number;
  stopAt?: string;
  dryRun?: boolean;
  verifyCommand?: string;
  provider?: string;
  maxSteps?: number;
  wait?: boolean;
  waitTimeoutMs?: number;
  resumeCycle?: boolean;
  autoBuild?: boolean;
  auto?: boolean;
  autoPolicy?: string;
  maxAutoAttempts?: number;
  runtimeQa?: boolean;
  installMobileTools?: boolean;
  safe?: boolean;
  interventionCommandRunner?: ProductInterventionCommandRunner;
}

interface ProductCycleAutoBuildResult {
  status: 'passed' | 'failed' | 'not-run';
  reason: string;
  plan?: ProductInterventionExecutionPlan;
  planWritten?: ProductInterventionExecutionPlanWriteResult;
  runReport?: ProductInterventionRunReport;
  runReportWritten?: ProductInterventionRunReportWriteResult;
  resumedCycleReport?: RunProductCycleReport;
}

interface ProductCycleAutoRunResult {
  kind: 'research' | 'intervention';
  stage?: ProductCycleStage;
  decision: AutoDecision;
  attemptKey: string;
  attemptCount: number;
  runReport?: ProductResearchRunReport | ProductInterventionRunReport;
  written?: ProductResearchRunReportWriteResult | ProductInterventionRunReportWriteResult;
  resumedCycleReport?: RunProductCycleReport;
}

interface LoggerLike {
  log: (message?: unknown) => void;
  error: (message?: unknown) => void;
}

export async function productCycleStatusCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const snapshot = getNextProductCycleAction(root);
  logger.log(options.json ? JSON.stringify(snapshot, null, 2) : renderSnapshot(snapshot));
  return snapshot.issues.some((issue) => issue.severity === 'error') ? 1 : 0;
}

export async function productCycleNextCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const snapshot = getNextProductCycleAction(root);
  if (options.json) {
    logger.log(JSON.stringify({ nextAction: snapshot.nextAction, nextStage: snapshot.nextStage, snapshot }, null, 2));
  } else {
    logger.log(snapshot.nextAction);
  }
  return 0;
}

export async function productCycleValidateCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const snapshot = validateProductCycle(root);
  logger.log(options.json ? JSON.stringify(snapshot, null, 2) : renderSnapshot(snapshot));
  return snapshot.issues.some((issue) => issue.severity === 'error') ? 1 : 0;
}

export async function productCycleRepairCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const report = repairProductCycle(root, { safe: options.safe === true });
  logger.log(options.json ? JSON.stringify(report, null, 2) : renderRepairReport(report));
  return report.ok ? 0 : 1;
}

export async function productCycleAdvanceCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const to = options.to;
  if (!to || !isProductCycleStage(to)) {
    logger.error(colors.red(`Invalid or missing target stage: ${to ?? '<missing>'}`));
    logger.error(colors.gray('Valid stages: discover, rank, select, spec, build, verify, learn, complete, blocked'));
    return 2;
  }

  const result = advanceProductCycle({
    root,
    to,
    goal: options.goal,
    force: options.force,
  });

  if (options.json) {
    logger.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    logger.log(colors.green(`Advanced product cycle${result.from ? `: ${result.from} -> ${result.to}` : ` to ${result.to}`}`));
    logger.log(renderSnapshot(result.snapshot));
  } else {
    logger.error(colors.red(`Cannot advance product cycle to ${result.to}`));
    for (const issue of result.issues) {
      logger.error(`  ${issue.severity}: ${issue.code}: ${issue.message}`);
    }
  }

  return result.ok ? 0 : 1;
}

export async function productCycleRunCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const stopAt = options.stopAt;
  if (stopAt && !isProductCycleStage(stopAt)) {
    logger.error(colors.red(`Invalid --stop-at stage: ${stopAt}`));
    return 2;
  }
  if (options.autoPolicy && !isAutoPolicyValue(options.autoPolicy)) {
    logger.error(colors.red(`Invalid --auto-policy: ${options.autoPolicy}`));
    logger.error(colors.gray('Valid auto policies: off, safe'));
    return 2;
  }

  const autoPolicy = resolveAutoPolicy(options);
  const rootPath = root ?? process.cwd();
  const config = loadConfig();
  const report = runProductCycle({
    root,
    goal: options.goal,
    maxStages: options.maxStages,
    stopAt: stopAt as ProductCycleStage | undefined,
    dryRun: options.dryRun,
    verifyCommand: options.verifyCommand,
    runtimeQa: options.runtimeQa,
    runtimeQaAuto: autoPolicy === 'safe',
    runtimeQaInstallMobileTools: options.installMobileTools === true,
  });
  if (autoPolicy === 'safe' && options.dryRun !== true) {
    const snapshot = readProductCycle(rootPath);
    startProductCycleAutoState({
      root: rootPath,
      autoPolicy,
      cycleId: snapshot.cycleId,
      cycleGoal: snapshot.cycleGoal,
      cycleStage: snapshot.stage,
    });
  }

  const autoResult = autoPolicy === 'safe'
    ? runSafeAutoCycle(root, report, options, autoPolicy)
    : { finalReport: report, autoRuns: [] as ProductCycleAutoRunResult[], autoBuild: undefined };
  const autoBuild = autoResult.autoBuild;
  await emitProductCycleRunTelemetry(root, report, options, autoBuild);
  await emitProductCycleAutoRunTelemetry(root, autoResult.autoRuns, autoPolicy);

  if (options.json) {
    logger.log(JSON.stringify({
      ...report,
      autoPolicy,
      autoBuild,
      autoRuns: autoResult.autoRuns,
      finalReport: autoResult.finalReport,
    }, null, 2));
  } else {
    logger.log(limitFinalReport(renderRunReport(report, autoBuild, autoResult.autoRuns), config.summaryPolicy));
  }

  const finalReport = autoResult.finalReport;
  if (autoPolicy === 'safe' && options.dryRun !== true) {
    updateProductCycleAutoState(rootPath, {
      active: false,
      completed_at: new Date().toISOString(),
      cycle_stage: finalReport.endedAtStage,
      stopped_reason: finalReport.stoppedReason,
    });
  }
  const autoFailed = autoResult.autoRuns.some((run) => (
    run.decision.action === 'block'
    || run.runReport?.status === 'failed'
  ));
  return finalReport.ok && !autoFailed && autoBuild?.status !== 'failed' ? 0 : 1;
}

export async function productCycleInterventionsCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const handoff = readProductInterventionHandoff(root);
  if (!handoff) {
    if (options.json) {
      logger.log(JSON.stringify({ exists: false, path: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH }, null, 2));
    } else {
      logger.log(`No pending product-cycle interventions at ${PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH}`);
    }
    return 0;
  }

  if (options.json) {
    logger.log(JSON.stringify({ exists: true, path: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH, handoff }, null, 2));
  } else {
    logger.log(renderInterventionHandoff(handoff));
  }
  return handoff.blocking_route_count > 0 ? 1 : 0;
}

export async function productCycleInterventionsPlanCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const handoff = readProductInterventionHandoff(root);
  if (!handoff) {
    if (options.json) {
      logger.log(JSON.stringify({
        exists: false,
        path: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH,
        executionPlanPath: PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
      }, null, 2));
    } else {
      logger.log(`No pending product-cycle interventions at ${PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH}`);
    }
    return 0;
  }

  const plan = buildProductInterventionExecutionPlan(handoff, {
    provider: options.provider,
    sourceHandoff: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH,
  });
  const written = options.dryRun ? undefined : writeProductInterventionExecutionPlan(root ?? process.cwd(), plan);

  if (options.json) {
    logger.log(JSON.stringify({
      exists: true,
      path: PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
      written: written ?? null,
      plan,
    }, null, 2));
  } else {
    logger.log(renderInterventionExecutionPlan(plan, written));
  }

  return plan.steps.some((step) => !step.executable) ? 1 : 0;
}

export async function productCycleInterventionsRunCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const loaded = loadOrBuildInterventionExecutionPlan(root, options);
  if (!loaded.plan) {
    if (options.json) {
      logger.log(JSON.stringify({
        exists: false,
        path: PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
        handoffPath: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH,
      }, null, 2));
    } else {
      logger.log(`No pending product-cycle execution plan at ${PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH}`);
    }
    return 0;
  }

  const report = runProductInterventionExecutionPlan(loaded.plan, {
    root,
    dryRun: options.dryRun,
    maxSteps: options.maxSteps,
    waitForTeamJobs: options.wait,
    teamWaitTimeoutMs: options.waitTimeoutMs,
    sourcePlan: PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
  });
  const written = options.dryRun ? undefined : writeProductInterventionRunReport(root ?? process.cwd(), report);
  await emitProductInterventionRunTelemetry(root, loaded.plan, report);

  if (options.json) {
    logger.log(JSON.stringify({
      exists: true,
      path: PRODUCT_INTERVENTION_RUN_REPORT_RELATIVE_PATH,
      planWritten: loaded.written ?? null,
      written: written ?? null,
      report,
    }, null, 2));
  } else {
    logger.log(renderInterventionRunReport(report, written, loaded.written));
  }

  return report.status === 'failed' ? 1 : 0;
}

export async function productCycleResearchCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const handoff = readProductResearchHandoff(root);
  if (!handoff) {
    if (options.json) {
      logger.log(JSON.stringify({ exists: false, path: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH }, null, 2));
    } else {
      logger.log(`No pending product-cycle research at ${PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH}`);
    }
    return 0;
  }

  if (options.json) {
    logger.log(JSON.stringify({ exists: true, path: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH, handoff }, null, 2));
  } else {
    logger.log(renderResearchHandoff(handoff));
  }

  return handoff.blocking_route_count > 0 ? 1 : 0;
}

export async function productCycleResearchPlanCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const handoff = readProductResearchHandoff(root);
  if (!handoff) {
    if (options.json) {
      logger.log(JSON.stringify({
        exists: false,
        path: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH,
        executionPlanPath: PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH,
      }, null, 2));
    } else {
      logger.log(`No pending product-cycle research at ${PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH}`);
    }
    return 0;
  }

  const plan = buildProductResearchExecutionPlan(handoff, {
    provider: options.provider,
    sourceHandoff: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH,
  });
  const written = options.dryRun ? undefined : writeProductResearchExecutionPlan(root ?? process.cwd(), plan);

  if (options.json) {
    logger.log(JSON.stringify({
      exists: true,
      path: PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH,
      written: written ?? null,
      plan,
    }, null, 2));
  } else {
    logger.log(renderResearchExecutionPlan(plan, written));
  }

  return plan.steps.some((step) => !step.executable) ? 1 : 0;
}

export async function productCycleResearchRunCommand(
  root: string | undefined,
  options: ProductCycleCommandOptions,
  logger: LoggerLike = console,
): Promise<number> {
  const loaded = loadOrBuildResearchExecutionPlan(root, options);
  if (!loaded.plan) {
    if (options.json) {
      logger.log(JSON.stringify({
        exists: false,
        path: PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH,
        handoffPath: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH,
      }, null, 2));
    } else {
      logger.log(`No pending product-cycle research execution plan at ${PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH}`);
    }
    return 0;
  }

  const report = runProductResearchExecutionPlan(loaded.plan, {
    root,
    dryRun: options.dryRun,
    maxSteps: options.maxSteps,
    sourcePlan: PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH,
  });
  const written = options.dryRun ? undefined : writeProductResearchRunReport(root ?? process.cwd(), report);
  const resumedCycleReport = shouldResumeCycleAfterResearch(report, options)
    ? runProductCycle({ root })
    : undefined;
  await emitProductResearchRunTelemetry(root, report, resumedCycleReport);

  if (options.json) {
    logger.log(JSON.stringify({
      exists: true,
      path: PRODUCT_RESEARCH_RUN_REPORT_RELATIVE_PATH,
      planWritten: loaded.written ?? null,
      written: written ?? null,
      report,
      resumedCycleReport: resumedCycleReport ?? null,
    }, null, 2));
  } else {
    logger.log(renderResearchRunReport(report, written, loaded.written, resumedCycleReport));
  }

  return report.status === 'failed' ? 1 : 0;
}

function shouldResumeCycleAfterResearch(
  report: ProductResearchRunReport,
  options: ProductCycleCommandOptions,
): boolean {
  return options.resumeCycle !== false
    && options.dryRun !== true
    && report.failed_step_count === 0
    && report.research_artifact_valid;
}

async function emitProductCycleRunTelemetry(
  root: string | undefined,
  report: RunProductCycleReport,
  options: ProductCycleCommandOptions,
  autoBuild: ProductCycleAutoBuildResult | undefined,
): Promise<void> {
  const context = productCycleTelemetryContext(root);
  for (const result of report.stageResults) {
    await emitProductCycleEvent({
      ...context,
      event: 'stage_decision',
      cycle_stage: result.stage,
      outcome: result.outcome,
      reason: result.reason,
      has_interventions: (result.interventions?.length ?? 0) > 0,
      has_research: (result.research?.length ?? 0) > 0,
      intervention_route_ids: result.interventions?.map((route) => route.id) ?? [],
      research_route_ids: result.research?.map((route) => route.id) ?? [],
    });

    if (result.research && result.research.length > 0) {
      await emitProductCycleEvent({
        ...context,
        event: 'research_blocked',
        cycle_stage: result.stage,
        route_count: result.research.length,
        route_ids: result.research.map((route) => route.id),
        next_command: result.instruction,
      });
      await emitProductCycleEvent({
        ...context,
        event: 'manual_handoff',
        cycle_stage: result.stage,
        handoff_kind: 'research',
        reason: result.reason,
      });
    }
  }

  const buildInterventionPlan = report.endedAtStage === 'build'
    ? report.interventionExecutionPlan
    : undefined;
  const hasBuildInterventionPlan = buildInterventionPlan !== undefined
    && report.stageResults.some((result) => (
      result.stage === 'build'
      && (result.interventions?.length ?? 0) > 0
    ));

  if (hasBuildInterventionPlan) {
    await emitProductCycleEvent({
      ...context,
      event: 'build_intervention_planned',
      cycle_stage: 'build',
      path: buildInterventionPlan.jsonPath,
      auto_build_status: autoBuild?.status ?? 'not-run',
    });
  }

  if (autoBuild) {
    await emitProductCycleEvent({
      ...context,
      event: autoBuildEventName(autoBuild.status),
      cycle_stage: 'build',
      reason: autoBuild.reason,
      run_status: autoBuild.runReport?.status,
    });
    if (autoBuild.status !== 'passed') {
      await emitProductCycleEvent({
        ...context,
        event: 'manual_handoff',
        cycle_stage: 'build',
        handoff_kind: 'build',
        reason: autoBuild.reason,
      });
    }
    if (autoBuild.runReport) {
      await emitProductInterventionRunTelemetry(root, autoBuild.plan, autoBuild.runReport);
    }
    if (autoBuild.resumedCycleReport) {
      await emitProductCycleEvent({
        ...context,
        event: 'auto_resume',
        cycle_stage: 'verify',
        reason: 'build_auto_completed',
        resumed_stopped_reason: autoBuild.resumedCycleReport.stoppedReason,
      });
      await emitProductCycleRunTelemetry(root, autoBuild.resumedCycleReport, options, undefined);
    }
  } else if (hasBuildInterventionPlan) {
    await emitProductCycleEvent({
      ...context,
      event: 'manual_handoff',
      cycle_stage: 'build',
      handoff_kind: 'build',
      reason: 'build intervention execution plan was written but not auto-run',
    });
  }

  await emitProductCycleEvent({
    ...context,
    event: 'product_cycle_run_stopped',
    cycle_stage: report.endedAtStage,
    started_from_stage: report.startedFromStage,
    stopped_reason: report.stoppedReason,
    ok: report.ok,
    stop_at: options.stopAt,
  });
}

async function emitProductInterventionRunTelemetry(
  root: string | undefined,
  plan: ProductInterventionExecutionPlan | undefined,
  report: ProductInterventionRunReport,
): Promise<void> {
  const context = productCycleTelemetryContext(root);
  await emitProductCycleEvent({
    ...context,
    event: 'intervention_run_completed',
    cycle_stage: plan?.cycle_stage,
    status: report.status,
    failed_step_count: report.failed_step_count,
    executed_step_count: report.executed_step_count,
    skipped_step_count: report.skipped_step_count,
  });

  for (const step of report.step_results) {
    if (step.execution_surface !== 'team-start') continue;
    await emitProductCycleEvent({
      ...context,
      event: 'build_team_started',
      cycle_stage: plan?.cycle_stage,
      route_id: step.route_id,
      child_job_id: step.child_job_id,
    });
    await emitProductCycleEvent({
      ...context,
      event: step.status === 'passed' ? 'build_team_completed' : 'build_team_failed',
      cycle_stage: plan?.cycle_stage,
      route_id: step.route_id,
      child_job_id: step.child_job_id,
      child_job_status: step.child_job_status,
      status: step.status,
      reason: step.reason,
    });
  }
}

async function emitProductResearchRunTelemetry(
  root: string | undefined,
  report: ProductResearchRunReport,
  resumedCycleReport: RunProductCycleReport | undefined,
): Promise<void> {
  const context = productCycleTelemetryContext(root);
  await emitProductCycleEvent({
    ...context,
    event: 'research_run_completed',
    status: report.status,
    failed_step_count: report.failed_step_count,
    research_artifact_valid: report.research_artifact_valid,
  });
  if (resumedCycleReport) {
    await emitProductCycleEvent({
      ...context,
      event: 'research_auto_resumed',
      resumed_stopped_reason: resumedCycleReport.stoppedReason,
    });
    await emitProductCycleRunTelemetry(root, resumedCycleReport, {}, undefined);
  }
}

async function emitProductCycleAutoRunTelemetry(
  root: string | undefined,
  autoRuns: ProductCycleAutoRunResult[],
  autoPolicy: ProductCycleAutoPolicy,
): Promise<void> {
  const context = productCycleTelemetryContext(root);
  for (const run of autoRuns) {
    await emitProductCycleEvent({
      ...context,
      event: 'auto_decision',
      cycle_stage: run.stage,
      auto_policy: autoPolicy,
      handoff_kind: run.kind,
      action: run.decision.action,
      reason: run.decision.reason,
      attempt_key: run.attemptKey,
      attempt_count: run.attemptCount,
      run_status: run.runReport?.status,
    });
  }
}

function productCycleTelemetryContext(root: string | undefined): {
  directory: string;
  cycle_id?: string;
  cycle_stage?: string;
  cycle_goal?: string;
  build_route?: string;
} {
  const directory = root ?? process.cwd();
  const snapshot = readProductCycle(directory);
  return {
    directory,
    cycle_id: snapshot.cycleId,
    cycle_stage: snapshot.stage,
    cycle_goal: snapshot.cycleGoal,
    build_route: snapshot.buildRoute,
  };
}

function autoBuildEventName(status: ProductCycleAutoBuildResult['status']): string {
  if (status === 'passed') return 'build_auto_completed';
  if (status === 'failed') return 'build_auto_failed';
  return 'build_auto_not_run';
}

interface ProductCycleSafeAutoResult {
  finalReport: RunProductCycleReport;
  autoRuns: ProductCycleAutoRunResult[];
  autoBuild?: ProductCycleAutoBuildResult;
}

function runSafeAutoCycle(
  root: string | undefined,
  initialReport: RunProductCycleReport,
  options: ProductCycleCommandOptions,
  autoPolicy: ProductCycleAutoPolicy,
): ProductCycleSafeAutoResult {
  const rootPath = root ?? process.cwd();
  const maxAttempts = options.maxAutoAttempts ?? 3;
  const autoRuns: ProductCycleAutoRunResult[] = [];
  let report = initialReport;
  let autoBuild: ProductCycleAutoBuildResult | undefined;

  for (let loop = 0; loop < maxAttempts * 3; loop += 1) {
    if (report.stoppedReason === 'complete' || report.stoppedReason === 'pause-for-human' || report.stoppedReason === 'blocked') {
      break;
    }

    if (report.researchHandoff) {
      const loaded = loadOrBuildResearchExecutionPlan(root, options);
      if (!loaded.plan) break;
      const attemptKey = buildAutoAttemptKey(report.endedAtStage, 'research');
      const attemptCount = readProductCycleAutoState(rootPath)?.attempt_counts[attemptKey] ?? 0;
      const decision = decideAutoAction({
        policy: autoPolicy,
        stage: report.endedAtStage,
        handoffKind: 'research',
        plan: loaded.plan,
        missingDependency: loaded.plan.steps.some((step) => step.execution_surface === 'stack-plan'),
        attemptCount,
        maxAttempts,
        safeStepPredicate: (step) => step.execution_surface === 'agent-prompt'
          && step.executable
          && Boolean(step.argv?.length),
      });
      updateProductCycleAutoState(rootPath, {
        cycle_stage: report.endedAtStage,
        stopped_reason: report.stoppedReason,
        last_decision: decision,
      });
      if (decision.action !== 'run') {
        autoRuns.push({ kind: 'research', stage: report.endedAtStage, decision, attemptKey, attemptCount });
        break;
      }

      const nextAttemptCount = incrementProductCycleAutoAttempt(rootPath, attemptKey);
      const runReport = runProductResearchExecutionPlan(loaded.plan, {
        root,
        dryRun: options.dryRun,
        maxSteps: options.maxSteps,
        sourcePlan: PRODUCT_RESEARCH_EXECUTION_PLAN_RELATIVE_PATH,
      });
      const written = options.dryRun ? undefined : writeProductResearchRunReport(rootPath, runReport);
      const resumedCycleReport = shouldResumeCycleAfterResearch(runReport, options)
        ? runProductCycle({
          root,
          maxStages: options.maxStages,
          stopAt: options.stopAt as ProductCycleStage | undefined,
          verifyCommand: options.verifyCommand,
          runtimeQa: options.runtimeQa,
          runtimeQaAuto: true,
          runtimeQaInstallMobileTools: options.installMobileTools === true,
        })
        : undefined;
      autoRuns.push({
        kind: 'research',
        stage: report.endedAtStage,
        decision,
        attemptKey,
        attemptCount: nextAttemptCount,
        runReport,
        written,
        resumedCycleReport,
      });
      if (!resumedCycleReport || runReport.status === 'failed') break;
      report = resumedCycleReport;
      continue;
    }

    if (report.interventionExecutionPlan) {
      const loaded = loadOrBuildInterventionExecutionPlan(root, options);
      if (!loaded.plan) break;
      const attemptKey = buildAutoAttemptKey(report.endedAtStage, 'intervention');
      const attemptCount = readProductCycleAutoState(rootPath)?.attempt_counts[attemptKey] ?? 0;
      const decision = decideAutoAction({
        policy: autoPolicy,
        stage: report.endedAtStage,
        handoffKind: 'intervention',
        plan: loaded.plan,
        humanGate: loaded.plan.cycle_stage === 'build' && options.autoBuild === false,
        missingDependency: loaded.plan.steps.some((step) => step.execution_surface === 'stack-plan'),
        attemptCount,
        maxAttempts,
        safeStepPredicate: (step) => isSafeAutoInterventionStep(loaded.plan!.cycle_stage, step),
      });
      updateProductCycleAutoState(rootPath, {
        cycle_stage: report.endedAtStage,
        stopped_reason: report.stoppedReason,
        last_decision: decision,
      });
      if (decision.action !== 'run') {
        autoRuns.push({ kind: 'intervention', stage: report.endedAtStage, decision, attemptKey, attemptCount });
        break;
      }

      const nextAttemptCount = incrementProductCycleAutoAttempt(rootPath, attemptKey);
      const runReport = runProductInterventionExecutionPlan(loaded.plan, {
        root,
        maxSteps: options.maxSteps,
        waitForTeamJobs: loaded.plan.steps.some((step) => step.execution_surface === 'team-start'),
        teamWaitTimeoutMs: options.waitTimeoutMs,
        sourcePlan: PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
        commandRunner: options.interventionCommandRunner,
      });
      const written = options.dryRun ? undefined : writeProductInterventionRunReport(rootPath, runReport);
      let resumedCycleReport: RunProductCycleReport | undefined;

      if (runReport.status === 'passed' && loaded.plan.cycle_stage === 'build') {
        const advance = advanceProductCycle({ root, to: 'verify' });
        if (!advance.ok) {
          autoBuild = {
            status: 'failed',
            reason: `Build completed, but advancing build -> verify failed: ${advance.issues.map((issue) => issue.code).join(', ')}`,
            plan: loaded.plan,
            planWritten: loaded.written,
            runReport,
            runReportWritten: written as ProductInterventionRunReportWriteResult | undefined,
          };
        } else {
          resumedCycleReport = runProductCycle({
            root,
            maxStages: options.maxStages,
            stopAt: options.stopAt as ProductCycleStage | undefined,
            verifyCommand: options.verifyCommand,
            runtimeQa: options.runtimeQa,
            runtimeQaAuto: true,
            runtimeQaInstallMobileTools: options.installMobileTools === true,
          });
          autoBuild = {
            status: 'passed',
            reason: 'Build pipeline team job completed; product cycle advanced to verify and resumed.',
            plan: loaded.plan,
            planWritten: loaded.written,
            runReport,
            runReportWritten: written as ProductInterventionRunReportWriteResult | undefined,
            resumedCycleReport,
          };
        }
      } else if (runReport.status === 'passed') {
        resumedCycleReport = runProductCycle({
          root,
          maxStages: options.maxStages,
          stopAt: options.stopAt as ProductCycleStage | undefined,
          verifyCommand: options.verifyCommand,
          runtimeQa: options.runtimeQa,
          runtimeQaAuto: true,
          runtimeQaInstallMobileTools: options.installMobileTools === true,
        });
      } else if (loaded.plan.cycle_stage === 'build') {
        autoBuild = {
          status: 'failed',
          reason: `Build intervention run ended with status ${runReport.status}.`,
          plan: loaded.plan,
          planWritten: loaded.written,
          runReport,
          runReportWritten: written as ProductInterventionRunReportWriteResult | undefined,
        };
      }

      autoRuns.push({
        kind: 'intervention',
        stage: report.endedAtStage,
        decision,
        attemptKey,
        attemptCount: nextAttemptCount,
        runReport,
        written,
        resumedCycleReport,
      });
      if (!resumedCycleReport || runReport.status !== 'passed') break;
      report = resumedCycleReport;
      continue;
    }

    break;
  }

  return { finalReport: report, autoRuns, autoBuild };
}

function isSafeAutoInterventionStep(
  stage: ProductCycleStage,
  step: ProductInterventionExecutionPlan['steps'][number] | ProductResearchExecutionPlan['steps'][number],
): boolean {
  if (!step.executable || !step.argv || step.argv.length === 0) return false;
  if (stage === 'build') {
    return step.execution_surface === 'team-start'
      && (step.agent === 'product-pipeline' || step.agent === 'backend-pipeline');
  }
  return step.execution_surface === 'agent-prompt';
}

function resolveAutoPolicy(options: ProductCycleCommandOptions): ProductCycleAutoPolicy {
  const raw = options.autoPolicy?.trim().toLowerCase();
  if (raw === 'safe') return 'safe';
  if (raw === 'off') return 'off';
  return options.auto === true ? 'safe' : 'off';
}

function isAutoPolicyValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'off' || normalized === 'safe';
}

function renderRunReport(
  report: RunProductCycleReport,
  autoBuild?: ProductCycleAutoBuildResult,
  autoRuns: ProductCycleAutoRunResult[] = [],
): string {
  const lines: string[] = [];
  lines.push(colors.bold(`Product cycle runner — stopped: ${report.stoppedReason}`));
  if (report.startedFromStage) {
    lines.push(`Started from: ${report.startedFromStage}`);
  }
  if (report.endedAtStage) {
    lines.push(`Ended at: ${report.endedAtStage}`);
  }

  if (report.stagesAdvanced.length > 0) {
    lines.push('');
    lines.push(colors.bold('Stages advanced:'));
    for (const advance of report.stagesAdvanced) {
      lines.push(`  ${advance.from} -> ${advance.to}  (${advance.reason})`);
    }
  }

  if (report.stageResults.length > 0) {
    lines.push('');
    lines.push(colors.bold('Stage decisions:'));
    for (const result of report.stageResults) {
      lines.push(`  ${formatStageOutcome(result)}`);
      if (result.instruction) {
        lines.push(`    ${colors.gray('next:')} ${result.instruction}`);
      }
      if (result.interventions && result.interventions.length > 0) {
        for (const route of result.interventions) {
          const marker = route.required ? 'required' : 'recommended';
          lines.push(`    ${colors.gray(marker)} ${route.agent}: ${route.command}`);
        }
      }
      if (result.research && result.research.length > 0) {
        for (const route of result.research) {
          const marker = route.required ? 'required research' : 'recommended research';
          lines.push(`    ${colors.gray(marker)} ${route.agent}: ${route.command}`);
        }
      }
      if (result.runtimeQa) {
        lines.push(`    ${colors.gray('runtime-qa')} ${result.runtimeQa.report.status}: ${result.runtimeQa.report.adapter}`);
      }
    }
  }

  if (autoRuns.length > 0) {
    lines.push('');
    lines.push(colors.bold('Auto runs:'));
    for (const run of autoRuns) {
      lines.push(`  ${run.kind} ${run.stage ?? '-'}: ${run.decision.action}/${run.decision.reason}`);
      if (run.runReport) {
        lines.push(`    status: ${run.runReport.status}`);
      }
    }
  }

  if (report.pauseInstruction) {
    lines.push('');
    lines.push(colors.bold('Pause instruction:'));
    lines.push(`  ${report.pauseInstruction}`);
  }

  if (report.interventionHandoff) {
    lines.push('');
    lines.push(colors.bold('Intervention handoff:'));
    lines.push(`  ${report.interventionHandoff.jsonPath}`);
  }

  if (report.researchHandoff) {
    lines.push('');
    lines.push(colors.bold('Research handoff:'));
    lines.push(`  ${report.researchHandoff.jsonPath}`);
  }

  if (report.interventionExecutionPlan) {
    lines.push('');
    lines.push(colors.bold('Intervention execution plan:'));
    lines.push(`  ${report.interventionExecutionPlan.jsonPath}`);
  }

  if (autoBuild) {
    lines.push('');
    lines.push(colors.bold(`Auto build: ${autoBuild.status}`));
    lines.push(`  ${autoBuild.reason}`);
    if (autoBuild.runReport) {
      lines.push('', renderProductInterventionRunReport(autoBuild.runReport).trimEnd());
    }
    if (autoBuild.runReportWritten) {
      lines.push('', colors.bold('Auto build run report written:'));
      lines.push(`  ${autoBuild.runReportWritten.jsonPath}`);
      lines.push(`  ${autoBuild.runReportWritten.mdPath}`);
    }
    if (autoBuild.resumedCycleReport) {
      lines.push('', colors.bold('Resumed product cycle after build:'), renderRunReport(autoBuild.resumedCycleReport));
    }
  }

  if (report.issues.length > 0) {
    lines.push('');
    lines.push(colors.bold('Issues:'));
    for (const issue of report.issues) {
      const marker = issue.severity === 'error' ? colors.red('error') : colors.yellow('warning');
      lines.push(`  ${marker} ${issue.code}: ${issue.message}`);
    }
  }

  return lines.join('\n');
}

function formatStageOutcome(result: CycleRunnerStageResult): string {
  const verdictColor = result.outcome === 'advance'
    ? colors.green
    : result.outcome === 'verify-failed' || result.outcome === 'contract-failed'
      ? colors.red
      : colors.yellow;
  return `${verdictColor(result.outcome.padEnd(15))} ${result.stage}: ${result.reason}`;
}

function renderInterventionHandoff(handoff: ProductInterventionHandoff): string {
  const lines = [
    colors.bold('Product cycle interventions'),
    `cycle_stage: ${handoff.cycle_stage}`,
    `status: ${handoff.status}`,
    `blocking_route_count: ${handoff.blocking_route_count}`,
  ];

  if (handoff.next_command) {
    lines.push(`next_command: ${handoff.next_command}`);
  }

  if (handoff.routes.length > 0) {
    lines.push('');
    lines.push(colors.bold('Routes:'));
    for (const route of handoff.routes) {
      const marker = route.required ? 'required' : 'recommended';
      lines.push(`  ${marker} ${route.agent}: ${route.command}`);
      lines.push(`    ${colors.gray(route.trigger)}`);
    }
  }

  return lines.join('\n');
}

function renderResearchHandoff(handoff: ProductResearchHandoff): string {
  const lines = [
    colors.bold('Product cycle research'),
    `cycle_stage: ${handoff.cycle_stage}`,
    `status: ${handoff.status}`,
    `blocking_route_count: ${handoff.blocking_route_count}`,
    `research_artifact: ${handoff.research_artifact}`,
  ];

  if (handoff.next_command) {
    lines.push(`next_command: ${handoff.next_command}`);
  }

  if (handoff.routes.length > 0) {
    lines.push('');
    lines.push(colors.bold('Routes:'));
    for (const route of handoff.routes) {
      const marker = route.required ? 'required' : 'recommended';
      lines.push(`  ${marker} ${route.agent}: ${route.command}`);
      lines.push(`    ${colors.gray(route.trigger)}`);
    }
  }

  return lines.join('\n');
}

function renderResearchExecutionPlan(
  plan: ProductResearchExecutionPlan,
  written: ProductResearchExecutionPlanWriteResult | undefined,
): string {
  const rendered = renderProductResearchExecutionPlan(plan);
  if (!written) return rendered;
  return [
    rendered.trimEnd(),
    '',
    colors.bold('Research execution plan written:'),
    `  ${written.jsonPath}`,
    `  ${written.mdPath}`,
  ].join('\n');
}

function renderResearchRunReport(
  report: ProductResearchRunReport,
  written: ProductResearchRunReportWriteResult | undefined,
  planWritten: ProductResearchExecutionPlanWriteResult | undefined,
  resumedCycleReport: RunProductCycleReport | undefined,
): string {
  const lines = [renderProductResearchRunReport(report).trimEnd()];

  if (planWritten) {
    lines.push('', colors.bold('Research execution plan written:'), `  ${planWritten.jsonPath}`, `  ${planWritten.mdPath}`);
  }

  if (written) {
    lines.push('', colors.bold('Research run report written:'), `  ${written.jsonPath}`, `  ${written.mdPath}`);
  }

  if (resumedCycleReport) {
    lines.push('', colors.bold('Resumed product cycle:'), renderRunReport(resumedCycleReport));
  }

  return lines.join('\n');
}

function renderInterventionExecutionPlan(
  plan: ProductInterventionExecutionPlan,
  written: { jsonPath: string; mdPath: string } | undefined,
): string {
  const rendered = renderProductInterventionExecutionPlan(plan);
  if (!written) return rendered;
  return [
    rendered.trimEnd(),
    '',
    colors.bold('Execution plan written:'),
    `  ${written.jsonPath}`,
    `  ${written.mdPath}`,
  ].join('\n');
}

function renderInterventionRunReport(
  report: ProductInterventionRunReport,
  written: ProductInterventionRunReportWriteResult | undefined,
  planWritten: ProductInterventionExecutionPlanWriteResult | undefined,
): string {
  const lines = [renderProductInterventionRunReport(report).trimEnd()];

  if (planWritten) {
    lines.push('', colors.bold('Execution plan written:'), `  ${planWritten.jsonPath}`, `  ${planWritten.mdPath}`);
  }

  if (written) {
    lines.push('', colors.bold('Run report written:'), `  ${written.jsonPath}`, `  ${written.mdPath}`);
  }

  return lines.join('\n');
}

function loadOrBuildInterventionExecutionPlan(
  root: string | undefined,
  options: ProductCycleCommandOptions,
): {
  plan?: ProductInterventionExecutionPlan;
  written?: ProductInterventionExecutionPlanWriteResult;
} {
  const existing = readProductInterventionExecutionPlan(root);
  if (existing) return { plan: existing };

  const handoff = readProductInterventionHandoff(root);
  if (!handoff) return {};

  const plan = buildProductInterventionExecutionPlan(handoff, {
    provider: options.provider,
    sourceHandoff: PRODUCT_INTERVENTION_HANDOFF_RELATIVE_PATH,
  });
  const written = options.dryRun ? undefined : writeProductInterventionExecutionPlan(root ?? process.cwd(), plan);
  return { plan, written };
}

function loadOrBuildResearchExecutionPlan(
  root: string | undefined,
  options: ProductCycleCommandOptions,
): {
  plan?: ProductResearchExecutionPlan;
  written?: ProductResearchExecutionPlanWriteResult;
} {
  const existing = readProductResearchExecutionPlan(root);
  if (existing) return { plan: existing };

  const handoff = readProductResearchHandoff(root);
  if (!handoff) return {};

  const plan = buildProductResearchExecutionPlan(handoff, {
    provider: options.provider,
    sourceHandoff: PRODUCT_RESEARCH_HANDOFF_RELATIVE_PATH,
  });
  const written = options.dryRun ? undefined : writeProductResearchExecutionPlan(root ?? process.cwd(), plan);
  return { plan, written };
}

function renderSnapshot(snapshot: ProductCycleSnapshot): string {
  const rows = [
    { field: 'path', value: snapshot.path },
    { field: 'exists', value: String(snapshot.exists) },
    { field: 'cycle_id', value: snapshot.cycleId ?? '-' },
    { field: 'cycle_goal', value: snapshot.cycleGoal ?? '-' },
    { field: 'cycle_stage', value: snapshot.stage ?? '-' },
    { field: 'next_stage', value: snapshot.nextStage ?? '-' },
    { field: 'build_route', value: snapshot.buildRoute ?? '-' },
  ];

  const lines = [
    colors.bold('Product cycle FSM'),
    renderTable(rows, [
      { header: 'field', field: 'field', width: 14 },
      { header: 'value', field: 'value', width: 80 },
    ]),
    '',
    `${colors.bold('next_action')}: ${snapshot.nextAction}`,
  ];

  if (snapshot.issues.length > 0) {
    lines.push('');
    for (const issue of snapshot.issues) {
      const marker = issue.severity === 'error' ? colors.red('error') : colors.yellow('warning');
      lines.push(`${marker} ${issue.code}: ${issue.message}`);
    }
  }

  return lines.join('\n');
}

function renderRepairReport(report: ProductCycleRepairReport): string {
  const lines = [
    colors.bold('Product cycle repair'),
    `root: ${report.root}`,
    `safe: ${report.safe}`,
  ];

  lines.push('');
  lines.push(renderTable(report.actions.map((action) => ({
    action: action.id,
    status: statusColor(action.status),
    message: action.message,
    command: action.command ?? '-',
  })), [
    { header: 'action', field: 'action', width: 22 },
    { header: 'status', field: 'status', width: 10 },
    { header: 'message', field: 'message', width: 82 },
    { header: 'command', field: 'command', width: 52 },
  ]));

  lines.push('');
  if (!report.safe) {
    lines.push(colors.green(
      `Repair preview: ${report.summary.needed} needed, ${report.summary.blocked} blocked, ${report.summary.skipped} skipped.`,
    ));
  } else {
    lines.push(report.ok
      ? colors.green(`Repair ok: ${report.summary.changed} changed, ${report.summary.passed} passed.`)
      : colors.red(`Repair incomplete: ${report.summary.needed} needed, ${report.summary.blocked} blocked.`));
  }
  return lines.join('\n');
}

function statusColor(status: string): string {
  if (status === 'passed' || status === 'changed') return colors.green(status);
  if (status === 'blocked') return colors.red(status);
  if (status === 'needed') return colors.yellow(status);
  return status;
}
