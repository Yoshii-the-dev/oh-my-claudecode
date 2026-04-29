import type {
  ProductInterventionExecutionPlan,
  ProductInterventionExecutionStep,
} from './intervention-execution-plan.js';
import type {
  ProductResearchExecutionPlan,
  ProductResearchExecutionStep,
} from './research-execution-plan.js';
import type { ProductCycleStage } from './cycle-fsm.js';

export type ProductCycleAutoPolicy = 'off' | 'safe';
export type AutoDecisionAction = 'run' | 'ask_user' | 'block' | 'stop';
export type AutoDecisionReason =
  | 'auto-disabled'
  | 'safe-executable'
  | 'human-gate'
  | 'unsafe-step'
  | 'missing-dependency'
  | 'max-attempts'
  | 'repeated-failure'
  | 'no-action'
  | 'terminal';

export interface AutoDecisionInput {
  policy: ProductCycleAutoPolicy;
  stage?: ProductCycleStage;
  handoffKind?: 'research' | 'intervention' | 'runtime-qa';
  plan?: ProductInterventionExecutionPlan | ProductResearchExecutionPlan;
  humanGate?: boolean;
  missingDependency?: boolean;
  terminal?: boolean;
  attemptCount?: number;
  maxAttempts?: number;
  repeatedFailure?: boolean;
  safeStepPredicate?: (step: ProductInterventionExecutionStep | ProductResearchExecutionStep) => boolean;
}

export interface AutoDecision {
  action: AutoDecisionAction;
  reason: AutoDecisionReason;
  message: string;
  runnableStepCount: number;
  blockedStepIds: string[];
}

const DEFAULT_MAX_ATTEMPTS = 3;

export function decideAutoAction(input: AutoDecisionInput): AutoDecision {
  if (input.policy === 'off') {
    return decision('ask_user', 'auto-disabled', 'Auto policy is off.', input.plan);
  }
  if (input.terminal) {
    return decision('stop', 'terminal', 'Cycle is already terminal.', input.plan);
  }
  if (input.humanGate) {
    return decision('ask_user', 'human-gate', 'Human decision is required before continuing.', input.plan);
  }
  if (input.missingDependency) {
    return decision('block', 'missing-dependency', 'Required tool or dependency is missing; install/provision approval is required.', input.plan);
  }

  const attempts = input.attemptCount ?? 0;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (attempts >= maxAttempts) {
    return decision('block', 'max-attempts', `Auto policy reached max attempts (${maxAttempts}).`, input.plan);
  }
  if (input.repeatedFailure) {
    return decision('block', 'repeated-failure', 'The same automatic action failed repeatedly.', input.plan);
  }

  const steps = input.plan?.steps ?? [];
  if (steps.length === 0) {
    return decision('ask_user', 'no-action', 'No executable handoff steps are available.', input.plan);
  }

  const isSafe = input.safeStepPredicate ?? defaultSafeStepPredicate;
  const blocked = steps.filter((step) => !isSafe(step));
  if (blocked.length > 0) {
    return {
      action: 'block',
      reason: 'unsafe-step',
      message: `Unsafe or manual steps require user review: ${blocked.map((step) => step.route_id).join(', ')}`,
      runnableStepCount: steps.length - blocked.length,
      blockedStepIds: blocked.map((step) => step.route_id),
    };
  }

  return decision('run', 'safe-executable', 'All handoff steps are safe executable surfaces.', input.plan);
}

export function buildAutoAttemptKey(stage: ProductCycleStage | undefined, kind: string): string {
  return `${stage ?? 'unknown'}:${kind}`;
}

function defaultSafeStepPredicate(step: ProductInterventionExecutionStep | ProductResearchExecutionStep): boolean {
  if (!step.executable || !step.argv || step.argv.length === 0) return false;
  return step.execution_surface === 'agent-prompt'
    || step.execution_surface === 'team-start';
}

function decision(
  action: AutoDecisionAction,
  reason: AutoDecisionReason,
  message: string,
  plan?: ProductInterventionExecutionPlan | ProductResearchExecutionPlan,
): AutoDecision {
  return {
    action,
    reason,
    message,
    runnableStepCount: plan?.steps.length ?? 0,
    blockedStepIds: [],
  };
}
