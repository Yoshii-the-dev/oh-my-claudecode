import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import {
  advanceProductCycle,
  readProductCycle,
  type ProductCycleIssue,
  type ProductCycleSnapshot,
  type ProductCycleStage,
} from './cycle-fsm.js';
import { validateProductPipelineContracts } from './pipeline-contract-validator.js';
import { readPortfolioLedger } from './portfolio-ledger.js';
import {
  planProductInterventions,
  readProductInterventionHandoff,
  writeProductInterventionHandoff,
  type ProductInterventionHandoffWriteResult,
  type ProductInterventionRoute,
} from './intervention-router.js';
import {
  buildProductInterventionExecutionPlan,
  writeProductInterventionExecutionPlan,
  type ProductInterventionExecutionPlanWriteResult,
} from './intervention-execution-plan.js';
import {
  planProductResearch,
  writeProductResearchHandoff,
  type ProductResearchHandoffWriteResult,
  type ProductResearchRoute,
} from './research-router.js';
import {
  runRuntimeQa,
  shouldRunRuntimeQa,
  writeRuntimeQaRunReport,
  type RuntimeQaRunReport,
  type RuntimeQaRunReportWriteResult,
} from '../runtime-qa/runner.js';
import { truncateInlineLog } from '../lib/summary-policy.js';

export type CycleRunnerStopReason =
  | 'complete'
  | 'pause-for-llm'
  | 'pause-for-human'
  | 'verify-failed'
  | 'contract-failed'
  | 'blocked'
  | 'max-stages'
  | 'stop-at'
  | 'missing-goal';

export interface CycleRunnerStageResult {
  stage: ProductCycleStage;
  outcome: 'advance' | 'pause-for-llm' | 'pause-for-human' | 'verify-failed' | 'contract-failed';
  reason: string;
  instruction?: string;
  interventions?: ProductInterventionRoute[];
  research?: ProductResearchRoute[];
  expectedArtifacts?: Array<{ path: string; exists: boolean }>;
  evidence?: Record<string, unknown>;
  runtimeQa?: {
    report: RuntimeQaRunReport;
    written?: RuntimeQaRunReportWriteResult;
  };
}

export interface RunProductCycleOptions {
  root?: string;
  goal?: string;
  maxStages?: number;
  stopAt?: ProductCycleStage;
  dryRun?: boolean;
  verifyCommand?: string;
  runtimeQa?: boolean;
  runtimeQaAuto?: boolean;
  runtimeQaInstallMobileTools?: boolean;
}

export interface RunProductCycleReport {
  ok: boolean;
  startedAt: string;
  startedFromStage?: ProductCycleStage;
  endedAtStage?: ProductCycleStage;
  stoppedReason: CycleRunnerStopReason;
  pauseInstruction?: string;
  researchHandoff?: ProductResearchHandoffWriteResult;
  interventionHandoff?: ProductInterventionHandoffWriteResult;
  interventionExecutionPlan?: ProductInterventionExecutionPlanWriteResult;
  stagesAdvanced: Array<{ from: ProductCycleStage; to: ProductCycleStage; reason: string }>;
  stageResults: CycleRunnerStageResult[];
  issues: ProductCycleIssue[];
}

const DEFAULT_VERIFY_COMMAND = 'npm test';
const DEFAULT_MAX_STAGES = 10;

const STAGE_ORDER: ProductCycleStage[] = ['discover', 'rank', 'select', 'spec', 'build', 'verify', 'learn', 'complete'];

const NEXT_STAGE: Partial<Record<ProductCycleStage, ProductCycleStage>> = {
  discover: 'rank',
  rank: 'select',
  select: 'spec',
  spec: 'build',
  build: 'verify',
  verify: 'learn',
  learn: 'complete',
};

