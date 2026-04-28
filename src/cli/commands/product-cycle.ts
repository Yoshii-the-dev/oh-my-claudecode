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

  const report = runProductCycle({
    root,
    goal: options.goal,
    maxStages: options.maxStages,
    stopAt: stopAt as ProductCycleStage | undefined,
    dryRun: options.dryRun,
    verifyCommand: options.verifyCommand,
  });
  const autoBuild = maybeRunBuildInterventionsAndResume(root, report, options);
  await emitProductCycleRunTelemetry(root, report, options, autoBuild);

  if (options.json) {
    logger.log(JSON.stringify({ ...report, autoBuild }, null, 2));
  } else {
    logger.log(renderRunReport(report, autoBuild));
  }

  const finalReport = autoBuild?.resumedCycleReport ?? report;
  return finalReport.ok && autoBuild?.status !== 'failed' ? 0 : 1;
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

function maybeRunBuildInterventionsAndResume(
  root: string | undefined,
  report: RunProductCycleReport,
  options: ProductCycleCommandOptions,
): ProductCycleAutoBuildResult | undefined {
  if (options.autoBuild === false || options.dryRun === true) return undefined;
  if (options.stopAt === 'build') return undefined;
  if (report.stoppedReason !== 'pause-for-llm' || report.endedAtStage !== 'build') return undefined;
  if (!report.interventionExecutionPlan) return undefined;

  const loaded = loadOrBuildInterventionExecutionPlan(root, options);
  if (!loaded.plan) {
    return {
      status: 'not-run',
      reason: 'No product-cycle intervention execution plan was available after build routing.',
    };
  }

  const eligibility = autoBuildEligibility(loaded.plan);
  if (!eligibility.ok) {
    return {
      status: 'not-run',
      reason: eligibility.reason,
      plan: loaded.plan,
      planWritten: loaded.written,
    };
  }

  const runReport = runProductInterventionExecutionPlan(loaded.plan, {
    root,
    maxSteps: options.maxSteps,
    waitForTeamJobs: true,
    teamWaitTimeoutMs: options.waitTimeoutMs,
    sourcePlan: PRODUCT_INTERVENTION_EXECUTION_PLAN_RELATIVE_PATH,
    commandRunner: options.interventionCommandRunner,
  });
  const runReportWritten = writeProductInterventionRunReport(root ?? process.cwd(), runReport);

  if (runReport.status !== 'passed') {
    return {
      status: 'failed',
      reason: `Build intervention run ended with status ${runReport.status}.`,
      plan: loaded.plan,
      planWritten: loaded.written,
      runReport,
      runReportWritten,
    };
  }

  const advance = advanceProductCycle({ root, to: 'verify' });
  if (!advance.ok) {
    return {
      status: 'failed',
      reason: `Build completed, but advancing build -> verify failed: ${advance.issues.map((issue) => issue.code).join(', ')}`,
      plan: loaded.plan,
      planWritten: loaded.written,
      runReport,
      runReportWritten,
    };
  }

  const resumedCycleReport = runProductCycle({
    root,
    maxStages: options.maxStages,
    stopAt: options.stopAt as ProductCycleStage | undefined,
    verifyCommand: options.verifyCommand,
  });

  return {
    status: 'passed',
    reason: 'Build pipeline team job completed; product cycle advanced to verify and resumed.',
    plan: loaded.plan,
    planWritten: loaded.written,
    runReport,
    runReportWritten,
    resumedCycleReport,
  };
}

function autoBuildEligibility(plan: ProductInterventionExecutionPlan): { ok: true } | { ok: false; reason: string } {
  if (plan.cycle_stage !== 'build') {
    return { ok: false, reason: `Intervention plan is for ${plan.cycle_stage}, not build.` };
  }
  if (plan.steps.length === 0) {
    return { ok: false, reason: 'Intervention plan has no steps.' };
  }
  const unsafe = plan.steps.find((step) => (
    !step.executable
    || step.execution_surface !== 'team-start'
    || (step.agent !== 'product-pipeline' && step.agent !== 'backend-pipeline')
  ));
  if (unsafe) {
    return {
      ok: false,
      reason: `Auto-build only runs product/backend team-start steps; ${unsafe.route_id} is ${unsafe.execution_surface}.`,
    };
  }
  return { ok: true };
}

function renderRunReport(report: RunProductCycleReport, autoBuild?: ProductCycleAutoBuildResult): string {
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
