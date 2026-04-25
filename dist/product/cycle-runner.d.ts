import { type ProductCycleIssue, type ProductCycleStage } from './cycle-fsm.js';
export type CycleRunnerStopReason = 'complete' | 'pause-for-llm' | 'pause-for-human' | 'verify-failed' | 'contract-failed' | 'blocked' | 'max-stages' | 'stop-at' | 'missing-goal';
export interface CycleRunnerStageResult {
    stage: ProductCycleStage;
    outcome: 'advance' | 'pause-for-llm' | 'pause-for-human' | 'verify-failed' | 'contract-failed';
    reason: string;
    instruction?: string;
    expectedArtifacts?: Array<{
        path: string;
        exists: boolean;
    }>;
    evidence?: Record<string, unknown>;
}
export interface RunProductCycleOptions {
    root?: string;
    goal?: string;
    maxStages?: number;
    stopAt?: ProductCycleStage;
    dryRun?: boolean;
    verifyCommand?: string;
}
export interface RunProductCycleReport {
    ok: boolean;
    startedAt: string;
    startedFromStage?: ProductCycleStage;
    endedAtStage?: ProductCycleStage;
    stoppedReason: CycleRunnerStopReason;
    pauseInstruction?: string;
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