export function runProductCycle(options: RunProductCycleOptions = {}): RunProductCycleReport {
  const root = resolve(options.root ?? process.cwd());
  const dryRun = options.dryRun === true;
  const maxStages = options.maxStages ?? DEFAULT_MAX_STAGES;
  const verifyCommand = options.verifyCommand ?? DEFAULT_VERIFY_COMMAND;
  const stopAt = options.stopAt;
  const startedAt = new Date().toISOString();

  const stagesAdvanced: RunProductCycleReport['stagesAdvanced'] = [];
  const stageResults: CycleRunnerStageResult[] = [];
  const issues: ProductCycleIssue[] = [];

  let snapshot = readProductCycle(root);

  if (!snapshot.exists) {
    if (!options.goal) {
      return finalize({
        ok: false,
        startedAt,
        stoppedReason: 'missing-goal',
        pauseInstruction: 'No active cycle. Pass --goal "<cycle goal>" to bootstrap.',
        stagesAdvanced,
        stageResults,
        issues,
      });
    }

    if (dryRun) {
      stageResults.push({
        stage: 'discover',
        outcome: 'pause-for-human',
        reason: 'dry-run: would create new cycle at discover',
        instruction: `omc product-cycle advance --to discover --goal "${options.goal}"`,
      });
      return finalize({
        ok: true,
        startedAt,
        stoppedReason: 'pause-for-human',
        pauseInstruction: stageResults[0]?.instruction,
        stagesAdvanced,
        stageResults,
        issues,
      });
    }

    const bootstrap = advanceProductCycle({ root, to: 'discover', goal: options.goal });
    if (!bootstrap.ok) {
      issues.push(...bootstrap.issues);
      return finalize({
        ok: false,
        startedAt,
        stoppedReason: 'contract-failed',
        stagesAdvanced,
        stageResults,
        issues,
      });
    }
    snapshot = bootstrap.snapshot;
  }

  const startedFromStage = snapshot.stage;
  let stagesProcessed = 0;

  while (snapshot.stage && stagesProcessed < maxStages) {
    const currentStage = snapshot.stage;

    if (currentStage === 'complete') {
      return finalize({
        ok: true,
        startedAt,
        startedFromStage,
        endedAtStage: currentStage,
        stoppedReason: 'complete',
        stagesAdvanced,
        stageResults,
        issues,
      });
    }

    if (currentStage === 'blocked') {
      return finalize({
        ok: false,
        startedAt,
        startedFromStage,
        endedAtStage: currentStage,
        stoppedReason: 'blocked',
        pauseInstruction: 'Cycle is blocked. Resolve blocking_issues before advancing.',
        stagesAdvanced,
        stageResults,
        issues,
      });
    }

    if (stopAt === currentStage && stagesAdvanced.length > 0) {
      return finalize({
        ok: true,
        startedAt,
        startedFromStage,
        endedAtStage: currentStage,
        stoppedReason: 'stop-at',
        stagesAdvanced,
        stageResults,
        issues,
      });
    }

    const evaluation = evaluateStage(currentStage, snapshot, root, {
      verifyCommand,
      runtimeQa: options.runtimeQa !== false,
      runtimeQaAuto: options.runtimeQaAuto === true,
      runtimeQaInstallMobileTools: options.runtimeQaInstallMobileTools === true,
      dryRun,
    });
    stageResults.push(evaluation);

    if (evaluation.outcome !== 'advance') {
      const reason: CycleRunnerStopReason = evaluation.outcome === 'verify-failed'
        ? 'verify-failed'
        : evaluation.outcome === 'contract-failed'
          ? 'contract-failed'
          : evaluation.outcome === 'pause-for-human'
            ? 'pause-for-human'
            : 'pause-for-llm';
      const interventionArtifacts = !dryRun && evaluation.interventions && evaluation.interventions.length > 0
        ? writeInterventionArtifacts(root, snapshot, currentStage, evaluation)
        : undefined;
      const researchHandoff = !dryRun && evaluation.research && evaluation.research.length > 0
        ? writeResearchArtifacts(root, snapshot, currentStage)
        : undefined;
      return finalize({
        ok: reason === 'pause-for-human' || reason === 'pause-for-llm',
        startedAt,
        startedFromStage,
        endedAtStage: currentStage,
        stoppedReason: reason,
        pauseInstruction: evaluation.instruction,
        researchHandoff,
        interventionHandoff: interventionArtifacts?.handoff,
        interventionExecutionPlan: interventionArtifacts?.executionPlan,
        stagesAdvanced,
        stageResults,
        issues,
      });
    }

    const nextStage = NEXT_STAGE[currentStage];
    if (!nextStage) {
      return finalize({
        ok: true,
        startedAt,
        startedFromStage,
        endedAtStage: currentStage,
        stoppedReason: 'complete',
        stagesAdvanced,
        stageResults,
        issues,
      });
    }

    if (dryRun) {
      stagesAdvanced.push({ from: currentStage, to: nextStage, reason: `[dry-run] ${evaluation.reason}` });
      const projected = STAGE_ORDER.indexOf(nextStage);
      if (projected < 0) break;
      snapshot = { ...snapshot, stage: nextStage };
      stagesProcessed += 1;
      continue;
    }

    const advance = advanceProductCycle({ root, to: nextStage });
    if (!advance.ok) {
      issues.push(...advance.issues);
      return finalize({
        ok: false,
        startedAt,
        startedFromStage,
        endedAtStage: currentStage,
        stoppedReason: 'contract-failed',
        stagesAdvanced,
        stageResults,
        issues,
      });
    }

    stagesAdvanced.push({ from: currentStage, to: nextStage, reason: evaluation.reason });
    snapshot = advance.snapshot;
    stagesProcessed += 1;
  }

  return finalize({
    ok: true,
    startedAt,
    startedFromStage,
    endedAtStage: snapshot.stage,
    stoppedReason: 'max-stages',
    pauseInstruction: `Reached max-stages (${maxStages}) before completion. Re-run to continue.`,
    stagesAdvanced,
    stageResults,
    issues,
  });
}

