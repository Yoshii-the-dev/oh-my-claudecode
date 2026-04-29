import { type ProductCycleIssue, type ProductCycleStage } from './cycle-fsm.js';
import { type ProductInterventionHandoffWriteResult, type ProductInterventionRoute } from './intervention-router.js';
import { type ProductInterventionExecutionPlanWriteResult } from './intervention-execution-plan.js';
import { type ProductResearchHandoffWriteResult, type ProductResearchRoute } from './research-router.js';
import { type RuntimeQaRunReport, type RuntimeQaRunReportWriteResult } from '../runtime-qa/runner.js';
export type CycleRunnerStopReason = 'complete' | 'pause-for-llm' | 'pause-for-human' | 'verify-failed' | 'contract-failed' | 'blocked' | 'max-stages' | 'stop-at' | 'missing-goal';
export interface CycleRunnerStageResult {
    stage: ProductCycleStage;
    outcome: 'advance' | 'pause-for-llm' | 'pause-for-human' | 'verify-failed' | 'contract-failed';
    reason: string;
    instruction?: string;
    interventions?: ProductInterventionRoute[];
    research?: ProductResearchRoute[];
    expectedArtifacts?: Array<{
        path: string;
        exists: boolean;
    }>;
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
    stagesAdvanced: Array<{
        from: ProductCycleStage;
        to: ProductCycleStage;
        reason: string;
    }>;
    stageResults: CycleRunnerStageResult[];
    issues: ProductCycleIssue[];
}
export declare function runProductCycle(options?: RunProductCycleOptions): RunProductCycleReport;
//# sourceMappingURL=cycle-runner.d.ts.map