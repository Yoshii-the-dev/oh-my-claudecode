import type { ProductInterventionExecutionPlan, ProductInterventionExecutionStep } from './intervention-execution-plan.js';
import type { ProductResearchExecutionPlan, ProductResearchExecutionStep } from './research-execution-plan.js';
import type { ProductCycleStage } from './cycle-fsm.js';
export type ProductCycleAutoPolicy = 'off' | 'safe';
export type AutoDecisionAction = 'run' | 'ask_user' | 'block' | 'stop';
export type AutoDecisionReason = 'auto-disabled' | 'safe-executable' | 'human-gate' | 'unsafe-step' | 'missing-dependency' | 'max-attempts' | 'repeated-failure' | 'no-action' | 'terminal';
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
export declare function decideAutoAction(input: AutoDecisionInput): AutoDecision;
export declare function buildAutoAttemptKey(stage: ProductCycleStage | undefined, kind: string): string;
//# sourceMappingURL=auto-decision.d.ts.map