function writeResearchArtifacts(
  root: string,
  snapshot: ProductCycleSnapshot,
  currentStage: ProductCycleStage,
): ProductResearchHandoffWriteResult | undefined {
  const plan = planProductResearch({ root, stage: currentStage, snapshot });
  if (plan.routes.length === 0) return undefined;
  return writeProductResearchHandoff(root, snapshot, plan);
}

function writeInterventionArtifacts(
  root: string,
  snapshot: ProductCycleSnapshot,
  currentStage: ProductCycleStage,
  evaluation: CycleRunnerStageResult,
): {
  handoff: ProductInterventionHandoffWriteResult;
  executionPlan?: ProductInterventionExecutionPlanWriteResult;
} {
  const handoff = writeProductInterventionHandoff(
    root,
    snapshot,
    planProductInterventions({
      root,
      stage: currentStage,
      snapshot,
      failure: evaluation.outcome === 'verify-failed'
        ? { kind: 'verify-command-failed', command: evaluation.instruction, reason: evaluation.reason }
        : evaluation.outcome === 'contract-failed'
          ? { kind: 'contract-failed', command: evaluation.instruction, reason: evaluation.reason }
          : undefined,
    }),
  );
  const writtenHandoff = readProductInterventionHandoff(root);
  const executionPlan = writtenHandoff
    ? writeProductInterventionExecutionPlan(root, buildProductInterventionExecutionPlan(writtenHandoff))
    : undefined;
  return { handoff, executionPlan };
}

function evaluateStage(
  stage: ProductCycleStage,
  snapshot: ProductCycleSnapshot,
  root: string,
  options: {
    verifyCommand: string;
    runtimeQa: boolean;
    runtimeQaAuto: boolean;
    runtimeQaInstallMobileTools: boolean;
    dryRun: boolean;
  },
): CycleRunnerStageResult {
  switch (stage) {
    case 'discover':
      return evaluateDiscover(root);
    case 'rank':
      return evaluateRank(root);
    case 'select':
      return evaluateSelect(root, snapshot.cycleId);
    case 'spec':
      return evaluateSpec(root);
    case 'build':
      return evaluateBuild(root, snapshot);
    case 'verify':
      return evaluateVerify(root, options);
    case 'learn':
      return evaluateLearn(root);
    default:
      return {
        stage,
        outcome: 'pause-for-human',
        reason: `Unknown stage: ${stage}`,
      };
  }
}

function evaluateDiscover(root: string): CycleRunnerStageResult {
  const capabilityPath = '.omc/product/capability-map/current.md';
  const ecosystemPath = '.omc/ecosystem/current.md';
  const expected = [
    { path: capabilityPath, exists: existsSync(resolve(root, capabilityPath)) },
    { path: ecosystemPath, exists: existsSync(resolve(root, ecosystemPath)) },
  ];

  if (expected[0].exists) {
    return {
      stage: 'discover',
      outcome: 'advance',
      reason: 'capability map present',
      expectedArtifacts: expected,
    };
  }

  return {
    stage: 'discover',
    outcome: 'pause-for-llm',
    reason: 'capability map missing',
    instruction: '/product-foundation "<cycle goal>" --foundation-lite',
    expectedArtifacts: expected,
  };
}

function evaluateRank(root: string): CycleRunnerStageResult {
  const opportunities = '.omc/opportunities/current.md';
  const ledger = '.omc/portfolio/current.json';
  const roadmap = '.omc/roadmap/current.md';
  const expected = [
    { path: opportunities, exists: existsSync(resolve(root, opportunities)) },
    { path: roadmap, exists: existsSync(resolve(root, roadmap)) },
    { path: ledger, exists: existsSync(resolve(root, ledger)) },
  ];

  const missing = expected.filter((entry) => !entry.exists).map((entry) => entry.path);
  if (missing.length > 0) {
    return {
      stage: 'rank',
      outcome: 'pause-for-llm',
      reason: `missing: ${missing.join(', ')}`,
      instruction: '/priority-engine "<cycle goal>"',
      expectedArtifacts: expected,
    };
  }

  const handoff = validateProductPipelineContracts({ root, stage: 'priority-handoff' });
  if (!handoff.ok) {
    return {
      stage: 'rank',
      outcome: 'contract-failed',
      reason: 'priority-handoff contract failed',
      instruction: 'omc doctor product-contracts --stage priority-handoff',
      evidence: { issues: handoff.issues },
    };
  }

  return {
    stage: 'rank',
    outcome: 'advance',
    reason: 'priority-handoff contract ok',
    expectedArtifacts: expected,
  };
}

function evaluateSelect(root: string, cycleId: string | undefined): CycleRunnerStageResult {
  let ledger: ReturnType<typeof readPortfolioLedger>;
  try {
    ledger = readPortfolioLedger(root);
  } catch {
    return {
      stage: 'select',
      outcome: 'contract-failed',
      reason: 'portfolio ledger could not be read',
      instruction: 'omc portfolio validate',
    };
  }

  if (!ledger) {
    return {
      stage: 'select',
      outcome: 'contract-failed',
      reason: 'portfolio ledger missing',
      instruction: 'omc portfolio validate',
    };
  }
  const cycleItems = cycleId
    ? ledger.items.filter((item) => item.selected_cycle === cycleId)
    : ledger.items.filter((item) => item.status === 'selected');

  const hasCore = cycleItems.some((item) => item.type === 'core-product-slice');
  const hasEnabling = cycleItems.some((item) => item.type === 'enabling');
  const hasLearning = cycleItems.some((item) => item.type === 'learning' || item.type === 'research');

  if (hasCore && hasEnabling && hasLearning) {
    return {
      stage: 'select',
      outcome: 'advance',
      reason: '1 core + 1 enabling + 1 learning selected',
      evidence: { selectedItems: cycleItems.map((item) => ({ id: item.id, type: item.type })) },
    };
  }

  const missing: string[] = [];
  if (!hasCore) missing.push('core-product-slice');
  if (!hasEnabling) missing.push('enabling');
  if (!hasLearning) missing.push('learning/research');

  return {
    stage: 'select',
    outcome: 'pause-for-human',
    reason: `selected portfolio missing: ${missing.join(', ')}`,
    instruction: 'Mark portfolio items as selected for the active cycle in .omc/portfolio/current.json (set selected_cycle and status=selected)',
    evidence: { missing, currentSelection: cycleItems.map((item) => item.id) },
  };
}

function evaluateSpec(root: string): CycleRunnerStageResult {
  const snapshot = readProductCycle(root);
  const researchPlan = planProductResearch({ root, stage: 'spec', snapshot });
  if (researchPlan.blockingRoutes.length > 0) {
    return {
      stage: 'spec',
      outcome: 'pause-for-llm',
      reason: 'product-cycle research required before spec/build decisions',
      instruction: researchPlan.nextCommand,
      research: researchPlan.routes,
    };
  }

  const cycleReport = validateProductPipelineContracts({ root, stage: 'cycle' });
  if (cycleReport.ok) {
    return {
      stage: 'spec',
      outcome: 'advance',
      reason: 'cycle contract ok',
    };
  }

  return {
    stage: 'spec',
    outcome: 'contract-failed',
    reason: 'cycle contract failed',
    instruction: 'omc doctor product-contracts --stage cycle',
    interventions: planProductInterventions({
      root,
      stage: 'spec',
      snapshot,
      failure: { kind: 'contract-failed', reason: 'cycle contract failed' },
    }).routes,
    evidence: { issues: cycleReport.issues },
  };
}

function evaluateBuild(root: string, snapshot: ProductCycleSnapshot): CycleRunnerStageResult {
  const route = (snapshot.buildRoute ?? '').toLowerCase();
  const researchPlan = planProductResearch({ root, stage: 'build', snapshot });
  if (researchPlan.blockingRoutes.length > 0) {
    return {
      stage: 'build',
      outcome: 'pause-for-llm',
      reason: 'product-cycle research required before build pipeline',
      instruction: researchPlan.nextCommand,
      research: researchPlan.routes,
    };
  }

  const interventionPlan = planProductInterventions({ root, stage: 'build', snapshot });
  const command = interventionPlan.nextCommand
    ?? (route === 'backend-pipeline'
      ? '/backend-pipeline "<enabling task>"'
      : route === 'both'
        ? '/backend-pipeline "<enabling task>" then /product-pipeline "<core product slice>"'
        : '/product-pipeline "<core product slice>"');

  return {
    stage: 'build',
    outcome: 'pause-for-llm',
    reason: `build_route=${route || 'unknown'} requires LLM-driven pipeline`,
    instruction: command,
    interventions: interventionPlan.routes,
  };
}

function evaluateVerify(
  root: string,
  options: {
    verifyCommand: string;
    runtimeQa: boolean;
    runtimeQaAuto: boolean;
    runtimeQaInstallMobileTools: boolean;
    dryRun: boolean;
  },
): CycleRunnerStageResult {
  const trimmed = options.verifyCommand.trim();
  if (!trimmed || trimmed.toLowerCase() === 'skip') {
    return {
      stage: 'verify',
      outcome: 'pause-for-human',
      reason: 'verify command disabled (--verify-command skip)',
      instruction: 'Run cycle-specific tests/audits manually, then omc product-cycle advance --to learn',
    };
  }

  const result = spawnSync(trimmed, {
    cwd: root,
    shell: true,
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  if (result.error) {
    const reason = `verify command error: ${result.error.message}`;
    return {
      stage: 'verify',
      outcome: 'verify-failed',
      reason,
      instruction: trimmed,
      interventions: planProductInterventions({
        root,
        stage: 'verify',
        snapshot: readProductCycle(root),
        failure: { kind: 'verify-command-failed', command: trimmed, reason },
      }).routes,
      evidence: { command: trimmed, error: String(result.error) },
    };
  }

  if (result.status === 0) {
    const runtimeQa = maybeRunRuntimeQa(root, options);
    if (runtimeQa && runtimeQa.report.status === 'blocked') {
      return {
        stage: 'verify',
        outcome: 'pause-for-human',
        reason: `runtime QA blocked (${runtimeQa.report.adapter})`,
        instruction: runtimeQa.report.install_proposal
          ?? 'Configure .omc/runtime-qa.json or rerun with --install-mobile-tools after approving tool provisioning.',
        runtimeQa,
        evidence: { command: trimmed, exitCode: 0, runtimeQaStatus: runtimeQa.report.status },
      };
    }
    if (runtimeQa && runtimeQa.report.status === 'failed') {
      const reason = `runtime QA failed (${runtimeQa.report.adapter})`;
      return {
        stage: 'verify',
        outcome: 'verify-failed',
        reason,
        instruction: 'omc runtime-qa run --auto --json',
        runtimeQa,
        interventions: planProductInterventions({
          root,
          stage: 'verify',
          snapshot: readProductCycle(root),
          failure: { kind: 'verify-command-failed', command: 'omc runtime-qa run --auto --json', reason },
        }).routes,
        evidence: { command: trimmed, exitCode: 0, runtimeQaStatus: runtimeQa.report.status },
      };
    }

    return {
      stage: 'verify',
      outcome: 'advance',
      reason: `verify passed (${trimmed})`,
      runtimeQa,
      evidence: { command: trimmed, exitCode: 0, runtimeQaStatus: runtimeQa?.report.status },
    };
  }

  const reason = `verify failed (${trimmed}, exit ${result.status})`;
  return {
    stage: 'verify',
    outcome: 'verify-failed',
    reason,
    instruction: trimmed,
    interventions: planProductInterventions({
      root,
      stage: 'verify',
      snapshot: readProductCycle(root),
      failure: { kind: 'verify-command-failed', command: trimmed, reason },
    }).routes,
    evidence: {
      command: trimmed,
      exitCode: result.status,
      stderr: truncateInlineLog(result.stderr ?? ''),
      stdout: truncateInlineLog(result.stdout ?? ''),
    },
  };
}

function maybeRunRuntimeQa(
  root: string,
  options: {
    runtimeQa: boolean;
    runtimeQaAuto: boolean;
    runtimeQaInstallMobileTools: boolean;
    dryRun: boolean;
  },
): CycleRunnerStageResult['runtimeQa'] | undefined {
  if (!options.runtimeQa || !shouldRunRuntimeQa(root)) return undefined;
  const report = runRuntimeQa({
    root,
    auto: options.runtimeQaAuto,
    dryRun: options.dryRun,
    installMobileTools: options.runtimeQaInstallMobileTools,
    writeDetectedConfig: options.runtimeQaAuto,
  });
  const written = options.dryRun ? undefined : writeRuntimeQaRunReport(root, report);
  return { report, written };
}

function evaluateLearn(root: string): CycleRunnerStageResult {
  const learningPath = resolve(root, '.omc/learning/current.md');
  const expected = [{ path: '.omc/learning/current.md', exists: existsSync(learningPath) }];

  if (!expected[0].exists) {
    return {
      stage: 'learn',
      outcome: 'pause-for-llm',
      reason: 'learning capture missing',
      instruction: 'Write .omc/learning/current.md with shipped outcome, evidence collected, user/product learning, invalidated assumptions, recommended next cycle.',
      expectedArtifacts: expected,
    };
  }

  const content = readFileSync(learningPath, 'utf-8').toLowerCase();
  const required = ['shipped outcome', 'evidence collected', 'user/product learning', 'invalidated assumptions', 'recommended next cycle'];
  const missing = required.filter((term) => !content.includes(term));
  if (missing.length > 0) {
    return {
      stage: 'learn',
      outcome: 'pause-for-llm',
      reason: `learning capture missing required sections: ${missing.join(', ')}`,
      instruction: 'Add the missing sections to .omc/learning/current.md',
      expectedArtifacts: expected,
    };
  }

  // Touch the ledger to surface a portfolio sanity check (advisory only).
  void readPortfolioLedger(root);

  return {
    stage: 'learn',
    outcome: 'advance',
    reason: 'learning capture complete',
    expectedArtifacts: expected,
  };
}

function finalize(report: Omit<RunProductCycleReport, 'ok'> & { ok: boolean }): RunProductCycleReport {
  return report;
}
